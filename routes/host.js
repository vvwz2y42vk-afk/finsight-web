const express = require('express');
const router = express.Router();
const Host = require('../models/Host');
const { createToken } = require('../utils/auth');

const COOKIE_OPTS = { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' };

function requireHost(req, res, next) {
  if (!req.hostAccount) return res.redirect('/host/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

// ─── Register ────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.hostAccount) return res.redirect('/host/dashboard');
  res.render('host-register', { error: null });
});

router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, email, nationalId, nationality } = req.body;
    if (!name || !phone || !password) return res.render('host-register', { error: 'الرجاء تعبئة الاسم والجوال وكلمة المرور' });
    if (password.length < 6) return res.render('host-register', { error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    const exists = await Host.findOne({ phone: phone.trim() });
    if (exists) return res.render('host-register', { error: 'رقم الجوال مسجل مسبقاً' });
    const host = await new Host({
      name: name.trim(), phone: phone.trim(), password,
      email: email?.trim() || '', nationalId: nationalId?.trim() || '',
      nationality: nationality || 'سعودي',
    }).save();
    const token = createToken({ id: host._id, name: host.name, phone: host.phone, role: 'host' });
    res.cookie('fs_host', token, COOKIE_OPTS);
    res.redirect('/host/dashboard');
  } catch (e) {
    res.render('host-register', { error: 'حدث خطأ: ' + e.message });
  }
});

// ─── Login ───────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.hostAccount) return res.redirect('/host/dashboard');
  res.render('host-login', { error: null, next: req.query.next || '' });
});

router.post('/login', async (req, res) => {
  try {
    const { phone, password, next } = req.body;
    const host = await Host.findOne({ phone: (phone || '').trim() });
    if (!host || !(await host.comparePassword(password))) {
      return res.render('host-login', { error: 'رقم الجوال أو كلمة المرور غير صحيحة', next: next || '' });
    }
    const token = createToken({ id: host._id, name: host.name, phone: host.phone, role: 'host' });
    res.cookie('fs_host', token, COOKIE_OPTS);
    res.redirect(next && next.startsWith('/') ? next : '/host/dashboard');
  } catch (e) {
    res.render('host-login', { error: 'حدث خطأ: ' + e.message, next: '' });
  }
});

// ─── Logout ──────────────────────────────────────────────
router.get('/logout', (req, res) => {
  res.clearCookie('fs_host');
  res.redirect('/');
});

// ─── Dashboard ───────────────────────────────────────────
router.get('/dashboard', requireHost, (req, res) => {
  res.render('host-dashboard', {
    hostId: req.hostAccount.id,
    hostName: req.hostAccount.name,
  });
});

module.exports = router;
