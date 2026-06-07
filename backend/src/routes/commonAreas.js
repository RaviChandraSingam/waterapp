const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const cache = require('../cache');

const router = express.Router();

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
      
      // Check the monthly record status - should not be final or reviewed
      const recordCheck = await db.query(
        'SELECT status FROM monthly_records WHERE id = $1',
        [monthlyRecordId]
      );
      
      if (recordCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Monthly record not found' });
      }
      
      if (recordCheck.rows[0].status === 'final' || recordCheck.rows[0].status === 'reviewed') {
        return res.status(400).json({ error: `Cannot add or modify readings for a record in ${recordCheck.rows[0].status} status` });
      }

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

// PUT /api/common-areas/readings/:id - Edit a specific common area reading
router.put('/readings/:id', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const { startReading, endReading } = req.body;
    
    if (startReading === undefined || endReading === undefined) {
      return res.status(400).json({ error: 'startReading and endReading are required' });
    }

    // Get the current reading
    const currentReading = await db.query(
      'SELECT * FROM common_area_readings WHERE id = $1',
      [req.params.id]
    );
    
    if (currentReading.rows.length === 0) {
      return res.status(404).json({ error: 'Common area reading not found' });
    }

    const reading = currentReading.rows[0];

    // Check the monthly record status - should not be final or reviewed
    const recordCheck = await db.query(
      'SELECT status FROM monthly_records WHERE id = $1',
      [reading.monthly_record_id]
    );
    
    if (recordCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Monthly record not found' });
    }
    
    if (recordCheck.rows[0].status === 'final' || recordCheck.rows[0].status === 'reviewed') {
      return res.status(400).json({ error: `Cannot modify readings for a record in ${recordCheck.rows[0].status} status` });
    }

    const consumptionLitres = (endReading - startReading) * 1000;

    // Update the reading
    const result = await db.query(`
      UPDATE common_area_readings 
      SET start_reading = $1, end_reading = $2, consumption_litres = $3, captured_by = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [startReading, endReading, consumptionLitres, req.user.id, req.params.id]);

    // Log to audit trail
    await db.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        req.user.id,
        'update',
        'common_area_readings',
        req.params.id,
        JSON.stringify({
          start_reading: reading.start_reading,
          end_reading: reading.end_reading,
          consumption_litres: reading.consumption_litres
        }),
        JSON.stringify({
          start_reading: startReading,
          end_reading: endReading,
          consumption_litres: consumptionLitres
        })
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating common area reading:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
