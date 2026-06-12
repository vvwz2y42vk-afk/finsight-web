require('dotenv').config();
const mongoose = require('mongoose');
const Booking  = require('../models/Booking');
const Guest    = require('../models/Guest');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000, family: 4, tls: true, tlsAllowInvalidCertificates: false,
  });
  console.log('✅ MongoDB متصل');

  const bookings = await Booking.find({}).lean();
  console.log(`📦 ${bookings.length} حجز — جاري التجميع...`);

  // Group by phone+propertyId
  const map = {};
  for (const b of bookings) {
    const key = `${b.phone}||${b.propertyId||'null'}`;
    if (!map[key]) {
      map[key] = { phone: b.phone, propertyId: b.propertyId||null, building: b.building||'', bookings: [] };
    }
    map[key].bookings.push(b);
  }

  const groups = Object.values(map);
  console.log(`👤 ${groups.length} عميل فريد`);

  let upserted = 0, errors = 0;
  const ops = [];

  for (const g of groups) {
    // Pick the booking with the most data (latest non-Nazeel first, then latest)
    const sorted = g.bookings.sort((a, b) => {
      const aNazeel = String(a.phone).startsWith('nzl-') ? 1 : 0;
      const bNazeel = String(b.phone).startsWith('nzl-') ? 1 : 0;
      if (aNazeel !== bNazeel) return aNazeel - bNazeel;
      return new Date(b.createdAt||0) - new Date(a.createdAt||0);
    });
    const best = sorted[0];
    const totalBookings = g.bookings.length;
    const lastSeen = sorted.reduce((d, b) => {
      const t = new Date(b.checkIn||b.createdAt||0);
      return t > d ? t : d;
    }, new Date(0));

    ops.push({
      updateOne: {
        filter: { phone: g.phone, propertyId: g.propertyId },
        update: {
          $set: {
            name:       best.name || '',
            building:   g.building,
            idType:     best.idType || '',
            idNumber:   best.idNumber || '',
            email:      best.email || '',
            lastSeen,
          },
          $max: { totalBookings },
          $setOnInsert: { category: 'regular' },
        },
        upsert: true,
      },
    });
  }

  // bulkWrite in batches of 500
  for (let i = 0; i < ops.length; i += 500) {
    const batch = ops.slice(i, i + 500);
    try {
      const r = await Guest.bulkWrite(batch, { ordered: false });
      upserted += r.upsertedCount + r.modifiedCount;
      process.stdout.write(`  ✍️  ${Math.min(i+500, ops.length)} / ${ops.length}\r`);
    } catch(e) {
      errors++;
      console.error('batch error:', e.message);
    }
  }

  console.log(`\n✅ تم: ${upserted} عميل محدّث/مُضاف | أخطاء: ${errors}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
