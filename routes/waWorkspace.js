/**
 * WA WORKSPACE ROUTES
 * All /ws/* endpoints. Auth: standalone cookie (fs_wa).
 * Includes SSE stream for real-time lock & message events.
 */
'use strict';

const express   = require('express');
const router    = express.Router();
const WaMessage = require('../models/WaMessage');
const Booking   = require('../models/Booking');
const Customer  = require('../models/Customer');
const { sendText, sendTemplate, markRead } = require('../services/whatsappApi');
const { acquireLock, releaseLock, setTyping, addSSEClient, broadcastNewMessage } = require('../store/chatStore');

const WA_PASSWORD = process.env.WA_INBOX_PASSWORD || 'barez2024';
const WA_COOKIE   = 'fs_wa';
const OWN_PHONE   = process.env.WHATSAPP_OWN_PHONE || '966590561057';
const COPTS       = { httpOnly: true, maxAge: 12 * 3600 * 1000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };

function reqAuth(req, res, next) {
  const cookie = req.cookies?.[WA_COOKIE];
  if (!cookie) return res.status(401).json({ error: 'unauthorized' });
  try {
    const agent = JSON.parse(Buffer.from(cookie, 'base64').toString());
    req.agent   = agent;
    next();
  } catch { res.status(401).json({ error: 'unauthorized' }); }
}

// ── Auth ──────────────────────────────────────────────────────────
router.get('/ws/login', (req, res) => {
  if (req.cookies?.[WA_COOKIE]) return res.redirect('/ws');
  res.render('ws-login', { error: null });
});

router.post('/ws/login', (req, res) => {
  const { password, agentName } = req.body;
  if (password !== WA_PASSWORD || !agentName?.trim()) {
    return res.render('ws-login', { error: 'كلمة المرور أو الاسم غير صحيح' });
  }
  const agent  = { id: `agent_${Date.now()}`, name: agentName.trim() };
  const cookie = Buffer.from(JSON.stringify(agent)).toString('base64');
  res.cookie(WA_COOKIE, cookie, COPTS);
  res.redirect('/ws');
});

router.get('/ws/logout', (req, res) => {
  res.clearCookie(WA_COOKIE);
  res.redirect('/ws/login');
});

// ── Workspace page ────────────────────────────────────────────────
router.get('/ws', (req, res) => {
  const cookie = req.cookies?.[WA_COOKIE];
  if (!cookie) return res.redirect('/ws/login');
  try {
    const agent = JSON.parse(Buffer.from(cookie, 'base64').toString());
    res.render('wa-workspace', { agent });
  } catch { res.redirect('/ws/login'); }
});

// ── SSE — real-time events ────────────────────────────────────────
router.get('/ws/api/events', reqAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const remove = addSSEClient(res, req.agent.id);

  // Heartbeat every 20s
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(hb); } }, 20000);

  req.on('close', () => { clearInterval(hb); remove(); });
});

