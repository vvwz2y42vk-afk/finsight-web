const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const customerSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  phone:       { type: String, required: true, unique: true, trim: true },
  password:    { type: String, required: true },
  email:       { type: String, trim: true },
  nationalId:  { type: String, trim: true },
  nationality: { type: String, default: 'سعودي' },
  notes:            { type: String, default: '' },
  resetToken:       { type: String },
  resetTokenExpiry: { type: Date },
}, { timestamps: true });

customerSchema.index({ createdAt: -1 });
customerSchema.index({ resetTokenExpiry: 1 }, { expireAfterSeconds: 0, sparse: true });

customerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

customerSchema.methods.comparePassword = function(pw) {
  return bcrypt.compare(pw, this.password);
};

module.exports = mongoose.model('Customer', customerSchema);
