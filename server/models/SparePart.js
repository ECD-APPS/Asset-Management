const mongoose = require('mongoose');

const sparePartHistorySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['Created', 'Updated', 'Harvested', 'Issued', 'Restocked', 'Adjusted', 'Deleted'],
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
  quantity: {
    type: Number,
    default: 0
  },
  /** Running on-hand quantity after this event (best-effort for display). */
  quantityAfter: {
    type: Number,
    default: 0
  },
  note: {
    type: String,
    default: ''
  },
  /** Source faulty asset when action is Harvested. */
  sourceAssetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Asset',
    default: null
  },
  sourceAssetLabel: {
    type: String,
    default: ''
  },
  /** Asset where parts were used / installed (issue flow). */
  targetAssetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Asset',
    default: null
  },
  targetAssetLabel: {
    type: String,
    default: ''
  },
  ticketNumber: {
    type: String,
    default: ''
  },
  usedAtLocation: {
    type: String,
    default: ''
  },
  /** Human-readable FIFO trace: which donor units supplied this issue. */
  donorTraceSummary: {
    type: String,
    default: ''
  },
  /** When an admin issues stock and records a technician or external recipient (audit). */
  recipientUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  recipientUserName: {
    type: String,
    default: ''
  },
  recipientExternalName: {
    type: String,
    default: ''
  },
  recipientExternalEmail: {
    type: String,
    default: ''
  },
  recipientExternalPhone: {
    type: String,
    default: ''
  },
  assignmentGatePassSummary: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

/** FIFO provenance: each slice ties remaining qty to a donor asset (or manual/restock pool). */
const stockLotSchema = new mongoose.Schema({
  sourceAssetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Asset',
    default: null
  },
  sourceAssetLabel: {
    type: String,
    default: ''
  },
  quantityRemaining: {
    type: Number,
    default: 0,
    min: 0
  },
  quantityInitial: {
    type: Number,
    default: 0,
    min: 0
  },
  harvestedAt: {
    type: Date,
    default: Date.now
  },
  harvestTicket: {
    type: String,
    default: ''
  },
  harvestActorName: {
    type: String,
    default: ''
  },
  harvestActorEmail: {
    type: String,
    default: ''
  }
}, { _id: false });

const sparePartSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  part_number: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  type: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  compatible_models: {
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
  comment: {
    type: String,
    default: '',
    trim: true
  },
  quantity: {
    type: Number,
    default: 0,
    min: 0
  },
  min_quantity: {
    type: Number,
    default: 0,
    min: 0
  },
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    index: true
  },
  history: {
    type: [sparePartHistorySchema],
    default: []
  },
  stockLots: {
    type: [stockLotSchema],
    default: []
  },
  /** Linked vendor (Vendor Management) for purchased / restocked lines. */
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    default: null,
    index: true
  },
  /** Linked purchase order (Purchase Orders module). */
  purchaseOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder',
    default: null,
    index: true
  },
  vendorNameSnapshot: {
    type: String,
    default: '',
    trim: true
  },
  poNumberSnapshot: {
    type: String,
    default: '',
    trim: true
  },
  /** When goods were physically received / booked (may differ from createdAt). */
  receiptReceivedAt: {
    type: Date,
    default: null
  },
  /** Where goods were received (dock, warehouse zone, etc.). */
  receiptLocation: {
    type: String,
    default: '',
    trim: true
  },
  /** Linked Locations row (child store under main inventory store). */
  receiptLocationStore: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    default: null,
    index: true
  },
  receiptLocationDetail: {
    type: String,
    default: '',
    trim: true
  },
  receiptRecordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  receiptRecordedByName: {
    type: String,
    default: ''
  },
  receiptRecordedByEmail: {
    type: String,
    default: ''
  }
}, { timestamps: true });

sparePartSchema.index({ store: 1, name: 1, part_number: 1 });

module.exports = mongoose.model('SparePart', sparePartSchema);
