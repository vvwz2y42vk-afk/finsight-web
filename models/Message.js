const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  from:         { type: String, enum: ['customer','admin'], required: true },
  senderName:   String,
  body:         { type: String, required: true, maxlength: 2000, trim: true },
}, { timestamps: true });
module.exports = mongoose.model('Message', schema);
