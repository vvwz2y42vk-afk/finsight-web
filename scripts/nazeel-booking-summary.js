const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../tmp/nazeel-tabs');

(async () => {
  const browser = await puppeteer.launch({ headless: true, defaultViewport:{width:1400,height:900}, args:['--no-sandbox','--disable-setuid-sandbox'] });
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
  console.log('Logged in:', page.url());

  // Go to bookings
  await page.goto('https://pms.nazeel.net/Pages/Management/ManageBookings.aspx', {waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,2500));

  // Screenshot the operations column
  await page.screenshot({path: path.join(OUT,'05b-bookings-ops.png')});

  // Inspect operations cell
  const opInfo = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    if (!rows.length) return {error:'no rows', tableCount: document.querySelectorAll('table').length};
    const firstRow = rows[0];
    const cells = Array.from(firstRow.querySelectorAll('td'));
    // First cell (العمليات is usually first in RTL)
    return {
      totalRows: rows.length,
      totalCells: cells.length,
      firstCellHTML: cells[0] ? cells[0].innerHTML.substring(0,500) : 'empty',
      lastCellHTML: cells[cells.length-1] ? cells[cells.length-1].innerHTML.substring(0,500) : 'empty',
      allCellsText: cells.map((c,i)=>({i, text:c.innerText.trim().substring(0,50)}))
    };
  });
  console.log('Op info:', JSON.stringify(opInfo, null, 2));

  // Try to find and click the summary icon (usually an eye or doc icon)
  // In Nazeel it's typically the 3rd icon in operations (between edit and delete)
  const clicked = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    if (!rows.length) return 'no rows';
    const firstRow = rows[0];
    // Find all clickable elements in the first cell (العمليات)
    const firstCell = firstRow.querySelector('td:first-child');
    if (!firstCell) return 'no first cell';
    const links = Array.from(firstCell.querySelectorAll('a, button, img, i, span[onclick]'));
    return links.map((el,i) => ({
      i,
      tag: el.tagName,
      href: el.href || '',
      title: el.title || el.getAttribute('data-original-title') || '',
      onclick: el.getAttribute('onclick') || '',
      classes: el.className,
      innerText: el.innerText || el.alt || ''
    }));
  });
  console.log('Clickable elements in ops:', JSON.stringify(clicked, null, 2));

  // Try clicking the summary button (look for eye/view icon - usually 2nd or 3rd icon)
  try {
    // Click on the first row's summary icon
    const summaryBtn = await page.$('table tbody tr:first-child td:first-child a:nth-child(2), table tbody tr:first-child td:first-child img:nth-child(2)');
    if (summaryBtn) {
      await summaryBtn.click();
      await new Promise(r=>setTimeout(r,2000));
      await page.screenshot({path: path.join(OUT,'05c-booking-summary-modal.png'), fullPage:false});
      console.log('Clicked summary, screenshot taken');
    } else {
      console.log('No summary button found with selector');
    }
  } catch(e) { console.log('Click error:', e.message); }

  await browser.close();
  console.log('Done');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
