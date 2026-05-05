const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { recalculateMonthlyRecord } = require('../helpers/recalculate');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function uploadSingleExcel(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum allowed size is 10MB.' });
      }
      return res.status(400).json({ error: `Upload validation failed: ${err.message}` });
    }

    return res.status(400).json({ error: `Upload failed: ${err.message}` });
  });
}

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

// POST /api/upload/:monthlyRecordId/preview — parse Excel and return preview data WITHOUT writing to DB
router.post('/:monthlyRecordId/preview', authenticate, authorize('accountant', 'watercommittee'), uploadSingleExcel, async (req, res) => {
  try {
    const { monthlyRecordId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const recResult = await db.query('SELECT * FROM monthly_records WHERE id = $1', [monthlyRecordId]);
    if (recResult.rows.length === 0) return res.status(404).json({ error: 'Monthly record not found' });
    const record = recResult.rows[0];
    if (record.status === 'reviewed' || record.status === 'final') {
      return res.status(400).json({ error: `Cannot import — record is in '${record.status}' status` });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const TANKER_CAPACITY = 12000;
    const preview = { periods: {}, waterSources: [], costItems: [], commonAreas: [], blockReadings: {}, errors: [], stats: { readingsFound: 0, blocksFound: 0 } };

    const summarySheet = workbook.getWorksheet('summary');
    if (summarySheet) {
      const startDate = parseDate(summarySheet.getCell('B2').value);
      const endDate = parseDate(summarySheet.getCell('C2').value);
      preview.periods = { startDate, endDate };

      const sourceNames = { 3: 'Ablock New Borewell', 4: 'A block Borewell', 5: 'C block Borewell', 6: 'D block Borewell' };
      for (const [row, sourceName] of Object.entries(sourceNames)) {
        const startReading = summarySheet.getCell(`B${row}`).value;
        const endReading = summarySheet.getCell(`C${row}`).value;
        if (startReading !== null && endReading !== null && typeof startReading === 'number' && typeof endReading === 'number') {
          preview.waterSources.push({ name: sourceName, type: 'borewell', startReading, endReading, consumptionLitres: (endReading - startReading) * 1000 });
        }
      }

      // Read tanker rows 7–8 by label (column A) to avoid mix-ups if row order changes.
      // Scan cost section dynamically for "...tanker bill" rows instead of hardcoding B22/B23.
      const tankerCostByLabel = {};
      for (let r = 9; r <= summarySheet.rowCount; r++) {
        const lbl = summarySheet.getCell(`A${r}`).value;
        const val = getCellResult(summarySheet.getCell(`B${r}`).value);
        if (lbl && typeof lbl === 'string' && val !== null) {
          tankerCostByLabel[lbl.toLowerCase().trim()] = val;
        }
      }
      const getTankerCostPreview = (keyword) => {
        for (const [k, v] of Object.entries(tankerCostByLabel)) {
          if (k.includes('tanker') && k.includes(keyword)) return v;
        }
        return null;
      };

      let regularCount = null, kaveriCount = null;
      for (let r = 7; r <= 8; r++) {
        const label = summarySheet.getCell(`A${r}`).value;
        const bVal = summarySheet.getCell(`B${r}`).value;
        const cVal = summarySheet.getCell(`C${r}`).value;
        const count = (typeof bVal === 'number' && bVal >= TANKER_CAPACITY && typeof cVal === 'number') ? cVal : bVal;
        if (!label || typeof label !== 'string') continue;
        if (/kaveri/i.test(label)) {
          kaveriCount = count;
        } else if (/tanker|regular/i.test(label)) {
          regularCount = count;
        }
      }

      if (regularCount !== null && typeof regularCount === 'number') {
        const sheetTotalCost = getTankerCostPreview('water') ?? getTankerCostPreview('regular');
        const totalCost = sheetTotalCost ?? (regularCount * 2000);
        preview.waterSources.push({ name: 'Regular Tanker', type: 'tanker', unitCount: regularCount, costPerUnit: regularCount > 0 ? totalCost / regularCount : 2000, totalCost, consumptionLitres: regularCount * TANKER_CAPACITY });
      }
      if (kaveriCount !== null && typeof kaveriCount === 'number') {
        const sheetTotalCost = getTankerCostPreview('kaveri');
        const totalCost = sheetTotalCost ?? (kaveriCount * 1400);
        preview.waterSources.push({ name: 'Kaveri Tanker', type: 'tanker', unitCount: kaveriCount, costPerUnit: kaveriCount > 0 ? totalCost / kaveriCount : 1400, totalCost, consumptionLitres: kaveriCount * TANKER_CAPACITY });
      }

      // Dynamically scan all rows after the water sources section for cost items.
      // Rows 1-8 are headers/sources. Skip structural labels; pick up any row where
      // column A is a recognisable non-structural text and column B is a plain number.
      const SKIP_LABELS = /total|input|usage|water|borewell|tanker|kaveri|consumption|items|cost per|block|common|^[a-e]\s+block/i;
      for (let row = 9; row <= summarySheet.rowCount; row++) {
        const label = summarySheet.getCell(`A${row}`).value;
        const val = summarySheet.getCell(`B${row}`).value;
        if (!label || typeof label !== 'string') continue;
        const labelStr = label.trim();
        if (!labelStr || SKIP_LABELS.test(labelStr)) continue;
        if (typeof val === 'number') preview.costItems.push({ name: labelStr, amount: val });
      }
    }

    const consumptionSheet = workbook.getWorksheet('consumption');
    if (consumptionSheet) {
      for (let row = 2; row <= 7; row++) {
        const areaName = consumptionSheet.getCell(`A${row}`).value;
        const startReading = consumptionSheet.getCell(`B${row}`).value;
        const endReading = consumptionSheet.getCell(`C${row}`).value;
        if (areaName && startReading !== null && endReading !== null) {
          preview.commonAreas.push({ name: String(areaName).trim(), startReading, endReading, consumptionLitres: (parseFloat(endReading) - parseFloat(startReading)) * 1000 });
        }
      }
    }

    for (const sheetName of Object.keys(BLOCK_MAP)) {
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) continue;
      const readings = [];
      for (let row = 3; row <= sheet.rowCount; row++) {
        const flatNumber = sheet.getCell(`A${row}`).value;
        if (!flatNumber || String(flatNumber).trim() === '' || String(flatNumber).toLowerCase().includes('total')) continue;
        const reading1 = sheet.getCell(`B${row}`).value;
        const reading2 = sheet.getCell(`C${row}`).value;
        const reading3 = sheet.getCell(`D${row}`).value;
        const r1 = typeof reading1 === 'number' ? reading1 : null;
        const r2 = typeof reading2 === 'number' ? reading2 : null;
        const r3 = typeof reading3 === 'number' ? reading3 : null;
        if (r1 !== null || r2 !== null || r3 !== null) {
          readings.push({ flatNumber: String(flatNumber).trim(), reading1: r1, reading2: r2, reading3: r3 });
          preview.stats.readingsFound++;
        }
      }
      if (readings.length > 0) {
        preview.blockReadings[sheetName.trim()] = readings;
        preview.stats.blocksFound++;
      }
    }

    // Count existing readings that will be overwritten
    const existingResult = await db.query('SELECT COUNT(*) FROM meter_readings WHERE monthly_record_id = $1', [monthlyRecordId]);
    preview.stats.existingReadings = parseInt(existingResult.rows[0].count, 10);

    res.json(preview);
  } catch (err) {
    console.error('Excel preview error:', err);
    res.status(500).json({ error: `Preview failed: ${err.message}` });
  }
});

// POST /api/upload/:monthlyRecordId — upload Excel with meter readings for a monthly record
router.post('/:monthlyRecordId', authenticate, authorize('accountant', 'watercommittee'), uploadSingleExcel, async (req, res) => {
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

    await client.query('BEGIN');

    // Remove all existing data for this monthly record before import
    await client.query('DELETE FROM meter_readings WHERE monthly_record_id = $1', [monthlyRecordId]);
    await client.query('DELETE FROM flat_billing WHERE monthly_record_id = $1', [monthlyRecordId]);
    await client.query('DELETE FROM common_area_readings WHERE monthly_record_id = $1', [monthlyRecordId]);
    await client.query('DELETE FROM water_source_readings WHERE monthly_record_id = $1', [monthlyRecordId]);
    await client.query('DELETE FROM cost_items WHERE monthly_record_id = $1', [monthlyRecordId]);

    const stats = { readingsImported: 0, blocksProcessed: 0, skipped: 0, errors: [], waterSources: 0, costItems: 0, commonAreas: 0 };

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
      const tankerCostByLabel = {};
      for (let r = 9; r <= summarySheet.rowCount; r++) {
        const lbl = summarySheet.getCell(`A${r}`).value;
        const val = getCellResult(summarySheet.getCell(`B${r}`).value);
        if (lbl && typeof lbl === 'string' && val !== null) {
          tankerCostByLabel[lbl.toLowerCase().trim()] = val;
        }
      }
      const getTankerCost = (keyword) => {
        for (const [k, v] of Object.entries(tankerCostByLabel)) {
          if (k.includes('tanker') && k.includes(keyword)) return v;
        }
        return null;
      };

      // Detect tanker counts by label (rows 7–8) — handles row-order changes and old/new Excel formats
      let regularCount = null, kaveriCount = null;
      for (let r = 7; r <= 8; r++) {
        const label = summarySheet.getCell(`A${r}`).value;
        const bVal = summarySheet.getCell(`B${r}`).value;
        const cVal = summarySheet.getCell(`C${r}`).value;
        const count = (typeof bVal === 'number' && bVal >= TANKER_CAPACITY && typeof cVal === 'number') ? cVal : bVal;
        if (!label || typeof label !== 'string') continue;
        if (/kaveri/i.test(label)) {
          kaveriCount = count;
        } else if (/tanker|regular/i.test(label)) {
          regularCount = count;
        }
      }

      if (regularCount !== null && typeof regularCount === 'number') {
        const sourceResult = await client.query("SELECT id, cost_per_unit FROM water_sources WHERE name = 'Regular Tanker'");
        if (sourceResult.rows.length > 0) {
          const sheetTotalCost = getTankerCost('water') ?? getTankerCost('regular');
          const totalCost = sheetTotalCost ?? (regularCount * parseFloat(sourceResult.rows[0].cost_per_unit || 2000));
          const costPerUnit = regularCount > 0 ? totalCost / regularCount : parseFloat(sourceResult.rows[0].cost_per_unit || 2000);
          await client.query(`
            INSERT INTO water_source_readings (monthly_record_id, water_source_id, unit_count, cost_per_unit, consumption_litres, total_cost)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET unit_count = $3, cost_per_unit = $4, consumption_litres = $5, total_cost = $6
          `, [monthlyRecordId, sourceResult.rows[0].id, regularCount, costPerUnit, regularCount * TANKER_CAPACITY, totalCost]);
          stats.waterSources++;
        }
      }

      if (kaveriCount !== null && typeof kaveriCount === 'number') {
        const sourceResult = await client.query("SELECT id, cost_per_unit FROM water_sources WHERE name = 'Kaveri Tanker'");
        if (sourceResult.rows.length > 0) {
          const sheetTotalCost = getTankerCost('kaveri');
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

      // Dynamically scan all rows after the water sources section for cost items
      const SKIP_LABELS = /total|input|usage|water|borewell|tanker|kaveri|consumption|items|cost per|block|common|^[a-e]\s+block/i;
      for (let row = 9; row <= summarySheet.rowCount; row++) {
        const label = summarySheet.getCell(`A${row}`).value;
        const value = summarySheet.getCell(`B${row}`).value;
        if (!label || typeof label !== 'string') continue;
        const labelStr = label.trim();
        if (!labelStr || SKIP_LABELS.test(labelStr)) continue;
        if (typeof value === 'number') {
          await client.query(`
            INSERT INTO cost_items (monthly_record_id, item_name, amount) VALUES ($1, $2, $3)
            ON CONFLICT (monthly_record_id, item_name) DO UPDATE SET amount = $3
          `, [monthlyRecordId, labelStr, value]);
          stats.costItems++;
        }
      }
    }

    // Import common area readings if consumption sheet exists
    const consumptionSheet = workbook.worksheets.find(s => s.name.toLowerCase().trim() === 'consumption');
    if (consumptionSheet) {
      // Pre-fetch all common areas for faster lookup
      const areasResult = await client.query('SELECT id, name FROM common_areas');
      const areas = areasResult.rows;

      for (let row = 2; row <= 10; row++) {
        const areaName = consumptionSheet.getCell(`A${row}`).value;
        const startReading = getCellResult(consumptionSheet.getCell(`B${row}`).value);
        const endReading = getCellResult(consumptionSheet.getCell(`C${row}`).value);

        if (areaName && startReading !== null && endReading !== null) {
          const nameStr = String(areaName).trim().toLowerCase();
          const token = nameStr.match(/^[a-z]+\d+/)?.[0];

          let areaId = null;
          if (token) {
            const match = areas.find(a => a.name.toLowerCase().startsWith(token));
            if (match) areaId = match.id;
          }
          if (!areaId) {
            const match = areas.find(a => a.name.toLowerCase() === nameStr);
            if (match) areaId = match.id;
          }

          if (areaId) {
            const consumption = (endReading - startReading) * 1000;
            await client.query(`
              INSERT INTO common_area_readings (monthly_record_id, common_area_id, start_reading, end_reading, consumption_litres, captured_by)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (monthly_record_id, common_area_id) DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5
            `, [monthlyRecordId, areaId, startReading, endReading, consumption, req.user.id]);
            stats.commonAreas++;
          } else {
            stats.skipped++;
            stats.errors.push(`Common area not found: "${areaName}" at row ${row}`);
          }
        }
      }
    }

    // Re-fetch dates to pick up any updates written from the Excel summary sheet
    const updatedRec = await client.query('SELECT * FROM monthly_records WHERE id = $1', [monthlyRecordId]);
    const startDate = updatedRec.rows[0].period_start_date;
    const endDate = updatedRec.rows[0].period_end_date;
    const midDate = updatedRec.rows[0].mid_period_date;

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

    // Import block sheets with case-insensitive sheet matching and optimized flat lookups
    for (const [blockName, blockId] of Object.entries(BLOCK_MAP)) {
      const sheet = workbook.worksheets.find(s => s.name.toLowerCase().trim() === blockName.toLowerCase().trim());
      if (!sheet) continue;

      // Pre-fetch all flats for this block
      const flatsResult = await client.query('SELECT id, flat_number FROM flats WHERE block_id = $1', [blockId]);
      const flatMap = {};
      flatsResult.rows.forEach(f => { flatMap[String(f.flat_number).trim()] = f.id; });

      let blockCount = 0;
      for (let row = 3; row <= sheet.rowCount; row++) {
        const flatNumberRaw = sheet.getCell(`A${row}`).value;
        if (!flatNumberRaw) continue;
        const flatNumber = String(flatNumberRaw).trim();
        if (flatNumber === '' || flatNumber.toLowerCase().includes('total')) continue;

        const flatId = flatMap[String(flatNumber).trim()];
        if (!flatId) {
          stats.skipped++;
          stats.errors.push(`Flat ${flatNumber} not found in ${blockName}`);
          continue;
        }

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

    let calcResult = null;
    try {
      calcResult = await recalculateMonthlyRecord(monthlyRecordId, client);
    } catch (calcErr) {
      console.warn('Post-import recalculation warning:', calcErr.message);
    }

    await client.query(`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values) VALUES ($1, $2, $3, $4, $5)
    `, [req.user.id, 'excel_import', 'monthly_records', monthlyRecordId, JSON.stringify({
      filename: req.file.originalname,
      readings: stats.readingsImported,
      blocks: stats.blocksProcessed,
      waterSources: stats.waterSources,
      costItems: stats.costItems,
      commonAreas: stats.commonAreas,
    })]);

    await client.query('COMMIT');
    res.json({ message: 'Import successful', stats, calculation: calcResult });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Excel upload error:', err);
    res.status(500).json({ error: `Import failed: ${err.message}` });
  } finally {
    client.release();
  }
});

module.exports = router;
