const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const cache = require('../src/cache');
const { JWT_SECRET } = require('../src/middleware/auth');
const router = require('../src/routes/config');
const monthlyRouter = require('../src/routes/monthlyRecords');

async function invoke(router, path, method, body, user) {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  const req = { body, params: { id: 'month-id' }, headers: user ? { authorization: `Bearer ${jwt.sign(user, JWT_SECRET)}` } : {} };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  const run = async index => {
    if (index >= route.stack.length) return;
    let next;
    await route.stack[index].handle(req, res, () => { next = run(index + 1); });
    if (next) await next;
  };
  await run(0);
  return res;
}

const committee = { id: 'user-id', role: 'watercommittee' };
const valid = { name: '  Roof Rain Water  ', sourceType: 'rainwater' };

test('creation requires authentication and committee or superadmin access', async () => {
  assert.equal((await invoke(router, '/water-sources', 'post', valid)).statusCode, 401);
  for (const role of ['plumber', 'accountant', 'resident', 'guest']) {
    assert.equal((await invoke(router, '/water-sources', 'post', valid, { role })).statusCode, 403);
  }
});

test('invalid names, types, and tanker defaults are rejected before database access', async () => {
  for (const body of [
    { ...valid, name: ' ' }, { ...valid, name: 'a'.repeat(101) },
    { ...valid, sourceType: 'invalid' },
    { ...valid, sourceType: 'tanker', capacityLitres: 0, costPerUnit: 10 },
    { ...valid, sourceType: 'tanker', capacityLitres: 12000, costPerUnit: -1 },
    { ...valid, sourceType: 'tanker', capacityLitres: 12000, costPerUnit: '' },
  ]) assert.equal((await invoke(router, '/water-sources', 'post', body, committee)).statusCode, 400);
});

test('committee and superadmin can create sources; defaults, audit and cache are correct', async () => {
  const original = db.pool.connect;
  try {
    for (const user of [committee, { id: 'admin-id', role: 'accountant', isSuperadmin: true }]) {
      const calls = [];
      let released = false;
      db.pool.connect = async () => ({
        query: async (sql, params) => {
          calls.push({ sql, params });
          return { rows: sql.includes('INSERT INTO water_sources') ? [{ id: 'source-id', name: 'Roof Rain Water' }] : [] };
        }, release() { released = true; },
      });
      cache.set('water_sources', ['stale']);
      const res = await invoke(router, '/water-sources', 'post', valid, user);
      assert.equal(res.statusCode, 201);
      assert.deepEqual(calls.find(c => c.sql.includes('INSERT INTO water_sources')).params, ['Roof Rain Water', 'rainwater', null, null]);
      assert.ok(calls.some(c => c.sql.includes('INSERT INTO audit_log')));
      assert.equal(calls.at(-1).sql, 'COMMIT');
      assert.equal(cache.get('water_sources'), null);
      assert.equal(released, true);
    }
  } finally { db.pool.connect = original; }
});

test('duplicate names roll back and return a useful conflict', async () => {
  const original = db.pool.connect;
  const calls = [];
  db.pool.connect = async () => ({ query: async sql => {
    calls.push(sql);
    return { rows: sql.includes('SELECT id') ? [{ id: 'existing' }] : [] };
  }, release() {} });
  try {
    assert.equal((await invoke(router, '/water-sources', 'post', valid, committee)).statusCode, 409);
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.ok(calls.some(sql => sql.includes('LOWER(TRIM(name))')));
  } finally { db.pool.connect = original; }
});

test('Rain Water readings convert kilolitres to litres with no tanker charge', async () => {
  const original = db.query;
  let stored;
  db.query = async (sql, params) => {
    if (sql.includes('SELECT status')) return { rows: [{ status: 'draft', year: 2026, month: 10 }] };
    if (sql.includes('SELECT * FROM water_sources')) return { rows: [{ source_type: 'rainwater' }] };
    if (sql.includes('INSERT INTO water_source_readings')) stored = params;
    return { rows: [] };
  };
  try {
    const res = await invoke(monthlyRouter, '/:id/water-sources', 'put', {
      readings: [{ waterSourceId: 'rain-id', startReading: 10, endReading: 12.5 }],
    }, committee);
    assert.equal(res.statusCode, 200);
    assert.equal(stored[7], 2500);
    assert.equal(stored[8], 0);
    assert.equal(stored[5], null);
    assert.equal(stored[6], null);
  } finally { db.query = original; }
});

for (const [label, startReading, endReading, expected] of [
  ['numeric zero start', 0, 200, 200000],
  ['form values', '0', '200', 200000],
  ['blank start defaults to zero', '', '200', 200000],
  ['nonzero start', '50', '200', 150000],
  ['decimal readings', '0', '0.5', 500],
]) {
  test(`Rain Water: ${label} is saved and calculated correctly`, async () => {
    const original = db.query;
    let stored;
    db.query = async (sql, params) => {
      if (sql.includes('SELECT status')) return { rows: [{ status: 'draft', year: 2026, month: 10 }] };
      if (sql.includes('SELECT * FROM water_sources')) return { rows: [{ source_type: 'rainwater' }] };
      if (sql.includes('INSERT INTO water_source_readings')) stored = params;
      return { rows: [] };
    };
    try {
      const res = await invoke(monthlyRouter, '/:id/water-sources', 'put', {
        readings: [{ waterSourceId: 'rain-id', startReading, endReading, unitCount: 200 }],
      }, committee);
      assert.equal(res.statusCode, 200);
      assert.equal(stored[2], Number(startReading));
      assert.equal(stored[3], Number(endReading));
      assert.equal(stored[4], null, 'metered sources must not retain a legacy tanker count');
      assert.equal(stored[7], expected);
      assert.equal(stored[8], 0);
    } finally { db.query = original; }
  });
}

test('invalid metered readings are rejected without saving consumption', async () => {
  const original = db.query;
  db.query = async sql => {
    if (sql.includes('SELECT status')) return { rows: [{ status: 'draft' }] };
    if (sql.includes('SELECT * FROM water_sources')) return { rows: [{ source_type: 'rainwater' }] };
    assert.ok(!sql.includes('INSERT INTO water_source_readings'));
    return { rows: [] };
  };
  try {
    for (const [startReading, endReading] of [[-1, 200], [200, 100], [0, 'invalid']]) {
      const res = await invoke(monthlyRouter, '/:id/water-sources', 'put', {
        readings: [{ waterSourceId: 'rain-id', startReading, endReading }],
      }, committee);
      assert.equal(res.statusCode, 400);
    }
  } finally { db.query = original; }
});
