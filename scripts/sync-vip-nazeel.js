require('dotenv').config();
const puppeteer = require('puppeteer');
const mongoose = require('mongoose');
const Guest = require('../models/Guest');

const CONFIG = {
  loginUrl:     'https://pms.nazeel.net/Pages/Login.aspx',
  customersUrl: 'https://pms.nazeel.net/Pages/Management/ManageCustomers.aspx',
  username:     'D_034',
  password:     '1122Aabd@',
};

async function run() {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000, family: 4,
    tls: true, tlsAllowInvalidCertificates: false
  });
  console.log('✅ متصل بقاعدة البيانات\n');

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // تسجيل الدخول
  console.log('🔐 تسجيل الدخول...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2' });
  const userSelectors = ['input[id*="UserName"]','input[id*="Username"]','input[name*="UserName"]','input[type="text"]'];
  let userField = null;
  for (const sel of userSelectors) { userField = await page.$(sel); if (userField) break; }
  await userField.click({clickCount:3}); await userField.type(CONFIG.username);
  const passField = await page.$('input[type="password"]');
  await passField.click({clickCount:3}); await passField.type(CONFIG.password);
  const submitSelectors = ['input[type="submit"]','button[type="submit"]','input[id*="Login"]','button[id*="Login"]'];
  let submitBtn = null;
  for (const sel of submitSelectors) { submitBtn = await page.$(sel); if (submitBtn) break; }
  if (submitBtn) await submitBtn.click(); else await passField.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{});
  console.log('✅ تم تسجيل الدخول\n');

  // الذهاب لصفحة العملاء
  await page.goto(CONFIG.customersUrl, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  // افحص أول صفحة لمعرفة بنية الجدول
  const sampleRow = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tbody tr, table tr'));
    for (const row of trs) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length > 2) {
        return {
          cellCount: cells.length,
          cells: cells.map((td, i) => ({ i, text: td.innerText.trim().substring(0,40), html: td.innerHTML.substring(0,100) }))
        };
      }
    }
    return null;
  });
  if (sampleRow) {
    console.log(`📋 بنية الجدول: ${sampleRow.cellCount} عمود`);
    sampleRow.cells.forEach(c => console.log(`  [${c.i}] "${c.text}" | html: ${c.html.replace(/\n/g,' ').substring(0,80)}`));
  }

  // امشي على كل الصفحات وابحث عن النجمة
  const vipIds = [];
  let pageNum = 1;

  while (true) {
    await new Promise(r => setTimeout(r, 400));

    const rows = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr, table tr'));
      return trs.map(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 3) return null;

        const rowHtml = row.innerHTML;
        const rowText = row.innerText || '';

        // ابحث عن مؤشرات النجمة: ★ ☆ ⭐ fa-star glyphicon-star class أو VIP
        const hasStarChar = /★|☆|⭐/.test(rowText);
        const hasStarIcon = /fa-star|glyphicon-star|icon-star/.test(rowHtml);
        const hasVipText  = /\bvip\b/i.test(rowText);
        const isVip = hasStarChar || hasStarIcon || hasVipText;

        // rقم الإثبات في cells[2] عادةً
        const idNumber = cells[2]?.innerText.trim();
        const name     = cells[0]?.innerText.trim();

        return { name, idNumber, isVip, rowText: rowText.trim().substring(0,60) };
      }).filter(r => r && r.idNumber && r.idNumber.length > 2 && r.isVip);
    });

    if (rows.length) {
      vipIds.push(...rows.map(r => r.idNumber));
      console.log(`📄 صفحة ${pageNum}: ${rows.length} VIP — ${rows.map(r=>`${r.name}(${r.idNumber})`).join(', ').substring(0,100)}`);
    } else {
      process.stdout.write(`\r📄 صفحة ${pageNum}...`);
    }

    const hasNext = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      for (const el of links) {
        const txt = (el.innerText||'').trim();
        if ((txt==='التالي'||txt==='Next'||txt==='>') && !el.classList.contains('disabled') && !el.parentElement?.classList.contains('disabled')) {
          el.click(); return true;
        }
      }
      return false;
    });
    if (!hasNext) break;
    await page.waitForNavigation({waitUntil:'networkidle2',timeout:8000}).catch(()=>new Promise(r=>setTimeout(r,1500)));
    pageNum++;
  }

  await browser.close();
  console.log(`\n\n✅ إجمالي عملاء بنجمة: ${vipIds.length}`);

  if (!vipIds.length) {
    console.log('⚠️ ما لقينا أي عميل بنجمة — جرّب تفتح الموقع وتأكد من وجود نجوم.');
    await mongoose.disconnect(); return;
  }

  const result = await Guest.updateMany(
    { idNumber: { $in: vipIds }, propertyId: null },
    { $set: { category: 'vip' } }
  );
  console.log(`⭐ تم تحديث ${result.modifiedCount} عميل إلى VIP`);
  await mongoose.disconnect();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
