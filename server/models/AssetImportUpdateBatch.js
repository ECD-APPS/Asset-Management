const mongoose = require('mongoose');

const assetImportUpdateEntrySchema = new mongoose.Schema({
  assetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
  serial: { type: String, default: '' },
  changedFields: { type: [String], default: [] },
  previousValues: { type: mongoose.Schema.Types.Mixed, default: {} },
  nextValues: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const assetImportUpdateBatchSchema = new mongoose.Schema({
  importBatchId: { type: String, required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
  updates: { type: [assetImportUpdateEntrySchema], default: [] },
  totalRowsUpdated: { type: Number, default: 0 },
  totalColumnsUpdated: { type: Number, default: 0 },
  revertedAt: { type: Date, default: null },
  revertedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('AssetImportUpdateBatch', assetImportUpdateBatchSchema);

