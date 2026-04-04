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

app.listen(PORT, async () => {
  console.log(`WaterApp API running on port ${PORT}`);
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