// ── Conversations list ────────────────────────────────────────────
router.get('/ws/api/conversations', reqAuth, async (req, res) => {
  try {
    const tab   = req.query.tab || 'all';    // all | unread | resolved
    const page  = parseInt(req.query.page)  || 1;
    const limit = 40;

    const convs = await WaMessage.aggregate([
      {
        $group: {
          _id:      { $cond: [{ $eq: ['$direction','in'] }, '$from', '$to'] },
          lastMsg:  { $last:  '$$ROOT' },
          lastAt:   { $max:   '$sentAt' },
          unread:   { $sum:   { $cond: [{ $and: [{ $eq: ['$direction','in'] }, { $eq: ['$read',false] }] }, 1, 0] } },
          total:    { $sum: 1 },
          fromName: { $last:  '$fromName' },
        }
      },
      ...(tab === 'unread'   ? [{ $match: { unread: { $gt: 0 } } }] : []),
      { $sort: { lastAt: -1 } },
      { $skip:  (page - 1) * limit },
      { $limit: limit },
    ]);

    res.json(convs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Messages for a conversation ───────────────────────────────────
router.get('/ws/api/messages/:phone', reqAuth, async (req, res) => {
  try {
    const phone  = req.params.phone.replace(/\D/g,'');
    const before = req.query.before; // cursor for infinite scroll
    const filter = {
      $or: [{ from: phone }, { to: phone }],
      ...(before ? { sentAt: { $lt: new Date(before) } } : {}),
    };

    const msgs = await WaMessage.find(filter).sort({ sentAt: -1 }).limit(40).lean();
    msgs.reverse();

    // Mark inbound as read + send read receipts
    const unread = msgs.filter(m => m.direction === 'in' && !m.read);
    if (unread.length) {
      await WaMessage.updateMany({ _id: { $in: unread.map(m => m._id) } }, { read: true });
      for (const m of unread) { if (m.waMessageId) markRead(m.waMessageId); }
    }

    res.json(msgs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CRM Card ──────────────────────────────────────────────────────
router.get('/ws/api/crm/:phone', reqAuth, async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g,'');
    const phoneVariants = [phone, '0' + phone.slice(3), '+' + phone];

    const customer = await Customer.findOne({ phone: { $in: phoneVariants } }).lean();
    const bookings = await Booking.find({
      $or: [{ phone: { $in: phoneVariants } }, ...(customer ? [{ customer: customer._id }] : [])],
    }).sort({ checkIn: -1 }).limit(10).lean();

    const totalSpend = bookings.reduce((s, b) => s + (b.totalPrice || b.total || 0), 0);
    const active     = bookings.find(b => b.status === 'active' || b.status === 'confirmed');

    res.json({ customer, bookings, totalSpend, activeBooking: active || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Send message (with optimistic ID support) ─────────────────────
router.post('/ws/api/send', reqAuth, async (req, res) => {
  try {
    const { phone, body, optimisticId } = req.body;
    if (!phone || !body?.trim()) return res.status(400).json({ error: 'phone/body required' });

    // Save to DB immediately with 'sending' status
    const msg = await WaMessage.create({
      from:      OWN_PHONE,
      to:        phone.replace(/\D/g,''),
      body:      body.trim(),
      direction: 'out',
      msgType:   'text',
      status:    'sending',
      sentAt:    new Date(),
      read:      true,
      agentId:   req.agent.id,
      agentName: req.agent.name,
    });

    res.json({ ok: true, msg, optimisticId }); // respond immediately

    // Send via API (non-blocking to client)
    try {
      const { messageId } = await sendText(phone, body.trim());
      await WaMessage.findByIdAndUpdate(msg._id, { status: 'sent', waMessageId: messageId });
    } catch (apiErr) {
      console.error('[WS] send failed:', apiErr.message);
      await WaMessage.findByIdAndUpdate(msg._id, { status: 'failed' });
      // Broadcast failure so UI can show retry
      broadcastNewMessage(phone, { ...msg.toObject(), status: 'failed' });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Send template ─────────────────────────────────────────────────
router.post('/ws/api/send-template', reqAuth, async (req, res) => {
  try {
    const { phone, templateName, params } = req.body;
    if (!phone || !templateName) return res.status(400).json({ error: 'missing fields' });

    const { messageId } = await sendTemplate(phone, templateName, params || []);

    const msg = await WaMessage.create({
      waMessageId: messageId,
      from:        OWN_PHONE,
      to:          phone.replace(/\D/g,''),
      body:        `[قالب: ${templateName}]`,
      direction:   'out',
      msgType:     'template',
      status:      'sent',
      sentAt:      new Date(),
      read:        true,
      agentId:     req.agent.id,
      agentName:   req.agent.name,
    });

    res.json({ ok: true, msg });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Save CRM notes ────────────────────────────────────────────────
router.post('/ws/api/crm/:phone/notes', reqAuth, async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g,'');
    const phoneVariants = [phone, '0' + phone.slice(3), '+' + phone];
    const { notes } = req.body;
    await Customer.findOneAndUpdate(
      { phone: { $in: phoneVariants } },
      { notes: String(notes || '').slice(0, 2000) }
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Lock management ───────────────────────────────────────────────
router.post('/ws/api/lock', reqAuth, (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const result = acquireLock(phone, req.agent.id, req.agent.name);
  res.json(result);
});

router.post('/ws/api/unlock', reqAuth, (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  releaseLock(phone, req.agent.id);
  res.json({ ok: true });
});

router.post('/ws/api/typing', reqAuth, (req, res) => {
  const { phone, isTyping } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  setTyping(phone, req.agent.id, !!isTyping);
  res.json({ ok: true });
});

module.exports = { router, broadcastNewMessage };
