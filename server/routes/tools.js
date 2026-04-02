const express = require('express');
const router = express.Router();
const Tool = require('../models/Tool');
const ActivityLog = require('../models/ActivityLog');
const { protect, adminOrViewer, restrictViewer } = require('../middleware/authMiddleware');

const normalize = (v) => String(v || '').trim();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const canAccessTool = (req, tool) => {
  if (!tool) return false;
  if (req.user.role === 'Super Admin') return true;
  if (!req.activeStore || !tool.store) return false;
  return String(tool.store) === String(req.activeStore);
};

const appendHistory = (tool, { action, actor, targetUser, note }) => {
  tool.history.push({
    action,
    actorId: actor?._id || null,
    actorName: actor?.name || '',
    targetUserId: targetUser?._id || null,
    targetUserName: targetUser?.name || '',
    note: normalize(note)
  });
};

// @desc    List tools
// @route   GET /api/tools
// @access  Private/Admin|Viewer|Technician
router.get('/', protect, async (req, res) => {
  try {
    const q = normalize(req.query.q);
    const status = normalize(req.query.status);
    const location = normalize(req.query.location);
    const mine = String(req.query.mine || '').toLowerCase() === 'true';
    const filter = {};

    if (req.activeStore) filter.store = req.activeStore;
    if (status) filter.status = status;
    if (location) filter.location = new RegExp(escapeRegex(location), 'i');

    if (mine) {
      filter.currentHolder = req.user._id;
    } else if (req.user.role === 'Technician') {
      filter.$or = [
        { currentHolder: req.user._id },
        { status: 'Available' }
      ];
    }

    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { name: rx },
          { type: rx },
          { model: rx },
          { serial_number: rx },
          { mac_address: rx },
          { po_number: rx },
          { comment: rx },
          { location: rx }
        ]
      });
    }

    const tools = await Tool.find(filter)
      .sort({ updatedAt: -1 })
      .populate('store', 'name')
      .populate('currentHolder', 'name email')
      .lean();
    res.json(tools);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Dashboard stats (counts by tool status)
// @route   GET /api/tools/stats
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const filter = {};
    if (req.activeStore) {
      filter.store = req.activeStore;
    } else if (req.user.role !== 'Super Admin' && req.user.assignedStore) {
      filter.store = req.user.assignedStore;
    }

    const [total, available, issued, maintenance, retired] = await Promise.all([
      Tool.countDocuments(filter),
      Tool.countDocuments({ ...filter, status: 'Available' }),
      Tool.countDocuments({ ...filter, status: 'Issued' }),
      Tool.countDocuments({ ...filter, status: 'Maintenance' }),
      Tool.countDocuments({ ...filter, status: 'Retired' })
    ]);

    res.json({ total, available, issued, maintenance, retired });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create tool registration entry
// @route   POST /api/tools
// @access  Private/Admin
router.post('/', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const {
      name,
      type,
      model,
      serial_number,
      mac_address,
      comment,
      po_number,
      location,
      status
    } = req.body;

    if (!normalize(name)) {
      return res.status(400).json({ message: 'Tool name is required' });
    }

    const storeId = req.user.role === 'Super Admin'
      ? (req.body.store || req.activeStore || null)
      : (req.activeStore || req.user.assignedStore || null);

    if (!storeId) {
      return res.status(400).json({ message: 'Active store is required to register tools' });
    }

    const tool = await Tool.create({
      name: normalize(name),
      type: normalize(type),
      model: normalize(model),
      serial_number: normalize(serial_number),
      mac_address: normalize(mac_address),
      comment: normalize(comment),
      po_number: normalize(po_number),
      location: normalize(location),
      status: normalize(status) || 'Available',
      store: storeId
    });

    appendHistory(tool, { action: 'Created', actor: req.user, note: 'Tool registered' });
    await tool.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Register Tool',
      details: `Registered tool ${tool.name} (${tool.serial_number || 'NO-SERIAL'})`,
      store: tool.store
    });

    const full = await Tool.findById(tool._id).populate('store', 'name').populate('currentHolder', 'name email');
    res.status(201).json(full);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update tool details
