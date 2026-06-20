require('dotenv').config();
const mongoose = require('mongoose');
const Guest = require('../models/Guest');

const CUSTOMERS = [
  { name:'يونس محمود احمد علي مسعد',      idType:'إقامة',               idNumber:'2553275948', phone:'00966557526492' },
  { name:'يونس عبدالعزيز عبدالله العثيم',  idType:'دفتر العائلة',        idNumber:'1004534176', phone:'00966554180007' },
  { name:'يونس الطاف حسين عبدالله',        idType:'إقامة',               idNumber:'2093800924', phone:'00966559399508' },
  { name:'يونس الزاوي',                    idType:'إقامة',               idNumber:'2375117815', phone:'00966539351269' },
  { name:'يوسف يوسف',                      idType:'إقامة',               idNumber:'2226807473', phone:'00966537315934' },
  { name:'يوسف يعقوب ترسن',               idType:'بطاقة هوية مدنية',    idNumber:'1010036521', phone:'00966549800777' },
  { name:'يوسف يحي الغامدي',              idType:'بطاقة هوية مدنية',    idNumber:'1117064632', phone:'00966530642190' },
  { name:'يوسف ياسر كركدان',              idType:'بطاقة هوية مدنية',    idNumber:'1126398369', phone:'00966500091018' },
  { name:'يوسف ناصر الرشيدي',             idType:'دفتر العائلة',        idNumber:'1081564054', phone:'00966563856055' },
  { name:'يوسف معيض الرشيدي',             idType:'بطاقة هوية مدنية',    idNumber:'1096438260', phone:'00966555158771' },
  { name:'يوسف مدني بخش البلوشي',         idType:'إقامة',               idNumber:'2104176017', phone:'00966544490671' },
  { name:'يوسف محمد محمد الشهري',         idType:'بطاقة هوية مدنية',    idNumber:'1138475148', phone:'00966537007566' },
  { name:'يوسف محمد عسيري',               idType:'دفتر العائلة',        idNumber:'1089389926', phone:'00966533238713' },
  { name:'يوسف محمد عبدالله الجزار',      idType:'جواز السفر',           idNumber:'a37302987',  phone:'0096561113267'  },
  { name:'يوسف محمد صالح الجمعه',         idType:'دفتر العائلة',        idNumber:'1049212747', phone:'00966533325333' },
  { name:'يوسف محمد شمس الاسلام حسين',    idType:'إقامة',               idNumber:'2014554469', phone:'00966504783853' },
  { name:'يوسف محمد سامي حبيشي',          idType:'إقامة',               idNumber:'2380034229', phone:'00966533688283' },
  { name:'يوسف محمد جراده',               idType:'إقامة',               idNumber:'2045254477', phone:'00966569752206' },
  { name:'يوسف محمد العوفي',              idType:'بطاقة هوية مدنية',    idNumber:'1097726606', phone:'00966547091912' },
  { name:'يوسف محمد العنزي',              idType:'دفتر العائلة',        idNumber:'1117340149', phone:'0096654842033'  },
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS:15000, family:4, tls:true, tlsAllowInvalidCertificates:false });
  console.log('✅ متصل\n');

  const idNumbers = CUSTOMERS.map(c => c.idNumber);
  const found = await Guest.find({ idNumber: { $in: idNumbers } }).lean();
  const foundSet = new Set(found.map(g => g.idNumber));

  let existing = 0, missing = 0;
  console.log('النتيجة:');
  console.log('─'.repeat(60));
  for (const c of CUSTOMERS) {
    const exists = foundSet.has(c.idNumber);
    if (exists) { existing++; console.log(`✅ موجود   — ${c.name} (${c.idNumber})`); }
    else         { missing++;  console.log(`❌ غير موجود — ${c.name} (${c.idNumber})`); }
  }
  console.log('─'.repeat(60));
  console.log(`\n✅ موجود: ${existing} | ❌ غير موجود: ${missing}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
