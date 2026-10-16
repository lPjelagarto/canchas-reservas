-- Esquema relacional para CockroachDB (compatible con PostgreSQL)
-- Se ejecuta de forma idempotente al arrancar la aplicación.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name STRING NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  email STRING NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash STRING NOT NULL,
  role STRING NOT NULL DEFAULT 'cliente' CHECK (role IN ('cliente', 'admin')),
  reset_token_hash STRING,
  reset_token_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name STRING NOT NULL UNIQUE,
  type STRING NOT NULL CHECK (type IN ('Fútbol 5', 'Fútbol 7', 'Fútbol 8')),
  price_per_hour INT NOT NULL CHECK (price_per_hour >= 0),
  active BOOL NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  court_id UUID NOT NULL REFERENCES courts (id) ON DELETE RESTRICT,
  booking_date DATE NOT NULL,
  start_hour INT NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  price INT NOT NULL CHECK (price >= 0),
  status STRING NOT NULL DEFAULT 'confirmada' CHECK (status IN ('confirmada', 'cancelada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una cancha no puede tener dos reservas confirmadas en el mismo día y hora
CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_uq
  ON bookings (court_id, booking_date, start_hour) WHERE status = 'confirmada';

CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id);

CREATE SEQUENCE IF NOT EXISTS report_number_seq;

-- Bitácora de reportes: da numeración única a cada reporte generado
CREATE TABLE IF NOT EXISTS report_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number INT NOT NULL DEFAULT nextval('report_number_seq'),
  report_type STRING NOT NULL CHECK (report_type IN ('reservas', 'ingresos')),
  format STRING NOT NULL CHECK (format IN ('pdf', 'xlsx')),
  generated_by UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Almacén de sesiones (connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid STRING PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
