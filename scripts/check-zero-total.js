require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
mongoose.connect(process.env.MONGO_URI, { family:4, tls:true, tlsAllowInvalidCertificates:false }).then(async () => {
  const rows = await Booking.find(
    { building:'جوان ان', totalPrice: { $lte: 0 } },
    'source name apt status bookingType totalPrice paidAmount nights'
  ).lean();
  rows.forEach(b => console.log(
    b.source, '|', b.status, '|', b.bookingType, '|',
    b.name, '|', b.apt, '| total:', b.totalPrice, '| paid:', b.paidAmount, '| nights:', b.nights
  ));
  await mongoose.disconnect();
});
