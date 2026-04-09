const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const db = require('./db');

const { recalculateMonthlyRecord } = require('./helpers/recalculate');

const authRoutes = require('./routes/auth');
const blocksRoutes = require('./routes/blocks');
const monthlyRecordsRoutes = require('./routes/monthlyRecords');
const readingsRoutes = require('./routes/readings');
const commonAreasRoutes = require('./routes/commonAreas');
const billingRoutes = require('./routes/billing');
const configRoutes = require('./routes/config');
const dashboardRoutes = require('./routes/dashboard');
const exportRoutes = require('./routes/export');
const uploadRoutes = require('./routes/upload');
const pendingItemsRoutes = require('./routes/pendingItems');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/blocks', blocksRoutes);
app.use('/api/monthly-records', monthlyRecordsRoutes);
app.use('/api/readings', readingsRoutes);
app.use('/api/common-areas', commonAreasRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/config', configRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/pending-items', pendingItemsRoutes);

// Initialize default users with proper password hashes on startup
async function initUsers() {
  try {
    const result = await db.query("SELECT id FROM users WHERE username = 'plumber1'");
    if (result.rows.length > 0) {
      // Update password hashes to proper bcrypt hashes
      const hash = await bcrypt.hash('password123', 10);
      await db.query('UPDATE users SET password_hash = $1 WHERE password_hash LIKE $2', [hash, '$2b$10$8K1p%']);
      console.log('Default user passwords initialized');
    }
  } catch (err) {
    // DB may not be ready yet on first start - that's ok
    console.log('User init skipped (DB may be initializing)');
  }
}

async function migrateDB() {
  try {
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_users BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT false;
    `);
    await db.query(`
      UPDATE users SET can_manage_users = true, is_superadmin = true WHERE username = 'admin1'
    `);
    // Add guest role to enum if not present (safe: DO $$ BLOCK catches duplicate)
    await db.query(`
      DO $$ BEGIN
        ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'guest';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    // Create guest user if not exists
    const guestExists = await db.query("SELECT id FROM users WHERE username = 'guest'");
    if (guestExists.rows.length === 0) {
      const guestHash = await bcrypt.hash('guest', 10);
      await db.query(
        `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
         VALUES ('guest', $1, 'Guest', 'guest', false)`,
        [guestHash]
      );
      console.log('Guest user created');
    }

    // Create pending_items table
    await db.query(`
      CREATE TABLE IF NOT EXISTS pending_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(200) NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'general',
        priority VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
        planned_period VARCHAR(50),
        associated_cost NUMERIC(12,2),
        recurring BOOLEAN NOT NULL DEFAULT false,
        recurrence_pattern VARCHAR(50),
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','on_hold','done','cancelled')),
        progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
        worked_on_by VARCHAR(100),
        description TEXT,
        notes TEXT,
        due_date DATE,
        completed_at TIMESTAMP,
        created_by UUID REFERENCES users(id),
        updated_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('DB migration complete');
  } catch (err) {
    console.log('DB migration skipped:', err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`WaterApp API running on port ${PORT}`);
  await migrateDB();
  await initUsers();
  await backfillCalculations();
});

// Backfill cost_per_litre / total_water_input / total_water_usage for any
// existing records that are missing these values.
async function backfillCalculations() {
  try {
    const result = await db.query(`
      SELECT id, year, month FROM monthly_records
      WHERE cost_per_litre IS NULL
         OR total_water_input IS NULL
         OR total_water_usage IS NULL
      ORDER BY year ASC, month ASC
    `);
    if (result.rows.length === 0) return;

    console.log(`Backfilling calculations for ${result.rows.length} monthly record(s)...`);
    for (const record of result.rows) {
      try {
        const calc = await recalculateMonthlyRecord(record.id);
        console.log(`  ✓ ${record.year}-${String(record.month).padStart(2,'0')}: input=${calc.totalWaterInput}L, usage=${calc.totalWaterUsage}L, cost/L=${calc.costPerLitre}`);
      } catch (err) {
        console.warn(`  ✗ ${record.year}-${record.month}: ${err.message}`);
      }
    }
    console.log('Backfill complete.');
  } catch (err) {
    console.warn('Backfill skipped:', err.message);
  }
}
