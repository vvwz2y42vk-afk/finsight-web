let nodemailer;
try { nodemailer = require('nodemailer'); } catch { nodemailer = null; }

async function sendEmail({ to, subject, html }) {
  if (!to || to === 'no-email') {
    console.log(`\n📧 [بريد — لا يوجد مستلم]\n${subject}\n`);
    return false;
  }
  if (!process.env.SMTP_HOST) {
    console.log(`\n📧 [DEV — SMTP غير مضبوط]\nإلى: ${to}\nالموضوع: ${subject}\n${html.replace(/<[^>]+>/g, '')}\n`);
    return false;
  }
  if (!nodemailer) {
    console.warn('nodemailer غير مثبّت — شغّل: npm install nodemailer');
    return false;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    from: `BAREZ <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to, subject, html,
  });
  return true;
}

module.exports = { sendEmail };
