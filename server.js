require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createToken, verifyToken } = require('./utils/auth');

const app = express();

// ── MongoDB ──────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/finsight';
let _dbConn = null;

async function connectDB() {
  if (_dbConn && mongoose.connection.readyState === 1) return _dbConn;
  _dbConn = await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 30000,
  });
  console.log('✅ MongoDB متصل');
  return _dbConn;
}

async function dbMiddleware(req, res, next) {
  try { await connectDB(); next(); }
  catch (e) { res.status(500).json({ error: 'فشل الاتصال بقاعدة البيانات: ' + e.message }); }
}

// ── Cookie Auth ──────────────────────────────────────────
function requireAuth(req, res, next) {
  req.user = verifyToken(req.cookies?.fs_auth);
  if (!req.user) return res.status(401).json({ error: 'غير مخوّل' });
  next();
}

// ── Middleware ───────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── View Engine ──────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Users ────────────────────────────────────────────────
const USERS = [
  {
    username: 'عبدالملك',
    password: process.env.DASHBOARD_PASSWORD || 'admin123',
    name: 'عبد الملك',
    role: 'admin',
    avatar: 'ع',
    allowed: ['dashboard','contracts','commissions','collection','expiry','map','performance','sources','reports']
  },
  {
    username: 'Yomna',
    password: 'Yomna123',
    name: 'Yomna',
    role: 'employee',
    avatar: 'Y',
    allowed: ['dashboard','contracts','commissions','expiry']
  }
];

// ── Customer middleware ──────────────────────────────────
function customerMiddleware(req, res, next) {
  req.customer = verifyToken(req.cookies?.fs_cust) || null;
  res.locals.customer = req.customer;
  next();
}

// ── Routes ───────────────────────────────────────────────
app.use('/api', dbMiddleware, (req, res, next) => {
  req.user = verifyToken(req.cookies?.fs_auth);
  next();
});
app.use('/account', dbMiddleware, customerMiddleware, require('./routes/account'));
app.use('/', dbMiddleware, customerMiddleware, require('./routes/client'));
app.use('/api', require('./routes/api'));

// ── Dashboard ────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  if (!verifyToken(req.cookies?.fs_auth)) return res.redirect('/login');
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

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username && u.password === password);
  if (user) {
    const token = createToken({ username: user.username, name: user.name, role: user.role, avatar: user.avatar, allowed: user.allowed });
    res.cookie('fs_auth', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('fs_auth');
  res.redirect('/login');
});

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Finsight شغّال على http://localhost:${PORT}`);
});
