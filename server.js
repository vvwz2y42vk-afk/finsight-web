require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createToken, verifyToken } = require('./utils/auth');
const { createRateLimiter } = require('./utils/rateLimit');
const { securityHeaders, sanitizeBody, noSQLGuard } = require('./middleware/security');
const { logSecEvent, securityAuditInterceptor } = require('./middleware/securityLog');
const AdminUser = require('./models/AdminUser');
const AuditLog = require('./models/AuditLog');
require('./models/ChannelConfig');
require('./models/ChannelListing');

const app = express();
app.set('trust proxy', 1);

// ── MongoDB ──────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/finsight';

const MONGO_OPTS = {
  serverSelectionTimeoutMS: 8000,
  socketTimeoutMS: 30000,
  connectTimeoutMS: 8000,
  family: 4,
  tls: true,
  tlsAllowInvalidCertificates: false,
  maxPoolSize: 3,        // M0 free tier: 500 connection limit — keep per-instance pool tiny
  minPoolSize: 0,        // release idle connections immediately
  maxIdleTimeMS: 270000, // أبقِ الاتصال حياً 4.5 دقيقة (أطول من ping interval)
  bufferCommands: false,
};

// Promise caching — survives warm Vercel invocations within the same worker process.
// If the connection drops, readyState leaves 1 and we reconnect.
let _connPromise = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (!_connPromise) {
    _connPromise = mongoose.connect(MONGO_URI, MONGO_OPTS)
      .then(async () => {
        console.log('✅ MongoDB متصل');
        await seedAdminUsers();
      })
      .catch(e => { _connPromise = null; throw e; });
  }
  return _connPromise;
}

// ── Seed admin users on first run ────────────────────────
async function seedAdminUsers() {
  try {
    const count = await AdminUser.countDocuments();
    if (count > 0) return;
    const toSeed = USERS.filter(u => u.password);
    for (const u of toSeed) {
      await new AdminUser({
        name: u.name, username: u.username, password: u.password,
        role: u.role, avatar: u.avatar, allowed: u.allowed, active: true,
      }).save();
    }
    console.log(`✅ تم إنشاء ${toSeed.length} مستخدم في قاعدة البيانات`);
  } catch (e) { console.error('خطأ في seeding:', e.message); }
}

async function dbMiddleware(req, res, next) {
  try { await connectDB(); next(); }
  catch (e) {
    _connPromise = null; // allow retry on next request
    const isApi = req.path.startsWith('/api') || req.path.startsWith('/staff/api');
    if (isApi) return res.status(503).json({ error: 'الخدمة متوقفة مؤقتاً، يُرجى المحاولة بعد قليل' });
    try { return res.status(503).render('maintenance'); }
    catch (_) { res.status(503).send('<meta charset="utf-8"><h2 style="font-family:sans-serif;text-align:center;padding:80px">الخدمة متوقفة مؤقتاً — <a href="javascript:location.reload()">أعد المحاولة</a></h2>'); }
  }
}

// ── Rate Limiters ────────────────────────────────────────
const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000, max: 10,
  message: 'محاولات دخول كثيرة جداً، انتظر 15 دقيقة',
});
const apiRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000, max: 500,
  message: 'طلبات كثيرة جداً، حاول لاحقاً',
});

// ── Middleware ───────────────────────────────────────────
app.use(securityHeaders);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(sanitizeBody);
app.use(noSQLGuard);
app.use(securityAuditInterceptor);
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── View Engine ──────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Users (fallback during migration) ───────────────────
const USERS = [
  {
    username: 'عبدالملك',
    password: process.env.DASHBOARD_PASSWORD,
    name: 'عبد الملك',
    role: 'admin',
    avatar: 'ع',
    allowed: ['dashboard','contracts','commissions','collection','expiry','map','performance','sources','reports']
  },
  {
    username: 'Yomna',
    password: process.env.PASSWORD_YOMNA,
    name: 'Yomna',
    role: 'employee',
    avatar: 'Y',
    allowed: ['dashboard','contracts','commissions','expiry']
  },
  {
    username: 'Abdulrahim',
    password: process.env.PASSWORD_ABDULRAHIM,
    name: 'عبد الرحيم',
    role: 'manager',
    avatar: 'ر',
    allowed: ['dashboard','contracts','collection','expiry','performance','sources','reports','listings','bookings','customers','apts','staff']
  }
].filter(u => u.password);

