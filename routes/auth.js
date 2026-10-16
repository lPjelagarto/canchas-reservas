const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { sendMail } = require('../services/mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'La contraseña debe incluir letras y números.';
  return null;
}

function loginUser(req, user, cb) {
  // regenerate evita fijación de sesión
  req.session.regenerate((err) => {
    if (err) return cb(err);
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    cb(null);
  });
}

// ---------- Registro ----------
router.get('/registro', (req, res) => {
  if (req.session.user) return res.redirect('/canchas');
  res.render('register', { title: 'Registro', form: {} });
});

router.post('/registro', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const { password, password2 } = req.body;
    const form = { name, email };

    let error = null;
    if (!name || name.length > 80) error = 'El nombre es obligatorio (máximo 80 caracteres).';
    else if (!EMAIL_RE.test(email)) error = 'Correo electrónico inválido.';
    else if (password !== password2) error = 'Las contraseñas no coinciden.';
    else error = validatePassword(password);
    if (error) return res.status(400).render('register', { title: 'Registro', form, error });

    let user;
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'cliente')
         RETURNING id, name, email, role`,
        [name, email, await bcrypt.hash(password, 12)]
      );
      user = rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res
          .status(400)
          .render('register', { title: 'Registro', form, error: 'Ya existe una cuenta con ese correo.' });
      }
      throw err;
    }

    loginUser(req, user, (err) => {
      if (err) return next(err);
      req.session.flash = { type: 'ok', text: '¡Cuenta creada! Bienvenido.' };
      res.redirect('/canchas');
    });
  } catch (e) {
    next(e);
  }
});

// ---------- Login / Logout ----------
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/canchas');
  res.render('login', { title: 'Iniciar sesión', form: {} });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const { rows } = await pool.query(
      'SELECT id, name, email, role, password_hash FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];
    const ok = user && (await bcrypt.compare(req.body.password || '', user.password_hash));
    if (!ok) {
      return res
        .status(401)
        .render('login', { title: 'Iniciar sesión', form: { email }, error: 'Correo o contraseña incorrectos.' });
    }
    loginUser(req, user, (err) => {
      if (err) return next(err);
      res.redirect(user.role === 'admin' ? '/admin' : '/canchas');
    });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('canchas.sid');
    res.redirect('/login');
  });
});

// ---------- Recuperación de contraseña ----------
router.get('/olvide-contrasena', (req, res) => {
  res.render('forgot', { title: 'Recuperar contraseña', sent: false });
});

router.post('/olvide-contrasena', async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const { rows } = EMAIL_RE.test(email)
      ? await pool.query('SELECT id, name, email FROM users WHERE email = $1', [email])
      : { rows: [] };
    const user = rows[0];

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      // En BD solo se guarda el hash del token; vence en 1 hora
      await pool.query(
        `UPDATE users SET reset_token_hash = $1, reset_token_expires = now() + INTERVAL '1 hour' WHERE id = $2`,
        [hashToken(token), user.id]
      );

      const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/restablecer/${token}`;
      try {
        await sendMail({
          to: user.email,
          subject: 'Recuperación de contraseña - Reservas Canchas',
          text: `Hola ${user.name}. Para crear una nueva contraseña ingresa a: ${link} (válido por 1 hora). Si no lo solicitaste, ignora este correo.`,
          html: `<p>Hola ${user.name},</p><p>Para crear una nueva contraseña haz clic aquí:</p><p><a href="${link}">${link}</a></p><p>El enlace es válido por 1 hora. Si no lo solicitaste, ignora este correo.</p>`,
        });
      } catch (mailErr) {
        console.error('No se pudo enviar el correo:', mailErr.message);
      }
    }
    // Misma respuesta exista o no el correo (evita enumeración de usuarios)
    res.render('forgot', { title: 'Recuperar contraseña', sent: true });
  } catch (e) {
    next(e);
  }
});

async function findByResetToken(token) {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE reset_token_hash = $1 AND reset_token_expires > now()',
    [hashToken(token)]
  );
  return rows[0];
}

const invalidLink = (res) =>
  res.status(400).render('error', { title: 'Enlace inválido', message: 'El enlace es inválido o ha expirado.' });

router.get('/restablecer/:token', async (req, res, next) => {
  try {
    if (!(await findByResetToken(req.params.token))) return invalidLink(res);
    res.render('reset', { title: 'Nueva contraseña', token: req.params.token });
  } catch (e) {
    next(e);
  }
});

router.post('/restablecer/:token', async (req, res, next) => {
  try {
    const user = await findByResetToken(req.params.token);
    if (!user) return invalidLink(res);

    const { password, password2 } = req.body;
    const error = password !== password2 ? 'Las contraseñas no coinciden.' : validatePassword(password);
    if (error) return res.status(400).render('reset', { title: 'Nueva contraseña', token: req.params.token, error });

    await pool.query(
      `UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2`,
      [await bcrypt.hash(password, 12), user.id]
    );

    req.session.flash = { type: 'ok', text: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
    res.redirect('/login');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
