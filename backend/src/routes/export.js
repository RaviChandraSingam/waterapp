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

    const workbook = new ExcelJS.Workbook();

    // === SUMMARY SHEET ===
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: '', width: 30 },
      { header: '', width: 15 },
      { header: '', width: 15 },
      { header: '', width: 15 },
    ];

    summarySheet.addRow(['WATER INPUT']);
    summarySheet.addRow(['', record.period_start_date, record.period_end_date]);

    // Water sources
    const sources = await db.query(`
      SELECT ws.name, wsr.start_reading, wsr.end_reading, wsr.unit_count, wsr.consumption_litres, wsr.total_cost
      FROM water_source_readings wsr
      JOIN water_sources ws ON wsr.water_source_id = ws.id
      WHERE wsr.monthly_record_id = $1
      ORDER BY ws.name
    `, [req.params.monthlyRecordId]);

    sources.rows.forEach(s => {
      if (s.start_reading !== null) {
        summarySheet.addRow([s.name, parseFloat(s.start_reading), parseFloat(s.end_reading), parseFloat(s.consumption_litres)]);
      } else {
        summarySheet.addRow([s.name, parseFloat(s.unit_count), '', parseFloat(s.consumption_litres)]);
      }
    });

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
      { header: String(record.period_start_date), width: 15 },
      { header: String(record.period_end_date), width: 15 },
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
        { header: 'Flat No', width: 10 },
        { header: String(record.period_start_date), width: 12 },
        { header: 'Mid Reading', width: 12 },
        { header: String(record.period_end_date), width: 12 },
        { header: 'Consumption', width: 13 },
        { header: 'Slab1 (QTY)', width: 12 },
        { header: 'Slab2 (QTY)', width: 12 },
        { header: 'Slab3 (QTY)', width: 12 },
        { header: 'Cost Slab1', width: 12 },
        { header: 'Cost Slab2', width: 12 },
        { header: 'Cost Slab3', width: 12 },
        { header: 'Total Cost', width: 12 },
      ];

      // Style header row
      const headerRow = sheet.getRow(1);
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
        sheet.addRow([
          b.flat_number,
          parseFloat(b.start_reading),
          midMap[b.flat_id] || '',
          parseFloat(b.end_reading),
          parseFloat(b.consumption_litres),
          parseFloat(b.slab1_qty),
          parseFloat(b.slab2_qty),
          parseFloat(b.slab3_qty),
          parseFloat(b.slab1_cost),
          parseFloat(b.slab2_cost),
          parseFloat(b.slab3_cost),
          parseFloat(b.total_cost),
        ]);
      });

      // Add totals row
      const totalRow = sheet.addRow([
        'TOTAL', '', '', '',
        { formula: `SUM(E2:E${billing.rows.length + 1})` },
        '', '', '', '', '', '',
        { formula: `SUM(L2:L${billing.rows.length + 1})` },
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

module.exports = router;
