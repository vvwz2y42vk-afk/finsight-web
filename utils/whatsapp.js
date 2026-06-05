const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TOKEN    = process.env.WHATSAPP_TOKEN;
const API_URL  = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;

function formatPhone(phone) {
  const clean = (phone || '').replace(/\D/g, '');
  if (clean.startsWith('966')) return clean;
  if (clean.startsWith('05'))  return '966' + clean.slice(1);
  if (clean.startsWith('5'))   return '966' + clean;
  return clean;
}

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

function msgBookingConfirmed(name, apt, building, checkIn, checkOut, total) {
  const d = d => d ? new Date(d).toLocaleDateString('ar-SA', { year:'numeric', month:'long', day:'numeric' }) : '—';
  return `مرحباً ${name} 👋

✅ *تم تأكيد حجزك*

🏠 الشقة: ${apt} — ${building}
📅 الدخول: ${d(checkIn)}
📅 الخروج: ${d(checkOut)}
💰 الإجمالي: ${(total||0).toLocaleString()} ريال

للاستفسار تواصل معنا على هذا الرقم.
_BAREZ — نظام إدارة الشقق الفندقية_`;
}

function msgCheckIn(name, apt, building) {
  return `أهلاً وسهلاً ${name} 🌟

نورتم *${building}*
🔑 شقتكم رقم: *${apt}*

نتمنى لكم إقامة سعيدة ومريحة 🏡
فريقنا في خدمتكم على مدار الساعة.
_BAREZ — نظام إدارة الشقق الفندقية_`;
}

function msgCheckOut(name, apt) {
  return `شكراً لاختياركم ${name} 🙏

نأمل أن إقامتكم في شقة *${apt}* كانت مميزة.
يسعدنا استقبالكم مجدداً في أي وقت 😊

_BAREZ — نظام إدارة الشقق الفندقية_`;
}

module.exports = { send, msgBookingConfirmed, msgCheckIn, msgCheckOut };
