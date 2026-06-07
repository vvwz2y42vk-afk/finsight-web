const express = require('express');
const router  = express.Router();
const WaMessage = require('../models/WaMessage');
const WA = require('../utils/whatsapp');

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'barez_verify_2024';
const OWN_PHONE    = process.env.WHATSAPP_OWN_PHONE   || '966590561057';
const WA_PASSWORD  = process.env.WA_INBOX_PASSWORD    || 'barez2024';
const WA_COOKIE    = 'fs_wa';
const WA_COPTS     = { httpOnly: true, maxAge: 12 * 60 * 60 * 1000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };

// ── Auth middleware (standalone — own cookie) ─────────────
function reqAuth(req, res, next) {
  if (req.cookies?.[WA_COOKIE] === 'ok') return next();
  res.redirect('/wa-login');
}

// ── Login page ────────────────────────────────────────────
router.get('/wa-login', (req, res) => {
  if (req.cookies?.[WA_COOKIE] === 'ok') return res.redirect('/wa-inbox');
  res.render('wa-login', { error: null });
});

router.post('/wa-login', (req, res) => {
  if (req.body.password === WA_PASSWORD) {
    res.cookie(WA_COOKIE, 'ok', WA_COPTS);
    return res.redirect('/wa-inbox');
  }
  res.render('wa-login', { error: 'كلمة المرور غير صحيحة' });
});

router.get('/wa-logout', (req, res) => {
  res.clearCookie(WA_COOKIE);
  res.redirect('/wa-login');
});

// Webhook handled in server.js directly (outside dbMiddleware)

// ═══════════════════════════════════════════════════════
//  API — subscribe app to WABA (run once after setup)
// ═══════════════════════════════════════════════════════
router.get('/api/wa/subscribe', reqAuth, async (req, res) => {
  const WABA_ID = process.env.WHATSAPP_WABA_ID || '947360117882906';
  const TOKEN   = process.env.WHATSAPP_TOKEN;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${WABA_ID}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    const data = await r.json();
    console.log('[WA Subscribe]', JSON.stringify(data));
    res.json({ ok: r.ok, status: r.status, data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════
//  PAGE — /wa-inbox
// ═══════════════════════════════════════════════════════
router.get('/wa-inbox', reqAuth, (req, res) => {
  res.render('wa-inbox', { user: req.authUser });
});

// ═══════════════════════════════════════════════════════
//  API — list conversations (latest message per contact)
// ═══════════════════════════════════════════════════════
router.get('/api/wa/conversations', reqAuth, async (req, res) => {
  try {
    const convs = await WaMessage.aggregate([
      {
        $group: {
          _id: {
            $cond: [{ $eq: ['$direction', 'in'] }, '$from', '$to']
          },
          lastMsg: { $last: '$$ROOT' },
          unread:  { $sum: { $cond: [{ $and: [{ $eq: ['$direction','in'] }, { $eq: ['$read',false] }] }, 1, 0] } },
          total:   { $sum: 1 },
        }
      },
      { $sort: { 'lastMsg.sentAt': -1 } },
      { $limit: 200 }
    ]);
    res.json(convs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
//  API — get messages for a phone
// ═══════════════════════════════════════════════════════
router.get('/api/wa/messages/:phone', reqAuth, async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g,'');
    const msgs = await WaMessage.find({
      $or: [{ from: phone }, { to: phone }]
    }).sort({ sentAt: 1 }).limit(500).lean();

    // Mark as read
    await WaMessage.updateMany({ from: phone, direction: 'in', read: false }, { read: true });

    res.json(msgs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
//  API — unread count (for badge)
// ═══════════════════════════════════════════════════════
router.get('/api/wa/unread', reqAuth, async (req, res) => {
  try {
    const count = await WaMessage.countDocuments({ direction: 'in', read: false });
    res.json({ count });
  } catch(e) { res.json({ count: 0 }); }
});

// ═══════════════════════════════════════════════════════
//  API — send reply
// ═══════════════════════════════════════════════════════
router.post('/api/wa/send', reqAuth, async (req, res) => {
  try {
    const { phone, body } = req.body;
    if (!phone || !body?.trim()) return res.status(400).json({ error: 'رقم أو نص مفقود' });

    await WA.send(phone, body.trim());

    const msg = await WaMessage.create({
      from: OWN_PHONE,
      to:   phone.replace(/\D/g,''),
      body: body.trim(),
      direction: 'out',
      msgType: 'text',
      sentAt: new Date(),
      read: true,
    });

    res.json({ ok: true, msg });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DEBUG: check DB + token status ───────────────────────
router.get('/api/wa/debug', reqAuth, async (req, res) => {
  const count = await WaMessage.countDocuments();
  const last5 = await WaMessage.find().sort({ createdAt: -1 }).limit(5).lean();

  // Check token validity
  let tokenStatus = 'unknown';
  try {
    const TOKEN = process.env.WHATSAPP_TOKEN;
    const r = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${TOKEN}`);
    const d = await r.json();
    tokenStatus = r.ok ? `valid (${d.name || d.id})` : `EXPIRED/INVALID: ${d.error?.message}`;
  } catch(e) { tokenStatus = 'fetch error: ' + e.message; }

  res.json({ count, tokenStatus, last5 });
});

// ── DEBUG: inject test message ────────────────────────────
router.get('/api/wa/test-msg', reqAuth, async (req, res) => {
  try {
    const msg = await WaMessage.create({
      waMessageId: 'test_' + Date.now(),
      from: '966500000000',
      to: OWN_PHONE,
      body: 'رسالة تجريبية — اختبار النظام',
      direction: 'in',
      msgType: 'text',
      sentAt: new Date(),
      read: false,
    });
    res.json({ ok: true, msg });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
