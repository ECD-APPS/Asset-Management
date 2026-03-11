const mongoose = require('mongoose');

const collectionApprovalSchema = new mongoose.Schema({
  token: { type: String, required: true, index: true },
  asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
  technician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
  ticketNumber: { type: String, default: '' },
  installationLocation: { type: String, default: '' },
  lineManagerEmail: { type: String, default: '' },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Consumed'], default: 'Pending', index: true },
  approvedAt: { type: Date, default: null },
  approvedByEmail: { type: String, default: '' },
  consumedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('CollectionApproval', collectionApprovalSchema);
