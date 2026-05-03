// One-off script: ensure admin1 has superadmin flags set
const db = require('../db');

async function run() {
  try {
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_users BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT false;
    `);
    const result = await db.query(
      `UPDATE users SET can_manage_users = true, is_superadmin = true
       WHERE username = 'admin1'
       RETURNING username, can_manage_users, is_superadmin`
    );
    if (result.rows.length > 0) {
      console.log('admin1 updated:', JSON.stringify(result.rows[0]));
    } else {
      console.warn('WARNING: admin1 user not found in DB');
      const all = await db.query('SELECT username, role, can_manage_users, is_superadmin FROM users ORDER BY created_at');
      console.log('All users:', JSON.stringify(all.rows));
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

run();
