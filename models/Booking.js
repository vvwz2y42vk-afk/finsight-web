const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  listing:      { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
  customer:     { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  listingTitle: String,
  building:     String,
  apt:          String,
  name:         { type: String, required: true },
  phone:        { type: String, required: true },
  email:        String,
  bookingType:  { type: String, enum: ['daily','annual','inquiry'], required: true },
  checkIn:      Date,
  checkOut:     Date,
  guests:       { type: Number, default: 1 },
  nights:       Number,
  totalPrice:   Number,
  status:       { type: String, enum: ['pending','awaiting_payment','awaiting_checkin','active','checkout','cancelled'], default: 'pending' },
  notes:        String,
  paymentId:    String,
  paidAt:       Date,
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);
