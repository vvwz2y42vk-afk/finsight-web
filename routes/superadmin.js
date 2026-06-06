const express = require('express');
const router = express.Router();
const { createToken, verifyToken } = require('../utils/auth');
const Property = require('../models/Property');

const COOKIE = 'sa_token';
const COPTS  = { httpOnly: true, maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax' };
const SA_PASS = process.env.SUPERADMIN_PASSWORD || 'Barez@Super2026';

function saAuth(req, res, next) { req.sa = verifyToken(req.cookies?.[COOKIE]) || null; next(); }
function reqSA(req, res, next)  { if (!req.sa) return res.redirect('/superadmin/login'); next(); }

router.use(saAuth);

router.get('/login', (req, res) => {
  if (req.sa) return res.redirect('/superadmin/dashboard');
  res.render('superadmin-login', { error: null });
});

router.post('/login', (req, res) => {
  if ((req.body.password || '') !== SA_PASS)
    return res.render('superadmin-login', { error: 'كلمة المرور غير صحيحة' });
  res.cookie(COOKIE, createToken({ role: 'superadmin' }, 8), COPTS);
  res.redirect('/superadmin/dashboard');
});

router.get('/logout', (req, res) => { res.clearCookie(COOKIE); res.redirect('/superadmin/login'); });

router.get('/dashboard', reqSA, async (req, res) => {
  const properties = await Property.find().sort({ createdAt: -1 }).lean();
  res.render('superadmin-dashboard', { properties });
});

// API: extend plan
router.post('/api/extend', reqSA, async (req, res) => {
  try {
    const { id, days, plan } = req.body;
    const prop = await Property.findById(id);
    if (!prop) return res.status(404).json({ error: 'منشأة غير موجودة' });
    const base = prop.planExpiry && new Date(prop.planExpiry) > new Date() ? new Date(prop.planExpiry) : new Date();
    base.setDate(base.getDate() + (parseInt(days) || 30));
    prop.planExpiry = base;
    if (plan) prop.plan = plan;
    prop.active = true;
    await prop.save();
    res.json({ success: true, newExpiry: prop.planExpiry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: toggle active
router.post('/api/toggle', reqSA, async (req, res) => {
  try {
    const prop = await Property.findById(req.body.id);
    if (!prop) return res.status(404).json({ error: 'منشأة غير موجودة' });
    prop.active = !prop.active;
    await prop.save();
    res.json({ success: true, active: prop.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: public stats (for landing page counter)
router.get('/api/public-stats', async (req, res) => {
  try {
    const total = await Property.countDocuments({ active: true });
    res.json({ total });
  } catch(e) { res.json({ total: 0 }); }
});

// API: stats summary
router.get('/api/stats', reqSA, async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const [total, active, trial, expired] = await Promise.all([
      Property.countDocuments(),
      Property.countDocuments({ active: true, planExpiry: { $gt: new Date() } }),
      Property.countDocuments({ plan: 'trial', active: true }),
      Property.countDocuments({ planExpiry: { $lt: new Date() } }),
    ]);
    const revenue = active * 0; // placeholder until payment is wired
    res.json({ total, active, trial, expired, revenue });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
