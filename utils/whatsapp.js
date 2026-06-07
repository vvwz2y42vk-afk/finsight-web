const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TOKEN    = process.env.WHATSAPP_TOKEN;
const API_URL  = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;

function formatPhone(phone) {
  const clean = (phone || '').replace(/\D/g, '');
  if (clean.startsWith('966')) return clean;
  if (clean.startsWith('05'))  return '966' + clean.slice(1);
  if (clean.startsWith('5'))   return '966' + clean;
  return clean;
}

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
}

function param(text) {
  return { type: 'text', text: String(text) };
}

async function sendTemplate(phone, templateName, params) {
  if (!PHONE_ID || !TOKEN) { console.warn('[WA] missing PHONE_ID or TOKEN'); return; }
  const to = formatPhone(phone);
  if (!to || to.length < 10) { console.warn('[WA] invalid phone:', phone); return; }
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'ar' },
          components: [{
            type: 'body',
            parameters: params.map(param),
          }],
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) console.error('[WA] error:', templateName, 'to:', to, JSON.stringify(data));
    else console.log('[WA] sent:', templateName, '->', to);
  } catch(e) { console.error('[WA] fetch error:', e.message); }
}

// للرسائل النصية العادية (داخل نافذة الـ 24 ساعة فقط)
async function send(phone, body) {
  if (!PHONE_ID || !TOKEN) return;
  const to = formatPhone(phone);
  if (!to || to.length < 10) return;
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body, preview_url: false },
      }),
    });
  } catch(e) { /* fire and forget */ }
}

async function sendBookingConfirmed(phone, name, apt, building, checkIn, checkOut, total) {
  return sendTemplate(phone, 'barez_booking_confirmed', [
    name,
    apt,
    building,
    formatDate(checkIn),
    formatDate(checkOut),
    `${(total || 0).toLocaleString('ar-SA')}`,
  ]);
}

async function sendCheckIn(phone, name, building, apt) {
  return sendTemplate(phone, 'barez_check_in', [name, building, apt]);
}

async function sendCheckOut(phone, name, apt) {
  return sendTemplate(phone, 'barez_check_out', [name, apt]);
}

async function sendCheckoutReminder(phone, name, apt) {
  return sendTemplate(phone, 'barez_reminder_v1', [name, apt]);
}

module.exports = { send, sendBookingConfirmed, sendCheckIn, sendCheckOut, sendCheckoutReminder };
