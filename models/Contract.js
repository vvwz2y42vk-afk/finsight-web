const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  id:    { type: String, required: true, unique: true },
  n:     String,   // name
  sheet: String,   // building
  a:     String,   // apartment
  v:     { type: Number, default: 0 },   // value
  p:     { type: Number, default: 0 },   // paid
  r:     { type: Number, default: 0 },   // remaining
  en:    String,   // entry date
  ex:    String,   // exit date
  ph:    String,   // phone
  st:    String,   // status
  py:    String,   // payment status
  src:   String,   // source
  type:  String,   // contract type
  notes: String,
  ej:    { type: Number, default: 0 },  // ejar fee
  pm:    String,   // payment method
}, { timestamps: true });

contractSchema.index({ id: 1 }, { unique: true });
contractSchema.index({ st: 1 });
contractSchema.index({ ex: 1 });
contractSchema.index({ sheet: 1, st: 1 });
contractSchema.index({ st: 1, ex: 1 });

module.exports = mongoose.model('Contract', contractSchema);
