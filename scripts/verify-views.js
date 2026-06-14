#!/usr/bin/env node
/**
 * Pre-deploy Guardrail — يفحص أن كل ملف يُستخدم في الكود موجود وmُتتبَّع في Git.
 * يُوقف الـ Build فوراً إذا وُجد أي خلل.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT   = path.join(__dirname, '..');
const ROUTES = path.join(ROOT, 'routes');

let errors = 0;

function fail(msg) {
  console.error(`  ❌  ${msg}`);
  errors++;
}

// ── 1. جمع كل ملفات الـ routes + server.js ───────────────
const scanTargets = [
  path.join(ROOT, 'server.js'),
  ...fs.readdirSync(ROUTES)
       .filter(f => f.endsWith('.js'))
       .map(f => path.join(ROUTES, f)),
];

// ── 2. فحص كل استخدام داخل الكود ────────────────────────
const CHECKS = [
  // res.render('viewName')  →  views/viewName.ejs
  {
    re: /res\.render\(\s*['"]([^'"]+)['"]/g,
    resolve: (m) => path.join(ROOT, 'views', `${m}.ejs`),
    label: (m) => `views/${m}.ejs`,
  },
  // require('../models/X') أو require('./models/X')
  {
    re: /require\(\s*['"](?:\.\.\/|\.\/)?models\/([^'"]+)['"]\s*\)/g,
    resolve: (m) => path.join(ROOT, 'models', `${m}.js`),
    label: (m) => `models/${m}.js`,
  },
  // require('../utils/X')
  {
    re: /require\(\s*['"](?:\.\.\/|\.\/)?utils\/([^'"]+)['"]\s*\)/g,
    resolve: (m) => path.join(ROOT, 'utils', `${m}.js`),
    label: (m) => `utils/${m}.js`,
  },
  // require('../middleware/X')
  {
    re: /require\(\s*['"](?:\.\.\/|\.\/)?middleware\/([^'"]+)['"]\s*\)/g,
    resolve: (m) => path.join(ROOT, 'middleware', `${m}.js`),
    label: (m) => `middleware/${m}.js`,
  },
];

console.log('\n🔍  يفحص الملفات المرجعية في الكود...\n');

for (const filePath of scanTargets) {
  const relPath = path.relative(ROOT, filePath);
  const src     = fs.readFileSync(filePath, 'utf8');

  for (const { re, resolve, label } of CHECKS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const name     = m[1];
      const fullPath = resolve(name);
      if (!fs.existsSync(fullPath)) {
        fail(`مفقود: ${label(name)}  ← مطلوب من ${relPath}`);
      }
    }
  }
}

// ── 3. فحص الملفات الغير مُتتبَّعة (untracked) ──────────
console.log('🔍  يفحص الملفات غير المُضافة لـ Git...\n');

const CRITICAL_DIRS = ['views', 'models', 'utils', 'middleware', 'routes'];

try {
  const raw = execSync('git ls-files --others --exclude-standard --full-name', {
    cwd: ROOT, encoding: 'utf8',
  }).trim();

  if (raw) {
    const untracked = raw.split('\n').filter(f =>
      CRITICAL_DIRS.some(d => f.startsWith(d + '/') || f.startsWith(d + '\\'))
    );
    if (untracked.length > 0) {
      console.error('  ⚠️   ملفات موجودة محلياً لكن غير مُتتبَّعة في Git → Vercel لن يراها:\n');
      untracked.forEach(f => fail(`غير مُتتبَّع في Git: ${f}  (شغّل: git add ${f})`));
    }
  }
} catch (_) {
  console.warn('  ⚠️   تعذّر تشغيل git — تخطّي فحص الـ untracked files');
}

// ── 4. فحص الملفات المعدَّلة غير المُستعدة (modified) ───
try {
  const modified = execSync('git diff --name-only', {
    cwd: ROOT, encoding: 'utf8',
  }).trim();

  if (modified) {
    const critical = modified.split('\n').filter(f =>
      CRITICAL_DIRS.some(d => f.startsWith(d + '/'))
    );
    if (critical.length > 0) {
      console.warn('  ⚠️   ملفات حرجة معدَّلة محلياً ولم تُضَف للـ commit بعد:');
      critical.forEach(f => console.warn(`        🟡 ${f}`));
      console.warn('        شغّل: git add <الملف> && git commit -m "..."  ثم أعد الفحص\n');
    }
  }
} catch (_) { /* skip */ }

// ── النتيجة النهائية ──────────────────────────────────────
console.log('');
if (errors > 0) {
  console.error(`🚫  فشل الفحص: ${errors} مشكلة — أصلح الملفات المفقودة قبل الـ Deployment!\n`);
  process.exit(1);
} else {
  console.log('✅  الفحص نجح — جميع الـ views والـ models والـ utils موجودة ومُتتبَّعة في Git\n');
}
