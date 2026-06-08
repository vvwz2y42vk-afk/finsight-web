const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { createToken, verifyToken } = require('../utils/auth');
const { createRateLimiter }        = require('../utils/rateLimit');
const Property  = require('../models/Property');
const StaffUser = require('../models/StaffUser');

const saLoginLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, message: 'محاولات كثيرة، انتظر 15 دقيقة' });

const COOKIE  = 'sa_token';
const IS_PROD = process.env.NODE_ENV === 'production';
const COPTS   = { httpOnly: true, maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax', secure: IS_PROD };

if (!process.env.SUPERADMIN_PASSWORD) {
  if (IS_PROD) throw new Error('SUPERADMIN_PASSWORD env var is required in production');
  console.warn('⚠️  SUPERADMIN_PASSWORD not set — using insecure fallback');
}
const SA_PASS = process.env.SUPERADMIN_PASSWORD || 'Barez@Super2026';

function saAuth(req, res, next) { req.sa = verifyToken(req.cookies?.[COOKIE]) || null; next(); }
function reqSA(req, res, next)  {
  if (!req.sa || req.sa.role !== 'superadmin') return res.redirect('/superadmin/login');
  next();
}
function reqSAJson(req, res, next) {
  if (!req.sa || req.sa.role !== 'superadmin') return res.status(401).json({ error: 'غير مصرح' });
  next();
}

router.use(saAuth);

// ── Auth ────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.sa) return res.redirect('/superadmin/dashboard');
  res.render('superadmin-login', { error: null });
});
router.post('/login', saLoginLimit, (req, res) => {
  if ((req.body.password || '') !== SA_PASS)
    return res.render('superadmin-login', { error: 'كلمة المرور غير صحيحة' });
  res.cookie(COOKIE, createToken({ role: 'superadmin' }, 8), COPTS);
  res.redirect('/superadmin/dashboard');
});
router.get('/logout', (req, res) => { res.clearCookie(COOKIE); res.redirect('/superadmin/login'); });

// ── Dashboard page ───────────────────────────────────────────────────
router.get('/dashboard', reqSA, (req, res) => res.render('superadmin-dashboard'));

