const mongoose = require('mongoose');
const s = new mongoose.Schema({
  building:   { type: String, default: '' },
  propertyId: { type: mongoose.Schema.Types.ObjectId, default: null },
  type:       { type: String, default: 'info' }, // 'receipt_mismatch' | 'urgent_maintenance' | ...
  title:      { type: String, default: '' },
  message:    { type: String, default: '' },
  data:       { type: mongoose.Schema.Types.Mixed, default: {} },
  isRead:     { type: Boolean, default: false },
  createdAt:  { type: Date, default: Date.now },
});
s.index({ building: 1, isRead: 1, createdAt: -1 });
s.index({ propertyId: 1, isRead: 1, createdAt: -1 });
module.exports = mongoose.models.Notification || mongoose.model('Notification', s);
