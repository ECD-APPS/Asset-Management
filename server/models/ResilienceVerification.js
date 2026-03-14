const mongoose = require('mongoose');

const resilienceVerificationSchema = new mongoose.Schema({
  backupId: { type: mongoose.Schema.Types.ObjectId, ref: 'BackupArtifact', default: null, index: true },
  backupName: { type: String, default: '' },
  status: { type: String, enum: ['passed', 'failed'], required: true, index: true },
  summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  details: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

resilienceVerificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ResilienceVerification', resilienceVerificationSchema);
