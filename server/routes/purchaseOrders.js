const express = require('express');
const router = express.Router();
const PurchaseOrder = require('../models/PurchaseOrder');
const { protect, admin, adminOrViewer } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const Vendor = require('../models/Vendor');
const Store = require('../models/Store');

// Multer Config
const uploadRoot = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadRoot);
  },
  filename(req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10
  }
});

async function applyViewerStoreFilter(req, filter) {
  if (req.user?.role !== 'Viewer') {
    if (req.activeStore) {
      filter.store = req.activeStore;
    }
    return;
  }

  const scope = req.user.accessScope || 'All';
  if (scope === 'All') {
    if (req.activeStore) {
      filter.store = req.activeStore;
    }
    return;
  }

  const mainStores = await Store.find({
    isMainStore: true,
    name: { $regex: scope, $options: 'i' }
  }).select('_id').lean();

  const mainIds = mainStores.map(s => s._id);
  const childStores = await Store.find({ parentStore: { $in: mainIds } }).select('_id').lean();
  const allowedIds = [...mainIds, ...childStores.map(s => s._id)];

  if (req.activeStore) {
    const isAllowed = allowedIds.some(id => String(id) === String(req.activeStore));
    filter.store = isAllowed ? req.activeStore : { $in: [] };
  } else {
    filter.store = { $in: allowedIds };
  }
}

