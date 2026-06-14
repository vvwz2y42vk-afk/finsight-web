const mongoose = require('mongoose');

const channelListingSchema = new mongoose.Schema({
  building:         { type: String, required: true },
  apt:              { type: String, required: true },
  propertyId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null },
  platform:         { type: String, enum: ['airbnb','booking','gathering'], required: true },
  enabled:          { type: Boolean, default: true },
  platformListingId:String,
  icalImport:       String,
  lastSync:         Date,
  lastSyncStatus:   { type: String, enum: ['ok','error','never'], default: 'never' },
  lastSyncMsg:      String,
  lastEventCount:   { type: Number, default: 0 },
}, { timestamps: true });

channelListingSchema.index({ building: 1, apt: 1, platform: 1 }, { unique: true });
channelListingSchema.index({ building: 1, platform: 1 });
channelListingSchema.index({ propertyId: 1 });

module.exports = mongoose.model('ChannelListing', channelListingSchema);
