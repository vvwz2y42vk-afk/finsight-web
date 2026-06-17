// استيراد عملاء جوان ان من نزيل — مع retry للشبكة واستكمال تلقائي
require('dotenv').config();
const puppeteer = require('puppeteer');
const mongoose  = require('mongoose');
const fs        = require('fs');
const path      = require('path');
const Guest     = require('../models/Guest');

const PROGRESS_FILE = path.join(__dirname, 'jouan-progress.json');

const CONFIG = {
  loginUrl:     'https://pms.nazeel.net/Pages/Login.aspx',
  customersUrl: 'https://pms.nazeel.net/Pages/Management/ManageCustomers.aspx',
  username:     'A_0007',
  password:     '1122Aabd@',
  building:     'جوان ان',
  colName:     0,
  colIdType:   1,
  colIdNumber: 2,
  colPhone:    4,
};

const MONGO_URI = process.env.MONGO_URI;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanPhone(p) {
  if (!p || p === 'Null' || p.startsWith('-')) return '';
  p = String(p).replace(/\s/g, '');
  if (p.startsWith('00966')) return '0' + p.slice(5);
  if (p.startsWith('+966'))  return '0' + p.slice(4);
  return p;
}

async function ensureConnected() {
  if (mongoose.connection.readyState === 1) return;
  console.log('  ♻️  إعادة الاتصال بـ MongoDB...');
  try { await mongoose.disconnect(); } catch (_) {}
  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
    family: 4, tls: true, tlsAllowInvalidCertificates: false,
  });
  console.log('  ✅ اتصال MongoDB مستعاد');
}

