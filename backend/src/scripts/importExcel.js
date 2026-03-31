/**
 * Script to import existing Excel data into the database.
 * Run: node src/scripts/importExcel.js
 * Requires: XLSX files in the workspace root and DATABASE_URL env var
 */
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://waterapp:waterapp_secret@localhost:5432/waterapp',
});

const BLOCK_MAP = {
  'A block': 'a0000000-0000-0000-0000-000000000001',
  'B block ': 'a0000000-0000-0000-0000-000000000002',
  'C block': 'a0000000-0000-0000-0000-000000000003',
  'D block': 'a0000000-0000-0000-0000-000000000004',
  'E block': 'a0000000-0000-0000-0000-000000000005',
};

const FILES = [
  { file: 'nov2025.xlsx', year: 2025, month: 11 },
  { file: 'dec2025.xlsx', year: 2025, month: 12 },
  { file: 'jan2026.xlsx', year: 2026, month: 1 },
  { file: 'feb2026.xlsx', year: 2026, month: 2 },
];

async function importFile(fileInfo) {
  const filePath = path.join(__dirname, '..', '..', '..', fileInfo.file);
  console.log(`\nImporting ${fileInfo.file}...`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const summarySheet = workbook.getWorksheet('summary');
  if (!summarySheet) {
    console.log(`  No summary sheet found in ${fileInfo.file}, skipping`);
    return;
  }

  // Get period dates from summary
  const startDateCell = summarySheet.getCell('B2').value;
  const endDateCell = summarySheet.getCell('C2').value;

  // Parse dates (format: DD.MM.YYYY or Date object)
  function parseDate(val) {
    if (val instanceof Date) return val.toISOString().split('T')[0];
    if (typeof val === 'string') {
      const parts = val.split('.');
      if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return null;
  }

  const startDate = parseDate(startDateCell);
  let endDate = parseDate(endDateCell);

  if (!startDate) {
    console.log(`  Could not parse start date for ${fileInfo.file}, skipping`);
    return;
  }

  // If end date is missing, derive from year/month
  if (!endDate) {
    const lastDay = new Date(fileInfo.year, fileInfo.month, 0).getDate();
    endDate = `${fileInfo.year}-${String(fileInfo.month).padStart(2, '0')}-${lastDay}`;
    console.log(`  End date missing, using ${endDate}`);
  }

  // Get mid-period date from A block sheet
  const aBlockSheet = workbook.getWorksheet('A block');
  let midDate = null;
  if (aBlockSheet) {
    const midCell = aBlockSheet.getCell('C2').value;
    midDate = parseDate(midCell);
  }

  // Create monthly record
  const recordResult = await pool.query(`
    INSERT INTO monthly_records (year, month, period_start_date, period_end_date, mid_period_date, status)
    VALUES ($1, $2, $3, $4, $5, 'final')
    ON CONFLICT (year, month) DO UPDATE SET period_start_date = $3, period_end_date = $4, mid_period_date = $5
    RETURNING id
  `, [fileInfo.year, fileInfo.month, startDate, endDate, midDate]);
  const recordId = recordResult.rows[0].id;
  console.log(`  Created monthly record: ${recordId}`);

  // Import water source readings from summary
  const sourceNames = {
    'A3': 'Ablock New Borewell',
    'A4': 'A block Borewell',
    'A5': 'C block Borewell',
    'A6': 'D block Borewell',
  };

  for (const [cell, sourceName] of Object.entries(sourceNames)) {
    const row = parseInt(cell.substring(1));
    const startReading = summarySheet.getCell(`B${row}`).value;
    const endReading = summarySheet.getCell(`C${row}`).value;
    if (startReading !== null && endReading !== null) {
      const sourceResult = await pool.query('SELECT id FROM water_sources WHERE name = $1', [sourceName]);
      if (sourceResult.rows.length > 0) {
        const consumption = (parseFloat(endReading) - parseFloat(startReading)) * 1000;
        await pool.query(`
          INSERT INTO water_source_readings (monthly_record_id, water_source_id, start_reading, end_reading, consumption_litres, total_cost)
          VALUES ($1, $2, $3, $4, $5, 0)
          ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5
        `, [recordId, sourceResult.rows[0].id, startReading, endReading, consumption]);
      }
    }
  }

  // Import tanker data
  const tankerCount = summarySheet.getCell('B7').value;
  const kaveriCount = summarySheet.getCell('B8').value;

  if (tankerCount !== null) {
    const sourceResult = await pool.query("SELECT id FROM water_sources WHERE name = 'Regular Tanker'");
    if (sourceResult.rows.length > 0) {
      await pool.query(`
        INSERT INTO water_source_readings (monthly_record_id, water_source_id, unit_count, consumption_litres, total_cost)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET unit_count = $3, consumption_litres = $4, total_cost = $5
      `, [recordId, sourceResult.rows[0].id, tankerCount, tankerCount * 12000, tankerCount * 2000]);
    }
  }

  if (kaveriCount !== null) {
    const sourceResult = await pool.query("SELECT id FROM water_sources WHERE name = 'Kaveri Tanker'");
    if (sourceResult.rows.length > 0) {
      await pool.query(`
        INSERT INTO water_source_readings (monthly_record_id, water_source_id, unit_count, consumption_litres, total_cost)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (monthly_record_id, water_source_id) DO UPDATE SET unit_count = $3, consumption_litres = $4, total_cost = $5
      `, [recordId, sourceResult.rows[0].id, kaveriCount, kaveriCount * 12000, kaveriCount * 1400]);
    }
  }

  // Import cost items from summary
  const costItems = { 'B20': 'Salt', 'B21': 'E Bill 1' };
  for (const [cell, name] of Object.entries(costItems)) {
    const value = summarySheet.getCell(cell).value;
    if (value !== null && typeof value === 'number') {
      await pool.query(
        'INSERT INTO cost_items (monthly_record_id, item_name, amount) VALUES ($1, $2, $3)',
        [recordId, name, value]
      );
    }
  }

  // Import common area readings
  const consumptionSheet = workbook.getWorksheet('consumption');
  if (consumptionSheet) {
    for (let row = 2; row <= 7; row++) {
      const areaName = consumptionSheet.getCell(`A${row}`).value;
      const startReading = consumptionSheet.getCell(`B${row}`).value;
      const endReading = consumptionSheet.getCell(`C${row}`).value;

      if (areaName && startReading !== null && endReading !== null) {
        const areaResult = await pool.query('SELECT id FROM common_areas WHERE name = $1', [areaName]);
        if (areaResult.rows.length > 0) {
          const consumption = (parseFloat(endReading) - parseFloat(startReading)) * 1000;
          await pool.query(`
            INSERT INTO common_area_readings (monthly_record_id, common_area_id, start_reading, end_reading, consumption_litres)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (monthly_record_id, common_area_id) DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5
          `, [recordId, areaResult.rows[0].id, startReading, endReading, consumption]);
        }
      }
    }
  }

  // Import block meter readings and billing
  for (const [sheetName, blockId] of Object.entries(BLOCK_MAP)) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) continue;

    let flatCount = 0;
    for (let row = 3; row <= sheet.rowCount; row++) {
      const flatNumber = sheet.getCell(`A${row}`).value;
      if (!flatNumber || String(flatNumber).trim() === '' || String(flatNumber).toLowerCase().includes('total')) continue;

      const flatResult = await pool.query(
        'SELECT id FROM flats WHERE block_id = $1 AND flat_number = $2',
        [blockId, String(flatNumber)]
      );
      if (flatResult.rows.length === 0) continue;
      const flatId = flatResult.rows[0].id;

      const reading1 = sheet.getCell(`B${row}`).value;
      const reading2 = sheet.getCell(`C${row}`).value;
      const reading3 = sheet.getCell(`D${row}`).value;

      // Store meter readings
      if (reading1 !== null) {
        await pool.query(`
          INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence)
          VALUES ($1, $2, $3, $4, 1)
          ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO UPDATE SET reading_value = $4
        `, [recordId, flatId, startDate, parseFloat(reading1)]);
      }
      if (reading2 !== null) {
        await pool.query(`
          INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence)
          VALUES ($1, $2, $3, $4, 2)
          ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO UPDATE SET reading_value = $4
        `, [recordId, flatId, midDate || endDate, parseFloat(reading2)]);
      }
      if (reading3 !== null) {
        await pool.query(`
          INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence)
          VALUES ($1, $2, $3, $4, 3)
          ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO UPDATE SET reading_value = $4
        `, [recordId, flatId, endDate, parseFloat(reading3)]);
      }

      // Calculate and store billing
      if (reading1 !== null && reading3 !== null) {
        const startVal = parseFloat(reading1);
        const endVal = parseFloat(reading3);
        const consumption = (endVal - startVal) * 1000;

        const slab1Qty = Math.min(Math.max(consumption, 0), 15000);
        const slab2Qty = consumption > 20000 ? 5000 : Math.max(0, consumption - 15000);
        const slab3Qty = Math.max(0, consumption - 20000);

        await pool.query(`
          INSERT INTO flat_billing (monthly_record_id, flat_id, start_reading, end_reading, 
            consumption_litres, slab1_qty, slab2_qty, slab3_qty)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (monthly_record_id, flat_id) DO UPDATE SET 
            start_reading = $3, end_reading = $4, consumption_litres = $5,
            slab1_qty = $6, slab2_qty = $7, slab3_qty = $8
        `, [recordId, flatId, startVal, endVal, consumption, slab1Qty, slab2Qty, slab3Qty]);

        flatCount++;
      }
    }
    console.log(`  ${sheetName}: imported ${flatCount} flats`);
  }

  console.log(`  Done importing ${fileInfo.file}`);
}

async function main() {
  console.log('Starting Excel data import...');
  for (const fileInfo of FILES) {
    await importFile(fileInfo);
  }
  console.log('\nImport complete!');
  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
