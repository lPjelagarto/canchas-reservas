require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');

const pool = require('./db/pool');
const { createSchema, seed } = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('Falta la variable DATABASE_URL (cadena de conexión de CockroachDB)');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error('Falta la variable SESSION_SECRET');
  process.exit(1);
}

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    name: 'canchas.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

// Variables disponibles en todas las vistas + mensajes flash
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/bookings'));
app.use('/admin', require('./routes/admin'));
app.use('/reportes', require('./routes/reports'));

app.get('/', (req, res) => res.render('home', { title: 'Inicio' }));
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'No encontrado', message: 'La página no existe.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: 'Ocurrió un error inesperado.' });
});

(async () => {
  try {
    await createSchema();
    await seed();
    app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
  } catch (err) {
    console.error('Error inicializando la base de datos:', err.message);
    process.exit(1);
  }
})();
