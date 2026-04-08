const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  item_name: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  description: { type: String, default: '' },
  request_type: { type: String, default: 'General' },
  status: { type: String, enum: ['Pending', 'Approved', 'Ordered', 'Rejected'], default: 'Pending' },
  admin_note: { type: String, default: '' },
  ppm_task: { type: mongoose.Schema.Types.ObjectId, ref: 'PpmTask', default: null },
  asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', default: null },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true }
}, { timestamps: true });

// Index for fetching requests by store and status
requestSchema.index({ store: 1, status: 1 });
requestSchema.index({ requester: 1 });

module.exports = mongoose.model('Request', requestSchema);

