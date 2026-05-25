const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  building:  String,
  staffName: String,
  action:    { type: String, enum: ['check_in','check_out','status_change','housekeeping','booking_add'] },
  apt:       String,
  guestName: String,
  bookingId: mongoose.Schema.Types.ObjectId,
  details:   String,
}, { timestamps: true });
module.exports = mongoose.model('ActivityLog', schema);
