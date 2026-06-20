require('dotenv').config();
const puppeteer = require('puppeteer');

const CONFIG = {
  loginUrl: 'https://pms.nazeel.net/Pages/Login.aspx',
  customersUrl: 'https://pms.nazeel.net/Pages/Management/ManageCustomers.aspx',
  username: 'D_034',
  password: '1122Aabd@',
};

async function run() {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--start-maximized'] });
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
  await new Promise(r => setTimeout(r, 1500));

  // طبع كل خيارات ddlCategory من HTML المصدر (مش DOM)
  const ddlHtml = await page.evaluate(() => {
    const sel = document.querySelector('#ddlCategory');
    if (!sel) return 'NOT FOUND';
    return sel.outerHTML;
  });
  console.log('\n=== ddlCategory HTML ===\n', ddlHtml);

  // جرّب نفتح ViewCustomer لأول عميل
  const firstViewHref = await page.evaluate(() => {
    const a = document.querySelector('a.ViewIco');
    return a ? a.getAttribute('data-href') : null;
  });
  console.log('\nViewCustomer URL:', firstViewHref);

  if (firstViewHref) {
    // افتح صفحة الملف في تاب جديد
    const profilePage = await browser.newPage();
    await profilePage.goto('https://pms.nazeel.net' + firstViewHref, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // اطبع كل الحقول
    const profileData = await profilePage.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label, .field-label, th, .lbl'));
      const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
      const body = document.body.innerText;
      return {
        bodyText: body.substring(0, 1000),
        labels: labels.map(l => l.innerText.trim()).filter(Boolean),
        inputs: inputs.map(i => ({ id: i.id, name: i.name, value: i.value, type: i.type })).filter(i => i.id || i.name)
      };
    });
    console.log('\n=== ملف العميل - النص ===');
    console.log(profileData.bodyText);
    console.log('\n=== Labels ===', profileData.labels.slice(0, 30));
    console.log('\n=== Inputs/Selects ===');
    profileData.inputs.forEach(i => console.log(`  ${i.type} id="${i.id}" name="${i.name}" value="${i.value}"`));

    await profilePage.close();
  }

  console.log('\n✅ خلّص - المتصفح مفتوح 5 ثواني...');
  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
