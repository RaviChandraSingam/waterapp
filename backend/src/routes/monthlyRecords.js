const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { recalculateMonthlyRecord } = require('../helpers/recalculate');

const router = express.Router();

// GET /api/monthly-records
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT mr.*, 
        u1.full_name as created_by_name,
        u2.full_name as reviewed_by_name,
        u3.full_name as finalized_by_name
      FROM monthly_records mr
      LEFT JOIN users u1 ON mr.created_by = u1.id
      LEFT JOIN users u2 ON mr.reviewed_by = u2.id
      LEFT JOIN users u3 ON mr.finalized_by = u3.id
      ORDER BY mr.year DESC, mr.month DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/monthly-records/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT mr.*, 
        u1.full_name as created_by_name,
        u2.full_name as reviewed_by_name,
        u3.full_name as finalized_by_name
      FROM monthly_records mr
      LEFT JOIN users u1 ON mr.created_by = u1.id
      LEFT JOIN users u2 ON mr.reviewed_by = u2.id
      LEFT JOIN users u3 ON mr.finalized_by = u3.id
      WHERE mr.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Monthly record not found' });
    }

    // Also fetch cost items
    const costItems = await db.query(
      'SELECT * FROM cost_items WHERE monthly_record_id = $1 ORDER BY item_name',
      [req.params.id]
    );

    // Fetch water source readings
    const sourceReadings = await db.query(`
      SELECT wsr.*, ws.name as source_name, ws.source_type, ws.capacity_litres,
        ws.cost_per_unit as default_cost_per_unit
      FROM water_source_readings wsr
      JOIN water_sources ws ON wsr.water_source_id = ws.id
      WHERE wsr.monthly_record_id = $1
      ORDER BY ws.name
    `, [req.params.id]);

    res.json({
      ...result.rows[0],
      cost_items: costItems.rows,
      water_source_readings: sourceReadings.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/monthly-records
router.post('/', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const { year, month, periodStartDate, periodEndDate, midPeriodDate, notes } = req.body;
    if (!year || !month || !periodStartDate || !periodEndDate) {
      return res.status(400).json({ error: 'Year, month, start date, and end date are required' });
    }

    const result = await db.query(`
      INSERT INTO monthly_records (year, month, period_start_date, period_end_date, mid_period_date, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [year, month, periodStartDate, periodEndDate, midPeriodDate || null, notes || null, req.user.id]);

    const newRecord = result.rows[0];

    // Auto-populate start readings (sequence 1) from the previous month's closing readings (sequence 3)
    try {
      const prevRec = await db.query(
        `SELECT id FROM monthly_records
         WHERE (year < $1 OR (year = $1 AND month < $2))
         ORDER BY year DESC, month DESC LIMIT 1`,
        [year, month]
      );

      if (prevRec.rows.length > 0) {
        const prevId = prevRec.rows[0].id;
        // Get the highest-sequence reading per flat from the previous month
        const prevReadings = await db.query(`
          SELECT DISTINCT ON (flat_id) flat_id, reading_value, reading_date
          FROM meter_readings
          WHERE monthly_record_id = $1
          ORDER BY flat_id, reading_sequence DESC
        `, [prevId]);

        for (const pr of prevReadings.rows) {
          await db.query(`
            INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence, captured_by, has_warning, warning_message)
            VALUES ($1, $2, $3, $4, 1, $5, false, NULL)
            ON CONFLICT (monthly_record_id, flat_id, reading_sequence) DO NOTHING
          `, [newRecord.id, pr.flat_id, pr.reading_date, pr.reading_value, req.user.id]);
        }
      }
    } catch (autoPopErr) {
      console.error('Auto-populate start readings error (non-fatal):', autoPopErr);
    }

    res.status(201).json(newRecord);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A record for this month/year already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/monthly-records/:id/status
router.put('/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    const currentRecord = await db.query('SELECT * FROM monthly_records WHERE id = $1', [req.params.id]);
    if (currentRecord.rows.length === 0) {
      return res.status(404).json({ error: 'Monthly record not found' });
    }

    const record = currentRecord.rows[0];
    const role = req.user.role;

    // Validate status transitions based on role
    const validTransitions = {
      'plumber': { 'draft': 'captured' },
      'accountant': { 'captured': 'reviewed', 'reviewed': 'captured' },
      'watercommittee': { 'reviewed': 'final', 'final': 'reviewed', 'captured': 'reviewed', 'draft': 'captured' },
    };

    if (!validTransitions[role] || validTransitions[role][record.status] !== status) {
      return res.status(400).json({ error: `Cannot transition from '${record.status}' to '${status}' with role '${role}'` });
    }

    let updateQuery = 'UPDATE monthly_records SET status = $1, updated_at = NOW()';
    const params = [status];
    let paramIdx = 2;

    if (status === 'reviewed') {
      updateQuery += `, reviewed_by = $${paramIdx}, reviewed_at = NOW()`;
      params.push(req.user.id);
      paramIdx++;
    } else if (status === 'final') {
      updateQuery += `, finalized_by = $${paramIdx}, finalized_at = NOW()`;
      params.push(req.user.id);
      paramIdx++;
    }

    updateQuery += ` WHERE id = $${paramIdx} RETURNING *`;
    params.push(req.params.id);

    const result = await db.query(updateQuery, params);

    // Audit log
    await db.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.id, 'status_change', 'monthly_records', req.params.id, JSON.stringify({ status: record.status }), JSON.stringify({ status })]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Status update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/monthly-records/:id/cost-items
router.put('/:id/cost-items', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const { costItems } = req.body;
    if (!Array.isArray(costItems)) {
      return res.status(400).json({ error: 'costItems must be an array' });
    }

    // Delete existing and re-insert
    await db.query('DELETE FROM cost_items WHERE monthly_record_id = $1', [req.params.id]);

    for (const item of costItems) {
      await db.query(
        'INSERT INTO cost_items (monthly_record_id, item_name, amount) VALUES ($1, $2, $3)',
        [req.params.id, item.itemName, item.amount]
      );
    }

    const result = await db.query(
      'SELECT * FROM cost_items WHERE monthly_record_id = $1 ORDER BY item_name',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/monthly-records/:id/water-sources
router.put('/:id/water-sources', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const { readings } = req.body;
    if (!Array.isArray(readings)) {
      return res.status(400).json({ error: 'readings must be an array' });
    }

    // Get current record's year/month for previous month lookup
    const currentRec = await db.query('SELECT year, month FROM monthly_records WHERE id = $1', [req.params.id]);
    if (currentRec.rows.length === 0) return res.status(404).json({ error: 'Record not found' });

    const { year, month } = currentRec.rows[0];
    const prevRec = await db.query(
      'SELECT id FROM monthly_records WHERE (year < $1 OR (year = $1 AND month < $2)) ORDER BY year DESC, month DESC LIMIT 1',
      [year, month]
    );

    for (const reading of readings) {
      const source = await db.query('SELECT * FROM water_sources WHERE id = $1', [reading.waterSourceId]);
      if (source.rows.length === 0) continue;

      const ws = source.rows[0];
      let consumptionLitres = 0;
      let totalCost = 0;
      let costPerUnit = null;

      if (ws.source_type === 'borewell') {
        consumptionLitres = ((reading.endReading || 0) - (reading.startReading || 0)) * 1000;
      } else {
        // Determine cost_per_unit: explicit value > previous month > global default
        if (reading.costPerUnit !== undefined && reading.costPerUnit !== null) {
          costPerUnit = parseFloat(reading.costPerUnit);
        } else if (prevRec.rows.length > 0) {
          const prevCost = await db.query(
            'SELECT cost_per_unit FROM water_source_readings WHERE monthly_record_id = $1 AND water_source_id = $2',
            [prevRec.rows[0].id, reading.waterSourceId]
          );
          costPerUnit = prevCost.rows.length > 0 && prevCost.rows[0].cost_per_unit
            ? parseFloat(prevCost.rows[0].cost_per_unit)
            : parseFloat(ws.cost_per_unit || 0);
        } else {
          costPerUnit = parseFloat(ws.cost_per_unit || 0);
        }

        consumptionLitres = (reading.unitCount || 0) * (ws.capacity_litres || 12000);
        totalCost = (reading.unitCount || 0) * costPerUnit;
      }

      await db.query(`
        INSERT INTO water_source_readings (monthly_record_id, water_source_id, start_reading, end_reading, unit_count, cost_per_unit, consumption_litres, total_cost)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (monthly_record_id, water_source_id)
        DO UPDATE SET start_reading = $3, end_reading = $4, unit_count = $5, cost_per_unit = $6, consumption_litres = $7, total_cost = $8
      `, [req.params.id, reading.waterSourceId, reading.startReading || null, reading.endReading || null,
          reading.unitCount || null, costPerUnit, consumptionLitres, totalCost]);
    }

    const result = await db.query(`
      SELECT wsr.*, ws.name as source_name, ws.source_type, ws.capacity_litres,
        ws.cost_per_unit as default_cost_per_unit
      FROM water_source_readings wsr
      JOIN water_sources ws ON wsr.water_source_id = ws.id
      WHERE wsr.monthly_record_id = $1
    `, [req.params.id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Water sources update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/monthly-records/:id/calculate
router.post('/:id/calculate', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const result = await recalculateMonthlyRecord(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('Calculation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/monthly-records/:id/dates
router.put('/:id/dates', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const { periodStartDate, periodEndDate, midPeriodDate } = req.body;
    if (!periodStartDate || !periodEndDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const result = await db.query(
      'UPDATE monthly_records SET period_start_date = $1, period_end_date = $2, mid_period_date = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [periodStartDate, periodEndDate, midPeriodDate || null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Monthly record not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Dates update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
