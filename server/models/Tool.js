const mongoose = require('mongoose');

const toolHistorySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['Created', 'Updated', 'Issued', 'Returned', 'Deleted'],
    required: true
  },
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  actorName: {
    type: String,
    default: ''
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  targetUserName: {
    type: String,
    default: ''
  },
  note: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const toolSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  type: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  model: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  serial_number: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  mac_address: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  po_number: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  vendor_name: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  registered_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  comment: {
    type: String,
    default: '',
    trim: true
  },
  location: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  locationStore: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    default: null,
    index: true
  },
  locationDetail: {
    type: String,
    default: '',
    trim: true
  },
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    index: true
  },
  status: {
    type: String,
    enum: ['Available', 'Issued', 'Maintenance', 'Retired'],
    default: 'Available',
    index: true
  },
  currentHolder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  /** When issued to a non-system person (no User row). Cleared when returned or status ≠ Issued. */
  externalHolder: {
    name: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true }
  },
  history: {
    type: [toolHistorySchema],
    default: []
  }
}, { timestamps: true });

toolSchema.index({ store: 1, serial_number: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Tool', toolSchema);

