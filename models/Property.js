const mongoose = require('mongoose');

const floorSchema = new mongoose.Schema({
  label: { type: String, default: '' },
  rooms: [{ type: String }],
}, { _id: false });

const buildingSchema = new mongoose.Schema({
  name:   { type: String, required: true },
  floors: [floorSchema],
}, { _id: false });

const schema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  type:        { type: String, enum: ['hotel', 'apartment', 'mixed'], default: 'apartment' },
  logo:        { type: String, default: '' },
  plan:        { type: String, enum: ['trial', 'basic', 'pro'], default: 'trial' },
  planExpiry:  { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  active:      { type: Boolean, default: true },
  buildings:   [buildingSchema],
  adminEmail:  { type: String, default: '' },
  phone:       { type: String, default: '' },
  city:        { type: String, default: '' },
}, { timestamps: true });

schema.index({ active: 1 });

module.exports = mongoose.model('Property', schema);
