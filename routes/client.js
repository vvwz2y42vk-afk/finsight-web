const express = require('express');
const router = express.Router();
const Contract = require('../models/Contract');

async function sendEmail(subject, html) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Finsight <onboarding@resend.dev>',
        to: ['assisting@finsight-sa.com'],
        subject, html,
      }),
    });
  } catch(e) {}
}

const BUILDINGS = {
  'المنارا':  { floors: [{l:'أرضي',r:['001','002']},{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204','205','206']},{l:'الثالث',r:['301','302','303','304','305','306']},{l:'الرابع',r:['401','402','403','404','405','406']},{l:'الخامس',r:['501','502','503','504']}] },
  'جوان ان': { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105']},{l:'الثاني',r:['201','202','203','204','205']},{l:'الثالث',r:['301','302','303','304','305','306']},{l:'الرابع',r:['401','402']}] },
  'الماسة':  { floors: [{l:'الأول',r:['101','102','103','104','105','106']},{l:'الثاني',r:['201','202','203','204']},{l:'الثالث',r:['301','302','303','304','305','306']}] },
  'الواحة':  { floors: [{l:'أرضي',r:['001','002','003','004']},{l:'الأول',r:['101','102','103','104','105','106','107','108']},{l:'الثاني',r:['201','202','203','204','205','206','207','208']}] },
};

function countApts(bName) {
  return BUILDINGS[bName].floors.reduce((sum, f) => sum + f.r.length, 0);
}
const totalUnits = Object.keys(BUILDINGS).reduce((s, b) => s + countApts(b), 0);

router.get('/', async (req, res) => {
  try {
    const contracts = await Contract.find({ n: { $exists: true, $ne: '' } }).lean();
    const active = contracts.filter(c => c.st !== 'مغلق');
    const occupied = new Set(active.map(c => `${c.sheet}-${c.a}`));
    const freeCount = totalUnits - occupied.size;
    res.render('index', {
      stats: {
        totalContracts: contracts.length,
        buildings: 4,
        totalUnits,
        freeUnits: freeCount,
      }
    });
  } catch (e) { res.render('index', { stats: { totalContracts: 0, buildings: 4, totalUnits, freeUnits: 0 } }); }
});

router.get('/apartments', async (req, res) => {
  try {
    const filter = req.query.building || '';
    const active = await Contract.find(
      { st: { $in: ['مفتوح', 'بانتظار دخول العميل'] }, n: { $exists: true, $ne: '' } },
      'sheet a'
    ).lean();
    const occupiedSet = new Set(active.map(c => `${c.sheet}-${c.a}`));

    const result = {};
    const targets = filter ? [filter] : Object.keys(BUILDINGS);

    targets.forEach(bName => {
      const free = [];
      BUILDINGS[bName].floors.forEach(floor => {
        floor.r.forEach(apt => {
          if (!occupiedSet.has(`${bName}-${apt}`)) {
            free.push({ apt, floor: floor.l });
          }
        });
      });
      result[bName] = { free, total: countApts(bName) };
    });

    res.render('apartments', { available: result, selectedBuilding: filter, buildings: Object.keys(BUILDINGS) });
  } catch (e) {
    res.render('apartments', { available: {}, selectedBuilding: '', buildings: Object.keys(BUILDINGS) });
  }
});

router.get('/about', (req, res) => {
  res.render('about');
});

router.get('/terms', (req, res) => {
  res.render('terms');
});

// ─── Listings Marketplace ─────────────────────────────────
router.get('/listings', async (req, res) => {
  try {
    const Listing = require('../models/Listing');
    const filter = { available: true };
    const cat = req.query.cat || '';
    if (cat) filter.category = cat;

    if (cat === 'rental_apartment' || cat === 'sale_apartment') {
      if (req.query.building) filter.building = req.query.building;
      if (cat === 'rental_apartment' && req.query.type && req.query.type !== 'all') {
        filter.$or = [{ type: req.query.type }, { type: 'both' }];
      }
    }

    // Price field per category
    const priceField = (cat === 'sale_land' || cat === 'sale_apartment') ? 'price_sale'
      : cat === 'rental_commercial' ? 'price_annual' : 'price_daily';

    // Price range filter
    if (req.query.min_price || req.query.max_price) {
      filter[priceField] = {};
      if (req.query.min_price) filter[priceField].$gte = parseInt(req.query.min_price) || 0;
      if (req.query.max_price) filter[priceField].$lte = parseInt(req.query.max_price) || 999999999;
    }

    // Sort
    const sort = req.query.sort || 'newest';
    let sortObj = { featured: -1, createdAt: -1 };
    if (sort === 'price_asc')  sortObj = { featured: -1, [priceField]: 1 };
    if (sort === 'price_desc') sortObj = { featured: -1, [priceField]: -1 };
    if (sort === 'featured')   sortObj = { featured: -1, createdAt: -1 };

    const listings = await Listing.find(filter).sort(sortObj).lean();
    const counts = await Listing.aggregate([
      { $match: { available: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);
    const catCounts = {};
    counts.forEach(c => { catCounts[c._id] = c.count; });
    res.render('listings', { listings, buildings: Object.keys(BUILDINGS), q: req.query, cat, catCounts });
  } catch (e) {
    res.render('listings', { listings: [], buildings: Object.keys(BUILDINGS), q: req.query, cat: req.query.cat||'', catCounts: {} });
  }
});

router.get('/listings/:id', async (req, res) => {
  try {
    const Listing = require('../models/Listing');
    const listing = await Listing.findById(req.params.id).lean();
    if (!listing) return res.redirect('/listings');
    res.render('listing', { listing });
  } catch (e) { res.redirect('/listings'); }
});

router.get('/book/:id', async (req, res) => {
  try {
    const Listing = require('../models/Listing');
    const listing = await Listing.findById(req.params.id).lean();
    if (!listing) return res.redirect('/listings');
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const isRentalApt = listing.category === 'rental_apartment';
    res.render('book', {
      listing,
      prefill: {
        type: isRentalApt ? (req.query.type || (listing.type === 'daily' ? 'daily' : 'annual')) : 'inquiry',
        checkIn: req.query.checkin || today,
        checkOut: req.query.checkout || tomorrow,
      },
      error: req.query.error || null,
    });
  } catch (e) { res.redirect('/listings'); }
});

router.post('/book/:id', async (req, res) => {
  try {
    const Listing = require('../models/Listing');
    const Booking = require('../models/Booking');
    const listing = await Listing.findById(req.params.id).lean();
    if (!listing) return res.redirect('/listings');

    const { name, phone, email, bookingType, checkIn, checkOut, guests, notes } = req.body;
    // Validate daily: check for overlap with blocked ranges
    if (bookingType === 'daily' && checkIn && checkOut) {
      const d1 = new Date(checkIn), d2 = new Date(checkOut);
      const overlap = (listing.blockedRanges || []).some(r => d1 < new Date(r.checkOut) && d2 > new Date(r.checkIn));
      if (overlap) return res.redirect(`/book/${req.params.id}?error=overlap`);
    }

    let nights = 0, totalPrice = 0;
    if (bookingType === 'daily' && checkIn && checkOut) {
      const d1 = new Date(checkIn), d2 = new Date(checkOut);
      nights = Math.max(1, Math.round((d2 - d1) / 86400000));
      totalPrice = nights * (listing.price_daily || 0);
    } else if (bookingType === 'annual') {
      totalPrice = listing.price_annual || 0;
    } else if (bookingType === 'inquiry') {
      totalPrice = listing.price_sale || listing.price_annual || 0;
    }

    const booking = await new Booking({
      listing: listing._id, listingTitle: listing.title,
      building: listing.building, apt: listing.apt,
      name, phone, email, bookingType,
      checkIn: checkIn ? new Date(checkIn) : undefined,
      checkOut: checkOut ? new Date(checkOut) : undefined,
      guests: parseInt(guests) || 1, nights, totalPrice, notes,
    }).save();

    sendEmail(
      `🏠 حجز جديد — ${listing.title}`,
      `<div dir="rtl" style="font-family:Arial;line-height:2;">
        <h2 style="color:#d4af37;">طلب حجز جديد</h2>
        <p><b>العقار:</b> ${listing.title}</p>
        <p><b>الاسم:</b> ${name}</p>
        <p><b>الهاتف:</b> <a href="https://wa.me/${phone.replace(/^0/,'966')}">${phone}</a></p>
        <p><b>نوع الحجز:</b> ${bookingType === 'daily' ? 'يومي' : bookingType === 'annual' ? 'شهري' : 'استفسار'}</p>
        ${checkIn ? `<p><b>الوصول:</b> ${checkIn}</p>` : ''}
        ${checkOut ? `<p><b>المغادرة:</b> ${checkOut}</p>` : ''}
        ${totalPrice ? `<p><b>الإجمالي:</b> ${totalPrice.toLocaleString()} ريال</p>` : ''}
        ${notes ? `<p><b>ملاحظات:</b> ${notes}</p>` : ''}
        <hr><a href="https://finsight-web-xi.vercel.app/dashboard" style="color:#d4af37;">فتح الداشبورد</a>
      </div>`
    );
    res.redirect(`/booking/success?id=${booking._id}&name=${encodeURIComponent(name)}&listing=${encodeURIComponent(listing.title)}`);
  } catch (e) { res.redirect('/listings'); }
});

router.get('/booking/success', (req, res) => {
  res.render('book-success', {
    name: req.query.name || '',
    listingTitle: req.query.listing || '',
    bookingId: req.query.id || '',
  });
});

router.get('/inquiry', (req, res) => {
  res.render('inquiry', {
    building: req.query.building || '',
    apartment: req.query.apartment || '',
    success: false,
    buildings: Object.keys(BUILDINGS)
  });
});

router.post('/inquiry', async (req, res) => {
  try {
    const Inquiry = require('../models/Inquiry');
    await new Inquiry(req.body).save();
    const { name, phone, email, subject, message } = req.body;
    sendEmail(
      `💬 استفسار جديد — ${subject || 'استفسار عقاري'}`,
      `<div dir="rtl" style="font-family:Arial;line-height:2;">
        <h2 style="color:#d4af37;">استفسار جديد</h2>
        <p><b>الاسم:</b> ${name}</p>
        <p><b>الهاتف:</b> <a href="https://wa.me/${(phone||'').replace(/^0/,'966')}">${phone}</a></p>
        ${email ? `<p><b>الإيميل:</b> ${email}</p>` : ''}
        ${subject ? `<p><b>الموضوع:</b> ${subject}</p>` : ''}
        ${message ? `<p><b>الرسالة:</b> ${message}</p>` : ''}
        <hr><a href="https://finsight-web-xi.vercel.app/dashboard" style="color:#d4af37;">فتح الداشبورد</a>
      </div>`
    );
    res.render('inquiry', { building: '', apartment: '', success: true, buildings: Object.keys(BUILDINGS) });
  } catch (e) {
    res.render('inquiry', { building: '', apartment: '', success: false, buildings: Object.keys(BUILDINGS), error: 'حدث خطأ، حاول مجدداً' });
  }
});

router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const Listing = require('../models/Listing');
  let listings = [];
  if (q) {
    listings = await Listing.find({
      available: true,
      $or: [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { location: { $regex: q, $options: 'i' } },
        { building: { $regex: q, $options: 'i' } },
      ]
    }).sort({ featured: -1, createdAt: -1 }).limit(24).lean();
  }
  res.render('search', { listings, q });
});

module.exports = router;
