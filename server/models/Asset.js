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
    enum: ['In Store', 'In Use', 'Spare', 'Missing', 'Scrapped', 'Disposed', 'Faulty', 'Under Repair'],
    default: 'In Store',
    index: true
  },
  previous_status: {
    type: String,
    enum: ['New', 'Used', 'Faulty', 'Disposed', 'Under Repair', 'In Use', 'In Store', 'Testing'],
    default: null
  },
  condition: {
    type: String,
    enum: ['New', 'Used', 'Faulty', 'Repaired', 'Under Repair', 'Disposed', 'Scrapped'],
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
    enum: ['Vendor', 'Contractor', 'Technician', 'Initial Setup', 'Other'],
    default: 'Initial Setup',
    index: true
  },
  return_pending: {
    type: Boolean,
    default: false,
    index: true // Indexed for quick return checks
  },
  return_request: {
    condition: { type: String, enum: ['New', 'Used', 'Faulty', 'Under Repair'] },
    requested_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ticket_number: String,
    notes: String
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
  }
}, { timestamps: true });

// Compound Indexes for Common Filters
assetSchema.index({ store: 1, status: 1 });
assetSchema.index({ store: 1, serial_number: 1 }); // For duplicate checks
assetSchema.index({ store: 1, model_number: 1 });

module.exports = mongoose.model('Asset', assetSchema);
