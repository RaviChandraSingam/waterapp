const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/common-areas
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM common_areas WHERE is_active = true ORDER BY name');
    res.json(result.rows);
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