// ── API: Stats summary ───────────────────────────────────────────────
router.get('/api/stats', reqSAJson, async (req, res) => {
  try {
    const now = new Date();
    const [total, active, trial, expired, stopped, staffCount] = await Promise.all([
      Property.countDocuments(),
      Property.countDocuments({ active: true, planExpiry: { $gt: now } }),
      Property.countDocuments({ plan: 'trial', active: true }),
      Property.countDocuments({ active: true, planExpiry: { $lt: now } }),
      Property.countDocuments({ active: false }),
      StaffUser.countDocuments({ active: true }),
    ]);
    res.json({ total, active, trial, expired, stopped, staffCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: All properties (with staff + booking counts) ────────────────
router.get('/api/properties', reqSAJson, async (req, res) => {
  try {
    const { q = '', status = 'all', plan = 'all' } = req.query;
    const Booking = require('../models/Booking');

    let filter = {};
    if (q) filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { city: { $regex: q, $options: 'i' } },
      { adminEmail: { $regex: q, $options: 'i' } },
    ];
    const now = new Date();
    if (status === 'active')  filter = { ...filter, active: true, planExpiry: { $gt: now } };
    if (status === 'expired') filter = { ...filter, active: true, planExpiry: { $lt: now } };
    if (status === 'stopped') filter = { ...filter, active: false };
    if (status === 'trial')   filter = { ...filter, plan: 'trial', active: true };
    if (plan !== 'all' && plan) filter.plan = plan;

    const props = await Property.find(filter).sort({ createdAt: -1 }).lean();

    // batch: staff counts + booking counts per property
    const ids = props.map(p => p._id);
    const [staffCounts, bkCounts] = await Promise.all([
      StaffUser.aggregate([
        { $match: { propertyId: { $in: ids }, active: true } },
        { $group: { _id: '$propertyId', count: { $sum: 1 } } },
      ]),
      Booking.aggregate([
        { $match: { propertyId: { $in: ids } } },
        { $group: { _id: '$propertyId', count: { $sum: 1 } } },
      ]),
    ]);

    const staffMap = Object.fromEntries(staffCounts.map(x => [x._id.toString(), x.count]));
    const bkMap    = Object.fromEntries(bkCounts.map(x => [x._id.toString(), x.count]));

    const result = props.map(p => ({
      ...p,
      staffCount:   staffMap[p._id.toString()]  || 0,
      bookingCount: bkMap[p._id.toString()]      || 0,
    }));

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Create property ─────────────────────────────────────────────
router.post('/api/properties', reqSAJson, async (req, res) => {
  try {
    const { name, type, city, phone, adminEmail, plan, days } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم المنشأة مطلوب' });

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (parseInt(days) || 30));

    const prop = await Property.create({
      name: name.trim(), type: type || 'apartment',
      city: city?.trim() || '', phone: phone?.trim() || '',
      adminEmail: adminEmail?.trim() || '',
      plan: plan || 'trial', planExpiry: expiry, active: true,
    });
    res.json({ success: true, property: prop });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Update property ─────────────────────────────────────────────
router.put('/api/properties/:id', reqSAJson, async (req, res) => {
  try {
    const allowed = ['name', 'type', 'city', 'phone', 'adminEmail', 'plan', 'planExpiry', 'active'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const prop = await Property.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!prop) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    res.json({ success: true, property: prop });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Extend plan ─────────────────────────────────────────────────
router.post('/api/extend', reqSAJson, async (req, res) => {
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

// ── API: Toggle active ───────────────────────────────────────────────
router.post('/api/toggle', reqSAJson, async (req, res) => {
  try {
    const prop = await Property.findById(req.body.id);
    if (!prop) return res.status(404).json({ error: 'منشأة غير موجودة' });
    prop.active = !prop.active;
    await prop.save();
    res.json({ success: true, active: prop.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Delete property ─────────────────────────────────────────────
router.delete('/api/properties/:id', reqSAJson, async (req, res) => {
  try {
    const prop = await Property.findByIdAndDelete(req.params.id);
    if (!prop) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    // remove all staff linked to this property
    await StaffUser.deleteMany({ propertyId: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Staff per property ──────────────────────────────────────────
router.get('/api/properties/:id/staff', reqSAJson, async (req, res) => {
  try {
    const staff = await StaffUser.find({ propertyId: req.params.id })
      .select('-password').sort({ createdAt: -1 }).lean();
    res.json(staff);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Create staff for property ───────────────────────────────────
router.post('/api/properties/:id/staff', reqSAJson, async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id).lean();
    if (!prop) return res.status(404).json({ error: 'المنشأة غير موجودة' });

    const { name, username, password, role } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'الاسم واسم المستخدم وكلمة المرور مطلوبة' });
    if (password.length < 8) return res.status(400).json({ error: 'كلمة المرور 8 أحرف على الأقل' });

    const exists = await StaffUser.findOne({ username: username.trim() });
    if (exists) return res.status(400).json({ error: 'اسم المستخدم محجوز' });

    const building = prop.buildings?.[0]?.name || prop.name;
    const staff = await StaffUser.create({
      name: name.trim(), username: username.trim(), password,
      building, role: role || 'receptionist',
      propertyId: prop._id, active: true,
    });
    res.json({ success: true, staff: { ...staff.toObject(), password: undefined } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Toggle staff active ─────────────────────────────────────────
router.post('/api/staff/:id/toggle', reqSAJson, async (req, res) => {
  try {
    const s = await StaffUser.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'الموظف غير موجود' });
    s.active = !s.active;
    await s.save();
    res.json({ success: true, active: s.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Delete staff ────────────────────────────────────────────────
router.delete('/api/staff/:id', reqSAJson, async (req, res) => {
  try {
    await StaffUser.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Reset staff password ────────────────────────────────────────
router.post('/api/staff/:id/reset-password', reqSAJson, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'كلمة المرور 8 أحرف على الأقل' });
    const s = await StaffUser.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'الموظف غير موجود' });
    s.password = password;
    await s.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Activity log — paginated ────────────────────────────────────
router.get('/api/activity', reqSAJson, async (req, res) => {
  try {
    const AuditLog = require('../models/AuditLog');
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.user)   filter.user   = { $regex: req.query.user, $options: 'i' };
    if (req.query.model)  filter.model  = req.query.model;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { res.json({ logs: [], total: 0, page: 1, pages: 1 }); }
});

// ── API: Monthly bookings chart data ─────────────────────────────────
router.get('/api/chart', reqSAJson, async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const agg = await Booking.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const labels = [], data = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mo = agg.find(x => x._id.year === d.getFullYear() && x._id.month === d.getMonth() + 1);
      const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
      labels.push(MONTHS[d.getMonth()]);
      data.push(mo ? mo.count : 0);
    }
    res.json({ labels, data });
  } catch (e) { res.json({ labels: [], data: [] }); }
});

// ── API: Public stats ────────────────────────────────────────────────
router.get('/api/public-stats', async (req, res) => {
  try {
    const total = await Property.countDocuments({ active: true });
    res.json({ total });
  } catch(e) { res.json({ total: 0 }); }
});

module.exports = router;
