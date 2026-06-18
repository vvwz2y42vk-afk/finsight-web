const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  customer:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  customerName:  String,
  customerPhone: String,
  listingTitle:  String,
  subject:       { type: String, default: 'استفسار عام' },
  status:        { type: String, enum: ['open','closed'], default: 'open' },
  unreadAdmin:   { type: Number, default: 0 },
  unreadCustomer:{ type: Number, default: 0 },
  lastAt:        { type: Date, default: Date.now },
}, { timestamps: true });

schema.index({ customer: 1 });
schema.index({ status: 1, lastAt: -1 });

module.exports = mongoose.model('Conversation', schema);
