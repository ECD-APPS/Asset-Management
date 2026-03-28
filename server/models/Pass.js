const mongoose = require('mongoose');

const passSchema = new mongoose.Schema({
  pass_number: {
    type: String,
    required: true
  },
  file_no: String, // e.g. ECD/ECT/EXITPASS/200016-1
  ticket_no: String,
  type: {
    type: String,
    enum: ['Inbound', 'Outbound', 'Security Handover'],
    required: true
  },
  status: {
    type: String,
    enum: ['Active', 'Completed', 'Cancelled'],
    default: 'Active'
  },
  /** Technician-requested gate passes start as pending; admin approves before email is sent. */
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved'],
    default: 'approved'
  },
  technicianNotifyEmail: { type: String, default: '' },
  approvedAt: Date,
  // People involved
  requested_by: String,
  provided_by: String,
  collected_by: String,
  approved_by: String,
  
  assets: [{
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset' },
    name: String, // Product
    model: String, // Model
    serial_number: String,
    brand: String, // Asset Brand
    asset_model: String, // Asset Model
    location: String,
    movement: String, // Inbound/Outbound
    status: String, // Good, etc.
    remarks: String,
    quantity: { type: Number, default: 1 }
  }],
  issued_to: {
    name: { type: String, required: true },
    company: String,
    contact: String,
    id_number: String
  },
  issued_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  destination: { type: String, default: '' }, // Moving To
  origin: { type: String, default: '' },      // Moving From
  
  justification: String,
  expected_return_date: Date,
  notes: String,
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    index: true
  }
}, { timestamps: true });

// Text index for search
passSchema.index({ 
  pass_number: 'text', 
  'issued_to.name': 'text',
  'issued_to.company': 'text' 
});

module.exports = mongoose.model('Pass', passSchema);
