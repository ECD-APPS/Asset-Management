const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  isMainStore: {
    type: Boolean,
    default: false,
    index: true
  },
  parentStore: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    default: null,
    index: true
  },
  deletionRequested: {
    type: Boolean,
    default: false
  },
  deletionRequestedAt: {
    type: Date
  },
  deletionRequestedBy: {
    type: String, // Store email or name of requester
    default: null
  },
  appTheme: {
    type: String,
    enum: ['default', 'ocean', 'emerald', 'sunset', 'midnight', 'mono', 'glossy', 'astraLight', 'astraExecutive'],
    default: 'default'
  },
  emailConfig: {
    smtpHost: { type: String, default: '' },
    smtpPort: { type: Number, default: 587 },
    username: { type: String, default: '' },
    password: { type: String, default: '' },
    encryption: { type: String, enum: ['TLS', 'SSL'], default: 'TLS' },
    fromEmail: { type: String, default: '' },
    fromName: { type: String, default: '' },
    ppmNotificationSubject: { type: String, default: 'Expo City Dubai PPM Notification' },
    assetNotificationSubject: { type: String, default: 'Expo City Dubai Asset Notification' },
    notificationRecipients: [{ type: String, trim: true, lowercase: true }],
    lineManagerRecipients: [{ type: String, trim: true, lowercase: true }],
    requireLineManagerApprovalForCollection: { type: Boolean, default: false },
    collectionApprovalRecipients: [{ type: String, trim: true, lowercase: true }],
    enabled: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedAt: { type: Date, default: null }
  }
}, { timestamps: true });

// Keep names unique only within the same parent store scope.
storeSchema.index({ parentStore: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('Store', storeSchema);