// ── Customer middleware ──────────────────────────────────
function customerMiddleware(req, res, next) {
  req.customer = verifyToken(req.cookies?.fs_cust) || null;
  res.locals.customer = req.customer;
  next();
}

// ── Host middleware ──────────────────────────────────────
function hostMiddleware(req, res, next) {
  req.hostAccount = verifyToken(req.cookies?.fs_host) || null;
  res.locals.hostAccount = req.hostAccount;
  next();
}

// ── Routes ───────────────────────────────────────────────
app.use('/api', dbMiddleware, apiRateLimit, (req, res, next) => {
  req.user = verifyToken(req.cookies?.fs_auth);
  next();
});
app.use('/account', dbMiddleware, customerMiddleware, require('./routes/account'));
app.use('/host', dbMiddleware, hostMiddleware, require('./routes/host'));
app.use('/staff', dbMiddleware, require('./routes/staff'));

app.use('/', customerMiddleware, require('./routes/client'));
app.use('/api', require('./routes/api'));

// ── Dashboard ────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  if (!verifyToken(req.cookies?.fs_auth)) return res.redirect('/login');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/api/me', (req, res) => {
  const user = verifyToken(req.cookies?.fs_auth);
  if (!user) return res.status(401).json({ error: 'غير مخوّل' });
  res.json(user);
});

app.get('/login', (req, res) => {
  if (verifyToken(req.cookies?.fs_auth)) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

// ── Login — DB first, env vars as fallback ───────────────
app.post('/login', loginRateLimit, dbMiddleware, async (req, res) => {
  const { username, password } = req.body;

  // Try DB (bcrypt)
  try {
    const dbUser = await AdminUser.findOne({ username: username?.trim(), active: true });
    if (dbUser && await dbUser.comparePassword(password)) {
      const token = createToken({ username: dbUser.username, name: dbUser.name, role: dbUser.role, avatar: dbUser.avatar, allowed: dbUser.allowed });
      res.cookie('fs_auth', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      AuditLog.create({ user: dbUser.username, role: dbUser.role, action: 'login', model: 'AdminUser', recordId: String(dbUser._id), summary: 'تسجيل دخول ناجح', ip: req.ip }).catch(() => {});
      return res.redirect('/dashboard');
    }
  } catch (e) { /* DB unavailable — fall through */ }

  // Fallback: env var users (plain text, for backward compat)
  const user = USERS.find(u => u.username === username && u.password === password);
  if (user) {
    const token = createToken({ username: user.username, name: user.name, role: user.role, avatar: user.avatar, allowed: user.allowed });
    res.cookie('fs_auth', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    logSecEvent('LOGIN_SUCCESS', req, { username, summary: `دخول ناجح (fallback): ${username}` });
    return res.redirect('/dashboard');
  }

  logSecEvent('LOGIN_FAIL', req, { username, summary: `فشل تسجيل دخول: ${username}` });
  res.render('login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
});

app.get('/logout', (req, res) => {
  res.clearCookie('fs_auth');
  res.redirect('/login');
});

// ── 404 handler ──────────────────────────────────────────
app.use((req, res) => {
  if (req.accepts('json') || req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'الصفحة غير موجودة' });
  }
  res.status(404).render('error', { code: 404, message: 'الصفحة التي تبحث عنها غير موجودة' });
});

// ── Global error handler ─────────────────────────────────
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;

  console.error(`[ERROR] ${req.method} ${req.path} → ${status}`, err.message, err.stack || '');

  if (res.headersSent) return;

  if (req.path.startsWith('/api') || (req.accepts('json') && !req.accepts('html'))) {
    return res.status(status).json({ error: 'حدث خطأ، يُرجى المحاولة مجدداً' });
  }
  try {
    const msg = status === 404
      ? 'الصفحة التي تبحث عنها غير موجودة'
      : 'حدث خطأ غير متوقع، يُرجى المحاولة مجدداً';
    res.status(status).render('error', { code: status, message: msg });
  } catch (_) {
    res.status(status).send('<meta charset="utf-8"><h2 style="font-family:sans-serif;text-align:center;padding:80px">حدث خطأ — <a href="/">العودة للرئيسية</a></h2>');
  }
});

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Barez شغّال على http://localhost:${PORT}`);
});
