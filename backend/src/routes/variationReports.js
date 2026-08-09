const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function requireNonGuest(req, res, next) {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Guests cannot perform this action' });
  }
  next();
}

function requireWaterCommitteeOrAdmin(req, res, next) {
  if (req.user.role === 'watercommittee' || req.user.isSuperadmin || req.user.canManageUsers) {
    return next();
  }
  return res.status(403).json({ error: 'Insufficient permissions' });
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatMonthLabel(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

router.get('/report', authenticate, async (req, res) => {
  try {
    const monthIds = Array.isArray(req.query['months[]'])
      ? req.query['months[]']
      : req.query['months[]'] ? [req.query['months[]']] : (
          Array.isArray(req.query.months) ? req.query.months : req.query.months ? [req.query.months] : []
        );

    if (monthIds.length < 2) {
      return res.status(400).json({ error: 'Select at least two months for comparison' });
    }

    const monthResult = await db.query(
      `SELECT id, year, month
       FROM monthly_records
       WHERE id = ANY($1)`,
      [monthIds]
    );

    if (monthResult.rows.length !== monthIds.length) {
      return res.status(400).json({ error: 'One or more selected months are invalid' });
    }

    // Preserve the order of months as selected by the user (monthIds array)
    const monthById = monthResult.rows.reduce((m, r) => (m[r.id] = r, m), {});
    const orderedMonths = monthIds.map(id => monthById[id]).filter(Boolean);

    // Also compute chronological order (earliest -> latest) to calculate deltas
    const chronologicalMonths = [...orderedMonths].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    const monthKeys = chronologicalMonths.map(r => `${r.year}-${String(r.month).padStart(2, '0')}`);
    const monthLabels = chronologicalMonths.map(r => formatMonthLabel(r.year, r.month));

    const billingResult = await db.query(`
      SELECT fb.flat_id, f.flat_number, b.name AS block_name,
             mr.year, mr.month, fb.consumption_litres
      FROM flat_billing fb
      JOIN flats f ON fb.flat_id = f.id
      JOIN blocks b ON f.block_id = b.id
      JOIN monthly_records mr ON fb.monthly_record_id = mr.id
      WHERE fb.monthly_record_id = ANY($1)
      ORDER BY b.name, f.flat_number, mr.year, mr.month
    `, [monthIds]);

    const grouped = {};
    billingResult.rows.forEach(row => {
      const key = row.flat_id;
      if (!grouped[key]) {
        grouped[key] = {
          flatId: row.flat_id,
          flatNumber: row.flat_number,
          blockName: row.block_name,
          values: {},
        };
      }
      const monthKey = `${row.year}-${String(row.month).padStart(2, '0')}`;
      // Use absolute consumption to avoid negative values caused by meter rollovers
      grouped[key].values[monthKey] = Math.abs(Number(row.consumption_litres || 0));
    });

    const rows = Object.values(grouped).map(item => {
      const firstKey = monthKeys[0];
      const lastKey = monthKeys[monthKeys.length - 1];
      const firstValue = Number(item.values[firstKey] || 0);
      const lastValue = Number(item.values[lastKey] || 0);
      const variationLitres = lastValue - firstValue;
      const variationPct = firstValue > 0
        ? Number(((variationLitres / firstValue) * 100).toFixed(2))
        : null;

      return {
        ...item,
        values: monthKeys.reduce((acc, key) => ({ ...acc, [key]: item.values[key] ?? 0 }), {}),
        variationLitres,
        variationPct,
        monthLabels,
      };
    });

    const sortedByVariation = [...rows].sort((a, b) => {
      const aVal = Math.abs(a.variationPct ?? a.variationLitres);
      const bVal = Math.abs(b.variationPct ?? b.variationLitres);
      return bVal - aVal;
    });

    const top20Ids = new Set(sortedByVariation.slice(0, 20).map(r => `${r.flatId}|${r.blockName}`));
    const resultRows = rows.map(row => ({
      ...row,
      monthKeys,
      isTop: top20Ids.has(`${row.flatId}|${row.blockName}`),
    }));

    res.json({ monthLabels, rows: resultRows });
  } catch (err) {
    console.error('Variation report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticate, requireNonGuest, async (req, res) => {
  try {
    const {
      flatId,
      flatNumber,
      blockName,
      monthlyRecordIds,
      monthLabels,
      variationLitres,
      variationPct,
      reason,
    } = req.body;

    if (!flatId || !flatNumber || !blockName || !Array.isArray(monthlyRecordIds) || monthlyRecordIds.length < 2 || !Array.isArray(monthLabels) || !reason) {
      return res.status(400).json({ error: 'Required fields missing or invalid' });
    }

    const insertResult = await db.query(`
      INSERT INTO variation_exceptions
        (monthly_record_ids, month_labels, flat_id, flat_number, block_name, variation_litres, variation_pct, reason, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      RETURNING *
    `,
    [
      JSON.stringify(monthlyRecordIds),
      JSON.stringify(monthLabels),
      flatId,
      flatNumber,
      blockName,
      variationLitres,
      variationPct,
      reason,
      req.user.id,
    ]);

    const row = insertResult.rows[0];
    await db.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'create_variation_exception', 'variation_exceptions', row.id, JSON.stringify(row)]
    );

    const saved = await db.query(`
      SELECT ve.*, u.full_name as created_by_name
      FROM variation_exceptions ve
      LEFT JOIN users u ON ve.created_by = u.id
      WHERE ve.id = $1
    `, [row.id]);

    res.status(201).json(saved.rows[0]);
  } catch (err) {
    console.error('Save variation exception error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', authenticate, requireNonGuest, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ve.*, u1.full_name as created_by_name, u2.full_name as updated_by_name, u3.full_name as deleted_by_name
      FROM variation_exceptions ve
      LEFT JOIN users u1 ON ve.created_by = u1.id
      LEFT JOIN users u2 ON ve.updated_by = u2.id
      LEFT JOIN users u3 ON ve.deleted_by = u3.id
      WHERE ve.deleted_at IS NULL
      ORDER BY ve.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Get saved variations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, requireNonGuest, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const existing = await db.query('SELECT * FROM variation_exceptions WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Saved exception not found' });
    }

    const row = existing.rows[0];
    const isOwner = row.created_by === req.user.id;
    const canModify = isOwner || req.user.role === 'watercommittee' || req.user.isSuperadmin || req.user.canManageUsers;
    if (!canModify) {
      return res.status(403).json({ error: 'Insufficient permissions to update this record' });
    }

    const updateResult = await db.query(`
      UPDATE variation_exceptions
      SET reason = $1, updated_by = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [reason, req.user.id, req.params.id]);

    await db.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.id, 'update_variation_exception', 'variation_exceptions', req.params.id, JSON.stringify(row), JSON.stringify(updateResult.rows[0])]
    );

    res.json(updateResult.rows[0]);
  } catch (err) {
    console.error('Update saved variation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, requireWaterCommitteeOrAdmin, async (req, res) => {
  try {
    const existing = await db.query('SELECT * FROM variation_exceptions WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Saved exception not found or already deleted' });
    }

    await db.query(`
      UPDATE variation_exceptions
      SET deleted_at = NOW(), deleted_by = $1
      WHERE id = $2
    `, [req.user.id, req.params.id]);

    await db.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'delete_variation_exception', 'variation_exceptions', req.params.id, JSON.stringify(existing.rows[0])]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Delete saved variation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
