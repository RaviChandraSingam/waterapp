const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_SORT = ['created_at', 'updated_at', 'priority', 'status', 'due_date', 'planned_period', 'title', 'progress_pct', 'associated_cost', 'seq_no'];
const PRIORITY_ORDER = `CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END`;

// GET /api/pending-items
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category, priority, status, recurring, sortBy = 'created_at', sortDir = 'desc' } = req.query;

    const sort = ALLOWED_SORT.includes(sortBy)
      ? (sortBy === 'priority' ? PRIORITY_ORDER : `pi.${sortBy}`)
      : 'pi.created_at';
    const dir = sortDir.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(pi.title ILIKE $${idx} OR pi.description ILIKE $${idx} OR pi.notes ILIKE $${idx} OR pi.worked_on_by ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (category) { conditions.push(`pi.category = $${idx++}`); params.push(category); }
    if (priority) { conditions.push(`pi.priority = $${idx++}`); params.push(priority); }
    if (status) { conditions.push(`pi.status = $${idx++}`); params.push(status); }
    if (recurring !== undefined && recurring !== '') {
      conditions.push(`pi.recurring = $${idx++}`);
      params.push(recurring === 'true');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(`
      SELECT pi.*,
        u1.full_name as created_by_name,
        u2.full_name as updated_by_name
      FROM pending_items pi
      LEFT JOIN users u1 ON pi.created_by = u1.id
      LEFT JOIN users u2 ON pi.updated_by = u2.id
      ${where}
      ORDER BY ${sort} ${dir}
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('pending-items GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pending-items/categories  — distinct categories for filter dropdown
router.get('/categories', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT category FROM pending_items ORDER BY category`
    );
    res.json(result.rows.map(r => r.category));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pending-items/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT pi.*, u1.full_name as created_by_name, u2.full_name as updated_by_name
      FROM pending_items pi
      LEFT JOIN users u1 ON pi.created_by = u1.id
      LEFT JOIN users u2 ON pi.updated_by = u2.id
      WHERE pi.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pending-items  (watercommittee / accountant; not guest/plumber)
router.post('/', authenticate, authorize('watercommittee', 'accountant'), async (req, res) => {
  try {
    const {
      title, category = 'general', priority = 'medium', plannedPeriod,
      associatedCost, recurring = false, recurrencePattern, status = 'open',
      progressPct = 0, workedOnBy, description, notes, dueDate,
    } = req.body;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const result = await db.query(`
      INSERT INTO pending_items
        (title, category, priority, planned_period, associated_cost, recurring, recurrence_pattern,
         status, progress_pct, worked_on_by, description, notes, due_date, created_by, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
      RETURNING *
    `, [title, category, priority, plannedPeriod || null, associatedCost || null,
        recurring, recurrencePattern || null, status, progressPct,
        workedOnBy || null, description || null, notes || null, dueDate || null,
        req.user.id]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('pending-items POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pending-items/:id
router.put('/:id', authenticate, authorize('watercommittee', 'accountant'), async (req, res) => {
  try {
    const {
      title, category, priority, plannedPeriod, associatedCost, recurring,
      recurrencePattern, status, progressPct, workedOnBy, description, notes, dueDate,
    } = req.body;

    const existing = await db.query('SELECT * FROM pending_items WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const cur = existing.rows[0];
    const completedAt = status === 'done' && cur.status !== 'done' ? new Date() :
                        status !== 'done' ? null : cur.completed_at;

    const result = await db.query(`
      UPDATE pending_items SET
        title = $1, category = $2, priority = $3, planned_period = $4,
        associated_cost = $5, recurring = $6, recurrence_pattern = $7,
        status = $8, progress_pct = $9, worked_on_by = $10,
        description = $11, notes = $12, due_date = $13,
        completed_at = $14, updated_by = $15, updated_at = NOW()
      WHERE id = $16 RETURNING *
    `, [
      title ?? cur.title,
      category ?? cur.category,
      priority ?? cur.priority,
      plannedPeriod !== undefined ? (plannedPeriod || null) : cur.planned_period,
      associatedCost !== undefined ? (associatedCost || null) : cur.associated_cost,
      recurring !== undefined ? recurring : cur.recurring,
      recurrencePattern !== undefined ? (recurrencePattern || null) : cur.recurrence_pattern,
      status ?? cur.status,
      progressPct !== undefined ? progressPct : cur.progress_pct,
      workedOnBy !== undefined ? (workedOnBy || null) : cur.worked_on_by,
      description !== undefined ? (description || null) : cur.description,
      notes !== undefined ? (notes || null) : cur.notes,
      dueDate !== undefined ? (dueDate || null) : cur.due_date,
      completedAt,
      req.user.id,
      req.params.id,
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('pending-items PUT error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pending-items/:id  (watercommittee only)
router.delete('/:id', authenticate, authorize('watercommittee'), async (req, res) => {
  try {
    const result = await db.query('DELETE FROM pending_items WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
