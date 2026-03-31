const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const BLOCK_MAP = {
  'A block': 'a0000000-0000-0000-0000-000000000001',
  'B block ': 'a0000000-0000-0000-0000-000000000002',
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
  try {
    const { monthlyRecordId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate the monthly record exists and is editable
    const recResult = await db.query('SELECT * FROM monthly_records WHERE id = $1', [monthlyRecordId]);
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

    // Import summary sheet data if present
    const summarySheet = workbook.getWorksheet('summary');
    if (summarySheet) {
      // Update period dates if available
      const startDateCell = summarySheet.getCell('B2').value;
      const endDateCell = summarySheet.getCell('C2').value;
      const startDate = parseDate(startDateCell);
      const endDate = parseDate(endDateCell);

      if (startDate && endDate) {
        await db.query(
          'UPDATE monthly_records SET period_start_date = $1, period_end_date = $2, updated_at = NOW() WHERE id = $3',
          [startDate, endDate, monthlyRecordId]
        );
      }

      // Import borewell readings
      const sourceNames = { 3: 'Ablock New Borewell', 4: 'A block Borewell', 5: 'C block Borewell', 6: 'D block Borewell' };
      for (const [row, sourceName] of Object.entries(sourceNames)) {
        const startReading = summarySheet.getCell(`B${row}`).value;
        const endReading = summarySheet.getCell(`C${row}`).value;
        if (startReading !== null && endReading !== null) {
          const sourceResult = await db.query('SELECT id FROM water_sources WHERE name = $1', [sourceName]);
          if (sourceResult.rows.length > 0) {
            const consumption = (parseFloat(endReading) - parseFloat(startReading)) * 1000;
            await db.query(`
              INSERT INTO water_source_readings (monthly_record_id, water_source_id, start_reading, end_reading, consumption_litres, total_cost)
              VALUES ($1, $2, $3, $4, $5, 0)
              ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5
            `, [monthlyRecordId, sourceResult.rows[0].id, startReading, endReading, consumption]);
            stats.waterSources++;
          }
        }
      }

      // Import tanker data
      const tankerCount = summarySheet.getCell('B7').value;
      const kaveriCount = summarySheet.getCell('B8').value;

      if (tankerCount !== null && typeof tankerCount === 'number') {
        const sourceResult = await db.query("SELECT id, cost_per_unit FROM water_sources WHERE name = 'Regular Tanker'");
        if (sourceResult.rows.length > 0) {
          const costPerUnit = parseFloat(sourceResult.rows[0].cost_per_unit || 2000);
          await db.query(`
            INSERT INTO water_source_readings (monthly_record_id, water_source_id, unit_count, cost_per_unit, consumption_litres, total_cost)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET unit_count = $3, cost_per_unit = $4, consumption_litres = $5, total_cost = $6
          `, [monthlyRecordId, sourceResult.rows[0].id, tankerCount, costPerUnit, tankerCount * 12000, tankerCount * costPerUnit]);
          stats.waterSources++;
        }
      }

      if (kaveriCount !== null && typeof kaveriCount === 'number') {
        const sourceResult = await db.query("SELECT id, cost_per_unit FROM water_sources WHERE name = 'Kaveri Tanker'");
        if (sourceResult.rows.length > 0) {
          const costPerUnit = parseFloat(sourceResult.rows[0].cost_per_unit || 1400);
          await db.query(`
            INSERT INTO water_source_readings (monthly_record_id, water_source_id, unit_count, cost_per_unit, consumption_litres, total_cost)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET unit_count = $3, cost_per_unit = $4, consumption_litres = $5, total_cost = $6
          `, [monthlyRecordId, sourceResult.rows[0].id, kaveriCount, costPerUnit, kaveriCount * 12000, kaveriCount * costPerUnit]);
          stats.waterSources++;
        }
      }

      // Import cost items
      const costItems = { 20: 'Salt', 21: 'E Bill 1' };
      for (const [row, name] of Object.entries(costItems)) {
        const value = summarySheet.getCell(`B${row}`).value;
        if (value !== null && typeof value === 'number') {
          // Delete existing and re-insert to avoid duplicates
          await db.query('DELETE FROM cost_items WHERE monthly_record_id = $1 AND item_name = $2', [monthlyRecordId, name]);
          await db.query('INSERT INTO cost_items (monthly_record_id, item_name, amount) VALUES ($1, $2, $3)', [monthlyRecordId, name, value]);
          stats.costItems++;
        }
      }
    }

    // Import common area readings if consumption sheet exists
    const consumptionSheet = workbook.getWorksheet('consumption');
    if (consumptionSheet) {
      for (let row = 2; row <= 7; row++) {
        const areaName = consumptionSheet.getCell(`A${row}`).value;
        const startReading = consumptionSheet.getCell(`B${row}`).value;
        const endReading = consumptionSheet.getCell(`C${row}`).value;

        if (areaName && startReading !== null && endReading !== null) {
          const areaResult = await db.query('SELECT id FROM common_areas WHERE name = $1', [String(areaName)]);
          if (areaResult.rows.length > 0) {
            const consumption = (parseFloat(endReading) - parseFloat(startReading)) * 1000;
            await db.query(`
              INSERT INTO common_area_readings (monthly_record_id, common_area_id, start_reading, end_reading, consumption_litres, captured_by)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (monthly_record_id, common_area_id) DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5
            `, [monthlyRecordId, areaResult.rows[0].id, startReading, endReading, consumption, req.user.id]);
            stats.commonAreas++;
          }
        }
      }
    }

    // Get dates for readings
    const updatedRec = await db.query('SELECT * FROM monthly_records WHERE id = $1', [monthlyRecordId]);
    const startDate = updatedRec.rows[0].period_start_date;
    const endDate = updatedRec.rows[0].period_end_date;
    const midDate = updatedRec.rows[0].mid_period_date;

    // Detect mid-period date from A block sheet if not set
    let effectiveMidDate = midDate;
    if (!effectiveMidDate) {
      const aBlockSheet = workbook.getWorksheet('A block');
      if (aBlockSheet) {
        const midCell = aBlockSheet.getCell('C2').value;
        effectiveMidDate = parseDate(midCell);
        if (effectiveMidDate) {
          await db.query('UPDATE monthly_records SET mid_period_date = $1 WHERE id = $2', [effectiveMidDate, monthlyRecordId]);
        }
      }
    }

    // Import block sheets
    for (const [sheetName, blockId] of Object.entries(BLOCK_MAP)) {
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) continue;

      let blockCount = 0;
      for (let row = 3; row <= sheet.rowCount; row++) {
        const flatNumber = sheet.getCell(`A${row}`).value;
        if (!flatNumber || String(flatNumber).trim() === '' || String(flatNumber).toLowerCase().includes('total')) continue;

        const flatResult = await db.query(
          'SELECT id FROM flats WHERE block_id = $1 AND flat_number = $2',
          [blockId, String(flatNumber).trim()]
        );
        if (flatResult.rows.length === 0) {
          stats.skipped++;
          stats.errors.push(`Flat ${flatNumber} not found in ${sheetName}`);
          continue;
        }
        const flatId = flatResult.rows[0].id;

        const reading1 = sheet.getCell(`B${row}`).value;
        const reading2 = sheet.getCell(`C${row}`).value;
        const reading3 = sheet.getCell(`D${row}`).value;

        if (reading1 !== null && reading1 !== '' && typeof reading1 === 'number') {
          await db.query(`
            INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence, captured_by)
            VALUES ($1, $2, $3, $4, 1, $5)
            ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO UPDATE SET reading_value = $4, captured_by = $5, updated_at = NOW()
          `, [monthlyRecordId, flatId, startDate, parseFloat(reading1), req.user.id]);
          blockCount++;
        }
        if (reading2 !== null && reading2 !== '' && typeof reading2 === 'number') {
          await db.query(`
            INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence, captured_by)
            VALUES ($1, $2, $3, $4, 2, $5)
            ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO UPDATE SET reading_value = $4, captured_by = $5, updated_at = NOW()
          `, [monthlyRecordId, flatId, effectiveMidDate || endDate, parseFloat(reading2), req.user.id]);
          blockCount++;
        }
        if (reading3 !== null && reading3 !== '' && typeof reading3 === 'number') {
          await db.query(`
            INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence, captured_by)
            VALUES ($1, $2, $3, $4, 3, $5)
            ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO UPDATE SET reading_value = $4, captured_by = $5, updated_at = NOW()
          `, [monthlyRecordId, flatId, endDate, parseFloat(reading3), req.user.id]);
          blockCount++;
        }
      }
      if (blockCount > 0) {
        stats.blocksProcessed++;
        stats.readingsImported += blockCount;
      }
    }

    // Audit log
    await db.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'excel_import', 'monthly_records', monthlyRecordId, JSON.stringify({
        filename: req.file.originalname,
        readings: stats.readingsImported,
        blocks: stats.blocksProcessed,
        waterSources: stats.waterSources,
        costItems: stats.costItems,
        commonAreas: stats.commonAreas,
      })]
    );

    res.json({
      message: 'Import successful',
      stats,
    });
  } catch (err) {
    console.error('Excel upload error:', err);
    res.status(500).json({ error: `Import failed: ${err.message}` });
  }
});

module.exports = router;
