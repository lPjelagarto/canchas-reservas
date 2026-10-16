-- Consultas SQL del proyecto (CRUD + consultas de reportes)
-- Se pueden ejecutar en el SQL Shell de CockroachDB Cloud como evidencia.

-- ===================== CREATE =====================
INSERT INTO courts (name, type, price_per_hour) VALUES ('Cancha 4', 'Fútbol 5', 80000);

INSERT INTO users (name, email, password_hash, role)
VALUES ('Usuario Demo', 'demo@example.com', '$2a$12$hash-de-ejemplo', 'cliente');

INSERT INTO bookings (user_id, court_id, booking_date, start_hour, price)
SELECT u.id, c.id, current_date + 1, 18, c.price_per_hour
  FROM users u, courts c
 WHERE u.email = 'demo@example.com' AND c.name = 'Cancha 4';

-- ===================== READ =====================
-- Reservas con datos de cancha y cliente (JOIN)
SELECT b.id, b.booking_date, b.start_hour, b.status, c.name AS cancha, u.name AS cliente, b.price
  FROM bookings b
  JOIN courts c ON c.id = b.court_id
  JOIN users u ON u.id = b.user_id
 ORDER BY b.booking_date, b.start_hour;

-- Horarios ocupados de una cancha en una fecha
SELECT start_hour FROM bookings
 WHERE court_id = (SELECT id FROM courts WHERE name = 'Cancha 4')
   AND booking_date = current_date + 1
   AND status = 'confirmada';

-- Reporte estadístico: ingresos por cancha (GROUP BY + FILTER)
SELECT c.name, c.type,
       COUNT(b.id) AS reservas,
       COUNT(b.id) FILTER (WHERE b.status = 'confirmada') AS confirmadas,
       COUNT(b.id) FILTER (WHERE b.status = 'cancelada') AS canceladas,
       COALESCE(SUM(b.price) FILTER (WHERE b.status = 'confirmada'), 0) AS ingresos
  FROM courts c
  LEFT JOIN bookings b ON b.court_id = c.id
 GROUP BY c.id, c.name, c.type
 ORDER BY ingresos DESC;

-- Clientes con más reservas
SELECT u.name, COUNT(*) AS reservas
  FROM users u JOIN bookings b ON b.user_id = u.id
 WHERE b.status = 'confirmada'
 GROUP BY u.id, u.name
 ORDER BY reservas DESC
 LIMIT 5;

-- Bitácora de reportes generados
SELECT 'REP-' || lpad(report_number::STRING, 5, '0') AS reporte, report_type, format, created_at
  FROM report_log ORDER BY report_number DESC;

-- ===================== UPDATE =====================
UPDATE courts SET price_per_hour = 85000 WHERE name = 'Cancha 4';
UPDATE bookings SET status = 'cancelada'
 WHERE user_id = (SELECT id FROM users WHERE email = 'demo@example.com');

-- ===================== DELETE =====================
-- Un usuario se elimina con sus reservas (ON DELETE CASCADE)
DELETE FROM users WHERE email = 'demo@example.com';
-- Una cancha con reservas NO se puede eliminar (ON DELETE RESTRICT): se desactiva con active = false
DELETE FROM courts WHERE name = 'Cancha 4';

-- ===================== PRUEBAS DE INTEGRIDAD =====================
-- Cada una de estas sentencias debe FALLAR (evidencia de restricciones)
-- 1) Rol inválido (CHECK)
INSERT INTO users (name, email, password_hash, role) VALUES ('X', 'x@example.com', 'h', 'superuser');
-- 2) Correo duplicado (UNIQUE)
INSERT INTO users (name, email, password_hash) SELECT name, email, password_hash FROM users LIMIT 1;
-- 3) Cancha inexistente (FOREIGN KEY)
INSERT INTO bookings (user_id, court_id, booking_date, start_hour, price)
VALUES ((SELECT id FROM users LIMIT 1), gen_random_uuid(), current_date, 10, 1000);
-- 4) Hora fuera de rango (CHECK)
INSERT INTO bookings (user_id, court_id, booking_date, start_hour, price)
VALUES ((SELECT id FROM users LIMIT 1), (SELECT id FROM courts LIMIT 1), current_date, 30, 1000);
