const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const ExcelJS = require('exceljs');
const db = require('../src/db');
const router = require('../src/routes/export');

for (const hasReading of [true, false]) {
  test(`Excel summary includes Rain Water ${hasReading ? 'with zero start and consumption' : 'without readings'}`, async () => {
    const original = db.query;
    const borewells = ['Ablock New Borewell', 'A block Borewell', 'C block Borewell', 'D block Borewell'];
    db.query = async sql => {
      if (sql.includes('SELECT * FROM monthly_records')) return { rows: [{ month: 9, year: 2026, total_water_input: 200000 }] };
      if (sql.includes("ws.source_type <> 'tanker'")) return { rows: [
        ...borewells.map(name => ({ name, start_reading: null, end_reading: null, consumption_litres: null })),
        { name: 'Rain Water', start_reading: hasReading ? '0' : null, end_reading: hasReading ? '200' : null, consumption_litres: hasReading ? '200000' : null },
        { name: 'Roof Collection', start_reading: '10', end_reading: '11', consumption_litres: '1000' },
      ] };
      if (sql.includes("ws.source_type = 'tanker'")) return { rows: ['Kaveri Tanker', 'Regular Tanker', 'Third Tanker'].map(name => ({ name, capacity_litres: '12000', unit_count: '1', consumption_litres: '12000', total_cost: '1000' })) };
      if (sql.includes('COALESCE(SUM')) return { rows: [{ total: '0' }] };
      return { rows: [] };
    };
    const chunks = [];
    const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    res.setHeader = () => {};
    res.status = code => { throw new Error(`Export failed: ${code}`); };
    try {
      const route = router.stack.find(layer => layer.route?.path === '/:monthlyRecordId').route;
      await route.stack.at(-1).handle({ params: { monthlyRecordId: 'month-id' } }, res);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.concat(chunks));
      const summary = workbook.getWorksheet('Summary');
      const rows = [];
      summary.eachRow(row => rows.push(row.values.slice(1)));
      assert.deepEqual(rows.find(row => row[0] === 'Rain Water'), hasReading ? ['Rain Water', 0, 200, 200000] : ['Rain Water', '', '', '']);
      assert.deepEqual(rows.find(row => row[0] === 'Roof Collection'), ['Roof Collection', 10, 11, 1000]);
      assert.deepEqual(rows.find(row => row[0] === 'Third Tanker'), ['Third Tanker', 12000, 1, 12000]);
      assert.equal(rows.filter(row => row[0] === 'Rain Water').length, 1);
      assert.ok(rows.findIndex(row => row[0] === 'Rain Water') < rows.findIndex(row => row[0] === 'TOTAL in Ltr'));
      borewells.forEach((name, index) => assert.equal(summary.getCell(`A${index + 3}`).value, name));
      assert.equal(summary.getCell('A7').value, 'Kaveri Tanker');
      assert.equal(summary.getCell('A8').value, 'Regular Tanker');
    } finally { db.query = original; }
  });
}
