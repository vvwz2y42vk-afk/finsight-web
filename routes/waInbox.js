const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../utils/auth');
const WaMessage = require('../models/WaMessage');
const WA = require('../utils/whatsapp');

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'barez_verify_2024';
const OWN_PHONE    = process.env.WHATSAPP_OWN_PHONE   || '966590561057'; // رقم بارز

// ── Auth middleware (admin or staff) ─────────────────────
function reqAuth(req, res, next) {
  req.authUser = verifyToken(req.cookies?.fs_auth) || verifyToken(req.cookies?.fs_staff) || null;
  if (!req.authUser) return res.redirect('/staff/login');
  next();
}

// ═══════════════════════════════════════════════════════
//  WEBHOOK — Meta verification (GET)
// ═══════════════════════════════════════════════════════
router.get('/webhooks/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.send(challenge);
  res.sendStatus(403);
});

// ═══════════════════════════════════════════════════════
//  WEBHOOK — receive messages (POST)
// ═══════════════════════════════════════════════════════
router.post('/webhooks/whatsapp', express.json(), async (req, res) => {
  res.sendStatus(200); // always 200 fast
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    if (!change) return;

    const messages = change.messages || [];
    const contacts = change.contacts || [];

    for (const msg of messages) {
      const from = msg.from;
      const waMessageId = msg.id;
      const sentAt = new Date(Number(msg.timestamp) * 1000);
      let body = '';
      let msgType = msg.type;

      if (msg.type === 'text')       body = msg.text?.body || '';
      else if (msg.type === 'image') body = msg.image?.caption || '[صورة]';
      else if (msg.type === 'document') body = msg.document?.filename || '[ملف]';
      else if (msg.type === 'audio') body = '[تسجيل صوتي]';
      else if (msg.type === 'video') body = '[فيديو]';
      else if (msg.type === 'sticker') body = '[ملصق]';
      else if (msg.type === 'location') body = '[موقع]';
      else body = `[${msg.type}]`;

      await WaMessage.findOneAndUpdate(
        { waMessageId },
        { waMessageId, from, to: OWN_PHONE, body, direction: 'in', msgType, sentAt, read: false },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).catch(() => {});
    }
  } catch (e) { console.error('[WA Webhook]', e.message); }
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

module.exports = router;
