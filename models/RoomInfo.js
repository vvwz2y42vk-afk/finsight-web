const mongoose = require('mongoose');
const roomInfoSchema = new mongoose.Schema({
  building: { type: String, required: true },
  apt:      { type: String, required: true },
  roomType: { type: String, default: '' },
  beds:     { type: String, default: '' },
}, { timestamps: true });
roomInfoSchema.index({ building: 1, apt: 1 }, { unique: true });
module.exports = mongoose.model('RoomInfo', roomInfoSchema);
