require('dotenv').config();
const mongoose = require('mongoose');
const Booking  = require('../models/Booking');
const Guest    = require('../models/Guest');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000, connectTimeoutMS: 20000,
    family: 4, tls: true, tlsAllowInvalidCertificates: false,
  });
  console.log('✅ متصل\n');

  const filter = { building: 'جوان ان' };

  // ── إحصائيات عامة ──────────────────────────────────────────
  const total   = await Booking.countDocuments(filter);
  const batch1  = await Booking.countDocuments({ ...filter, source: /^nazeel-jouan-0[01]\d{3}$/ });
  const batch2  = await Booking.countDocuments({ ...filter, source: /^nazeel-jouan-0[23]\d{3}$/ });
  const daily   = await Booking.countDocuments({ ...filter, bookingType: 'daily' });
  const annual  = await Booking.countDocuments({ ...filter, bookingType: 'annual' });

  console.log('═══════════════════════════════════════════');
  console.log(`📦 إجمالي حجوزات جوان ان  : ${total.toLocaleString('ar')}`);
  console.log(`   دفعة 1 (01–01890)       : ${batch1.toLocaleString('ar')}`);
  console.log(`   دفعة 2 (01891–03924)    : ${batch2.toLocaleString('ar')}`);
  console.log(`   يومي                    : ${daily.toLocaleString('ar')}`);
  console.log(`   شهري (annual)           : ${annual.toLocaleString('ar')}`);
  console.log('───────────────────────────────────────────');

  // ── التحقق من الحقول المفقودة ────────────────────────────
  const missingApt      = await Booking.countDocuments({ ...filter, $or: [{ apt: '' }, { apt: null }] });
  const missingName     = await Booking.countDocuments({ ...filter, $or: [{ name: '' }, { name: null }] });
  const missingCheckIn  = await Booking.countDocuments({ ...filter, checkIn: null });
  const missingCheckOut = await Booking.countDocuments({ ...filter, checkOut: null });
  const missingTotal    = await Booking.countDocuments({ ...filter, totalPrice: { $lte: 0 } });
  const zeroNights      = await Booking.countDocuments({ ...filter, nights: { $lte: 0 } });

  console.log(`🏠 بدون رقم شقة           : ${missingApt}`);
  console.log(`👤 بدون اسم               : ${missingName}`);
  console.log(`📅 بدون تاريخ دخول        : ${missingCheckIn}`);
  console.log(`📅 بدون تاريخ خروج        : ${missingCheckOut}`);
  console.log(`💰 مجموع صفري/سالب        : ${missingTotal}`);
  console.log(`🌙 ليالٍ صفر              : ${zeroNights}`);
  console.log('───────────────────────────────────────────');

  // ── التحقق من الحالات ────────────────────────────────────
  const statuses = await Booking.aggregate([
    { $match: filter },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  console.log('📊 توزيع الحالات:');
  statuses.forEach(s => console.log(`   ${s._id.padEnd(20)} : ${s.count}`));
  console.log('───────────────────────────────────────────');

  // ── فحص تسلسل أرقام الحجوزات ────────────────────────────
  const allSources = await Booking.find(filter, 'source').lean();
  const nums = allSources
    .map(b => parseInt(b.source?.replace('nazeel-jouan-', '') || '0'))
    .filter(n => n > 0)
    .sort((a, b) => a - b);

  const gaps = [];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] - nums[i-1] > 1) {
      gaps.push(`${nums[i-1]+1}–${nums[i]-1}`);
    }
  }
  console.log(`🔢 نطاق الأرقام: ${nums[0]} ← → ${nums[nums.length-1]}`);
  console.log(`🕳️  فجوات في التسلسل      : ${gaps.length === 0 ? 'لا يوجد ✅' : gaps.join(', ')}`);
  console.log('───────────────────────────────────────────');

  // ── عينات من الدفعة الثانية ──────────────────────────────
  const samples = await Booking.find({ ...filter, bookingType: 'annual' })
    .sort({ checkIn: -1 }).limit(3).lean();
  console.log('\n📋 عينة حجوزات شهرية (annual):');
  samples.forEach(b => {
    console.log(`   ${b.source} | ${b.name} | ${b.apt} | ${b.checkIn?.toISOString().slice(0,10)} → ${b.checkOut?.toISOString().slice(0,10)} | مدفوع: ${b.paidAmount}`);
  });

  // ── عملاء بدون جوال ──────────────────────────────────────
  const noPhone = await Guest.countDocuments({ building: 'جوان ان', phone: /^nophone-/ });
  console.log(`\n📵 عملاء بدون جوال حقيقي  : ${noPhone}`);
  console.log('═══════════════════════════════════════════');

  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
