const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const cache = require('../cache');

const router = express.Router();

async function ensureCommonAreaCaptureEditable(monthlyRecordId, user) {
  const result = await db.query('SELECT status FROM monthly_records WHERE id = $1', [monthlyRecordId]);
  if (result.rows.length === 0) {
    const err = new Error('Monthly record not found');
    err.statusCode = 404;
    throw err;
  }

  const status = result.rows[0].status;
  if (user.role === 'plumber' && status !== 'draft') {
    const err = new Error(`Plumbers can capture common area readings only for draft records. Current status is '${status}'.`);
    err.statusCode = 400;
    throw err;
  }
  if (user.role !== 'plumber' && status === 'final') {
    const err = new Error(`Cannot update common area readings — record is in 'final' status.`);
    err.statusCode = 400;
    throw err;
  }
}

// GET /api/common-areas
router.get('/', authenticate, async (req, res) => {
  try {
    const cached = cache.get('common_areas');
    if (cached) return res.json(cached);
    const result = await db.query('SELECT * FROM common_areas WHERE is_active = true ORDER BY name');
    cache.set('common_areas', result.rows);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/common-areas
router.post('/', authenticate, authorize('watercommittee'), async (req, res) => {
  try {
    const { name, description, isActive = true } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const result = await db.query(
      'INSERT INTO common_areas (name, description, is_active) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), description || null, isActive]
    );

    cache.invalidate('common_areas');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/common-areas/:id
router.put('/:id', authenticate, authorize('watercommittee'), async (req, res) => {
  try {
    const { name, description, isActive } = req.body;
    const result = await db.query(
      `UPDATE common_areas SET name = COALESCE(NULLIF($1, ''), name), description = COALESCE($2, description), is_active = COALESCE($3, is_active)
       WHERE id = $4 RETURNING *`,
      [name, description, isActive, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Common area not found' });
    }

    cache.invalidate('common_areas');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/common-areas/readings/:monthlyRecordId
router.get('/readings/:monthlyRecordId', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT car.*, ca.name as area_name, ca.description,
        u.full_name as captured_by_name
      FROM common_area_readings car
      JOIN common_areas ca ON car.common_area_id = ca.id
      LEFT JOIN users u ON car.captured_by = u.id
      WHERE car.monthly_record_id = $1
      ORDER BY ca.name
    `, [req.params.monthlyRecordId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/common-areas/readings
router.post('/readings', authenticate, authorize('plumber', 'accountant', 'watercommittee'), async (req, res) => {
  try {
    const { readings } = req.body;
    if (!Array.isArray(readings)) {
      return res.status(400).json({ error: 'readings must be an array' });
    }

    const recordIds = [...new Set(readings.map(r => r.monthlyRecordId))];
    for (const monthlyRecordId of recordIds) {
      await ensureCommonAreaCaptureEditable(monthlyRecordId, req.user);
    }

    const results = [];
    for (const reading of readings) {
      const { monthlyRecordId, commonAreaId, startReading, endReading } = reading;
      const consumptionLitres = (endReading - startReading) * 1000;

      const result = await db.query(`
        INSERT INTO common_area_readings (monthly_record_id, common_area_id, start_reading, end_reading, consumption_litres, captured_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (monthly_record_id, common_area_id)
        DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5, captured_by = $6, updated_at = NOW()
        RETURNING *
      `, [monthlyRecordId, commonAreaId, startReading, endReading, consumptionLitres, req.user.id]);

      results.push(result.rows[0]);
    }

    res.json(results);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
  }
});

module.exports = router;
