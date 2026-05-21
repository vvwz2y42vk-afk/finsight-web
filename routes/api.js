const express = require('express');
const router = express.Router();
const Contract = require('../models/Contract');
const Inquiry = require('../models/Inquiry');
const CommissionHistory = require('../models/CommissionHistory');

const auth = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ error: 'غير مخوّل' });
};

// ─── Auto-close expired contracts ────────────────────────
async function autoCloseExpired() {
  const contracts = await Contract.find({ st: { $nin: ['مغلق'] }, ex: { $ne: '' } }).lean();
  const today = new Date(); today.setHours(0,0,0,0);
  const toClose = contracts.filter(c => {
    if (!c.ex) return false;
    const parts = String(c.ex).trim().split('/');
    if (parts.length !== 3) return false;
    const d = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`);
    return !isNaN(d) && d < today;
  });
  if (toClose.length) {
    await Promise.all(toClose.map(c => Contract.updateOne({ id: c.id }, { st: 'مغلق' })));
  }
}

// ─── Contracts ────────────────────────────────────────────
router.get('/contracts', auth, async (req, res) => {
  try {
    await autoCloseExpired();
    const contracts = await Contract.find().lean();
    res.json(contracts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/contracts', auth, async (req, res) => {
  try {
    await Contract.findOneAndUpdate(
      { id: req.body.id },
      req.body,
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/contracts/:id', auth, async (req, res) => {
  try {
    await Contract.findOneAndUpdate({ id: req.params.id }, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/contracts/:id', auth, async (req, res) => {
  try {
    await Contract.findOneAndDelete({ id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk save (initial seed)
router.post('/contracts/bulk', auth, async (req, res) => {
  try {
    const { contracts } = req.body;
    if (!contracts || !contracts.length) return res.json({ success: false });
    for (const c of contracts) {
      await Contract.findOneAndUpdate({ id: c.id }, c, { upsert: true });
    }
    res.json({ success: true, count: contracts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Commissions History ──────────────────────────────────
router.get('/commission-history', auth, async (req, res) => {
  try {
    const history = await CommissionHistory.find().sort({ createdAt: -1 }).lean();
    res.json(history);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/commission-history', auth, async (req, res) => {
  try {
    const { key, label, comm } = req.body;
    await CommissionHistory.findOneAndUpdate({ key }, { key, label, comm }, { upsert: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Available Apartments (public) ───────────────────────
router.get('/apartments/available', async (req, res) => {
  try {
    const active = await Contract.find(
      { st: { $in: ['مفتوح', 'بانتظار دخول العميل'] }, n: { $exists: true, $ne: '' } },
      'sheet a'
    ).lean();
    const occupiedSet = new Set(active.map(c => `${c.sheet}-${c.a}`));

    const BUILDINGS = {
      'المنارا':  ['001','002','101','102','103','104','105','106','201','202','203','204','205','206','301','302','303','304','305','306','401','402','403','404','405','406','501','502','503','504'],
      'جوان ان': ['001','002','003','004','101','102','103','104','105','201','202','203','204','205','301','302','303','304','305','306','401','402'],
      'الماسة':  ['101','102','103','104','105','106','201','202','203','204','301','302','303','304','305','306'],
      'الواحة':  ['001','002','003','004','101','102','103','104','105','106','107','108','201','202','203','204','205','206','207','208'],
    };

    const available = [];
    Object.entries(BUILDINGS).forEach(([building, apts]) => {
      apts.forEach(apt => {
        if (!occupiedSet.has(`${building}-${apt}`)) {
          available.push({ building, apartment: apt });
        }
      });
    });
    res.json(available);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Inquiries ────────────────────────────────────────────
router.post('/inquiries', async (req, res) => {
  try {
    const inquiry = new Inquiry(req.body);
    await inquiry.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/inquiries', auth, async (req, res) => {
  try {
    const inquiries = await Inquiry.find().sort({ createdAt: -1 }).lean();
    res.json(inquiries);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/inquiries/:id', auth, async (req, res) => {
  try {
    await Inquiry.findByIdAndUpdate(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── AI Chat (Gemini) ─────────────────────────────────────
router.post('/ai/chat', auth, async (req, res) => {
  try {
    const { message, context } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ text: 'مفتاح Gemini غير موجود في الإعدادات.' });

    const fullPrompt = `${context}\n\nسؤال المستخدم: ${message}`;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }]
        })
      }
    );
    const data = await response.json();
    if (data.error) return res.json({ text: `خطأ: ${data.error.message}` });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'لم يصل رد من الذكاء الاصطناعي.';
    res.json({ text });
  } catch (e) { res.status(500).json({ text: `تعذّر الاتصال: ${e.message}` }); }
});

module.exports = router;
