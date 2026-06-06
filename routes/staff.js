const express = require('express');
const router = express.Router();
const { createToken, verifyToken } = require('../utils/auth');
const Property = require('../models/Property');
const WA = require('../utils/whatsapp');

const COOKIE = 'fs_staff';
const COPTS  = { httpOnly: true, maxAge: 12 * 60 * 60 * 1000, sameSite: 'lax' };

// Hardcoded buildings for BAREZ internal (propertyId === null)
const BLDGS = {
  'المنارا':  { floors: [{l:'أرضي',r:['001','002']},{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204','205','206']},{l:'الثالث',r:['301','302','303','304','305','306']},{l:'الرابع',r:['401','402','403','404','405','406']},{l:'الخامس',r:['501','502','503','504']}] },
  'جوان ان': { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105']},{l:'الثاني',r:['201','202','203','204','205']},{l:'الثالث',r:['301','302','303','304','305','306']},{l:'الرابع',r:['401','402']}] },
  'الماسة':  { floors: [{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204','205','206']},{l:'الثالث',r:['301','302','303','304','305','306']}] },
  'الواحة':  { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105','106','107','108']},{l:'الثاني',r:['201','202','203','204','205','206','207','208']}] },
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

const totalApts = b => (BLDGS[b]?.floors||[]).reduce((s,f)=>s+f.r.length,0);

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
const DEFAULT_PERMS=['dashboard','apartments','bookings','customers','housekeeping','activity','new_booking','edit_booking','cancel_booking','vouchers','reports','guests'];

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

// ── Auth ─────────────────────────────────────────────────
router.get('/login',(req,res)=>{ if(req.staff)return res.redirect('/staff/dashboard'); res.render('staff-login',{error:null,query:req.query}); });

router.post('/login', async (req,res) => {
  try {
    const S = require('../models/StaffUser');
    const u = await S.findOne({ username:(req.body.username||'').trim(), active:true });
    if (!u||!(await u.comparePassword(req.body.password))) return res.render('staff-login',{error:'اسم المستخدم أو كلمة المرور غير صحيحة'});
    const perms = u.permissions?.length ? [...new Set([...u.permissions, ...DEFAULT_PERMS])] : DEFAULT_PERMS;
    let planExpiry = null;
    if (u.propertyId) {
      const prop = await Property.findById(u.propertyId).select('planExpiry active').lean();
      if (!prop || !prop.active) return res.render('staff-login', { error: 'هذا الحساب موقوف. تواصل مع الإدارة.' });
      planExpiry = prop?.planExpiry || null;
    }
    res.cookie(COOKIE, createToken({id:u._id,name:u.name,building:u.building,role:u.role,permissions:perms,propertyId:u.propertyId||null,planExpiry}), COPTS);
    res.redirect('/staff/dashboard');
  } catch(e){ res.render('staff-login',{error:'حدث خطأ'}); }
});

router.get('/logout',(req,res)=>{ res.clearCookie(COOKIE); res.redirect('/staff/login'); });
router.get('/dashboard', reqStaff, (req,res) => { res.setHeader('Cache-Control','no-store'); res.render('staff-dashboard',{staff:req.staff}); });

// ── API: Stats ────────────────────────────────────────────
router.get('/api/stats', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const bld = req.staff.building;
    const today = new Date(); today.setHours(0,0,0,0);
    const tom   = new Date(today); tom.setDate(today.getDate()+1);

    const all = await B.find({ building:bld, status:{$nin:['cancelled']} }).lean();
    const active      = all.filter(b=>b.status==='active');
    const arrivals    = all.filter(b=>{ const c=b.checkIn?new Date(b.checkIn):null; return c&&c>=today&&c<tom&&['awaiting_checkin','active'].includes(b.status); });
    const departures  = all.filter(b=>{ const c=b.checkOut?new Date(b.checkOut):null; return c&&c>=today&&c<tom&&b.status==='active'; });
    const newBk       = all.filter(b=>['pending','awaiting_payment'].includes(b.status));
    const { bldgs: bldgsForStats } = await getBldgConfig(req.staff);
    const total       = totalAptsFromConfig(bldgsForStats, bld);
    const rate        = total?Math.round(active.length/total*100):0;

    const weekly = [];
    for (let i=6;i>=0;i--) {
      const d=new Date(today); d.setDate(today.getDate()-i);
      const nd=new Date(d); nd.setDate(d.getDate()+1);
      const occ = all.filter(b=>{ if(!b.checkIn||!b.checkOut)return false; return new Date(b.checkIn)<nd&&new Date(b.checkOut)>d&&['active','checkout','awaiting_checkin'].includes(b.status); }).length;
      weekly.push({ label:d.toLocaleDateString('ar-SA',{weekday:'short',day:'numeric',month:'numeric'}), occupied:occ, total });
    }
    res.json({ arrivals:arrivals.length, departures:departures.length, currentGuests:active.length, newBookings:newBk.length, occupancyRate:rate, occupied:active.length, total, weekly });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Apartments ───────────────────────────────────────
router.get('/api/apartments', reqStaff, async (req,res) => {
  try {
    const B  = require('../models/Booking');
    const HK = require('../models/HousekeepingTask');
    const bld = req.staff.building;
    const bData = BLDGS[bld]; if(!bData) return res.status(404).json({error:'المبنى غير موجود'});

    const today=new Date(); today.setHours(0,0,0,0);
    const tom=new Date(today); tom.setDate(today.getDate()+1);

    const L = require('../models/Listing');
    const bookings = await B.find({ building:bld, status:{$in:['awaiting_payment','awaiting_checkin','active']} }).lean();
    const hkTasks  = await HK.find({ building:bld }).lean();
    const listings = await L.find({ building:bld }).select('apt title bedrooms').lean();
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
        return { apt, status, housekeeping:hk?.status||'clean', bookingId:b?._id||null, name:b?.name||'', phone:b?.phone||'', checkIn:b?.checkIn||null, checkOut:b?.checkOut||null, nights:b?.nights||0, totalPrice:b?.totalPrice||0, paidAmount:b?.paidAmount||0, idType:b?.idType||'', idNumber:b?.idNumber||'', bookingType:b?.bookingType||'', notes:hk?.notes||'', roomType:l?.title||'', bedrooms:l?.bedrooms||0 };
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

    let list = await B.find(filter).sort({createdAt:-1}).limit(300).lean();

    const qs = q.trim();
    if (qs) list = list.filter(b => b.name?.includes(qs)||b.phone?.includes(qs)||b.apt?.includes(qs));
    if (booking_num.trim()) list = list.filter(b => b._id.toString().slice(-5).toUpperCase()===booking_num.trim().toUpperCase());

    res.json(list.map(b=>({
      bookingNum: b._id.toString().slice(-5).toUpperCase(),
      name: b.name, phone: b.phone, apt: b.apt,
      checkIn: b.checkIn, checkOut: b.checkOut,
      status: b.status, bookingType: b.bookingType,
      totalPrice: b.totalPrice, paidAmount: b.paidAmount||0,
      source: b.source||'', bookingId: b._id,
      _id: b._id,
    })));
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.put('/api/bookings/:id/status', reqStaff, async (req,res) => {
  try {
    const B=require('../models/Booking'), L=require('../models/Listing'), AL=require('../models/ActivityLog');
    const bk = await B.findOne({_id:req.params.id,building:req.staff.building}).lean();
    if(!bk) return res.status(404).json({error:'الحجز غير موجود'});
    const {status}=req.body, prev=bk.status;
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
    AL.create({building:req.staff.building,staffName:req.staff.name,action:status==='active'?'check_in':status==='checkout'?'check_out':'status_change',apt:bk.apt,guestName:bk.name,bookingId:bk._id,details:`${prev} → ${status}`}).catch(()=>{});
    if (status === 'active')   WA.sendCheckIn(bk.phone, bk.name, req.staff.building, bk.apt);
    if (status === 'checkout') WA.sendCheckOut(bk.phone, bk.name, bk.apt);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Get Single Booking ───────────────────────────────
router.get('/api/bookings/:id', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const bk = await B.findOne({_id:req.params.id, building:req.staff.building}).lean();
    if(!bk) return res.status(404).json({error:'الحجز غير موجود'});
    res.json(bk);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Edit Booking ─────────────────────────────────────
router.put('/api/bookings/:id/edit', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const AL = require('../models/ActivityLog');
    const bk = await B.findOne({_id:req.params.id, building:req.staff.building});
    if(!bk) return res.status(404).json({error:'الحجز غير موجود'});
    const { name, phone, checkIn, checkOut, months, pricePerUnit, totalPrice, paidAmount, idType, idNumber, status, notes } = req.body;

    let nights = bk.nights, checkout = checkOut || bk.checkOut;
    if(bk.bookingType==='daily' && checkIn && checkOut)
      nights = Math.round((new Date(checkOut)-new Date(checkIn))/86400000);
    else if(bk.bookingType==='annual' && checkIn && months){
      const d = new Date(checkIn); d.setMonth(d.getMonth()+(parseInt(months)||1));
      checkout = d.toISOString().split('T')[0];
      nights = (parseInt(months)||1)*30;
    }

    await B.findByIdAndUpdate(bk._id, {
      name: name||bk.name, phone: phone||bk.phone,
      checkIn: checkIn?new Date(checkIn):bk.checkIn,
      checkOut: checkout?new Date(checkout):bk.checkOut,
      nights, totalPrice: parseFloat(totalPrice)||bk.totalPrice,
      paidAmount: parseFloat(paidAmount)||0,
      idType: idType||bk.idType, idNumber: idNumber||bk.idNumber,
      status: status||bk.status, notes: notes||bk.notes,
    });
    AL.create({building:req.staff.building,staffName:req.staff.name,action:'status_change',apt:bk.apt,guestName:name||bk.name,bookingId:bk._id,details:'تعديل الحجز'}).catch(()=>{});
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: New Manual Booking ───────────────────────────────
router.post('/api/bookings/new', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const AL = require('../models/ActivityLog');
    const { apt, name, phone, bookingType, checkIn, checkOut, months, pricePerUnit, totalPrice, paidAmount, idType, idNumber, status, notes } = req.body;
    if(!apt||!name||!phone||!bookingType||!checkIn||!totalPrice)
      return res.status(400).json({error:'جميع الحقول المطلوبة غير مكتملة'});

    let nights = 0, checkout = checkOut;
    if(bookingType==='daily' && checkIn && checkOut){
      nights = Math.round((new Date(checkOut)-new Date(checkIn))/86400000);
    } else if(bookingType==='annual' && checkIn && months){
      const d = new Date(checkIn); d.setMonth(d.getMonth()+(parseInt(months)||1));
      checkout = d.toISOString().split('T')[0];
      nights = (parseInt(months)||1)*30;
    }

    const bk = await new B({
      building: req.staff.building,
      apt,
      name,
      phone,
      bookingType,
      checkIn: new Date(checkIn),
      checkOut: checkout ? new Date(checkout) : undefined,
      nights,
      pricePerNight: bookingType==='daily' ? pricePerUnit : undefined,
      pricePerMonth: bookingType==='annual' ? pricePerUnit : undefined,
      totalPrice: parseFloat(totalPrice)||0,
      paidAmount: parseFloat(paidAmount)||0,
      idType: idType||'',
      idNumber: idNumber||'',
      status: status||'awaiting_checkin',
      notes: notes||'',
      source: 'manual',
      propertyId: req.staff.propertyId || null,
    }).save();

    AL.create({building:req.staff.building,staffName:req.staff.name,action:'booking_add',apt,guestName:name,bookingId:bk._id,details:'حجز يدوي',propertyId:req.staff.propertyId||null}).catch(()=>{});
    // Upsert guest record
    const Guest = require('../models/Guest');
    Guest.findOneAndUpdate(
      { phone, propertyId: req.staff.propertyId || null },
      { name, idType: idType||'', idNumber: idNumber||'', building: req.staff.building, lastSeen: new Date(), $inc: { totalBookings: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).catch(() => {});
    // WhatsApp booking confirmation
    WA.sendBookingConfirmed(phone, name, apt, req.staff.building, bk.checkIn, bk.checkOut, bk.totalPrice);
    res.json({success:true, id:bk._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Customers ────────────────────────────────────────
router.get('/api/customers', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const { q='', sf='open', apt='', booking_type='', date_from='', date_to='', booking_num='' } = req.query;
    const filter = buildBookingFilter(req.staff, { sf, apt, booking_type, date_from, date_to });

    let bookings = await B.find(filter).sort({ createdAt:-1 }).limit(200).lean();

    // Text search
    const qs = q.trim();
    if (qs) bookings = bookings.filter(b =>
      b.name?.includes(qs) || b.phone?.includes(qs) || b.apt?.includes(qs) || b._id.toString().endsWith(qs)
    );
    // Booking number search
    if (booking_num.trim()) bookings = bookings.filter(b => b._id.toString().slice(-5) === booking_num.trim());

    const out = bookings.map(b => ({
      bookingNum: b._id.toString().slice(-5).toUpperCase(),
      name: b.name, phone: b.phone, apt: b.apt,
      checkIn: b.checkIn, checkOut: b.checkOut,
      status: b.status, bookingType: b.bookingType,
      totalPrice: b.totalPrice, paidAmount: b.paidAmount||0,
      source: b.source||'', bookingId: b._id,
      idType: b.idType||'', idNumber: b.idNumber||'',
    }));
    res.json(out);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Room Info ────────────────────────────────────────
router.get('/api/room-info', reqStaff, async (req,res) => {
  try {
    const RI = require('../models/RoomInfo');
    const rows = await RI.find({ building: req.staff.building }).lean();
    const map = {};
    rows.forEach(r => { map[r.apt] = { roomType: r.roomType, beds: r.beds }; });
    res.json(map);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.put('/api/room-info/:apt', reqStaff, async (req,res) => {
  try {
    const perms = req.staff.permissions||[];
    if(!perms.includes('edit_room_info')) return res.status(403).json({error:'ليس لديك صلاحية'});
    const RI = require('../models/RoomInfo');
    const { roomType='', beds='' } = req.body;
    await RI.findOneAndUpdate(
      { building: req.staff.building, apt: req.params.apt },
      { roomType, beds },
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

// ── API: Activity Log ─────────────────────────────────────
router.get('/api/activity', reqStaff, async (req,res) => {
  try {
    const AL = require('../models/ActivityLog');
    const alFilter = req.staff.propertyId ? { propertyId: req.staff.propertyId } : { building: req.staff.building, propertyId: null };
    const logs = await AL.find(alFilter).sort({createdAt:-1}).limit(100).lean();
    res.json(logs);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Vouchers ─────────────────────────────────────────
router.get('/api/vouchers', reqStaff, async (req,res) => {
  try {
    const V = require('../models/Voucher');
    const filter = req.staff.propertyId ? { propertyId: req.staff.propertyId } : { building: req.staff.building, propertyId: null };
    if(req.query.type) filter.type = req.query.type;
    const list = await V.find(filter).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.post('/api/vouchers', reqStaff, async (req,res) => {
  try {
    const V = require('../models/Voucher');
    const { type, date, name, phone, apt, amount, description, notes, checkNumber, bankName, dueDate, bookingId } = req.body;
    if(!type||!amount) return res.status(400).json({error:'نوع الوثيقة والمبلغ مطلوبان'});
    const pid = req.staff.propertyId || null;
    const count = await V.countDocuments({ building: req.staff.building, type, propertyId: pid });
    const prefixes = { receipt:'QBD', invoice:'INV', disbursement:'SRF', check:'KMB', tax:'ZRB' };
    const number = (prefixes[type]||'DOC') + '-' + String(count+1).padStart(4,'0');
    const v = await new V({ building:req.staff.building, type, number, date:date?new Date(date):new Date(), name, phone, apt, amount:parseFloat(amount)||0, description, notes, checkNumber, bankName, dueDate:dueDate?new Date(dueDate):undefined, bookingId:bookingId||undefined, createdBy:req.staff.name, propertyId:pid }).save();
    res.json({ success:true, id:v._id, number:v.number });
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.delete('/api/vouchers/:id', reqStaff, async (req,res) => {
  try {
    const V = require('../models/Voucher');
    const vFilter = req.staff.propertyId ? { _id:req.params.id, propertyId:req.staff.propertyId } : { _id:req.params.id, building:req.staff.building };
    await V.findOneAndDelete(vFilter);
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

    const [allMonth, allActive, allDebtsRaw] = await Promise.all([
      B.find({ building: bld, checkIn: { $gte: monthStart, $lt: nextMonth }, status: { $ne: 'cancelled' } }).lean(),
      B.find({ building: bld, status: 'active' }).lean(),
      B.find({ building: bld, status: { $nin: ['cancelled','checkout'] }, totalPrice: { $gt: 0 } }).lean(),
    ]);

    const todayBk = allMonth.filter(b => { const d = new Date(b.checkIn); return d >= today && d < tomorrow; });
    const departuresToday = allActive.filter(b => { const d = b.checkOut ? new Date(b.checkOut) : null; return d && d >= today && d < tomorrow; });

    const monthRevenue   = allMonth.reduce((s,b) => s + (b.totalPrice||0), 0);
    const monthPaid      = allMonth.reduce((s,b) => s + (b.paidAmount||0), 0);
    const monthRemaining = monthRevenue - monthPaid;
    const daily  = allMonth.filter(b => b.bookingType === 'daily');
    const annual = allMonth.filter(b => b.bookingType === 'annual');

    const dailyChart = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const d  = new Date(selYear, selMonth, i);
      const nd = new Date(selYear, selMonth, i + 1);
      const rev = allMonth.filter(b => { const bd = new Date(b.checkIn); return bd >= d && bd < nd; }).reduce((s,b) => s + (b.totalPrice||0), 0);
      dailyChart.push({ label: d.toLocaleDateString('ar-SA', { day:'numeric', month:'short' }), revenue: rev });
    }

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

// ── Yearly Revenue Chart ─────────────────────────────────
router.get('/api/reports/yearly', reqStaff, async (req, res) => {
  try {
    const B = require('../models/Booking');
    const now = new Date();
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const baseFilter = req.staff.propertyId
      ? { propertyId: req.staff.propertyId }
      : { building: req.staff.building, propertyId: null };

    const bookings = await B.find({
      ...baseFilter,
      checkIn: { $gte: yearAgo },
      status: { $ne: 'cancelled' },
    }, 'checkIn totalPrice bookingType').lean();

    const months = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end   = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const mBk   = bookings.filter(b => { const d = new Date(b.checkIn); return d >= start && d < end; });
      months.push({
        label:    start.toLocaleDateString('ar-SA', { month: 'short' }) + ' ' + String(start.getFullYear()).slice(2),
        revenue:  mBk.reduce((s, b) => s + (b.totalPrice || 0), 0),
        count:    mBk.length,
        daily:    mBk.filter(b => b.bookingType === 'daily').reduce((s, b) => s + (b.totalPrice || 0), 0),
        annual:   mBk.filter(b => b.bookingType === 'annual').reduce((s, b) => s + (b.totalPrice || 0), 0),
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

    const [bookings, { bldgs }] = await Promise.all([
      B.find({ building: bld, status: { $nin: ['cancelled'] }, checkIn: { $lte: monthEnd }, checkOut: { $gte: monthStart } }).lean(),
      getBldgConfig(req.staff),
    ]);

    const bldgData = bldgs[bld];
    const floors = bldgData ? bldgData.floors.map(f => ({ label: f.l, apts: f.r })) : [];
    const allApts = floors.flatMap(f => f.apts);

    const aptCalendar = allApts.map(apt => {
      const aptBks = bookings.filter(b => b.apt === apt);
      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dayDate = new Date(selYear, selMonth, d);
        const nextDay = new Date(selYear, selMonth, d + 1);
        const bk = aptBks.find(b => new Date(b.checkIn) < nextDay && new Date(b.checkOut) > dayDate);
        if (!bk) { days.push({ s: 'v' }); continue; }
        const cin = new Date(bk.checkIn); cin.setHours(0,0,0,0);
        const cout = new Date(bk.checkOut); cout.setHours(0,0,0,0);
        let s = 'o';
        if (cin.getTime() === dayDate.getTime()) s = 'i';
        else if (cout.getTime() === dayDate.getTime()) s = 'x';
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
    const bookings  = await B.find({ building: req.staff.building, status: 'active', checkOut: { $gte: tomorrow, $lt: dayAfter } }).lean();
    let sent = 0;
    for (const bk of bookings) {
      if (bk.phone) { await WA.sendCheckoutReminder(bk.phone, bk.name, bk.apt); sent++; }
    }
    res.json({ success: true, sent, total: bookings.length });
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

// ── Guests ────────────────────────────────────────────────
router.get('/api/guests', reqStaff, async (req, res) => {
  try {
    const Guest = require('../models/Guest');
    const { q = '' } = req.query;
    const filter = { propertyId: req.staff.propertyId || null };
    if (q.trim()) {
      const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
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

// ── Register new property ─────────────────────────────────
router.get('/register', (req, res) => {
  if (req.staff) return res.redirect('/staff/dashboard');
  res.render('staff-register', { error: null, success: false });
});

router.post('/register', async (req, res) => {
  try {
    const S = require('../models/StaffUser');
    const { propertyName, propertyType, city, adminName, username, password, password2 } = req.body;
    if (!propertyName || !adminName || !username || !password) {
      return res.render('staff-register', { error: 'جميع الحقول مطلوبة', success: false });
    }
    if (password !== password2) {
      return res.render('staff-register', { error: 'كلمتا المرور غير متطابقتين', success: false });
    }
    if (password.length < 6) {
      return res.render('staff-register', { error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل', success: false });
    }
    const exists = await S.findOne({ username: username.trim() });
    if (exists) return res.render('staff-register', { error: 'اسم المستخدم مستخدم بالفعل، اختر اسماً آخر', success: false });

    // Create property
    const prop = await new Property({
      name: propertyName.trim(),
      type: propertyType || 'apartment',
      city: city || '',
      buildings: [], // admin configures buildings later
    }).save();

    // Create manager account
    await new S({
      name: adminName.trim(),
      username: username.trim(),
      password,
      building: propertyName.trim(), // default building = property name
      role: 'manager',
      propertyId: prop._id,
      permissions: DEFAULT_PERMS,
    }).save();

    res.render('staff-register', { error: null, success: true });
  } catch(e) {
    res.render('staff-register', { error: 'حدث خطأ أثناء التسجيل، حاول مرة أخرى', success: false });
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
router.post('/api/admin/create', async (req,res) => {
  try {
    const adminToken = verifyToken(req.cookies?.fs_auth);
    if(!adminToken) return res.status(401).json({error:'غير مصرح'});
    const S = require('../models/StaffUser');
    const {name,username,password,building,role} = req.body;
    if(!name||!username||!password||!building) return res.status(400).json({error:'جميع الحقول مطلوبة'});
    const u = await new S({name,username,password,building,role:role||'receptionist'}).save();
    res.json({success:true,id:u._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.get('/api/admin/staff', async (req,res) => {
  try {
    const adminToken = verifyToken(req.cookies?.fs_auth);
    if(!adminToken) return res.status(401).json({error:'غير مصرح'});
    const S = require('../models/StaffUser');
    const list = await S.find().select('-password').sort({building:1}).lean();
    res.json(list);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.put('/api/admin/update', async (req,res) => {
  try {
    const adminToken = verifyToken(req.cookies?.fs_auth);
    if(!adminToken) return res.status(401).json({error:'غير مصرح'});
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

module.exports = router;
