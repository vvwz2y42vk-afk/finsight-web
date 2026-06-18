#!/usr/bin/env node
/**
 * تشغيل: node scripts/sync-indexes.js
 * يُشغَّل يدوياً بعد إضافة indexes جديدة في النماذج.
 * لا يعمل تلقائياً عند بدء تشغيل الخادم (لتجنب إبطاء cold start).
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MODELS = [
  'HousekeepingTask','RoomInfo','Guest','Booking','Voucher','ActivityLog',
  'StaffUser','Host','Customer','Message','Conversation','Contract',
  'Review','Listing','AuditLog','ChannelConfig','ChannelListing',
];

// Load all models
MODELS.forEach(m => {
  try { require(`../models/${m}`); } catch(e) { console.warn(`⚠️  تعذّر تحميل نموذج ${m}:`, e.message); }
});

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000, socketTimeoutMS: 45000,
      connectTimeoutMS: 15000, family: 4, tls: true, maxPoolSize: 2,
    });
    console.log('✅ متصل بقاعدة البيانات\n');

    for (const m of MODELS) {
      try {
        await mongoose.model(m).syncIndexes();
        console.log(`  ✓ ${m}`);
      } catch(e) { console.warn(`  ✗ ${m}: ${e.message}`); }
    }
    console.log('\n✅ اكتمل مزامنة الـ indexes');
  } catch(e) {
    console.error('❌ فشل الاتصال:', e.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
