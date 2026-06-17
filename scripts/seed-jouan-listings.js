// تحديث أنواع شقق جوان ان في قاعدة البيانات
require('dotenv').config();
const mongoose = require('mongoose');
const Listing  = require('../models/Listing');

const BUILDING = 'جوان ان';

const APTS = [
  // أرضي
  { apt:'001', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'002', title:'غرفتين جناح عائلي',                 bedrooms:2 },
  { apt:'003', title:'غرفتين جناح عائلي',                 bedrooms:2 },
  { apt:'004', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  // الأول
  { apt:'101', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'102', title:'غرفتين جناح عائلي',                 bedrooms:2 },
  { apt:'103', title:'جناح ديلوكس (3 أسرة مفردة)',       bedrooms:1 },
  { apt:'104', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'105', title:'استوديو (غرفة مفردة)',              bedrooms:1 },
  // الثاني
  { apt:'201', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'202', title:'غرفتين جناح ديلوكس (3 أسرة مفردة)',bedrooms:2 },
  { apt:'203', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'204', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'205', title:'استوديو (غرفة مفردة)',              bedrooms:1 },
  // الثالث
  { apt:'301', title:'غرفتين جناح عائلي',                 bedrooms:2 },
  { apt:'302', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'303', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'304', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'305', title:'استوديو (غرفة مفردة)',              bedrooms:1 },
  // الرابع
  { apt:'401', title:'جناح ديلوكس (غرفة وصالة)',         bedrooms:1 },
  { apt:'402', title:'غرفتين جناح عائلي',                 bedrooms:2 },
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('متصل بقاعدة البيانات');

  for (const { apt, title, bedrooms } of APTS) {
    const res = await Listing.findOneAndUpdate(
      { building: BUILDING, apt },
      { $set: { title, bedrooms, building: BUILDING, apt, category: 'rental_apartment', type: 'both' } },
      { upsert: true, new: true }
    );
    console.log(`${apt} → ${title} (${res._id})`);
  }

  console.log(`\nتم تحديث ${APTS.length} شقة في ${BUILDING}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
