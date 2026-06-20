require('dotenv').config();
const puppeteer = require('puppeteer');

const CONFIG = {
  loginUrl:     'https://pms.nazeel.net/Pages/Login.aspx',
  customersUrl: 'https://pms.nazeel.net/Pages/Management/ManageCustomers.aspx',
  username:     'D_034',
  password:     '1122Aabd@',
};

async function run() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2' });
  const userSelectors = ['input[id*="UserName"]','input[id*="Username"]','input[type="text"]'];
  let userField = null;
  for (const sel of userSelectors) { userField = await page.$(sel); if (userField) break; }
  await userField.type(CONFIG.username);
  const passField = await page.$('input[type="password"]');
  await passField.type(CONFIG.password);
  const submitBtn = await page.$('input[type="submit"],button[type="submit"]');
  if (submitBtn) await submitBtn.click(); else await passField.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{});

  await page.goto(CONFIG.customersUrl, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  // طبع HTML كامل لأول 3 صفوف
  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tbody tr, table tr'));
    return trs.slice(0, 3).map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 3) return null;
      return {
        outerHTML: row.outerHTML,
        className: row.className,
        cells: cells.map((td, i) => ({ i, text: td.innerText.trim(), html: td.innerHTML }))
      };
    }).filter(Boolean);
  });

  rows.forEach((row, idx) => {
    console.log(`\n=== صف ${idx+1} ===`);
    console.log('className:', row.className);
    row.cells.forEach(c => {
      if (c.html) console.log(`  [${c.i}] text="${c.text}" html=${c.html.substring(0,200)}`);
    });
    console.log('outerHTML:', row.outerHTML.substring(0, 500));
  });

  // أيضاً اطبع بنية thead
  const headers = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll('table thead th, table tr:first-child th'));
    return ths.map(th => th.innerText.trim());
  });
  console.log('\n=== رؤوس الجدول ===', headers);

  await browser.close();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
