const mongoose = require('mongoose');

const assetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    index: true
  },
  model_number: {
    type: String,
    required: false,
    index: true
  },
  serial_number: {
    type: String,
    required: false,
    index: true
  },
  serial_last_4: {
    type: String,
    required: false,
    index: true // Indexed for fast search
  },
  mac_address: {
    type: String,
    default: '',
    index: true
  },
  ticket_number: {
    type: String,
    default: '',
    index: true
  },
  po_number: {
    type: String,
    default: '',
    index: true
  },
  rfid: {
    type: String,
    default: '',
    index: true
  },
  qr_code: {
    type: String,
    default: '',
    index: true
  },
  uniqueId: {
    type: String,
    unique: true,
    sparse: true // Allows null/undefined values to exist (though we aim to fill them)
  },
  manufacturer: {
    type: String,
    default: '',
    index: true
  },
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: false,
    index: true
  },
  location: {
    type: String,
    default: '',
    index: true
  },
  product_name: {
    type: String,
    index: true
  },
  status: {
    type: String,
    enum: ['In Store', 'In Use', 'Missing'],
    default: 'In Store',
    index: true
  },
  previous_status: {
    type: String,
    enum: ['In Store', 'In Use', 'Missing'],
    default: null
  },
  condition: {
    type: String,
    enum: ['New', 'Used', 'Faulty', 'Repaired'],
    default: 'New',
    index: true
  },
  assigned_to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  assigned_to_external: {
    name: String,
    email: String,
    phone: String,
    note: String
  },
  vendor_name: {
    type: String,
    default: '',
    index: true
  },
  source: {
    type: String,
    default: 'Initial Setup',
    index: true
  },
  return_pending: {
    type: Boolean,
    default: false,
    index: true // Indexed for quick return checks
  },
  return_request: {
    condition: { type: String, enum: ['New', 'Used', 'Faulty', 'Repaired'] },
    requested_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ticket_number: String,
    notes: String
  },
  reserved: {
    type: Boolean,
    default: false,
    index: true
  },
  reserved_at: {
    type: Date,
    default: null
  },
  reserved_by: {
    type: String,
    default: ''
  },
  reservation_note: {
    type: String,
    default: ''
  },
  history: {
    type: [
      {
        action: String,
        ticket_number: String,
        details: String,
        user: String,
        date: { type: Date, default: Date.now }
      }
    ],
    default: []
  },
  delivered_by_name: {
    type: String,
    default: ''
  },
  delivered_at: {
    type: Date
  }
  ,
  disposed: {
    type: Boolean,
    default: false,
    index: true
  },
  disposed_at: {
    type: Date,
    default: null
  },
  disposed_by: {
    type: String,
    default: ''
  },
  disposal_reason: {
    type: String,
    default: ''
  },
  importBatchId: {
    type: String,
    index: true
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  },
  price: {
    type: Number,
    default: 0
  },
  customFields: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

// Compound Indexes for Common Filters
assetSchema.index({ store: 1, status: 1 });
assetSchema.index({ store: 1, serial_number: 1 }); // For duplicate checks
assetSchema.index({ store: 1, model_number: 1 });

module.exports = mongoose.model('Asset', assetSchema);
