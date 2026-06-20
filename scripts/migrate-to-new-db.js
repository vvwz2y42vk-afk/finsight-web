#!/usr/bin/env node
/**
 * ترحيل البيانات من MongoDB القديم (M0) إلى الجديد (Serverless/Flex)
 *
 * الاستخدام:
 *   OLD_URI="mongodb+srv://..." NEW_URI="mongodb+srv://..." node scripts/migrate-to-new-db.js
 *
 * أو أضف المتغيرين في .env.migrate ثم شغّل:
 *   node -r dotenv/config scripts/migrate-to-new-db.js dotenv_config_path=.env.migrate
 */

const mongoose = require('mongoose');

const OLD_URI = process.env.OLD_URI || process.env.MONGO_URI;
const NEW_URI = process.env.NEW_URI;

if (!OLD_URI || !NEW_URI) {
  console.error('❌ يجب تحديد OLD_URI و NEW_URI');
  console.error('   OLD_URI="mongodb+srv://..." NEW_URI="mongodb+srv://..." node scripts/migrate-to-new-db.js');
  process.exit(1);
}

if (OLD_URI === NEW_URI) {
  console.error('❌ OLD_URI و NEW_URI متطابقان — تحقق من القيم');
  process.exit(1);
}

const COLLECTIONS = [
  'adminusers',
  'staffusers',
  'customers',
  'hosts',
  'properties',
  'bookings',
  'contracts',
  'listings',
  'guests',
  'vouchers',
  'housekeepingtasks',
  'activitylogs',
  'conversations',
  'messages',
  'reviews',
  'inquiries',
  'channelconfigs',
  'channellistings',
  'auditlogs',
  'roominfos',
  'commissionhistories',
  'configs',
];

const OPTS = {
  serverSelectionTimeoutMS: 20000,
  connectTimeoutMS: 20000,
  socketTimeoutMS: 60000,
  family: 4, tls: true, maxPoolSize: 5,
};

function pad(s, n) { return String(s).padEnd(n); }
function fmt(n) { return n.toLocaleString(); }

async function migrateCollection(oldDb, newDb, name) {
  const oldCol = oldDb.collection(name);
  const newCol = newDb.collection(name);

  const total = await oldCol.countDocuments();
  if (total === 0) {
    console.log(`  ${pad(name, 24)} — فارغة، تخطّي`);
    return 0;
  }

  // حذف ما في الجديد أولاً (إعادة التشغيل آمنة)
  await newCol.deleteMany({});

  const BATCH = 500;
  let migrated = 0;
  const cursor = oldCol.find({});

  let batch = [];
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH) {
      await newCol.insertMany(batch, { ordered: false });
      migrated += batch.length;
      process.stdout.write(`\r  ${pad(name, 24)} — ${fmt(migrated)}/${fmt(total)}`);
      batch = [];
    }
  }
  if (batch.length) {
    await newCol.insertMany(batch, { ordered: false });
    migrated += batch.length;
  }

  process.stdout.write(`\r  ${pad(name, 24)} — ✓ ${fmt(migrated)} وثيقة\n`);
  return migrated;
}

(async () => {
  console.log('\n🚀 بدء ترحيل البيانات\n');
  console.log(`  المصدر (القديم): ${OLD_URI.replace(/:([^:@]+)@/, ':***@')}`);
  console.log(`  الهدف  (الجديد): ${NEW_URI.replace(/:([^:@]+)@/, ':***@')}\n`);

  let oldConn, newConn;
  try {
    process.stdout.write('⏳ الاتصال بقاعدة البيانات القديمة...');
    oldConn = await mongoose.createConnection(OLD_URI, OPTS).asPromise();
    console.log(' ✅');

    process.stdout.write('⏳ الاتصال بقاعدة البيانات الجديدة...');
    newConn = await mongoose.createConnection(NEW_URI, OPTS).asPromise();
    console.log(' ✅\n');
  } catch (e) {
    console.error('\n❌ فشل الاتصال:', e.message);
    process.exit(1);
  }

  const oldDb = oldConn.db;
  const newDb = newConn.db;

  // اكتشف الـ collections الفعلية الموجودة في القاعدة القديمة
  const existingCols = (await oldDb.listCollections().toArray()).map(c => c.name);
  const toMigrate = COLLECTIONS.filter(c => existingCols.includes(c));
  const extra = existingCols.filter(c => !COLLECTIONS.includes(c) && !c.startsWith('system.'));

  if (extra.length) {
    console.log(`⚠️  collections غير مدرجة (ستُنقل أيضاً): ${extra.join(', ')}\n`);
    toMigrate.push(...extra);
  }

  console.log(`📦 ${toMigrate.length} collection للترحيل:\n`);

  let totalDocs = 0;
  const startTime = Date.now();

  for (const col of toMigrate) {
    try {
      totalDocs += await migrateCollection(oldDb, newDb, col);
    } catch (e) {
      console.error(`\n  ❌ خطأ في ${col}: ${e.message}`);
    }
  }

  // نقل الـ indexes
  console.log('\n📋 نسخ الـ indexes...');
  for (const col of toMigrate) {
    try {
      const indexes = await oldDb.collection(col).indexes();
      for (const idx of indexes) {
        if (idx.name === '_id_') continue;
        const { key, name, ...opts } = idx;
        await newConn.db.collection(col).createIndex(key, { name, ...opts }).catch(() => {});
      }
    } catch (e) { /* تجاهل أخطاء الـ indexes */ }
  }
  console.log('  ✅ اكتمل نسخ الـ indexes\n');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('═'.repeat(50));
  console.log(`✅ اكتمل الترحيل`);
  console.log(`   إجمالي الوثائق: ${fmt(totalDocs)}`);
  console.log(`   الوقت المستغرق: ${elapsed} ثانية`);
  console.log('═'.repeat(50));
  console.log('\n📌 الخطوة التالية:');
  console.log('   غيّر MONGO_URI في Vercel للـ connection string الجديد ثم أعد النشر\n');

  await oldConn.close();
  await newConn.close();
})();
