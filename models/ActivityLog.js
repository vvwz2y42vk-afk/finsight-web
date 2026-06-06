const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  building:  String,
  staffName: String,
  action:    { type: String, enum: ['check_in','check_out','status_change','housekeeping','booking_add'] },
  apt:       String,
  guestName: String,
  bookingId: mongoose.Schema.Types.ObjectId,
  details:    String,
  propertyId: { type: require('mongoose').Schema.Types.ObjectId, ref: 'Property', default: null },
}, { timestamps: true });
schema.index({ building: 1, propertyId: 1 });
schema.index({ createdAt: -1 });
schema.index({ propertyId: 1, createdAt: -1 });
module.exports = mongoose.model('ActivityLog', schema);
