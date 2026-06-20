// استيراد الدفعة الثانية من حجوزات جوان ان (01891-03924)
// صيغة نزيل الجديدة: paid = ap[9] (بعد إضافة أعمدة الضرائب والتأمين)
require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const Booking  = require('../models/Booking');
const Guest    = require('../models/Guest');

const RAW_FILE = path.join(__dirname, 'jouan-bookings-batch2-raw.tsv');
const BUILDING = 'جوان ان';
const PROGRESS = path.join(__dirname, 'jouan-batch2-progress.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ensureConnected() {
  if (mongoose.connection.readyState === 1) return;
  try { await mongoose.disconnect(); } catch (_) {}
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000, connectTimeoutMS: 20000,
    family: 4, tls: true, tlsAllowInvalidCertificates: false,
  });
}

function parseDate(str) {
  const [d, m, y] = str.split('/');
  return new Date(`${y}-${m}-${d}T12:00:00.000Z`);
}

function mapStatus(nazStatus) {
  if (nazStatus === 'مغلق') return 'checkout';
  if (nazStatus === 'ملغي') return 'cancelled';
  if (nazStatus === 'دخول') return 'active';
  if (nazStatus === 'مقيم') return 'active';
  return 'checkout';
}

function mapBookingType(rateType) {
  if (rateType === 'شهري') return 'annual';
  return 'daily'; // يومي وغيره
}

function parseLine(l) {
  // البحث عن أول تاريخ DD/MM/YYYY كمرساة
  const dateMatch = l.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (!dateMatch) return null;
  const dateIdx = l.indexOf(dateMatch[0]);
  const before = l.slice(0, dateIdx).trimEnd();
  const after  = l.slice(dateIdx);

  // after: checkIn  checkOut  rateType  duration  dayRate  amount  taxes  total  deposit  paid  credit  debit
  const ap = after.split(/\s+/).filter(Boolean);
  if (ap.length < 10) return null;

  // before: bookingNum  status  apt  guestName
  const bp = before.split(/\s{4,}/);
  if (bp.length < 4) return null;

  return {
    bookingNum:  bp[0].trim(),
    status:      bp[1].trim(),
    aptNum:      (bp[2].trim().match(/^(\d{3})/) || [])[1] || '',
    guestName:   bp.slice(3).join(' ').trim(),
    checkIn:     parseDate(ap[0]),
    checkOut:    parseDate(ap[1]),
    rateType:    ap[2],
    nights:      parseFloat(ap[3]) || 1,
    dayRate:     parseFloat(ap[4]) || 0,
    total:       parseFloat(ap[7]) || 0,
    paid:        parseFloat(ap[9]) || 0,
  };
}

async function findOrCreateGuest(name) {
  await ensureConnected();
  let guest = await Guest.findOne({ name, building: BUILDING, propertyId: null });
  if (guest) return guest;
  const uniquePhone = `nophone-booking-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  try {
    guest = await Guest.create({
      name, phone: uniquePhone, building: BUILDING, propertyId: null,
      idType: '', idNumber: '', category: 'regular',
      totalBookings: 0, lastSeen: new Date(), email: '',
    });
  } catch (e) {
    if (e.code === 11000) {
      const p2 = `nophone-booking-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
      guest = await Guest.create({
        name, phone: p2, building: BUILDING, propertyId: null,
        idType: '', idNumber: '', category: 'regular',
        totalBookings: 0, lastSeen: new Date(), email: '',
      });
    } else throw e;
  }
  return guest;
}

