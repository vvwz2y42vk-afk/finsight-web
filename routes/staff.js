const express = require('express');
const router = express.Router();
const { createToken, verifyToken } = require('../utils/auth');
const { createRateLimiter } = require('../utils/rateLimit');
const Property = require('../models/Property');
const WA = require('../utils/whatsapp');
const multer = require('multer');
const XLSX   = require('xlsx');

const nazeelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const staffLoginLimit    = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10,  message: 'محاولات دخول كثيرة، انتظر 15 دقيقة' });
const staffRegisterLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5,   message: 'تجاوزت الحد المسموح للتسجيل، حاول بعد ساعة' });
const apiLimit           = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 300, message: 'طلبات كثيرة جداً، حاول بعد قليل' });
const adminLimit         = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20,  message: 'طلبات كثيرة جداً، حاول بعد قليل' });
const checkUserLimit     = createRateLimiter({ windowMs: 60 * 1000,       max: 30,  message: 'طلبات كثيرة جداً، حاول بعد قليل' });

const COOKIE = 'fs_staff';
const COPTS  = { httpOnly: true, maxAge: 12 * 60 * 60 * 1000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };

// Hardcoded buildings for BAREZ internal (propertyId === null)
const BLDGS = {
  'المنارا':  { floors: [{l:'أرضي',r:['001','002']},{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204','205','206']},{l:'الثالث',r:['301','302','303','304','305','306']},{l:'الرابع',r:['401','402','403','404','405','406']},{l:'الخامس',r:['501','502','503','504']}] },
  'جوان ان': {
    floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105']},{l:'الثاني',r:['201','202','203','204','205']},{l:'الثالث',r:['301','302','303','304','305']},{l:'الرابع',r:['401','402']}],
    types: {
      '001':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '002':{title:'غرفتين جناح عائلي',bedrooms:2},
      '003':{title:'غرفتين جناح عائلي',bedrooms:2},
      '004':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '101':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '102':{title:'غرفتين جناح عائلي',bedrooms:2},
      '103':{title:'جناح ديلوكس (3 أسرة مفردة)',bedrooms:1},
      '104':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '105':{title:'استوديو (غرفة مفردة)',bedrooms:1},
      '201':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '202':{title:'غرفتين جناح ديلوكس (3 أسرة مفردة)',bedrooms:2},
      '203':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '204':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '205':{title:'استوديو (غرفة مفردة)',bedrooms:1},
      '301':{title:'غرفتين جناح عائلي',bedrooms:2},
      '302':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '303':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '304':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '305':{title:'استوديو (غرفة مفردة)',bedrooms:1},
      '401':{title:'جناح ديلوكس (غرفة وصالة)',bedrooms:1},
      '402':{title:'غرفتين جناح عائلي',bedrooms:2},
    },
  },
  'الماسة':  { floors: [{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204','205','206']},{l:'الثالث',r:['301','302','303','304','305','306']}] },
  'الواحة':  { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105','106','107','108']},{l:'الثاني',r:['201','202','203','204','205','206','207','208']},{l:'الثالث',r:['301']}] },
};

// Returns building config — from DB if property exists, else hardcoded
async function getBldgConfig(staff) {
  if (staff.propertyId) {
    const prop = await Property.findById(staff.propertyId).lean();
    if (prop) {
      const map = {};
      prop.buildings.forEach(b => {
        map[b.name] = { floors: b.floors.map(f => ({ l: f.label, r: f.rooms })) };
      });
      return { bldgs: map, prop };
    }
  }
  return { bldgs: BLDGS, prop: null };
}

function totalAptsFromConfig(bldgs, bldName) {
  return (bldgs[bldName]?.floors || []).reduce((s, f) => s + f.r.length, 0);
}


function staffAuth(req,res,next){ req.staff=verifyToken(req.cookies?.[COOKIE])||null; next(); }
function reqStaff(req,res,next){
  if(!req.staff) return res.redirect('/staff/login');
  // Subscription check for registered properties
  if(req.staff.propertyId && req.staff.planExpiry) {
    if(Date.now() > new Date(req.staff.planExpiry).getTime()) {
      res.clearCookie(COOKIE);
      return res.redirect('/staff/login?expired=1');
    }
  }
  next();
}
const DEFAULT_PERMS=['dashboard','apartments','bookings','customers','housekeeping','activity','new_booking','edit_booking','cancel_booking','vouchers','reports','guests','maintenance'];

function hasMaintenance(req) {
  return req.staff.role === 'manager' || (req.staff.permissions || []).includes('maintenance');
}

function buildBookingFilter(staff, { sf='open', apt='', booking_type='', date_from='', date_to='' }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
  const filter = staff.propertyId
    ? { propertyId: staff.propertyId }
    : { building: staff.building, propertyId: null };
  if      (sf==='open')                  filter.status = { $nin:['cancelled','checkout'] };
  else if (sf==='active')                filter.status = 'active';
  else if (sf==='pending_checkin')       filter.status = { $in:['pending','awaiting_payment','awaiting_checkin'] };
  else if (sf==='today_arrival_pending') { filter.checkIn={$gte:today,$lt:tomorrow}; filter.status={$ne:'active'}; }
  else if (sf==='today_arrival_done')    { filter.checkIn={$gte:today,$lt:tomorrow}; filter.status='active'; }
  else if (sf==='today_arrival_all')     filter.checkIn = { $gte:today,$lt:tomorrow };
  else if (sf==='today_dep_pending')     { filter.checkOut={$gte:today,$lt:tomorrow}; filter.status='active'; }
  else if (sf==='today_dep_done')        { filter.checkOut={$gte:today,$lt:tomorrow}; filter.status='checkout'; }
  else if (sf==='today_dep_all')         filter.checkOut = { $gte:today,$lt:tomorrow };
  else if (sf==='closed')                filter.status = 'checkout';
  else if (sf==='cancelled')             filter.status = 'cancelled';
  if (apt)          filter.apt = apt;
  if (booking_type) filter.bookingType = booking_type;
  if (date_from)    filter.checkIn = { ...(filter.checkIn||{}), $gte: new Date(date_from) };
  if (date_to)      filter.checkIn = { ...(filter.checkIn||{}), $lte: new Date(date_to) };
  return filter;
}

router.use(staffAuth);
router.use('/api/', apiLimit);

// ── Auth ─────────────────────────────────────────────────
router.get('/login',(req,res)=>{ if(req.staff)return res.redirect('/staff/dashboard'); res.render('staff-login',{error:null,query:req.query}); });

router.post('/login', staffLoginLimit, async (req,res) => {
  try {
    const S = require('../models/StaffUser');
    const { logSecEvent } = require('../middleware/securityLog');
    const u = await S.findOne({ username:(req.body.username||'').trim(), active:true });
    if (!u||!(await u.comparePassword(req.body.password))) {
      logSecEvent('LOGIN_FAIL', req, { username: req.body.username, summary: `فشل دخول موظف: ${req.body.username}` });
      return res.render('staff-login',{error:'اسم المستخدم أو كلمة المرور غير صحيحة'});
    }
    const perms = u.permissions?.length ? [...new Set(u.permissions)] : DEFAULT_PERMS;
    let planExpiry = null;
    let propDoc = null;
    if (u.propertyId) {
      propDoc = await Property.findById(u.propertyId).lean();
      if (!propDoc || !propDoc.active) return res.render('staff-login', { error: 'هذا الحساب موقوف. تواصل مع الإدارة.' });
      planExpiry = propDoc?.planExpiry || null;
    }
    res.cookie(COOKIE, createToken({id:u._id,name:u.name,building:u.building,role:u.role,permissions:perms,propertyId:u.propertyId||null,planExpiry}), COPTS);
    // New tenant: redirect to building setup if no floors configured yet
    if (propDoc) {
      const needsSetup = !propDoc.buildings?.length || propDoc.buildings.every(b => !b.floors?.length);
      if (needsSetup) return res.redirect('/staff/setup');
    }
    res.redirect('/staff/dashboard');
  } catch(e){ res.render('staff-login',{error:'حدث خطأ'}); }
});

router.get('/logout',(req,res)=>{ res.clearCookie(COOKIE); res.redirect('/staff/login'); });

// ── Forgot / Reset Password ───────────────────────────────
const forgotLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5, message: 'محاولات كثيرة، انتظر ساعة' });

router.get('/forgot-password', (req, res) => {
  if (req.staff) return res.redirect('/staff/dashboard');
  res.render('staff-forgot-password', { error: null, success: null });
});

router.post('/forgot-password', forgotLimit, async (req, res) => {
  try {
    const S = require('../models/StaffUser');
    const user = await S.findOne({ username: (req.body.username || '').trim() });
    if (user) {
      const token = require('crypto').randomBytes(32).toString('hex');
      user.resetToken = token;
      user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
      // Get email from property if SaaS tenant
      let email = null;
      if (user.propertyId) {
        const prop = await Property.findById(user.propertyId).select('adminEmail').lean();
        email = prop?.adminEmail;
      }
      const base = process.env.BASE_URL || 'https://barez.pro';
      const resetUrl = `${base}/staff/reset-password/${token}`;
      require('../utils/mailer').sendEmail({
        to: email || 'no-email',
        subject: 'إعادة تعيين كلمة المرور — BAREZ',
        html: `<div dir="rtl" style="font-family:Cairo,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
          <h2 style="color:#1a3d8f;margin-bottom:8px;">إعادة تعيين كلمة المرور</h2>
          <p>انقر على الرابط أدناه لإعادة تعيين كلمة مرور حساب <strong>${user.username}</strong>:</p>
          <a href="${resetUrl}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#1a3d8f;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">إعادة تعيين كلمة المرور</a>
          <p style="color:#888;font-size:13px;">الرابط صالح لمدة ساعة واحدة فقط. إذا لم تطلب ذلك، تجاهل هذا البريد.</p>
        </div>`,
      }).catch(() => {});
    }
    // نفس الرد سواء وُجد الحساب أم لا (لمنع enumeration)
    res.render('staff-forgot-password', { error: null, success: 'إذا كان الحساب موجوداً، ستصلك رسالة بالبريد الإلكتروني خلال دقيقة' });
  } catch(e) { res.render('staff-forgot-password', { error: 'حدث خطأ، حاول لاحقاً', success: null }); }
});

router.get('/reset-password/:token', async (req, res) => {
  try {
    const S = require('../models/StaffUser');
    const user = await S.findOne({ resetToken: req.params.token, resetTokenExpiry: { $gt: new Date() } }).lean();
    if (!user) return res.render('staff-reset-password', { error: 'الرابط غير صالح أو منتهي الصلاحية', token: '' });
    res.render('staff-reset-password', { error: null, token: req.params.token });
  } catch(e) { res.render('staff-reset-password', { error: 'حدث خطأ', token: '' }); }
});

router.post('/reset-password/:token', forgotLimit, async (req, res) => {
  try {
    const S = require('../models/StaffUser');
    const { password, confirmPassword } = req.body;
    if (!password || password.length < 8)
      return res.render('staff-reset-password', { error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل', token: req.params.token });
    if (password !== confirmPassword)
      return res.render('staff-reset-password', { error: 'كلمتا المرور غير متطابقتين', token: req.params.token });
    const user = await S.findOne({ resetToken: req.params.token, resetTokenExpiry: { $gt: new Date() } });
    if (!user) return res.render('staff-reset-password', { error: 'الرابط غير صالح أو منتهي الصلاحية', token: '' });
    user.password = password;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();
    res.redirect('/staff/login?reset=1');
  } catch(e) { res.render('staff-reset-password', { error: 'حدث خطأ', token: req.params.token }); }
});

router.get('/api/check-username', checkUserLimit, async (req, res) => {
  const u = (req.query.u || '').trim();
  if (!u || u.length < 3) return res.json({ taken: false });
  const S = require('../models/StaffUser');
  const exists = await S.exists({ username: u });
  res.json({ taken: !!exists });
});
router.get('/dashboard', reqStaff, async (req,res) => {
  try {
    const S = require('../models/StaffUser');
    const fresh = await S.findById(req.staff.id).select('permissions active building role name').lean();
    if (fresh) {
      if (fresh.active === false) {
        res.clearCookie(COOKIE);
        return res.redirect('/staff/login?expired=1');
      }
      // Rebuild staff payload with fresh data from DB
      req.staff = {
        ...req.staff,
        permissions: fresh.permissions?.length ? fresh.permissions : DEFAULT_PERMS,
        building: fresh.building || req.staff.building,
        role: fresh.role || req.staff.role,
      };
      // Refresh cookie so subsequent API calls also see updated permissions
      res.cookie(COOKIE, createToken(req.staff), COPTS);
    }
  } catch(e) { /* DB unavailable — use JWT permissions as fallback */ }
  res.setHeader('Cache-Control','no-store');
  res.render('staff-dashboard', { staff: req.staff }, (err, html) => {
    if (err) {
      console.error('[staff-dashboard render error]', err.message, err.stack);
      return res.status(500).send(`<pre>render error: ${err.message}</pre>`);
    }
    res.send(html);
  });
});

// ── API: Stats ────────────────────────────────────────────
router.get('/api/stats', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const bld = req.staff.building;
    const today = new Date(); today.setHours(0,0,0,0);
    const tom   = new Date(today); tom.setDate(today.getDate()+1);

    const statsFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: bld, propertyId: null };

    const [activeCount, arrivalsCount, departuresCount, newBkCount, bldgsCfg, weeklyRaw] = await Promise.all([
      B.countDocuments({ ...statsFilter, status: 'active' }),
      B.countDocuments({ ...statsFilter, checkIn: { $gte: today, $lt: tom }, status: { $in: ['awaiting_checkin','active'] } }),
      B.countDocuments({ ...statsFilter, checkOut: { $gte: today, $lt: tom }, status: 'active' }),
      B.countDocuments({ ...statsFilter, status: { $in: ['pending','awaiting_payment'] } }),
      getBldgConfig(req.staff),
      // weekly occupancy: for each of 7 days check how many bookings span that day
      B.aggregate([
        { $match: { ...statsFilter, status: { $in: ['active','checkout','awaiting_checkin'] }, checkIn: { $lt: tom }, checkOut: { $gt: new Date(today.getTime() - 6*86400000) } } },
        { $project: { checkIn: 1, checkOut: 1 } },
      ]),
    ]);

    const total = totalAptsFromConfig(bldgsCfg.bldgs, bld);
    const rate  = total ? Math.round(activeCount / total * 100) : 0;

    const weekly = [];
    for (let i=6;i>=0;i--) {
      const d  = new Date(today); d.setDate(today.getDate()-i);
      const nd = new Date(d);     nd.setDate(d.getDate()+1);
      const occ = weeklyRaw.filter(b => b.checkIn < nd && b.checkOut > d).length;
      weekly.push({ label: d.toLocaleDateString('ar-SA',{weekday:'short',day:'numeric',month:'numeric'}), occupied: occ, total });
    }

    res.json({ arrivals: arrivalsCount, departures: departuresCount, currentGuests: activeCount, newBookings: newBkCount, occupancyRate: rate, occupied: activeCount, total, weekly });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Apartments ───────────────────────────────────────
router.get('/api/apartments', reqStaff, async (req,res) => {
  try {
    const B  = require('../models/Booking');
    const HK = require('../models/HousekeepingTask');
    const bld = req.staff.building;
    const { bldgs: aptBldgs } = await getBldgConfig(req.staff);
    const bData = aptBldgs[bld]; if(!bData) return res.status(404).json({error:'المبنى غير موجود'});

    const today=new Date(); today.setHours(0,0,0,0);
    const tom=new Date(today); tom.setDate(today.getDate()+1);

    const L = require('../models/Listing');
    const tenantFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: bld, propertyId: null };
    const bookings = await B.find({ ...tenantFilter, status:{$in:['awaiting_payment','awaiting_checkin','active']} }).lean();
    const hkTasks  = await HK.find(tenantFilter).lean();
    const listings = await L.find({ building:bld }).select('apt title bedrooms price_daily price_annual type').lean();
    const bmap={}, hkmap={}, lmap={};
    bookings.forEach(b=>{ if(b.apt) bmap[b.apt]=b; });
    hkTasks.forEach(t=>{ hkmap[t.apt]=t; });
    listings.forEach(l=>{ if(l.apt) lmap[l.apt]=l; });

    const floors = bData.floors.map(f=>({
      label: f.l,
      rooms: f.r.map(apt=>{
        const b=bmap[apt], hk=hkmap[apt], l=lmap[apt];
        let status='vacant';
        if(b){
          const cin=b.checkIn?new Date(b.checkIn):null, cout=b.checkOut?new Date(b.checkOut):null;
          if(b.status==='active')        status=(cout&&cout>=today&&cout<tom)?'checkout_today':'occupied';
          else if(b.status==='awaiting_checkin') status=(cin&&cin>=today&&cin<tom)?'checkin_today':'awaiting';
          else if(b.status==='awaiting_payment') status='awaiting_payment';
        }
        const tInfo = bData.types?.[apt] || {};
        return { apt, status, housekeeping:hk?.status||'clean', bookingId:b?._id||null, name:b?.name||'', phone:b?.phone||'', checkIn:b?.checkIn||null, checkOut:b?.checkOut||null, nights:b?.nights||0, totalPrice:b?.totalPrice||0, paidAmount:b?.paidAmount||0, idType:b?.idType||'', idNumber:b?.idNumber||'', bookingType:b?.bookingType||l?.type||'both', notes:hk?.notes||'', roomType:l?.title||tInfo.title||'', bedrooms:l?.bedrooms||tInfo.bedrooms||0, priceDaily:l?.price_daily||0, priceAnnual:l?.price_annual||0 };
      }),
    }));
    res.json({ building:bld, floors });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Bookings ─────────────────────────────────────────
router.get('/api/bookings', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const { sf='open', apt='', booking_type='', source='', date_from='', date_to='', booking_num='', q='' } = req.query;
    const filter = buildBookingFilter(req.staff, { sf, apt, booking_type, date_from, date_to });
    if (source) filter.source = source;

    let list = await B.find(filter).sort({checkIn:-1}).limit(300).lean();

    const qs = q.trim();
    if (qs) list = list.filter(b => b.name?.includes(qs)||b.phone?.includes(qs)||b.apt?.includes(qs));
    if (booking_num.trim()) list = list.filter(b => b._id.toString().slice(-5).toUpperCase()===booking_num.trim().toUpperCase());

    // Today in Saudi time (UTC+3)
    const nowSaudi = new Date(Date.now() + 3*60*60*1000);
    const tY=nowSaudi.getUTCFullYear(), tM=nowSaudi.getUTCMonth(), tD=nowSaudi.getUTCDate();

    res.json(list.map(b=>{
      let checkoutToday=false;
      if(b.checkOut){
        const co=new Date(new Date(b.checkOut).getTime()+3*60*60*1000);
        checkoutToday=co.getUTCFullYear()===tY&&co.getUTCMonth()===tM&&co.getUTCDate()===tD;
      }
      return {
        bookingNum: b._id.toString().slice(-5).toUpperCase(),
        name: b.name, phone: b.phone, apt: b.apt,
        checkIn: b.checkIn, checkOut: b.checkOut,
        status: b.status, bookingType: b.bookingType,
        totalPrice: b.totalPrice, paidAmount: b.paidAmount||0,
        source: b.source||'', bookingId: b._id,
        _id: b._id, checkoutToday,
      };
    }));
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Allowed booking sources — staff can only set these values, not arbitrary strings
const VALID_BOOKING_SOURCES = ['يدوي','استقبال مباشر','جاذرين','Booking.com','Airbnb','Agoda','نزيل'];

// Allowed status transitions — prevents arbitrary state manipulation
const STATUS_TRANSITIONS = {
  pending:           ['active','awaiting_payment','awaiting_checkin','cancelled'],
  awaiting_payment:  ['pending','awaiting_checkin','cancelled'],
  awaiting_checkin:  ['active','cancelled'],
  active:            ['checkout'],
  checkout:          [],
  cancelled:         [],
};
const VALID_STATUSES = Object.keys(STATUS_TRANSITIONS);

router.put('/api/bookings/:id/status', reqStaff, async (req,res) => {
  try {
    const B=require('../models/Booking'), L=require('../models/Listing'), AL=require('../models/ActivityLog');
    const statusFilter = req.staff.propertyId
      ? {_id:req.params.id, propertyId:req.staff.propertyId}
      : {_id:req.params.id, building:req.staff.building, propertyId:null};
    const bk = await B.findOne(statusFilter).lean();
    if(!bk) return res.status(404).json({error:'الحجز غير موجود'});

    const {status}=req.body, prev=bk.status;

    // Validate target status is a known value
    if(!VALID_STATUSES.includes(status))
      return res.status(400).json({error:'حالة غير مدعومة: '+status});

    // Validate the transition is allowed
    if(status !== prev && !STATUS_TRANSITIONS[prev]?.includes(status))
      return res.status(400).json({error:`لا يمكن الانتقال من "${prev}" إلى "${status}"`});

    // إلغاء حجز مدفوع → مدير فقط
    if (status === 'cancelled' && status !== prev && (bk.paidAmount||0) > 0 && req.staff.role !== 'manager')
      return res.status(403).json({ error: `لا يمكن إلغاء حجز مدفوع (${bk.paidAmount} ر.س) — تواصل مع المدير` });

    await B.findByIdAndUpdate(bk._id,{status});
    if(bk.listing&&status!==prev){
      if(status==='awaiting_checkin'&&bk.bookingType==='daily'&&bk.checkIn&&bk.checkOut)
        await L.findByIdAndUpdate(bk.listing,{$push:{blockedRanges:{checkIn:bk.checkIn,checkOut:bk.checkOut,bookingId:bk._id}}});
      else if(status==='checkout'&&bk.bookingType!=='daily')
        await L.findByIdAndUpdate(bk.listing,{available:true});
      else if(status==='cancelled'&&['awaiting_checkin','active'].includes(prev)){
        if(bk.bookingType==='daily') await L.findByIdAndUpdate(bk.listing,{$pull:{blockedRanges:{bookingId:bk._id}}});
        else await L.findByIdAndUpdate(bk.listing,{available:true});
      }
    }
    AL.create({building:req.staff.building,staffName:req.staff.name,action:status==='active'?'check_in':status==='checkout'?'check_out':'status_change',apt:bk.apt,guestName:bk.name,bookingId:bk._id,details:`${prev} → ${status}`}).catch(e=>console.warn('audit log:',e.message));
    if (status !== prev && status === 'active')   WA.sendCheckIn(bk.phone, bk.name, req.staff.building, bk.apt).catch(e=>console.warn('WA checkin:',e.message));
    if (status !== prev && status === 'checkout') WA.sendCheckOut(bk.phone, bk.name, bk.apt).catch(e=>console.warn('WA checkout:',e.message));
    // إرجاع المبلغ المدفوع عند الإلغاء لإتاحة إنشاء سند استرداد
    const paidOnCancel = (status === 'cancelled' && status !== prev) ? (bk.paidAmount || 0) : 0;
    res.json({ success: true, paidAmount: paidOnCancel, name: bk.name, apt: bk.apt });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Get Single Booking ───────────────────────────────
router.get('/api/bookings/:id', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const getFilter = req.staff.propertyId
      ? {_id:req.params.id, propertyId:req.staff.propertyId}
      : {_id:req.params.id, building:req.staff.building, propertyId:null};
    const bk = await B.findOne(getFilter).lean();
    if(!bk) return res.status(404).json({error:'الحجز غير موجود'});
    res.json(bk);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Edit Booking ─────────────────────────────────────
router.put('/api/bookings/:id/edit', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const AL = require('../models/ActivityLog');
    const editFilter = req.staff.propertyId
      ? { _id: req.params.id, propertyId: req.staff.propertyId }
      : { _id: req.params.id, building: req.staff.building, propertyId: null };
    const bk = await B.findOne(editFilter);
    if(!bk) return res.status(404).json({error:'الحجز غير موجود'});
    const { name, phone, checkIn, checkOut, months, pricePerUnit, totalPrice, paidAmount, paymentMethod, bookingSource, idType, idNumber, status, notes, companions } = req.body;

    let nights = bk.nights, checkout = checkOut || bk.checkOut;
    if(bk.bookingType==='daily' && checkIn && checkOut)
      nights = Math.round((new Date(checkOut)-new Date(checkIn))/86400000);
    else if(bk.bookingType==='annual' && checkIn && months){
      const d = new Date(checkIn); d.setMonth(d.getMonth()+(parseInt(months)||1));
      checkout = d.toISOString().split('T')[0];
      nights = (parseInt(months)||1)*30;
    }

    // Double-booking check when dates change
    if(checkIn || checkOut) {
      const newIn  = checkIn  ? new Date(checkIn)  : bk.checkIn;
      const newOut = checkout ? new Date(checkout) : bk.checkOut;
      const conflict = await B.findOne({
        _id: { $ne: bk._id }, apt: bk.apt, building: bk.building,
        status: { $in: ['awaiting_checkin','active'] },
        checkIn: { $lt: newOut }, checkOut: { $gt: newIn },
      });
      if(conflict) return res.status(400).json({ error: `تعارض مع حجز موجود للضيف "${conflict.name}"` });
    }

    const newTotal = parseFloat(totalPrice) || bk.totalPrice;

    const newPaid = paidAmount !== undefined
      ? Math.min(Math.max(0, parseFloat(paidAmount) || 0), newTotal)
      : (bk.payments?.length
        ? bk.payments.reduce((s, p) => s + (p.amount || 0), 0)
        : bk.paidAmount);

    // If status change requested via edit, enforce transition matrix too
    let safeStatus = bk.status;
    if(status && status !== bk.status) {
      if(!VALID_STATUSES.includes(status))
        return res.status(400).json({error:'حالة غير مدعومة: '+status});
      if(!STATUS_TRANSITIONS[bk.status]?.includes(status))
        return res.status(400).json({error:`لا يمكن الانتقال من "${bk.status}" إلى "${status}"`});
      safeStatus = status;
    }

    await B.findByIdAndUpdate(bk._id, {
      name: name||bk.name, phone: phone||bk.phone,
      checkIn: checkIn?new Date(checkIn):bk.checkIn,
      checkOut: checkout?new Date(checkout):bk.checkOut,
      nights, totalPrice: newTotal,
      paidAmount: newPaid,
      paymentMethod: paymentMethod !== undefined ? paymentMethod : bk.paymentMethod,
      companions: Array.isArray(companions) ? companions.filter(c=>c.name).map(c=>({name:c.name,idType:c.idType||'',idNumber:c.idNumber||''})) : bk.companions,
      idType: idType||bk.idType, idNumber: idNumber||bk.idNumber,
      status: safeStatus, notes: notes !== undefined ? notes : bk.notes,
      ...(bookingSource && VALID_BOOKING_SOURCES.includes(bookingSource) && { source: bookingSource }),
    });
    // تسجيل كل التغييرات المالية بالقيم القديمة والجديدة
    const changes = [];
    if (totalPrice !== undefined && newTotal !== bk.totalPrice) changes.push(`السعر: ${bk.totalPrice}→${newTotal}`);
    if (newPaid !== bk.paidAmount) changes.push(`المدفوع: ${bk.paidAmount}→${newPaid}`);
    if (safeStatus !== bk.status) changes.push(`الحالة: ${bk.status}→${safeStatus}`);
    AL.create({building:req.staff.building,staffName:req.staff.name,action:'booking_edit',apt:bk.apt,guestName:name||bk.name,bookingId:bk._id,details:changes.length?changes.join(' | '):'تعديل بيانات'}).catch(()=>{});
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Booking Payments ────────────────────────────────
router.post('/api/bookings/:id/payments', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const V = require('../models/Voucher');
    const AL = require('../models/ActivityLog');
    const bkFilter = req.staff.propertyId
      ? { _id: req.params.id, propertyId: req.staff.propertyId }
      : { _id: req.params.id, building: req.staff.building, propertyId: null };
    const bk = await B.findOne(bkFilter);
    if (!bk) return res.status(404).json({ error: 'الحجز غير موجود' });

    const { amount, paymentMethod, isDeposit, date, notes } = req.body;
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });

    const payDate = date ? new Date(date) : new Date();
    const pid = req.staff.propertyId || null;

    // إنشاء سند قبض تلقائي
    const vCount = await V.countDocuments({ building: bk.building, type: 'receipt', propertyId: pid });
    const vNumber = 'QBD-' + String(vCount + 1).padStart(4, '0');
    const vDesc = isDeposit
      ? `تأمين — شقة ${bk.apt} — ${bk.name}`
      : `دفعة حجز — شقة ${bk.apt} — ${bk.name}`;
    const voucher = await new V({
      building: bk.building, type: 'receipt', number: vNumber,
      date: payDate, name: bk.name, phone: bk.phone, apt: bk.apt,
      amount: parsedAmount, description: vDesc, notes: notes || '',
      paymentMethod: paymentMethod || 'cash', bookingId: bk._id,
      createdBy: req.staff.name, propertyId: pid,
    }).save();

    // إضافة الدفعة وإعادة حساب المدفوع
    const payment = { date: payDate, amount: parsedAmount, paymentMethod: paymentMethod || 'cash', isDeposit: !!isDeposit, notes: notes || '', createdBy: req.staff.name, voucherId: voucher._id };
    bk.payments.push(payment);
    bk.paidAmount = bk.payments.reduce((s, p) => s + (p.amount || 0), 0);
    await bk.save();

    AL.create({ building: bk.building, staffName: req.staff.name, action: 'payment_add', apt: bk.apt, guestName: bk.name, bookingId: bk._id, details: `دفعة ${parsedAmount} ريال — ${paymentMethod || 'cash'}`, propertyId: pid }).catch(() => {});
    res.json({ success: true, payment: bk.payments[bk.payments.length - 1], voucherNumber: vNumber, paidAmount: bk.paidAmount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/bookings/:id/payments/:pid', reqStaff, async (req, res) => {
  if (req.staff.role !== 'manager')
    return res.status(403).json({ error: 'حذف الدفعات للمديرين فقط' });
  try {
    const B  = require('../models/Booking');
    const V  = require('../models/Voucher');
    const AL = require('../models/ActivityLog');
    const bkFilter = req.staff.propertyId
      ? { _id: req.params.id, propertyId: req.staff.propertyId }
      : { _id: req.params.id, building: req.staff.building, propertyId: null };
    const bk = await B.findOne(bkFilter);
    if (!bk) return res.status(404).json({ error: 'الحجز غير موجود' });

    const pay = bk.payments.id(req.params.pid);
    if (!pay) return res.status(404).json({ error: 'الدفعة غير موجودة' });

    const deletedAmount  = pay.amount;
    const deletedMethod  = pay.paymentMethod || 'cash';
    const deletedIsDeposit = pay.isDeposit;
    const paidBefore     = bk.paidAmount;

    if (pay.voucherId) {
      await V.findByIdAndDelete(pay.voucherId).catch(() => {});
    }
    bk.payments.pull(req.params.pid);
    bk.paidAmount = bk.payments.reduce((s, p) => s + (p.amount || 0), 0);
    await bk.save();

    AL.create({
      building: bk.building,
      staffName: req.staff.name,
      action: 'payment_delete',
      apt: bk.apt,
      guestName: bk.name,
      bookingId: bk._id,
      propertyId: bk.propertyId || null,
      details: `حذف دفعة ${deletedAmount} ريال (${deletedMethod}${deletedIsDeposit ? ' — تأمين' : ''}) | المدفوع: ${paidBefore} → ${bk.paidAmount}`,
    }).catch(() => {});

    res.json({ success: true, paidAmount: bk.paidAmount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Google Drive Upload Helper ─────────────────────────────────

async function driveGetOrCreateFolder(accessToken, name, parentId) {
  // Search for existing folder with this name under parentId
  const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const { files } = await searchRes.json();
  if (files?.length) return files[0].id;

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const folder = await createRes.json();
  return folder.id;
}

async function uploadToDrive(pdfBuffer, filename, building, clientName, pages = []) {
  const clientId     = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
  const rootFolderId = process.env.GDRIVE_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !rootFolderId)
    throw new Error('Google Drive غير مُهيَّأ — أضف GDRIVE_* في Vercel env vars');

  // 1. Get fresh access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const { access_token, error: tokenErr } = await tokenRes.json();
  if (!access_token) throw new Error('Drive token error: ' + tokenErr);

  // 2. Get or create building subfolder → client subfolder
  let targetFolderId = rootFolderId;
  if (building) {
    const buildingFolderId = await driveGetOrCreateFolder(access_token, building, rootFolderId);
    targetFolderId = clientName
      ? await driveGetOrCreateFolder(access_token, clientName, buildingFolderId)
      : buildingFolderId;
  }

  // helper: upload any buffer to Drive
  async function uploadOne(buffer, name, mimeType) {
    const boundary = 'barez_' + Date.now();
    const meta = JSON.stringify({ name, mimeType, parents: [targetFolderId] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const upRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
      { method: 'POST', headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': `multipart/related; boundary="${boundary}"` }, body }
    );
    if (!upRes.ok) {
      const e = await upRes.json().catch(() => ({}));
      throw new Error('فشل رفع Drive: ' + (e.error?.message || upRes.status));
    }
    const file = await upRes.json();
    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    return `https://drive.google.com/file/d/${file.id}/view`;
  }

  // 3. Upload generated PDF
  const pdfUrl = await uploadOne(pdfBuffer, filename, 'application/pdf');

  // 4. Upload original scanned pages
  const baseName = filename.replace(/\.pdf$/i, '');
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const mime = p.mime || 'image/jpeg';
    const ext  = mime.split('/')[1] || 'jpg';
    const imgBuf = Buffer.from(p.data, 'base64');
    await uploadOne(imgBuf, `${baseName}_صورة_${i + 1}.${ext}`, mime);
  }

  return pdfUrl;
}

// ── AI Document Parse (Step 1 of 2) ───────────────────────────
router.post('/api/bookings/:id/documents/parse', reqStaff, async (req, res) => {
  try {
    const { pages } = req.body; // [{data: base64, mime}]
    if (!pages?.length) return res.status(400).json({ error: 'لا توجد صور' });

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'GEMINI_API_KEY غير مُهيَّأ' });

    const B  = require('../models/Booking');
    const bk = await B.findById(req.params.id).lean();
    if (!bk) return res.status(404).json({ error: 'الحجز غير موجود' });

    const fmtD = d => d ? new Date(d).toLocaleDateString('ar-SA', { day:'2-digit', month:'2-digit', year:'numeric' }) : '';
    const bookingContext = `
بيانات الحجز المُدخلة يدوياً (أعطها الأولوية القصوى على ما في الصورة):
- الاسم: ${bk.name || ''}
- الجوال: ${bk.phone || ''}
- رقم الهوية: ${bk.idNumber || ''}
- نوع الهوية: ${bk.idType || ''}
- رقم الشقة: ${bk.apt || ''}
- المبنى: ${bk.building || ''}
- تاريخ الدخول: ${fmtD(bk.checkIn)}
- تاريخ الخروج: ${fmtD(bk.checkOut)}
- عدد الليالي: ${bk.nights || ''}
- الإجمالي: ${bk.totalPrice || ''}
- المدفوع: ${bk.paidAmount || ''}
- المتبقي: ${(bk.totalPrice || 0) - (bk.paidAmount || 0)}
`;

    const prompt = `أنت خبير قانوني ومطور ويب متخصص في استخراج البيانات (OCR) وهيكلتها من وثائق الإيجار وعقود الوحدات السكنية في المملكة العربية السعودية.

مهمتك هي تحليل الصورة المرفقة (سواء كانت صورة لعقد إيجار يومي أو محضر جرد واستلام محتويات شقة) واستخراج كافة النصوص والبيانات، ثم دمجها مع البيانات التالية من النظام، وإعادة صياغتها لتوليد مستند HTML/CSS متكامل، نظيف، وجاهز للطباعة على ورقة قياس A4.

${bookingContext}

### 1. الكشف عن نوع المستند:
* إذا كان "عقد إيجار": ولّد HTML بناءً على هيكل عقد الإيجار اليومي الموحد المكون من 4 أقسام (بيانات الأطراف، تفاصيل الإقامة، حصر المحتويات مع قيم التعويض، والشروط الـ 16).
* إذا كان "محضر جرد واستلام": ولّد HTML بناءً على هيكل محضر جرد (جدول الجرد المكون من 12 بنداً، إقرار التعهد، التواقيع).

### 2. معايير الخط والشكل:
* الخط: Noto Naskh Arabic أو Simplified Arabic مع fallback sans-serif.
* جميع النصوص بوزن عريض (font-weight: 700 !important).
* أبعاد ثابتة A4: width: 210mm، height: 297mm، هوامش تمنع التمدد لصفحة ثانية.
* الحقول القابلة للتعديل: input type="text" class="print-input" بحدود تختفي عند الطباعة ويبقى خط منقط أسفلها فقط.

### 3. أسعار التعويض لحصر المحتويات:
مكيفات: 1200 | شاشة تلفزيون: 800 | ثلاجة: 1300 | فرن: 800 | غلاية مياه: 50 | ميكروويف: 220 | كواية ملابس: 90 | طاولة: 150 | مرآة: 150 | سرير+مرتبة: 600 | دولاب ملابس: 400 | فرش السرير: 80 | ستائر: 100 | سجاد: 100 | سخان مياه: 250

### 4. الشروط الـ 16 (لعقد الإيجار):
اكتبها كاملة بحجم 12.5px على الأقل، مع البند 16 بالنص التالي:
"16. في حالة تأخر الطرف الثاني عن إخلاء الشقة وتسليمها في الموعد المحدد، يلتزم بدفع غرامة تأخير قدرها 300 ريال سعودي عن كل يوم تأخير."

### 5. قواعد دمج البيانات:
* الأولوية للبيانات المُدخلة يدوياً من النظام (المذكورة أعلاه).
* اسحب من الصورة فقط ما لا يوجد في بيانات النظام.
* سطر تفاصيل الإقامة يجب أن يكون في سطر واحد مستمر: "انه بتاريخ [التاريخ] واتفق الطرفان على أن يؤجر الطرف الأول للطرف الثاني الوحدة رقم ([الرقم]) بإيجار يومي بقيمة ([السعر]) ريال."

### 6. التواقيع:
صندوقا التواقيع منقسمان بالتساوي: "توقيع المستأجر" على اليمين، "توقيع المسؤول" على اليسار.

### CSS للطباعة يجب تضمينه:
\`\`\`css
@media print {
  .print-input { border: none !important; border-bottom: 1px dotted #000 !important; background: transparent !important; }
  .no-print { display: none !important; }
}
\`\`\`

أعد كود HTML/CSS متكامل فقط داخل \`\`\`html ... \`\`\` بدون أي نص خارج الكود.`;

    const parts = [
      ...pages.map(p => {
        // Strip data URL prefix if present (Gemini needs raw base64 only)
        const raw = p.data.includes(',') ? p.data.split(',')[1] : p.data;
        return { inline_data: { mime_type: p.mime || 'image/jpeg', data: raw } };
      }),
      { text: prompt },
    ];

    const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    let raw = null, lastErrMsg = 'فشل الاتصال بالذكاء الاصطناعي';

    for (const model of MODELS) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }] }) }
      );
      if (resp.ok) {
        const data = await resp.json();
        raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        break;
      }
      try {
        const err = await resp.json();
        lastErrMsg = err.error?.message?.slice(0, 120) || lastErrMsg;
        if (resp.status === 429 || resp.status === 503) continue;
        break;
      } catch { break; }
    }

    if (!raw) return res.status(502).json({ error: lastErrMsg });

    // Extract HTML from markdown code block if wrapped
    const htmlMatch = raw.match(/```html\s*([\s\S]*?)```/) || raw.match(/```\s*([\s\S]*?)```/);
    const html = htmlMatch ? htmlMatch[1].trim() : raw.trim();
    if (!html) return res.status(422).json({ error: 'لم يتمكن الذكاء الاصطناعي من قراءة الوثيقة' });

    res.json({ success: true, html });
  } catch (e) {
    console.error('[doc-parse]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── AI Document Generate — Premium PDF (Step 2 of 2) ──────────
// ── Shared PDF builder (used by both /contract and /documents/generate) ──
async function buildContractPDF(bk, type, confirmed, pages) {
  const PDFDocument = require('pdfkit');
  const path        = require('path');
  const fs2         = require('fs');

  const FONT_REG  = path.join(__dirname, '../fonts/Cairo-Regular.ttf');
  const FONT_BOLD = path.join(__dirname, '../fonts/Cairo-Bold.ttf');
  const LOGO_PATH = path.join(__dirname, '../public/images/logo-dark.png');
  const hasFont   = fs2.existsSync(FONT_REG) && fs2.existsSync(FONT_BOLD);
  const hasLogo   = fs2.existsSync(LOGO_PATH);

    // ── Colors ───────────────────────────────────────────────────
    const NAVY   = '#111827';
    const ACCENT = '#1d4ed8';
    const GOLD   = '#d97706';
    const LGRAY  = '#f9fafb';
    const BORDER = '#e5e7eb';
    const TEXT1  = '#111827';
    const TEXT2  = '#4b5563';

    // ── Fixed Terms (hardcoded — page 2) ────────────────────────
    const TERMS = [
      'بأمر من وزارة الداخلية يمنع رهن أي مستندات رسمية.',
      'على المستأجر مراعاة السلوك والآداب الإسلامية خلال فترة تواجده في الشقة، وعدم السماح بإقامة أية أشخاص آخرين من غير المرافقين له مع الالتزام بالهدوء وعدم إزعاج الآخرين حرصاً على الراحة العامة.',
      'يجب المحافظة على الآداب وعدم صدور أصوات تزعج الوحدات المجاورة له.',
      'في حالة تسجيل شكوى من الوحدات المجاورة أو إساءة استخدام المنافع المشتركة (المصاعد / الممرات) يحق للمؤجر فسخ العقد فوراً.',
      'يتعهد المستأجر بتسهيل مهام المؤجر (الطرف الأول) في استلام الوحدة السكنية وإخلائها، ويفوض الطرف الأول برمي أي موجودات بها عند انتهاء العقد أو فسخه من الطرف الأول، ويتنازل عن المطالبة بها أو التعويض عنها دون أدنى مسؤولية على الطرف الأول.',
      'في حالة الخروج خارج الشقة يلزمه التأكد من غلق الغاز ويلزمه الترشيد في استخدام المياه.',
      'يتم دفع تأمين 200 ريال عند حدوث أي تلف بمحتويات الشقة ويكون الطرف الثاني ملزم بتعويض الطرف الأول بقيمة التلفيات التي يحددها الطرف الأول.',
      'يمنع دخول الطيور والحيوانات منعاً باتاً.',
      'لا يحق للطرف الثاني تحويل العقد (تأجير الشقة) إلى شخص آخر.',
      'في حالة رغبة المستأجر تجديد المدة عليه إشعار الاستقبال بذلك قبل انتهاء المدة بيوم كامل.',
      'المستأجر ملزم بتسليم الشقة فوراً عند انتهاء مدة العقد وتسليم المفتاح في الحالة التي كانت عليها دون أي تلفيات، وإذا لم يلتزم بالتسليم في موعده فالطرف الأول الحق في فتح الشقة فوراً وله الحق في إزالة أي متعلقات شخصية للمستأجر والتخلص منها فوراً دون أي حق للمستأجر في استردادها.',
      'يعتبر العقد لاغياً في حالة الإخلال بأحد الشروط المذكورة أو مخالفة الأنظمة وللمسؤول الحق في إلغاء العقد فوراً دون إبداء الأسباب.',
      'إدراج أسماء وأرقام هويات النزلاء المصاحبين للطرف الثاني بخط يده أسفل التوقيع مع صلة القرابة.',
      'يكون السعر المدرج في العقد لمدة العقد فقط ويحق للطرف الأول تغيير السعر في حالة رغب الطرف الثاني التمديد.',
      'لا يحق للمستأجر المطالبة باسترداد أي مبالغ مالية مدفوعة حال المغادرة قبل نهاية المدة المتعاقد عليها.',
      'اتفق الطرفان إذا خرج الطرف الثاني قبل نهاية المدة فإنه يتم احتساب الأجرة اليومية مبلغ (......ريال).',
    ];

    // ── Build Single-Page PDF ────────────────────────────────────
    const W = 595.28, H = 841.89;
    const MX = 32;

    const pdfBuf = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, info: {
        Title: type === 'contract' ? 'عقد إيجار' : 'محضر استلام المحتويات',
        Author: 'BAREZ', Creator: 'BAREZ Smart Archive',
      }});

      if (hasFont) {
        doc.registerFont('Cairo',      FONT_REG);
        doc.registerFont('Cairo-Bold', FONT_BOLD);
      }
      const F  = hasFont ? 'Cairo'      : 'Helvetica';
      const FB = hasFont ? 'Cairo-Bold' : 'Helvetica-Bold';

      const chunks = [];
      doc.on('data', ch => chunks.push(ch));
      doc.on('end',  ()  => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const bkId   = bk._id.toString().slice(-8).toUpperCase();
      const nowStr = new Date().toLocaleDateString('ar-SA', { year:'numeric', month:'2-digit', day:'2-digit' });
      const fmt    = (n) => n != null ? Number(n).toLocaleString('ar-SA') + ' ر.س' : '—';
      const fmtD   = (d) => d || '—';
      const idLbl  = { national_id:'هوية وطنية', passport:'جواز سفر', iqama:'إقامة', family_card:'وثيقة عائلة' };
      const TW     = W - 2 * MX;

      // ── Section bar ───────────────────────────────────────────
      const sectionBar = (title, y, h = 20) => {
        doc.rect(MX, y, TW, h).fill(ACCENT);
        doc.font(FB).fontSize(9.5).fillColor('#ffffff')
           .text(title, MX + 6, y + (h - 10) / 2, { width: TW - 12, align: 'right', lineBreak: false });
        return y + h;
      };

      // ── Two-column table ──────────────────────────────────────
      const twoColTable = (rows, startY, rowH = 21, labelW = 130) => {
        rows.forEach(([label, value], i) => {
          const ry = startY + i * rowH;
          doc.rect(MX, ry, TW, rowH).fill(i % 2 === 0 ? LGRAY : '#ffffff');
          doc.moveTo(MX, ry + rowH).lineTo(MX + TW, ry + rowH).strokeColor(BORDER).lineWidth(0.4).stroke();
          doc.font(FB).fontSize(8.5).fillColor(TEXT1)
             .text(label, MX + TW - labelW + 4, ry + 5, { width: labelW - 8, align: 'right', lineBreak: false });
          doc.moveTo(MX + TW - labelW, ry + 3).lineTo(MX + TW - labelW, ry + rowH - 3)
             .strokeColor('#d1d5db').lineWidth(0.4).stroke();
          doc.font(F).fontSize(8.5).fillColor(TEXT2)
             .text(String(value ?? '—'), MX + 5, ry + 5, { width: TW - labelW - 8, align: 'right', lineBreak: false });
        });
        doc.rect(MX, startY, TW, rows.length * rowH).strokeColor(BORDER).lineWidth(0.4).stroke();
        return startY + rows.length * rowH;
      };

      // ════════════════════════════════════════════════════════
      // HEADER
      // ════════════════════════════════════════════════════════
      doc.rect(0, 0, W, 62).fill(NAVY);
      if (hasLogo) try { doc.image(LOGO_PATH, MX, 8, { height: 44, fit: [44, 44] }); } catch {}

      const docTitle = type === 'contract' ? 'عقد إيجار وحدة سكنية' : 'محضر استلام المحتويات';
      doc.font(FB).fontSize(15).fillColor('#ffffff').text(docTitle, 0, 14, { width: W, align: 'center' });
      doc.font(F).fontSize(8).fillColor('#93c5fd').text('BAREZ | المنارة للخدمات الفندقية', 0, 34, { width: W, align: 'center' });
      doc.font(F).fontSize(7).fillColor('#d1d5db')
         .text('رقم المرجع: BK-' + bkId, W - MX - 115, 12, { width: 115, align: 'right' })
         .text('التاريخ: ' + nowStr,     W - MX - 115, 24, { width: 115, align: 'right' });

      let y = 68;

      // ════════════════════════════════════════════════════════
      // TWO-COLUMN LAYOUT: Guest (right) + Unit (left)
      // ════════════════════════════════════════════════════════
      const COL_W = (TW - 10) / 2;
      const COL_R = MX + COL_W + 10; // left column x
      const COL_L = MX;              // right column x (Arabic RTL: right = اليمين)

      // Section bars
      doc.rect(COL_R, y, COL_W, 20).fill(ACCENT);
      doc.font(FB).fontSize(9).fillColor('#fff').text('بيانات المستأجر', COL_R + 4, y + 5, { width: COL_W - 8, align: 'right', lineBreak: false });
      doc.rect(COL_L, y, COL_W, 20).fill(ACCENT);
      doc.font(FB).fontSize(9).fillColor('#fff').text('بيانات الوحدة',  COL_L + 4, y + 5, { width: COL_W - 8, align: 'right', lineBreak: false });
      y += 20;

      const guestRows = [
        ['الاسم الكامل', confirmed.name],
        ['نوع الهوية',   idLbl[confirmed.idType] || confirmed.idType || '—'],
        ['رقم الهوية',   confirmed.idNumber],
        ['رقم الجوال',   confirmed.phone],
      ];
      const unitRows = [
        ['رقم الوحدة',    confirmed.apt],
        ['المجمع السكني', confirmed.building],
        ['تاريخ الدخول',  fmtD(confirmed.checkIn)],
        ['تاريخ الخروج',  fmtD(confirmed.checkOut)],
      ];
      const COL_ROW_H = 21;
      const LBL_W    = 90;

      // Draw guest rows (right column)
      guestRows.forEach(([label, value], i) => {
        const ry = y + i * COL_ROW_H;
        doc.rect(COL_R, ry, COL_W, COL_ROW_H).fill(i % 2 === 0 ? LGRAY : '#ffffff');
        doc.moveTo(COL_R, ry + COL_ROW_H).lineTo(COL_R + COL_W, ry + COL_ROW_H).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.font(FB).fontSize(8).fillColor(TEXT1).text(label, COL_R + COL_W - LBL_W + 3, ry + 5, { width: LBL_W - 6, align: 'right', lineBreak: false });
        doc.moveTo(COL_R + COL_W - LBL_W, ry + 2).lineTo(COL_R + COL_W - LBL_W, ry + COL_ROW_H - 2).strokeColor('#d1d5db').lineWidth(0.4).stroke();
        doc.font(F).fontSize(8).fillColor(TEXT2).text(String(value ?? '—'), COL_R + 3, ry + 5, { width: COL_W - LBL_W - 6, align: 'right', lineBreak: false });
      });
      doc.rect(COL_R, y, COL_W, guestRows.length * COL_ROW_H).strokeColor(BORDER).lineWidth(0.4).stroke();

      // Draw unit rows (left column)
      unitRows.forEach(([label, value], i) => {
        const ry = y + i * COL_ROW_H;
        doc.rect(COL_L, ry, COL_W, COL_ROW_H).fill(i % 2 === 0 ? LGRAY : '#ffffff');
        doc.moveTo(COL_L, ry + COL_ROW_H).lineTo(COL_L + COL_W, ry + COL_ROW_H).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.font(FB).fontSize(8).fillColor(TEXT1).text(label, COL_L + COL_W - LBL_W + 3, ry + 5, { width: LBL_W - 6, align: 'right', lineBreak: false });
        doc.moveTo(COL_L + COL_W - LBL_W, ry + 2).lineTo(COL_L + COL_W - LBL_W, ry + COL_ROW_H - 2).strokeColor('#d1d5db').lineWidth(0.4).stroke();
        doc.font(F).fontSize(8).fillColor(TEXT2).text(String(value ?? '—'), COL_L + 3, ry + 5, { width: COL_W - LBL_W - 6, align: 'right', lineBreak: false });
      });
      doc.rect(COL_L, y, COL_W, unitRows.length * COL_ROW_H).strokeColor(BORDER).lineWidth(0.4).stroke();

      y += Math.max(guestRows.length, unitRows.length) * COL_ROW_H + 8;

      // ════════════════════════════════════════════════════════
      // FINANCIALS — full width, 3 cols (total | paid | remaining)
      // ════════════════════════════════════════════════════════
      y = sectionBar('البيانات المالية', y, 20);
      const F3W = TW / 3;
      const finCols = [
        ['المبلغ المتبقي', fmt(confirmed.remaining)],
        ['المبلغ المدفوع', fmt(confirmed.paidAmount)],
        ['إجمالي الإيجار', fmt(confirmed.totalAmount)],
      ];
      finCols.forEach(([label, value], i) => {
        const fx = MX + i * F3W;
        doc.rect(fx, y, F3W, 38).fill(i === 2 ? '#eff6ff' : i === 0 ? '#fef9f0' : LGRAY);
        if (i < 2) doc.moveTo(fx + F3W, y + 4).lineTo(fx + F3W, y + 34).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.font(FB).fontSize(8).fillColor(TEXT2).text(label, fx + 2, y + 6, { width: F3W - 4, align: 'center', lineBreak: false });
        doc.font(FB).fontSize(13).fillColor(i === 2 ? ACCENT : i === 0 ? GOLD : TEXT1)
           .text(value, fx + 2, y + 18, { width: F3W - 4, align: 'center', lineBreak: false });
      });
      doc.rect(MX, y, TW, 38).strokeColor(BORDER).lineWidth(0.4).stroke();
      y += 46;

      // ── Duration pill ─────────────────────────────────────────
      if (confirmed.nights != null) {
        const pill = `مدة الإقامة: ${confirmed.nights} ليلة`;
        doc.rect(MX, y, TW, 18).fill('#f0f9ff');
        doc.rect(MX, y, TW, 18).strokeColor('#bfdbfe').lineWidth(0.4).stroke();
        doc.font(F).fontSize(8.5).fillColor(ACCENT).text(pill, MX + 4, y + 4, { width: TW - 8, align: 'center', lineBreak: false });
        y += 24;
      }

      // ── Furniture (inventory) ─────────────────────────────────
      if (type === 'inventory' && confirmed.furniture?.length) {
        y = sectionBar('قائمة المحتويات المستلمة', y, 20);
        y = twoColTable(confirmed.furniture.map((item, i) => [`البند ${i + 1}`, item]), y, 19, 80) + 6;
      }

      // ── Notes ─────────────────────────────────────────────────
      if (confirmed.notes) {
        y = sectionBar('ملاحظات', y, 20);
        const nh = Math.max(30, doc.heightOfString(confirmed.notes, { width: TW - 16 }) + 12);
        doc.rect(MX, y, TW, nh).fill(LGRAY);
        doc.rect(MX, y, TW, nh).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.font(F).fontSize(8.5).fillColor(TEXT2).text(confirmed.notes, MX + 8, y + 8, { width: TW - 16, align: 'right' });
        y += nh + 6;
      }

      // ── Terms notice strip ────────────────────────────────────
      doc.rect(MX, y, TW, 16).fill('#fef3c7');
      doc.rect(MX, y, TW, 16).strokeColor('#fcd34d').lineWidth(0.4).stroke();
      doc.font(F).fontSize(7.5).fillColor('#92400e')
         .text('بالتوقيع أدناه يُقرّ المستأجر بقراءة وقبول جميع الشروط والأحكام المرفقة مع هذا العقد.',
               MX + 6, y + 3, { width: TW - 12, align: 'right', lineBreak: false });
      y += 22;

      // ════════════════════════════════════════════════════════
      // SIGNATURES
      // ════════════════════════════════════════════════════════
      const SIG_W  = (TW - 16) / 2;
      const SIG_H  = 82;
      const sigY   = H - 26 - SIG_H - 10; // pin to bottom above footer

      // Right: manager
      doc.rect(MX + SIG_W + 16, sigY, SIG_W, SIG_H).fill(LGRAY);
      doc.rect(MX + SIG_W + 16, sigY, SIG_W, SIG_H).strokeColor('#d1d5db').lineWidth(0.6).stroke();
      doc.font(FB).fontSize(9.5).fillColor(TEXT1)
         .text('توقيع المسؤول', MX + SIG_W + 16, sigY + 7, { width: SIG_W, align: 'center' });
      doc.moveTo(MX + SIG_W + 16, sigY + 22).lineTo(MX + SIG_W + 16 + SIG_W, sigY + 22).strokeColor(BORDER).lineWidth(0.4).stroke();
      doc.font(F).fontSize(8).fillColor(TEXT2)
         .text('الاسم:  _______________________', MX + SIG_W + 16, sigY + 28, { width: SIG_W, align: 'center' })
         .text('التاريخ:  _____________________', MX + SIG_W + 16, sigY + 44, { width: SIG_W, align: 'center' })
         .text('التوقيع:  ____________________', MX + SIG_W + 16, sigY + 60, { width: SIG_W, align: 'center' });

      // Left: tenant
      doc.rect(MX, sigY, SIG_W, SIG_H).fill(LGRAY);
      doc.rect(MX, sigY, SIG_W, SIG_H).strokeColor('#d1d5db').lineWidth(0.6).stroke();
      doc.font(FB).fontSize(9.5).fillColor(TEXT1)
         .text('توقيع المستأجر', MX, sigY + 7, { width: SIG_W, align: 'center' });
      doc.moveTo(MX, sigY + 22).lineTo(MX + SIG_W, sigY + 22).strokeColor(BORDER).lineWidth(0.4).stroke();
      doc.font(F).fontSize(8).fillColor(TEXT2)
         .text('الاسم:  _______________________', MX, sigY + 28, { width: SIG_W, align: 'center' })
         .text('التاريخ:  _____________________', MX, sigY + 44, { width: SIG_W, align: 'center' })
         .text('التوقيع:  ____________________', MX, sigY + 60, { width: SIG_W, align: 'center' });

      // ── Footer ───────────────────────────────────────────────
      doc.rect(0, H - 26, W, 26).fill(NAVY);
      doc.font(F).fontSize(7).fillColor('#9ca3af')
         .text(`BAREZ Smart Archive  •  BK-${bkId}  •  ${new Date().toISOString().slice(0,10)}`,
               0, H - 16, { width: W, align: 'center' });

      // ════════════════════════════════════════════════════════
      // EXTRA PAGES — Original Scans (if uploaded)
      // ════════════════════════════════════════════════════════
      if (pages?.length) {
        pages.forEach((p, i) => {
          doc.addPage({ size: 'A4', margin: 0 });
          doc.rect(0, 0, W, 30).fill(NAVY);
          doc.font(FB).fontSize(10).fillColor('#fff')
             .text(`المستند الأصلي الموقّع — صفحة ${i + 1}`, 0, 9, { width: W, align: 'center' });
          try {
            const buf = Buffer.from(p.data, 'base64');
            doc.image(buf, 0, 30, { width: W, height: H - 30, fit: [W, H - 30], align: 'center', valign: 'center' });
          } catch {
            doc.font(F).fontSize(10).fillColor('#dc2626').text(`فشل تحميل الصفحة ${i + 1}`, 20, 50);
          }
        });
      }

      doc.end();
    });
  // end of Promise — return pdfBuf
  return pdfBuf;
}

// ── Helper: upload PDF + save to booking ─────────────────────────
async function uploadAndSave(bk, type, confirmed, pdfBuf, pages, staffName) {
  const B       = require('../models/Booking');
  const bkId    = bk._id.toString().slice(-8).toUpperCase();
  const arLabel = type === 'contract' ? 'عقد_موثق' : 'استلام_محتويات';
  const filename = `${bk.name||'عميل'}_BK${bkId}_${arLabel}.pdf`;

  const pdfUrl = await uploadToDrive(pdfBuf, filename, bk.building||null, bk.name||null, pages||[]);

  const field = type === 'contract' ? 'contractDoc' : 'inventoryDoc';
  await B.findByIdAndUpdate(bk._id, {
    [field]: { url: pdfUrl, urls:[pdfUrl], filename, uploadedBy: staffName,
               uploadedAt: new Date(), pages: (pages?.length||0)+1, ocrText:'', parsedData: confirmed },
  });
  return { url: pdfUrl, filename };
}

// ── Quick Contract — from booking data directly (no AI) ──────────
router.post('/api/bookings/:id/contract', reqStaff, async (req, res) => {
  try {
    const B  = require('../models/Booking');
    const bk = await B.findById(req.params.id);
    if (!bk) return res.status(404).json({ error: 'الحجز غير موجود' });

    const type    = req.body.type || 'contract';
    const nights  = bk.nights ?? (bk.checkIn && bk.checkOut
      ? Math.round((new Date(bk.checkOut) - new Date(bk.checkIn)) / 86400000) : null);

    const confirmed = {
      name:        bk.name,
      idType:      bk.idType,
      idNumber:    bk.idNumber,
      phone:       bk.phone,
      apt:         bk.apt,
      building:    bk.building,
      checkIn:     bk.checkIn  ? new Date(bk.checkIn).toLocaleDateString('ar-SA')  : null,
      checkOut:    bk.checkOut ? new Date(bk.checkOut).toLocaleDateString('ar-SA') : null,
      nights,
      totalAmount: bk.totalPrice,
      paidAmount:  bk.paidAmount,
      remaining:   (bk.totalPrice ?? 0) - (bk.paidAmount ?? 0),
      notes:       bk.notes || null,
    };

    const pdfBuf = await buildContractPDF(bk, type, confirmed, []);
    const { url, filename } = await uploadAndSave(bk, type, confirmed, pdfBuf, [], req.staff.name);
    res.json({ success: true, url, filename });
  } catch (e) {
    console.error('[contract]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Photo Upload — images → PDF → Drive (no AI) ──────────────────
router.post('/api/bookings/:id/upload-photos', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const bk = await B.findById(req.params.id);
    if (!bk) return res.status(404).json({ error: 'الحجز غير موجود' });

    const { type = 'contract', pages = [] } = req.body;
    if (!pages.length) return res.status(400).json({ error: 'لم تُرسَل صور' });

    const PDFDocument = require('pdfkit');
    const pdfBuf = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      for (const page of pages) {
        try {
          const imgBuf = Buffer.from(page.data, 'base64');
          doc.addPage({ size: 'A4', margin: 0 });
          doc.image(imgBuf, 0, 0, { fit: [595.28, 841.89], align: 'center', valign: 'center' });
        } catch { /* skip corrupt page */ }
      }
      doc.end();
    });

    const field    = type === 'contract' ? 'contractDoc' : 'inventoryDoc';
    const prefix   = type === 'contract' ? 'عقد' : 'استلام';
    const filename = `${prefix}_${bk.name||'نزيل'}_${Date.now()}.pdf`;
    const pdfUrl   = await uploadToDrive(pdfBuf, filename, bk.building || null, bk.name || null);

    await B.findByIdAndUpdate(bk._id, {
      [field]: {
        url: pdfUrl, urls: [pdfUrl], filename,
        uploadedBy: req.staff.name, uploadedAt: new Date(),
        pages: pages.length, ocrText: '', parsedData: {},
      },
    });

    res.json({ success: true, url: pdfUrl, filename });
  } catch (e) {
    console.error('[upload-photos]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── AI Generate — with AI-confirmed data + scanned pages ─────────
router.post('/api/bookings/:id/documents/generate', reqStaff, async (req, res) => {
  try {
    const { type, confirmed, pages } = req.body;
    if (!['contract','inventory'].includes(type)) return res.status(400).json({ error: 'نوع غير صحيح' });
    if (!confirmed) return res.status(400).json({ error: 'البيانات المؤكدة غير موجودة' });

    const B  = require('../models/Booking');
    const bk = await B.findById(req.params.id);
    if (!bk) return res.status(404).json({ error: 'الحجز غير موجود' });

    const pdfBuf = await buildContractPDF(bk, type, confirmed, pages || []);
    const { url, filename } = await uploadAndSave(bk, type, confirmed, pdfBuf, pages, req.staff.name);
    res.json({ success: true, url, filename, pages: (pages?.length||0)+1 });
  } catch (e) {
    console.error('[doc-generate]', e);
    res.status(500).json({ error: e.message || 'خطأ في توليد PDF' });
  }
});

// ── API: Booking Documents (contract / inventory) ─────────
router.post('/api/bookings/:id/documents', reqStaff, async (req, res) => {
  try {
    const B      = require('../models/Booking');
    const crypto = require('crypto');
    const PDFDoc = require('pdfkit');
    const path_  = require('path');

    const { type, pages, confirmed } = req.body;
    // pages: [{data:base64,mime}], confirmed: parsed+reviewed data from frontend
    if (!['contract','inventory'].includes(type)) return res.status(400).json({ error:'نوع غير صحيح' });
    if (!pages?.length) return res.status(400).json({ error:'لم يتم اختيار صور' });
    if (pages.length > 10) return res.status(400).json({ error:'الحد الأقصى 10 صفحات' });

    const bk = await B.findById(req.params.id);
    if (!bk) return res.status(404).json({ error:'الحجز غير موجود' });

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret)
      return res.status(500).json({ error:'Cloudinary غير مُهيَّأ' });

    const isContract = type === 'contract';
    const d = confirmed || {};
    const bkId     = bk._id.toString().slice(-8).toUpperCase();
    const guestName = d.name || bk.name || 'عميل';
    const safeName  = guestName.replace(/\s+/g,'_').replace(/[^\w]/g,'').slice(0,15) || 'client';

    // ── Build premium PDF ──────────────────────────────────────────────────
    const fontDir   = path_.join(__dirname,'..','fonts');
    const fontReg   = path_.join(fontDir,'Cairo-Regular.ttf');
    const fontBold  = path_.join(fontDir,'Cairo-Bold.ttf');

    // Colors
    const DARK   = '#0f1923';
    const BLUE   = '#1a3d8f';
    const GOLD   = '#c9a84c';
    const LIGHT  = '#f8fafc';
    const BORDER = '#dde3ef';
    const GRAY   = '#64748b';

    const pdfBuf = await new Promise((resolve, reject) => {
      const doc = new PDFDoc({ size:'A4', margin:0, autoFirstPage:true });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Register fonts
      doc.registerFont('Cairo',      fontReg);
      doc.registerFont('Cairo-Bold', fontBold);

      const W = 595, H = 842; // A4 points
      const ML = 40, MR = 40, MT = 0;

      // ── HEADER BANNER ──────────────────────────────────────────────────
      doc.rect(0, 0, W, 90).fill(DARK);
      // Gold accent line
      doc.rect(0, 90, W, 3).fill(GOLD);
      // Logo text
      doc.font('Cairo-Bold').fontSize(22).fillColor('#ffffff')
         .text('BAREZ', ML, 22, { align:'left', width: W-ML-ML });
      doc.font('Cairo').fontSize(11).fillColor(GOLD)
         .text('بارز للشقق الفندقية المفروشة', ML, 50, { align:'left', width: W-ML-ML });
      // Contract title (right side)
      const title = isContract ? 'عقد إيجار رقمي' : 'محضر استلام المحتويات';
      doc.font('Cairo-Bold').fontSize(16).fillColor('#ffffff')
         .text(title, ML, 28, { align:'right', width: W-ML-ML });
      const contractNo = 'رقم: BK-' + bkId;
      doc.font('Cairo').fontSize(9).fillColor(GOLD)
         .text(contractNo, ML, 52, { align:'right', width: W-ML-ML });

      // ── DATE BAR ───────────────────────────────────────────────────────
      const today = new Date().toLocaleDateString('ar-SA',{year:'numeric',month:'long',day:'numeric'});
      doc.rect(0, 93, W, 26).fill('#1e2d45');
      doc.font('Cairo').fontSize(9).fillColor('#94a3b8')
         .text('تاريخ الإصدار: ' + today + '  •  الموظف المسؤول: ' + (req.staff?.name||'—'),
               ML, 101, { align:'center', width: W-ML-ML });

      let y = 130;

      // Helper: draw a section card
      const sectionCard = (titleAr, rows, startY) => {
        const rowH = 26, headerH = 30;
        const totalH = headerH + rows.length * rowH + 8;
        // Card background
        doc.rect(ML, startY, W-ML-MR, totalH).fill(LIGHT).stroke(BORDER);
        // Section header
        doc.rect(ML, startY, W-ML-MR, headerH).fill(BLUE);
        doc.font('Cairo-Bold').fontSize(11).fillColor('#ffffff')
           .text(titleAr, ML+10, startY+9, { align:'right', width: W-ML-MR-20 });
        // Rows
        rows.forEach((row, i) => {
          const ry = startY + headerH + i*rowH;
          if (i%2===0) doc.rect(ML, ry, W-ML-MR, rowH).fill('#f0f4f8');
          else         doc.rect(ML, ry, W-ML-MR, rowH).fill(LIGHT);
          // Label (right)
          doc.font('Cairo-Bold').fontSize(9).fillColor(GRAY)
             .text(row[0], W/2+10, ry+8, { align:'right', width: W/2-MR-10 });
          // Value (left)
          doc.font('Cairo').fontSize(10).fillColor(DARK)
             .text(row[1]||'—', ML+8, ry+8, { align:'right', width: W/2-ML });
        });
        doc.rect(ML, startY, W-ML-MR, totalH).stroke(BORDER);
        return startY + totalH + 12;
      };

      // Format date helper
      const fmtD = s => {
        if (!s) return '—';
        try { return new Date(s).toLocaleDateString('ar-SA',{year:'numeric',month:'long',day:'numeric'}); }
        catch { return s; }
      };
      const fmtN = n => n ? Number(n).toLocaleString('ar-SA') + ' ر.س' : '—';

      // ── SECTION 1: Guest Info ──────────────────────────────────────────
      const idTypeMap = { national_id:'هوية وطنية', passport:'جواز سفر', iqama:'إقامة', family_card:'بطاقة عائلية' };
      y = sectionCard('بيانات المستأجر / النزيل', [
        ['الاسم الكامل',       d.name    || bk.name  || '—'],
        ['نوع الهوية',         idTypeMap[d.idType] || d.idType || '—'],
        ['رقم الهوية',         d.idNumber || bk.idNumber || '—'],
        ['رقم الجوال',         d.phone    || bk.phone    || '—'],
      ], y);

      // ── SECTION 2: Unit Info ───────────────────────────────────────────
      y = sectionCard('بيانات الوحدة السكنية', [
        ['المجمع / المبنى',   d.building || bk.building || '—'],
        ['رقم الوحدة',         d.apt      || bk.apt      || '—'],
        ['تاريخ الدخول',       fmtD(d.checkIn  || bk.checkIn)],
        ['تاريخ الخروج',       fmtD(d.checkOut || bk.checkOut)],
        ['عدد الليالي',        (d.nights || bk.nights || '—').toString()],
      ], y);

      // ── SECTION 3: Financial Info (contract only) ───────────────────────
      if (isContract) {
        const total     = Number(d.totalAmount || d.totalPrice || bk.totalPrice  || 0);
        const paid      = Number(d.paidAmount  || bk.paidAmount  || 0);
        const remaining = Number(d.remaining   || (total - paid) || 0);
        y = sectionCard('التفاصيل المالية', [
          ['إجمالي الإيجار',   fmtN(total)],
          ['المبلغ المدفوع',    fmtN(paid)],
          ['المتبقي',           fmtN(remaining)],
          ['طريقة الدفع',       bk.paymentMethod || '—'],
        ], y);
      }

      // ── SECTION 4: Furniture (inventory only) ──────────────────────────
      if (!isContract && d.furniture?.length) {
        const items = d.furniture.slice(0,20);
        y = sectionCard('قائمة المحتويات المستلمة', items.map((it,i) => [
          (i+1).toString(), it
        ]), y);
      }

      // ── NOTES ─────────────────────────────────────────────────────────
      if (d.notes || bk.notes) {
        const noteText = d.notes || bk.notes;
        doc.rect(ML, y, W-ML-MR, 50).fill('#fffbeb').stroke('#fbbf24');
        doc.font('Cairo-Bold').fontSize(9).fillColor('#92400e')
           .text('ملاحظات:', W-MR-10, y+8, { align:'right', width:W-ML-MR-20 });
        doc.font('Cairo').fontSize(9).fillColor('#78350f')
           .text(noteText, ML+8, y+22, { align:'right', width:W-ML-MR-16 });
        y += 60;
      }

      // ── SIGNATURE BLOCK ────────────────────────────────────────────────
      if (y > H - 140) { doc.addPage({ size:'A4', margin:0 }); y = 40; }
      doc.rect(ML, y, W-ML-MR, 90).fill(LIGHT).stroke(BORDER);
      // Two columns
      const colW = (W-ML-MR)/2 - 10;
      // Right: tenant signature
      doc.rect(W/2+5, y, colW, 90).fill('#f8faff').stroke(BORDER);
      doc.font('Cairo-Bold').fontSize(9).fillColor(BLUE)
         .text('توقيع المستأجر', W/2+15, y+10, { align:'center', width:colW-20 });
      doc.moveTo(W/2+20, y+65).lineTo(W-MR-10, y+65).stroke(BORDER);
      // Left: staff signature
      doc.rect(ML, y, colW, 90).fill('#f8fff8').stroke(BORDER);
      doc.font('Cairo-Bold').fontSize(9).fillColor('#065f46')
         .text('توقيع الموظف المسؤول', ML+10, y+10, { align:'center', width:colW-20 });
      doc.moveTo(ML+10, y+65).lineTo(ML+colW-10, y+65).stroke(BORDER);
      y += 100;

      // ── FOOTER ────────────────────────────────────────────────────────
      doc.rect(0, H-35, W, 35).fill(DARK);
      doc.font('Cairo').fontSize(8).fillColor('#94a3b8')
         .text('هذا العقد صادر إلكترونياً من منصة BAREZ — جميع الحقوق محفوظة',
               ML, H-22, { align:'center', width:W-ML-ML });

      // ── ORIGINAL DOCUMENT PAGES ────────────────────────────────────────
      pages.forEach((p) => {
        doc.addPage({ size:'A4', margin:0 });
        // Subtle header strip
        doc.rect(0,0,W,24).fill('#1e2d45');
        doc.font('Cairo').fontSize(8).fillColor('#94a3b8')
           .text('الوثيقة الأصلية الموقعة — للحجز BK-'+bkId, ML, 7, { align:'center', width:W-ML-ML });
        try {
          const buf = Buffer.from(p.data,'base64');
          doc.image(buf, 0, 24, { fit:[W, H-24], align:'center', valign:'top' });
        } catch { doc.font('Cairo').fontSize(10).fillColor('#dc2626').text('فشل تحميل الصفحة', 20, 50); }
      });

      doc.end();
    });

    // ── Upload to Cloudinary ──────────────────────────────────────────────
    const suffix   = isContract ? 'ctr' : 'inv';
    const folder   = 'barez/contracts';
    const pubId    = 'BK'+bkId+'_'+safeName+'_'+suffix+'.pdf';
    const ts       = Math.floor(Date.now()/1000);
    const toSign   = 'folder='+folder+'&overwrite=true&public_id='+pubId+'&timestamp='+ts+apiSecret;
    const sig      = crypto.createHash('sha1').update(toSign).digest('hex');

    const upRes = await fetch('https://api.cloudinary.com/v1_1/'+cloudName+'/raw/upload', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ file:'data:application/pdf;base64,'+pdfBuf.toString('base64'),
        api_key:apiKey, timestamp:ts, signature:sig, folder, public_id:pubId, overwrite:true }),
    });
    if (!upRes.ok) {
      const e = await upRes.json().catch(()=>({}));
      return res.status(500).json({ error:'فشل رفع PDF: '+(e.error?.message||upRes.status) });
    }

    const upData   = await upRes.json();
    const pdfUrl   = upData.secure_url;
    const arSuffix = isContract ? 'عقد_موثق' : 'استلام_محتويات';
    const filename = guestName+'_'+bkId+'_'+arSuffix+'.pdf';
    const field    = isContract ? 'contractDoc' : 'inventoryDoc';

    await B.findByIdAndUpdate(req.params.id, { [field]: {
      url:pdfUrl, urls:[pdfUrl], filename,
      uploadedBy: req.staff.name, uploadedAt: new Date(),
      pages: pages.length + 1, // +1 for summary page
      ocrText: d.rawOcr || '',
      parsedData: {
        name:d.name, idType:d.idType, idNumber:d.idNumber,
        phone:d.phone, apt:d.apt, building:d.building,
        checkIn:d.checkIn, checkOut:d.checkOut, nights:Number(d.nights)||0,
        totalAmount:Number(d.totalAmount||d.totalPrice||0),
        paidAmount:Number(d.paidAmount||0), remaining:Number(d.remaining||0),
        notes:d.notes, furniture:d.furniture||[],
      },
    }});

    res.json({ success:true, url:pdfUrl, filename, pages:pages.length });
  } catch(e) {
    console.error('[docs-generate]',e);
    res.status(500).json({ error: e.message||'خطأ في توليد PDF' });
  }
});
router.get('/api/bookings/:id/documents', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const b = await B.findById(req.params.id).select('contractDoc inventoryDoc name apt').lean();
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    res.json({ contractDoc: b.contractDoc || null, inventoryDoc: b.inventoryDoc || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Archive: all bookings with documents ──────────────────────────────────────
router.get('/api/documents', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const { q, apt, type, from, to } = req.query;
    const filter = { propertyId: req.staff.propertyId || null };
    if (req.staff.building) filter.building = req.staff.building;
    // has at least one doc
    if (type === 'contract') {
      filter['contractDoc.url'] = { $exists: true, $ne: '' };
    } else if (type === 'inventory') {
      filter['inventoryDoc.url'] = { $exists: true, $ne: '' };
    } else {
      filter.$or = [{ 'contractDoc.url': { $exists: true, $ne: '' } }, { 'inventoryDoc.url': { $exists: true, $ne: '' } }];
    }
    if (q) { const re = new RegExp(q, 'i'); filter.$and = [{ $or: [{ name: re }, { phone: re }] }]; }
    if (apt) filter.apt = apt;
    if (from || to) {
      filter['contractDoc.uploadedAt'] = {};
      if (from) filter['contractDoc.uploadedAt'].$gte = new Date(from);
      if (to)   filter['contractDoc.uploadedAt'].$lte = new Date(to + 'T23:59:59');
    }
    const bks = await B.find(filter)
      .select('_id name phone apt checkIn checkOut contractDoc inventoryDoc')
      .sort({ 'contractDoc.uploadedAt': -1 })
      .limit(200).lean();
    res.json(bks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/bookings/docs-by-phone', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const { phone } = req.query;
    if (!phone) return res.json([]);
    const bks = await B.find({
      phone,
      $or: [{ 'contractDoc.url': { $exists: true, $ne: '' } }, { 'inventoryDoc.url': { $exists: true, $ne: '' } }],
    }).select('_id name apt checkIn contractDoc inventoryDoc').sort({ createdAt: -1 }).lean();
    res.json(bks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: New Manual Booking ───────────────────────────────
router.post('/api/bookings/new', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const AL = require('../models/ActivityLog');
    const { apt, name, phone, bookingType, checkIn, checkOut, months, pricePerUnit, totalPrice, paidAmount, paymentMethod, bookingSource, idType, idNumber, status, notes, companions } = req.body;
    if(!apt||!name||!phone||!bookingType||!checkIn||!totalPrice)
      return res.status(400).json({error:'جميع الحقول المطلوبة غير مكتملة'});

    // التحقق من صحة البيانات
    const checkInDate = new Date(checkIn);
    if(isNaN(checkInDate)) return res.status(400).json({error:'تاريخ الدخول غير صحيح'});
    if(checkOut && new Date(checkOut) <= checkInDate) return res.status(400).json({error:'تاريخ الخروج يجب أن يكون بعد تاريخ الدخول'});
    const price = parseFloat(totalPrice);
    if(isNaN(price) || price <= 0) return res.status(400).json({error:'السعر يجب أن يكون أكبر من صفر'});
    const paid = parseFloat(paidAmount) || 0;
    if(paid < 0 || paid > price) return res.status(400).json({error:'المبلغ المدفوع غير صحيح'});

    // منع الحجز إذا الشقة في صيانة
    const HK = require('../models/HousekeepingTask');
    const hkCheck = await HK.findOne({ apt, ...(req.staff.propertyId ? {propertyId:req.staff.propertyId} : {building:req.staff.building, propertyId:null}) }).lean();
    if(hkCheck?.status === 'maintenance')
      return res.status(400).json({error:'لا يمكن الحجز — الشقة '+apt+' في وضع الصيانة'});

    let nights = 0, checkout = checkOut;
    if(bookingType==='daily' && checkIn && checkOut){
      nights = Math.round((new Date(checkOut)-new Date(checkIn))/86400000);
    } else if(bookingType==='annual' && checkIn && months){
      const d = new Date(checkIn); d.setMonth(d.getMonth()+(parseInt(months)||1));
      checkout = d.toISOString().split('T')[0];
      nights = (parseInt(months)||1)*30;
    }

    // منع تعارض الحجوزات (double-booking)
    if(checkIn && checkout) {
      const aptFilter = req.staff.propertyId
        ? { apt, propertyId: req.staff.propertyId }
        : { apt, building: req.staff.building, propertyId: null };
      const conflict = await B.findOne({
        ...aptFilter,
        status: { $in: ['awaiting_checkin','active'] },
        checkIn:  { $lt: new Date(checkout) },
        checkOut: { $gt: new Date(checkIn) },
      }).lean();
      if(conflict) {
        const ci = conflict.checkIn?.toLocaleDateString('ar-SA') || '';
        const co = conflict.checkOut?.toLocaleDateString('ar-SA') || '';
        return res.status(400).json({ error: `الشقة ${apt} محجوزة بالفعل من ${ci} إلى ${co}` });
      }
    }

    const bk = await new B({
      building: req.staff.building,
      apt, name, phone, bookingType,
      checkIn: new Date(checkIn),
      checkOut: checkout ? new Date(checkout) : undefined,
      nights,
      pricePerNight: bookingType==='daily' ? pricePerUnit : undefined,
      pricePerMonth: bookingType==='annual' ? pricePerUnit : undefined,
      totalPrice: parseFloat(totalPrice)||0,
      paidAmount: parseFloat(paidAmount)||0,
      paymentMethod: paymentMethod||'',
      idType: idType||'', idNumber: idNumber||'',
      companions: Array.isArray(companions) ? companions.filter(c=>c.name).map(c=>({name:c.name,idType:c.idType||'',idNumber:c.idNumber||''})) : [],
      status: status||'awaiting_checkin',
      notes: notes||'',
      source: bookingSource || 'manual',
      propertyId: req.staff.propertyId || null,
    }).save();

    // إنشاء سند قبض + دفعة تلقائية إذا كان هناك مبلغ مدفوع
    let voucherNumber = null;
    if (paid > 0) {
      const V = require('../models/Voucher');
      const pid = req.staff.propertyId || null;
      const vCount = await V.countDocuments({ building: req.staff.building, type: 'receipt', propertyId: pid });
      voucherNumber = 'QBD-' + String(vCount + 1).padStart(4, '0');
      const voucher = await new V({
        building: req.staff.building, type: 'receipt', number: voucherNumber,
        date: new Date(), name, phone, apt, amount: paid,
        description: `دفعة حجز — شقة ${apt} — ${name}`,
        paymentMethod: paymentMethod || 'cash',
        bookingId: bk._id, createdBy: req.staff.name, propertyId: pid,
      }).save();
      bk.payments.push({
        date: new Date(), amount: paid,
        paymentMethod: paymentMethod || 'cash',
        isDeposit: false, notes: '', createdBy: req.staff.name,
        voucherId: voucher._id,
      });
      await bk.save();
    }

    AL.create({building:req.staff.building,staffName:req.staff.name,action:'booking_add',apt,guestName:name,bookingId:bk._id,details:'حجز يدوي',propertyId:req.staff.propertyId||null}).catch(e=>console.warn('audit log:',e.message));
    const Guest = require('../models/Guest');
    Guest.findOneAndUpdate(
      { phone, propertyId: req.staff.propertyId || null },
      { $set: { name, idType: idType||'', idNumber: idNumber||'', building: req.staff.building, lastSeen: new Date(), email: req.body.email||'' }, $inc: { totalBookings: 1 }, $setOnInsert: { category: 'regular' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).catch(e => console.warn('guest upsert:', e.message));
    WA.sendBookingConfirmed(phone, name, apt, req.staff.building, bk.checkIn, bk.checkOut, bk.totalPrice).catch(e=>console.warn('WA confirm:',e.message));
    res.json({success:true, id:bk._id, voucherNumber});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Customers ────────────────────────────────────────
router.get('/api/customers', reqStaff, async (req,res) => {
  try {
    const Guest = require('../models/Guest');
    const { q='', page=1, limit=100, category='', idNumber='', phone:phoneQ='' } = req.query;
    const skip = (parseInt(page)-1) * parseInt(limit);
    const filter = { propertyId: req.staff.propertyId || null };
    if (category && ['regular','vip','blocked'].includes(category)) filter.category = category;

    const makeRe = s => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/[أإآا]/g,'[أإآا]').replace(/[يى]/g,'[يى]').replace(/[هة]/g,'[هة]'), 'i');

    if (idNumber.trim()) {
      filter.idNumber = makeRe(idNumber.trim().slice(0,50));
    } else if (phoneQ.trim()) {
      filter.phone = makeRe(phoneQ.trim().slice(0,30));
    } else {
      const qClean = q.trim().slice(0, 100);
      if (qClean) {
        const re = makeRe(qClean);
        filter.$or = [{ name: re }, { phone: re }, { idNumber: re }];
      }
    }
    const [guests, total] = await Promise.all([
      Guest.find(filter).sort({ name: 1 }).skip(skip).limit(parseInt(limit)).lean(),
      Guest.countDocuments(filter)
    ]);
    res.json({ data: guests, total, page: parseInt(page), limit: parseInt(limit) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Room Info ────────────────────────────────────────
router.get('/api/room-info', reqStaff, async (req,res) => {
  try {
    const RI = require('../models/RoomInfo');
    const riFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };
    const rows = await RI.find(riFilter).lean();
    const map = {};
    rows.forEach(r => { map[r.apt] = { roomType: r.roomType, beds: r.beds, building: r.building, pricePerNight: r.pricePerNight || 0, pricePerMonth: r.pricePerMonth || 0 }; });

    // Merge listing prices (authoritative source for internal users)
    if (!req.staff.propertyId) {
      const L = require('../models/Listing');
      const listings = await L.find({ building: req.staff.building }).select('apt price_daily price_annual').lean();
      listings.forEach(l => {
        if (!l.apt) return;
        if (!map[l.apt]) map[l.apt] = { roomType: '', beds: '', building: req.staff.building, pricePerNight: 0, pricePerMonth: 0 };
        if (l.price_daily)  map[l.apt].pricePerNight = l.price_daily;
        if (l.price_annual) map[l.apt].pricePerMonth = l.price_annual;
      });
    }
    res.json(map);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.put('/api/room-info/:apt', reqStaff, async (req,res) => {
  try {
    const perms = req.staff.permissions||[];
    if(!perms.includes('edit_room_info')) return res.status(403).json({error:'ليس لديك صلاحية'});
    const RI = require('../models/RoomInfo');
    const { roomType='', beds='', pricePerNight=0, pricePerMonth=0 } = req.body;
    const pid = req.staff.propertyId || null;
    const riKey = req.staff.propertyId
      ? { propertyId: pid, apt: req.params.apt }
      : { building: req.staff.building, propertyId: null, apt: req.params.apt };
    await RI.findOneAndUpdate(
      riKey,
      { roomType, beds, pricePerNight: parseFloat(pricePerNight)||0, pricePerMonth: parseFloat(pricePerMonth)||0, building: req.staff.building, propertyId: pid },
      { upsert: true }
    );
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Housekeeping ─────────────────────────────────────
router.get('/api/housekeeping', reqStaff, async (req,res) => {
  try {
    const HK = require('../models/HousekeepingTask');
    const bld = req.staff.building;
    const hkFilter = req.staff.propertyId ? { propertyId: req.staff.propertyId, building: bld } : { building: bld, propertyId: null };
    const tasks = await HK.find(hkFilter).lean();
    const map={}; tasks.forEach(t=>map[t.apt]=t);
    const result=[];
    (BLDGS[bld]?.floors||[]).forEach(f=>f.r.forEach(apt=>result.push(map[apt]||{apt,building:bld,status:'clean',notes:''})));
    res.json(result);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.put('/api/housekeeping/:apt', reqStaff, async (req,res) => {
  try {
    const HK = require('../models/HousekeepingTask');
    const AL = require('../models/ActivityLog');
    const {status,notes}=req.body;
    const pid = req.staff.propertyId || null;
    await HK.findOneAndUpdate({building:req.staff.building,apt:req.params.apt,propertyId:pid},{status,notes:notes||'',updatedBy:req.staff.name,building:req.staff.building,apt:req.params.apt,propertyId:pid},{upsert:true,new:true});
    AL.create({building:req.staff.building,staffName:req.staff.name,action:'housekeeping',apt:req.params.apt,details:status,propertyId:pid}).catch(()=>{});
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Financial Log per Booking ────────────────────────
router.get('/api/bookings/:id/financial-log', reqStaff, async (req, res) => {
  try {
    const AL = require('../models/ActivityLog');
    const entries = await AL.find({
      bookingId: req.params.id,
      action: { $in: ['payment_add', 'payment_delete', 'booking_edit'] },
    }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(entries);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Activity Log ─────────────────────────────────────
router.get('/api/activity', reqStaff, async (req,res) => {
  try {
    const AL = require('../models/ActivityLog');
    const alFilter = req.staff.propertyId ? { propertyId: req.staff.propertyId } : { building: req.staff.building, propertyId: null };
    const { from, to, action, ref, user } = req.query;
    if(from || to){
      alFilter.createdAt = {};
      if(from) alFilter.createdAt.$gte = new Date(from);
      if(to){ const d=new Date(to); d.setHours(23,59,59,999); alFilter.createdAt.$lte=d; }
    }
    if(action) alFilter.action = action;
    if(ref) alFilter.$or = [{apt:new RegExp(ref,'i')},{guestName:new RegExp(ref,'i')}];
    if(user) alFilter.staffName = new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
    const logs = await AL.find(alFilter).sort({createdAt:-1}).limit(200).lean();
    res.json(logs);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Vouchers ─────────────────────────────────────────
router.get('/api/vouchers', reqStaff, async (req,res) => {
  if (!req.staff.permissions?.includes('vouchers')) return res.status(403).json({ error: 'ليس لديك صلاحية السندات' });
  try {
    const V = require('../models/Voucher');
    const filter = req.staff.propertyId ? { propertyId: req.staff.propertyId } : { building: req.staff.building, propertyId: null };
    if(req.query.type) filter.type = req.query.type;
    const { from, to, method, num, bknum } = req.query;
    if(from || to){
      filter.date = {};
      if(from) filter.date.$gte = new Date(from);
      if(to){ const d=new Date(to); d.setHours(23,59,59,999); filter.date.$lte=d; }
    }
    if(method) filter.paymentMethod = method;
    if(num) filter.number = new RegExp(num.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
    if(bknum) filter.description = new RegExp(bknum.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
    const list = await V.find(filter).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.post('/api/vouchers', reqStaff, async (req,res) => {
  if (!req.staff.permissions?.includes('vouchers')) return res.status(403).json({ error: 'ليس لديك صلاحية السندات' });
  try {
    const V = require('../models/Voucher');
    const { type, date, name, phone, apt, amount, description, notes, checkNumber, bankName, dueDate, bookingId, paymentMethod } = req.body;
    if(!type||!amount) return res.status(400).json({error:'نوع الوثيقة والمبلغ مطلوبان'});
    const VALID_TYPES = ['receipt','invoice','disbursement','check','tax'];
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'نوع سند غير صالح' });
    // سندات الصرف للمديرين فقط — يمنع الموظف من تسجيل مصروفات وهمية
    if (['disbursement','check'].includes(type) && req.staff.role !== 'manager')
      return res.status(403).json({ error: 'سندات الصرف والشيكات للمديرين فقط' });
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
    const pid = req.staff.propertyId || null;
    const count = await V.countDocuments({ building: req.staff.building, type, propertyId: pid });
    const prefixes = { receipt:'QBD', invoice:'INV', disbursement:'SRF', check:'KMB', tax:'ZRB' };
    const number = prefixes[type] + '-' + String(count+1).padStart(4,'0');
    const v = await new V({ building:req.staff.building, type, number, date:date?new Date(date):new Date(), name, phone, apt, amount:parsedAmount, description, notes, checkNumber, bankName, dueDate:dueDate?new Date(dueDate):undefined, bookingId:bookingId||undefined, createdBy:req.staff.name, paymentMethod:paymentMethod||'', propertyId:pid }).save();
    res.json({ success:true, id:v._id, number:v.number });
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.delete('/api/vouchers/:id', reqStaff, async (req,res) => {
  if (!req.staff.permissions?.includes('vouchers')) return res.status(403).json({ error: 'ليس لديك صلاحية السندات' });
  try {
    const V = require('../models/Voucher');
    const B = require('../models/Booking');
    const vFilter = req.staff.propertyId
      ? { _id: req.params.id, propertyId: req.staff.propertyId }
      : { _id: req.params.id, building: req.staff.building, propertyId: null };
    const voucher = await V.findOne(vFilter);
    if (!voucher) return res.status(404).json({ error: 'السند غير موجود' });

    // حذف أي سند مالي للمديرين فقط — يمنع حذف القبض لإخفاء السرقة
    if (req.staff.role !== 'manager')
      return res.status(403).json({ error: 'حذف السندات للمديرين فقط' });

    // إذا كان سند قبض مرتبط بحجز → حذف الدفعة من الحجز أيضاً لمنع التناقض
    if (voucher.type === 'receipt' && voucher.bookingId) {
      const bkFilter = req.staff.propertyId
        ? { _id: voucher.bookingId, propertyId: req.staff.propertyId }
        : { _id: voucher.bookingId, building: req.staff.building, propertyId: null };
      const bk = await B.findOne(bkFilter);
      if (bk) {
        const payEntry = bk.payments.find(p => p.voucherId?.toString() === voucher._id.toString());
        if (payEntry) {
          bk.payments.pull(payEntry._id);
          bk.paidAmount = bk.payments.reduce((s, p) => s + (p.amount || 0), 0);
          await bk.save();
        }
      }
    }

    await V.findByIdAndDelete(voucher._id);
    res.json({ success:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Reports ───────────────────────────────────────────────
router.get('/api/reports', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const bld = req.staff.building;
    const { bldgs } = await getBldgConfig(req.staff);
    const total = totalAptsFromConfig(bldgs, bld);

    const now = new Date();
    const today = new Date(now); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    const selYear  = parseInt(req.query.year)  || now.getFullYear();
    const selMonth = req.query.month !== undefined ? parseInt(req.query.month) : now.getMonth();
    const monthStart   = new Date(selYear, selMonth, 1);
    const nextMonth    = new Date(selYear, selMonth + 1, 1);
    const daysInMonth  = new Date(selYear, selMonth + 1, 0).getDate();

    const rptFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: bld, propertyId: null };
    const [allMonth, allActive, allDebtsRaw] = await Promise.all([
      B.find({ ...rptFilter, checkIn: { $gte: monthStart, $lt: nextMonth }, status: { $ne: 'cancelled' } }).lean(),
      B.find({ ...rptFilter, status: 'active' }).lean(),
      B.find({ ...rptFilter, status: { $nin: ['cancelled','checkout'] }, totalPrice: { $gt: 0 } }).lean(),
    ]);

    const todayBk = allMonth.filter(b => { const d = new Date(b.checkIn); return d >= today && d < tomorrow; });
    const departuresToday = allActive.filter(b => { const d = b.checkOut ? new Date(b.checkOut) : null; return d && d >= today && d < tomorrow; });

    const monthRevenue   = allMonth.reduce((s,b) => s + (b.totalPrice||0), 0);
    const monthPaid      = allMonth.reduce((s,b) => s + (b.paidAmount||0), 0);
    const monthRemaining = monthRevenue - monthPaid;
    const daily  = allMonth.filter(b => b.bookingType === 'daily');
    const annual = allMonth.filter(b => b.bookingType === 'annual');

    const dayRevMap = {};
    allMonth.forEach(b => {
      const day = new Date(b.checkIn).getDate();
      dayRevMap[day] = (dayRevMap[day] || 0) + (b.totalPrice || 0);
    });
    const dailyChart = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(selYear, selMonth, i + 1);
      return { label: d.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }), revenue: dayRevMap[i + 1] || 0 };
    });

    const debts = allDebtsRaw
      .filter(b => (b.paidAmount||0) < (b.totalPrice||0))
      .map(b => ({
        bookingNum: b._id.toString().slice(-5).toUpperCase(),
        name: b.name, phone: b.phone, apt: b.apt,
        totalPrice: b.totalPrice, paidAmount: b.paidAmount||0,
        remaining: (b.totalPrice||0) - (b.paidAmount||0),
        status: b.status,
      }))
      .sort((a,b) => b.remaining - a.remaining);

    res.json({
      selectedMonth: selMonth, selectedYear: selYear,
      today: {
        arrivals: todayBk.length, departures: departuresToday.length,
        occupied: allActive.length,
        occupancyRate: total ? Math.round(allActive.length / total * 100) : 0,
        total, revenue: todayBk.reduce((s,b) => s + (b.totalPrice||0), 0),
      },
      month: {
        bookings: allMonth.length, revenue: monthRevenue, paid: monthPaid, remaining: monthRemaining,
        dailyBookings: daily.length, annualBookings: annual.length,
        dailyRevenue: daily.reduce((s,b) => s + (b.totalPrice||0), 0),
        annualRevenue: annual.reduce((s,b) => s + (b.totalPrice||0), 0),
        avgOccupancy: total ? Math.round(allActive.length / total * 100) : 0,
      },
      chart: dailyChart, debts,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Monthly Report ───────────────────────────────────────
router.get('/api/reports/monthly', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const { year, month, type='detail' } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'السنة والشهر مطلوبان' });
    const y = parseInt(year), m = parseInt(month) - 1;
    const from = new Date(y, m, 1);
    const to   = new Date(y, m + 1, 0, 23, 59, 59, 999);
    const baseFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };
    const filter = { ...baseFilter, status: { $nin: ['cancelled'] },
      $or: [
        { checkIn: { $gte: from, $lte: to } },
        { checkOut: { $gte: from, $lte: to } },
        { checkIn: { $lte: from }, checkOut: { $gte: to } },
      ]
    };
    const bookings = await B.find(filter).sort({ checkIn: 1 }).lean();
    const totalRevenue   = bookings.reduce((s,b) => s+(b.totalPrice||0), 0);
    const totalPaid      = bookings.reduce((s,b) => s+(b.paidAmount||0), 0);
    const totalRemaining = bookings.reduce((s,b) => s+Math.max(0,(b.totalPrice||0)-(b.paidAmount||0)), 0);
    const totalNights    = bookings.reduce((s,b) => s+(b.nights||0), 0);

    if (type === 'total') {
      const { bldgs } = await getBldgConfig(req.staff);
      const bld = req.staff.building;
      const totalApts = totalAptsFromConfig(bldgs, bld);
      const daysInMonth = new Date(y, m+1, 0).getDate();
      const occRate = totalApts > 0 ? Math.round((totalNights / (totalApts * daysInMonth)) * 100) : 0;
      return res.json({ totalBookings: bookings.length, totalRevenue, totalPaid, totalRemaining, totalNights, occupancyRate: occRate });
    }

    if (type === 'summary') {
      const byApt = {};
      bookings.forEach(b => {
        if (!byApt[b.apt]) byApt[b.apt] = { apt:b.apt, count:0, nights:0, revenue:0, paid:0, remaining:0 };
        const r = byApt[b.apt];
        r.count++; r.nights += (b.nights||0); r.revenue += (b.totalPrice||0);
        r.paid += (b.paidAmount||0); r.remaining += Math.max(0,(b.totalPrice||0)-(b.paidAmount||0));
      });
      return res.json({ byApt: Object.values(byApt).sort((a,b)=>a.apt.localeCompare(b.apt,'ar')), totalBookings: bookings.length, totalRevenue, totalPaid, totalRemaining, totalNights });
    }

    // detail
    return res.json({ bookings, totalBookings: bookings.length, totalRevenue, totalPaid, totalRemaining, totalNights });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Occupancy Report ─────────────────────────────────────
router.get('/api/reports/occupancy', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const RI = require('../models/RoomInfo');
    const { from, to, apt='', type='rooms' } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'التاريخ مطلوب' });
    const fromD = new Date(from);
    const toD   = new Date(to); toD.setHours(23,59,59,999);
    const totalDays = Math.max(1, Math.round((toD - fromD) / 86400000) + 1);
    const baseFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };
    const bkFilter = { ...baseFilter, status: { $in: ['active','checkout','awaiting_checkin'] },
      checkIn: { $lt: toD }, checkOut: { $gt: fromD } };
    if (apt) bkFilter.apt = apt;
    const bookings = await B.find(bkFilter).select('apt checkIn checkOut nights').lean();

    if (type === 'rooms') {
      const aptDays = {};
      bookings.forEach(b => {
        const bFrom = new Date(Math.max(fromD, new Date(b.checkIn)));
        const bTo   = new Date(Math.min(toD, new Date(b.checkOut)));
        const days  = Math.max(0, Math.round((bTo - bFrom) / 86400000));
        if (!aptDays[b.apt]) aptDays[b.apt] = 0;
        aptDays[b.apt] += days;
      });
      const rows = Object.entries(aptDays).map(([apt, occupiedDays]) => ({ label: apt, occupiedDays: Math.min(occupiedDays, totalDays) }))
        .sort((a,b) => a.label.localeCompare(b.label,'ar'));
      return res.json({ rows, totalDays });
    }

    // types
    const riFilter = req.staff.propertyId ? { propertyId: req.staff.propertyId } : { building: req.staff.building, propertyId: null };
    const riRows = await RI.find(riFilter).select('apt roomType').lean();
    const aptType = {};
    riRows.forEach(r => { aptType[r.apt] = r.roomType || 'غير محدد'; });
    const typeDays = {};
    bookings.forEach(b => {
      const t = aptType[b.apt] || 'غير محدد';
      const bFrom = new Date(Math.max(fromD, new Date(b.checkIn)));
      const bTo   = new Date(Math.min(toD, new Date(b.checkOut)));
      const days  = Math.max(0, Math.round((bTo - bFrom) / 86400000));
      if (!typeDays[t]) typeDays[t] = 0;
      typeDays[t] += days;
    });
    const rows = Object.entries(typeDays).map(([label, occupiedDays]) => ({ label, occupiedDays }));
    return res.json({ rows, totalDays });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Yearly Revenue Chart ─────────────────────────────────
router.get('/api/reports/yearly', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const now = new Date();
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const baseFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };

    const agg = await B.aggregate([
      { $match: { ...baseFilter, checkIn: { $gte: yearAgo }, status: { $ne: 'cancelled' } } },
      { $group: {
        _id:    { y: { $year: '$checkIn' }, m: { $month: '$checkIn' } },
        revenue:{ $sum: '$totalPrice' },
        count:  { $sum: 1 },
        daily:  { $sum: { $cond: [{ $eq: ['$bookingType','daily']  }, '$totalPrice', 0] } },
        annual: { $sum: { $cond: [{ $eq: ['$bookingType','annual'] }, '$totalPrice', 0] } },
      }},
    ]);
    const revMap = {};
    agg.forEach(x => { revMap[`${x._id.y}-${x._id.m}`] = x; });
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key   = `${start.getFullYear()}-${start.getMonth() + 1}`;
      const m     = revMap[key] || { revenue: 0, count: 0, daily: 0, annual: 0 };
      months.push({
        label:   start.toLocaleDateString('ar-SA', { month: 'short' }) + ' ' + String(start.getFullYear()).slice(2),
        revenue: m.revenue, count: m.count, daily: m.daily, annual: m.annual,
      });
    }
    res.json({ months });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Calendar ──────────────────────────────────────────────
router.get('/api/calendar', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const bld = req.staff.building;
    const selYear  = parseInt(req.query.year)  || new Date().getFullYear();
    const selMonth = req.query.month !== undefined ? parseInt(req.query.month) : new Date().getMonth();
    const monthStart  = new Date(selYear, selMonth, 1);
    const monthEnd    = new Date(selYear, selMonth + 1, 0); monthEnd.setHours(23,59,59,999);
    const daysInMonth = new Date(selYear, selMonth + 1, 0).getDate();

    const calFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: bld, propertyId: null };
    const [bookings, { bldgs }] = await Promise.all([
      B.find({ ...calFilter, status: { $nin: ['cancelled'] }, checkIn: { $lte: monthEnd }, checkOut: { $gte: monthStart } }).lean(),
      getBldgConfig(req.staff),
    ]);

    const bldgData = bldgs[bld];
    const floors = bldgData ? bldgData.floors.map(f => ({ label: f.l, apts: f.r })) : [];
    const allApts = floors.flatMap(f => f.apts);

    // Pre-build apt→bookings map O(n) and parse dates once
    const bkByApt = {};
    bookings.forEach(b => {
      if (!bkByApt[b.apt]) bkByApt[b.apt] = [];
      bkByApt[b.apt].push({
        _id: b._id, name: b.name,
        _cin:     new Date(b.checkIn).setHours(0,0,0,0),
        _cout:    new Date(b.checkOut).setHours(0,0,0,0),
        _cinRaw:  new Date(b.checkIn).getTime(),
        _coutRaw: new Date(b.checkOut).getTime(),
      });
    });

    const aptCalendar = allApts.map(apt => {
      const aptBks = bkByApt[apt] || [];
      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dayDate = new Date(selYear, selMonth, d).getTime();
        const nextDay = dayDate + 86400000;
        const bk = aptBks.find(b => b._cinRaw < nextDay && b._coutRaw > dayDate);
        if (!bk) { days.push({ s: 'v' }); continue; }
        let s = 'o';
        if (bk._cin === dayDate) s = 'i';
        else if (bk._cout === dayDate) s = 'x';
        days.push({ s, id: bk._id.toString().slice(-5).toUpperCase(), n: (bk.name||'').split(' ')[0] });
      }
      return { apt, days };
    });

    res.json({ floors, aptCalendar, daysInMonth, month: selMonth, year: selYear });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Checkout Reminders ────────────────────────────────────
router.post('/api/reminders/checkout', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const tomorrow = new Date(); tomorrow.setHours(0,0,0,0); tomorrow.setDate(tomorrow.getDate()+1);
    const dayAfter  = new Date(tomorrow); dayAfter.setDate(tomorrow.getDate()+1);
    const remFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };
    const bookings  = await B.find({ ...remFilter, status: 'active', checkOut: { $gte: tomorrow, $lt: dayAfter } }).lean();
    let sent = 0;
    for (const bk of bookings) {
      if (bk.phone) { await WA.sendCheckoutReminder(bk.phone, bk.name, bk.apt); sent++; }
    }
    res.json({ success: true, sent, total: bookings.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Manual WhatsApp send ────────────────────────────
router.post('/api/whatsapp/send', reqStaff, async (req, res) => {
  try {
    const { phone, type, message, name, apt, building, checkIn, checkOut, total } = req.body;
    if (!phone) return res.status(400).json({ error: 'رقم الجوال مطلوب' });
    if (type === 'free') {
      if (req.staff.role !== 'manager') return res.status(403).json({ error: 'إرسال الرسائل الحرة للمديرين فقط' });
      if (!message?.trim()) return res.status(400).json({ error: 'الرسالة فارغة' });
      await WA.send(phone, message.trim());
    } else if (type === 'booking_confirmed') {
      await WA.sendBookingConfirmed(phone, name, apt, building || req.staff.building, checkIn, checkOut, total);
    } else if (type === 'check_in') {
      await WA.sendCheckIn(phone, name, building || req.staff.building, apt);
    } else if (type === 'check_out') {
      await WA.sendCheckOut(phone, name, apt);
    } else {
      return res.status(400).json({ error: 'نوع غير صحيح' });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Property Settings ────────────────────────────────────
router.get('/api/property', reqStaff, async (req, res) => {
  try {
    if (!req.staff.propertyId) {
      return res.json({
        name: req.staff.building,
        isInternal: true,
        buildings: Object.entries(BLDGS).map(([name, data]) => ({
          name, floors: data.floors.map(f => ({ label: f.l, rooms: f.r }))
        }))
      });
    }
    const prop = await Property.findById(req.staff.propertyId).lean();
    if (!prop) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    res.json(prop);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/property/buildings', reqStaff, async (req, res) => {
  try {
    if (!req.staff.propertyId) return res.status(403).json({ error: 'هذا الإعداد للمنشآت المسجّلة فقط' });
    if (req.staff.role !== 'manager') return res.status(403).json({ error: 'المديرون فقط يمكنهم تعديل الإعدادات' });
    const { buildings } = req.body;
    if (!Array.isArray(buildings)) return res.status(400).json({ error: 'بيانات غير صحيحة' });
    for (const b of buildings) {
      if (!b.name?.trim()) return res.status(400).json({ error: 'اسم المبنى مطلوب' });
    }
    await Property.findByIdAndUpdate(req.staff.propertyId, { buildings });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Property Settings (VAT, contract terms, expense items, peak periods) ──
router.get('/api/prop-settings', reqStaff, async (req, res) => {
  try {
    const Config = require('../models/Config');
    const key = req.staff.propertyId ? req.staff.propertyId.toString() : 'internal';
    const cfg = await Config.findOne({ key }).lean();
    res.json(cfg || { vatRate: 15, contractTerms: '', expenseItems: [], peakPeriods: [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/prop-settings', reqStaff, async (req, res) => {
  try {
    if (req.staff.role !== 'manager') return res.status(403).json({ error: 'المديرون فقط' });
    const Config = require('../models/Config');
    const key = req.staff.propertyId ? req.staff.propertyId.toString() : 'internal';
    const { vatRate, contractTerms, expenseItems, peakPeriods } = req.body;
    const update = {};
    if (vatRate !== undefined) update.vatRate = Math.max(0, Math.min(100, parseFloat(vatRate) || 0));
    if (contractTerms !== undefined) update.contractTerms = String(contractTerms).slice(0, 2000);
    if (Array.isArray(expenseItems)) update.expenseItems = expenseItems.map(x => String(x).trim()).filter(Boolean).slice(0, 50);
    if (Array.isArray(peakPeriods)) {
      update.peakPeriods = peakPeriods.slice(0, 20).filter(p => p.startDate && p.endDate).map(p => ({
        name: String(p.name || '').slice(0, 100),
        startDate: new Date(p.startDate),
        endDate: new Date(p.endDate),
        multiplier: Math.max(1, Math.min(5, parseFloat(p.multiplier) || 1.5)),
      }));
    }
    await Config.findOneAndUpdate({ key }, { $set: update }, { upsert: true, new: true });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Room Prices (bulk save) ─────────────────────────
router.put('/api/room-prices', reqStaff, async (req, res) => {
  try {
    if (req.staff.role !== 'manager') return res.status(403).json({ error: 'المديرون فقط' });
    const RI = require('../models/RoomInfo');
    const { prices } = req.body;
    if (!Array.isArray(prices) || !prices.length) return res.status(400).json({ error: 'بيانات غير صحيحة' });
    const pid = req.staff.propertyId || null;
    const riOps = prices.map(p => ({
      updateOne: {
        filter: pid
          ? { propertyId: pid, apt: String(p.apt) }
          : { building: String(p.building || req.staff.building), propertyId: null, apt: String(p.apt) },
        update: { $set: {
          pricePerNight: Math.max(0, parseFloat(p.pricePerNight) || 0),
          pricePerMonth: Math.max(0, parseFloat(p.pricePerMonth) || 0),
          building: String(p.building || req.staff.building),
          propertyId: pid,
        }},
        upsert: true,
      }
    }));
    await RI.bulkWrite(riOps);

    // Mirror prices to Listing (internal users only — listings are linked by building+apt)
    if (!pid) {
      const L = require('../models/Listing');
      const listingOps = prices.map(p => ({
        updateOne: {
          filter: { building: String(p.building || req.staff.building), apt: String(p.apt) },
          update: { $set: {
            price_daily:  Math.max(0, parseFloat(p.pricePerNight) || 0),
            price_annual: Math.max(0, parseFloat(p.pricePerMonth) || 0),
          }},
        }
      }));
      if (listingOps.length) await L.bulkWrite(listingOps);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Guests ────────────────────────────────────────────────
// ── API: Analytics ───────────────────────────────────────
router.get('/api/analytics', reqStaff, async (req, res) => {
  if(req.staff.role !== 'manager') return res.status(403).json({error:'غير مصرح'});
  try {
    const B = require('../models/Booking');
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const propFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };

    const start = new Date(year, 0, 1);
    const end   = new Date(year + 1, 0, 1);

    // All bookings for this year (non-cancelled)
    const bookings = await B.find({
      ...propFilter,
      checkIn: { $gte: start, $lt: end },
      status: { $ne: 'cancelled' },
    }).lean();

    // All-time totals (non-cancelled)
    const allTime = await B.aggregate([
      { $match: { ...propFilter, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, revenue: { $sum: '$totalPrice' }, paid: { $sum: '$paidAmount' }, count: { $sum: 1 } } }
    ]);

    // Monthly breakdown
    const monthlyRevenue  = Array(12).fill(0);
    const monthlyBookings = Array(12).fill(0);
    const aptMap = {};

    bookings.forEach(b => {
      const m = new Date(b.checkIn).getMonth();
      monthlyRevenue[m]  += b.totalPrice  || 0;
      monthlyBookings[m] += 1;
      const a = b.apt || 'غير محدد';
      if (!aptMap[a]) aptMap[a] = { apt: a, revenue: 0, bookings: 0 };
      aptMap[a].revenue  += b.totalPrice || 0;
      aptMap[a].bookings += 1;
    });

    const topApts = Object.values(aptMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Booking type breakdown (all-time, non-cancelled)
    const typeAgg = await B.aggregate([
      { $match: { ...propFilter, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$bookingType', count: { $sum: 1 }, revenue: { $sum: '$totalPrice' } } }
    ]);

    const byType = {};
    typeAgg.forEach(t => { byType[t._id] = { count: t.count, revenue: t.revenue }; });

    const at = allTime[0] || { revenue: 0, paid: 0, count: 0 };
    const bestMonth = monthlyRevenue.indexOf(Math.max(...monthlyRevenue));

    res.json({
      year,
      monthlyRevenue:  monthlyRevenue.map(v => Math.round(v)),
      monthlyBookings,
      topApts,
      byType,
      totalRevenue:   Math.round(at.revenue),
      totalPaid:      Math.round(at.paid),
      totalRemaining: Math.round(at.revenue - at.paid),
      totalBookings:  at.count,
      bestMonth,
      yearBookings:   bookings.length,
      yearRevenue:    Math.round(monthlyRevenue.reduce((a,b)=>a+b,0)),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/guests', reqStaff, async (req, res) => {
  try {
    const Guest = require('../models/Guest');
    const { q = '' } = req.query;
    const filter = { propertyId: req.staff.propertyId || null };
    const qClean2 = q.trim().slice(0, 100);
    if (qClean2) {
      const pat2 = qClean2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/[أإآا]/g, '[أإآا]').replace(/[يى]/g, '[يى]').replace(/[هة]/g, '[هة]');
      const re = new RegExp(pat2, 'i');
      filter.$or = [{ name: re }, { phone: re }, { idNumber: re }];
    }
    const guests = await Guest.find(filter).sort({ lastSeen: -1 }).limit(200).lean();
    res.json(guests);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/guests/search', reqStaff, async (req, res) => {
  try {
    const Guest = require('../models/Guest');
    const phone = (req.query.phone || '').trim();
    if (phone.length < 9) return res.json(null);
    const guest = await Guest.findOne({ phone, propertyId: req.staff.propertyId || null }).lean();
    res.json(guest || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Guest full profile by phone ─────────────────────
router.get('/api/guests/by-phone/:phone', reqStaff, async (req, res) => {
  try {
    const Guest = require('../models/Guest');
    const filter = { phone: req.params.phone, propertyId: req.staff.propertyId || null };
    const guest = await Guest.findOne(filter).lean();
    res.json(guest || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Guest lookup by ID number ───────────────────────
router.get('/api/guests/by-idnum/:idnum', reqStaff, async (req, res) => {
  try {
    const Guest = require('../models/Guest');
    const idnum = req.params.idnum.trim();
    if (idnum.length < 5) return res.json(null);
    const guest = await Guest.findOne({ idNumber: idnum, propertyId: req.staff.propertyId || null }).lean();
    res.json(guest || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Guest booking history ───────────────────────────
router.get('/api/guests/:id/history', reqStaff, async (req, res) => {
  try {
    const Guest   = require('../models/Guest');
    const Booking = require('../models/Booking');
    const propId  = req.staff.propertyId || null;
    const guest   = await Guest.findOne({ _id: req.params.id, propertyId: propId }).lean();
    if (!guest) return res.status(404).json({ error: 'الضيف غير موجود' });
    const bkFilter = propId ? { phone: guest.phone, propertyId: propId }
                             : { phone: guest.phone, propertyId: null, building: req.staff.building };
    const bookings = await Booking.find(bkFilter).sort({ checkIn: -1 }).limit(100).lean();
    const totalPaid  = bookings.reduce((s, b) => s + (b.paidAmount  || 0), 0);
    const totalPrice = bookings.reduce((s, b) => s + (b.totalPrice  || 0), 0);
    res.json({ guest, bookings, totalPaid, totalPrice });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Update full guest profile ───────────────────────
router.put('/api/guests/:id', reqStaff, async (req, res) => {
  try {
    const Guest = require('../models/Guest');
    const ALLOWED = ['name','phone','idType','idNumber','idIssuePlace','idExpiry','nationality','email','employer','workPhone','buildingNo','subNo','district','country','postalCode','notes','category'];
    const update = {};
    ALLOWED.forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });
    if (update.idExpiry === '') update.idExpiry = null;
    const filter = { _id: req.params.id, propertyId: req.staff.propertyId || null };
    const guest = await Guest.findOneAndUpdate(filter, update, { new: true });
    if (!guest) return res.status(404).json({ error: 'الضيف غير موجود' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Guest Category ──────────────────────────────────
router.put('/api/guests/:id/category', reqStaff, async (req, res) => {
  try {
    const Guest = require('../models/Guest');
    const { category } = req.body;
    if (!['regular', 'vip', 'blocked'].includes(category)) return res.status(400).json({ error: 'تصنيف غير صحيح' });
    const filter = { _id: req.params.id, propertyId: req.staff.propertyId || null };
    const guest = await Guest.findOneAndUpdate(filter, { category }, { new: true });
    if (!guest) return res.status(404).json({ error: 'الضيف غير موجود' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Register new property ─────────────────────────────────
router.get('/register', (req, res) => {
  if (req.staff) return res.redirect('/staff/dashboard');
  res.render('staff-register', { error: null, success: false });
});

router.post('/register', staffRegisterLimit, async (req, res) => {
  try {
    const S = require('../models/StaffUser');
    const { propertyName, propertyType, city, adminPhone, adminEmail, adminName, username, password, password2 } = req.body;
    if (!propertyName || !adminName || !username || !password || !adminPhone) {
      return res.render('staff-register', { error: 'جميع الحقول المطلوبة يجب تعبئتها', success: false });
    }
    if (password !== password2) {
      return res.render('staff-register', { error: 'كلمتا المرور غير متطابقتين', success: false });
    }
    if (password.length < 8) {
      return res.render('staff-register', { error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل', success: false });
    }
    const phoneClean = adminPhone.replace(/\D/g,'');
    if (phoneClean.length < 9) {
      return res.render('staff-register', { error: 'رقم الجوال غير صحيح', success: false });
    }
    const exists = await S.findOne({ username: username.trim() });
    if (exists) return res.render('staff-register', { error: 'اسم المستخدم مستخدم بالفعل، اختر اسماً آخر', success: false });

    const bldName = propertyName.trim();
    const prop = await new Property({
      name:       bldName,
      type:       propertyType || 'apartment',
      city:       city || '',
      phone:      phoneClean,
      adminEmail: (adminEmail || '').trim().toLowerCase(),
      buildings:  [{ name: bldName, floors: [] }],
    }).save();

    await new S({
      name:       adminName.trim(),
      username:   username.trim(),
      password,
      building:   bldName,
      role:       'manager',
      propertyId: prop._id,
      permissions: DEFAULT_PERMS,
    }).save();

    res.render('staff-register', { error: null, success: true });
  } catch(e) {
    console.error('register error:', e);
    res.render('staff-register', { error: 'حدث خطأ أثناء التسجيل، حاول مرة أخرى', success: false });
  }
});

// ── Building setup (onboarding for new tenants) ───────────
router.get('/setup', reqStaff, async (req, res) => {
  if (!req.staff.propertyId) return res.redirect('/staff/dashboard');
  const prop = await Property.findById(req.staff.propertyId).lean();
  const needsSetup = !prop || !prop.buildings?.length || prop.buildings.every(b => !b.floors?.length);
  if (!needsSetup) return res.redirect('/staff/dashboard');
  res.render('staff-setup', { staff: req.staff, propertyName: prop?.name || '' });
});

router.post('/api/setup-building', reqStaff, async (req, res) => {
  try {
    if (!req.staff.propertyId) return res.status(403).json({ error: 'غير مصرح' });
    const { buildingName, floors } = req.body; // floors: [{label,rooms:[...]}]
    if (!buildingName || !Array.isArray(floors) || !floors.length) {
      return res.status(400).json({ error: 'بيانات غير مكتملة' });
    }
    const cleanFloors = floors.map(f => ({
      label: (f.label||'').trim(),
      rooms: (f.rooms||[]).map(r=>String(r).trim()).filter(Boolean),
    })).filter(f => f.label && f.rooms.length);

    if (!cleanFloors.length) return res.status(400).json({ error: 'أضف طابقاً واحداً على الأقل بغرف' });

    await Property.findByIdAndUpdate(req.staff.propertyId, {
      $set: { buildings: [{ name: buildingName.trim(), floors: cleanFloors }] },
    });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: migrate legacy data to tenant ─────────────────
router.post('/api/admin/migrate-tenant', reqStaff, async (req, res) => {
  if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });
  if (!req.staff.propertyId) return res.status(400).json({ error: 'لا يوجد propertyId في حسابك' });
  try {
    const pid = req.staff.propertyId;
    const { bldgs } = await getBldgConfig(req.staff);
    const buildings = Object.keys(bldgs);
    const B  = require('../models/Booking');
    const HK = require('../models/HousekeepingTask');
    const AL = require('../models/ActivityLog');
    const V  = require('../models/Voucher');
    const S  = require('../models/StaffUser');
    const [b, hk, al, v, s] = await Promise.all([
      B.updateMany( { building:{$in:buildings}, propertyId:null }, { $set:{propertyId:pid} }),
      HK.updateMany({ building:{$in:buildings}, propertyId:null }, { $set:{propertyId:pid} }),
      AL.updateMany({ building:{$in:buildings}, propertyId:null }, { $set:{propertyId:pid} }),
      V.updateMany( { building:{$in:buildings}, propertyId:null }, { $set:{propertyId:pid} }),
      S.updateMany( { building:{$in:buildings}, propertyId:null }, { $set:{propertyId:pid} }),
    ]);
    res.json({ success:true, updated:{ bookings:b.modifiedCount, housekeeping:hk.modifiedCount, activity:al.modifiedCount, vouchers:v.modifiedCount, staff:s.modifiedCount } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: create staff user ──────────────────────────────
router.post('/api/admin/create', adminLimit, async (req,res) => {
  try {
    const adminToken = verifyToken(req.cookies?.fs_auth);
    if(!adminToken || adminToken.role !== 'admin') return res.status(403).json({error:'للمديرين فقط'});
    const S = require('../models/StaffUser');
    const {name,username,password,building,role} = req.body;
    if(!name||!username||!password||!building) return res.status(400).json({error:'جميع الحقول مطلوبة'});
    if(password.length < 8) return res.status(400).json({error:'كلمة المرور يجب أن تكون 8 أحرف على الأقل'});
    if(['receptionist','manager'].indexOf(role||'receptionist') === -1) return res.status(400).json({error:'دور غير صحيح'});
    const u = await new S({name,username,password,building,role:role||'receptionist'}).save();
    res.json({success:true,id:u._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.get('/api/admin/staff', adminLimit, async (req,res) => {
  try {
    const adminToken = verifyToken(req.cookies?.fs_auth);
    if(!adminToken || adminToken.role !== 'admin') return res.status(403).json({error:'للمديرين فقط'});
    const S = require('../models/StaffUser');
    const list = await S.find().select('-password').sort({building:1}).lean();
    res.json(list);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.put('/api/admin/update', adminLimit, async (req,res) => {
  try {
    const adminToken = verifyToken(req.cookies?.fs_auth);
    if(!adminToken || adminToken.role !== 'admin') return res.status(403).json({error:'للمديرين فقط'});
    const S = require('../models/StaffUser');
    const { id, field, value } = req.body;
    if(!id||!field) return res.status(400).json({error:'بيانات ناقصة'});
    if(!['role','active','password','permissions'].includes(field)) return res.status(400).json({error:'حقل غير مسموح'});
    if(field==='password'){
      const u = await S.findById(id);
      if(!u) return res.status(404).json({error:'الموظف غير موجود'});
      u.password = value;
      await u.save(); // triggers pre-save bcrypt hash
    } else {
      await S.findByIdAndUpdate(id, {[field]: value});
    }
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Super Admin: Tenants Management ──────────────────────
function reqSuperAdmin(req, res, next) {
  const t = verifyToken(req.cookies?.fs_auth);
  if (!t || t.role !== 'admin') return res.status(403).json({ error: 'للسوبر أدمن فقط' });
  req.superAdmin = t;
  next();
}

router.get('/superadmin', (req, res) => {
  const t = verifyToken(req.cookies?.fs_auth);
  if (!t || t.role !== 'admin') return res.redirect('/login');
  res.render('staff-superadmin', { admin: t });
});

router.get('/api/superadmin/tenants', reqSuperAdmin, async (req, res) => {
  try {
    const S = require('../models/StaffUser');
    const B = require('../models/Booking');
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const filter = {};
    if (req.query.plan) filter.plan = req.query.plan;
    if (req.query.active === 'false') filter.active = false;
    else if (req.query.active === 'true') filter.active = true;
    const q = (req.query.q || '').trim().slice(0, 80);
    if (q) { const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'); filter.$or=[{name:re},{adminEmail:re},{city:re}]; }

    const [tenants, total] = await Promise.all([
      Property.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean(),
      Property.countDocuments(filter),
    ]);

    const ids = tenants.map(t => t._id);
    const [staffCounts, bookingCounts] = await Promise.all([
      S.aggregate([{ $match: { propertyId: { $in: ids } } }, { $group: { _id: '$propertyId', count: { $sum: 1 } } }]),
      B.aggregate([{ $match: { propertyId: { $in: ids } } }, { $group: { _id: '$propertyId', count: { $sum: 1 } } }]),
    ]);
    const scMap = Object.fromEntries(staffCounts.map(x => [String(x._id), x.count]));
    const bcMap = Object.fromEntries(bookingCounts.map(x => [String(x._id), x.count]));

    res.json({
      data: tenants.map(t => ({ ...t, staffCount: scMap[String(t._id)] || 0, bookingCount: bcMap[String(t._id)] || 0 })),
      total, page, limit,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/superadmin/tenants/:id', reqSuperAdmin, async (req, res) => {
  try {
    const allowed = ['active', 'plan', 'planExpiry'];
    const update = Object.fromEntries(allowed.filter(k => k in req.body).map(k => [k, req.body[k]]));
    if (!Object.keys(update).length) return res.status(400).json({ error: 'لا يوجد تعديل' });
    const tenant = await Property.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!tenant) return res.status(404).json({ error: 'المستأجر غير موجود' });
    res.json({ success: true, tenant });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Nazeel Import helpers ─────────────────────────────────
function parseNazeelDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  // DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  // Excel serial number
  if (/^\d+(\.\d+)?$/.test(s)) {
    const dt = XLSX.SSF.parse_date_code(parseFloat(s));
    if (dt) return new Date(dt.y, dt.m - 1, dt.d);
  }
  return null;
}

function parseNazeelRows(rows) {
  const Booking = require('../models/Booking');
  const results = [];
  for (const r of rows) {
    if (!r || r.length < 7) continue;
    const bookingNum = String(r[0] || '').trim();
    if (!/^\d+$/.test(bookingNum)) continue; // skip header/footer
    const aptRaw   = String(r[2] || '').trim();
    const name     = String(r[3] || '').trim();
    const ciStr    = String(r[4] || '').trim();
    const coStr    = String(r[5] || '').trim();
    const typeRaw  = String(r[6] || '').trim();
    const nights   = parseInt(r[7]) || undefined;
    const ppn      = parseFloat(String(r[8] || '0').replace(/,/g, '')) || 0;
    const total    = parseFloat(String(r[9] || '0').replace(/,/g, '')) || 0;
    const paid     = parseFloat(String(r[11] || '0').replace(/,/g, '')) || 0;

    if (!name) continue;
    const apt     = aptRaw.split(/\s+/)[0] || aptRaw;
    const checkIn  = parseNazeelDate(ciStr);
    const checkOut = parseNazeelDate(coStr);
    if (!checkIn) continue;

    const bkType = (typeRaw.includes('شهري') || typeRaw.includes('سنوي')) ? 'annual' : 'daily';
    results.push({ bookingNum, apt, name, checkIn, checkOut, bkType, nights, pricePerNight: ppn, totalPrice: total, paidAmount: paid });
  }
  return results;
}

// POST /api/import/nazeel — accepts Excel file upload
router.post('/api/import/nazeel', reqStaff, nazeelUpload.single('file'), async (req, res) => {
  if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });

  let rows = [];
  if (req.file) {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', raw: false, cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  } else if (req.body && req.body.text) {
    rows = String(req.body.text).split('\n').map(l => l.split('\t'));
  } else {
    return res.status(400).json({ error: 'أرسل ملف Excel أو نص TSV' });
  }

  const parsed = parseNazeelRows(rows);
  if (!parsed.length) return res.json({ success: true, created: 0, skipped: 0, total: rows.length, errors: [] });

  const Booking  = require('../models/Booking');
  const building = req.staff.building || '';
  const propertyId = req.staff.propertyId || null;

  let created = 0, skipped = 0;
  const errors = [];

  for (const p of parsed) {
    const phone = `nzl-${p.bookingNum}`;
    // skip if already imported (same Nazeel booking number stored in notes)
    const exists = await Booking.findOne({ notes: `نزيل#${p.bookingNum}` }).lean();
    if (exists) { skipped++; continue; }

    try {
      await new Booking({
        building, propertyId,
        apt: p.apt,
        name: p.name,
        phone,
        bookingType: p.bkType,
        checkIn: p.checkIn,
        checkOut: p.checkOut,
        nights: p.nights,
        pricePerNight: p.pricePerNight || undefined,
        totalPrice: p.totalPrice,
        paidAmount: p.paidAmount,
        status: 'checkout',
        source: 'نزيل',
        notes: `نزيل#${p.bookingNum}`,
      }).save();
      created++;
    } catch (e) {
      errors.push(`${p.bookingNum}: ${e.message}`);
      skipped++;
    }
  }

  res.json({ success: true, created, skipped, total: parsed.length, errors: errors.slice(0, 30) });
});

// POST /api/import/nazeel/text — accepts JSON { text: "tsv..." }
router.post('/api/import/nazeel/text', reqStaff, async (req, res) => {
  if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });
  if (!req.body || !req.body.text) return res.status(400).json({ error: 'أرسل البيانات في حقل text' });

  const rows = String(req.body.text).split('\n').map(l => l.split('\t'));
  const parsed = parseNazeelRows(rows);
  if (!parsed.length) return res.json({ success: true, created: 0, skipped: 0, total: rows.length, errors: [] });

  const Booking  = require('../models/Booking');
  const building = req.staff.building || '';
  const propertyId = req.staff.propertyId || null;

  let created = 0, skipped = 0;
  const errors = [];

  for (const p of parsed) {
    const phone = `nzl-${p.bookingNum}`;
    const exists = await Booking.findOne({ notes: `نزيل#${p.bookingNum}` }).lean();
    if (exists) { skipped++; continue; }
    try {
      await new Booking({
        building, propertyId,
        apt: p.apt, name: p.name, phone,
        bookingType: p.bkType,
        checkIn: p.checkIn, checkOut: p.checkOut,
        nights: p.nights,
        pricePerNight: p.pricePerNight || undefined,
        totalPrice: p.totalPrice, paidAmount: p.paidAmount,
        status: 'checkout', source: 'نزيل',
        notes: `نزيل#${p.bookingNum}`,
      }).save();
      created++;
    } catch (e) {
      errors.push(`${p.bookingNum}: ${e.message}`);
      skipped++;
    }
  }

  res.json({ success: true, created, skipped, total: parsed.length, errors: errors.slice(0, 30) });
});

// ── Data Export (CSV) ─────────────────────────────────────
function toCSV(rows, cols) {
  const header = cols.map(c => `"${c.label}"`).join(',');
  const lines  = rows.map(r => cols.map(c => {
    const v = String(r[c.key] ?? '').replace(/"/g, '""');
    return `"${v}"`;
  }).join(','));
  return '﻿' + [header, ...lines].join('\r\n'); // BOM for Excel Arabic support
}

router.get('/api/export/bookings.csv', reqStaff, async (req, res) => {
  if (!req.staff.permissions?.includes('reports')) return res.status(403).json({ error: 'صلاحية التقارير مطلوبة' });
  try {
    const B = require('../models/Booking');
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };
    const bookings = await B.find(filter).sort({ checkIn: -1 }).limit(10000).lean();
    const cols = [
      { key: '_id',         label: 'رقم الحجز' },
      { key: 'apt',         label: 'الشقة' },
      { key: 'name',        label: 'الاسم' },
      { key: 'phone',       label: 'الجوال' },
      { key: 'bookingType', label: 'نوع الحجز' },
      { key: 'checkIn',     label: 'تاريخ الدخول' },
      { key: 'checkOut',    label: 'تاريخ الخروج' },
      { key: 'nights',      label: 'الليالي' },
      { key: 'totalPrice',  label: 'الإجمالي' },
      { key: 'paidAmount',  label: 'المدفوع' },
      { key: 'status',      label: 'الحالة' },
      { key: 'source',      label: 'المصدر' },
      { key: 'createdAt',   label: 'تاريخ الإنشاء' },
    ];
    const rows = bookings.map(b => ({
      ...b,
      checkIn:   b.checkIn   ? new Date(b.checkIn).toLocaleDateString('ar-SA')   : '',
      checkOut:  b.checkOut  ? new Date(b.checkOut).toLocaleDateString('ar-SA')  : '',
      createdAt: b.createdAt ? new Date(b.createdAt).toLocaleDateString('ar-SA') : '',
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bookings-${Date.now()}.csv"`);
    res.send(toCSV(rows, cols));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/export/guests.csv', reqStaff, async (req, res) => {
  if (!req.staff.permissions?.includes('reports')) return res.status(403).json({ error: 'صلاحية التقارير مطلوبة' });
  try {
    const Guest = require('../models/Guest');
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { propertyId: null, building: req.staff.building };
    const guests = await Guest.find(filter).sort({ name: 1 }).limit(50000).lean();
    const cols = [
      { key: 'name',         label: 'الاسم' },
      { key: 'phone',        label: 'الجوال' },
      { key: 'idType',       label: 'نوع الإثبات' },
      { key: 'idNumber',     label: 'رقم الإثبات' },
      { key: 'nationality',  label: 'الجنسية' },
      { key: 'email',        label: 'البريد' },
      { key: 'category',     label: 'التصنيف' },
      { key: 'totalBookings',label: 'عدد الحجوزات' },
      { key: 'lastSeen',     label: 'آخر زيارة' },
    ];
    const rows = guests.map(g => ({
      ...g,
      lastSeen: g.lastSeen ? new Date(g.lastSeen).toLocaleDateString('ar-SA') : '',
      phone: ['nophone-','dup-','nzl-'].some(p => String(g.phone).startsWith(p)) ? '' : g.phone,
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="guests-${Date.now()}.csv"`);
    res.send(toCSV(rows, cols));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// CHANNEL MANAGER — Multi-platform booking sync
// ══════════════════════════════════════════════════════════

const crypto   = require('crypto');
const https    = require('https');
const http     = require('http');

const PLATFORM_LABELS = {
  airbnb:   'Airbnb',
  booking:  'Booking.com',
  gathering:'Gathering',
  website:  'موقعنا',
};

// Block SSRF — private IPs, localhost, AWS metadata, etc.
function isSafeICalUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (!['http:', 'https:'].includes(protocol)) return false;
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false;
    if (/^10\./.test(h) || /^192\.168\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h === '169.254.169.254') return false;        // AWS/GCP metadata
    if (h.endsWith('.internal') || h.endsWith('.local')) return false;
    return true;
  } catch { return false; }
}

function fetchUrl(url, timeoutMs = 12000) {
  if (!isSafeICalUrl(url)) return Promise.reject(new Error('رابط iCal غير مسموح'));
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Parse iCal text → array of { uid, summary, dtStart, dtEnd, status }
function parseICal(text) {
  const events = [];
  const veventBlocks = text.split('BEGIN:VEVENT').slice(1);
  for (const block of veventBlocks) {
    const get = k => {
      const m = block.match(new RegExp(`${k}[^:]*:([^\\r\\n]+)`));
      return m ? m[1].trim() : '';
    };
    const parseDate = s => {
      if (!s) return null;
      const d = s.replace(/[TZ]/g, '');
      if (d.length >= 8) {
        const y = d.slice(0,4), mo = d.slice(4,6), day = d.slice(6,8);
        const h = d.slice(8,10)||'00', mi = d.slice(10,12)||'00';
        return new Date(`${y}-${mo}-${day}T${h}:${mi}:00Z`);
      }
      return null;
    };
    const uid     = get('UID');
    const summary = get('SUMMARY');
    const dtStart = parseDate(get('DTSTART'));
    const dtEnd   = parseDate(get('DTEND'));
    const status  = get('STATUS') || 'CONFIRMED';
    if (uid && dtStart && dtEnd) events.push({ uid, summary, dtStart, dtEnd, status });
  }
  return events;
}

// Build iCal text from our bookings
function buildICal(bookings, building) {
  const fmt = d => {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'').replace('T','T').replace('Z','Z');
  };
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//BAREZ//Channel Manager//AR`,
    `X-WR-CALNAME:BAREZ ${building}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const b of bookings) {
    const uid = `barez-${b._id}@barez.sa`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTART;VALUE=DATE:${fmt(b.checkIn).slice(0,8)}`);
    lines.push(`DTEND;VALUE=DATE:${fmt(b.checkOut).slice(0,8)}`);
    lines.push(`SUMMARY:BLOCKED - ${b.apt} - ${b.name||'حجز'}`);
    lines.push(`STATUS:${b.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`);
    lines.push(`DESCRIPTION:شقة ${b.apt} - ${b.name||''} - ${b.phone||''}`);
    lines.push(`LAST-MODIFIED:${fmt(b.updatedAt||b.createdAt)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Build booking notification email HTML
function channelBookingEmail({ platform, apt, building, name, checkIn, checkOut, totalPrice, nights }) {
  const fDate = d => d ? new Date(d).toLocaleDateString('ar-SA', { year:'numeric', month:'long', day:'numeric' }) : '—';
  const platformLabel = PLATFORM_LABELS[platform] || platform;
  const platformColors = { airbnb:'#FF5A5F', booking:'#003580', gathering:'#1a6b3c', website:'#1a3d8f' };
  const color = platformColors[platform] || '#1a3d8f';
  return `
<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:0;direction:rtl;}
.wrap{max-width:540px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);}
.hd{background:${color};padding:28px 32px;color:#fff;}
.hd h1{margin:0;font-size:22px;font-weight:800;}
.hd p{margin:6px 0 0;opacity:.85;font-size:14px;}
.body{padding:28px 32px;}
.row{display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:12px 0;font-size:14px;}
.row:last-child{border-bottom:none;}
.lbl{color:#64748b;font-weight:600;}
.val{color:#0f172a;font-weight:700;}
.badge{display:inline-block;background:${color}18;color:${color};border-radius:20px;padding:4px 14px;font-size:13px;font-weight:800;margin-top:4px;}
.ft{background:#f8fafc;padding:16px 32px;font-size:12px;color:#94a3b8;text-align:center;}
</style></head><body>
<div class="wrap">
  <div class="hd">
    <h1>حجز جديد من ${platformLabel}</h1>
    <p>تم استلام حجز جديد وتم إغلاق الوحدة تلقائياً في المنصات الأخرى</p>
  </div>
  <div class="body">
    <div style="margin-bottom:16px;"><span class="badge">📍 ${building} — شقة ${apt}</span></div>
    <div class="row"><span class="lbl">اسم العميل</span><span class="val">${name||'—'}</span></div>
    <div class="row"><span class="lbl">المنصة</span><span class="val">${platformLabel}</span></div>
    <div class="row"><span class="lbl">تاريخ الدخول</span><span class="val">${fDate(checkIn)}</span></div>
    <div class="row"><span class="lbl">تاريخ الخروج</span><span class="val">${fDate(checkOut)}</span></div>
    <div class="row"><span class="lbl">عدد الليالي</span><span class="val">${nights||'—'} ليلة</span></div>
    <div class="row"><span class="lbl">الإجمالي</span><span class="val">${totalPrice ? totalPrice.toLocaleString('ar-SA') + ' ريال' : '—'}</span></div>
  </div>
  <div class="ft">BAREZ Property Management · تم الإرسال تلقائياً</div>
</div></body></html>`;
}

// GET /staff/ical/:building/:secret — serve our calendar for external platforms
router.get('/ical/:building/:secret', async (req, res) => {
  try {
    const ChannelConfig = require('../models/ChannelConfig');
    const Booking = require('../models/Booking');
    const { building, secret } = req.params;
    const configs = await ChannelConfig.find({ building, icalSecret: secret }).lean();
    if (!configs.length) return res.status(403).send('Unauthorized');
    const bookings = await Booking.find({
      building,
      status: { $nin: ['cancelled'] },
      checkIn: { $gte: new Date(Date.now() - 90 * 86400000) },
    }).lean();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${building}.ics"`);
    res.send(buildICal(bookings, building));
  } catch(e) { res.status(500).send('Error: ' + e.message); }
});

// GET /staff/api/channels — get channel configs for this building
router.get('/api/channels', reqStaff, async (req, res) => {
  try {
    const ChannelConfig = require('../models/ChannelConfig');
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };
    const configs = await ChannelConfig.find(filter).lean();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = ['airbnb','booking','gathering','website'].map(p => {
      const c = configs.find(x => x.platform === p) || {};
      const secret = c.icalSecret || '';
      return {
        platform: p,
        label: PLATFORM_LABELS[p],
        enabled: c.enabled || false,
        icalImport: c.icalImport || '',
        icalExportUrl: secret ? `${baseUrl}/staff/ical/${encodeURIComponent(req.staff.building)}/${secret}` : '',
        hotelId: c.hotelId || '',
        lastSync: c.lastSync || null,
        lastSyncStatus: c.lastSyncStatus || 'never',
        lastSyncMsg: c.lastSyncMsg || '',
        notifyEmail: c.notifyEmail || '',
        _id: c._id || null,
      };
    });
    res.json({ configs: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /staff/api/channels/:platform — save/update config for one platform
router.post('/api/channels/:platform', reqStaff, async (req, res) => {
  if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });
  try {
    const ChannelConfig = require('../models/ChannelConfig');
    const platform = req.params.platform;
    if (!['airbnb','booking','gathering','website'].includes(platform))
      return res.status(400).json({ error: 'منصة غير معروفة' });
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId, platform }
      : { building: req.staff.building, propertyId: null, platform };
    let cfg = await ChannelConfig.findOne(filter);
    if (!cfg) {
      cfg = new ChannelConfig({
        ...filter,
        building: req.staff.building,
        icalSecret: crypto.randomBytes(24).toString('hex'),
      });
    }
    const { enabled, icalImport, hotelId, apiKey, apiSecret, notifyEmail } = req.body;
    if (enabled !== undefined) cfg.enabled = !!enabled;
    if (icalImport !== undefined) cfg.icalImport = icalImport.trim();
    if (hotelId !== undefined) cfg.hotelId = hotelId.trim();
    if (apiKey !== undefined) cfg.apiKey = apiKey.trim();
    if (apiSecret !== undefined) cfg.apiSecret = apiSecret.trim();
    if (notifyEmail !== undefined) cfg.notifyEmail = notifyEmail.trim();
    if (!cfg.icalSecret) cfg.icalSecret = crypto.randomBytes(24).toString('hex');
    await cfg.save();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      icalExportUrl: `${baseUrl}/staff/ical/${encodeURIComponent(req.staff.building)}/${cfg.icalSecret}`,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /staff/api/channels/:platform/sync — manual sync (fetch iCal, detect new bookings, send email)
router.post('/api/channels/:platform/sync', reqStaff, async (req, res) => {
  try {
    const ChannelConfig = require('../models/ChannelConfig');
    const Booking = require('../models/Booking');
    const { sendEmail } = require('../utils/mailer');
    const platform = req.params.platform;
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId, platform }
      : { building: req.staff.building, propertyId: null, platform };
    const cfg = await ChannelConfig.findOne(filter);
    if (!cfg || !cfg.icalImport) return res.json({ success: false, msg: 'لا يوجد رابط iCal مضبوط لهذه المنصة' });

    let icalText;
    try { icalText = await fetchUrl(cfg.icalImport); }
    catch(e) {
      cfg.lastSync = new Date(); cfg.lastSyncStatus = 'error'; cfg.lastSyncMsg = e.message;
      await cfg.save();
      return res.json({ success: false, msg: 'فشل جلب iCal: ' + e.message });
    }

    const events = parseICal(icalText);
    let newBookings = 0;
    const building = req.staff.building;

    for (const ev of events) {
      if (ev.status === 'CANCELLED') continue;
      // Skip events with UID already stored as source
      const exists = await Booking.findOne({ source: `ch-${platform}-${ev.uid}` }).lean();
      if (exists) continue;

      // Try to extract apartment from summary (e.g. "BAREZ - 101 - Guest Name")
      const aptMatch = ev.summary.match(/\b(\d{3})\b/);
      const apt = aptMatch ? aptMatch[1] : (req.body.apt || '');
      const nights = ev.dtEnd && ev.dtStart ? Math.round((ev.dtEnd - ev.dtStart) / 86400000) : undefined;

      const booking = new Booking({
        building,
        propertyId: req.staff.propertyId || null,
        apt,
        name: ev.summary.replace(/BLOCKED\s*[-—]?\s*/i, '').split(' - ')[1] || ev.summary,
        phone: `ch-${platform}-${Date.now()}`,
        bookingType: 'daily',
        checkIn: ev.dtStart,
        checkOut: ev.dtEnd,
        nights,
        status: 'awaiting_checkin',
        source: `ch-${platform}-${ev.uid}`,
        notes: `مستورد تلقائياً من ${PLATFORM_LABELS[platform]}`,
      });
      await booking.save();
      newBookings++;

      // Send email notification
      const notifyTo = cfg.notifyEmail || process.env.NOTIFY_EMAIL || '';
      if (notifyTo) {
        await sendEmail({
          to: notifyTo,
          subject: `حجز جديد من ${PLATFORM_LABELS[platform]} — شقة ${apt}`,
          html: channelBookingEmail({
            platform, apt, building,
            name: booking.name,
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            nights: booking.nights,
            totalPrice: booking.totalPrice,
          }),
        });
      }
    }

    cfg.lastSync = new Date();
    cfg.lastSyncStatus = 'ok';
    cfg.lastSyncMsg = `${events.length} حدث، ${newBookings} حجز جديد`;
    await cfg.save();
    res.json({ success: true, events: events.length, newBookings, msg: cfg.lastSyncMsg });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /staff/api/channels/feed — recent bookings from all channel sources
router.get('/api/channels/feed', reqStaff, async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };
    filter.source = { $regex: /^ch-/ };
    const bookings = await Booking.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ bookings });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /staff/api/channels/webhook/:platform — webhook endpoint for direct API platforms
router.post('/api/channels/webhook/:platform', async (req, res) => {
  try {
    const ChannelConfig = require('../models/ChannelConfig');
    const Booking = require('../models/Booking');
    const { sendEmail } = require('../utils/mailer');
    const platform = req.params.platform;
    const secret = req.headers['x-webhook-secret'] || req.query.secret || '';

    // Validate secret
    const cfg = await ChannelConfig.findOne({ platform, icalSecret: secret });
    if (!cfg) return res.status(401).json({ error: 'unauthorized' });

    const body = req.body || {};
    // Normalize payload (Gathering / Booking.com formats differ)
    const apt       = body.apt || body.room || body.unit || '';
    const name      = body.guest_name || body.name || body.customer_name || 'ضيف';
    const checkIn   = body.check_in  || body.arrival   || body.from_date || null;
    const checkOut  = body.check_out || body.departure  || body.to_date   || null;
    const totalPrice= parseFloat(body.total || body.price || body.amount || 0) || undefined;
    const nights    = body.nights || (checkIn && checkOut ? Math.round((new Date(checkOut)-new Date(checkIn))/86400000) : undefined);
    const uid       = body.reservation_id || body.booking_id || body.id || `wh-${Date.now()}`;
    const isCancelled = (body.status||'').toLowerCase().includes('cancel');

    if (isCancelled) {
      // Reopen: mark matching booking as cancelled
      await Booking.updateMany(
        { building: cfg.building, source: `ch-${platform}-${uid}` },
        { status: 'cancelled' }
      );
      return res.json({ success: true, action: 'cancelled' });
    }

    const exists = await Booking.findOne({ source: `ch-${platform}-${uid}` }).lean();
    if (!exists) {
      await new Booking({
        building: cfg.building,
        propertyId: cfg.propertyId || null,
        apt, name, checkIn, checkOut, nights, totalPrice,
        phone: `ch-${platform}-${uid}`,
        bookingType: 'daily',
        status: 'awaiting_checkin',
        source: `ch-${platform}-${uid}`,
        notes: `ويب‌هوك من ${PLATFORM_LABELS[platform]}`,
      }).save();

      const notifyTo = cfg.notifyEmail || process.env.NOTIFY_EMAIL || '';
      if (notifyTo) {
        await sendEmail({
          to: notifyTo,
          subject: `حجز جديد من ${PLATFORM_LABELS[platform]} — شقة ${apt}`,
          html: channelBookingEmail({ platform, apt, building: cfg.building, name, checkIn, checkOut, nights, totalPrice }),
        });
      }
    }
    res.json({ success: true, action: 'created' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// CHANNEL MANAGER — Standalone page (per-building × per-apt)
// ══════════════════════════════════════════════════════════

// GET /staff/channels — render standalone page
router.get('/channels', reqStaff, (req, res) => {
  res.render('channel-manager', { staff: req.staff }, (err, html) => {
    if (err) {
      console.error('[channels] render error:', err.message, err.stack);
      return res.status(500).send(`<pre>Channel Manager Error:\n${err.message}\n\n${err.stack}</pre>`);
    }
    res.send(html);
  });
});

// GET /staff/api/listings — all ChannelListings for this staff's buildings
router.get('/api/listings', reqStaff, async (req, res) => {
  try {
    const ChannelListing = require('../models/ChannelListing');
    const { bldgs } = await getBldgConfig(req.staff);
    const buildings = Object.keys(bldgs);
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: { $in: buildings }, propertyId: null };
    const listings = await ChannelListing.find(filter).lean();
    res.json({ listings, buildings, bldgs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /staff/api/listings — upsert one listing connection
router.post('/api/listings', reqStaff, async (req, res) => {
  if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });
  try {
    const ChannelListing = require('../models/ChannelListing');
    const { apt, platform, icalImport, platformListingId, enabled } = req.body;
    // building must come from staff context, never from body — prevents cross-building tampering
    const building = req.staff.propertyId ? req.body.building : req.staff.building;
    if (!building || !apt || !platform) return res.status(400).json({ error: 'building, apt, platform مطلوبة' });
    const filter = { building, apt, platform, propertyId: req.staff.propertyId || null };
    const update = {
      $set: {
        ...(icalImport        !== undefined && { icalImport: (icalImport||'').trim() }),
        ...(platformListingId !== undefined && { platformListingId: (platformListingId||'').trim() }),
        ...(enabled           !== undefined && { enabled: !!enabled }),
        propertyId: req.staff.propertyId || null,
      }
    };
    const doc = await ChannelListing.findOneAndUpdate(filter, update, { upsert: true, new: true });
    res.json({ success: true, listing: doc });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /staff/api/listings/bulk — import many rows at once [{building,apt,platform,icalImport}]
router.post('/api/listings/bulk', reqStaff, async (req, res) => {
  if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });
  try {
    const ChannelListing = require('../models/ChannelListing');
    const rows = Array.isArray(req.body) ? req.body : [];
    let saved = 0, errors = [];
    for (const row of rows) {
      const { apt, platform, icalImport, platformListingId } = row;
      // building always from staff token for internal users — never from body
      const building = req.staff.propertyId ? (row.building || req.staff.building) : req.staff.building;
      if (!building || !apt || !platform) continue;
      try {
        await ChannelListing.findOneAndUpdate(
          { building, apt, platform, propertyId: req.staff.propertyId || null },
          { $set: { icalImport: (icalImport||'').trim(), platformListingId: (platformListingId||'').trim(), enabled: true, propertyId: req.staff.propertyId || null } },
          { upsert: true }
        );
        saved++;
      } catch(e) { errors.push(`${building}-${apt}-${platform}: ${e.message}`); }
    }
    res.json({ success: true, saved, errors: errors.slice(0,20) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /staff/api/listings/sync/:building — sync all listings in a building (or single apt)
router.post('/api/listings/sync/:building', reqStaff, async (req, res) => {
  if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });
  // non-propertyId staff can only sync their own building
  if (!req.staff.propertyId && req.params.building !== req.staff.building)
    return res.status(403).json({ error: 'غير مصرح بالوصول لهذا المبنى' });
  try {
    const ChannelListing = require('../models/ChannelListing');
    const Booking        = require('../models/Booking');
    const ChannelConfig  = require('../models/ChannelConfig');
    const { sendEmail }  = require('../utils/mailer');
    const building = req.params.building;
    const { apt, platform } = req.body; // optional filters

    const filter = { building, propertyId: req.staff.propertyId || null };
    if (apt)      filter.apt = apt;
    if (platform) filter.platform = platform;
    filter.enabled   = true;
    filter.icalImport = { $exists: true, $ne: '' };

    const listings = await ChannelListing.find(filter);
    const cfgFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building, propertyId: null };

    let totalNew = 0, totalErr = 0, results = [];

    for (const lst of listings) {
      let icalText;
      try { icalText = await fetchUrl(lst.icalImport); }
      catch(e) {
        lst.lastSync = new Date(); lst.lastSyncStatus = 'error'; lst.lastSyncMsg = e.message;
        await lst.save(); totalErr++; results.push({ apt: lst.apt, platform: lst.platform, ok: false, msg: e.message });
        continue;
      }

      const events = parseICal(icalText);
      let newCount = 0;

      for (const ev of events) {
        if (ev.status === 'CANCELLED') {
          await Booking.updateMany({ source: `ch-${lst.platform}-${ev.uid}` }, { status: 'cancelled' });
          continue;
        }
        const exists = await Booking.findOne({ source: `ch-${lst.platform}-${ev.uid}` }).lean();
        if (exists) continue;
        const nights = ev.dtEnd && ev.dtStart ? Math.round((ev.dtEnd - ev.dtStart) / 86400000) : undefined;
        await new Booking({
          building, apt: lst.apt,
          propertyId: lst.propertyId || null,
          name: ev.summary.replace(/BLOCKED\s*[-—]?\s*/i,'').trim() || 'حجز خارجي',
          phone: `ch-${lst.platform}-${Date.now()}`,
          bookingType: 'daily',
          checkIn: ev.dtStart, checkOut: ev.dtEnd, nights,
          status: 'awaiting_checkin',
          source: `ch-${lst.platform}-${ev.uid}`,
          notes: `مستورد من ${PLATFORM_LABELS[lst.platform]}`,
        }).save();
        newCount++; totalNew++;

        // Email notification
        const cfg = await ChannelConfig.findOne({ ...cfgFilter, platform: lst.platform }).lean();
        const notifyTo = (cfg && cfg.notifyEmail) || process.env.NOTIFY_EMAIL || '';
        if (notifyTo) {
          await sendEmail({
            to: notifyTo,
            subject: `حجز جديد من ${PLATFORM_LABELS[lst.platform]} — ${building} شقة ${lst.apt}`,
            html: channelBookingEmail({ platform: lst.platform, apt: lst.apt, building, name: 'حجز خارجي', checkIn: ev.dtStart, checkOut: ev.dtEnd, nights }),
          });
        }
      }

      lst.lastSync = new Date(); lst.lastSyncStatus = 'ok';
      lst.lastSyncMsg = `${events.length} حدث، ${newCount} جديد`; lst.lastEventCount = events.length;
      await lst.save();
      results.push({ apt: lst.apt, platform: lst.platform, ok: true, newCount, total: events.length });
    }

    res.json({ success: true, totalNew, totalErr, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /staff/api/listings/:id — remove a listing connection
router.delete('/api/listings/:id', reqStaff, async (req, res) => {
  if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });
  try {
    const ChannelListing = require('../models/ChannelListing');
    const ownerFilter = req.staff.propertyId
      ? { _id: req.params.id, propertyId: req.staff.propertyId }
      : { _id: req.params.id, building: req.staff.building };
    const doc = await ChannelListing.findOneAndDelete(ownerFilter);
    if (!doc) return res.status(404).json({ error: 'الربط غير موجود أو غير مصرح' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Daily Closing (التقفيلة اليومية) ─────────────────
router.get('/api/daily-closing', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };

    // Saudi time offset (+3) — use requested date or today
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const todayStr = req.query.date || now.toISOString().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayStr))
      return res.status(400).json({ error: 'تاريخ غير صالح' });
    const todayStart = new Date(todayStr + 'T00:00:00+03:00');
    const todayEnd   = new Date(todayStr + 'T23:59:59+03:00');

    // استثناء: حجوزات نزيل المستوردة وحجوزات channel manager (source يبدأ بـ ch-)
    const notImported = { $not: /^(ch-|نزيل)/ };

    const [newBookings, arrivals, departures] = await Promise.all([
      // حجوزات جديدة اليوم (يدوية — تستثني المستوردة)
      B.find({ ...filter, source: notImported, createdAt: { $gte: todayStart, $lte: todayEnd } }).lean(),
      // وصولات اليوم
      B.find({ ...filter, checkIn: { $gte: todayStart, $lte: todayEnd }, status: { $in: ['active','checkout','awaiting_checkin'] } }).lean(),
      // مغادرات اليوم
      B.find({ ...filter, checkOut: { $gte: todayStart, $lte: todayEnd }, status: { $in: ['checkout','active'] } }).lean(),
    ]);

    // إجمالي المحصّل من الحجوزات الجديدة اليوم
    const pmLabels = { cash: 'كاش', transfer: 'تحويل', network: 'شبكة', other: 'أخرى', '': 'غير محدد' };
    const byMethod = {};
    let totalCollected = 0;
    newBookings.forEach(b => {
      const paid = b.paidAmount || 0;
      if (paid <= 0) return;
      const pm = b.paymentMethod || '';
      if (!byMethod[pm]) byMethod[pm] = { label: pmLabels[pm] || pm, total: 0, bookings: [] };
      byMethod[pm].total += paid;
      byMethod[pm].bookings.push({ name: b.name, apt: b.apt, paid, total: b.totalPrice || 0 });
      totalCollected += paid;
    });

    res.json({
      date: todayStr,
      totalCollected,
      byMethod: Object.values(byMethod),
      newBookings: newBookings.map(b => ({
        _id: b._id, apt: b.apt, name: b.name, phone: b.phone,
        totalPrice: b.totalPrice || 0, paidAmount: b.paidAmount || 0,
        paymentMethod: b.paymentMethod || '', bookingType: b.bookingType,
        checkIn: b.checkIn, checkOut: b.checkOut, status: b.status,
      })),
      arrivals: arrivals.map(b => ({ _id: b._id, apt: b.apt, name: b.name, phone: b.phone, checkIn: b.checkIn, checkOut: b.checkOut, status: b.status })),
      departures: departures.map(b => ({ _id: b._id, apt: b.apt, name: b.name, phone: b.phone, checkIn: b.checkIn, checkOut: b.checkOut, status: b.status })),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Cash Flow Report ─────────────────────────────────────
router.get('/api/reports/cash-flow', reqStaff, async (req, res) => {
  try {
    const V = require('../models/Voucher');
    const B = require('../models/Booking');
    const baseFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };

    const { dateFrom, dateTo, user, includeClosed, includeServices, includeDeposits } = req.query;
    const from = dateFrom ? new Date(dateFrom) : (() => { const d=new Date(); d.setHours(0,0,0,0); return d; })();
    const to   = dateTo   ? new Date(dateTo)   : (() => { const d=new Date(); d.setHours(23,59,59,999); return d; })();

    const vFilter = { ...baseFilter, date: { $gte: from, $lte: to } };
    if (user) vFilter.createdBy = user;

    // أنواع سندات القبض
    const receiptTypes = ['receipt'];
    if (includeServices === 'true') receiptTypes.push('invoice');

    const [rawReceipts, rawDisbursements, rawChecks, users] = await Promise.all([
      V.find({ ...vFilter, type: { $in: receiptTypes } }).sort({ date: 1 }).lean(),
      V.find({ ...vFilter, type: 'disbursement' }).sort({ date: 1 }).lean(),
      V.find({ ...baseFilter, type: 'check', date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean(),
      V.distinct('createdBy', baseFilter),
    ]);

    // helper: استنتاج طريقة الدفع من الحقول المتاحة
    const resolveMethod = v => v.paymentMethod || (v.bankName ? 'transfer' : 'cash');

    const mapV = v => ({
      _id: v._id, number: v.number || '-', date: v.date || v.createdAt || null,
      name: v.name || '', apt: v.apt || '', description: v.description || '',
      paymentMethod: resolveMethod(v), bankName: v.bankName || '',
      amount: v.amount || 0, createdBy: v.createdBy || '',
    });

    let receipts     = rawReceipts.map(mapV);
    let disbursements = rawDisbursements.map(mapV);
    const checks      = rawChecks.map(mapV);

    // حجوزات مغلقة (اختياري)
    if (includeClosed === 'true') {
      const bkFilter = { ...baseFilter, status: 'checkout', checkOut: { $gte: from, $lte: to } };
      if (user) bkFilter.createdBy = user;
      const closed = await B.find(bkFilter).sort({ checkOut: 1 }).lean();
      const bkRows = closed.filter(b => (b.paidAmount||0) > 0).map(b => ({
        _id: b._id,
        number: 'BK-' + b._id.toString().slice(-5).toUpperCase(),
        date: b.checkOut, name: b.name, apt: b.apt,
        description: `حجز شقة ${b.apt}`,
        paymentMethod: b.paymentMethod || 'cash', bankName: '',
        amount: b.paidAmount || 0, createdBy: '',
      }));
      receipts = [...receipts, ...bkRows].sort((a,b) => new Date(a.date)-new Date(b.date));
    }

    // حسابات الملخص
    const sum   = arr => arr.reduce((s,v) => s+v.amount, 0);
    const byPm  = (arr, pm) => sum(arr.filter(v => (v.paymentMethod||'cash') === pm));

    const totalReceipts      = sum(receipts);
    const totalDisbursements = sum(disbursements);
    const bankReceipts       = byPm(receipts, 'transfer');
    const bankDisbursements  = byPm(disbursements, 'transfer');
    const cashReceipts       = byPm(receipts, 'cash') + sum(receipts.filter(v => !v.paymentMethod));
    const cashDisbursements  = byPm(disbursements, 'cash') + sum(disbursements.filter(v => !v.paymentMethod));
    const totalChecks        = sum(checks);
    const vatOnReceipts      = Math.round(totalReceipts / 1.15 * 0.15 * 100) / 100;
    const vatOnDisbursements = Math.round(totalDisbursements / 1.15 * 0.15 * 100) / 100;

    // تفصيل طرق الدفع لصف الأعلى
    const pmReceipts = {
      cash:         byPm(receipts, 'cash') + sum(receipts.filter(v => !v.paymentMethod)),
      check:        byPm(receipts, 'check'),
      network:      byPm(receipts, 'network'),
      transfer:     byPm(receipts, 'transfer'),
      digital:      byPm(receipts, 'digital'),
      travel_agent: byPm(receipts, 'travel_agent'),
    };

    // الرصيد الإجمالي للبنك (كل الفترات)
    const [allBankR, allBankD] = await Promise.all([
      V.aggregate([{ $match: { ...baseFilter, type: { $in: ['receipt','invoice'] }, $or:[{paymentMethod:'transfer'},{bankName:{$ne:'',$exists:true}}] } }, { $group:{_id:null,t:{$sum:'$amount'}} }]),
      V.aggregate([{ $match: { ...baseFilter, type: 'disbursement', $or:[{paymentMethod:'transfer'},{bankName:{$ne:'',$exists:true}}] } }, { $group:{_id:null,t:{$sum:'$amount'}} }]),
    ]);
    const totalBankBalance = (allBankR[0]?.t||0) - (allBankD[0]?.t||0);
    const net      = totalReceipts - totalDisbursements;
    const netBank  = bankReceipts - bankDisbursements;

    res.json({
      receipts, disbursements, checks,
      users: users.filter(Boolean),
      summary: {
        totalReceipts, totalDisbursements,
        countReceipts: receipts.length, countDisbursements: disbursements.length,
        bankReceipts, bankDisbursements, cashReceipts, cashDisbursements,
        vatOnReceipts, vatOnDisbursements,
        net, netBank,
        netCash: cashReceipts - cashDisbursements,
        totalFund: net,
        bankBalance: netBank,
        totalBankBalance, totalChecks,
        pmReceipts,
        depositReceipts: 0, depositDisbursements: 0,
        netDeposit: 0, prevDeposits: 0, prevAmounts: 0,
      },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Receipts ─────────────────────────────────────────────────────────────────
// يستقبل JSON: { imageBase64, mimeType, building, payMethod, expectedPaid }

router.post('/api/receipts/analyze', reqStaff, async (req, res) => {
  try {
    const { imageBase64, mimeType: rawMime, building: bldBody, payMethod: pmBody, expectedPaid: ep } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'لم يتم إرسال الصورة' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY غير مضبوط في متغيرات البيئة' });

    const mimeType     = rawMime || 'image/jpeg';
    const building     = (bldBody || req.staff.building || '').trim();
    const payMethod    = (pmBody || '').trim();
    const expectedPaid = parseFloat(ep) || null;

    const BUILDING_ENTITIES = {
      'المنارا':  { names: ['بارز برايم', 'barez prime', 'جهد وأمان', 'jahd', 'waman', 'جهد'], accounts: ['33700001155701'], ibans: ['SA3710000033700001155701','SA37 1000 0033 7000 0115 5701'] },
      'جوان ان': { names: ['بارز برايم', 'barez prime', 'جهد وأمان', 'jahd', 'waman', 'جهد'], accounts: ['33700001155701'], ibans: ['SA3710000033700001155701','SA37 1000 0033 7000 0115 5701'] },
      'الماسة':  { names: ['الزاحم', 'alzahim', 'إبراهيم', 'ibrahim'], accounts: [], ibans: [] },
      'الواحة':  { names: ['الزاحم', 'alzahim', 'أحمد', 'ahmed'], accounts: [], ibans: [] },
    };

    const isCash = payMethod === 'cash';

    const prompt = isCash
      ? `You are analyzing an image of Saudi Riyal (SAR) banknotes. Count every visible bill carefully.

Saudi Riyal denominations to look for:
- 500 SAR (خمسمائة ريال) — purple/dark violet color
- 200 SAR (مئتا ريال) — dark green/brown color
- 100 SAR (مائة ريال) — blue/teal color
- 50 SAR (خمسون ريالاً) — green color
- 20 SAR (عشرون ريالاً) — orange/yellow color
- 10 SAR (عشرة ريالات) — brown/olive color
- 5 SAR (خمسة ريالات) — brown color
- 1 SAR (ريال واحد) — silver/light

Instructions:
1. Look at the denomination number printed on each bill (in both Arabic numerals ٥٠٠،١٠٠،٥٠ and Western numerals 500,100,50).
2. Count how many bills of each denomination are visible (even partially).
3. Multiply each denomination by its count to get subtotal.
4. Sum all subtotals for totalAmount.

Respond ONLY with valid JSON, no other text:
{
  "bills": [
    { "denomination": 500, "count": 2, "subtotal": 1000 },
    { "denomination": 100, "count": 3, "subtotal": 300 }
  ],
  "totalAmount": 1300,
  "confidence": "high or medium or low"
}
If you cannot clearly identify any bills (blurry image, no cash visible), set totalAmount to null and confidence to "low".`
      : `استخرج المعلومات التالية من هذا الإيصال البنكي. أجب بـ JSON فقط بدون أي نص خارجه:
{
  "paymentType": "network أو transfer أو other",
  "amount": رقم المبلغ (أرقام فقط وإلا null),
  "date": "YYYY-MM-DD أو null",
  "transactionNumber": "رقم العملية أو المرجع أو null",
  "entityName": "اسم المستفيد أو الجهة المستلمة أو null",
  "accountNumber": "رقم الحساب المستفيد (أرقام فقط بدون مسافات) أو null",
  "iban": "الآيبان IBAN للمستفيد (مثل SA37...) أو null",
  "bankName": "اسم البنك أو null"
}
network = مدفوعات عبر نقاط البيع أو الشبكة السعودية (SPAN/POS).
transfer = تحويل بنكي إلكتروني.`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify({
        model:      isCash ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
        max_tokens: isCash ? 1024 : 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(500).json({ error: 'Claude API error', detail: errText.slice(0, 200) });
    }

    const apiData = await apiRes.json();
    const rawText = apiData.content?.[0]?.text || '{}';

    let parsed = {};
    try {
      const m = rawText.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch(_) {}

    let analysis = {};

    if (isCash) {
      const cashTotal = typeof parsed.totalAmount === 'number' ? parsed.totalAmount : null;
      const bills = Array.isArray(parsed.bills)
        ? parsed.bills.filter(b => b.denomination && b.count).map(b => ({
            denomination: Number(b.denomination),
            count:        Number(b.count),
          }))
        : [];
      analysis = {
        paymentType:      'cash',
        amount:           cashTotal,
        cashTotal,
        bills,
        cashMatchesPaid:  expectedPaid !== null && cashTotal !== null ? Math.abs(cashTotal - expectedPaid) <= 1 : null,
        rawSummary:       rawText.slice(0, 400),
      };
    } else {
      const amount = typeof parsed.amount === 'number' ? parsed.amount : (parseFloat(parsed.amount) || null);
      const entityName = parsed.entityName || null;
      const accountNumber = (parsed.accountNumber || '').replace(/\s/g, '') || null;
      const iban = (parsed.iban || '').replace(/\s/g, '').toUpperCase() || null;
      const bldConfig = BUILDING_ENTITIES[building] || { names: [], accounts: [], ibans: [] };

      // Match by name
      const entityLower = (entityName || '').toLowerCase();
      const nameMatch = entityName
        ? bldConfig.names.some(e => entityLower.includes(e.toLowerCase()) || entityName.includes(e))
        : false;
      // Match by account number
      const acctMatch = accountNumber
        ? bldConfig.accounts.some(a => accountNumber.includes(a) || a.includes(accountNumber))
        : false;
      // Match by IBAN (normalize spaces)
      const ibanMatch = iban
        ? bldConfig.ibans.some(i => i.replace(/\s/g,'').toUpperCase() === iban)
        : false;

      const matchesBuilding = (nameMatch || acctMatch || ibanMatch) ? true
        : (entityName || accountNumber || iban) ? false
        : null;

      analysis = {
        paymentType:       parsed.paymentType || 'other',
        amount,
        date:              parsed.date || null,
        transactionNumber: parsed.transactionNumber || null,
        entityName,
        accountNumber,
        iban,
        bankName:          parsed.bankName || null,
        matchesBuilding,
        rawSummary:        rawText.slice(0, 300),
      };
    }

    res.json({ success: true, analysis });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/receipts', reqStaff, async (req, res) => {
  try {
    const Receipt = require('../models/Receipt');
    const Notification = require('../models/Notification');
    const { bookingId, building, apt, guestName, imageData, imageMimeType, analysis } = req.body;
    const bld = building || req.staff.building;
    const rec = await Receipt.create({
      bookingId:     bookingId || null,
      building:      bld,
      apt:           apt || '',
      guestName:     guestName || '',
      imageData:     imageData || '',
      imageMimeType: imageMimeType || 'image/jpeg',
      analysis:      analysis || {},
      analysisStatus:'success',
      status:        bookingId ? 'linked' : 'pending',
      propertyId:    req.staff.propertyId || null,
      createdBy:     req.staff.name,
    });
    // إشعار فوري عند عدم تطابق الجهة
    if (analysis?.matchesBuilding === false) {
      await Notification.create({
        building:   bld,
        propertyId: req.staff.propertyId || null,
        type:       'receipt_mismatch',
        title:      '⚠️ إيصال — جهة غير مطابقة',
        message:    `رفع ${req.staff.name} إيصالاً للشقة ${apt||'—'} بمبلغ ${analysis?.amount||'—'} ريال، الجهة المدوّنة (${analysis?.entityName||'غير معروفة'}) لا تطابق ${bld}`,
        data:       { receiptId: rec._id, apt, amount: analysis?.amount, staffName: req.staff.name, entityName: analysis?.entityName },
      });
    }
    res.json({ success: true, receiptId: rec._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/receipts', reqStaff, async (req, res) => {
  try {
    const Receipt = require('../models/Receipt');
    const filter = { propertyId: req.staff.propertyId || null };
    if (req.query.bookingId) {
      filter.bookingId = req.query.bookingId;
    } else {
      filter.building = req.query.building || req.staff.building;
    }
    if (req.query.type       && req.query.type       !== 'all') filter['analysis.paymentType'] = req.query.type;
    if (req.query.recStatus  && req.query.recStatus  !== 'all') filter.status = req.query.recStatus;
    if (req.query.matchStatus === 'matched') filter['analysis.matchesBuilding'] = true;
    if (req.query.matchStatus === 'warned')  filter['analysis.matchesBuilding'] = false;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.createdAt = {};
      if (req.query.dateFrom) filter.createdAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo)   filter.createdAt.$lte = new Date(req.query.dateTo + 'T23:59:59');
    }
    const recs = await Receipt.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json(recs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /staff/api/receipts/:id/link — ربط إيصال بحجز
router.put('/api/receipts/:id/link', reqStaff, async (req, res) => {
  try {
    if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });
    const Receipt = require('../models/Receipt');
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId مطلوب' });
    await Receipt.findByIdAndUpdate(req.params.id, { bookingId, status: 'linked' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /staff/api/receipts/:id/reject — رفض إيصال
router.put('/api/receipts/:id/reject', reqStaff, async (req, res) => {
  try {
    if (req.staff.role !== 'manager') return res.status(403).json({ error: 'للمديرين فقط' });
    const Receipt = require('../models/Receipt');
    await Receipt.findByIdAndUpdate(req.params.id, { status: 'rejected', rejectionReason: req.body.reason || '' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /staff/api/notifications — جلب الإشعارات
router.get('/api/notifications', reqStaff, async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };
    const [items, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(30).lean(),
      Notification.countDocuments({ ...filter, isRead: false }),
    ]);
    res.json({ items, unread });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /staff/api/notifications/read — تحديد الكل كمقروء
router.put('/api/notifications/read', reqStaff, async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const filter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };
    await Notification.updateMany({ ...filter, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ID Card Scan ─────────────────────────────────────────────────────────────
router.post('/api/id/analyze', reqStaff, async (req, res) => {
  try {
    const { imageBase64, mimeType: rawMime } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'لم يتم إرسال الصورة' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY غير مضبوط' });

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: rawMime || 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: `Extract all data from this identity document (Saudi national ID, iqama/residence permit, passport, or Gulf ID).

Respond ONLY with valid JSON — no other text:
{
  "idType": "national_id OR iqama OR passport OR gcc OR other",
  "idNumber": "the ID/document number (digits only, no spaces)",
  "fullName": "full name in Arabic if available, otherwise in English",
  "nationality": "nationality in Arabic (e.g. سعودي، مصري، هندي، باكستاني...)",
  "dateOfBirth": "YYYY-MM-DD or null",
  "expiryDate": "YYYY-MM-DD or null",
  "gender": "male OR female OR null",
  "issuePlace": "place of issue in Arabic or null"
}

Rules:
- Saudi national ID (هوية وطنية): 10-digit number starting with 1 (Saudi) or 2 (resident)
- Iqama (إقامة): 10-digit number starting with 2
- Passport: alphanumeric, e.g. A1234567
- For Arabic names on Saudi IDs, extract the full Arabic name
- Hijri dates on Saudi IDs: convert to Gregorian if possible, otherwise return null
- If a field is not visible or unclear, return null for that field
- idNumber must contain ONLY digits or letters, no dashes or spaces` }
        ]}],
      }),
    });
    if (!apiRes.ok) return res.status(500).json({ error: 'Claude API error' });
    const data = await apiRes.json();
    const raw = data.content?.[0]?.text || '{}';
    let parsed = {};
    try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch(_) {}

    const today = new Date(); today.setHours(0,0,0,0);
    const expiry = parsed.expiryDate ? new Date(parsed.expiryDate) : null;
    const isExpired = expiry ? expiry < today : null;

    res.json({
      idType:      ['national_id','iqama','passport','gcc','other'].includes(parsed.idType) ? parsed.idType : 'other',
      idNumber:    parsed.idNumber   || null,
      fullName:    parsed.fullName   || null,
      nationality: parsed.nationality|| null,
      dateOfBirth: parsed.dateOfBirth|| null,
      expiryDate:  parsed.expiryDate || null,
      gender:      parsed.gender     || null,
      issuePlace:  parsed.issuePlace || null,
      isExpired,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Maintenance Requests ──────────────────────────────────────────────────────

// POST /staff/api/maintenance/analyze — AI تحليل صورة العطل
router.post('/api/maintenance/analyze', reqStaff, async (req, res) => {
  try {
    if (!hasMaintenance(req)) return res.status(403).json({ error: 'غير مصرح' });
    const { imageBase64, mimeType: rawMime } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'لم يتم إرسال الصورة' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY غير مضبوط' });

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: rawMime || 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: `You are a maintenance expert for a furnished apartment. Analyze this image carefully and write a detailed Arabic maintenance report.

Respond ONLY with valid JSON:
{
  "type": "electrical OR plumbing OR furniture OR ac OR internet OR other",
  "description": "2-3 sentences in Arabic. Describe: (1) exactly what you see broken/damaged, (2) the visible symptoms or signs (e.g. water leak, burn marks, crack, rust, missing part), (3) where exactly it is located if visible. Be specific and technical so a maintenance worker knows exactly what to fix.",
  "priority": "urgent OR medium OR normal"
}

Priority guide:
- urgent: immediate safety risk or completely blocks guest use (flooding, no electricity, no water, gas leak, broken door lock)
- medium: functional problem affecting comfort (AC not cooling well, broken furniture, hot water issue, partial power loss)
- normal: cosmetic or minor issue (paint scratch, small crack, loose handle, slow drain)

If image is unclear or shows multiple issues, describe the most critical one first.` }
        ]}],
      }),
    });
    if (!apiRes.ok) return res.status(500).json({ error: 'Claude API error' });
    const data = await apiRes.json();
    const raw = data.content?.[0]?.text || '{}';
    let parsed = {};
    try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch(_) {}
    res.json({
      type:        ['electrical','plumbing','furniture','ac','internet','other'].includes(parsed.type) ? parsed.type : 'other',
      description: parsed.description || '',
      priority:    ['urgent','medium','normal'].includes(parsed.priority) ? parsed.priority : 'normal',
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /staff/api/maintenance — إنشاء طلب صيانة
router.post('/api/maintenance', reqStaff, async (req, res) => {
  try {
    if (!hasMaintenance(req)) return res.status(403).json({ error: 'غير مصرح' });
    const MR = require('../models/MaintenanceRequest');
    const { apt, type, description, priority, imageBase64, imageMimeType, notes } = req.body;
    if (!apt || !description) return res.status(400).json({ error: 'الشقة والوصف مطلوبان' });

    let imageUrl = '', imagePublicId = '';

    // رفع الصورة على Cloudinary إذا توفرت المفاتيح وتوفرت الصورة
    if (imageBase64 && process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      try {
        const crypto = require('crypto');
        const cloudName  = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey     = process.env.CLOUDINARY_API_KEY;
        const apiSecret  = process.env.CLOUDINARY_API_SECRET;
        const folder     = 'barez/maintenance';
        const timestamp  = Math.floor(Date.now() / 1000);
        const toSign     = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
        const signature  = crypto.createHash('sha1').update(toSign).digest('hex');
        const upRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file:      `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}`,
            api_key:   apiKey,
            timestamp,
            signature,
            folder,
          }),
        });
        if (upRes.ok) {
          const upData = await upRes.json();
          imageUrl      = upData.secure_url || '';
          imagePublicId = upData.public_id  || '';
        }
      } catch(_) {}
    } else if (imageBase64) {
      // fallback: خزّن base64 مباشرة (بدون Cloudinary)
      imageUrl = `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}`;
    }

    const mr = await new MR({
      building:    req.staff.building,
      apt,
      propertyId:  req.staff.propertyId || null,
      type:        type || 'other',
      description,
      priority:    priority || 'normal',
      imageUrl,
      imagePublicId,
      notes:       notes || '',
      reportedBy:  req.staff.name,
      status:      'new',
    }).save();

    // إشعار بريد إلكتروني للمدير إذا كانت الأولوية عاجلة
    if (priority === 'urgent' && process.env.NOTIFY_EMAIL) {
      const { sendEmail } = require('../utils/mailer');
      sendEmail(
        process.env.NOTIFY_EMAIL,
        `🚨 طلب صيانة عاجل — شقة ${apt} (${req.staff.building})`,
        `<div dir="rtl" style="font-family:sans-serif;">
          <h2 style="color:#dc2626;">طلب صيانة عاجل</h2>
          <p><strong>المبنى:</strong> ${req.staff.building}</p>
          <p><strong>الشقة:</strong> ${apt}</p>
          <p><strong>النوع:</strong> ${type}</p>
          <p><strong>الوصف:</strong> ${description}</p>
          <p><strong>أبلغ عنه:</strong> ${req.staff.name}</p>
          ${imageUrl && !imageUrl.startsWith('data:') ? `<p><a href="${imageUrl}">📷 عرض الصورة</a></p>` : ''}
        </div>`
      ).catch(() => {});
    }

    res.json({ success: true, id: mr._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /staff/api/maintenance — قائمة طلبات الصيانة
router.get('/api/maintenance', reqStaff, async (req, res) => {
  try {
    if (!hasMaintenance(req)) return res.status(403).json({ error: 'غير مصرح' });
    const MR = require('../models/MaintenanceRequest');
    const filter = req.staff.propertyId ? { propertyId: req.staff.propertyId } : { building: req.staff.building, propertyId: null };
    if (req.query.status   && req.query.status   !== 'all') filter.status   = req.query.status;
    if (req.query.priority && req.query.priority !== 'all') filter.priority = req.query.priority;
    if (req.query.apt) filter.apt = req.query.apt;
    const list = await MR.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /staff/api/maintenance/:id — تحديث الحالة / المسؤول
router.put('/api/maintenance/:id', reqStaff, async (req, res) => {
  try {
    if (!hasMaintenance(req)) return res.status(403).json({ error: 'غير مصرح' });
    const MR = require('../models/MaintenanceRequest');
    const { status, assignedTo, notes } = req.body;
    const upd = { updatedAt: new Date() };
    if (status)     upd.status     = status;
    if (assignedTo !== undefined) upd.assignedTo = assignedTo;
    if (notes      !== undefined) upd.notes      = notes;
    await MR.findByIdAndUpdate(req.params.id, upd);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// CRON: Auto-sync all channel listings every hour
// GET /staff/api/cron/channel-sync  (called by Vercel cron)
// ══════════════════════════════════════════════════════════
router.get('/api/cron/channel-sync', async (req, res) => {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const ChannelListing = require('../models/ChannelListing');
    const ChannelConfig  = require('../models/ChannelConfig');
    const Booking        = require('../models/Booking');
    const { sendEmail }  = require('../utils/mailer');

    const listings = await ChannelListing.find({
      enabled: true,
      icalImport: { $exists: true, $ne: '' },
    });

    let totalNew = 0, totalErr = 0, synced = 0;

    for (const lst of listings) {
      let icalText;
      try { icalText = await fetchUrl(lst.icalImport); }
      catch(e) {
        lst.lastSync = new Date(); lst.lastSyncStatus = 'error'; lst.lastSyncMsg = e.message;
        await lst.save(); totalErr++; continue;
      }

      const events = parseICal(icalText);
      let newCount = 0;

      for (const ev of events) {
        if (ev.status === 'CANCELLED') {
          await Booking.updateMany({ source: `ch-${lst.platform}-${ev.uid}` }, { status: 'cancelled' });
          continue;
        }
        const exists = await Booking.findOne({ source: `ch-${lst.platform}-${ev.uid}` }).lean();
        if (exists) continue;

        const nights = ev.dtEnd && ev.dtStart ? Math.round((ev.dtEnd - ev.dtStart) / 86400000) : undefined;
        await new Booking({
          building: lst.building, apt: lst.apt,
          propertyId: lst.propertyId || null,
          name: ev.summary.replace(/BLOCKED\s*[-—]?\s*/i, '').trim() || 'حجز خارجي',
          phone: `ch-${lst.platform}-${Date.now()}`,
          bookingType: 'daily',
          checkIn: ev.dtStart, checkOut: ev.dtEnd, nights,
          status: 'awaiting_checkin',
          source: `ch-${lst.platform}-${ev.uid}`,
          notes: `مستورد تلقائياً من ${PLATFORM_LABELS[lst.platform]}`,
        }).save();
        newCount++; totalNew++;

        const cfgFilter = lst.propertyId
          ? { propertyId: lst.propertyId, platform: lst.platform }
          : { building: lst.building, propertyId: null, platform: lst.platform };
        const cfg = await ChannelConfig.findOne(cfgFilter).lean();
        const notifyTo = (cfg && cfg.notifyEmail) || process.env.NOTIFY_EMAIL || '';
        if (notifyTo) {
          sendEmail({
            to: notifyTo,
            subject: `حجز جديد من ${PLATFORM_LABELS[lst.platform]} — ${lst.building} شقة ${lst.apt}`,
            html: channelBookingEmail({
              platform: lst.platform, apt: lst.apt, building: lst.building,
              name: ev.summary.replace(/BLOCKED/i, '').trim() || 'حجز خارجي',
              checkIn: ev.dtStart, checkOut: ev.dtEnd, nights,
            }),
          }).catch(() => {});
        }
      }

      lst.lastSync = new Date(); lst.lastSyncStatus = 'ok';
      lst.lastSyncMsg = `${events.length} حدث، ${newCount} جديد`;
      lst.lastEventCount = events.length;
      await lst.save(); synced++;
    }

    console.log(`[channel-sync] synced=${synced} err=${totalErr} new=${totalNew}`);
    res.json({ success: true, synced, totalNew, totalErr });
  } catch(e) {
    console.error('[channel-sync] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Staff router error handler — shows real error instead of generic message ──
router.use((err, req, res, _next) => {
  console.error('[Staff Error]', req.method, req.path, err.message, err.stack?.split('\n')[1] || '');
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'خطأ غير معروف', path: req.path });
});

module.exports = router;

