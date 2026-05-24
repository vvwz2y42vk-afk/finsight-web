const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const hostSchema = new mongoose.Schema({
  name:            { type: String, required: true, trim: true },
  phone:           { type: String, required: true, unique: true, trim: true },
  password:        { type: String, required: true },
  email:           { type: String, trim: true },
  nationalId:      { type: String, trim: true },
  nationality:     { type: String, default: 'سعودي' },
  bio:             { type: String, trim: true },
  avatar:          String,
  // Bank details for payouts
  iban:            { type: String, trim: true },
  bankName:        { type: String, trim: true },
  // Admin approval
  status:          { type: String, enum: ['pending','approved','rejected','suspended'], default: 'pending' },
  rejectionReason: String,
  // Stats
  rating:          { type: Number, default: 0 },
  reviewCount:     { type: Number, default: 0 },
}, { timestamps: true });

hostSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

hostSchema.methods.comparePassword = function(pw) {
  return bcrypt.compare(pw, this.password);
};

module.exports = mongoose.model('Host', hostSchema);
