const mongoose = require('mongoose');

const ppmChecklistItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    value: {
      type: String,
      enum: ['Good', 'Needs Replace', 'No', 'Online', 'Offline', ''],
      default: ''
    },
    notes: { type: String, default: '' }
  },
  { _id: false }
);

const ppmHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    user: { type: String, default: '' },
    email: { type: String, default: '' },
    role: { type: String, default: '' },
    details: { type: String, default: '' },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const ppmTaskSchema = new mongoose.Schema(
  {
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Asset',
      required: true,
      index: true
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: false,
      index: true
    },
    status: {
      type: String,
      enum: ['Scheduled', 'In Progress', 'Completed', 'Not Completed', 'Overdue', 'Cancelled'],
      default: 'Scheduled',
      index: true
    },
    scheduled_for: { type: Date, required: true, index: true },
    due_at: { type: Date, required: true, index: true },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    cancelled_at: { type: Date, default: null },
    checklist: {
      type: [ppmChecklistItemSchema],
      default: []
    },
    equipment_used: {
      type: [String],
      default: []
    },
    technician_notes: { type: String, default: '' },
    manager_notes: { type: String, default: '' },
    work_order_ticket: { type: String, default: '' },
    assigned_to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    completed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    incomplete_at: { type: Date, default: null },
    incomplete_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    history: {
      type: [ppmHistorySchema],
      default: []
    }
  },
  { timestamps: true }
);

ppmTaskSchema.index({ store: 1, status: 1, due_at: 1 });
ppmTaskSchema.index({ assigned_to: 1, status: 1, due_at: 1 });

module.exports = mongoose.model('PpmTask', ppmTaskSchema);
