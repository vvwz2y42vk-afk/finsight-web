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
  propertyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Property', index: true, default: null },
}, { timestamps: true });

bookingSchema.index({ status: 1 });
bookingSchema.index({ listing: 1 });
bookingSchema.index({ building: 1, apt: 1 });
bookingSchema.index({ createdAt: -1 });
bookingSchema.index({ building: 1, status: 1 });
bookingSchema.index({ propertyId: 1, status: 1 });
bookingSchema.index({ checkIn: 1 });
bookingSchema.index({ checkOut: 1 });
bookingSchema.index({ phone: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
