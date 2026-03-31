const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

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

    res.status(201).json(result.rows[0]);
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
    const recordId = req.params.id;

    // Get billing config
    const config = await db.query('SELECT * FROM billing_config');
    const configMap = {};
    config.rows.forEach(c => { configMap[c.config_key] = parseFloat(c.config_value); });

    const slab1Limit = configMap.slab1_limit || 15000;
    const slab2Limit = configMap.slab2_limit || 20000;
    const slab1Mult = configMap.slab1_multiplier || 1.0;
    const slab2Mult = configMap.slab2_multiplier || 1.5;
    const slab3Mult = configMap.slab3_multiplier || 2.0;

    // Calculate total cost
    const costItems = await db.query('SELECT SUM(amount) as total FROM cost_items WHERE monthly_record_id = $1', [recordId]);
    const waterSourceReadings = await db.query(
      'SELECT SUM(total_cost) as tanker_cost FROM water_source_readings WHERE monthly_record_id = $1',
      [recordId]
    );

    const itemsCost = parseFloat(costItems.rows[0].total || 0);
    const tankerCost = parseFloat(waterSourceReadings.rows[0].tanker_cost || 0);
    const totalCost = itemsCost + tankerCost;

    // Calculate total water input
    const inputResult = await db.query(
      'SELECT SUM(consumption_litres) as total FROM water_source_readings WHERE monthly_record_id = $1',
      [recordId]
    );
    const totalInput = parseFloat(inputResult.rows[0].total || 1);

    const costPerLitre = totalCost / totalInput;

    // Get all meter readings grouped by flat
    const readings = await db.query(`
      SELECT flat_id, 
        MIN(CASE WHEN reading_sequence = 1 THEN reading_value END) as start_reading,
        MAX(CASE WHEN reading_sequence = 3 THEN reading_value 
             WHEN reading_sequence = 2 THEN reading_value END) as end_reading
      FROM meter_readings
      WHERE monthly_record_id = $1
      GROUP BY flat_id
    `, [recordId]);

    // Calculate billing for each flat
    let totalUsage = 0;
    for (const r of readings.rows) {
      const startReading = parseFloat(r.start_reading || 0);
      const endReading = parseFloat(r.end_reading || 0);
      const consumption = (endReading - startReading) * 1000;
      totalUsage += consumption;

      const slab1Qty = Math.min(consumption, slab1Limit);
      const slab2Qty = consumption > slab2Limit ? (slab2Limit - slab1Limit) : Math.max(0, consumption - slab1Limit);
      const slab3Qty = Math.max(0, consumption - slab2Limit);

      const slab1Cost = slab1Qty * costPerLitre * slab1Mult;
      const slab2Cost = slab2Qty * costPerLitre * slab2Mult;
      const slab3Cost = slab3Qty * costPerLitre * slab3Mult;
      const flatTotalCost = slab1Cost + slab2Cost + slab3Cost;

      await db.query(`
        INSERT INTO flat_billing (monthly_record_id, flat_id, start_reading, end_reading, 
          consumption_litres, slab1_qty, slab2_qty, slab3_qty, slab1_cost, slab2_cost, slab3_cost, total_cost)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (monthly_record_id, flat_id)
        DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5,
          slab1_qty = $6, slab2_qty = $7, slab3_qty = $8,
          slab1_cost = $9, slab2_cost = $10, slab3_cost = $11, total_cost = $12, updated_at = NOW()
      `, [recordId, r.flat_id, startReading, endReading, consumption,
        slab1Qty, slab2Qty, slab3Qty,
        Math.round(slab1Cost * 100) / 100, Math.round(slab2Cost * 100) / 100,
        Math.round(slab3Cost * 100) / 100, Math.round(flatTotalCost * 100) / 100]);
    }

    // Also calculate common area consumption
    const commonReadings = await db.query(
      'SELECT * FROM common_area_readings WHERE monthly_record_id = $1',
      [recordId]
    );
    let commonTotal = 0;
    for (const cr of commonReadings.rows) {
      const consumption = (parseFloat(cr.end_reading) - parseFloat(cr.start_reading)) * 1000;
      commonTotal += consumption;
      await db.query(
        'UPDATE common_area_readings SET consumption_litres = $1 WHERE id = $2',
        [consumption, cr.id]
      );
    }

    totalUsage += commonTotal;

    // Update monthly record
    await db.query(`
      UPDATE monthly_records SET cost_per_litre = $1, total_water_input = $2, total_water_usage = $3, updated_at = NOW()
      WHERE id = $4
    `, [costPerLitre, totalInput, totalUsage, recordId]);

    res.json({
      costPerLitre: Math.round(costPerLitre * 1000000) / 1000000,
      totalCost: Math.round(totalCost * 100) / 100,
      totalWaterInput: totalInput,
      totalWaterUsage: totalUsage,
      flatsCalculated: readings.rows.length,
    });
  } catch (err) {
    console.error('Calculation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