async function importBooking(r, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await ensureConnected();
      const srcKey = `nazeel-jouan-${r.bookingNum}`;
      const existing = await Booking.findOne({ source: srcKey });
      if (existing) return 'skip';

      const guest = await findOrCreateGuest(r.guestName);

      await Booking.create({
        building:      BUILDING,
        apt:           r.aptNum,
        name:          r.guestName,
        phone:         guest.phone,
        bookingType:   mapBookingType(r.rateType),
        status:        mapStatus(r.status),
        checkIn:       r.checkIn,
        checkOut:      r.checkOut,
        nights:        r.nights,
        pricePerNight: r.dayRate,
        totalPrice:    r.total,
        paidAmount:    r.paid,
        source:        srcKey,
        propertyId:    null,
        email:         '',
        idType:        '',
        paymentMethod: r.paid > 0 ? 'cash' : '',
        guests:        1,
      });
      return 'added';
    } catch (e) {
      const isNet = ['ECONNRESET','ENOTFOUND','ETIMEDOUT','ECONNREFUSED'].some(x => e.message?.includes(x));
      if (isNet && attempt < retries) {
        await sleep(attempt * 3000);
        continue;
      }
      throw e;
    }
  }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000, connectTimeoutMS: 20000,
    family: 4, tls: true, tlsAllowInvalidCertificates: false,
  });
  console.log('✅ متصل بقاعدة البيانات\n');

  const raw = fs.readFileSync(RAW_FILE, 'utf8');
  const rawLines = raw.split('\n').map(l => l.trim()).filter(l => l.match(/^\d{5}\s/));

  const seen = new Set();
  const bookings = [];
  let parseErrors = 0;
  for (const l of rawLines) {
    const r = parseLine(l);
    if (r && r.aptNum && r.guestName && !seen.has(r.bookingNum)) {
      seen.add(r.bookingNum);
      bookings.push(r);
    } else if (!r) {
      parseErrors++;
    }
  }
  bookings.sort((a, b) => parseInt(a.bookingNum) - parseInt(b.bookingNum));

  console.log(`📋 إجمالي الحجوزات الفريدة : ${bookings.length}`);
  console.log(`⚠️  سطور لم تُحلَّل          : ${parseErrors}\n`);

  // إحصائيات أنواع الإيجار
  const monthly = bookings.filter(b => b.rateType === 'شهري').length;
  const daily   = bookings.filter(b => b.rateType === 'يومي').length;
  console.log(`   يومي : ${daily} | شهري : ${monthly}\n`);

  let startIdx = 0;
  let added = 0, skipped = 0, errors = 0;
  if (fs.existsSync(PROGRESS)) {
    try {
      const p = JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
      startIdx = p.nextIdx || 0;
      added = p.added || 0; skipped = p.skipped || 0; errors = p.errors || 0;
      console.log(`📋 استكمال من الحجز رقم ${startIdx}\n`);
    } catch (_) {}
  }

  const BATCH = 5;
  for (let i = startIdx; i < bookings.length; i += BATCH) {
    const chunk = bookings.slice(i, i + BATCH);
    const results = await Promise.allSettled(chunk.map(r => importBooking(r)));

    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      if (res.status === 'fulfilled') {
        if (res.value === 'added') added++;
        else skipped++;
      } else {
        errors++;
        console.error(`\n  ⚠️ ${chunk[j].bookingNum} (${chunk[j].guestName}) — ${res.reason?.message}`);
      }
    }

    if ((i + BATCH) % 50 < BATCH) {
      const pct = Math.round(((i + BATCH) / bookings.length) * 100);
      process.stdout.write(`\r📊 ${i + Math.min(BATCH, bookings.length - i)}/${bookings.length} (${pct}%) — إضافة: ${added} | تخطي: ${skipped} | أخطاء: ${errors}`);
    }

    fs.writeFileSync(PROGRESS, JSON.stringify({ nextIdx: i + BATCH, added, skipped, errors }));
  }

  if (fs.existsSync(PROGRESS)) fs.unlinkSync(PROGRESS);

  console.log(`\n\n🎉 اكتمل الاستيراد!`);
  console.log(`   ✅ إضافة جديدة : ${added}`);
  console.log(`   ⏭️  تخطي موجود  : ${skipped}`);
  console.log(`   ❌ أخطاء        : ${errors}`);
  console.log(`   📦 المجموع      : ${added + skipped}`);

  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
