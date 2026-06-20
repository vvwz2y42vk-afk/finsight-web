const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '../tmp/nazeel-tabs');

(async () => {
  const browser = await puppeteer.launch({ headless: true, defaultViewport:{width:900,height:800}, args:['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);

  // Login
  await page.goto('https://pms.nazeel.net/Pages/Login.aspx', { waitUntil:'networkidle2' });
  await page.click('#txtUserName', {clickCount:3});
  await page.type('#txtUserName', 'A_0007', {delay:40});
  await page.click('#cbh_mainContent_txtPassword', {clickCount:3});
  await page.type('#cbh_mainContent_txtPassword', '1122Aabd@', {delay:40});
  await Promise.all([
    page.waitForNavigation({waitUntil:'networkidle2',timeout:15000}).catch(()=>{}),
    page.click('#cbh_mainContent_btnLogin')
  ]);
  await new Promise(r=>setTimeout(r,2000));

  // Open the booking summary popup directly
  await page.goto('https://pms.nazeel.net/Pages/Management/Popups/View/ViewBooking.aspx?cid=8198&id=11482565', { waitUntil:'networkidle2' });
  await new Promise(r=>setTimeout(r,2000));
  await page.screenshot({path: path.join(OUT,'05d-booking-summary.png'), fullPage:true});

  // Get the HTML structure
  const info = await page.evaluate(() => {
    const body = document.body;
    // Get all labels/values
    const sections = Array.from(document.querySelectorAll('.row, .form-group, table, .panel, .card, fieldset, .section, .detail-row, .info-row')).map(el => ({
      tag: el.tagName,
      cls: el.className,
      text: el.innerText.trim().substring(0, 200)
    })).filter(x => x.text.length > 0).slice(0, 30);

    const tables = Array.from(document.querySelectorAll('table')).map(t => ({
      headers: Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim()),
      rows: Array.from(t.querySelectorAll('tbody tr')).slice(0,3).map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())
      )
    }));

    const labels = Array.from(document.querySelectorAll('label, .label, th, .field-label, strong, b')).map(el => el.innerText.trim()).filter(Boolean).slice(0, 40);

    return { sections, tables, labels, bodyText: body.innerText.substring(0, 2000) };
  });

  fs.writeFileSync(path.join(OUT,'05d-booking-summary.json'), JSON.stringify(info, null, 2));
  console.log('Body text:\n', info.bodyText);
  console.log('\nTables:', JSON.stringify(info.tables, null, 2));

  await browser.close();
})().catch(e => console.error(e.message));
