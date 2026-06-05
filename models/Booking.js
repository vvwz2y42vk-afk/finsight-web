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
  paidAmount:   { type: Number, default: 0 },
  idType:       { type: String, enum: ['national_id','passport','iqama','family_card',''], default: '' },
  idNumber:     String,
  source:       String,
  pricePerNight: Number,
  pricePerMonth: Number,
}, { timestamps: true });

bookingSchema.index({ status: 1 });
bookingSchema.index({ listing: 1 });
bookingSchema.index({ building: 1, apt: 1 });
bookingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Booking', bookingSchema);
