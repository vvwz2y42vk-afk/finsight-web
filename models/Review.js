const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  listing:  { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  booking:  { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  customerName: { type: String, required: true },
  rating:   { type: Number, required: true, min: 1, max: 5 },
  comment:  { type: String, trim: true, maxlength: 600 },
}, { timestamps: true });

reviewSchema.index({ booking: 1 }, { unique: true });
reviewSchema.index({ listing: 1 });
reviewSchema.index({ customer: 1 });

module.exports = mongoose.model('Review', reviewSchema);
