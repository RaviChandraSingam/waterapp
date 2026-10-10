const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const cache = require('../cache');

const router = express.Router();

// GET /api/config
router.get('/', authenticate, async (req, res) => {
  try {
    const cached = cache.get('billing_config');
    if (cached) return res.json(cached);
    const result = await db.query('SELECT * FROM billing_config ORDER BY config_key');
    cache.set('billing_config', result.rows);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/config/:key
router.put('/:key', authenticate, authorize('watercommittee'), async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'value is required' });
    }

    const result = await db.query(`
      UPDATE billing_config SET config_value = $1, updated_by = $2, updated_at = NOW()
      WHERE config_key = $3 RETURNING *
    `, [value, req.user.id, req.params.key]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Config key not found' });
    }

    // Audit log
    await db.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'update_config', 'billing_config', result.rows[0].id, JSON.stringify({ key: req.params.key, value })]
    );

    cache.invalidate('billing_config');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/config/water-sources
router.get('/water-sources', authenticate, async (req, res) => {
  try {
    const cached = cache.get('water_sources');
    if (cached) return res.json(cached);
    const result = await db.query('SELECT * FROM water_sources WHERE is_active = true ORDER BY name');
    cache.set('water_sources', result.rows);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/config/water-sources
router.post('/water-sources', authenticate, authorize('watercommittee'), async (req, res) => {
  const { name, sourceType, capacityLitres, costPerUnit } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    return res.status(400).json({ error: 'Water source name must contain 1–100 characters' });
  }
  if (!['borewell', 'tanker', 'rainwater', 'metered'].includes(sourceType)) {
    return res.status(400).json({ error: 'Invalid water source type' });
  }
  const capacity = Number(capacityLitres);
  const cost = Number(costPerUnit);
  if (sourceType === 'tanker' && (
    !['string', 'number'].includes(typeof capacityLitres) || !Number.isFinite(capacity) || capacity <= 0 ||
    !['string', 'number'].includes(typeof costPerUnit) || String(costPerUnit).trim() === '' || !Number.isFinite(cost) || cost < 0
  )) {
    return res.status(400).json({ error: 'Tankers require a positive capacity and a non-negative cost per unit' });
  }
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    // Serialize creation so concurrent requests cannot create duplicate names.
    await client.query('LOCK TABLE water_sources IN SHARE ROW EXCLUSIVE MODE');
    const existing = await client.query('SELECT id FROM water_sources WHERE LOWER(TRIM(name)) = LOWER($1)', [name.trim()]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A water source with this name already exists' });
    }
    const result = await client.query(`
      INSERT INTO water_sources (name, source_type, capacity_litres, cost_per_unit)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [name.trim(), sourceType, sourceType === 'tanker' ? capacity : null, sourceType === 'tanker' ? cost : null]);
    await client.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'create_water_source', 'water_sources', result.rows[0].id, JSON.stringify(result.rows[0])]
    );
    await client.query('COMMIT');
    cache.invalidate('water_sources');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to create water source' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/config/water-sources/:id
router.put('/water-sources/:id', authenticate, authorize('watercommittee'), async (req, res) => {
  try {
    const { costPerUnit, capacityLitres } = req.body;
    const result = await db.query(`
      UPDATE water_sources SET cost_per_unit = COALESCE($1, cost_per_unit), 
        capacity_litres = COALESCE($2, capacity_litres)
      WHERE id = $3 RETURNING *
    `, [costPerUnit, capacityLitres, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Water source not found' });
    }
    cache.invalidate('water_sources');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
