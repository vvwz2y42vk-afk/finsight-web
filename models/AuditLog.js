const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user:     { type: String, required: true },
  role:     { type: String },
  action:   { type: String, required: true, enum: ['create', 'update', 'delete', 'login', 'approve', 'reject'] },
  model:    { type: String, required: true },
  recordId: { type: String },
  summary:  { type: String },
  changes:  { type: mongoose.Schema.Types.Mixed },
  ip:       { type: String },
}, { timestamps: true });

schema.index({ user: 1 });
schema.index({ model: 1, action: 1 });
schema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', schema);
