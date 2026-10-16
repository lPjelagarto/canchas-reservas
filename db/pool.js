const { Pool, types } = require('pg');

// CockroachDB devuelve INT/COUNT como INT8 (bigint) y pg los entrega como texto.
// Los convertimos a número para que las comparaciones, sumas y horarios funcionen.
types.setTypeParser(20, (value) => parseInt(value, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('Error inesperado en el pool de BD:', err.message));

module.exports = pool;
