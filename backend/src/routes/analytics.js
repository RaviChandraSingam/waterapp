const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const PAGE_LABELS = {
  '/': 'Dashboard',
  '/records': 'Monthly Records',
  '/capture': 'Meter Readings',
  '/billing': 'Billing & Reports',
  '/config': 'Configuration',
  '/users': 'User Management',
  '/pending': 'Pending Items',
};

function normalizePage(page) {
  if (!page || typeof page !== 'string') return '/';
  const first = page.split('/').filter(Boolean)[0];
  const p = first ? `/${first}` : '/';
  return PAGE_LABELS[p] !== undefined ? p : '/';
}

// POST /api/analytics/track — record a page visit (fire-and-forget from frontend)
router.post('/track', authenticate, async (req, res) => {
  try {
    const { page } = req.body;
    const normalized = normalizePage(page);
    await db.query(
      'INSERT INTO page_visits (user_id, page) VALUES ($1, $2)',
      [req.user.id, normalized]
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// GET /api/analytics/summary — watercommittee/superadmin only
router.get('/summary', authenticate, async (req, res) => {
  if (req.user.role !== 'watercommittee' && !req.user.isSuperadmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const [dailyRes, pagesRes, todayRes] = await Promise.all([
      db.query(`
        SELECT DATE(visited_at AT TIME ZONE 'Asia/Kolkata') AS visit_date,
               COUNT(*) AS total_visits,
               COUNT(DISTINCT user_id) AS unique_users
        FROM page_visits
        WHERE visited_at >= NOW() - INTERVAL '14 days'
        GROUP BY DATE(visited_at AT TIME ZONE 'Asia/Kolkata')
        ORDER BY visit_date DESC
      `),
      db.query(`
        SELECT page, COUNT(*) AS visits, COUNT(DISTINCT user_id) AS unique_users
        FROM page_visits
        WHERE visited_at >= NOW() - INTERVAL '30 days'
        GROUP BY page
        ORDER BY visits DESC
        LIMIT 8
      `),
      db.query(`
        SELECT COUNT(DISTINCT user_id) AS unique_users
        FROM page_visits
        WHERE DATE(visited_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
      `),
    ]);

    res.json({
      dailyVisits: dailyRes.rows,
      popularPages: pagesRes.rows.map(r => ({
        ...r,
        label: PAGE_LABELS[r.page] || r.page,
      })),
      todayUniqueUsers: parseInt(todayRes.rows[0]?.unique_users || 0),
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
