const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  name:     { type: String, required: true },
  phone:    { type: String, required: true },
  email:    String,
  building: String,
  budget:   String,
  duration: String,
  message:  String,
  status:   { type: String, default: 'جديد', enum: ['جديد', 'تم التواصل', 'تم الحجز', 'ملغي'] },
}, { timestamps: true });

inquirySchema.index({ status: 1 });
inquirySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Inquiry', inquirySchema);
