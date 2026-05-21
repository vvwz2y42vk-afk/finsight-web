require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const app = express();
const SECRET = process.env.SESSION_SECRET || 'finsight_2026';

// ── MongoDB ──────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/finsight')
  .then(() => console.log('✅ MongoDB متصل'))
  .catch(err => console.error('❌ خطأ MongoDB:', err));

// ── Cookie Auth ──────────────────────────────────────────
function createToken(user) {
  const data = Buffer.from(JSON.stringify(user)).toString('base64');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  return `${data}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  if (sig !== expected) return null;
  try { return JSON.parse(Buffer.from(data, 'base64').toString()); }
  catch { return null; }
}
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

// ── Routes ───────────────────────────────────────────────
app.use('/api', (req, res, next) => {
  req.user = verifyToken(req.cookies?.fs_auth);
  next();
});
app.use('/', require('./routes/client'));
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
