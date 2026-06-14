require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const Booking  = require('../models/Booking');

const DATA_FILE = process.argv[2] || 'C:/Users/عبدالملك/manara_data.txt';
const BUILDING  = 'المنارا';

function parseDate(val) {
  const s = String(val || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  return null;
}

const isDate = s => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(s || '').trim());

async function run() {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000, family: 4, tls: true, tlsAllowInvalidCertificates: false,
  });
  console.log('✅ MongoDB متصل');

  const raw   = fs.readFileSync(DATA_FILE, 'utf8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  let created = 0, skipped = 0, errors = [];

  for (const line of lines) {
    // Collapse 4+ spaces into a single tab delimiter
    const parts = line.replace(/ {4,}/g, '\t').split('\t').map(c => c.trim());

    const bookingNum = parts[0];
    if (!/^\d+$/.test(bookingNum)) continue; // skip footer lines like "الدفعة الاولى"

    // Detect column shift: some apts are "101\tغرفة مفرده" with type in its own column
    // Normal:  parts[4] = checkIn date
    // Shifted: parts[4] = room type (not a date), parts[5] = checkIn date
    const offset = (!isDate(parts[4]) && isDate(parts[5])) ? 1 : 0;

    const nazeelSt = parts[1] || '';
    const aptNum   = parts[2] || '';
    const aptType  = offset ? parts[3] : '';
    const aptRaw   = aptNum + (aptType ? ' ' + aptType : '');
    const name     = parts[3 + offset] || '';
    const checkIn  = parseDate(parts[4 + offset]);
    const checkOut = parseDate(parts[5 + offset]);
    const typeRaw  = parts[6 + offset] || 'يومي';
    const nights   = parseInt(parts[7 + offset]) || undefined;
    const ppn      = parseFloat(parts[8 + offset]) || 0;
    const total    = parseFloat(String(parts[9  + offset] || '0').replace(/,/g, '')) || 0;
    const paid     = parseFloat(String(parts[13 + offset] || '0').replace(/,/g, '')) || 0;

    if (!name || !checkIn) { skipped++; continue; }

    const apt    = aptRaw.split(' ')[0]; // extract just the number "101"
    const bkType = (typeRaw.includes('شهري') || typeRaw.includes('سنوي')) ? 'annual' : 'daily';
    const noteId = `منارة#${bookingNum}`;

    const exists = await Booking.findOne({ notes: noteId }).lean();
    if (exists) { skipped++; continue; }

    try {
      await new Booking({
        building: BUILDING,
        propertyId: null,
        apt, name,
        phone: `nzl-${bookingNum}`,
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
  if (errors.length) console.log('❌ أخطاء:', errors.slice(0, 10).join('\n'));
  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
