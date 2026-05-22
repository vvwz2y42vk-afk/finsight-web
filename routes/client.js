const express = require('express');
const router = express.Router();
const Contract = require('../models/Contract');

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
    res.render('inquiry', { building: '', apartment: '', success: true, buildings: Object.keys(BUILDINGS) });
  } catch (e) {
    res.render('inquiry', { building: '', apartment: '', success: false, buildings: Object.keys(BUILDINGS), error: 'حدث خطأ، حاول مجدداً' });
  }
});

module.exports = router;
