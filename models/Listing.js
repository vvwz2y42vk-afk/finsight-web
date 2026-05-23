const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  category:     { type: String, enum: ['rental_apartment','rental_commercial','sale_land'], default: 'rental_apartment' },
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
}, { timestamps: true });

module.exports = mongoose.model('Listing', listingSchema);
