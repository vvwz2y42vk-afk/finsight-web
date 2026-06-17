const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  building:    { type: String, required: true },
  type:        { type: String, enum: ['receipt','invoice','disbursement','check','tax'], required: true },
  number:      String,
  date:        { type: Date, default: Date.now },
  name:        String,
  phone:       String,
  apt:         String,
  amount:      { type: Number, default: 0 },
  description: String,
  notes:       String,
  checkNumber:   String,
  bankName:      String,
  dueDate:       Date,
  createdBy:     String,
  paymentMethod: { type: String, enum: ['cash','transfer','network','check','digital','travel_agent',''], default: '' },
  bookingId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  propertyId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null },
}, { timestamps: true });
schema.index({ propertyId: 1, building: 1 });
schema.index({ building: 1, type: 1 });
schema.index({ createdAt: -1 });
module.exports = mongoose.model('Voucher', schema);
