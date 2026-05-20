const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => res.render('index', { stats: { totalContracts: 50, buildings: 4, totalUnits: 94, freeUnits: 12 } }));
app.get('/apartments', (req, res) => res.render('apartments', { available: {}, selectedBuilding: '', buildings: ['المنارا','جوان ان','الماسة','الواحة'] }));
app.get('/inquiry', (req, res) => res.render('inquiry', { building: '', apartment: '', success: false, buildings: ['المنارا','جوان ان','الماسة','الواحة'] }));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

app.listen(3000, () => console.log('🚀 http://localhost:3000'));