// @route   PUT /api/tools/:id
// @access  Private/Admin
router.put('/:id', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const tool = await Tool.findById(req.params.id);
    if (!tool) return res.status(404).json({ message: 'Tool not found' });
    if (!canAccessTool(req, tool)) return res.status(403).json({ message: 'Not authorized for this store tool' });

    const fields = ['name', 'type', 'model', 'serial_number', 'mac_address', 'comment', 'po_number', 'location', 'status'];
    fields.forEach((key) => {
      if (req.body[key] !== undefined) {
        tool[key] = normalize(req.body[key]);
      }
    });

    if (tool.status !== 'Issued') {
      tool.currentHolder = null;
    }

    appendHistory(tool, { action: 'Updated', actor: req.user, note: 'Tool details updated' });
    await tool.save();

    const full = await Tool.findById(tool._id).populate('store', 'name').populate('currentHolder', 'name email');
    res.json(full);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete tool
// @route   DELETE /api/tools/:id
// @access  Private/Admin
router.delete('/:id', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const tool = await Tool.findById(req.params.id);
    if (!tool) return res.status(404).json({ message: 'Tool not found' });
    if (!canAccessTool(req, tool)) return res.status(403).json({ message: 'Not authorized for this store tool' });

    appendHistory(tool, { action: 'Deleted', actor: req.user, note: 'Tool removed' });
    await tool.save();
    await tool.deleteOne();

    res.json({ message: 'Tool removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Technician/Admin gets (issues) a tool
// @route   POST /api/tools/:id/issue
// @access  Private/Admin|Technician
router.post('/:id/issue', protect, restrictViewer, async (req, res) => {
  try {
    const tool = await Tool.findById(req.params.id);
    if (!tool) return res.status(404).json({ message: 'Tool not found' });
    if (!canAccessTool(req, tool)) return res.status(403).json({ message: 'Not authorized for this store tool' });
    if (tool.status !== 'Available') {
      return res.status(400).json({ message: `Tool is not available (current status: ${tool.status})` });
    }

    tool.status = 'Issued';
    tool.currentHolder = req.user._id;
    appendHistory(tool, {
      action: 'Issued',
      actor: req.user,
      targetUser: req.user,
      note: req.body?.comment || 'Issued from technician panel'
    });
    await tool.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Issue Tool',
      details: `Issued tool ${tool.name} (${tool.serial_number || 'NO-SERIAL'})`,
      store: tool.store
    });

    const full = await Tool.findById(tool._id).populate('store', 'name').populate('currentHolder', 'name email');
    res.json(full);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Return tool
// @route   POST /api/tools/:id/return
// @access  Private/Admin|Technician
router.post('/:id/return', protect, restrictViewer, async (req, res) => {
  try {
    const tool = await Tool.findById(req.params.id);
    if (!tool) return res.status(404).json({ message: 'Tool not found' });
    if (!canAccessTool(req, tool)) return res.status(403).json({ message: 'Not authorized for this store tool' });
    if (tool.status !== 'Issued' || !tool.currentHolder) {
      return res.status(400).json({ message: 'Tool is not currently issued' });
    }

    if (req.user.role === 'Technician' && String(tool.currentHolder) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only return tools assigned to you' });
    }

    tool.status = 'Available';
    tool.currentHolder = null;
    appendHistory(tool, {
      action: 'Returned',
      actor: req.user,
      note: req.body?.comment || 'Returned from technician panel'
    });
    await tool.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Return Tool',
      details: `Returned tool ${tool.name} (${tool.serial_number || 'NO-SERIAL'})`,
      store: tool.store
    });

    const full = await Tool.findById(tool._id).populate('store', 'name').populate('currentHolder', 'name email');
    res.json(full);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get tool history
// @route   GET /api/tools/:id/history
// @access  Private/Admin|Viewer|Technician
router.get('/:id/history', protect, async (req, res) => {
  try {
    const tool = await Tool.findById(req.params.id).populate('currentHolder', 'name email').lean();
    if (!tool) return res.status(404).json({ message: 'Tool not found' });
    if (!canAccessTool(req, tool)) return res.status(403).json({ message: 'Not authorized for this store tool' });
    if (req.user.role === 'Technician') {
      const involved = (tool.history || []).some((h) =>
        String(h.actorId || '') === String(req.user._id) || String(h.targetUserId || '') === String(req.user._id)
      );
      const currentHolder = String(tool.currentHolder?._id || tool.currentHolder || '') === String(req.user._id);
      if (!involved && !currentHolder) {
        return res.status(403).json({ message: 'Not authorized to view this tool history' });
      }
    }
    res.json(tool.history || []);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

