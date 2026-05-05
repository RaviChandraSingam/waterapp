const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/export/:monthlyRecordId
router.get('/:monthlyRecordId', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const recordResult = await db.query('SELECT * FROM monthly_records WHERE id = $1', [req.params.monthlyRecordId]);
    if (recordResult.rows.length === 0) {
      return res.status(404).json({ error: 'Monthly record not found' });
    }

    const record = recordResult.rows[0];
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const filename = `water_consumption_${monthNames[record.month]}${record.year}.xlsx`;
    // Helper: convert a DB Date/string to YYYY-MM-DD
    const fmt = d => d ? new Date(d).toISOString().split('T')[0] : '';

    const workbook = new ExcelJS.Workbook();

    // === SUMMARY SHEET ===
    // Row layout must match the importer's hardcoded expectations:
    //   Row 1: title, Row 2: ['', startDate, endDate]
    //   Rows 3-6: borewells in fixed order (Ablock New, A block, C block, D block)
    //   Rows 7-8: tankers (padded to 2 rows)
    //   Row 9+: cost items
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { width: 30 }, { width: 15 }, { width: 15 }, { width: 15 },
    ];

    summarySheet.addRow(['WATER INPUT']);                                          // row 1
    summarySheet.addRow(['', fmt(record.period_start_date), fmt(record.period_end_date)]); // row 2

    // Rows 3-6: borewells in the fixed order the importer expects
    const BOREWELL_IMPORT_ORDER = ['Ablock New Borewell', 'A block Borewell', 'C block Borewell', 'D block Borewell'];
    const borewellResult = await db.query(`
      SELECT ws.name, wsr.start_reading, wsr.end_reading, wsr.consumption_litres
      FROM water_sources ws
      LEFT JOIN water_source_readings wsr ON ws.id = wsr.water_source_id AND wsr.monthly_record_id = $1
      WHERE ws.source_type = 'borewell'
    `, [req.params.monthlyRecordId]);
    // Ensure only one reading per borewell name, and never duplicate readings
    const borewellMap = new Map();
    borewellResult.rows.forEach(r => {
      if (r.name && !borewellMap.has(r.name)) borewellMap.set(r.name, r);
    });
    BOREWELL_IMPORT_ORDER.forEach(name => {
      const b = borewellMap.get(name);
      if (b && b.start_reading !== null) {
        summarySheet.addRow([name, parseFloat(b.start_reading), parseFloat(b.end_reading), parseFloat(b.consumption_litres)]);
      } else {
        summarySheet.addRow([name, '', '', '']);
      }
    });

    // Rows 7-8: tankers (always 2 rows so downstream rows stay aligned)
    const tankerResult = await db.query(`
      SELECT ws.name, wsr.unit_count, wsr.consumption_litres, wsr.total_cost
      FROM water_sources ws
      LEFT JOIN water_source_readings wsr ON ws.id = wsr.water_source_id AND wsr.monthly_record_id = $1
      WHERE ws.source_type = 'tanker'
      ORDER BY ws.name
    `, [req.params.monthlyRecordId]);
    let tankerRowsWritten = 0;
    tankerResult.rows.forEach(t => {
      if (tankerRowsWritten < 2) {
        let costPerTanker = '';
        if (t.unit_count && t.total_cost) {
          const n = parseFloat(t.unit_count);
          const total = parseFloat(t.total_cost);
          if (n > 0) costPerTanker = Math.round((total / n) * 100) / 100;
        }
        summarySheet.addRow([
          t.name,
          t.unit_count !== null ? parseFloat(t.unit_count) : '',
          costPerTanker,
          t.consumption_litres !== null ? parseFloat(t.consumption_litres) : ''
        ]);
        tankerRowsWritten++;
      }
    });
    while (tankerRowsWritten < 2) { summarySheet.addRow(['', '', '', '']); tankerRowsWritten++; }

    summarySheet.addRow(['TOTAL Input (Litres)', '', '', parseFloat(record.total_water_input || 0)]);
    summarySheet.addRow([]);
    summarySheet.addRow(['WATER USAGE']);

    // Block totals
    const blockTotals = await db.query(`
      SELECT b.display_name, COALESCE(SUM(fb.consumption_litres), 0) as total
      FROM blocks b
      LEFT JOIN flats f ON b.id = f.block_id
      LEFT JOIN flat_billing fb ON f.id = fb.flat_id AND fb.monthly_record_id = $1
      GROUP BY b.id, b.display_name ORDER BY b.name
    `, [req.params.monthlyRecordId]);

    blockTotals.rows.forEach(bt => {
      summarySheet.addRow([bt.display_name + ' Total', '', '', parseFloat(bt.total)]);
    });

    // Common area total
    const commonTotal = await db.query(
      'SELECT COALESCE(SUM(consumption_litres), 0) as total FROM common_area_readings WHERE monthly_record_id = $1',
      [req.params.monthlyRecordId]
    );
    summarySheet.addRow(['Common Usage Total', '', '', parseFloat(commonTotal.rows[0].total)]);
    summarySheet.addRow(['TOTAL Usage (Litres)', '', '', parseFloat(record.total_water_usage || 0)]);
    summarySheet.addRow([]);

    // Cost items
    const costItems = await db.query(
      'SELECT * FROM cost_items WHERE monthly_record_id = $1 ORDER BY item_name',
      [req.params.monthlyRecordId]
    );
    summarySheet.addRow(['Items', 'Cost']);
    costItems.rows.forEach(ci => {
      summarySheet.addRow([ci.item_name, parseFloat(ci.amount)]);
    });
    summarySheet.addRow(['Cost per Litre', parseFloat(record.cost_per_litre || 0)]);

    // === CONSUMPTION SHEET ===
    const consumptionSheet = workbook.addWorksheet('Consumption');
    consumptionSheet.columns = [
      { header: 'Common Rooms', width: 25 },
      { header: fmt(record.period_start_date), width: 15 },
      { header: fmt(record.period_end_date), width: 15 },
      { header: 'Consumption', width: 15 },
    ];

    const commonReadings = await db.query(`
      SELECT ca.name, car.start_reading, car.end_reading, car.consumption_litres
      FROM common_area_readings car
      JOIN common_areas ca ON car.common_area_id = ca.id
      WHERE car.monthly_record_id = $1
      ORDER BY ca.name
    `, [req.params.monthlyRecordId]);

    commonReadings.rows.forEach(cr => {
      consumptionSheet.addRow([cr.name, parseFloat(cr.start_reading), parseFloat(cr.end_reading), parseFloat(cr.consumption_litres)]);
    });

    // === BLOCK SHEETS ===
    const blocks = await db.query('SELECT * FROM blocks ORDER BY name');
    for (const block of blocks.rows) {
      const sheet = workbook.addWorksheet(`${block.display_name}`);
      sheet.columns = [
        { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 },
        { width: 13 }, { width: 12 }, { width: 12 }, { width: 12 },
        { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
      ];

      // Row 1: title row (import skips this row, reads data from row 3)
      sheet.addRow([block.display_name]);

      // Row 2: header row with dates as column headers (import reads mid date from C2)
      const headerRow = sheet.addRow([
        'Flat No',
        fmt(record.period_start_date),
        'Mid Reading',
        fmt(record.period_end_date),
        'Consumption', 'Slab1 (QTY)', 'Slab2 (QTY)', 'Slab3 (QTY)',
        'Cost Slab1', 'Cost Slab2', 'Cost Slab3', 'Total Cost',
      ]);
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

      const billing = await db.query(`
        SELECT fb.*, f.flat_number
        FROM flat_billing fb
        JOIN flats f ON fb.flat_id = f.id
        WHERE fb.monthly_record_id = $1 AND f.block_id = $2
        ORDER BY f.flat_number
      `, [req.params.monthlyRecordId, block.id]);

      // Get mid-readings
      const midReadings = await db.query(`
        SELECT mr.flat_id, mr.reading_value
        FROM meter_readings mr
        JOIN flats f ON mr.flat_id = f.id
        WHERE mr.monthly_record_id = $1 AND f.block_id = $2 AND mr.reading_sequence = 2
      `, [req.params.monthlyRecordId, block.id]);

      const midMap = {};
      midReadings.rows.forEach(mr => { midMap[mr.flat_id] = parseFloat(mr.reading_value); });

      billing.rows.forEach(b => {
        const round3 = v => Math.round(parseFloat(v) * 1000) / 1000;
        sheet.addRow([
          b.flat_number,
          parseFloat(b.start_reading),
          midMap[b.flat_id] || '',
          parseFloat(b.end_reading),
          round3(b.consumption_litres),
          round3(b.slab1_qty),
          round3(b.slab2_qty),
          round3(b.slab3_qty),
          parseFloat(b.slab1_cost),
          parseFloat(b.slab2_cost),
          parseFloat(b.slab3_cost),
          parseFloat(b.total_cost),
        ]);
      });

      // Add totals row
      const totalRow = sheet.addRow([
        'TOTAL', '', '', '',
        { formula: `SUM(E3:E${billing.rows.length + 2})` },
        '', '', '', '', '', '',
        { formula: `SUM(L3:L${billing.rows.length + 2})` },
      ]);
      totalRow.font = { bold: true };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/export/:monthlyRecordId/billing-csv
// Produces a society-app-compatible CSV: title row, header row, one row per flat (all blocks)
router.get('/:monthlyRecordId/billing-csv', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const recordResult = await db.query('SELECT * FROM monthly_records WHERE id = $1', [req.params.monthlyRecordId]);
    if (recordResult.rows.length === 0) {
      return res.status(404).json({ error: 'Monthly record not found' });
    }

    const record = recordResult.rows[0];
    const MONTH_NAMES_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthLabel = `${MONTH_NAMES_FULL[record.month]} ${record.year}`;
    const filename = `Monthly Water Usage Charges_${MONTH_NAMES_FULL[record.month]} ${record.year}.csv`;

    // Fetch all flat billing for this monthly record, ordered by block name then flat number
    const billing = await db.query(`
      SELECT
        b.display_name AS block_name,
        f.flat_number,
        COALESCE(fb.total_cost, 0) AS total_cost
      FROM flats f
      JOIN blocks b ON f.block_id = b.id
      LEFT JOIN flat_billing fb ON fb.flat_id = f.id AND fb.monthly_record_id = $1
      WHERE f.is_active = true
      ORDER BY b.name, f.flat_number
    `, [req.params.monthlyRecordId]);

    // Build CSV rows
    const rows = [];
    // Row 1: title (matches society app import format)
    rows.push(`,Water Usage ${monthLabel} (ID:${record.id.replace(/-/g, '').slice(0, 6).toUpperCase()}),,`);
    // Row 2: column headers
    rows.push('House No.,Item Amount,Credit Amount (if applicable),Description (optional)');
    // Data rows
    billing.rows.forEach(row => {
      const houseNo = `${row.block_name}-${row.flat_number}`;
      const amount = Math.round(Number(row.total_cost));
      rows.push(`${houseNo},${amount},0,`);
    });

    const csv = rows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
