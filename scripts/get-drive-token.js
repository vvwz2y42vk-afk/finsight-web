/**
 * get-drive-token.js — تشغيل مرة واحدة فقط للحصول على Refresh Token
 *
 * الخطوات:
 * 1. افتح Google Cloud Console → APIs & Services → Credentials
 * 2. اضغط على OAuth Client → Authorized redirect URIs → أضف: http://localhost:3001/callback
 * 3. شغّل: node scripts/get-drive-token.js
 * 4. المتصفح سيفتح — اضغط السماح
 * 5. انسخ الـ GDRIVE_REFRESH_TOKEN من الـ Terminal وأضفه في Vercel
 */

const http = require('http');
const { exec } = require('child_process');

const CLIENT_ID     = process.env.GDRIVE_CLIENT_ID     || '739139913910-3c563a6idbli5k4hucsdk2qv17rmortu.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET || '';
const REDIRECT_URI  = 'http://localhost:3001/callback';
const SCOPE         = 'https://www.googleapis.com/auth/drive.file';

if (!CLIENT_SECRET) {
  console.error('❌ حدد GDRIVE_CLIENT_SECRET أولاً:');
  console.error('   GDRIVE_CLIENT_SECRET=xxx node scripts/get-drive-token.js');
  process.exit(1);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  `client_id=${encodeURIComponent(CLIENT_ID)}&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  'response_type=code&' +
  `scope=${encodeURIComponent(SCOPE)}&` +
  'access_type=offline&' +
  'prompt=consent';

console.log('\n📌 إذا لم يفتح المتصفح تلقائياً، افتح هذا الرابط يدوياً:');
console.log(authUrl + '\n');

// Open browser automatically on Windows
const openCmd = `start "" "${authUrl}"`;
try { exec(openCmd); } catch {}

const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url, 'http://localhost:3001');
  const code = url.searchParams.get('code');
  const err  = url.searchParams.get('error');

  if (err || !code) {
    res.end('<html><body dir="rtl" style="font-family:sans-serif;padding:40px;"><h2>❌ فشل الإذن</h2></body></html>');
    server.close();
    return;
  }

  res.end('<html><body dir="rtl" style="font-family:sans-serif;text-align:center;padding:50px;background:#f0fdf4;"><h2>✅ تم! أغلق هذه النافذة وانظر للـ Terminal</h2></body></html>');
  server.close();

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    if (tokens.refresh_token) {
      console.log('\n✅ نجح! أضف هذه المتغيرات في Vercel → Settings → Environment Variables:\n');
      console.log(`GDRIVE_CLIENT_ID=${CLIENT_ID}`);
      console.log(`GDRIVE_CLIENT_SECRET=${CLIENT_SECRET}`);
      console.log(`GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log(`GDRIVE_FOLDER_ID=1AnEpQuYfc5rTRs3QIQwpUHzddvizhkiS`);
      console.log('');
    } else {
      console.error('\n❌ لم يُعطَ refresh_token:', JSON.stringify(tokens));
      console.error('تأكد من إضافة http://localhost:3001/callback في Authorized Redirect URIs');
    }
  } catch (e) {
    console.error('❌ خطأ:', e.message);
  }
});

server.listen(3001, () => console.log('⏳ انتظر إذن المتصفح... (server على port 3001)\n'));
