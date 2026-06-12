require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const Booking  = require('../models/Booking');

const DATA_FILE = process.argv[2] || 'C:/Users/عبدالملك/nazeel_data.txt';
const BUILDING  = process.argv[3] || 'المنارا';

function parseDate(val) {
  const s = String(val || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  return null;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000, family: 4, tls: true, tlsAllowInvalidCertificates: false,
  });
  console.log('✅ MongoDB متصل');

  const raw   = fs.readFileSync(DATA_FILE, 'utf8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  let created = 0, skipped = 0, errors = [];

  for (const line of lines) {
    const cols = line.split('    ').map(c => c.trim());

    const bookingNum = cols[0];
    if (!/^\d+$/.test(bookingNum)) continue; // تجاهل footer مثل "الدفعى الاولى"

    const nazeelSt = cols[1] || '';
    const aptRaw   = cols[2] || '';
    const name     = cols[3] || '';
    const checkIn  = parseDate(cols[4]);
    const checkOut = parseDate(cols[5]);
    const typeRaw  = cols[6] || 'يومي';
    const nights   = parseInt(cols[7]) || undefined;
    const ppn      = parseFloat(cols[8]) || 0;
    const total    = parseFloat(String(cols[9]  || '0').replace(/,/g, '')) || 0;
    const paid     = parseFloat(String(cols[13] || '0').replace(/,/g, '')) || 0;

    if (!name || !checkIn) { skipped++; continue; }

    const apt    = aptRaw.split(' ')[0]; // "104" من "104 غرفة+صالة+مطبخ"
    const bkType = (typeRaw.includes('شهري') || typeRaw.includes('سنوي')) ? 'annual' : 'daily';
    const phone  = `nzl-${bookingNum}`;
    const noteId = `نزيل#${bookingNum}`;

    const exists = await Booking.findOne({ notes: noteId }).lean();
    if (exists) { skipped++; continue; }

    try {
      await new Booking({
        building: BUILDING,
        propertyId: null,
        apt, name, phone,
        bookingType: bkType,
        checkIn, checkOut,
        nights,
        pricePerNight: ppn || undefined,
        totalPrice: total,
        paidAmount: paid,
        status: nazeelSt === 'دخول' ? 'active' : nazeelSt === 'ملغي' ? 'cancelled' : 'checkout',
        source: 'نزيل',
        notes: noteId,
      }).save();
      created++;
      if (created % 100 === 0) process.stdout.write(`  📦 ${created} حجز...\r`);
    } catch(e) {
      errors.push(`#${bookingNum}: ${e.message}`);
      skipped++;
    }
  }

  console.log(`\n✅ تم الاستيراد: ${created} حجز جديد، ${skipped} متجاوز`);
  if (errors.length) console.log('❌ أخطاء:', errors.slice(0, 10));
  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
