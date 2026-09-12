const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const readingsRouter = require('../src/routes/readings');

function withQueryStub(stub, fn) {
  const originalQuery = db.query;
  db.query = stub;
  return Promise.resolve()
    .then(fn)
    .finally(() => { db.query = originalQuery; });
}

test('warns when the first current-month reading is more than 50% above last month', async () => {
  const calls = [];
  await withQueryStub(async (sql, params) => {
    calls.push({ sql, params });
    if (calls.length === 1) return { rows: [] }; // no earlier reading this month
    if (calls.length === 2) return { rows: [{ reading_value: '100' }] };
    return { rows: [{ config_value: '50' }] };
  }, async () => {
    const result = await readingsRouter.detectWarnings(42, 7, 151, 1);

    assert.equal(result.hasWarning, true);
    assert.match(result.warningMessage, /last month's reading/);
    assert.match(result.warningMessage, /51\.0%/);
  });

  assert.match(calls[1].sql, /JOIN monthly_records current_month/);
  assert.match(calls[1].sql, /mo\.month < current_month\.month/);
});

test('does not warn at exactly the configured 50% cross-month threshold', async () => {
  let call = 0;
  await withQueryStub(async () => {
    call += 1;
    if (call === 1) return { rows: [] };
    if (call === 2) return { rows: [{ reading_value: '100' }] };
    return { rows: [{ config_value: '50' }] };
  }, async () => {
    const result = await readingsRouter.detectWarnings(42, 7, 150, 1);

    assert.deepEqual(result, { hasWarning: false, warningMessage: null });
  });
});
