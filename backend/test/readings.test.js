const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const readingsRouter = require('../src/routes/readings');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
}

function routeHandler(path, method) {
  const layer = readingsRouter.stack.find(item => item.route?.path === path && item.route.methods[method]);
  return layer.route.stack.at(-1).handle;
}

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

test('only water committee members and admins can submit a starting reading', async () => {
  const handler = routeHandler('/', 'post');
  const reading = {
    monthlyRecordId: 'month-id', flatId: 'flat-id', readingDate: '2026-11-01', readingValue: 0, readingSequence: 1,
  };

  await withQueryStub(async sql => {
    if (sql.includes('SELECT status')) return { rows: [{ status: 'draft' }] };
    throw new Error(`Unexpected query: ${sql}`);
  }, async () => {
    const res = response();
    await handler({ body: { readings: [reading] }, user: { role: 'accountant' } }, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /Only admins and water committee/);
  });
});

test('water committee can submit a starting reading of zero', async () => {
  const handler = routeHandler('/', 'post');
  const calls = [];
  await withQueryStub(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT status')) return { rows: [{ status: 'draft' }] };
    if (sql.includes('reading_sequence <')) return { rows: [] };
    if (sql.includes('JOIN monthly_records current_month')) return { rows: [] };
    if (sql.includes('SELECT id, reading_value')) return { rows: [] };
    if (sql.includes('SELECT flat_number')) return { rows: [{ flat_number: 'A101' }] };
    if (sql.includes('INSERT INTO meter_readings')) return { rows: [{ id: 'reading-id', reading_value: 0 }] };
    if (sql.includes('INSERT INTO audit_log')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  }, async () => {
    const res = response();
    await handler({
      body: { readings: [{ monthlyRecordId: 'month-id', flatId: 'flat-id', readingDate: '2026-11-01', readingValue: 0, readingSequence: 1 }] },
      user: { id: 'committee-id', role: 'watercommittee' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.results[0].reading_value, 0);
  });
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO meter_readings')));
});

test('accountants cannot update an existing starting reading', async () => {
  const handler = routeHandler('/:id', 'put');
  await withQueryStub(async sql => {
    if (sql.includes('JOIN monthly_records')) return { rows: [{ id: 'reading-id', reading_sequence: 1, record_status: 'draft' }] };
    throw new Error(`Unexpected query: ${sql}`);
  }, async () => {
    const res = response();
    await handler({ params: { id: 'reading-id' }, body: { readingValue: 42 }, user: { role: 'accountant' } }, res);
    assert.equal(res.statusCode, 403);
  });
});
