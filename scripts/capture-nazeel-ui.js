require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../tmp/nazeel-ui');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const CONFIG = {
  loginUrl: 'https://pms.nazeel.net/Pages/Login.aspx',
  username: 'A_0007',
  password: '1122Aabd@',
};

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log(`📸 ${name}.png`);
}

async function getStructure(page, name) {
  const html = await page.content();
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  console.log(`💾 ${name}.html`);
}

async function run() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // 1. صفحة الدخول
  console.log('🔐 فتح صفحة الدخول...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2' });
  await shot(page, '00-login');

  // 2. أدخل البيانات
  await page.click('#txtUserName', { clickCount: 3 });
  await page.type('#txtUserName', CONFIG.username, { delay: 50 });
  await page.click('#cbh_mainContent_txtPassword', { clickCount: 3 });
  await page.type('#cbh_mainContent_txtPassword', CONFIG.password, { delay: 50 });
  await shot(page, '01-login-filled');

  // 3. أضغط الدخول
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.click('#cbh_mainContent_btnLogin')
  ]);
  await new Promise(r => setTimeout(r, 3000));
  const url = page.url();
  console.log('📍 URL بعد الدخول:', url);
  await shot(page, '02-after-login');
  await getStructure(page, '02-dashboard');

  // 4. جمع روابط الصفحات من السايدبار/الناف
  const navLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links
      .filter(a => a.href.includes('pms.nazeel.net') && !a.href.includes('javascript') && !a.href.includes('Login'))
      .map(a => ({ text: a.innerText.trim(), href: a.href }))
      .filter(l => l.text.length > 0)
      .slice(0, 30);
  });
  console.log('\n🔗 روابط الناف:');
  navLinks.forEach(l => console.log(`  ${l.text}: ${l.href}`));
  fs.writeFileSync(path.join(OUT, 'nav-links.json'), JSON.stringify(navLinks, null, 2));

  // 5. جرب نصور أهم الصفحات
  const pagesToVisit = [
    { name: '03-bookings', keywords: ['booking', 'reservat', 'حجز', 'Booking'] },
    { name: '04-rooms', keywords: ['room', 'غرف', 'Room', 'apartment'] },
    { name: '05-customers', keywords: ['customer', 'عميل', 'guest', 'ضيف'] },
    { name: '06-reports', keywords: ['report', 'تقرير', 'Report'] },
    { name: '07-housekeeping', keywords: ['housekeep', 'تنظيف', 'cleaning'] },
  ];

  for (const pg of pagesToVisit) {
    const match = navLinks.find(l =>
      pg.keywords.some(kw => l.text.toLowerCase().includes(kw.toLowerCase()) || l.href.toLowerCase().includes(kw.toLowerCase()))
    );
    if (match) {
      console.log(`\n📄 فتح: ${match.text} → ${match.href}`);
      try {
        await page.goto(match.href, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
        await shot(page, pg.name + '-' + match.text.replace(/\s+/g, '_').slice(0, 20));
        await getStructure(page, pg.name + '-' + match.text.replace(/\s+/g, '_').slice(0, 20));
      } catch (e) {
        console.log(`  ⚠️ خطأ: ${e.message}`);
      }
    }
  }

  // 6. عودة للداشبورد وتصوير الناف بالكامل
  await page.goto(url || CONFIG.loginUrl, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  // تصوير السايدبار
  const sidebar = await page.$('.sidebar, nav, #sidebar, #nav, .nav, .left-nav, .right-nav, [class*="side"], [class*="menu"]');
  if (sidebar) {
    await sidebar.screenshot({ path: path.join(OUT, '08-sidebar.png') });
    console.log('📸 08-sidebar.png');
  }

  console.log(`\n✅ انتهى! الصور في: ${OUT}`);
  await browser.close();
}

run().catch(e => {
  console.error('❌ خطأ:', e.message);
  process.exit(1);
});
