const mongoose = require('mongoose');
const s = new mongoose.Schema({
  bookingId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  building:     { type: String, default: '' },
  apt:          { type: String, default: '' },
  guestName:    { type: String, default: '' },
  imageData:    String,
  imageMimeType:{ type: String, default: 'image/jpeg' },
  analysis: {
    paymentType:       String,   // 'network' | 'transfer' | 'cash' | 'other'
    amount:            Number,
    date:              String,
    transactionNumber: String,
    entityName:        String,
    matchesBuilding:   Boolean,
    cashTotal:         Number,   // sum of identified riyal bills (cash only)
    cashMatchesPaid:   Boolean,
    rawSummary:        String,
  },
  analysisStatus:  { type: String, default: 'pending' },
  status:          { type: String, enum: ['pending','linked','rejected'], default: 'pending' },
  rejectionReason: { type: String, default: '' },
  propertyId:      { type: mongoose.Schema.Types.ObjectId, default: null },
  createdAt:       { type: Date, default: Date.now },
  createdBy:       { type: String, default: '' },
});
s.index({ building: 1, createdAt: -1 });
s.index({ bookingId: 1 });
module.exports = mongoose.models.Receipt || mongoose.model('Receipt', s);
