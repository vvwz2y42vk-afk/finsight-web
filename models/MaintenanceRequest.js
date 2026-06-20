const mongoose = require('mongoose');
const s = new mongoose.Schema({
  building:    { type: String, default: '' },
  apt:         { type: String, default: '' },
  propertyId:  { type: mongoose.Schema.Types.ObjectId, default: null },
  type:        { type: String, enum: ['electrical','plumbing','furniture','ac','internet','other'], default: 'other' },
  description: { type: String, default: '' },
  priority:    { type: String, enum: ['urgent','medium','normal'], default: 'normal' },
  imageUrl:    { type: String, default: '' },
  imagePublicId:{ type: String, default: '' },
  status:      { type: String, enum: ['new','in_progress','done'], default: 'new' },
  reportedBy:  { type: String, default: '' },
  assignedTo:  { type: String, default: '' },
  notes:       { type: String, default: '' },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
});
s.index({ building: 1, createdAt: -1 });
s.index({ propertyId: 1, status: 1 });
module.exports = mongoose.models.MaintenanceRequest || mongoose.model('MaintenanceRequest', s);
