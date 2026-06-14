require('dotenv').config();
const puppeteer = require('puppeteer');
const mongoose = require('mongoose');
const Guest = require('../models/Guest');

// ===== عدّل هنا فقط =====
const CONFIG = {
  loginUrl:     'https://pms.nazeel.net/Pages/Login.aspx',
  customersUrl: 'https://pms.nazeel.net/Pages/Management/ManageCustomers.aspx',
  username:     'A_0017',
  password:     '1122Aabd@',
  building:     'المنارا',
  colName:     0,
  colIdType:   1,
  colIdNumber: 2,
  colPhone:    4,
};
// ========================

function cleanPhone(p) {
  if (!p || p === 'Null' || p.startsWith('-')) return '';
  p = String(p).replace(/\s/g, '');
  if (p.startsWith('00966')) return '0' + p.slice(5);
  if (p.startsWith('+966'))  return '0' + p.slice(4);
  return p;
}

async function saveCustomer(c) {
  if (!c.idNumber || c.idNumber.length < 2) return null;
  const phone = cleanPhone(c.phone);
  const existing = await Guest.findOne({ idNumber: c.idNumber });
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
    if (e.code === 11000 && phone) {
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
}

async function extractTable(page) {
  return page.evaluate((cfg) => {
    const rows = Array.from(document.querySelectorAll('table tbody tr, table tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
      if (cells.length < 3) return null;
      return {
        name:     cells[cfg.colName]     || '',
        idType:   cells[cfg.colIdType]   || '',
        idNumber: cells[cfg.colIdNumber] || '',
        phone:    cells[cfg.colPhone]    || '',
      };
    }).filter(Boolean);
  }, CONFIG);
}

async function clickNext(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a, input[type="submit"], button'));
    for (const el of links) {
      const txt = (el.innerText || el.value || '').trim();
      const cls = el.className || '';
      if (txt === 'التالي' || txt === 'Next' || txt === '>' ||
          cls.includes('next') || el.getAttribute('aria-label') === 'Next') {
        const isDisabled = el.disabled || el.classList.contains('disabled') ||
          (el.parentElement && el.parentElement.classList.contains('disabled')) ||
          el.getAttribute('disabled') !== null;
        if (!isDisabled) { el.click(); return true; }
      }
    }
    return false;
  });
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000, family: 4,
    tls: true, tlsAllowInvalidCertificates: false
  });
  console.log('✅ متصل بقاعدة البيانات\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  console.log('🔐 تسجيل الدخول لنزيل (المنارة)...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2' });

  const userSelectors = ['input[id*="UserName"]','input[id*="Username"]','input[name*="UserName"]','input[type="text"]:not([id*="search"])'];
  let userField = null;
  for (const sel of userSelectors) { userField = await page.$(sel); if (userField) break; }
  let passField = await page.$('input[type="password"]');

  if (!userField || !passField) {
    console.log('⚠️ ما قدرت أوجد حقول الدخول — سجّل يدوياً ثم اضغط Enter...');
    await new Promise(r => process.stdin.once('data', r));
  } else {
    await userField.click({ clickCount: 3 }); await userField.type(CONFIG.username);
    await passField.click({ clickCount: 3 }); await passField.type(CONFIG.password);
    const submitSelectors = ['input[type="submit"]','button[type="submit"]','input[id*="Login"]','button[id*="Login"]'];
    let submitBtn = null;
    for (const sel of submitSelectors) { submitBtn = await page.$(sel); if (submitBtn) break; }
    if (submitBtn) await submitBtn.click(); else await passField.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    console.log('✅ تم تسجيل الدخول\n');
  }

  console.log('📋 فتح صفحة العملاء...');
  await page.goto(CONFIG.customersUrl, { waitUntil: 'networkidle2' });

  let added = 0, updated = 0, errors = 0, pageNum = 1;

  while (true) {
    process.stdout.write(`📄 الصفحة ${pageNum}... `);
    await new Promise(r => setTimeout(r, 400));

    const customers = await extractTable(page);
    if (!customers.length) { console.log('لا يوجد بيانات — توقف.'); break; }
    process.stdout.write(`${customers.length} عميل → `);

    let pageAdded = 0, pageUpdated = 0;
    const results = await Promise.allSettled(customers.map(c => saveCustomer(c)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        if (r.value === 'added')   { added++;   pageAdded++;   }
        if (r.value === 'updated') { updated++; pageUpdated++; }
      } else {
        console.error(`\n⚠️ ${customers[i].name} — ${r.reason?.message}`);
        errors++;
      }
    }
    console.log(`إضافة: ${pageAdded} | تحديث: ${pageUpdated} | المجموع: ${added + updated}`);

    const hasNext = await clickNext(page);
    if (!hasNext) { console.log('\n✅ وصلنا للصفحة الأخيرة.'); break; }
    await new Promise(r => setTimeout(r, 700));
    pageNum++;
  }

  console.log(`\n🎉 اكتمل!`);
  console.log(`   إضافة: ${added} | تحديث: ${updated} | أخطاء: ${errors}`);
  await browser.close();
  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
