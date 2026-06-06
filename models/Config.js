const mongoose = require('mongoose');

const peakSchema = new mongoose.Schema({
  name:       { type: String, default: '' },
  startDate:  { type: Date },
  endDate:    { type: Date },
  multiplier: { type: Number, default: 1.5 },
}, { _id: false });

const schema = new mongoose.Schema({
  key:           { type: String, required: true, unique: true }, // propertyId.toString() or 'internal'
  vatRate:       { type: Number, default: 15 },
  contractTerms: { type: String, default: '' },
  expenseItems:  [{ type: String }],
  peakPeriods:   [peakSchema],
}, { timestamps: true });

module.exports = mongoose.model('Config', schema);
