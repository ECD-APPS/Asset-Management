const mongoose = require('mongoose');

const changeJournalSchema = new mongoose.Schema({
  seq: { type: Number, required: true, unique: true, index: true },
  opType: {
    type: String,
    required: true,
    enum: ['insert', 'update', 'delete', 'snapshot', 'restore', 'verify', 'shadow_sync', 'promotion', 'marker', 'archive'],
    index: true
  },
  collectionName: { type: String, default: '', index: true },
  documentId: { type: String, default: '', index: true },
  actorId: { type: String, default: '' },
  actorEmail: { type: String, default: '' },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  prevHash: { type: String, required: true, default: 'GENESIS' },
  entryHash: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now, index: true }
});

changeJournalSchema.index({ createdAt: -1 });
changeJournalSchema.index({ seq: -1 });

module.exports = mongoose.model('ChangeJournal', changeJournalSchema);
