const nodemailer = require('nodemailer');

/**
 * Envío de correo. Orden de preferencia:
 * 1) Brevo (API HTTP) si hay BREVO_API_KEY  -> funciona en hostings que bloquean SMTP
 * 2) SMTP si hay SMTP_HOST
 * 3) Consola (solo desarrollo)
 */
async function sendMail({ to, subject, html, text }) {
  const from = process.env.MAIL_FROM || 'no-reply@example.com';

  if (process.env.BREVO_API_KEY) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: from, name: 'Reservas Canchas' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) throw new Error(`Brevo respondió ${res.status}: ${await res.text()}`);
    return;
  }

  if (process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transporter.sendMail({ from, to, subject, html, text });
    return;
  }

  console.log('--- CORREO (modo consola) ---');
  console.log('Para:', to);
  console.log('Asunto:', subject);
  console.log(text);
  console.log('-----------------------------');
}

module.exports = { sendMail };