async function saveCustomer(c, retries = 4) {
  if (!c.idNumber || c.idNumber.length < 2) return null;
  const phone = cleanPhone(c.phone);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await ensureConnected();
      const existing = await Guest.findOne({ idNumber: c.idNumber, propertyId: null });
      if (existing) {
        await Guest.updateOne({ _id: existing._id }, {
          $set: { name: c.name, idType: c.idType, phone: phone || existing.phone, building: CONFIG.building }
        });
        return 'updated';
      }
      const phoneToSave = phone || `nophone-${c.idNumber}`;
      try {
        await Guest.create({
          name: c.name, idType: c.idType, idNumber: c.idNumber,
          phone: phoneToSave, building: CONFIG.building,
          propertyId: null, category: 'regular',
          totalBookings: 0, lastSeen: new Date(), email: ''
        });
        return 'added';
      } catch (e) {
        if (e.code === 11000) {
          await Guest.create({
            name: c.name, idType: c.idType, idNumber: c.idNumber,
            phone: `dup-${c.idNumber}`, building: CONFIG.building,
            propertyId: null, category: 'regular',
            totalBookings: 0, lastSeen: new Date(), email: ''
          });
          return 'added';
        }
        throw e;
      }
    } catch (e) {
      const isNetwork = ['ECONNRESET','ENOTFOUND','ETIMEDOUT','ECONNREFUSED'].some(x => e.message?.includes(x));
      if (isNetwork && attempt < retries) {
        const wait = attempt * 3000;
        process.stdout.write(` [retry ${attempt}/${retries-1} في ${wait/1000}ث]`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function extractTable(page) {
  return page.evaluate((cfg) => {
    const rows = Array.from(document.querySelectorAll('table tbody tr, table tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
      if (cells.length < 3) return null;
      return { name: cells[cfg.colName]||'', idType: cells[cfg.colIdType]||'', idNumber: cells[cfg.colIdNumber]||'', phone: cells[cfg.colPhone]||'' };
    }).filter(Boolean);
  }, CONFIG);
}

async function clickNext(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a, input[type="submit"], button'));
    for (const el of links) {
      const txt = (el.innerText || el.value || '').trim();
      const cls = el.className || '';
      if (txt === 'التالي' || txt === 'Next' || txt === '>' || cls.includes('next') || el.getAttribute('aria-label') === 'Next') {
        const disabled = el.disabled || el.classList.contains('disabled') ||
          (el.parentElement && el.parentElement.classList.contains('disabled')) ||
          el.getAttribute('disabled') !== null;
        if (!disabled) { el.click(); return true; }
      }
    }
    return false;
  });
}

async function run() {
  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 20000, connectTimeoutMS: 20000,
    family: 4, tls: true, tlsAllowInvalidCertificates: false,
  });
  console.log('✅ متصل بقاعدة البيانات\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  console.log('🔐 تسجيل الدخول...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2' });

  const userSels = ['input[id*="UserName"]','input[id*="Username"]','input[name*="UserName"]','input[type="text"]:not([id*="search"])'];
  const passSels = ['input[id*="Password"]','input[id*="password"]','input[type="password"]'];
  let userField=null, passField=null;
  for (const s of userSels) { userField = await page.$(s); if (userField) break; }
  for (const s of passSels) { passField = await page.$(s); if (passField) break; }

  await userField.click({ clickCount:3 }); await userField.type(CONFIG.username);
  await passField.click({ clickCount:3 }); await passField.type(CONFIG.password);
  const submitSels = ['input[type="submit"]','button[type="submit"]','input[id*="Login"]','button[id*="Login"]'];
  let submitBtn=null;
  for (const s of submitSels) { submitBtn = await page.$(s); if (submitBtn) break; }
  if (submitBtn) await submitBtn.click(); else await passField.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{});
  console.log('✅ تم تسجيل الدخول\n');

  await page.goto(CONFIG.customersUrl, { waitUntil: 'networkidle2' });

  // استعادة التقدم السابق
  let progress = { page: 1, added: 0, updated: 0, errors: 0 };
  if (fs.existsSync(PROGRESS_FILE)) {
    try { progress = JSON.parse(fs.readFileSync(PROGRESS_FILE,'utf8')); } catch(_){}
  }
  let { added, updated, errors } = progress;
  let pageNum = progress.page;

  if (pageNum > 1) {
    console.log(`📋 استكمال من الصفحة ${pageNum} (تم: ${added+updated} عميل)...\n`);
    // الانتقال للصفحة المطلوبة
    for (let i=1; i<pageNum; i++) {
      const ok = await clickNext(page);
      if (!ok) { console.log('⚠️ ما قدرت أوصل للصفحة المحفوظة، بدأ من الأول'); pageNum=1; added=0; updated=0; errors=0; break; }
      await sleep(200);
    }
  } else {
    console.log('📋 بدء استيراد العملاء...\n');
  }

  while (true) {
    process.stdout.write(`📄 الصفحة ${pageNum}... `);
    await sleep(300);

    const customers = await extractTable(page);
    if (customers.length === 0) { console.log('لا يوجد بيانات — توقف.'); break; }
    process.stdout.write(`${customers.length} عميل → `);

    let pageAdded=0, pageUpdated=0;
    const BATCH = 5;
    for (let b=0; b<customers.length; b+=BATCH) {
      const chunk = customers.slice(b, b+BATCH);
      const results = await Promise.allSettled(chunk.map(c => saveCustomer(c)));
      for (let j=0; j<results.length; j++) {
        const r = results[j];
        if (r.status==='fulfilled') {
          if (r.value==='added')   { added++;   pageAdded++;   }
          else if (r.value==='updated') { updated++; pageUpdated++; }
        } else {
          process.stdout.write(`\n  ⚠️ ${chunk[j].name} — ${r.reason?.message}\n  `);
          errors++;
        }
      }
    }
    console.log(`إضافة: ${pageAdded} | تحديث: ${pageUpdated} | المجموع: ${added+updated}`);

    // حفظ التقدم
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ page: pageNum+1, added, updated, errors }));

    const hasNext = await clickNext(page);
    if (!hasNext) { console.log('\n✅ وصلنا للصفحة الأخيرة.'); break; }
    await sleep(500);
    pageNum++;
  }

  // حذف ملف التقدم بعد الانتهاء
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);

  console.log(`\n🎉 اكتمل! إضافة: ${added} | تحديث: ${updated} | أخطاء: ${errors}`);
  await browser.close();
  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
