const mongoose = require('mongoose');

const consumableHistorySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['Created', 'Updated', 'Consumed', 'Restocked', 'Deleted'],
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
  note: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const consumableSchema = new mongoose.Schema({
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
    type: [consumableHistorySchema],
    default: []
  }
}, { timestamps: true });

consumableSchema.index({ store: 1, name: 1 });

module.exports = mongoose.model('Consumable', consumableSchema);

