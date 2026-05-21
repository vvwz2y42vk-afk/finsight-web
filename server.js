require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');

const app = express();

// ── MongoDB ──────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/finsight')
  .then(() => console.log('✅ MongoDB متصل'))
  .catch(err => console.error('❌ خطأ MongoDB:', err));

// ── Middleware ───────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'finsight_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ── View Engine ──────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Routes ───────────────────────────────────────────────
app.use('/', require('./routes/client'));
app.use('/api', require('./routes/api'));

// ── Dashboard (محمي بكلمة مرور) ──────────────────────────
app.get('/dashboard', (req, res) => {
  if (!req.session.auth) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/login', (req, res) => {
  if (req.session.auth) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const pass = process.env.DASHBOARD_PASSWORD || 'admin123';
  if (req.body.password === pass) {
    req.session.auth = true;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'كلمة المرور غير صحيحة' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Finsight شغّال على http://localhost:${PORT}`);
  console.log(`   الموقع العام   → http://localhost:${PORT}`);
  console.log(`   لوحة التحكم   → http://localhost:${PORT}/dashboard`);
  console.log(`   كلمة المرور   → ${process.env.DASHBOARD_PASSWORD || 'admin123'}`);
});
