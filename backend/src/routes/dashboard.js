const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const cache = require('../cache');

const router = express.Router();

// GET /api/dashboard/summary
router.get('/summary', authenticate, async (req, res) => {
  try {
    const cached = cache.get('dashboard_summary');
    if (cached) return res.json(cached);
    // Latest monthly record
    const latestRecord = await db.query(`
      SELECT * FROM monthly_records ORDER BY year DESC, month DESC LIMIT 1
    `);

    // Total flats
    const flatCount = await db.query('SELECT COUNT(*) as count FROM flats WHERE is_active = true');

    // Block-wise flat counts
    const blockStats = await db.query(`
      SELECT b.name, b.display_name, COUNT(f.id) as flat_count
      FROM blocks b LEFT JOIN flats f ON b.id = f.block_id AND f.is_active = true
      GROUP BY b.id, b.name, b.display_name ORDER BY b.name
    `);

    // Recent records with status
    const recentRecords = await db.query(`
      SELECT id, year, month, status, cost_per_litre, total_water_input, total_water_usage
      FROM monthly_records ORDER BY year DESC, month DESC LIMIT 6
    `);

    // Warnings count for latest record
    let warningCount = 0;
    if (latestRecord.rows.length > 0) {
      const warnings = await db.query(
        'SELECT COUNT(*) as count FROM meter_readings WHERE monthly_record_id = $1 AND has_warning = true',
        [latestRecord.rows[0].id]
      );
      warningCount = parseInt(warnings.rows[0].count);
    }

    const summary = {
      totalFlats: parseInt(flatCount.rows[0].count),
      blockStats: blockStats.rows,
      latestRecord: latestRecord.rows[0] || null,
      recentRecords: recentRecords.rows,
      warningCount,
    };
    cache.set('dashboard_summary', summary);
    res.json(summary);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/consumption-trend
router.get('/consumption-trend', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT mr.year, mr.month, mr.total_water_input, mr.total_water_usage, mr.cost_per_litre,
        COALESCE(SUM(fb.total_cost), 0) as total_billing
      FROM monthly_records mr
      LEFT JOIN flat_billing fb ON mr.id = fb.monthly_record_id
      GROUP BY mr.id, mr.year, mr.month, mr.total_water_input, mr.total_water_usage, mr.cost_per_litre
      ORDER BY mr.year, mr.month
      LIMIT 12
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/block-consumption/:monthlyRecordId
router.get('/block-consumption/:monthlyRecordId', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT b.name as block_name, b.display_name,
        COALESCE(SUM(fb.consumption_litres), 0) as total_consumption,
        COALESCE(SUM(fb.total_cost), 0) as total_cost,
        COUNT(fb.id) as flat_count
      FROM blocks b
      LEFT JOIN flats f ON b.id = f.block_id
      LEFT JOIN flat_billing fb ON f.id = fb.flat_id AND fb.monthly_record_id = $1
      GROUP BY b.id, b.name, b.display_name
      ORDER BY b.name
    `, [req.params.monthlyRecordId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
