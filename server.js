require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createToken, verifyToken } = require('./utils/auth');
const { createRateLimiter } = require('./utils/rateLimit');
const AdminUser = require('./models/AdminUser');
const AuditLog = require('./models/AuditLog');

const app = express();

// ── MongoDB ──────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/finsight';
let _dbConn = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (mongoose.connection.readyState === 2) {
    // already connecting — wait
    await new Promise(r => mongoose.connection.once('connected', r));
    return mongoose.connection;
  }
  _dbConn = await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    family: 4,
  });
  console.log('✅ MongoDB متصل');
  await seedAdminUsers();
  return _dbConn;
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
    _dbConn = null;
    // force disconnect so next request gets a fresh connection
    mongoose.connection.destroy().catch(() => {});
    res.status(500).json({ error: 'فشل الاتصال بقاعدة البيانات: ' + e.message });
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
app.use('/superadmin', dbMiddleware, require('./routes/superadmin'));
app.use('/', dbMiddleware, customerMiddleware, require('./routes/client'));
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
      res.cookie('fs_auth', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' });
      AuditLog.create({ user: dbUser.username, role: dbUser.role, action: 'login', model: 'AdminUser', recordId: String(dbUser._id), summary: 'تسجيل دخول ناجح', ip: req.ip }).catch(() => {});
      return res.redirect('/dashboard');
    }
  } catch (e) { /* DB unavailable — fall through */ }

  // Fallback: env var users (plain text, for backward compat)
  const user = USERS.find(u => u.username === username && u.password === password);
  if (user) {
    const token = createToken({ username: user.username, name: user.name, role: user.role, avatar: user.avatar, allowed: user.allowed });
    res.cookie('fs_auth', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' });
    return res.redirect('/dashboard');
  }

  res.render('login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
});

app.get('/logout', (req, res) => {
  res.clearCookie('fs_auth');
  res.redirect('/login');
});

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Barez شغّال على http://localhost:${PORT}`);
});
