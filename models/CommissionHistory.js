const mongoose = require('mongoose');

const commEntrySchema = new mongoose.Schema({
  id:    String,
  m:     String,
  c:     String,
  sh:    String,
  d:     String,
  a:     Number,
  proof: { url: String, ts: Date },
}, { _id: false, strict: false });

const commissionHistorySchema = new mongoose.Schema({
  key:   { type: String, required: true },
  label: { type: String, required: true },
  comm:  { type: [commEntrySchema], default: [] },
}, { timestamps: true });

commissionHistorySchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('CommissionHistory', commissionHistorySchema);
