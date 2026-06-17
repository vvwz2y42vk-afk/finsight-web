// فحص جودة بيانات عملاء جوان ان
require('dotenv').config();
const mongoose = require('mongoose');
const Guest    = require('../models/Guest');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { family:4, tls:true, tlsAllowInvalidCertificates:false });
  console.log('✅ متصل\n');

  const filter = { building: 'جوان ان', propertyId: null };

  const total       = await Guest.countDocuments(filter);
  const noPhone     = await Guest.countDocuments({ ...filter, phone: /^nophone-/ });
  const dupPhone    = await Guest.countDocuments({ ...filter, phone: /^dup-/ });
  const noIdNumber  = await Guest.countDocuments({ ...filter, $or: [{ idNumber: '' }, { idNumber: null }, { idNumber: { $exists: false } }] });
  const noName      = await Guest.countDocuments({ ...filter, $or: [{ name: '' }, { name: null }] });

  // تحقق من تكرار رقم الهوية
  const dupIds = await Guest.aggregate([
    { $match: { ...filter, idNumber: { $ne: '' } } },
    { $group: { _id: '$idNumber', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'total' }
  ]);

  console.log('═══════════════════════════════');
  console.log(`📊 إجمالي عملاء جوان ان : ${total.toLocaleString('ar')}`);
  console.log('───────────────────────────────');
  console.log(`📵 بدون رقم جوال حقيقي : ${noPhone + dupPhone} (nophone: ${noPhone} | dup: ${dupPhone})`);
  console.log(`🪪 بدون رقم هوية       : ${noIdNumber}`);
  console.log(`👤 بدون اسم            : ${noName}`);
  console.log(`🔁 هوية مكررة          : ${dupIds[0]?.total || 0} حالة`);
  console.log('═══════════════════════════════');

  if (dupIds[0]?.total > 0) {
    const samples = await Guest.aggregate([
      { $match: { ...filter, idNumber: { $ne: '' } } },
      { $group: { _id: '$idNumber', names: { $push: '$name' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 5 }
    ]);
    console.log('\nأمثلة هويات مكررة:');
    samples.forEach(s => console.log(`  ${s._id} → ${s.names.join(' / ')}`));
  }

  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
