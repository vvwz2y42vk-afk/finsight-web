const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  building:  { type: String, required: true },
  apt:       { type: String, required: true },
  status:    { type: String, enum: ['clean','dirty','inspecting','maintenance'], default: 'clean' },
  notes:     { type: String, default: '' },
  updatedBy: String,
}, { timestamps: true });
schema.index({ building: 1, apt: 1 }, { unique: true });
module.exports = mongoose.model('HousekeepingTask', schema);
