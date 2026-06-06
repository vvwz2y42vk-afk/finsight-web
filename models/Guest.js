const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  phone:        { type: String, required: true, trim: true },
  idType:       { type: String, default: '' },
  idNumber:     { type: String, default: '' },
  idIssuePlace: { type: String, default: '' },
  idExpiry:     { type: Date, default: null },
  nationality:  { type: String, default: '' },
  email:        { type: String, default: '' },
  employer:     { type: String, default: '' },
  workPhone:    { type: String, default: '' },
  buildingNo:   { type: String, default: '' },
  subNo:        { type: String, default: '' },
  district:     { type: String, default: '' },
  country:      { type: String, default: '' },
  postalCode:   { type: String, default: '' },
  notes:        { type: String, default: '' },
  propertyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null },
  building:     { type: String, default: '' },
  totalBookings:{ type: Number, default: 1 },
  lastSeen:     { type: Date, default: Date.now },
  category:     { type: String, enum: ['regular', 'vip', 'blocked'], default: 'regular' },
}, { timestamps: true });

schema.index({ phone: 1, propertyId: 1 }, { unique: true });
schema.index({ propertyId: 1, building: 1 });
schema.index({ name: 1 });

module.exports = mongoose.model('Guest', schema);
