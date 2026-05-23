const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  listing:      { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
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
  status:       { type: String, enum: ['pending','confirmed','cancelled'], default: 'pending' },
  notes:        String,
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);
