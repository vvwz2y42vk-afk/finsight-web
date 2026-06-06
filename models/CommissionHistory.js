const mongoose = require('mongoose');

const commEntrySchema = new mongoose.Schema({
  month:    { type: Number, required: true },  // 1-12
  year:     { type: Number, required: true },
  amount:   { type: Number, default: 0 },
  paid:     { type: Boolean, default: false },
  paidAt:   Date,
  notes:    String,
}, { _id: false });

const commissionHistorySchema = new mongoose.Schema({
  key:   { type: String, required: true },
  label: { type: String, required: true },
  comm:  { type: [commEntrySchema], default: [] },
}, { timestamps: true });

commissionHistorySchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('CommissionHistory', commissionHistorySchema);
