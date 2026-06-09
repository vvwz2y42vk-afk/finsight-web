const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user:     { type: String, required: true, immutable: true },
  role:     { type: String,                 immutable: true },
  action:   { type: String, required: true, immutable: true, enum: ['create', 'update', 'delete', 'login', 'approve', 'reject'] },
  model:    { type: String, required: true, immutable: true },
  recordId: { type: String,                 immutable: true },
  summary:  { type: String,                 immutable: true },
  changes:  { type: mongoose.Schema.Types.Mixed, immutable: true },
  ip:       { type: String,                 immutable: true },
}, { timestamps: true });

// ── Immutability guards ──────────────────────────────────
// Audit log records must never be modified or deleted after creation.
schema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('AuditLog: تعديل السجلات محظور'));
  next();
});

const BLOCKED_OPS = {
  'AuditLog: تعديل السجلات محظور': ['findOneAndUpdate','updateOne','updateMany','findByIdAndUpdate','replaceOne'],
  'AuditLog: حذف السجلات محظور':  ['findOneAndDelete','deleteOne','deleteMany','findByIdAndDelete'],
};
Object.entries(BLOCKED_OPS).forEach(([msg, ops]) =>
  ops.forEach(op => schema.pre(op, function(next){ next(new Error(msg)); }))
);

schema.index({ user: 1 });
schema.index({ model: 1, action: 1 });
schema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', schema);
