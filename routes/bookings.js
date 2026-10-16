const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const OPEN_HOUR = 8; // primera hora de inicio
const CLOSE_HOUR = 22; // la última reserva empieza a las 21:00
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_AHEAD = 30; // se puede reservar hasta 30 días después de hoy
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bogotaNow() {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const hour = Number(
    now.toLocaleTimeString('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', hour12: false }).slice(0, 2)
  );
  return { date, hour };
}

// Fecha real válida (descarta 2026-02-31, etc.)
function isRealDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Suma días a una fecha YYYY-MM-DD
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Listado de canchas con selector de fecha
router.get('/canchas', requireAuth, async (req, res, next) => {
  try {
    const { rows: courts } = await pool.query(
      `SELECT id, name, type, price_per_hour AS "pricePerHour" FROM courts WHERE active ORDER BY name`
    );
    const now = bogotaNow();
    const today = now.date;
    const tomorrow = addDays(today, 1);
    const dayAfter = addDays(today, 2);
    const maxDate = addDays(today, MAX_DAYS_AHEAD);
    // Si ya no quedan horarios hoy (la última hora de inicio es CLOSE_HOUR - 1), se propone mañana
    const defaultDate = now.hour >= CLOSE_HOUR - 1 ? tomorrow : today;
    const date =
      isRealDate(req.query.date) && req.query.date >= today && req.query.date <= maxDate
        ? req.query.date
        : defaultDate;
    res.render('courts', { title: 'Canchas', courts, date, today, tomorrow, dayAfter, maxDate });
  } catch (e) {
    next(e);
  }
});

// Disponibilidad de una cancha en una fecha
router.get('/reservas/nueva', requireAuth, async (req, res, next) => {
  try {
    const { court: courtId, date } = req.query;
    const now = bogotaNow();
    if (
      !UUID_RE.test(courtId || '') ||
      !isRealDate(date) ||
      date < now.date ||
      date > addDays(now.date, MAX_DAYS_AHEAD)
    )
      return res.redirect('/canchas');

    const { rows } = await pool.query(
      `SELECT id, name, type, price_per_hour AS "pricePerHour" FROM courts WHERE id = $1 AND active`,
      [courtId]
    );
    const court = rows[0];
    if (!court) return res.redirect('/canchas');

    const { rows: taken } = await pool.query(
      `SELECT start_hour FROM bookings WHERE court_id = $1 AND booking_date = $2 AND status = 'confirmada'`,
      [court.id, date]
    );
    const takenSet = new Set(taken.map((b) => b.start_hour));

    const slots = [];
    for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
      const past = date === now.date && h <= now.hour;
      slots.push({ hour: h, available: !takenSet.has(h) && !past });
    }
    res.render('book', { title: 'Reservar', court, date, slots });
  } catch (e) {
    next(e);
  }
});

// Crear reserva
router.post('/reservas', requireAuth, async (req, res, next) => {
  try {
    const { court: courtId, date } = req.body;
    const startHour = Number(req.body.startHour);
    const now = bogotaNow();

    const invalid =
      !UUID_RE.test(courtId || '') ||
      !isRealDate(date) ||
      !Number.isInteger(startHour) ||
      startHour < OPEN_HOUR ||
      startHour >= CLOSE_HOUR ||
      date < now.date ||
      date > addDays(now.date, MAX_DAYS_AHEAD) ||
      (date === now.date && startHour <= now.hour);
    if (invalid) {
      req.session.flash = { type: 'error', text: 'Datos de reserva inválidos.' };
      return res.redirect('/canchas');
    }

    const { rows } = await pool.query('SELECT id, price_per_hour FROM courts WHERE id = $1 AND active', [courtId]);
    const court = rows[0];
    if (!court) {
      req.session.flash = { type: 'error', text: 'La cancha no está disponible.' };
      return res.redirect('/canchas');
    }

    try {
      await pool.query(
        `INSERT INTO bookings (user_id, court_id, booking_date, start_hour, price)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.session.user.id, court.id, date, startHour, court.price_per_hour]
      );
    } catch (err) {
      if (err.code === '23505') {
        req.session.flash = { type: 'error', text: 'Ese horario ya fue reservado. Elige otro.' };
        return res.redirect(`/reservas/nueva?court=${courtId}&date=${date}`);
      }
      throw err;
    }

    req.session.flash = { type: 'ok', text: 'Reserva confirmada.' };
    res.redirect('/mis-reservas');
  } catch (e) {
    next(e);
  }
});

// Mis reservas
router.get('/mis-reservas', requireAuth, async (req, res, next) => {
  try {
    const { rows: bookings } = await pool.query(
      `SELECT b.id, to_char(b.booking_date, 'YYYY-MM-DD') AS date, b.start_hour AS "startHour",
              b.price, b.status, c.name AS "courtName", c.type AS "courtType"
         FROM bookings b
         JOIN courts c ON c.id = b.court_id
        WHERE b.user_id = $1
        ORDER BY b.booking_date DESC, b.start_hour DESC`,
      [req.session.user.id]
    );
    res.render('my-bookings', { title: 'Mis reservas', bookings, today: bogotaNow().date });
  } catch (e) {
    next(e);
  }
});

// Cancelar (el dueño o un admin)
router.post('/reservas/:id/cancelar', requireAuth, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.redirect('/mis-reservas');
    const user = req.session.user;
    const { rows } = await pool.query('SELECT user_id FROM bookings WHERE id = $1', [req.params.id]);
    const booking = rows[0];
    const allowed = booking && (booking.user_id === user.id || user.role === 'admin');
    if (!allowed) {
      return res.status(403).render('error', { title: 'Acceso denegado', message: 'No puedes cancelar esta reserva.' });
    }
    await pool.query(`UPDATE bookings SET status = 'cancelada' WHERE id = $1`, [req.params.id]);
    req.session.flash = { type: 'ok', text: 'Reserva cancelada.' };
    res.redirect(user.role === 'admin' && req.body.from === 'admin' ? '/admin' : '/mis-reservas');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
