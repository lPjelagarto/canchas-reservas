const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00 - ${String(h + 1).padStart(2, '0')}:00`;
const money = (n) => '$' + Number(n).toLocaleString('es-CO');
const nowText = () => new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });

function parseRange(query) {
  const from = DATE_RE.test(query.from || '') ? query.from : null;
  const to = DATE_RE.test(query.to || '') ? query.to : null;
  return { from, to };
}

const rangeText = ({ from, to }) =>
  from || to ? `Periodo: ${from || 'inicio'} a ${to || 'hoy'}` : 'Periodo: todas las fechas';

// Registra el reporte en BD y devuelve su número consecutivo (REP-00001)
async function registerReport(type, format, userId) {
  const { rows } = await pool.query(
    `INSERT INTO report_log (report_type, format, generated_by) VALUES ($1, $2, $3) RETURNING report_number`,
    [type, format, userId]
  );
  return `REP-${String(rows[0].report_number).padStart(5, '0')}`;
}

// ---------- Consultas SQL de cada reporte ----------
async function queryReservas(req) {
  const { from, to } = parseRange(req.query);
  const isAdmin = req.session.user.role === 'admin';
  const { rows } = await pool.query(
    `SELECT to_char(b.booking_date, 'YYYY-MM-DD') AS date, b.start_hour, b.price, b.status,
            c.name AS court_name, c.type AS court_type, u.name AS user_name
       FROM bookings b
       JOIN courts c ON c.id = b.court_id
       JOIN users u ON u.id = b.user_id
      WHERE b.status = 'confirmada'
        AND ($1::UUID IS NULL OR b.user_id = $1::UUID)
        AND ($2::DATE IS NULL OR b.booking_date >= $2::DATE)
        AND ($3::DATE IS NULL OR b.booking_date <= $3::DATE)
      ORDER BY b.booking_date, b.start_hour`,
    [isAdmin ? null : req.session.user.id, from, to]
  );
  const data = rows.map((r, i) => ({
    n: i + 1,
    date: r.date,
    hours: hourLabel(r.start_hour),
    court: `${r.court_name} (${r.court_type})`,
    user: r.user_name,
    price: r.price,
  }));
  return {
    title: 'Reporte de reservas confirmadas',
    type: 'reservas',
    scope: isAdmin ? 'Alcance: todas las reservas' : 'Alcance: mis reservas',
    range: rangeText({ from, to }),
    columns: [
      { label: '#', key: 'n', w: 30, xw: 6, kind: 'int' },
      { label: 'Fecha', key: 'date', w: 80, xw: 13 },
      { label: 'Horario', key: 'hours', w: 100, xw: 17 },
      { label: 'Cancha', key: 'court', w: 170, xw: 28 },
      { label: 'Cliente', key: 'user', w: 150, xw: 24 },
      { label: 'Valor', key: 'price', w: 100, xw: 16, kind: 'money' },
    ],
    rows: data,
    summary: [
      `Total de reservas confirmadas: ${data.length}`,
      `Ingresos: ${money(data.reduce((s, r) => s + r.price, 0))}`,
    ],
  };
}

async function queryIngresos(req) {
  const { from, to } = parseRange(req.query);
  const { rows } = await pool.query(
    `SELECT c.name, c.type,
            COUNT(b.id)::INT AS total,
            (COUNT(b.id) FILTER (WHERE b.status = 'confirmada'))::INT AS confirmed,
            (COUNT(b.id) FILTER (WHERE b.status = 'cancelada'))::INT AS cancelled,
            COALESCE(SUM(b.price) FILTER (WHERE b.status = 'confirmada'), 0)::INT AS income
       FROM courts c
       LEFT JOIN bookings b
              ON b.court_id = c.id
             AND ($1::DATE IS NULL OR b.booking_date >= $1::DATE)
             AND ($2::DATE IS NULL OR b.booking_date <= $2::DATE)
      GROUP BY c.id, c.name, c.type
      ORDER BY income DESC, c.name`,
    [from, to]
  );
  const data = rows.map((r, i) => ({ n: i + 1, ...r }));
  const sum = (k) => data.reduce((s, r) => s + r[k], 0);
  return {
    title: 'Reporte estadístico de ingresos por cancha',
    type: 'ingresos',
    scope: 'Alcance: todas las canchas',
    range: rangeText({ from, to }),
    columns: [
      { label: '#', key: 'n', w: 30, xw: 6, kind: 'int' },
      { label: 'Cancha', key: 'name', w: 190, xw: 24 },
      { label: 'Tipo', key: 'type', w: 90, xw: 14 },
      { label: 'Reservas', key: 'total', w: 90, xw: 12, kind: 'int' },
      { label: 'Confirmadas', key: 'confirmed', w: 100, xw: 14, kind: 'int' },
      { label: 'Canceladas', key: 'cancelled', w: 100, xw: 14, kind: 'int' },
      { label: 'Ingresos', key: 'income', w: 110, xw: 16, kind: 'money' },
    ],
    rows: data,
    summary: [
      `Total de reservas: ${sum('total')}`,
      `Confirmadas: ${sum('confirmed')} · Canceladas: ${sum('cancelled')}`,
      `Ingresos totales: ${money(sum('income'))}`,
    ],
  };
}

// ---------- Generadores ----------
function sendPdf(res, report, code, user) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${code}-${report.type}.pdf"`);

  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape', bufferPages: true });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(18).text(report.title);
  doc.font('Helvetica').fontSize(10).fillColor('#444');
  doc.text(`Reporte N.º: ${code}`);
  doc.text(`Fecha de generación: ${nowText()}`);
  doc.text(`Generado por: ${user.name} (${user.role})`);
  doc.text(report.scope);
  doc.text(report.range);
  doc.moveDown().fillColor('#000');

  const drawRow = (vals, bold) => {
    let x = 40;
    const y = doc.y;
    if (bold) doc.rect(40, y - 3, report.columns.reduce((s, c) => s + c.w, 0), 16).fill('#e6efe9').fillColor('#000');
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    vals.forEach((v, i) => {
      doc.text(String(v), x + 2, y, { width: report.columns[i].w - 6, lineBreak: false, ellipsis: true });
      x += report.columns[i].w;
    });
    doc.y = y + 16;
  };

  const header = () => drawRow(report.columns.map((c) => c.label), true);
  header();
  if (report.rows.length === 0) {
    doc.font('Helvetica-Oblique').text('Sin información para los filtros seleccionados.', 42);
  }
  report.rows.forEach((r) => {
    if (doc.y > 510) {
      doc.addPage();
      header();
    }
    drawRow(report.columns.map((c) => (c.kind === 'money' ? money(r[c.key]) : r[c.key])), false);
  });

  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(10);
  report.summary.forEach((line) => doc.text(line, 42));

  // Numeración de páginas
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#666');
    doc.text(`${code} · Página ${i + 1} de ${range.count}`, 40, doc.page.height - 30, {
      width: doc.page.width - 80,
      align: 'right',
      lineBreak: false,
    });
  }
  doc.end();
}

