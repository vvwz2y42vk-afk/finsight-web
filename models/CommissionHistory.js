const mongoose = require('mongoose');

const commissionHistorySchema = new mongoose.Schema({
  key:   String,
  label: String,
  comm:  Array,
}, { timestamps: true });

module.exports = mongoose.model('CommissionHistory', commissionHistorySchema);
