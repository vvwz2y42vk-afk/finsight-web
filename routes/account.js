const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Booking = require('../models/Booking');
const Listing = require('../models/Listing');
const { createToken } = require('../utils/auth');

const COOKIE_OPTS = { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' };

function requireCustomer(req, res, next) {
  if (!req.customer) return res.redirect('/account/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

// ─── Register ────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.customer) return res.redirect('/account');
  res.render('register', { error: null });
});

router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, email, nationalId, nationality } = req.body;
    if (!name || !phone || !password) return res.render('register', { error: 'الرجاء تعبئة الاسم والجوال وكلمة المرور' });
    if (password.length < 6) return res.render('register', { error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    const exists = await Customer.findOne({ phone: phone.trim() });
    if (exists) return res.render('register', { error: 'رقم الجوال مسجل مسبقاً' });
    const customer = await new Customer({
      name: name.trim(), phone: phone.trim(), password,
      email: email?.trim() || '', nationalId: nationalId?.trim() || '',
      nationality: nationality || 'سعودي',
    }).save();
    const token = createToken({ id: customer._id, name: customer.name, phone: customer.phone });
    res.cookie('fs_cust', token, COOKIE_OPTS);
    res.redirect('/account');
  } catch (e) {
    res.render('register', { error: 'حدث خطأ: ' + e.message });
  }
});

// ─── Login ───────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.customer) return res.redirect('/account');
  res.render('customer-login', { error: null, next: req.query.next || '' });
});

router.post('/login', async (req, res) => {
  try {
    const { phone, password, next } = req.body;
    const customer = await Customer.findOne({ phone: (phone || '').trim() });
    if (!customer || !(await customer.comparePassword(password))) {
      return res.render('customer-login', { error: 'رقم الجوال أو كلمة المرور غير صحيحة', next: next || '' });
    }
    const token = createToken({ id: customer._id, name: customer.name, phone: customer.phone });
    res.cookie('fs_cust', token, COOKIE_OPTS);
    res.redirect(next && next.startsWith('/') ? next : '/account');
  } catch (e) {
    res.render('customer-login', { error: 'حدث خطأ: ' + e.message, next: '' });
  }
});

// ─── Logout ──────────────────────────────────────────────
router.get('/logout', (req, res) => {
  res.clearCookie('fs_cust');
  res.redirect('/');
});

// ─── Profile ─────────────────────────────────────────────
router.get('/', requireCustomer, async (req, res) => {
  try {
    const customer = await Customer.findById(req.customer.id).lean();
    if (!customer) { res.clearCookie('fs_cust'); return res.redirect('/account/login'); }
    const bookings = await Booking.find({ customer: req.customer.id })
      .sort({ createdAt: -1 }).populate('listing', 'title photos').lean();
    res.render('account', { customer, bookings, error: null, success: req.query.success || null });
  } catch (e) {
    res.render('account', { customer: req.customer, bookings: [], error: e.message, success: null });
  }
});

// ─── Update profile ──────────────────────────────────────
router.post('/update', requireCustomer, async (req, res) => {
  try {
    const { name, email, nationalId, nationality } = req.body;
    const customer = await Customer.findByIdAndUpdate(
      req.customer.id,
      { name: name?.trim(), email: email?.trim(), nationalId: nationalId?.trim(), nationality },
      { new: true }
    ).lean();
    const token = createToken({ id: customer._id, name: customer.name, phone: customer.phone });
    res.cookie('fs_cust', token, COOKIE_OPTS);
    const bookings = await Booking.find({ customer: req.customer.id }).sort({ createdAt: -1 }).lean();
    res.render('account', { customer, bookings, error: null, success: 'تم تحديث بياناتك بنجاح' });
  } catch (e) {
    res.redirect('/account');
  }
});

