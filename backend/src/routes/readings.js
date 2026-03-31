const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/readings/:monthlyRecordId/block/:blockId
router.get('/:monthlyRecordId/block/:blockId', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT mr.id as reading_id, mr.reading_date, mr.reading_value, mr.reading_sequence,
        mr.has_warning, mr.warning_message, mr.is_verified, mr.captured_by,
        f.id as flat_id, f.flat_number, b.name as block_name,
        u.full_name as captured_by_name
      FROM meter_readings mr
      JOIN flats f ON mr.flat_id = f.id
      JOIN blocks b ON f.block_id = b.id
      LEFT JOIN users u ON mr.captured_by = u.id
      WHERE mr.monthly_record_id = $1 AND f.block_id = $2
      ORDER BY f.flat_number, mr.reading_sequence
    `, [req.params.monthlyRecordId, req.params.blockId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/readings/:monthlyRecordId/block/:blockId/previous - previous month's closing readings
router.get('/:monthlyRecordId/block/:blockId/previous', authenticate, async (req, res) => {
  try {
    // Get the year/month of the selected record
    const rec = await db.query('SELECT year, month FROM monthly_records WHERE id = $1', [req.params.monthlyRecordId]);
    if (rec.rows.length === 0) return res.status(404).json({ error: 'Record not found' });

    const { year, month } = rec.rows[0];

    // Find the previous monthly record (by year/month ordering)
    const prevRec = await db.query(`
      SELECT id FROM monthly_records
      WHERE (year < $1 OR (year = $1 AND month < $2))
      ORDER BY year DESC, month DESC
      LIMIT 1
    `, [year, month]);

    if (prevRec.rows.length === 0) {
      return res.json([]);
    }

    // Get the highest-sequence reading per flat from that previous month
    const result = await db.query(`
      SELECT DISTINCT ON (f.id)
        f.id as flat_id, f.flat_number, mr.reading_value, mr.reading_sequence, mr.reading_date
      FROM meter_readings mr
      JOIN flats f ON mr.flat_id = f.id
      WHERE mr.monthly_record_id = $1 AND f.block_id = $2
      ORDER BY f.id, mr.reading_sequence DESC
    `, [prevRec.rows[0].id, req.params.blockId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Previous readings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/readings/:monthlyRecordId - all readings for a month
router.get('/:monthlyRecordId', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT mr.id as reading_id, mr.reading_date, mr.reading_value, mr.reading_sequence,
        mr.has_warning, mr.warning_message, mr.is_verified, mr.captured_by,
        f.id as flat_id, f.flat_number, b.name as block_name, b.display_name as block_display_name,
        u.full_name as captured_by_name
      FROM meter_readings mr
      JOIN flats f ON mr.flat_id = f.id
      JOIN blocks b ON f.block_id = b.id
      LEFT JOIN users u ON mr.captured_by = u.id
      WHERE mr.monthly_record_id = $1
      ORDER BY b.name, f.flat_number, mr.reading_sequence
    `, [req.params.monthlyRecordId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: detect anomalies for a reading
async function detectWarnings(monthlyRecordId, flatId, readingValue, readingSequence) {
  let hasWarning = false;
  let warningMessage = null;

  const prevReading = await db.query(`
    SELECT reading_value FROM meter_readings
    WHERE monthly_record_id = $1 AND flat_id = $2 AND reading_sequence < $3
    ORDER BY reading_sequence DESC LIMIT 1
  `, [monthlyRecordId, flatId, readingSequence]);

  if (prevReading.rows.length > 0) {
    const prevValue = parseFloat(prevReading.rows[0].reading_value);
    const newValue = parseFloat(readingValue);

    if (newValue < prevValue) {
      hasWarning = true;
      warningMessage = `Reading ${newValue} is BELOW previous reading ${prevValue}. Possible meter reset or error.`;
    } else {
      const increase = prevValue > 0 ? ((newValue - prevValue) / prevValue) * 100 : 0;
      const config = await db.query("SELECT config_value FROM billing_config WHERE config_key = 'reading_warning_increase_pct'");
      const threshold = config.rows.length > 0 ? parseFloat(config.rows[0].config_value) : 50;

      if (increase > threshold) {
        hasWarning = true;
        warningMessage = `Reading increased by ${increase.toFixed(1)}% (${prevValue} → ${newValue}). Exceeds ${threshold}% threshold.`;
      }
    }
  }

  if (!prevReading.rows.length) {
    const prevMonthReading = await db.query(`
      SELECT mr2.reading_value FROM meter_readings mr2
      JOIN monthly_records mo ON mr2.monthly_record_id = mo.id
      WHERE mr2.flat_id = $1 AND mr2.monthly_record_id != $2
      ORDER BY mo.year DESC, mo.month DESC, mr2.reading_sequence DESC
      LIMIT 1
    `, [flatId, monthlyRecordId]);

    if (prevMonthReading.rows.length > 0) {
      const prevValue = parseFloat(prevMonthReading.rows[0].reading_value);
      const newValue = parseFloat(readingValue);
      if (newValue < prevValue) {
        hasWarning = true;
        warningMessage = `Reading ${newValue} is BELOW last month's reading ${prevValue}. Possible meter reset or error.`;
      }
    }
  }

  return { hasWarning, warningMessage };
}

// POST /api/readings - capture meter reading (single or batch)
router.post('/', authenticate, authorize('plumber', 'accountant', 'watercommittee'), async (req, res) => {
  try {
    const { readings } = req.body;
    if (!Array.isArray(readings) || readings.length === 0) {
      return res.status(400).json({ error: 'readings array is required' });
    }

    // Validate record status — all readings must belong to a record not in reviewed/final
    const recordIds = [...new Set(readings.map(r => r.monthlyRecordId))];
    for (const rid of recordIds) {
      const rec = await db.query('SELECT status FROM monthly_records WHERE id = $1', [rid]);
      if (rec.rows.length === 0) return res.status(404).json({ error: 'Monthly record not found' });
      if (rec.rows[0].status === 'reviewed' || rec.rows[0].status === 'final') {
        return res.status(400).json({ error: `Cannot capture readings — record is in '${rec.rows[0].status}' status. Only draft/captured records allow changes.` });
      }
    }

    const results = [];
    const warnings = [];

    for (const reading of readings) {
      const { monthlyRecordId, flatId, readingDate, readingValue, readingSequence } = reading;

      if (!monthlyRecordId || !flatId || !readingDate || readingValue === undefined || !readingSequence) {
        results.push({ flatId, error: 'Missing required fields' });
        continue;
      }

      const { hasWarning, warningMessage } = await detectWarnings(monthlyRecordId, flatId, readingValue, readingSequence);

      // Get old value for audit if it exists
      const oldRow = await db.query(
        'SELECT id, reading_value, reading_date FROM meter_readings WHERE monthly_record_id = $1 AND flat_id = $2 AND reading_sequence = $3',
        [monthlyRecordId, flatId, readingSequence]
      );

      const result = await db.query(`
        INSERT INTO meter_readings (monthly_record_id, flat_id, reading_date, reading_value, reading_sequence, captured_by, has_warning, warning_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (monthly_record_id, flat_id, reading_sequence)
        DO UPDATE SET reading_value = $4, reading_date = $3, captured_by = $6, has_warning = $7, warning_message = $8, updated_at = NOW()
        RETURNING *
      `, [monthlyRecordId, flatId, readingDate, readingValue, readingSequence, req.user.id, hasWarning, warningMessage]);

      // Audit log
      const action = oldRow.rows.length > 0 ? 'update_reading' : 'capture_reading';
      const oldValues = oldRow.rows.length > 0
        ? { reading_value: oldRow.rows[0].reading_value, reading_date: oldRow.rows[0].reading_date }
        : null;
      await db.query(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.user.id, action, 'meter_readings', result.rows[0].id,
         oldValues ? JSON.stringify(oldValues) : null,
         JSON.stringify({ reading_value: readingValue, reading_date: readingDate, flat_id: flatId, reading_sequence: readingSequence })]
      );

      if (hasWarning) {
        warnings.push({ flatId, warning: warningMessage });
      }
      results.push(result.rows[0]);
    }

    res.json({ results, warnings });
  } catch (err) {
    console.error('Reading capture error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/readings/:id - update a reading (accountant can modify)
router.put('/:id', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const { readingValue, readingDate } = req.body;

    // Check record status
    const readingRow = await db.query(`
      SELECT mr.*, mo.status as record_status FROM meter_readings mr
      JOIN monthly_records mo ON mr.monthly_record_id = mo.id
      WHERE mr.id = $1
    `, [req.params.id]);
    if (readingRow.rows.length === 0) return res.status(404).json({ error: 'Reading not found' });
    if (readingRow.rows[0].record_status === 'reviewed' || readingRow.rows[0].record_status === 'final') {
      return res.status(400).json({ error: `Cannot update — record is in '${readingRow.rows[0].record_status}' status` });
    }

    const old = readingRow.rows[0];
    const result = await db.query(`
      UPDATE meter_readings SET reading_value = $1, reading_date = COALESCE($2, reading_date), 
        is_verified = false, updated_at = NOW()
      WHERE id = $3 RETURNING *
    `, [readingValue, readingDate || null, req.params.id]);

    // Audit log
    await db.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.id, 'update_reading', 'meter_readings', req.params.id,
       JSON.stringify({ reading_value: old.reading_value, reading_date: old.reading_date }),
       JSON.stringify({ readingValue, readingDate })]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/readings/:id/verify - plumber verifies accountant's change
router.put('/:id/verify', authenticate, authorize('plumber', 'watercommittee'), async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE meter_readings SET is_verified = true, updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reading not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/readings/audit/:monthlyRecordId - audit log for a record
router.get('/audit/:monthlyRecordId', authenticate, authorize('accountant', 'watercommittee'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT al.*, u.full_name as user_name, u.username
      FROM audit_log al
      JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'meter_readings'
        AND al.entity_id IN (
          SELECT id FROM meter_readings WHERE monthly_record_id = $1
        )
      ORDER BY al.created_at DESC
      LIMIT 200
    `, [req.params.monthlyRecordId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
