-- Comandos para capturar la EVIDENCIA de la implementación real en CockroachDB.
-- Ejecútalos en CockroachDB Cloud > SQL Shell (o `cockroach sql`) y toma capturas de pantalla.

SHOW DATABASES;
SHOW TABLES;

-- Estructura, PK, FK y restricciones de cada tabla
SHOW CREATE TABLE users;
SHOW CREATE TABLE courts;
SHOW CREATE TABLE bookings;
SHOW CREATE TABLE report_log;

-- Claves foráneas y restricciones
SHOW CONSTRAINTS FROM bookings;
SHOW CONSTRAINTS FROM report_log;
SHOW INDEXES FROM bookings;

-- Datos reales
SELECT count(*) AS usuarios FROM users;
SELECT count(*) AS canchas FROM courts;
SELECT count(*) AS reservas FROM bookings;

-- Naturaleza distribuida: nodos y rangos replicados
SHOW RANGES FROM TABLE bookings;
SHOW REGIONS FROM DATABASE canchas;
