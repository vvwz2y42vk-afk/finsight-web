const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  category:     { type: String, enum: ['rental_apartment','rental_commercial','sale_land','sale_apartment'], default: 'rental_apartment' },
  building:     String,
  apt:          String,
  floor:        String,
  location:     String,
  title:        { type: String, required: true },
  description:  String,
  type:         { type: String, enum: ['daily','annual','both'], default: 'both' },
  price_daily:  { type: Number, default: 0 },
  price_annual: { type: Number, default: 0 },
  price_sale:   { type: Number, default: 0 },
  bedrooms:     { type: Number, default: 1 },
  bathrooms:    { type: Number, default: 1 },
  area:         { type: Number, default: 0 },
  frontage:     { type: Number, default: 0 },
  maxGuests:    { type: Number, default: 4 },
  amenities:    [String],
  photos:       [String],
  available:    { type: Boolean, default: true },
  featured:     { type: Boolean, default: false },
  blockedRanges: [{
    checkIn:   Date,
    checkOut:  Date,
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  }],
  // Host ownership (null = Barez's own listing)
  host:               { type: mongoose.Schema.Types.ObjectId, ref: 'Host', default: null },
  // Extra details
  houseRules:         String,
  checkInTime:        { type: String, default: '15:00' },
  checkOutTime:       { type: String, default: '11:00' },
  cancellationPolicy: { type: String, enum: ['flexible','moderate','strict'], default: 'moderate' },
  minNights:          { type: Number, default: 1 },
  avgRating:          { type: Number, default: 0 },
  reviewCount:        { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Listing', listingSchema);
