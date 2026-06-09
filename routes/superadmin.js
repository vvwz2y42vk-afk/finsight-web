const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { createToken, verifyToken } = require('../utils/auth');
const { createRateLimiter }        = require('../utils/rateLimit');
const Property  = require('../models/Property');
const StaffUser = require('../models/StaffUser');
const AuditLog  = require('../models/AuditLog');

const saLoginLimit      = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5,  message: 'محاولات كثيرة، انتظر 15 دقيقة' });
const saDestructiveLimit = createRateLimiter({ windowMs: 60 * 1000,     max: 20, message: 'عمليات كثيرة جداً، انتظر دقيقة' });

// ── Security helpers ─────────────────────────────────────────────────
// Masks last octet of IPv4 or last segment of IPv6 before sending to client
function maskIP(ip) {
  if (!ip) return '—';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d+$/, '.***');
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return '::ffff:' + v4.replace(/\.\d+$/, '.***');
  }
  return ip.replace(/:[0-9a-fA-F]+$/, ':***');
}

// Redacts any hint of password values from log summaries before sending to client
function maskSummary(s) {
  if (!s) return '';
  return s
    .replace(/(password|كلمة المرور|كلمة_المرور)\s*[:=\s]\s*\S+/gi, '$1: ***')
    .replace(/\b([A-Za-z0-9@#$%^&*]{8,})\b(?=.*(?:password|مرور))/gi, '***');
}

// Fires audit log entry without blocking the response
function audit(req, action, model, recordId, summary, extra = {}) {
  AuditLog.create({
    user:     'superadmin',
    role:     'superadmin',
    action,
    model,
    recordId: String(recordId || ''),
    summary,
    ip:       req.ip || req.headers['x-forwarded-for'] || '',
    ...extra,
  }).catch(() => {});
}

const COOKIE  = 'sa_token';
const IS_PROD = process.env.NODE_ENV === 'production';
const COPTS   = { httpOnly: true, maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax', secure: IS_PROD };

if (!process.env.SUPERADMIN_PASSWORD) {
  if (IS_PROD) throw new Error('SUPERADMIN_PASSWORD env var is required in production');
}
const SA_PASS = process.env.SUPERADMIN_PASSWORD || 'Barez@Super2026';

function saAuth(req, res, next) { req.sa = verifyToken(req.cookies?.[COOKIE]) || null; next(); }
function reqSA(req, res, next)  {
  if (!req.sa || req.sa.role !== 'superadmin') return res.redirect('/superadmin/login');
  next();
}
function reqSAJson(req, res, next) {
  if (!req.sa || req.sa.role !== 'superadmin') return res.status(401).json({ error: 'غير مصرح' });
  // CSRF defense-in-depth: for state-changing requests, verify Origin matches host
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const origin = req.headers.origin;
    const host   = req.headers.host;
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return res.status(403).json({ error: 'مصدر الطلب غير مصرح (CSRF)' });
        }
      } catch { /* invalid Origin header — block it */ return res.status(403).json({ error: 'رأس Origin غير صحيح' }); }
    }
  }
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
router.post('/api/properties', reqSAJson, saDestructiveLimit, async (req, res) => {
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
    audit(req, 'create', 'Property', prop._id, `إنشاء منشأة: ${prop.name}`);
    res.json({ success: true, property: prop });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Update property ─────────────────────────────────────────────
router.put('/api/properties/:id', reqSAJson, saDestructiveLimit, async (req, res) => {
  try {
    const allowed = ['name', 'type', 'city', 'phone', 'adminEmail', 'plan', 'planExpiry', 'active'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const prop = await Property.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!prop) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    audit(req, 'update', 'Property', prop._id, `تعديل منشأة: ${prop.name}`);
    res.json({ success: true, property: prop });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Extend plan ─────────────────────────────────────────────────
router.post('/api/extend', reqSAJson, saDestructiveLimit, async (req, res) => {
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
    audit(req, 'update', 'Property', prop._id, `تمديد اشتراك: ${prop.name} — ${days} يوم — حتى ${base.toLocaleDateString('ar-SA')}`);
    res.json({ success: true, newExpiry: prop.planExpiry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Toggle active ───────────────────────────────────────────────
router.post('/api/toggle', reqSAJson, saDestructiveLimit, async (req, res) => {
  try {
    const prop = await Property.findById(req.body.id);
    if (!prop) return res.status(404).json({ error: 'منشأة غير موجودة' });
    prop.active = !prop.active;
    await prop.save();
    audit(req, 'update', 'Property', prop._id, `${prop.active ? 'تفعيل' : 'إيقاف'} منشأة: ${prop.name}`);
    res.json({ success: true, active: prop.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Delete property ─────────────────────────────────────────────
router.delete('/api/properties/:id', reqSAJson, saDestructiveLimit, async (req, res) => {
  try {
    const prop = await Property.findByIdAndDelete(req.params.id);
    if (!prop) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    const staffDeleted = await StaffUser.countDocuments({ propertyId: req.params.id });
    await StaffUser.deleteMany({ propertyId: req.params.id });
    audit(req, 'delete', 'Property', req.params.id, `حذف منشأة: ${prop.name} — ${staffDeleted} موظف`);
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
router.post('/api/properties/:id/staff', reqSAJson, saDestructiveLimit, async (req, res) => {
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
    audit(req, 'create', 'StaffUser', staff._id, `إضافة موظف: ${staff.name} (${staff.username}) — ${prop.name}`);
    res.json({ success: true, staff: { ...staff.toObject(), password: undefined } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Toggle staff active ─────────────────────────────────────────
router.post('/api/staff/:id/toggle', reqSAJson, saDestructiveLimit, async (req, res) => {
  try {
    const s = await StaffUser.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'الموظف غير موجود' });
    s.active = !s.active;
    await s.save();
    audit(req, 'update', 'StaffUser', s._id, `${s.active ? 'تفعيل' : 'إيقاف'} موظف: ${s.name} (${s.username})`);
    res.json({ success: true, active: s.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Delete staff ────────────────────────────────────────────────
router.delete('/api/staff/:id', reqSAJson, saDestructiveLimit, async (req, res) => {
  try {
    const s = await StaffUser.findByIdAndDelete(req.params.id);
    if (s) audit(req, 'delete', 'StaffUser', req.params.id, `حذف موظف: ${s.name} (${s.username})`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Reset staff password ────────────────────────────────────────
router.post('/api/staff/:id/reset-password', reqSAJson, saDestructiveLimit, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'كلمة المرور 8 أحرف على الأقل' });
    const s = await StaffUser.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'الموظف غير موجود' });
    s.password = password;
    await s.save();
    // Log the reset action WITHOUT logging the new password value
    audit(req, 'update', 'StaffUser', s._id, `إعادة تعيين كلمة مرور: ${s.name} (${s.username})`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: All staff across all properties (bulk — avoids N+1 in dashboard) ──
router.get('/api/staff/all', reqSAJson, async (req, res) => {
  try {
    const staff = await StaffUser.find({})
      .select('-password').sort({ propertyId: 1, createdAt: -1 }).lean();
    // attach property name from a single Property lookup
    const propIds = [...new Set(staff.map(s => s.propertyId?.toString()).filter(Boolean))];
    const props = await Property.find({ _id: { $in: propIds } }).select('name').lean();
    const nameMap = Object.fromEntries(props.map(p => [p._id.toString(), p.name]));
    res.json(staff.map(s => ({ ...s, _propName: nameMap[s.propertyId?.toString()] || '' })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Activity log — paginated ────────────────────────────────────
router.get('/api/activity', reqSAJson, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.user)   filter.user   = { $regex: req.query.user, $options: 'i' };
    if (req.query.model)  filter.model  = req.query.model;

    const [rawLogs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    // Mask sensitive fields before sending to client
    const logs = rawLogs.map(l => ({
      ...l,
      ip:      maskIP(l.ip),
      summary: maskSummary(l.summary),
      changes: undefined,   // never expose raw change diffs to the browser
    }));
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
