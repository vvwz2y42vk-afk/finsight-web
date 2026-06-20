require('dotenv').config();
const mongoose = require('mongoose');
const Guest = require('../models/Guest');

function cleanPhone(p) {
  if (!p || p === 'Null') return '';
  p = String(p).replace(/\s/g, '');
  if (p.startsWith('-')) return '';
  if (p.startsWith('00966')) return '0' + p.slice(5);
  if (p.startsWith('+966'))  return '0' + p.slice(4);
  return p;
}

const CUSTOMERS = [
  // صفحة 39
  { name:'مفرح غزواني',                      idType:'بطاقة هوية مدنية',  idNumber:'1023663964',       phone:'00966555716650' },
  { name:'معيض علي معيض الزهراني',           idType:'بطاقة هوية مدنية',  idNumber:'1053068449',       phone:'00966555538919' },
  { name:'معيض سليمان محمد الشطيري',         idType:'بطاقة هوية مدنية',  idNumber:'1086955158',       phone:'00966546076010' },
  { name:'معيض حمدان خلف الشمري',            idType:'بطاقة هوية مدنية',  idNumber:'1068172897',       phone:'00966552188852' },
  { name:'معيض احمد مسلبي',                  idType:'بطاقة هوية مدنية',  idNumber:'1089923195',       phone:'00966507333718' },
  { name:'معوض عايد المهلكي المطيري',         idType:'بطاقة هوية مدنية',  idNumber:'1063658775',       phone:'00966508764957' },
  { name:'معنى القرشي',                      idType:'بطاقة هوية مدنية',  idNumber:'1100071164',       phone:'00966534779589' },
  { name:'معن مراد بلخير',                   idType:'إقامة',             idNumber:'2171597038',       phone:'00966535368983' },
  { name:'معز احمد ابراهيم محمد',            idType:'إقامة',             idNumber:'2521531380',       phone:'00966568440580' },
  { name:'معتوق عتيق حامد المطيري',          idType:'بطاقة هوية مدنية',  idNumber:'1068153517',       phone:'00966504673371' },
  { name:'معتصم مصطفى مسعودى',               idType:'بطاقة هوية مدنية',  idNumber:'1100907847',       phone:'00966542405221' },
  { name:'معتصم علي ابراهيم علي',            idType:'إقامة',             idNumber:'2443710443',       phone:'00966558233936' },
  { name:'معتصم عبدالله',                    idType:'إقامة',             idNumber:'2188214205',       phone:'00966566150759' },
  { name:'معتصم احمد محمد صالح',             idType:'إقامة',             idNumber:'2512196490',       phone:'00966531873495' },
  { name:'معتز ممدوح فتحي احمد',             idType:'بطاقة دولة الخليج', idNumber:'784199261684841',  phone:'00971588984108' },
  { name:'معتز محمود',                       idType:'إقامة',             idNumber:'2400396293',       phone:'00966535129427' },
  { name:'معتز محمد عبدالعزيز',              idType:'إقامة',             idNumber:'2445327634',       phone:'00966509822353' },
  { name:'معتز غالب بقدونسي',                idType:'إقامة',             idNumber:'2296960426',       phone:'00966537929653' },
  { name:'معتز غالب باشي',                   idType:'إقامة',             idNumber:'2317196901',       phone:'00966559818827' },
  { name:'معتز الامام علي الحسن',            idType:'إقامة',             idNumber:'2085653943',       phone:'00966559037044' },
  // صفحة 40
  { name:'معاذ الرفاعي',                     idType:'بطاقة هوية مدنية',  idNumber:'1121200875',       phone:'00966537483431' },
  { name:'معاذ الانصارى',                    idType:'إقامة',             idNumber:'2157373305',       phone:'00966500992120' },
  { name:'معاذ احمد عبد الله الغزي',         idType:'بطاقة هوية مدنية',  idNumber:'1100597051',       phone:'00966531363918' },
  { name:'معاذ احمد ضعافي شراحيلي',          idType:'بطاقة هوية مدنية',  idNumber:'1118200805',       phone:'00966538135038' },
  { name:'معاذ عبد الصمد فتوحي',             idType:'جواز السفر',        idNumber:'A16443775',        phone:'001587292723' },
  { name:'معاد نداء العنزي',                 idType:'بطاقة هوية مدنية',  idNumber:'1091555423',       phone:'00966501696993' },
  { name:'معاد حسن محمد',                    idType:'بطاقة هوية مدنية',  idNumber:'1129349518',       phone:'' },
  { name:'مظهر محمد',                        idType:'إقامة',             idNumber:'2255221869',       phone:'00966561081831' },
  { name:'مظهر عزيز',                        idType:'بطاقة هوية مدنية',  idNumber:'2569612886',       phone:'00966542285187' },
  { name:'مظفر دين احمد سيد',                idType:'إقامة',             idNumber:'2389606936',       phone:'00966544239159' },
  { name:'مطيع الرحمان خان تولا',            idType:'إقامة',             idNumber:'2497029930',       phone:'00966595823904' },
  { name:'مطهر العزى سلام',                  idType:'إقامة',             idNumber:'2507789176',       phone:'00966552720407' },
  { name:'مطلق معيض عايض الحربى',            idType:'بطاقة هوية مدنية',  idNumber:'1065475285',       phone:'00966502821305' },
  { name:'مطلق فريح سعيد العطوي',            idType:'دفتر العائلة',      idNumber:'1090196815',       phone:'00966530924440' },
  { name:'مطلق عويد مرزوق المطيرى',          idType:'دفتر العائلة',      idNumber:'1040457788',       phone:'00966555010196' },
  { name:'مطلق عطيه المطيري',                idType:'بطاقة هوية مدنية',  idNumber:'1110566377',       phone:'00966543629015' },
  { name:'مطلق الحميدى مطلق السهلي',         idType:'دفتر العائلة',      idNumber:'1076949971',       phone:'00966559983476' },
  { name:'مصلح مسعد عواد الجهنى',            idType:'بطاقة هوية مدنية',  idNumber:'1038570683',       phone:'00966562209667' },
  { name:'مصلح سفر مصلح المطيري',            idType:'بطاقة هوية مدنية',  idNumber:'1084371572',       phone:'00966544038727' },
  { name:'مصلح سبيل سمير المطيري',           idType:'بطاقة هوية مدنية',  idNumber:'1009508332',       phone:'00966500335292' },
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS:15000, family:4, tls:true, tlsAllowInvalidCertificates:false });

  let added=0, updated=0, errors=0;
  for (const c of CUSTOMERS) {
    try {
      const phone = cleanPhone(c.phone);
      const existing = await Guest.findOne({ idNumber: c.idNumber, propertyId: null });
      if (existing) {
        await Guest.updateOne({ _id: existing._id }, { $set: { name:c.name, idType:c.idType, phone: phone||existing.phone, building:'الماسة' } });
        updated++;
      } else {
        const phoneToSave = phone || `nophone-${c.idNumber}`;
        try {
          await Guest.create({ name:c.name, idType:c.idType, idNumber:c.idNumber, phone:phoneToSave, building:'الماسة', propertyId:null, category:'regular', totalBookings:0, lastSeen:new Date(), email:'' });
          added++;
        } catch(e2) {
          if (e2.code === 11000 && phone) {
            await Guest.create({ name:c.name, idType:c.idType, idNumber:c.idNumber, phone:`dup-${c.idNumber}`, building:'الماسة', propertyId:null, category:'regular', totalBookings:0, lastSeen:new Date(), email:'' });
            added++;
          } else throw e2;
        }
      }
    } catch(e) {
      console.error(`⚠️ ${c.name} — ${e.message}`);
      errors++;
    }
  }

  console.log(`✅ تم إضافة: ${added} | تحديث: ${updated} | أخطاء: ${errors}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
