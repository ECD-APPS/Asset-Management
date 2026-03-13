const mongoose = require('mongoose');

const backupLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['backup_created', 'backup_deleted', 'backup_restored', 'restore_failed', 'backup_failed', 'cloud_sync_failed'],
    required: true,
    index: true
  },
  backupId: { type: mongoose.Schema.Types.ObjectId, ref: 'BackupArtifact', default: null, index: true },
  backupName: { type: String, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedByEmail: { type: String, default: '' },
  details: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

backupLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('BackupLog', backupLogSchema);
