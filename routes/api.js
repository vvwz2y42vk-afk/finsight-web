const express = require('express');
const router = express.Router();
const Contract = require('../models/Contract');
const Inquiry = require('../models/Inquiry');
const CommissionHistory = require('../models/CommissionHistory');
const Listing = require('../models/Listing');
const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const Host = require('../models/Host');
const ActivityLog = require('../models/ActivityLog');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const HousekeepingTask = require('../models/HousekeepingTask');
const AdminUser = require('../models/AdminUser');
const AuditLog = require('../models/AuditLog');
const { verifyToken, requireRole } = require('../utils/auth');

function audit(req, action, model, recordId, summary = '', changes = null) {
  AuditLog.create({
    user: req.user?.username || 'unknown',
    role: req.user?.role,
    action, model,
    recordId: String(recordId),
    summary,
    changes,
    ip: req.ip,
  }).catch(() => {});
}

const auth = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ error: 'غير مخوّل' });
};

const hostAuth = (req, res, next) => {
  req.hostAccount = verifyToken(req.cookies?.fs_host) || null;
  if (!req.hostAccount) return res.status(401).json({ error: 'غير مخوّل' });
  next();
};

// ─── Auto-close expired contracts (cached: once per hour) ──
let _autoCloseLastRun = 0;
async function autoCloseExpired() {
  const now = Date.now();
  if (now - _autoCloseLastRun < 60 * 60 * 1000) return;
  _autoCloseLastRun = now;
  const contracts = await Contract.find({ st: { $nin: ['مغلق'] }, ex: { $ne: '' } }).lean();
  const today = new Date(); today.setHours(0,0,0,0);
  const toClose = contracts.filter(c => {
    if (!c.ex) return false;
    const parts = String(c.ex).trim().split('/');
    if (parts.length !== 3) return false;
    const d = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`);
    return !isNaN(d) && d < today;
  });
  if (toClose.length) {
    await Promise.all(toClose.map(c => Contract.updateOne({ id: c.id }, { st: 'مغلق' })));
  }
}

// ─── Contracts ────────────────────────────────────────────
router.get('/contracts', auth, async (req, res) => {
  try {
    await autoCloseExpired();
    const contracts = await Contract.find().lean();
    res.json(contracts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const CONTRACT_FIELDS = ['id','n','sheet','a','v','p','r','en','ex','ph','st','py','src','type','notes','ej','pm'];
function pickContract(body) {
  return CONTRACT_FIELDS.reduce((obj, k) => { if (k in body) obj[k] = body[k]; return obj; }, {});
}

router.post('/contracts', auth, async (req, res) => {
  try {
    const data = pickContract(req.body);
    if (!data.id) return res.status(400).json({ error: 'id مطلوب' });
    const existing = await Contract.findOne({ id: data.id });
    await Contract.findOneAndUpdate({ id: data.id }, data, { upsert: true, new: true });
    audit(req, existing ? 'update' : 'create', 'Contract', data.id, `عقد ${data.n || data.id}`, data);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/contracts/:id', auth, async (req, res) => {
  try {
    const changes = pickContract(req.body);
    await Contract.findOneAndUpdate({ id: req.params.id }, changes);
    audit(req, 'update', 'Contract', req.params.id, `تعديل عقد ${req.params.id}`, changes);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/contracts/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const c = await Contract.findOneAndDelete({ id: req.params.id });
    audit(req, 'delete', 'Contract', req.params.id, `حذف عقد ${c?.n || req.params.id}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk save (initial seed) — admin only
router.post('/contracts/bulk', auth, requireRole('admin'), async (req, res) => {
  try {
    const { contracts } = req.body;
    if (!contracts || !contracts.length) return res.json({ success: false });
    for (const c of contracts) {
      await Contract.findOneAndUpdate({ id: c.id }, pickContract(c), { upsert: true });
    }
    res.json({ success: true, count: contracts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Commissions History ──────────────────────────────────
router.get('/commission-history', auth, async (req, res) => {
  try {
    const history = await CommissionHistory.find().sort({ createdAt: -1 }).lean();
    res.json(history);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/commission-history', auth, async (req, res) => {
  try {
    const { key, label, comm } = req.body;
    await CommissionHistory.findOneAndUpdate({ key }, { key, label, comm }, { upsert: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Available Apartments (public) ───────────────────────
router.get('/apartments/available', async (req, res) => {
  try {
    const active = await Contract.find(
      { st: { $in: ['مفتوح', 'بانتظار دخول العميل'] }, n: { $exists: true, $ne: '' } },
      'sheet a'
    ).lean();
    const occupiedSet = new Set(active.map(c => `${c.sheet}-${c.a}`));

    const BUILDINGS = {
      'المنارا':  ['001','002','101','102','103','104','105','106','201','202','203','204','205','206','301','302','303','304','305','306','401','402','403','404','405','406','501','502','503','504'],
      'جوان ان': ['001','002','003','004','101','102','103','104','105','201','202','203','204','205','301','302','303','304','305','306','401','402'],
      'الماسة':  ['101','102','103','104','105','106','201','202','203','204','301','302','303','304','305','306'],
      'الواحة':  ['001','002','003','004','101','102','103','104','105','106','107','108','201','202','203','204','205','206','207','208'],
    };

    const available = [];
    Object.entries(BUILDINGS).forEach(([building, apts]) => {
      apts.forEach(apt => {
        if (!occupiedSet.has(`${building}-${apt}`)) {
          available.push({ building, apartment: apt });
        }
      });
    });
    res.json(available);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function sendEmail(subject, html) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Barez <onboarding@resend.dev>', to: ['assisting@finsight-sa.com'], subject, html }),
    });
  } catch(e) {}
}

// ─── Inquiries ────────────────────────────────────────────
router.post('/inquiries', async (req, res) => {
  try {
    const { name, phone, email, subject, message, listing } = req.body;
    if (!name?.trim() || name.trim().length > 100) return res.status(400).json({ error: 'الاسم مطلوب (100 حرف كحد أقصى)' });
    if (!phone?.trim() || !/^[\d\s\+\-]{7,20}$/.test(phone.trim())) return res.status(400).json({ error: 'رقم الجوال غير صحيح' });
    const inquiry = new Inquiry({
      name: name.trim().slice(0, 100),
      phone: phone.trim().slice(0, 20),
      email: email?.trim().slice(0, 150) || '',
      building: req.body.building?.slice(0, 50) || '',
      budget: req.body.budget?.slice(0, 50) || '',
      duration: req.body.duration?.slice(0, 50) || '',
      message: message?.slice(0, 1000) || '',
      status: 'جديد',
    });
    await inquiry.save();
    sendEmail(
      `💬 استفسار — ${escHtml(subject || listing || 'استفسار عقاري')}`,
      `<div dir="rtl" style="font-family:Arial;line-height:2;">
        <h2 style="color:#d4af37;">استفسار جديد</h2>
        <p><b>الاسم:</b> ${escHtml(name)}</p>
        <p><b>الهاتف:</b> <a href="https://wa.me/${escHtml((phone||'').replace(/\D/g,'').replace(/^0/,'966'))}">${escHtml(phone)}</a></p>
        ${email ? `<p><b>الإيميل:</b> ${escHtml(email)}</p>` : ''}
        ${listing ? `<p><b>العقار:</b> ${escHtml(listing)}</p>` : ''}
        ${message ? `<p><b>الرسالة:</b> ${escHtml(message)}</p>` : ''}
        <hr><a href="https://finsight-web-xi.vercel.app/dashboard" style="color:#d4af37;">فتح الداشبورد</a>
      </div>`
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/inquiries', auth, async (req, res) => {
  try {
    const inquiries = await Inquiry.find().sort({ createdAt: -1 }).lean();
    res.json(inquiries);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/inquiries/:id', auth, async (req, res) => {
  try {
    await Inquiry.findByIdAndUpdate(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Listings (public read, auth write) ──────────────────
router.get('/listings', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 200);
    const [listings, total] = await Promise.all([
      Listing.find().sort({ featured: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      req.query.page ? Listing.countDocuments() : Promise.resolve(null),
    ]);
    if (req.query.page) return res.json({ listings, total, page, pages: Math.ceil(total / limit) });
    res.json(listings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Mobile App API ───────────────────────────────────────
// GET /api/app/listings?cat=&sort=&q=&page=
router.get('/app/listings', async (req, res) => {
  try {
    const { cat='', sort='newest', q='', page=1, limit=20 } = req.query;
    const filter = {};
    if(cat) filter.category = cat;
    if(q) filter.$or = [
      { title: { $regex: q, $options:'i' } },
      { description: { $regex: q, $options:'i' } },
      { location: { $regex: q, $options:'i' } },
      { building: { $regex: q, $options:'i' } },
    ];
    const sortMap = { newest:{createdAt:-1}, featured:{featured:-1,createdAt:-1}, price_asc:{price_daily:1}, price_desc:{price_daily:-1} };
    const skip = (parseInt(page)-1)*parseInt(limit);
    const [listings, total] = await Promise.all([
      Listing.find(filter).sort(sortMap[sort]||{createdAt:-1}).skip(skip).limit(parseInt(limit)).lean(),
      Listing.countDocuments(filter),
    ]);
    res.json({ listings, total, page:parseInt(page), pages:Math.ceil(total/parseInt(limit)) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// GET /api/app/listings/:id
router.get('/app/listings/:id', async (req, res) => {
  try {
    const l = await Listing.findById(req.params.id).lean();
    if(!l) return res.status(404).json({error:'غير موجود'});
    res.json(l);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// POST /api/app/inquiry
router.post('/app/inquiry', async (req, res) => {
  try {
    const { name, phone, message, listingId } = req.body;
    if(!name?.trim()||!phone?.trim()) return res.status(400).json({error:'الاسم والجوال مطلوبان'});
    if(name.trim().length>100) return res.status(400).json({error:'الاسم طويل جداً'});
    if(!/^[\d\s\+\-]{7,20}$/.test(phone.trim())) return res.status(400).json({error:'رقم الجوال غير صحيح'});
    await new Inquiry({ name:name.trim().slice(0,100), phone:phone.trim().slice(0,20), message:(message||'').slice(0,1000), listing:listingId||null, source:'app' }).save();
    res.json({ success:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// GET /api/app/config
router.get('/app/config', (req, res) => {
  res.json({
    name: 'بارز للشقق المفروشة',
    nameEn: 'Barez',
    phone: '0590561057',
    whatsapp: '966590561057',
    email: 'realstate@barezz.com',
    city: 'المدينة المنورة',
    instagram: 'https://www.instagram.com/finsight.ksa',
    tiktok: 'https://www.tiktok.com/@finsight.ksa',
    categories: [
      { key:'rental_apartment', label:'شقق للإيجار', icon:'home' },
      { key:'rental_commercial', label:'معارض للإيجار', icon:'store' },
      { key:'sale_land', label:'أراضي للبيع', icon:'landscape' },
      { key:'sale_apartment', label:'شقق للبيع', icon:'apartment' },
    ]
  });
});

router.post('/listings', auth, async (req, res) => {
  try {
    const listing = await new Listing(req.body).save();
    res.json({ success: true, listing });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/listings/:id', auth, async (req, res) => {
  try {
    await Listing.findByIdAndUpdate(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/listings/:id', auth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    await Listing.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Bookings (auth) ──────────────────────────────────────
router.get('/bookings', auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 200);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.listing) filter.listing = req.query.listing;
    const [bookings, total] = await Promise.all([
      Booking.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      req.query.page ? Booking.countDocuments(filter) : Promise.resolve(null),
    ]);
    if (req.query.page) return res.json({ bookings, total, page, pages: Math.ceil(total / limit) });
    res.json(bookings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/bookings/:id', auth, async (req, res) => {
  try {

    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ error: 'الحجز غير موجود' });

    const prevStatus = booking.status;
    const newStatus  = req.body.status;

    await Booking.findByIdAndUpdate(req.params.id, req.body);

    if (booking.listing && newStatus && newStatus !== prevStatus) {
      // Block dates/unit when payment confirmed (awaiting_checkin)
      if (newStatus === 'awaiting_checkin') {
        if (booking.bookingType === 'daily' && booking.checkIn && booking.checkOut) {
          await Listing.findByIdAndUpdate(booking.listing, {
            $push: { blockedRanges: { checkIn: booking.checkIn, checkOut: booking.checkOut, bookingId: booking._id } }
          });
        } else {
          await Listing.findByIdAndUpdate(booking.listing, { available: false });
        }
      // Free up unit when checkout or cancelled
      } else if (newStatus === 'checkout') {
        if (booking.bookingType !== 'daily') {
          await Listing.findByIdAndUpdate(booking.listing, { available: true });
        }
      } else if (newStatus === 'cancelled') {
        if (booking.bookingType === 'daily' && ['awaiting_checkin','active'].includes(prevStatus)) {
          await Listing.findByIdAndUpdate(booking.listing, {
            $pull: { blockedRanges: { bookingId: booking._id } }
          });
        } else if (booking.bookingType !== 'daily' && ['awaiting_checkin','active'].includes(prevStatus)) {
          await Listing.findByIdAndUpdate(booking.listing, { available: true });
        }
      }
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/bookings/:id', auth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Customers ───────────────────────────────────────────
router.get('/customers', auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 200);
    const filter = {};
    if (req.query.q) {
      const re = new RegExp(req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { email: re }, { phone: re }];
    }
    const [customers, total] = await Promise.all([
      Customer.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-password').lean(),
      req.query.page ? Customer.countDocuments(filter) : Promise.resolve(null),
    ]);
    if (req.query.page) return res.json({ customers, total, page, pages: Math.ceil(total / limit) });
    res.json(customers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Host API ─────────────────────────────────────────────
router.get('/host/me', hostAuth, async (req, res) => {
  try {
    const host = await Host.findById(req.hostAccount.id).select('-password').lean();
    if (!host) return res.status(404).json({ error: 'غير موجود' });
    res.json(host);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/host/profile', hostAuth, async (req, res) => {
  try {
    const { name, email, bio, iban, bankName } = req.body;
    const host = await Host.findByIdAndUpdate(
      req.hostAccount.id,
      { name: name?.trim(), email: email?.trim(), bio: bio?.trim(), iban: iban?.trim(), bankName: bankName?.trim() },
      { new: true }
    ).select('-password').lean();
    res.json({ success: true, host });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/host/change-password', hostAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const host = await Host.findById(req.hostAccount.id);
    if (!host || !(await host.comparePassword(currentPassword))) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'كلمة المرور الجديدة 6 أحرف على الأقل' });
    host.password = newPassword;
    await host.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/host/listings', hostAuth, async (req, res) => {
  try {
    const listings = await Listing.find({ host: req.hostAccount.id }).sort({ createdAt: -1 }).lean();
    res.json(listings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/host/listings', hostAuth, async (req, res) => {
  try {
    const host = await Host.findById(req.hostAccount.id).lean();
    if (!host || host.status !== 'approved') return res.status(403).json({ error: 'حسابك قيد المراجعة' });
    const listing = await new Listing({ ...req.body, host: req.hostAccount.id }).save();
    res.json({ success: true, listing });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/host/listings/:id', hostAuth, async (req, res) => {
  try {
    const listing = await Listing.findOne({ _id: req.params.id, host: req.hostAccount.id });
    if (!listing) return res.status(404).json({ error: 'غير موجود' });
    await Listing.findByIdAndUpdate(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/host/listings/:id', hostAuth, async (req, res) => {
  try {
    await Listing.findOneAndDelete({ _id: req.params.id, host: req.hostAccount.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/host/bookings', hostAuth, async (req, res) => {
  try {
    const listings = await Listing.find({ host: req.hostAccount.id }, '_id').lean();
    const ids = listings.map(l => l._id);
    const bookings = await Booking.find({ listing: { $in: ids } })
      .sort({ createdAt: -1 }).populate('listing', 'title photos').lean();
    res.json(bookings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/host/bookings/:id/status', hostAuth, async (req, res) => {
  try {
    const { status } = req.body;
    // Verify this booking belongs to host
    const listing = await Listing.findOne({ host: req.hostAccount.id });
    if (!listing) return res.status(403).json({ error: 'غير مسموح' });
    const booking = await Booking.findOne({ _id: req.params.id, listing: { $in: (await Listing.find({ host: req.hostAccount.id }, '_id').lean()).map(l => l._id) } }).lean();
    if (!booking) return res.status(404).json({ error: 'الحجز غير موجود' });

    const prevStatus = booking.status;
    await Booking.findByIdAndUpdate(req.params.id, { status });

    // Handle listing availability
    if (booking.listing && status !== prevStatus) {
      if (status === 'awaiting_checkin') {
        if (booking.bookingType === 'daily' && booking.checkIn && booking.checkOut) {
          await Listing.findByIdAndUpdate(booking.listing, { $push: { blockedRanges: { checkIn: booking.checkIn, checkOut: booking.checkOut, bookingId: booking._id } } });
        } else {
          await Listing.findByIdAndUpdate(booking.listing, { available: false });
        }
      } else if (status === 'checkout' && booking.bookingType !== 'daily') {
        await Listing.findByIdAndUpdate(booking.listing, { available: true });
      } else if (status === 'cancelled' && ['awaiting_checkin','active'].includes(prevStatus)) {
        if (booking.bookingType === 'daily') {
          await Listing.findByIdAndUpdate(booking.listing, { $pull: { blockedRanges: { bookingId: booking._id } } });
        } else {
          await Listing.findByIdAndUpdate(booking.listing, { available: true });
        }
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/host/stats', hostAuth, async (req, res) => {
  try {
    const listings = await Listing.find({ host: req.hostAccount.id }, '_id').lean();
    const ids = listings.map(l => l._id);
    const bookings = await Booking.find({ listing: { $in: ids } }).lean();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEarnings = bookings
      .filter(b => new Date(b.createdAt) >= startOfMonth && !['cancelled'].includes(b.status))
      .reduce((s, b) => s + (b.totalPrice || 0), 0);
    const totalEarnings = bookings
      .filter(b => b.status === 'checkout')
      .reduce((s, b) => s + (b.totalPrice || 0), 0);
    res.json({
      totalListings: listings.length,
      activeListings: (await Listing.countDocuments({ host: req.hostAccount.id, available: true })),
      pendingBookings: bookings.filter(b => b.status === 'pending').length,
      activeBookings: bookings.filter(b => b.status === 'active').length,
      thisMonthEarnings,
      totalEarnings,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Admin: Hosts management ──────────────────────────────
router.get('/hosts', auth, async (req, res) => {
  try {
    const hosts = await Host.find().sort({ createdAt: -1 }).select('-password').lean();
    res.json(hosts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/hosts/:id/approve', auth, requireRole('admin'), async (req, res) => {
  try {
    await Host.findByIdAndUpdate(req.params.id, { status: 'approved', rejectionReason: '' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/hosts/:id/reject', auth, requireRole('admin'), async (req, res) => {
  try {
    await Host.findByIdAndUpdate(req.params.id, { status: 'rejected', rejectionReason: req.body.reason || '' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/hosts/:id/suspend', auth, requireRole('admin'), async (req, res) => {
  try {
    await Host.findByIdAndUpdate(req.params.id, { status: 'suspended' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Staff Performance Leaderboard ───────────────────────
router.get('/staff-performance', auth, async (req, res) => {
  try {

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [logs, bookings] = await Promise.all([
      ActivityLog.find({ createdAt: { $gte: since } }).lean(),
      Booking.find({ createdAt: { $gte: since } }).lean(),
    ]);

    const map = {};
    const inc = (name, key) => {
      if (!name) return;
      if (!map[name]) map[name] = { name, checkIn: 0, checkOut: 0, bookingAdd: 0, housekeeping: 0, total: 0 };
      map[name][key]++;
      map[name].total++;
    };

    logs.forEach(l => {
      if (l.action === 'check_in')      inc(l.staffName, 'checkIn');
      else if (l.action === 'check_out') inc(l.staffName, 'checkOut');
      else if (l.action === 'booking_add') inc(l.staffName, 'bookingAdd');
      else if (l.action === 'housekeeping') inc(l.staffName, 'housekeeping');
    });

    const staff = Object.values(map).sort((a, b) => b.total - a.total);
    res.json(staff);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── All-buildings Activity Log (admin) ──────────────────
router.get('/activity', auth, async (req, res) => {
  try {
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).limit(60).lean();
    res.json(logs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Apartments Grid ─────────────────────────────────────
const GRID_BUILDINGS = {
  'المنارا':  { floors: [{l:'أرضي',r:['001','002']},{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204','205','206']},{l:'الثالث',r:['301','302','303','304','305','306']},{l:'الرابع',r:['401','402','403','404','405','406']},{l:'الخامس',r:['501','502','503','504']}] },
  'جوان ان': { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105']},{l:'الثاني',r:['201','202','203','204','205']},{l:'الثالث',r:['301','302','303','304','305','306']},{l:'الرابع',r:['401','402']}] },
  'الماسة':  { floors: [{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204','205','206']},{l:'الثالث',r:['301','302','303','304','305','306']}] },
  'الواحة':  { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105','106','107','108']},{l:'الثاني',r:['201','202','203','204','205','206','207','208']}] },
};

router.get('/apartments/grid', auth, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    const bookings = await Booking.find({
      status: { $in: ['awaiting_payment','awaiting_checkin','active'] },
      building: { $exists: true, $ne: null },
      apt: { $exists: true, $ne: null },
    }).lean();

    const map = {};
    bookings.forEach(b => { if (b.building && b.apt) map[`${b.building}-${b.apt}`] = b; });

    const result = {};
    Object.entries(GRID_BUILDINGS).forEach(([bName, bData]) => {
      let occupied = 0;
      const floors = bData.floors.map(floor => ({
        label: floor.l,
        rooms: floor.r.map(apt => {
          const b = map[`${bName}-${apt}`];
          let status = 'vacant';
          if (b) {
            const cin  = b.checkIn  ? new Date(b.checkIn)  : null;
            const cout = b.checkOut ? new Date(b.checkOut) : null;
            if (b.status === 'active') {
              occupied++;
              status = (cout && cout >= today && cout < tomorrow) ? 'checkout_today' : 'occupied';
            } else if (b.status === 'awaiting_checkin') {
              occupied++;
              status = (cin && cin >= today && cin < tomorrow) ? 'checkin_today' : 'awaiting';
            } else if (b.status === 'awaiting_payment') {
              status = 'awaiting_payment';
            }
          }
          return { apt, status, bookingId: b?._id||null, name: b?.name||'', phone: b?.phone||'', checkIn: b?.checkIn||null, checkOut: b?.checkOut||null, bookingType: b?.bookingType||'', totalPrice: b?.totalPrice||0, paidAmount: b?.paidAmount||0 };
        }),
      }));
      const total = bData.floors.reduce((s,f)=>s+f.r.length,0);
      result[bName] = { floors, occupied, total };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Weekly Occupancy Stats ───────────────────────────────
router.get('/weekly-stats', auth, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);

    const totalApts = Object.values(GRID_BUILDINGS).reduce((sum,b)=>sum+b.floors.reduce((s,f)=>s+f.r.length,0),0);

    const since = new Date(today); since.setDate(today.getDate()-6);
    const bookings = await Booking.find({
      status:{ $in:['active','checkout','awaiting_checkin'] },
      checkIn:{ $exists:true }, checkOut:{ $exists:true },
    }).select('checkIn checkOut status').lean();

    const weekly=[];
    for(let i=6;i>=0;i--){
      const d=new Date(today); d.setDate(today.getDate()-i);
      const nd=new Date(d); nd.setDate(d.getDate()+1);
      const occ=bookings.filter(b=>{
        if(!b.checkIn||!b.checkOut)return false;
        return new Date(b.checkIn)<nd && new Date(b.checkOut)>d;
      }).length;
      weekly.push({
        label:d.toLocaleDateString('ar-SA',{weekday:'short',day:'numeric',month:'numeric'}),
        date:d.toISOString().split('T')[0],
        occupied:occ,
      });
    }
    res.json({weekly,total:totalApts});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── Housekeeping Stats (admin) ───────────────────────────
router.get('/housekeeping-stats', auth, async (req, res) => {
  try {
    const tasks = await HousekeepingTask.find({}).lean();
    const totalRooms = Object.values(GRID_BUILDINGS).reduce((sum,b)=>sum+b.floors.reduce((s,f)=>s+f.r.length,0),0);
    const dirty = tasks.filter(t=>t.status==='dirty'||t.status==='inspection'||t.status==='maintenance').length;
    const clean = totalRooms - dirty;
    res.json({ clean, dirty, total: totalRooms });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ─── Messaging (admin) ───────────────────────────────────
router.get('/conversations', auth, async (req, res) => {
  try {
    const convs = await Conversation.find().sort({ lastAt: -1 }).lean();
    res.json(convs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/conversations/:id', auth, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id).lean();
    if (!conv) return res.status(404).json({ error: 'غير موجود' });
    const messages = await Message.find({ conversation: conv._id }).sort({ createdAt: 1 }).lean();
    await Conversation.findByIdAndUpdate(conv._id, { unreadAdmin: 0 });
    res.json({ conv, messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/conversations/:id/reply', auth, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'غير موجود' });
    const body = req.body.body?.trim();
    if (!body) return res.status(400).json({ error: 'الرسالة فارغة' });
    await new Message({ conversation: conv._id, from: 'admin', senderName: 'Barez', body: body.slice(0, 2000) }).save();
    await Conversation.findByIdAndUpdate(conv._id, { lastAt: new Date(), $inc: { unreadCustomer: 1 }, status: 'open' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/conversations/:id/close', auth, async (req, res) => {
  try {
    await Conversation.findByIdAndUpdate(req.params.id, { status: 'closed' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── AI Chat (Gemini) ─────────────────────────────────────
router.post('/ai/chat', auth, async (req, res) => {
  try {
    const { message, context } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ text: 'مفتاح Gemini غير موجود في الإعدادات.' });

    const fullPrompt = `${context}\n\nسؤال المستخدم: ${message}`;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }]
        })
      }
    );
    const data = await response.json();
    if (data.error) return res.json({ text: `خطأ: ${data.error.message}` });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'لم يصل رد من الذكاء الاصطناعي.';
    res.json({ text });
  } catch (e) { res.status(500).json({ text: `تعذّر الاتصال: ${e.message}` }); }
});

// ─── Admin Users CRUD (admin only) ───────────────────────
router.get('/admin-users', auth, requireRole('admin'), async (req, res) => {
  try {
    const users = await AdminUser.find().select('-password').sort({ createdAt: 1 }).lean();
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin-users', auth, requireRole('admin'), async (req, res) => {
  try {
    const { name, username, password, role, avatar, allowed } = req.body;
    if (!name || !username || !password || !role) return res.status(400).json({ error: 'name, username, password, role مطلوبة' });
    if (!['admin', 'manager', 'employee'].includes(role)) return res.status(400).json({ error: 'دور غير صحيح' });
    const exists = await AdminUser.findOne({ username: username.trim() });
    if (exists) return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });
    const user = await new AdminUser({ name, username, password, role, avatar: avatar || username[0], allowed: allowed || [] }).save();
    audit(req, 'create', 'AdminUser', user._id, `إنشاء مستخدم ${username}`);
    res.json({ success: true, id: user._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/admin-users/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { name, role, avatar, allowed, active, password } = req.body;
    if (role && !['admin', 'manager', 'employee'].includes(role)) return res.status(400).json({ error: 'دور غير صحيح' });
    const user = await AdminUser.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (name !== undefined) user.name = name;
    if (role !== undefined) user.role = role;
    if (avatar !== undefined) user.avatar = avatar;
    if (allowed !== undefined) user.allowed = allowed;
    if (active !== undefined) user.active = active;
    if (password) user.password = password;
    await user.save();
    audit(req, 'update', 'AdminUser', user._id, `تعديل مستخدم ${user.username}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin-users/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.username === req.user?.username) return res.status(400).json({ error: 'لا يمكنك حذف حسابك الخاص' });
    user.active = false;
    await user.save();
    audit(req, 'delete', 'AdminUser', user._id, `تعطيل مستخدم ${user.username}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Audit Log viewer (admin only) ───────────────────────
router.get('/audit-logs', auth, requireRole('admin'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const filter = {};
    if (req.query.model) filter.model = req.query.model;
    if (req.query.user) filter.user = req.query.user;
    if (req.query.action) filter.action = req.query.action;
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// TEMP: delete all contracts — remove after use
router.delete('/admin/nuke-contracts', auth, requireRole('admin'), async (req, res) => {
  try {
    const Contract = require('../models/Contract');
    const { deletedCount } = await Contract.deleteMany({});
    res.json({ success: true, deleted: deletedCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
