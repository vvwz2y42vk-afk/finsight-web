const express = require('express');
const router = express.Router();
const { createToken, verifyToken } = require('../utils/auth');

const COOKIE = 'fs_staff';
const COPTS  = { httpOnly: true, maxAge: 12 * 60 * 60 * 1000, sameSite: 'lax' };

const BLDGS = {
  'المنارا':  { floors: [{l:'أرضي',r:['001','002']},{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204','205','206']},{l:'الثالث',r:['301','302','303','304','305','306']},{l:'الرابع',r:['401','402','403','404','405','406']},{l:'الخامس',r:['501','502','503','504']}] },
  'جوان ان': { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105']},{l:'الثاني',r:['201','202','203','204','205']},{l:'الثالث',r:['301','302','303','304','305','306']},{l:'الرابع',r:['401','402']}] },
  'الماسة':  { floors: [{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204']},{l:'الثالث',r:['301','302','303','304','305','306']}] },
  'الواحة':  { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105','106','107','108']},{l:'الثاني',r:['201','202','203','204','205','206','207','208']}] },
};
const totalApts = b => (BLDGS[b]?.floors||[]).reduce((s,f)=>s+f.r.length,0);

function staffAuth(req,res,next){ req.staff=verifyToken(req.cookies?.[COOKIE])||null; next(); }
function reqStaff(req,res,next){ if(!req.staff)return res.redirect('/staff/login'); next(); }
router.use(staffAuth);

// ── Auth ─────────────────────────────────────────────────
router.get('/login',(req,res)=>{ if(req.staff)return res.redirect('/staff/dashboard'); res.render('staff-login',{error:null}); });

router.post('/login', async (req,res) => {
  try {
    const S = require('../models/StaffUser');
    const u = await S.findOne({ username:(req.body.username||'').trim(), active:true });
    if (!u||!(await u.comparePassword(req.body.password))) return res.render('staff-login',{error:'اسم المستخدم أو كلمة المرور غير صحيحة'});
    res.cookie(COOKIE, createToken({id:u._id,name:u.name,building:u.building,role:u.role}), COPTS);
    res.redirect('/staff/dashboard');
  } catch(e){ res.render('staff-login',{error:'حدث خطأ'}); }
});

router.get('/logout',(req,res)=>{ res.clearCookie(COOKIE); res.redirect('/staff/login'); });
router.get('/dashboard', reqStaff, (req,res) => res.render('staff-dashboard',{staff:req.staff}));

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
    const total       = totalApts(bld);
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

    const bookings = await B.find({ building:bld, status:{$in:['awaiting_payment','awaiting_checkin','active']} }).lean();
    const hkTasks  = await HK.find({ building:bld }).lean();
    const bmap={}, hkmap={};
    bookings.forEach(b=>{ if(b.apt) bmap[b.apt]=b; });
    hkTasks.forEach(t=>{ hkmap[t.apt]=t; });

    const floors = bData.floors.map(f=>({
      label: f.l,
      rooms: f.r.map(apt=>{
        const b=bmap[apt], hk=hkmap[apt];
        let status='vacant';
        if(b){
          const cin=b.checkIn?new Date(b.checkIn):null, cout=b.checkOut?new Date(b.checkOut):null;
          if(b.status==='active')        status=(cout&&cout>=today&&cout<tom)?'checkout_today':'occupied';
          else if(b.status==='awaiting_checkin') status=(cin&&cin>=today&&cin<tom)?'checkin_today':'awaiting';
          else if(b.status==='awaiting_payment') status='awaiting_payment';
        }
        return { apt, status, housekeeping:hk?.status||'clean', bookingId:b?._id||null, name:b?.name||'', phone:b?.phone||'', checkIn:b?.checkIn||null, checkOut:b?.checkOut||null, nights:b?.nights||0, totalPrice:b?.totalPrice||0, paidAmount:b?.paidAmount||0, idType:b?.idType||'', idNumber:b?.idNumber||'', bookingType:b?.bookingType||'', notes:hk?.notes||'' };
      }),
    }));
    res.json({ building:bld, floors });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Bookings ─────────────────────────────────────────
router.get('/api/bookings', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const filter = { building:req.staff.building };
    if(req.query.status&&req.query.status!=='all') filter.status=req.query.status;
    const list = await B.find(filter).sort({createdAt:-1}).lean();
    res.json(list);
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
    }).save();

    AL.create({building:req.staff.building,staffName:req.staff.name,action:'booking_add',apt,guestName:name,bookingId:bk._id,details:'حجز يدوي'}).catch(()=>{});
    res.json({success:true, id:bk._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Customers ────────────────────────────────────────
router.get('/api/customers', reqStaff, async (req,res) => {
  try {
    const B = require('../models/Booking');
    const q = (req.query.q||'').trim();
    const all = await B.find({building:req.staff.building,status:{$nin:['cancelled']}}).sort({createdAt:-1}).lean();
    const seen=new Set(), out=[];
    all.forEach(b=>{
      if(!b.phone||seen.has(b.phone)) return;
      if(q&&!b.name?.includes(q)&&!b.phone?.includes(q)&&!b.apt?.includes(q)) return;
      seen.add(b.phone);
      out.push({name:b.name,phone:b.phone,apt:b.apt,checkIn:b.checkIn,checkOut:b.checkOut,status:b.status,bookingType:b.bookingType,totalPrice:b.totalPrice,bookingId:b._id});
    });
    res.json(out);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Housekeeping ─────────────────────────────────────
router.get('/api/housekeeping', reqStaff, async (req,res) => {
  try {
    const HK = require('../models/HousekeepingTask');
    const bld = req.staff.building;
    const tasks = await HK.find({building:bld}).lean();
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
    await HK.findOneAndUpdate({building:req.staff.building,apt:req.params.apt},{status,notes:notes||'',updatedBy:req.staff.name,building:req.staff.building,apt:req.params.apt},{upsert:true,new:true});
    AL.create({building:req.staff.building,staffName:req.staff.name,action:'housekeeping',apt:req.params.apt,details:status}).catch(()=>{});
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── API: Activity Log ─────────────────────────────────────
router.get('/api/activity', reqStaff, async (req,res) => {
  try {
    const AL = require('../models/ActivityLog');
    const logs = await AL.find({building:req.staff.building}).sort({createdAt:-1}).limit(100).lean();
    res.json(logs);
  } catch(e){ res.status(500).json({error:e.message}); }
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

module.exports = router;
