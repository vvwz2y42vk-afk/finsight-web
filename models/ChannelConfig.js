const mongoose = require('mongoose');

const channelConfigSchema = new mongoose.Schema({
  building:    { type: String, required: true },
  propertyId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null },
  platform:    { type: String, enum: ['airbnb','booking','gathering','website'], required: true },
  enabled:     { type: Boolean, default: false },
  icalImport:  String,   // URL to fetch from their platform
  icalSecret:  String,   // secret token for our outgoing iCal
  apiKey:      String,
  apiSecret:   String,
  hotelId:     String,   // booking.com hotel ID / gathering property ID
  lastSync:    Date,
  lastSyncStatus: { type: String, enum: ['ok','error','never'], default: 'never' },
  lastSyncMsg: String,
  notifyEmail: String,   // override email for channel notifications
}, { timestamps: true });

channelConfigSchema.index({ building: 1, platform: 1 });
channelConfigSchema.index({ propertyId: 1, platform: 1 });

module.exports = mongoose.model('ChannelConfig', channelConfigSchema);
