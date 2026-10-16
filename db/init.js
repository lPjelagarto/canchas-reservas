const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function createSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await pool.query(stmt);
  }
}

async function seed() {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const hash = await bcrypt.hash(adminPassword, 12);
    const r = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Administrador', $1, $2, 'admin')
       ON CONFLICT (email) DO NOTHING`,
      [adminEmail, hash]
    );
    if (r.rowCount) console.log('Usuario administrador creado:', adminEmail);
  }

  const { rows } = await pool.query('SELECT count(*)::INT AS n FROM courts');
  if (rows[0].n === 0) {
    await pool.query(
      `INSERT INTO courts (name, type, price_per_hour) VALUES
        ('Cancha 1', 'Fútbol 5', 70000),
        ('Cancha 2', 'Fútbol 7', 100000),
        ('Cancha 3', 'Fútbol 8', 120000)`
    );
    console.log('Canchas de ejemplo creadas');
  }
}

module.exports = { createSchema, seed };
