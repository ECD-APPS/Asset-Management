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
    enum: ['In Store', 'In Use', 'Missing', 'Under Repair', 'Under Repair/Workshop'],
    default: 'In Store',
    index: true
  },
  previous_status: {
    type: String,
    enum: ['In Store', 'In Use', 'Missing', 'Under Repair', 'Under Repair/Workshop'],
    default: null
  },
  condition: {
    type: String,
    enum: ['New', 'Used', 'Faulty', 'Repaired', 'Workshop', 'Under Repair/Workshop'],
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
  device_group: {
    type: String,
    default: '',
    index: true
  },
  inbound_from: {
    type: String,
    default: '',
    index: true
  },
  outbound_to: {
    type: String,
    default: '',
    index: true
  },
  expo_tag: {
    type: String,
    default: '',
    index: true
  },
  abs_code: {
    type: String,
    default: '',
    index: true
  },
  product_number: {
    type: String,
    default: '',
    index: true
  },
  operating_system: {
    type: String,
    default: '',
    index: true
  },
  specification: {
    type: String,
    default: '',
    index: true
  },
  service_tag: {
    type: String,
    default: '',
    index: true
  },
  assign_to_department: {
    type: String,
    default: '',
    index: true
  },
  ip_address: {
    type: String,
    default: '',
    index: true
  },
  building: {
    type: String,
    default: '',
    index: true
  },
  state_comments: {
    type: String,
    default: ''
  },
  remarks: {
    type: String,
    default: ''
  },
  comments: {
    type: String,
    default: ''
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
        date: { type: Date, default: Date.now },
        actor_email: { type: String, default: '' },
        actor_role: { type: String, default: '' },
        previous_status: { type: String, default: '' },
        previous_condition: { type: String, default: '' },
        status: { type: String, default: '' },
        condition: { type: String, default: '' },
        location: { type: String, default: '' },
        store_name: { type: String, default: '' }
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
  },
  /** When true, asset appears on technician PPM Work Orders and can open a PPM session. */
  ppm_enabled: {
    type: Boolean,
    default: false,
    index: true
  }
}, { timestamps: true });

// Ensure every history event carries structured audit context.
assetSchema.pre('save', function normalizeHistoryAuditFields(next) {
  if (!Array.isArray(this.history) || this.history.length === 0) return next();

  const storeNameSnapshot = (() => {
    const s = this.store;
    if (!s) return '';
    if (typeof s === 'object' && s !== null) {
      return String(s.name || s.store_name || '').trim();
    }
    return '';
  })();

  this.history = this.history.map((event, index, allEvents) => {
    const out = event && typeof event.toObject === 'function' ? event.toObject() : { ...(event || {}) };
    const prevEvent = index > 0 ? allEvents[index - 1] : null;
    const prevEventObj = prevEvent && typeof prevEvent.toObject === 'function' ? prevEvent.toObject() : (prevEvent || {});
    if (!out.date) out.date = new Date();
    if (!out.previous_status) out.previous_status = String(prevEventObj?.status || this.previous_status || '').trim();
    if (!out.status) out.status = String(this.status || '').trim();
    if (!out.previous_condition) out.previous_condition = String(prevEventObj?.condition || '').trim();
    if (!out.condition) out.condition = String(this.condition || '').trim();
    if (!out.location) out.location = String(this.location || '').trim();
    if (!out.store_name) out.store_name = storeNameSnapshot;
    if (!out.actor_email) out.actor_email = '';
    if (!out.actor_role) out.actor_role = '';
    return out;
  });

  next();
});

// Compound Indexes for Common Filters
assetSchema.index({ store: 1, status: 1 });
assetSchema.index({ store: 1, serial_number: 1 }); // For duplicate checks
assetSchema.index({ store: 1, model_number: 1 });

module.exports = mongoose.model('Asset', assetSchema);
