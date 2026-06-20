require('dotenv').config();
const puppeteer = require('puppeteer');

const CONFIG = {
  loginUrl:     'https://pms.nazeel.net/Pages/Login.aspx',
  customersUrl: 'https://pms.nazeel.net/Pages/Management/ManageCustomers.aspx',
  username:     'D_034',
  password:     '1122Aabd@',
};

async function run() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2' });
  let userField = await page.$('input[id*="UserName"],input[type="text"]');
  await userField.type(CONFIG.username);
  const passField = await page.$('input[type="password"]');
  await passField.type(CONFIG.password);
  const submitBtn = await page.$('input[type="submit"],button[type="submit"]');
  if (submitBtn) await submitBtn.click(); else await passField.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(()=>{});

  await page.goto(CONFIG.customersUrl, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  // انقر على ddlCategory وانتظر
  await page.click('#ddlCategory');
  await new Promise(r => setTimeout(r, 3000));

  // اقرأ الخيارات
  const opts = await page.evaluate(() => {
    const sel = document.querySelector('#ddlCategory');
    if (!sel) return [];
    return Array.from(sel.options).map(o => ({ value: o.value, text: o.text.trim() }));
  });

  console.log('خيارات ddlCategory بعد النقر:', JSON.stringify(opts, null, 2));

  // خذ سكرين شوت
  await page.screenshot({ path: 'scripts/nazeel-dropdown.png', fullPage: false });
  console.log('✅ سكرين شوت محفوظ: scripts/nazeel-dropdown.png');

  // ابقى مفتوح 10 ثواني
  await new Promise(r => setTimeout(r, 10000));
  await browser.close();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