// ─── Change password ─────────────────────────────────────
router.post('/change-password', requireCustomer, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const customer = await Customer.findById(req.customer.id);
    if (!customer || !(await customer.comparePassword(currentPassword))) {
      const bookings = await Booking.find({ customer: req.customer.id }).sort({ createdAt: -1 }).lean();
      return res.render('account', { customer: customer?.toObject() || req.customer, bookings, error: 'كلمة المرور الحالية غير صحيحة', success: null });
    }
    if (!newPassword || newPassword.length < 6) {
      const bookings = await Booking.find({ customer: req.customer.id }).sort({ createdAt: -1 }).lean();
      return res.render('account', { customer: customer.toObject(), bookings, error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل', success: null });
    }
    customer.password = newPassword;
    await customer.save();
    const bookings = await Booking.find({ customer: req.customer.id }).sort({ createdAt: -1 }).lean();
    res.render('account', { customer: customer.toObject(), bookings, error: null, success: 'تم تغيير كلمة المرور بنجاح' });
  } catch (e) {
    res.redirect('/account');
  }
});

// ─── Payment page ────────────────────────────────────────
router.get('/pay/:bookingId', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId).populate('listing','title photos').lean();
    if (!booking) return res.redirect('/account');
    if (booking.status !== 'awaiting_payment') {
      const msg = booking.status === 'awaiting_checkin' ? 'تم الدفع مسبقاً' : 'هذا الحجز غير متاح للدفع';
      return res.redirect('/account?success=' + encodeURIComponent(msg));
    }
    const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
    res.render('pay', {
      booking,
      baseUrl,
      publishableKey: process.env.MOYASAR_PUBLISHABLE_KEY || '',
      error: req.query.error || null,
    });
  } catch (e) { res.redirect('/account'); }
});

// ─── Payment callback ─────────────────────────────────────
router.get('/pay/:bookingId/callback', async (req, res) => {
  try {
    const { id: paymentId, status, message } = req.query;
    const booking = await Booking.findById(req.params.bookingId).lean();
    if (!booking || booking.status !== 'awaiting_payment') return res.redirect('/account');

    if (status === 'paid' && paymentId) {
      // Verify with Moyasar API
      const secretKey = process.env.MOYASAR_SECRET_KEY || '';
      let verified = false;
      if (secretKey) {
        try {
          const r = await fetch(`https://api.moyasar.com/v1/payments/${paymentId}`, {
            headers: { 'Authorization': 'Basic ' + Buffer.from(secretKey + ':').toString('base64') }
          });
          const data = await r.json();
          verified = data.status === 'paid' && data.amount === Math.round((booking.totalPrice || 0) * 100);
        } catch (e) {}
      } else {
        verified = true; // dev mode: no secret key, trust Moyasar redirect
      }

      if (verified) {
        await Booking.findByIdAndUpdate(booking._id, {
          status: 'awaiting_checkin',
          paymentId,
          paidAt: new Date(),
        });
        return res.redirect('/account?success=' + encodeURIComponent('✅ تم الدفع بنجاح! سيتم التواصل معك لتنسيق الدخول'));
      }
    }

    const errMsg = status === 'failed' ? 'فشلت عملية الدفع، حاول مرة أخرى' : 'تم إلغاء الدفع';
    res.redirect(`/account/pay/${req.params.bookingId}?error=` + encodeURIComponent(errMsg));
  } catch (e) { res.redirect('/account'); }
});

// ─── Cancel booking ──────────────────────────────────────
router.post('/cancel/:bookingId', requireCustomer, async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.bookingId, customer: req.customer.id }).lean();
    if (!booking || ['active','checkout','cancelled'].includes(booking.status)) return res.redirect('/account');
    await Booking.findByIdAndUpdate(req.params.bookingId, { status: 'cancelled' });
    if (booking.listing) {
      if (booking.bookingType === 'daily') {
        await Listing.findByIdAndUpdate(booking.listing, { $pull: { blockedRanges: { bookingId: booking._id } } });
      } else {
        await Listing.findByIdAndUpdate(booking.listing, { available: true });
      }
    }
    res.redirect('/account?success=تم+إلغاء+الحجز');
  } catch (e) {
    res.redirect('/account');
  }
});

module.exports = router;
