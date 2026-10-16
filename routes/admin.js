const express = require('express');
const pool = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COURT_TYPES = ['Fútbol 5', 'Fútbol 7', 'Fútbol 8'];

router.get('/', async (req, res, next) => {
  try {
    const [courts, bookings, users, income] = await Promise.all([
      pool.query(
        `SELECT id, name, type, price_per_hour AS "pricePerHour", active FROM courts ORDER BY name`
      ),
      pool.query(
        `SELECT b.id, to_char(b.booking_date, 'YYYY-MM-DD') AS date, b.start_hour AS "startHour",
                b.price, b.status, c.name AS "courtName", u.name AS "userName"
           FROM bookings b
           JOIN courts c ON c.id = b.court_id
           JOIN users u ON u.id = b.user_id
          ORDER BY b.booking_date DESC, b.start_hour DESC
          LIMIT 50`
      ),
      pool.query(`SELECT id, name, email, role FROM users ORDER BY created_at DESC`),
      pool.query(`SELECT COALESCE(SUM(price), 0)::INT AS total FROM bookings WHERE status = 'confirmada'`),
    ]);
    res.render('admin', {
      title: 'Administración',
      courts: courts.rows,
      bookings: bookings.rows,
      users: users.rows,
      income: income.rows[0].total,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/canchas', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const type = req.body.type;
    const pricePerHour = Number(req.body.pricePerHour);
    if (!name || !COURT_TYPES.includes(type) || !Number.isInteger(pricePerHour) || pricePerHour < 0) {
      req.session.flash = { type: 'error', text: 'Datos de cancha inválidos.' };
      return res.redirect('/admin');
    }
    try {
      await pool.query('INSERT INTO courts (name, type, price_per_hour) VALUES ($1, $2, $3)', [
        name,
        type,
        pricePerHour,
      ]);
      req.session.flash = { type: 'ok', text: 'Cancha creada.' };
    } catch (err) {
      if (err.code !== '23505') throw err;
      req.session.flash = { type: 'error', text: 'Ya existe una cancha con ese nombre.' };
    }
    res.redirect('/admin');
  } catch (e) {
    next(e);
  }
});

router.post('/canchas/:id/estado', async (req, res, next) => {
  try {
    if (UUID_RE.test(req.params.id)) {
      await pool.query('UPDATE courts SET active = NOT active WHERE id = $1', [req.params.id]);
    }
    res.redirect('/admin');
  } catch (e) {
    next(e);
  }
});

router.post('/usuarios/:id/rol', async (req, res, next) => {
  try {
    const { id } = req.params;
    const role = req.body.role;
    if (!UUID_RE.test(id) || !['cliente', 'admin'].includes(role)) return res.redirect('/admin');
    if (id === req.session.user.id) {
      req.session.flash = { type: 'error', text: 'No puedes cambiar tu propio rol.' };
      return res.redirect('/admin');
    }
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
    req.session.flash = { type: 'ok', text: 'Rol actualizado.' };
    res.redirect('/admin');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
