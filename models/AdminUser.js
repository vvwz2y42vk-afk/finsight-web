const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const schema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['admin', 'manager', 'employee'], required: true },
  avatar:   { type: String, default: '؟' },
  allowed:  { type: [String], default: [] },
  active:   { type: Boolean, default: true },
}, { timestamps: true });

schema.index({ username: 1 });
schema.index({ active: 1 });

schema.pre('save', async function() {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12);
});

schema.methods.comparePassword = function(p) {
  return bcrypt.compare(p, this.password);
};

module.exports = mongoose.model('AdminUser', schema);
