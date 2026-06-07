const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  waMessageId: { type: String },
  from:        { type: String, required: true },
  to:          { type: String, required: true },
  body:        { type: String, default: '' },
  direction:   { type: String, enum: ['in','out'], required: true },
  msgType:     { type: String, default: 'text' },
  mediaUrl:    String,
  read:        { type: Boolean, default: false },
  sentAt:      { type: Date, default: Date.now },
}, { timestamps: true });

schema.index({ waMessageId: 1 }, { unique: true, sparse: true });
schema.index({ from: 1, sentAt: -1 });
schema.index({ to: 1, sentAt: -1 });

module.exports = mongoose.model('WaMessage', schema);
