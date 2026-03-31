const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/blocks
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM blocks ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/blocks/:id/flats
router.get('/:id/flats', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM flats WHERE block_id = $1 AND is_active = true ORDER BY flat_number',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/blocks/flats - all flats grouped by block
router.get('/all/flats', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT f.id, f.flat_number, f.block_id, b.name as block_name, b.display_name as block_display_name
      FROM flats f
      JOIN blocks b ON f.block_id = b.id
      WHERE f.is_active = true
      ORDER BY b.name, f.flat_number
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
