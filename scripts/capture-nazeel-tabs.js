require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../tmp/nazeel-tabs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const CONFIG = {
  loginUrl: 'https://pms.nazeel.net/Pages/Login.aspx',
  username: 'A_0007',
  password: '1122Aabd@',
};

const TABS = [
  { name: '01-dashboard',       url: 'https://pms.nazeel.net/Pages/Default.aspx' },
  { name: '02-checkin',         url: 'https://pms.nazeel.net/Pages/Management/ManageApartmentsInfo.aspx?tab=CheckIn' },
  { name: '03-checkout',        url: 'https://pms.nazeel.net/Pages/Management/ManageApartmentsInfo.aspx?tab=CheckOut' },
  { name: '04-apt-status',      url: 'https://pms.nazeel.net/Pages/Management/ManageApartmentsInfo.aspx?tab=ChangeStatus' },
  { name: '05-bookings',        url: 'https://pms.nazeel.net/Pages/Management/ManageBookings.aspx' },
  { name: '06-receipt-vouchers',url: 'https://pms.nazeel.net/Pages/Management/ManageReciptVouchers.aspx' },
  { name: '07-payment-vouchers',url: 'https://pms.nazeel.net/Pages/Management/ManagePaymentVouchers.aspx' },
  { name: '08-invoices',        url: 'https://pms.nazeel.net/Pages/Management/ManageInvoices.aspx?type=1' },
  { name: '09-customers',       url: 'https://pms.nazeel.net/Pages/Management/ManageCustomers.aspx' },
  { name: '10-housekeeping-status', url: 'https://pms.nazeel.net/Pages/Management/ManageHouseKeepingStatus.aspx' },
  { name: '11-housekeeping-tasks',  url: 'https://pms.nazeel.net/Pages/Management/ManageHouseKeepingTasks.aspx' },
  { name: '12-activity-log',    url: 'https://pms.nazeel.net/Pages/Reports/ActivitiesLogReport.aspx' },
  { name: '13-cash-flow',       url: 'https://pms.nazeel.net/Pages/Reports/GenerateFundsTransactions.aspx' },
  { name: '14-monthly-report',  url: 'https://pms.nazeel.net/Pages/Reports/GenerateApartmentControl.aspx' },
  { name: '15-occupancy',       url: 'https://pms.nazeel.net/Pages/Reports/GenerateOccupancyRates.aspx' },
  { name: '16-sms',             url: 'https://pms.nazeel.net/Pages/management/SMS.aspx' },
];

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log(`  📸 ${name}.png`);
}

async function getInfo(page, name) {
  const info = await page.evaluate(() => {
    // Get main content structure
    const title = document.querySelector('h1,h2,.PageTitle,.page-title,.TitleDiv,title')?.innerText || document.title;

    // Get all table headers
    const tables = Array.from(document.querySelectorAll('table')).map(t => {
      const headers = Array.from(t.querySelectorAll('th,thead td')).map(th => th.innerText.trim()).filter(Boolean);
      const rows = t.querySelectorAll('tbody tr');
      return { headers, rowCount: rows.length };
    });

    // Get filter/search elements
    const selects = Array.from(document.querySelectorAll('select')).map(s => ({
      label: s.previousElementSibling?.innerText || s.id || s.name,
      options: Array.from(s.options).map(o => o.text.trim()).filter(Boolean).slice(0, 8)
    }));

    // Get buttons
    const buttons = Array.from(document.querySelectorAll('input[type=submit],button,a.btn,.btn')).map(b => b.innerText?.trim() || b.value || '').filter(Boolean).slice(0, 15);

    // Get main sections/panels
    const panels = Array.from(document.querySelectorAll('.panel,.card,.box,.section,fieldset,legend')).map(p => p.querySelector('h1,h2,h3,legend,h4')?.innerText?.trim()).filter(Boolean).slice(0, 10);

    // Get input labels
    const labels = Array.from(document.querySelectorAll('label')).map(l => l.innerText.trim()).filter(Boolean).slice(0, 20);

    return { title, tables, selects, buttons, panels, labels };
  });

  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(info, null, 2), 'utf8');
  console.log(`  💾 ${name}.json (tables: ${info.tables.length}, buttons: ${info.buttons.length})`);
  return info;
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);

  // Login
  console.log('🔐 تسجيل الدخول...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2' });
  await page.click('#txtUserName', { clickCount: 3 });
  await page.type('#txtUserName', CONFIG.username, { delay: 40 });
  await page.click('#cbh_mainContent_txtPassword', { clickCount: 3 });
  await page.type('#cbh_mainContent_txtPassword', CONFIG.password, { delay: 40 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.click('#cbh_mainContent_btnLogin')
  ]);
  await new Promise(r => setTimeout(r, 2000));
  console.log('✅ دخلنا:', page.url(), '\n');

  // Visit each tab
  const allInfo = {};
  for (const tab of TABS) {
    console.log(`\n📄 ${tab.name}`);
    try {
      await page.goto(tab.url, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 1500));
      await shot(page, tab.name);
      const info = await getInfo(page, tab.name);
      allInfo[tab.name] = info;
    } catch (e) {
      console.log(`  ⚠️ خطأ: ${e.message.substring(0, 80)}`);
    }
  }

  // Save summary
  fs.writeFileSync(path.join(OUT, '_summary.json'), JSON.stringify(allInfo, null, 2), 'utf8');
  console.log(`\n✅ انتهى! الملفات في: ${OUT}`);
  await browser.close();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
