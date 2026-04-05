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
