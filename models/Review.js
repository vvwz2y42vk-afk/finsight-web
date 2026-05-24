const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  listing:  { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  booking:  { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  customerName: { type: String, required: true },
  rating:   { type: Number, required: true, min: 1, max: 5 },
  comment:  { type: String, trim: true, maxlength: 600 },
}, { timestamps: true });

module.exports = mongoose.model('Review', reviewSchema);
