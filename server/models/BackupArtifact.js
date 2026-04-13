const mongoose = require('mongoose');

const backupArtifactSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true },
  sizeBytes: { type: Number, default: 0 },
  backupType: { type: String, enum: ['Full', 'Incremental', 'Auto'], default: 'Full', index: true },
  appVersion: { type: String, default: 'unknown' },
  databaseVersion: { type: String, default: 'mongodb' },
  status: { type: String, enum: ['ready', 'failed', 'restoring'], default: 'ready', index: true },
  trigger: { type: String, enum: ['manual', 'scheduled', 'pre-update', 'emergency', 'rollback'], default: 'manual' },
  cloud: {
    synced: { type: Boolean, default: false },
    provider: { type: String, default: '' },
    objectKey: { type: String, default: '' },
    syncedAt: { type: Date, default: null },
    error: { type: String, default: '' }
  },
  metadata: {
    backupTool: { type: String, default: '' },
    pbmBackupName: { type: String, default: '' },
    pbmDescribe: { type: mongoose.Schema.Types.Mixed, default: undefined },
    pbmFallbackToFull: { type: Boolean, default: false },
    immutable: { type: mongoose.Schema.Types.Mixed, default: undefined },
    collections: { type: Object, default: {} },
    includesFiles: { type: Boolean, default: true },
    fromBackupId: { type: mongoose.Schema.Types.ObjectId, ref: 'BackupArtifact', default: null },
    note: { type: String, default: '' },
    manifestVersion: { type: Number, default: 1 },
    checksumSha256: { type: String, default: '' },
    chain: {
      previousBackupId: { type: mongoose.Schema.Types.ObjectId, ref: 'BackupArtifact', default: null },
      previousChecksumSha256: { type: String, default: '' },
      chainValid: { type: Boolean, default: true }
    },
    compatibility: {
      backupFormatVersion: { type: Number, default: 1 },
      appVersion: { type: String, default: 'unknown' },
      appMajor: { type: Number, default: 0 },
      minRestoreAppMajor: { type: Number, default: 0 },
      maxRestoreAppMajor: { type: Number, default: 0 }
    }
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now, index: true }
});

backupArtifactSchema.index({ createdAt: -1 });

module.exports = mongoose.model('BackupArtifact', backupArtifactSchema);
