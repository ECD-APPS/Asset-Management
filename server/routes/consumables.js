const express = require('express');
const router = express.Router();
const Consumable = require('../models/Consumable');
const ActivityLog = require('../models/ActivityLog');
const { protect, adminOrViewer, restrictViewer } = require('../middleware/authMiddleware');

const normalize = (v) => String(v || '').trim();

const canAccess = (req, item) => {
  if (req.user.role === 'Super Admin') return true;
  if (!req.activeStore || !item?.store) return false;
  return String(req.activeStore) === String(item.store);
};

const pushHistory = (item, { action, actor, quantity = 0, note = '' }) => {
  item.history.push({
    action,
    actorId: actor?._id || null,
    actorName: actor?.name || '',
    quantity: Number(quantity) || 0,
    note: normalize(note)
  });
};

// @desc    List consumables
// @route   GET /api/consumables
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const q = normalize(req.query.q);
    const byName = normalize(req.query.name);
    const filter = {};
    if (req.activeStore) filter.store = req.activeStore;

    if (q || byName) {
      const term = q || byName;
      const rx = new RegExp(term, 'i');
      filter.$or = [
        { name: rx },
        { type: rx },
        { model: rx },
        { serial_number: rx },
        { mac_address: rx },
        { po_number: rx },
        { location: rx },
        { comment: rx }
      ];
    }

    const rows = await Consumable.find(filter).sort({ updatedAt: -1 }).populate('store', 'name').lean();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create consumable
// @route   POST /api/consumables
// @access  Private/Admin
router.post('/', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const {
      name,
      type,
      model,
      serial_number,
      mac_address,
      po_number,
      location,
      comment,
      quantity,
      min_quantity
    } = req.body;

    if (!normalize(name)) return res.status(400).json({ message: 'Name is required' });

    const storeId = req.user.role === 'Super Admin'
      ? (req.body.store || req.activeStore || null)
      : (req.activeStore || req.user.assignedStore || null);

    if (!storeId) return res.status(400).json({ message: 'Active store is required' });

    const item = await Consumable.create({
      name: normalize(name),
      type: normalize(type),
      model: normalize(model),
      serial_number: normalize(serial_number),
      mac_address: normalize(mac_address),
      po_number: normalize(po_number),
      location: normalize(location),
      comment: normalize(comment),
      quantity: Number(quantity) || 0,
      min_quantity: Number(min_quantity) || 0,
      store: storeId
    });

    pushHistory(item, { action: 'Created', actor: req.user, quantity: item.quantity, note: 'Consumable registered' });
    await item.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Register Consumable',
      details: `Registered consumable ${item.name} (qty: ${item.quantity})`,
      store: item.store
    });

    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update consumable
// @route   PUT /api/consumables/:id
// @access  Private/Admin
router.put('/:id', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const item = await Consumable.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Consumable not found' });
    if (!canAccess(req, item)) return res.status(403).json({ message: 'Not authorized for this store item' });

    const fields = ['name', 'type', 'model', 'serial_number', 'mac_address', 'po_number', 'location', 'comment'];
    fields.forEach((key) => {
      if (req.body[key] !== undefined) item[key] = normalize(req.body[key]);
    });
    if (req.body.quantity !== undefined) item.quantity = Math.max(Number(req.body.quantity) || 0, 0);
    if (req.body.min_quantity !== undefined) item.min_quantity = Math.max(Number(req.body.min_quantity) || 0, 0);

    pushHistory(item, { action: 'Updated', actor: req.user, quantity: item.quantity, note: 'Consumable updated' });
    await item.save();
    res.json(item);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Consume consumable quantity
// @route   POST /api/consumables/:id/consume
// @access  Private/Admin|Technician
router.post('/:id/consume', protect, restrictViewer, async (req, res) => {
  try {
    const qty = Math.max(Number(req.body.quantity) || 0, 0);
    if (!qty) return res.status(400).json({ message: 'Quantity must be greater than 0' });

    const item = await Consumable.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Consumable not found' });
    if (!canAccess(req, item)) return res.status(403).json({ message: 'Not authorized for this store item' });
    if (item.quantity < qty) {
      return res.status(400).json({ message: `Not enough stock. Available: ${item.quantity}` });
    }

    item.quantity -= qty;
    pushHistory(item, { action: 'Consumed', actor: req.user, quantity: qty, note: req.body?.comment || 'Consumed from panel' });
    await item.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Consume Consumable',
      details: `Consumed ${qty} of ${item.name}. Remaining: ${item.quantity}`,
      store: item.store
    });

    res.json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete consumable
// @route   DELETE /api/consumables/:id
// @access  Private/Admin
router.delete('/:id', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const item = await Consumable.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Consumable not found' });
    if (!canAccess(req, item)) return res.status(403).json({ message: 'Not authorized for this store item' });
    pushHistory(item, { action: 'Deleted', actor: req.user, quantity: item.quantity, note: 'Consumable removed' });
    await item.save();
    await item.deleteOne();
    res.json({ message: 'Consumable removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get consumable history
// @route   GET /api/consumables/:id/history
// @access  Private
router.get('/:id/history', protect, async (req, res) => {
  try {
    const item = await Consumable.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Consumable not found' });
    if (!canAccess(req, item)) return res.status(403).json({ message: 'Not authorized for this store item' });
    res.json(item.history || []);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

