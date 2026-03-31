const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/billing/:monthlyRecordId
router.get('/:monthlyRecordId', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT fb.*, f.flat_number, b.name as block_name, b.display_name as block_display_name
      FROM flat_billing fb
      JOIN flats f ON fb.flat_id = f.id
      JOIN blocks b ON f.block_id = b.id
      WHERE fb.monthly_record_id = $1
      ORDER BY b.name, f.flat_number
    `, [req.params.monthlyRecordId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/billing/:monthlyRecordId/block/:blockId
router.get('/:monthlyRecordId/block/:blockId', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT fb.*, f.flat_number, b.name as block_name
      FROM flat_billing fb
      JOIN flats f ON fb.flat_id = f.id
      JOIN blocks b ON f.block_id = b.id
      WHERE fb.monthly_record_id = $1 AND f.block_id = $2
      ORDER BY f.flat_number
    `, [req.params.monthlyRecordId, req.params.blockId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
