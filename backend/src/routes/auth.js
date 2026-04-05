const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate, authorize, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await db.query(
      'SELECT id, username, password_hash, full_name, role, is_active, must_change_password, can_manage_users, is_superadmin FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, fullName: user.full_name,
        canManageUsers: !!user.can_manage_users, isSuperadmin: !!user.is_superadmin },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role,
              canManageUsers: !!user.can_manage_users, isSuperadmin: !!user.is_superadmin },
      mustChangePassword: user.must_change_password === true,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, username, full_name, role FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/users (users with can_manage_users or superadmin)
router.get('/users', authenticate, async (req, res) => {
  try {
    // Check permission from DB (not just JWT) for sensitive operations
    const perm = await db.query('SELECT can_manage_users, is_superadmin FROM users WHERE id = $1', [req.user.id]);
    if (perm.rows.length === 0 || (!perm.rows[0].can_manage_users && !perm.rows[0].is_superadmin)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const result = await db.query(
      'SELECT id, username, full_name, role, is_active, can_manage_users, is_superadmin, created_at FROM users ORDER BY created_at'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/users (users with can_manage_users or superadmin - create user)
router.post('/users', authenticate, async (req, res) => {
  try {
    const perm = await db.query('SELECT can_manage_users, is_superadmin FROM users WHERE id = $1', [req.user.id]);
    if (perm.rows.length === 0 || (!perm.rows[0].can_manage_users && !perm.rows[0].is_superadmin)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { username, password, fullName, role } = req.body;
    if (!username || !password || !fullName || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!['plumber', 'accountant', 'watercommittee'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (username, password_hash, full_name, role, must_change_password) VALUES ($1, $2, $3, $4, true) RETURNING id, username, full_name, role',
      [username, passwordHash, fullName, role]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/change-password (any authenticated user)
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const result = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2',
      [newHash, req.user.id]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/users/:id/reset-password (superadmin only)
router.post('/users/:id/reset-password', authenticate, async (req, res) => {
  try {
    const perm = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [req.user.id]);
    if (perm.rows.length === 0 || !perm.rows[0].is_superadmin) {
      return res.status(403).json({ error: 'Only superadmin can reset passwords' });
    }

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const target = await db.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = true, updated_at = NOW() WHERE id = $2',
      [hash, req.params.id]
    );

    res.json({ message: 'Password reset successfully. User will be prompted to change it on next login.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/auth/users/:id/permissions (superadmin only — delegate can_manage_users)
router.put('/users/:id/permissions', authenticate, async (req, res) => {
  try {
    const perm = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [req.user.id]);
    if (perm.rows.length === 0 || !perm.rows[0].is_superadmin) {
      return res.status(403).json({ error: 'Only superadmin can change permissions' });
    }

    // Cannot change own superadmin permissions
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot modify your own permissions' });
    }

    const { canManageUsers } = req.body;
    if (typeof canManageUsers !== 'boolean') {
      return res.status(400).json({ error: 'canManageUsers must be a boolean' });
    }

    const result = await db.query(
      'UPDATE users SET can_manage_users = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, full_name, can_manage_users',
      [canManageUsers, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
