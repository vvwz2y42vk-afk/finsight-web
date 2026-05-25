const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const schema = new mongoose.Schema({
  name:     { type: String, required: true },
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  building: { type: String, required: true },
  role:     { type: String, enum: ['receptionist','manager'], default: 'receptionist' },
  active:   { type: Boolean, default: true },
}, { timestamps: true });
schema.pre('save', async function() {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 10);
});
schema.methods.comparePassword = function(p) { return bcrypt.compare(p, this.password); };
module.exports = mongoose.model('StaffUser', schema);