// @desc    Get all POs
// @route   GET /api/purchase-orders
// @access  Private/Admin
router.get('/', protect, adminOrViewer, async (req, res) => {
  try {
    const { vendor, status, startDate, endDate } = req.query;
    const filter = {};

    await applyViewerStoreFilter(req, filter);

    if (vendor) filter.vendor = vendor;
    if (status) filter.status = status;
    if (startDate && endDate) {
      filter.orderDate = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const pos = await PurchaseOrder.find(filter)
      .populate('vendor', 'name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .lean();
    
    res.json(pos);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get single PO
// @route   GET /api/purchase-orders/:id
// @access  Private/Admin
router.get('/:id([0-9a-fA-F]{24})', protect, adminOrViewer, async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    await applyViewerStoreFilter(req, filter);
    const po = await PurchaseOrder.findOne(filter).populate('vendor');
    if (!po) return res.status(404).json({ message: 'Purchase Order not found' });
    res.json(po);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create a PO
// @route   POST /api/purchase-orders
// @access  Private/Admin
router.post('/', protect, admin, upload.array('attachments'), async (req, res) => {
  try {
    let poNumber = req.body.poNumber;

    // Parse items if it's a string (from FormData)
    if (typeof req.body.items === 'string') {
      try {
        req.body.items = JSON.parse(req.body.items);
      } catch (e) {
        return res.status(400).json({ message: 'Invalid items format' });
      }
    }

    // If poNumber is provided, check for duplicates
    if (poNumber) {
      const existingPO = await PurchaseOrder.findOne({ poNumber });
      if (existingPO) {
        return res.status(400).json({ message: 'PO Number already exists' });
      }
    } else {
      // Auto-generate if not provided
      const count = await PurchaseOrder.countDocuments();
      poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
    }

    const attachments = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

    const po = await PurchaseOrder.create({
      ...req.body,
      poNumber,
      attachments,
      createdBy: req.user._id,
      store: req.activeStore
    });

    res.status(201).json(po);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update a PO
// @route   PUT /api/purchase-orders/:id
// @access  Private/Admin
router.put('/:id', protect, admin, upload.array('attachments'), async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);

    if (po) {
      if (req.activeStore && po.store && po.store.toString() !== req.activeStore.toString()) {
        return res.status(404).json({ message: 'Purchase Order not found' });
      }

      // Parse items if string
      if (typeof req.body.items === 'string') {
        try {
          req.body.items = JSON.parse(req.body.items);
        } catch (e) {
          return res.status(400).json({ message: 'Invalid items format' });
        }
      }

      const newAttachments = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
      
      // Combine existing attachments with new ones (if any logic needed for removal, handle separately)
      // Here we just append new ones. 
      // If the frontend sends 'existingAttachments' array, we could use that to filter out removed ones.
      // For now, let's just append.
      const updatedAttachments = [...(po.attachments || []), ...newAttachments];
      
      // Update fields
      Object.assign(po, req.body);
      po.attachments = updatedAttachments; // explicit set to ensure merge

      const updatedPO = await po.save();
      res.json(updatedPO);
    } else {
      res.status(404).json({ message: 'Purchase Order not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete a PO
// @route   DELETE /api/purchase-orders/:id
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);

    if (po) {
      if (req.activeStore && po.store && po.store.toString() !== req.activeStore.toString()) {
        return res.status(404).json({ message: 'Purchase Order not found' });
      }
      
      await po.deleteOne();
      res.json({ message: 'Purchase Order removed' });
    } else {
      res.status(404).json({ message: 'Purchase Order not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
router.get('/export', protect, adminOrViewer, async (req, res) => {
  try {
    const { vendor, status, startDate, endDate } = req.query;
    const filter = {};
    if (vendor) filter.vendor = vendor;
    if (status) filter.status = status;
    if (startDate && endDate) {
      filter.orderDate = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    await applyViewerStoreFilter(req, filter);

    const pos = await PurchaseOrder.find(filter)
      .populate('vendor', 'name')
      .populate('store', 'name')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const header = [
      'PO Number',
      'Vendor',
      'Order Date',
      'Delivery Date',
      'Status',
      'Subtotal',
      'Tax Total',
      'Grand Total',
      'Store',
      'Created By',
      'Notes',
      'Attachments Count',
      'Created At',
      'Updated At'
    ];
    const rows = pos.map(po => [
      po.poNumber,
      po.vendor?.name || '',
      po.orderDate || '',
      po.deliveryDate || '',
      po.status,
      po.subtotal,
      po.taxTotal,
      po.grandTotal,
      po.store?.name || '',
      po.createdBy?.name || '',
      po.notes || '',
      Array.isArray(po.attachments) ? po.attachments.length : 0,
      po.createdAt,
      po.updatedAt
    ]);

    // Items sheet
    const itemHeader = ['PO Number', 'Item Name', 'Quantity', 'Rate', 'Tax', 'Line Total'];
    const itemRows = [];
    pos.forEach(po => {
      (po.items || []).forEach(it => {
        itemRows.push([
          po.poNumber,
          it.itemName,
          it.quantity,
          it.rate,
          it.tax || 0,
          it.total
        ]);
      });
    });

    const wb = xlsx.utils.book_new();
    const wsMain = xlsx.utils.aoa_to_sheet([header, ...rows]);
    wsMain['!cols'] = header.map((_, idx) => ({ wch: [16, 24, 18, 18, 14, 12, 12, 14, 16, 18, 24, 18, 22, 22][idx] || 18 }));
    wsMain['!autofilter'] = { ref: 'A1:N1' };
    xlsx.utils.book_append_sheet(wb, wsMain, 'Purchase Orders');

    const wsItems = xlsx.utils.aoa_to_sheet([itemHeader, ...itemRows]);
    wsItems['!cols'] = itemHeader.map(() => ({ wch: 18 }));
    wsItems['!autofilter'] = { ref: 'A1:F1' };
    xlsx.utils.book_append_sheet(wb, wsItems, 'PO Items');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=PURCHASE_ORDERS_EXPORT.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/template', protect, admin, async (req, res) => {
  try {
    const wb = xlsx.utils.book_new();

    // Lookups
    const statuses = ['Draft', 'Submitted', 'Approved', 'Cancelled'];
    const vendors = await Vendor.find(req.activeStore ? { store: req.activeStore } : {}).select('name').lean();
    const vendorNames = vendors.map(v => v.name);
    const stores = await Store.find().select('name isMainStore parentStore').lean();
    const mainStores = stores.filter(s => s.isMainStore).map(s => s.name);

    const lookupsData = [
      ['Statuses', ...statuses],
      ['Vendors', ...vendorNames],
      ['Stores', ...mainStores]
    ];
    const wsLookups = xlsx.utils.aoa_to_sheet(lookupsData);
    wsLookups['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
    xlsx.utils.book_append_sheet(wb, wsLookups, 'Lookups');

    // PO header sheet
    const poHeader = [
      'PO Number',
      'Vendor',
      'Order Date',
      'Delivery Date',
      'Status',
      'Notes',
      'Store'
    ];
    const poRows = [poHeader];
    const wsPO = xlsx.utils.aoa_to_sheet(poRows);
    wsPO['!cols'] = poHeader.map((_, idx) => ({ wch: [16, 22, 14, 14, 14, 30, 18][idx] || 18 }));
    xlsx.utils.book_append_sheet(wb, wsPO, 'POs');

    // PO items sheet
    const itemsHeader = ['PO Number', 'Item Name', 'Quantity', 'Rate', 'Tax'];
    const itemsRows = [itemsHeader];
    const wsItems = xlsx.utils.aoa_to_sheet(itemsRows);
    wsItems['!cols'] = itemsHeader.map(() => ({ wch: 18 }));
    xlsx.utils.book_append_sheet(wb, wsItems, 'PO Items');

    // README
    const readme = [
      ['Purchase Orders Template — Guidelines'],
      ['POs sheet: one row per PO header'],
      ['PO Items sheet: lines linked by PO Number'],
      ['Status values: use Lookups sheet'],
      ['Vendor names: prefer those listed in Lookups; otherwise create in Vendors first'],
      ['Store: optional; current store context will be applied if set'],
      ['Dates: use YYYY-MM-DD'],
      ['Totals are calculated server-side from items']
    ];
    const wsReadme = xlsx.utils.aoa_to_sheet(readme);
    wsReadme['!cols'] = [{ wch: 80 }];
    xlsx.utils.book_append_sheet(wb, wsReadme, 'README');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=purchase_orders_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
