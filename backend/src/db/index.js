const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://waterapp:waterapp_secret@localhost:5432/waterapp',
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
