const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { recalculateMonthlyRecord } = require('../helpers/recalculate');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Extract a numeric result from a cell that may be a plain number or a cached formula result
function getCellResult(cell) {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'object' && 'result' in cell) return parseFloat(cell.result);
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string' && !isNaN(parseFloat(cell))) return parseFloat(cell);
  return null;
}

const BLOCK_MAP = {
  'A block': 'a0000000-0000-0000-0000-000000000001',
  'B block': 'a0000000-0000-0000-0000-000000000002',
  'C block': 'a0000000-0000-0000-0000-000000000003',
  'D block': 'a0000000-0000-0000-0000-000000000004',
  'E block': 'a0000000-0000-0000-0000-000000000005',
};

function parseDate(val) {
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'string') {
    const parts = val.split('.');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return null;
}

// POST /api/upload/:monthlyRecordId — upload Excel with meter readings for a monthly record
router.post('/:monthlyRecordId', authenticate, authorize('accountant', 'watercommittee'), upload.single('file'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { monthlyRecordId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate the monthly record exists and is editable
    const recResult = await client.query('SELECT * FROM monthly_records WHERE id = $1', [monthlyRecordId]);
    if (recResult.rows.length === 0) {
      return res.status(404).json({ error: 'Monthly record not found' });
    }
    const record = recResult.rows[0];
    if (record.status === 'reviewed' || record.status === 'final') {
      return res.status(400).json({ error: `Cannot import — record is in '${record.status}' status` });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const stats = { readingsImported: 0, blocksProcessed: 0, skipped: 0, errors: [], waterSources: 0, costItems: 0, commonAreas: 0 };

    await client.query('BEGIN');

    // Import summary sheet data if present
    const summarySheet = workbook.worksheets.find(s => s.name.toLowerCase().trim() === 'summary');
    if (summarySheet) {
      // Update period dates if available
      const startDateCell = summarySheet.getCell('B2').value;
      const endDateCell = summarySheet.getCell('C2').value;
      const startDate = parseDate(startDateCell);
      const endDate = parseDate(endDateCell);

      if (startDate && endDate) {
        await client.query(
          'UPDATE monthly_records SET period_start_date = $1, period_end_date = $2, updated_at = NOW() WHERE id = $3',
          [startDate, endDate, monthlyRecordId]
        );
      }

      // Import borewell readings
      const sourceNames = { 3: 'Ablock New Borewell', 4: 'A block Borewell', 5: 'C block Borewell', 6: 'D block Borewell' };
      for (const [row, sourceName] of Object.entries(sourceNames)) {
        const startReading = getCellResult(summarySheet.getCell(`B${row}`).value);
        const endReading = getCellResult(summarySheet.getCell(`C${row}`).value);
        if (startReading !== null && endReading !== null) {
          const sourceResult = await client.query('SELECT id FROM water_sources WHERE name ILIKE $1', [sourceName]);
          if (sourceResult.rows.length > 0) {
            const consumption = (endReading - startReading) * 1000;
            await client.query(`
              INSERT INTO water_source_readings (monthly_record_id, water_source_id, start_reading, end_reading, consumption_litres, total_cost)
              VALUES ($1, $2, $3, $4, $5, 0)
              ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5
            `, [monthlyRecordId, sourceResult.rows[0].id, startReading, endReading, consumption]);
            stats.waterSources++;
          }
        }
      }

      // Import tanker data
      const TANKER_CAPACITY = 12000;

      const tankerB = getCellResult(summarySheet.getCell('B7').value);
      const tankerC = getCellResult(summarySheet.getCell('C7').value);
      // Format detection: older Excel files store capacity (12000) in B and actual count in C.
      // Newer files store count directly in B.
      const tankerCount = (tankerB !== null && tankerB >= TANKER_CAPACITY && tankerC !== null)
        ? tankerC   // old format: capacity in B, actual count in C
        : tankerB;  // new format: count is in B

      const kaveriB = getCellResult(summarySheet.getCell('B8').value);
      const kaveriC = getCellResult(summarySheet.getCell('C8').value);
      const kaveriCount = (kaveriB !== null && kaveriB >= TANKER_CAPACITY && kaveriC !== null)
        ? kaveriC   // old format: capacity in B, actual count in C
        : kaveriB;  // new format: count is in B

      if (tankerCount !== null) {
        const sourceResult = await client.query("SELECT id, cost_per_unit FROM water_sources WHERE name = 'Regular Tanker'");
        if (sourceResult.rows.length > 0) {
          const sheetTotalCost = getCellResult(summarySheet.getCell('B22').value);
          const totalCost = sheetTotalCost ?? (tankerCount * parseFloat(sourceResult.rows[0].cost_per_unit || 2000));
          const costPerUnit = tankerCount > 0 ? totalCost / tankerCount : parseFloat(sourceResult.rows[0].cost_per_unit || 2000);
          await client.query(`
            INSERT INTO water_source_readings (monthly_record_id, water_source_id, unit_count, cost_per_unit, consumption_litres, total_cost)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET unit_count = $3, cost_per_unit = $4, consumption_litres = $5, total_cost = $6
          `, [monthlyRecordId, sourceResult.rows[0].id, tankerCount, costPerUnit, tankerCount * TANKER_CAPACITY, totalCost]);
          stats.waterSources++;
        }
      }

      if (kaveriCount !== null) {
        const sourceResult = await client.query("SELECT id, cost_per_unit FROM water_sources WHERE name = 'Kaveri Tanker'");
        if (sourceResult.rows.length > 0) {
          const sheetTotalCost = getCellResult(summarySheet.getCell('B23').value);
          const totalCost = sheetTotalCost ?? (kaveriCount * parseFloat(sourceResult.rows[0].cost_per_unit || 1400));
          const costPerUnit = kaveriCount > 0 ? totalCost / kaveriCount : parseFloat(sourceResult.rows[0].cost_per_unit || 1400);
          await client.query(`
            INSERT INTO water_source_readings (monthly_record_id, water_source_id, unit_count, cost_per_unit, consumption_litres, total_cost)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET unit_count = $3, cost_per_unit = $4, consumption_litres = $5, total_cost = $6
          `, [monthlyRecordId, sourceResult.rows[0].id, kaveriCount, costPerUnit, kaveriCount * TANKER_CAPACITY, totalCost]);
          stats.waterSources++;
        }
      }

      // Import cost items
      const costItems = { 20: 'Salt', 21: 'E Bill 1' };
      for (const [row, name] of Object.entries(costItems)) {
        const value = getCellResult(summarySheet.getCell(`B${row}`).value);
        if (value !== null) {
          await client.query(`
            INSERT INTO cost_items (monthly_record_id, item_name, amount) VALUES ($1, $2, $3)
            ON CONFLICT (monthly_record_id, item_name) DO UPDATE SET amount = $3
          `, [monthlyRecordId, name, value]);
          stats.costItems++;
        }
      }
    }

    // Import common area readings if consumption sheet exists
    const consumptionSheet = workbook.worksheets.find(s => s.name.toLowerCase().trim() === 'consumption');
    if (consumptionSheet) {
      for (let row = 2; row <= 10; row++) { // increased row limit slightly
        const areaName = consumptionSheet.getCell(`A${row}`).value;
        const startReading = getCellResult(consumptionSheet.getCell(`B${row}`).value);
        const endReading = getCellResult(consumptionSheet.getCell(`C${row}`).value);

        if (areaName && startReading !== null && endReading !== null) {
          const nameStr = String(areaName).trim();
          const token = nameStr.match(/^[A-Za-z]+\d+/)?.[0];
          let areaResult;
          if (token) {
            areaResult = await client.query("SELECT id FROM common_areas WHERE name ILIKE $1", [`${token}%`]);
          }
          if (!areaResult || areaResult.rows.length === 0) {
            areaResult = await client.query("SELECT id FROM common_areas WHERE LOWER(name) = LOWER($1)", [nameStr]);
          }
          if (areaResult && areaResult.rows.length > 0) {
            const consumption = (endReading - startReading) * 1000;
            await client.query(`
              INSERT INTO common_area_readings (monthly_record_id, common_area_id, start_reading, end_reading, consumption_litres, captured_by)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (monthly_record_id, common_area_id) DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5
            `, [monthlyRecordId, areaResult.rows[0].id, startReading, endReading, consumption, req.user.id]);
            stats.commonAreas++;
          } else {
            stats.skipped++;
            stats.errors.push(`Common area not found: "${nameStr}" at row ${row}`);
          }
        }
      }
    }

    // Get dates for readings
    const updatedRec = await client.query('SELECT * FROM monthly_records WHERE id = $1', [monthlyRecordId]);
    const startDate = updatedRec.rows[0].period_start_date;
    const endDate = updatedRec.rows[0].period_end_date;
    const midDate = updatedRec.rows[0].mid_period_date;

    // Detect mid-period date from A block sheet if not set
    let effectiveMidDate = midDate;
    if (!effectiveMidDate) {
      const aBlockSheet = workbook.worksheets.find(s => s.name.toLowerCase().trim() === 'a block');
      if (aBlockSheet) {
        const midCell = aBlockSheet.getCell('C2').value;
        effectiveMidDate = parseDate(midCell);
        if (effectiveMidDate) {
          await client.query('UPDATE monthly_records SET mid_period_date = $1 WHERE id = $2', [effectiveMidDate, monthlyRecordId]);
        }
      }
    }

    // Import block sheets
    for (const [blockName, blockId] of Object.entries(BLOCK_MAP)) {
      const sheet = workbook.worksheets.find(s => s.name.toLowerCase().trim() === blockName.toLowerCase().trim());
      if (!sheet) continue;

      let blockCount = 0;
      for (let row = 3; row <= sheet.rowCount; row++) {
        const flatNumberRaw = sheet.getCell(`A${row}`).value;
        if (!flatNumberRaw) continue;
        const flatNumber = String(flatNumberRaw).trim();
        if (flatNumber === '' || flatNumber.toLowerCase().includes('total')) continue;

        const flatResult = await client.query(
          'SELECT id FROM flats WHERE block_id = $1 AND flat_number = $2',
          [blockId, flatNumber]
        );
        if (flatResult.rows.length === 0) {
          stats.skipped++;
          stats.errors.push(`Flat ${flatNumber} not found in ${blockName}`);
          continue;
        }
        const flatId = flatResult.rows[0].id;

        const reading1 = getCellResult(sheet.getCell(`B${row}`).value);
        const reading2 = getCellResult(sheet.getCell(`C${row}`).value);
        const reading3 = getCellResult(sheet.getCell(`D${row}`).value);

        if (reading1 !== null) {
          await client.query(`
            INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence, captured_by)
            VALUES ($1, $2, $3, $4, 1, $5)
            ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO UPDATE SET reading_value = $4, captured_by = $5, updated_at = NOW()
          `, [monthlyRecordId, flatId, startDate, reading1, req.user.id]);
          blockCount++;
        }
        if (reading2 !== null) {
          await client.query(`
            INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence, captured_by)
            VALUES ($1, $2, $3, $4, 2, $5)
            ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO UPDATE SET reading_value = $4, captured_by = $5, updated_at = NOW()
          `, [monthlyRecordId, flatId, effectiveMidDate || endDate, reading2, req.user.id]);
          blockCount++;
        }
        if (reading3 !== null) {
          await client.query(`
            INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence, captured_by)
            VALUES ($1, $2, $3, $4, 3, $5)
            ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO UPDATE SET reading_value = $4, captured_by = $5, updated_at = NOW()
          `, [monthlyRecordId, flatId, endDate, reading3, req.user.id]);
          blockCount++;
        }
      }
      if (blockCount > 0) {
        stats.blocksProcessed++;
        stats.readingsImported += blockCount;
      }
    }

    await client.query('COMMIT');

    // Recalculate cost_per_litre, total_water_input, total_water_usage and flat billing
    // Done outside the import transaction to avoid long lock times, or we could include it.
    let calcResult = null;
    try {
      calcResult = await recalculateMonthlyRecord(monthlyRecordId);
    } catch (calcErr) {
      console.warn('Post-import recalculation warning:', calcErr.message);
    }

    // Audit log
    await db.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'excel_import', 'monthly_records', monthlyRecordId, JSON.stringify({
        filename: req.file.originalname,
        stats,
      })]
    );

    res.json({
      message: 'Import successful',
      stats,
      calculation: calcResult,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('Excel upload error:', err);
    res.status(500).json({ error: `Import failed: ${err.message}` });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
