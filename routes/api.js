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
const Voucher = require('../models/Voucher');
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
  }).catch(e => console.error('audit log failed:', e.message));
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
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(500, parseInt(req.query.limit) || 500);
    const contracts = await Contract.find().sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean();
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

// ─── Commissions (from Booking.marketer) ─────────────────
const COMM_RATES = { 'عبدالملك': 50, 'جود': 40 };

router.get('/commissions', auth, async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const bookings = await Booking.find({
      marketer: { $in: Object.keys(COMM_RATES) },
      propertyId: null,
      status: { $ne: 'cancelled' },
      createdAt: { $gte: monthStart },
    })
      .select('name building apt marketer createdAt checkIn marketerProof')
      .sort({ createdAt: -1 })
      .lean();
    res.json(bookings.map(b => ({
      _id: b._id,
      name: b.name,
      building: b.building,
      apt: b.apt,
      marketer: b.marketer,
      date: b.createdAt,
      amount: COMM_RATES[b.marketer] || 0,
      proof: b.marketerProof?.url || '',
      proofAt: b.marketerProof?.uploadedAt || null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/bookings/:id/marketer-proof', auth, async (req, res) => {
  try {
    const { url } = req.body;
    await Booking.findByIdAndUpdate(req.params.id, {
      'marketerProof.url': url || '',
      'marketerProof.uploadedAt': url ? new Date() : null,
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Vouchers (staff receipts) ───────────────────────────
router.get('/vouchers', auth, async (req, res) => {
  try {
    const { building, type, year, month, from, to, num, paymentMethod, page = 1, limit = 50 } = req.query;
    const filter = { propertyId: null };
    if (building && building !== 'all') filter.building = building;
    if (type && type !== 'all') filter.type = type;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (num) filter.number = { $regex: num, $options: 'i' };
    if (from || to || year || month) {
      if (year || month) {
        const y = parseInt(year) || new Date().getFullYear();
        const m = month ? parseInt(month) - 1 : null;
        filter.date = m !== null
          ? { $gte: new Date(y, m, 1), $lt: new Date(y, m + 1, 1) }
          : { $gte: new Date(y, 0, 1), $lt: new Date(y + 1, 0, 1) };
      } else {
        filter.date = {};
        if (from) filter.date.$gte = new Date(from);
        if (to) filter.date.$lte = new Date(to + 'T23:59:59');
      }
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [vouchers, total] = await Promise.all([
      Voucher.find(filter).sort({ date: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Voucher.countDocuments(filter),
    ]);
    const agg = await Voucher.aggregate([
      { $match: filter },
      { $group: { _id: '$type', count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]);
    const byType = {};
    agg.forEach(a => { byType[a._id] = { count: a.count, total: a.total }; });
    res.json({ vouchers, total, byType, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/vouchers', auth, async (req, res) => {
  try {
    const { type, date, name, phone, apt, building, amount, description, notes, checkNumber, bankName, dueDate, bookingId, paymentMethod } = req.body;
    if (!type || !amount) return res.status(400).json({ error: 'نوع الوثيقة والمبلغ مطلوبان' });
    const VALID_TYPES = ['receipt', 'invoice', 'disbursement', 'check', 'tax'];
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'نوع سند غير صالح' });
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
    const bld = building || '';
    const count = await Voucher.countDocuments({ building: bld, type, propertyId: null });
    const prefixes = { receipt: 'QBD', invoice: 'INV', disbursement: 'SRF', check: 'KMB', tax: 'ZRB' };
    const number = prefixes[type] + '-' + String(count + 1).padStart(4, '0');
    const v = await new Voucher({ building: bld, type, number, date: date ? new Date(date) : new Date(), name, phone, apt, amount: parsedAmount, description, notes, checkNumber, bankName, dueDate: dueDate ? new Date(dueDate) : undefined, bookingId: bookingId || undefined, createdBy: req.user?.name || req.user?.username || 'admin', paymentMethod: paymentMethod || '', propertyId: null }).save();
    res.json({ success: true, id: v._id, number: v.number });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/vouchers/:id', auth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const v = await Voucher.findOneAndDelete({ _id: req.params.id, propertyId: null });
    if (!v) return res.status(404).json({ error: 'السند غير موجود' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Cash Flow Report ──────────────────────────────────────
router.get('/reports/cash-flow', auth, async (req, res) => {
  try {
    const { dateFrom, dateTo, user, building, includeClosed, includeServices } = req.query;
    const from = dateFrom ? new Date(dateFrom) : (() => { const d=new Date(); d.setHours(0,0,0,0); return d; })();
    const to   = dateTo   ? new Date(dateTo)   : (() => { const d=new Date(); d.setHours(23,59,59,999); return d; })();

    const baseFilter = { propertyId: null };
    if (building) baseFilter.building = building;

    const vFilter = { ...baseFilter, date: { $gte: from, $lte: to } };
    if (user) vFilter.createdBy = user;

    const receiptTypes = ['receipt'];
    if (includeServices === 'true') receiptTypes.push('invoice');

    const [rawReceipts, rawDisbursements, rawChecks, users] = await Promise.all([
      Voucher.find({ ...vFilter, type: { $in: receiptTypes } }).sort({ date: 1 }).lean(),
      Voucher.find({ ...vFilter, type: 'disbursement' }).sort({ date: 1 }).lean(),
      Voucher.find({ ...baseFilter, type: 'check', date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean(),
      Voucher.distinct('createdBy', baseFilter),
    ]);

    const resolveMethod = v => v.paymentMethod || (v.bankName ? 'transfer' : 'cash');
    const mapV = v => ({
      _id: v._id, number: v.number || '-', date: v.date || v.createdAt || null,
      name: v.name || '', apt: v.apt || '', description: v.description || '',
      paymentMethod: resolveMethod(v), bankName: v.bankName || '',
      amount: v.amount || 0, createdBy: v.createdBy || '',
    });

    let receipts      = rawReceipts.map(mapV);
    let disbursements = rawDisbursements.map(mapV);
    const checks      = rawChecks.map(mapV);

    if (includeClosed === 'true') {
      const B = require('../models/Booking');
      const bkFilter = { ...baseFilter, status: 'checkout', checkOut: { $gte: from, $lte: to } };
      const closed = await B.find(bkFilter).sort({ checkOut: 1 }).lean();
      const bkRows = closed.filter(b => (b.paidAmount||0) > 0).map(b => ({
        _id: b._id, number: 'BK-'+b._id.toString().slice(-5).toUpperCase(),
        date: b.checkOut, name: b.name, apt: b.apt,
        description: `حجز شقة ${b.apt}`, paymentMethod: b.paymentMethod||'cash',
        bankName: '', amount: b.paidAmount||0, createdBy: '',
      }));
      receipts = [...receipts, ...bkRows].sort((a,b) => new Date(a.date)-new Date(b.date));
    }

    const sum  = arr => arr.reduce((s,v) => s+v.amount, 0);
    const byPm = (arr, pm) => sum(arr.filter(v => (v.paymentMethod||'cash') === pm));

    const totalReceipts      = sum(receipts);
    const totalDisbursements = sum(disbursements);
    const bankReceipts       = byPm(receipts, 'transfer');
    const bankDisbursements  = byPm(disbursements, 'transfer');
    const totalChecks        = sum(checks);
    const vatOnReceipts      = Math.round(totalReceipts / 1.15 * 0.15 * 100) / 100;
    const vatOnDisbursements = Math.round(totalDisbursements / 1.15 * 0.15 * 100) / 100;
    const pmReceipts = {
      cash:         byPm(receipts, 'cash') + sum(receipts.filter(v => !v.paymentMethod)),
      check:        byPm(receipts, 'check'),
      network:      byPm(receipts, 'network'),
      transfer:     byPm(receipts, 'transfer'),
      digital:      byPm(receipts, 'digital'),
      travel_agent: byPm(receipts, 'travel_agent'),
    };
    const [allBankR, allBankD] = await Promise.all([
      Voucher.aggregate([{ $match: { ...baseFilter, type: { $in: ['receipt','invoice'] }, $or:[{paymentMethod:'transfer'},{bankName:{$ne:'',$exists:true}}] } }, { $group:{_id:null,t:{$sum:'$amount'}} }]),
      Voucher.aggregate([{ $match: { ...baseFilter, type: 'disbursement', $or:[{paymentMethod:'transfer'},{bankName:{$ne:'',$exists:true}}] } }, { $group:{_id:null,t:{$sum:'$amount'}} }]),
    ]);
    const totalBankBalance = (allBankR[0]?.t||0) - (allBankD[0]?.t||0);
    const net     = totalReceipts - totalDisbursements;
    const netBank = bankReceipts - bankDisbursements;

    res.json({
      receipts, disbursements, checks,
      users: users.filter(Boolean),
      summary: {
        totalReceipts, totalDisbursements,
        countReceipts: receipts.length, countDisbursements: disbursements.length,
        bankReceipts, bankDisbursements,
        vatOnReceipts, vatOnDisbursements,
        net, netBank,
        totalFund: net, bankBalance: netBank,
        totalBankBalance, totalChecks,
        pmReceipts,
        depositReceipts: 0, depositDisbursements: 0, netDeposit: 0, prevDeposits: 0, prevAmounts: 0,
      },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Commissions History ──────────────────────────────────
router.get('/commission-history', auth, async (req, res) => {
  try {
    const history = await CommissionHistory.find().sort({ createdAt: -1 }).limit(200).lean();
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

router.post('/commission-proof', auth, async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'no image' });
    const crypto     = require('crypto');
    const cloudName  = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey     = process.env.CLOUDINARY_API_KEY;
    const apiSecret  = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret)
      return res.status(503).json({ error: 'Cloudinary not configured' });
    const folder    = 'barez/commission-proofs';
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign    = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');
    const upRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file:      `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`,
        api_key:   apiKey,
        timestamp,
        signature,
        folder,
      }),
    });
    if (!upRes.ok) return res.status(500).json({ error: 'upload failed' });
    const upData = await upRes.json();
    res.json({ url: upData.secure_url });
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
      'جوان ان': ['001','002','003','004','101','102','103','104','105','201','202','203','204','205','301','302','303','304','305','401','402'],
      'الماسة':  ['101','102','103','104','105','106','201','202','203','204','205','206','301','302','303','304','305','306'],
      'الواحة':  ['001','002','003','004','101','102','103','104','105','106','107','108','201','202','203','204','205','206','207','208','301'],
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
      body: JSON.stringify({ from: 'Barez <onboarding@resend.dev>', to: [process.env.NOTIFY_EMAIL || 'assisting@finsight-sa.com'], subject, html }),
    });
  } catch(e) { console.error('sendEmail failed:', e.message); }
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
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const [inquiries, total] = await Promise.all([
      Inquiry.find().sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean(),
      Inquiry.countDocuments(),
    ]);
    res.json({ data: inquiries, total, page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/inquiries/:id', auth, async (req, res) => {
  try {
    const allowed = ['status', 'notes', 'building', 'budget', 'duration'];
    const update = Object.fromEntries(allowed.filter(k => k in req.body).map(k => [k, req.body[k]]));
    await Inquiry.findByIdAndUpdate(req.params.id, update);
    audit(req, 'update', 'Inquiry', req.params.id, `تحديث الاستفسار: ${update.status || ''}`);
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
    if(q) filter.$text = { $search: q.trim().slice(0, 100) };
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

const LISTING_FIELDS = ['category','building','apt','floor','location','title','description','type','price_daily','price_annual','price_sale','bedrooms','bathrooms','area','frontage','maxGuests','amenities','photos','available','featured','houseRules','checkInTime','checkOutTime','cancellationPolicy','minNights'];
function pickListing(body) { return Object.fromEntries(LISTING_FIELDS.filter(k => k in body).map(k => [k, body[k]])); }

router.post('/listings', auth, async (req, res) => {
  try {
    const listing = await new Listing(pickListing(req.body)).save();
    res.json({ success: true, listing });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/listings/:id', auth, async (req, res) => {
  try {
    await Listing.findByIdAndUpdate(req.params.id, pickListing(req.body));
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

    // paidAmount excluded — must go through /staff/api/bookings/:id/payments to keep vouchers in sync
    const BOOKING_UPDATE_FIELDS = ['status','notes','name','phone','checkIn','checkOut','nights','totalPrice','idType','idNumber','bookingType','guests','marketer','building','apt'];
    const update = Object.fromEntries(BOOKING_UPDATE_FIELDS.filter(k => k in req.body).map(k => [k, req.body[k]]));
    await Booking.findByIdAndUpdate(req.params.id, update);
    audit(req, 'update', 'Booking', req.params.id, `تحديث الحجز${newStatus && newStatus !== prevStatus ? ': ' + prevStatus + ' → ' + newStatus : ''}`);

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

// ─── Booking Stats (staff bookings aggregate) ─────────────
router.get('/booking-stats', auth, async (req, res) => {
  try {
    const baseFilter = { building: { $exists: true, $ne: null }, listing: null, status: { $ne: 'cancelled' } };
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Single aggregation with $facet replaces 5 parallel queries
    const [result] = await Booking.aggregate([
      { $match: baseFilter },
      { $facet: {
        overall: [{ $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$totalPrice' }, paid: { $sum: '$paidAmount' },
          open:   { $sum: { $cond: [{ $in: ['$status', ['active','awaiting_checkin','awaiting_payment']] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $eq: ['$status','checkout'] }, 1, 0] } },
        }}],
        thisMonth: [{ $match: { checkIn: { $gte: thisMonthStart } } },
          { $group: { _id: null, count: { $sum: 1 }, paid: { $sum: '$paidAmount' } } }],
        prevMonth: [{ $match: { checkIn: { $gte: prevMonthStart, $lt: thisMonthStart } } },
          { $group: { _id: null, count: { $sum: 1 }, paid: { $sum: '$paidAmount' } } }],
      }},
    ]);

    const s  = result.overall[0]   || { count:0, revenue:0, paid:0, open:0, closed:0 };
    const tm = result.thisMonth[0] || { count:0, paid:0 };
    const pm = result.prevMonth[0] || { count:0, paid:0 };
    res.json({ total: s.count, revenue: s.revenue, paid: s.paid, remaining: s.revenue - s.paid,
      open: s.open, closed: s.closed,
      thisMonth: { count: tm.count, paid: tm.paid },
      prevMonth: { count: pm.count, paid: pm.paid },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Create Booking from Admin Dashboard ──────────────────
router.post('/bookings', auth, async (req, res) => {
  try {
    const { name, building, apt, totalPrice, paidAmount, checkIn, checkOut, phone, source, notes, bookingType, status } = req.body;
    if (!name || !building || !apt || !totalPrice || !checkIn)
      return res.status(400).json({ error: 'البيانات غير مكتملة' });
    const parseDate = d => {
      if (!d) return null;
      if (String(d).includes('/')) { const [day, month, year] = String(d).split('/'); return new Date(Number(year), Number(month)-1, Number(day)); }
      return new Date(d);
    };
    const cin = parseDate(checkIn);
    if (!cin || isNaN(cin)) return res.status(400).json({ error: 'تاريخ الدخول غير صحيح' });
    const cout = checkOut ? parseDate(checkOut) : null;
    const bk = await new Booking({
      name, building, apt,
      phone: phone || '',
      totalPrice: parseFloat(totalPrice) || 0,
      paidAmount: parseFloat(paidAmount) || 0,
      checkIn: cin,
      checkOut: cout,
      source: source || 'يدوي',
      notes: notes || '',
      bookingType: bookingType || 'annual',
      status: status === 'مغلق' ? 'checkout' : 'active',
      listing: null,
      propertyId: null,
    }).save();
    res.json({ success: true, id: bk._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Staff Bookings Full List (for admin dashboard) ────────
router.get('/staff-bookings-full', auth, async (req, res) => {
  try {
    const bookings = await Booking.find(
      { building: { $exists: true, $ne: null }, listing: null },
      { name:1, phone:1, building:1, apt:1, totalPrice:1, paidAmount:1, status:1, checkIn:1, checkOut:1, source:1, bookingType:1, nights:1, marketer:1, createdAt:1 }
    ).sort({ checkIn: -1 }).lean();
    res.json(bookings);
  } catch(e) { res.status(500).json({ error: e.message }); }
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
    audit(req, 'update', 'Host', host._id, 'تغيير كلمة المرور');
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
    await Listing.findByIdAndUpdate(req.params.id, pickListing(req.body));
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
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const mongoose = require('mongoose');
    const hostId = new mongoose.Types.ObjectId(req.hostAccount.id);
    const [bookings, total] = await Promise.all([
      Booking.aggregate([
        { $lookup: { from: 'listings', localField: 'listing', foreignField: '_id', as: 'listing' } },
        { $unwind: { path: '$listing', preserveNullAndEmpty: false } },
        { $match: { 'listing.host': hostId } },
        { $sort: { createdAt: -1 } },
        { $skip: (page-1)*limit },
        { $limit: limit },
        { $project: { 'listing.title': 1, 'listing.photos': 1, apt: 1, name: 1, phone: 1, status: 1, checkIn: 1, checkOut: 1, totalPrice: 1, paidAmount: 1, bookingType: 1, createdAt: 1 } },
      ]),
      Booking.aggregate([
        { $lookup: { from: 'listings', localField: 'listing', foreignField: '_id', as: 'listing' } },
        { $unwind: '$listing' },
        { $match: { 'listing.host': hostId } },
        { $count: 'total' },
      ]).then(r => r[0]?.total || 0),
    ]);
    res.json({ data: bookings, total, page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/host/bookings/:id/status', hostAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const mongoose = require('mongoose');
    const hostId = new mongoose.Types.ObjectId(req.hostAccount.id);
    const bookingId = new mongoose.Types.ObjectId(req.params.id);
    // Single aggregation to verify ownership and fetch booking
    const [booking] = await Booking.aggregate([
      { $match: { _id: bookingId } },
      { $lookup: { from: 'listings', localField: 'listing', foreignField: '_id', as: 'listing' } },
      { $unwind: { path: '$listing', preserveNullAndEmpty: false } },
      { $match: { 'listing.host': hostId } },
    ]);
    if (!booking) return res.status(404).json({ error: 'الحجز غير موجود' });
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
    const mongoose = require('mongoose');
    const hostId = new mongoose.Types.ObjectId(req.hostAccount.id);
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);

    const [listingStats, bookingStats] = await Promise.all([
      Listing.aggregate([
        { $match: { host: hostId } },
        { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: ['$available', 1, 0] } } } },
      ]),
      Booking.aggregate([
        { $lookup: { from: 'listings', localField: 'listing', foreignField: '_id', as: 'listing' } },
        { $unwind: { path: '$listing', preserveNullAndEmpty: false } },
        { $match: { 'listing.host': hostId } },
        { $group: {
          _id: null,
          pending:          { $sum: { $cond: [{ $eq: ['$status','pending'] }, 1, 0] } },
          active:           { $sum: { $cond: [{ $eq: ['$status','active'] }, 1, 0] } },
          totalEarnings:    { $sum: { $cond: [{ $eq: ['$status','checkout'] }, '$totalPrice', 0] } },
          thisMonthEarnings:{ $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', startOfMonth] }, { $ne: ['$status','cancelled'] }] }, '$totalPrice', 0] } },
        }},
      ]),
    ]);

    const ls = listingStats[0] || { total: 0, active: 0 };
    const bs = bookingStats[0]  || { pending: 0, active: 0, totalEarnings: 0, thisMonthEarnings: 0 };
    res.json({
      totalListings:     ls.total,
      activeListings:    ls.active,
      pendingBookings:   bs.pending,
      activeBookings:    bs.active,
      thisMonthEarnings: bs.thisMonthEarnings,
      totalEarnings:     bs.totalEarnings,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Admin: Hosts management ──────────────────────────────
router.get('/hosts', auth, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const [hosts, total] = await Promise.all([
      Host.find(filter).sort({ createdAt: -1 }).select('-password').skip((page-1)*limit).limit(limit).lean(),
      Host.countDocuments(filter),
    ]);
    res.json({ data: hosts, total, page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/hosts/:id/approve', auth, requireRole('admin'), async (req, res) => {
  try {
    await Host.findByIdAndUpdate(req.params.id, { status: 'approved', rejectionReason: '' });
    audit(req, 'update', 'Host', req.params.id, 'تمت الموافقة على المضيف');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/hosts/:id/reject', auth, requireRole('admin'), async (req, res) => {
  try {
    const reason = req.body.reason || '';
    await Host.findByIdAndUpdate(req.params.id, { status: 'rejected', rejectionReason: reason });
    audit(req, 'update', 'Host', req.params.id, `رُفض المضيف: ${reason}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/hosts/:id/suspend', auth, requireRole('admin'), async (req, res) => {
  try {
    await Host.findByIdAndUpdate(req.params.id, { status: 'suspended' });
    audit(req, 'update', 'Host', req.params.id, 'تم تعليق حساب المضيف');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Staff Performance Leaderboard ───────────────────────
router.get('/staff-performance', auth, async (req, res) => {
  try {

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [logs, bookings] = await Promise.all([
      ActivityLog.find({ createdAt: { $gte: since } }).limit(2000).lean(),
      Booking.find({ createdAt: { $gte: since } }).limit(1000).lean(),
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
  'جوان ان': { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105']},{l:'الثاني',r:['201','202','203','204','205']},{l:'الثالث',r:['301','302','303','304','305']},{l:'الرابع',r:['401','402']}] },
  'الماسة':  { floors: [{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204','205','206']},{l:'الثالث',r:['301','302','303','304','305','306']}] },
  'الواحة':  { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105','106','107','108']},{l:'الثاني',r:['201','202','203','204','205','206','207','208']},{l:'الثالث',r:['301']}] },
};

router.get('/apartments/grid', auth, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    const bookings = await Booking.find({
      status: { $in: ['awaiting_payment','awaiting_checkin','active'] },
      building: { $exists: true, $ne: null },
      apt: { $exists: true, $ne: null },
      propertyId: null,
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
    const buildingNames = Object.keys(GRID_BUILDINGS);
    const buildingTotals = {};
    buildingNames.forEach(b => {
      buildingTotals[b] = GRID_BUILDINGS[b].floors.reduce((s,f)=>s+f.r.length,0);
    });
    const totalApts = Object.values(buildingTotals).reduce((a,b)=>a+b,0);

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() - (6 - i));
      const nd = new Date(d); nd.setDate(d.getDate() + 1);
      return { d, nd, label: d.toLocaleDateString('ar-SA', { weekday:'short', day:'numeric', month:'numeric' }), date: d.toISOString().split('T')[0] };
    });

    // Per-building weekly counts in parallel
    const perBuilding = {};
    await Promise.all(buildingNames.map(async bName => {
      const counts = await Promise.all(days.map(({ d, nd }) =>
        Booking.countDocuments({
          building: bName, propertyId: null,
          status: { $in: ['active','checkout','awaiting_checkin'] },
          checkIn: { $lt: nd }, checkOut: { $gt: d },
        })
      ));
      perBuilding[bName] = { total: buildingTotals[bName], weekly: days.map((day, i) => ({ label: day.label, date: day.date, occupied: counts[i] })) };
    }));

    // Combined (sum across buildings)
    const weekly = days.map((day, i) => ({
      label: day.label, date: day.date,
      occupied: buildingNames.reduce((s, b) => s + perBuilding[b].weekly[i].occupied, 0),
    }));

    res.json({ weekly, total: totalApts, perBuilding });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── Housekeeping Stats (admin) ───────────────────────────
router.get('/housekeeping-stats', auth, async (req, res) => {
  try {
    const totalRooms = Object.values(GRID_BUILDINGS).reduce((sum,b)=>sum+b.floors.reduce((s,f)=>s+f.r.length,0),0);
    const [result] = await HousekeepingTask.aggregate([
      { $group: { _id: null, dirty: { $sum: { $cond: [{ $in: ['$status',['dirty','inspection','maintenance']] }, 1, 0] } } } },
    ]);
    const dirty = result?.dirty || 0;
    res.json({ clean: totalRooms - dirty, dirty, total: totalRooms });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ─── Messaging (admin) ───────────────────────────────────
router.get('/conversations', auth, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const [convs, total] = await Promise.all([
      Conversation.find(filter).sort({ lastAt: -1 }).skip((page-1)*limit).limit(limit).lean(),
      Conversation.countDocuments(filter),
    ]);
    res.json({ data: convs, total, page, limit });
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
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;
    const [users, total] = await Promise.all([
      AdminUser.find().select('-password').sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
      AdminUser.countDocuments(),
    ]);
    res.json({ data: users, total, page, limit });
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


// ─── Cron: Checkout Reminders (called by Vercel Cron daily 8AM KSA) ──────────
router.get('/cron/checkout-reminders', async (req, res) => {
  // Verify Vercel cron secret
  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const WA = require('../utils/whatsapp');
    const tomorrow = new Date(); tomorrow.setHours(0,0,0,0); tomorrow.setDate(tomorrow.getDate()+1);
    const dayAfter  = new Date(tomorrow); dayAfter.setDate(tomorrow.getDate()+1);

    const bookings = await Booking.find({
      status: 'active',
      checkOut: { $gte: tomorrow, $lt: dayAfter },
    }).select('phone name apt').lean();

    let sent = 0, failed = 0;
    for (const bk of bookings) {
      if (!bk.phone) continue;
      try {
        await WA.sendCheckoutReminder(bk.phone, bk.name, bk.apt);
        sent++;
      } catch { failed++; }
    }

    console.log(`✅ Cron checkout-reminders: ${sent} sent, ${failed} failed`);
    res.json({ success: true, sent, failed, total: bookings.length });
  } catch (e) {
    console.error('Cron checkout-reminders error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
