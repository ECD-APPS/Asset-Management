const mongoose = require('mongoose');

const resilienceJobSchema = new mongoose.Schema({
  jobType: {
    type: String,
    required: true,
    enum: ['restore_to_time', 'shadow_sync', 'shadow_promote', 'shadow_failback', 'verify_backup', 'upload_finalize', 'pitr_archive', 'checksum_audit', 'crash_recovery_check'],
    index: true
  },
  phase: {
    type: String,
    default: 'queued',
    enum: ['queued', 'validating', 'restoring', 'verifying', 'syncing', 'done', 'failed'],
    index: true
  },
  status: {
    type: String,
    default: 'queued',
    enum: ['queued', 'running', 'done', 'failed'],
    index: true
  },
  actorId: { type: String, default: '' },
  actorEmail: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  error: { type: String, default: '' },
  startedAt: { type: Date, default: Date.now, index: true },
  finishedAt: { type: Date, default: null }
});

resilienceJobSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ResilienceJob', resilienceJobSchema);