async function sendXlsx(res, report, code, user) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Reservas Canchas';
  wb.created = new Date();
  const ws = wb.addWorksheet('Reporte');
  report.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.xw;
  });

  ws.addRow([report.title]).font = { bold: true, size: 14 };
  ws.addRow([`Reporte N.º: ${code}`]);
  ws.addRow([`Fecha de generación: ${nowText()}`]);
  ws.addRow([`Generado por: ${user.name} (${user.role})`]);
  ws.addRow([report.scope]);
  ws.addRow([report.range]);
  ws.addRow([]);

  const headerRow = ws.addRow(report.columns.map((c) => c.label));
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B7F3B' } };

  report.rows.forEach((r) => {
    const row = ws.addRow(report.columns.map((c) => r[c.key]));
    report.columns.forEach((c, i) => {
      if (c.kind === 'money') row.getCell(i + 1).numFmt = '"$"#,##0';
    });
  });

  ws.addRow([]);
  report.summary.forEach((line) => (ws.addRow([line]).font = { bold: true }));
  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${code}-${report.type}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

// ---------- Rutas ----------
// Reporte 1: reservas (admin: todas; cliente: las suyas)
router.get('/reservas.pdf', async (req, res, next) => {
  try {
    const report = await queryReservas(req);
    const code = await registerReport('reservas', 'pdf', req.session.user.id);
    sendPdf(res, report, code, req.session.user);
  } catch (e) {
    next(e);
  }
});

router.get('/reservas.xlsx', async (req, res, next) => {
  try {
    const report = await queryReservas(req);
    const code = await registerReport('reservas', 'xlsx', req.session.user.id);
    await sendXlsx(res, report, code, req.session.user);
  } catch (e) {
    next(e);
  }
});

// Reporte 2: estadístico de ingresos por cancha (solo admin)
router.get('/ingresos.pdf', requireRole('admin'), async (req, res, next) => {
  try {
    const report = await queryIngresos(req);
    const code = await registerReport('ingresos', 'pdf', req.session.user.id);
    sendPdf(res, report, code, req.session.user);
  } catch (e) {
    next(e);
  }
});

router.get('/ingresos.xlsx', requireRole('admin'), async (req, res, next) => {
  try {
    const report = await queryIngresos(req);
    const code = await registerReport('ingresos', 'xlsx', req.session.user.id);
    await sendXlsx(res, report, code, req.session.user);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
