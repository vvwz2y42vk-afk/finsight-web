// Performance optimization: add font preconnect + script defer to all EJS views
const fs = require('fs');
const path = require('path');

const PRECONNECT = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`;

const viewsDir = path.join(__dirname, '..', 'views');
const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.ejs'));

let changed = 0;
files.forEach(file => {
  const filePath = path.join(viewsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // 1. Add preconnect before Google Fonts link (if not already there)
  if (content.includes('fonts.googleapis.com') && !content.includes('rel="preconnect"')) {
    content = content.replace(
      /<link href="https:\/\/fonts\.googleapis\.com/,
      `${PRECONNECT}\n<link href="https://fonts.googleapis.com`
    );
  }

  // 2. Add display=swap if missing in Google Fonts URL
  content = content.replace(
    /(fonts\.googleapis\.com\/css2\?[^"]+)(?<!&display=swap)(")/g,
    (match, url, quote) => {
      if (url.includes('display=swap')) return match;
      return url + '&display=swap' + quote;
    }
  );

  // 3. Add defer to CDN scripts (AOS, VanillaTilt)
  content = content.replace(
    /<script src="https:\/\/unpkg\.com\/aos[^"]*"([^>]*)>/g,
    (m, attrs) => attrs.includes('defer') ? m : m.replace('>', ' defer>')
  );
  content = content.replace(
    /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/vanillatilt[^"]*"([^>]*)>/g,
    (m, attrs) => attrs.includes('defer') ? m : m.replace('>', ' defer>')
  );

  // 4. Add loading="lazy" to images that don't have it (skip hero images)
  content = content.replace(
    /<img([^>]+)(?<!loading="[^"]*")>/g,
    (m, attrs) => {
      if (attrs.includes('loading=')) return m;
      // Don't lazy-load logo or above-the-fold images
      if (attrs.includes('logo') || attrs.includes('csb-logo') || attrs.includes('hero')) return m;
      return `<img${attrs} loading="lazy">`;
    }
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    changed++;
    console.log(`  ✓ ${file}`);
  }
});

console.log(`\nDone: ${changed} files updated`);
