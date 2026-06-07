const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  waMessageId: { type: String },
  from:        { type: String, required: true },
  fromName:    { type: String, default: null },
  to:          { type: String, required: true },
  body:        { type: String, default: '' },
  direction:   { type: String, enum: ['in','out'], required: true },
  msgType:     { type: String, default: 'text' },
  mediaUrl:    { type: String, default: null },
  status:      { type: String, enum: ['sending','sent','delivered','read','failed'], default: 'sent' },
  read:        { type: Boolean, default: false },
  sentAt:      { type: Date, default: Date.now },
  agentId:     { type: String, default: null },
  agentName:   { type: String, default: null },
}, { timestamps: true });

schema.index({ waMessageId: 1 }, { unique: true, sparse: true });
schema.index({ from: 1, sentAt: -1 });
schema.index({ to: 1, sentAt: -1 });
schema.index({ direction: 1, read: 1, sentAt: -1 });

module.exports = mongoose.model('WaMessage', schema);
