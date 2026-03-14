const express = require('express');
const router = express.Router();
const Pass = require('../models/Pass');
const Asset = require('../models/Asset');
const Store = require('../models/Store');
const { protect, admin } = require('../middleware/authMiddleware');

const getScopedStoreId = (req) => String(req.activeStore || req.user?.assignedStore || '').trim();
const getStoreIds = async (storeId) => {
  if (!storeId) return [];
  const children = await Store.find({ parentStore: storeId }).select('_id').lean();
  return [storeId, ...children.map((c) => c._id)];
};
const canAccessPass = async (req, passStoreId) => {
  if (req.user?.role === 'Super Admin') return true;
  const scopedStoreId = getScopedStoreId(req);
  if (!scopedStoreId) return false;
  const storeIds = await getStoreIds(scopedStoreId);
  const allowed = new Set(storeIds.map((id) => String(id)));
  return allowed.has(String(passStoreId || ''));
};

// Get all passes
router.get('/', protect, admin, async (req, res) => {
  try {
    const { type, search } = req.query;
    let query = {};
    
    if (type) query.type = type;
    if (search) {
      query.$text = { $search: search };
    }
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      if (!scopedStoreId) {
        return res.status(403).json({ message: 'Store context is required to view passes' });
      }
      const storeIds = await getStoreIds(scopedStoreId);
      query.store = { $in: storeIds };
    }

    const passes = await Pass.find(query)
      .populate('issued_by', 'name email')
      .sort({ createdAt: -1 })
      .lean();
      
    res.json(passes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create new pass
router.post('/', protect, admin, async (req, res) => {
  try {
    const { 
      type, assets, issued_to, destination, origin, notes, expected_return_date,
      file_no, ticket_no, requested_by, provided_by, collected_by, approved_by, justification, store
    } = req.body;
    const allowedTypes = new Set(['Inbound', 'Outbound', 'Security Handover']);
    if (!allowedTypes.has(String(type || ''))) {
      return res.status(400).json({ message: 'Invalid pass type' });
    }
    if (!Array.isArray(assets) || assets.length === 0) {
      return res.status(400).json({ message: 'At least one asset row is required' });
    }
    if (!issued_to || !String(issued_to.name || '').trim()) {
      return res.status(400).json({ message: 'Issued to name is required' });
    }

    // Generate Pass Number (e.g., IN-20231027-001, OUT-..., SH-...)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let prefix = 'GEN';
    if (type === 'Inbound') prefix = 'IN';
    else if (type === 'Outbound') prefix = 'OUT';
    else if (type === 'Security Handover') prefix = 'SH';
    
    // Find last pass of today to increment counter
    const todayRegex = new RegExp(`^${prefix}-${dateStr}`);
    const lastPass = await Pass.findOne({ pass_number: todayRegex }).sort({ pass_number: -1 });
    
    let sequence = '001';
    if (lastPass) {
      const lastSeq = parseInt(lastPass.pass_number.split('-')[2]);
      sequence = (lastSeq + 1).toString().padStart(3, '0');
    }
    
    const pass_number = `${prefix}-${dateStr}-${sequence}`;

    let targetStoreId = null;
    if (req.user?.role === 'Super Admin') {
      targetStoreId = store || req.activeStore || null;
    } else {
      targetStoreId = req.activeStore || req.user?.assignedStore || null;
    }
    if (!targetStoreId) {
      return res.status(400).json({ message: 'Store context is required to create pass' });
    }

    const pass = new Pass({
      pass_number,
      type,
      assets,
      issued_to,
      issued_by: req.user._id,
      destination,
      origin,
      notes,
      expected_return_date,
      file_no,
      ticket_no,
      requested_by,
      provided_by,
      collected_by,
      approved_by,
      justification,
      store: targetStoreId
    });

    const savedPass = await pass.save();
    res.status(201).json(savedPass);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get single pass
router.get('/:id', protect, admin, async (req, res) => {
  try {
    const pass = await Pass.findById(req.params.id)
      .populate('issued_by', 'name email')
      .populate('assets.asset');
    if (!pass) return res.status(404).json({ message: 'Pass not found' });
    if (!(await canAccessPass(req, pass.store))) {
      return res.status(404).json({ message: 'Pass not found' });
    }
    res.json(pass);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update pass status
router.put('/:id/status', protect, admin, async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = new Set(['Active', 'Completed', 'Cancelled']);
    if (!allowedStatuses.has(String(status || ''))) {
      return res.status(400).json({ message: 'Invalid pass status' });
    }
    const existing = await Pass.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Pass not found' });
    if (!(await canAccessPass(req, existing.store))) {
      return res.status(404).json({ message: 'Pass not found' });
    }
    existing.status = status;
    const pass = await existing.save();
    res.json(pass);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update pass details
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const passCheck = await Pass.findById(req.params.id);
    if (!passCheck) return res.status(404).json({ message: 'Pass not found' });
    if (!(await canAccessPass(req, passCheck.store))) {
      return res.status(404).json({ message: 'Pass not found' });
    }

    const { 
      assets, issued_to, destination, origin, notes, expected_return_date,
      file_no, ticket_no, requested_by, provided_by, collected_by, approved_by, justification 
    } = req.body;
    
    const pass = await Pass.findByIdAndUpdate(
      req.params.id,
      { 
        assets, issued_to, destination, origin, notes, expected_return_date,
        file_no, ticket_no, requested_by, provided_by, collected_by, approved_by, justification 
      },
      { new: true }
    );
    res.json(pass);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete pass
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const pass = await Pass.findById(req.params.id);
    if (!pass) return res.status(404).json({ message: 'Pass not found' });

    if (!(await canAccessPass(req, pass.store))) {
      return res.status(404).json({ message: 'Pass not found' });
    }

    await Pass.findByIdAndDelete(req.params.id);
    res.json({ message: 'Pass deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
