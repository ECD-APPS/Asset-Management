const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Asset = require('../models/Asset');
const Product = require('../models/Product');
const Store = require('../models/Store');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Request = require('../models/Request');
const { protect, admin, restrictViewer } = require('../middleware/authMiddleware');
const xlsx = require('xlsx');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

 

function capitalizeWords(s) {
  if (!s) return s;
  return String(s).toUpperCase();
}
// Helper to generate Unique ID
async function generateUniqueId(assetType) {
  let prefix = 'AST';
  const upperType = assetType ? String(assetType).toUpperCase() : '';
  
  if (upperType.includes('CAMERA')) prefix = 'CAM';
  else if (upperType.includes('READER')) prefix = 'REA';
  else if (upperType.includes('CONTROLLER')) prefix = 'CON';
  else if (upperType.length >= 3) prefix = upperType.substring(0, 3);
  else if (upperType.length > 0) prefix = upperType.padEnd(3, 'X');
  
  // Try to find a unique ID (max 10 attempts to prevent infinite loop)
  for (let i = 0; i < 10; i++) {
    const randomNum = Math.floor(1000 + Math.random() * 9000); // 1000-9999
    const uniqueId = `${prefix}${randomNum}`;
    const existing = await Asset.findOne({ uniqueId });
    if (!existing) return uniqueId;
  }
  // Fallback: use timestamp if random fails
  return `${prefix}${Date.now().toString().slice(-4)}`;
}

    // @desc    Get recent activity logs
    // @route   GET /api/assets/recent-activity
    // @access  Private (Admin/Technician/Viewer)
    router.get('/recent-activity', protect, async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
        const query = {};
        
        if (req.activeStore) {
          query.store = req.activeStore;
        } else if (req.user.role === 'Viewer') {
          // Enforcement for Viewer with no active store (Portal view)
          const scope = req.user.accessScope || 'All';
          if (scope !== 'All') {
            const allowedMainStores = await Store.find({ 
              isMainStore: true, 
              name: { $regex: scope, $options: 'i' } 
            }).select('_id');
            const allowedMainIds = allowedMainStores.map(s => s._id);
            
            const childStores = await Store.find({
              parentStore: { $in: allowedMainIds }
            }).select('_id');
            const childIds = childStores.map(s => s._id);
            
            const allAllowedIds = [...allowedMainIds, ...childIds];
            query.store = { $in: allAllowedIds };
          }
        }
    
        if (req.query.source) {
          query.source = req.query.source;
        }
    
        const logs = await ActivityLog.find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();
        res.json(logs);
      } catch (error) {
        console.error('Error fetching recent activity:', error);
        res.status(500).json({ message: error.message });
      }
    });

// Helper to get store and its children IDs (always ObjectId for aggregations)
async function getStoreIds(storeId) {
  if (!storeId) return [];
  const children = await Store.find({ parentStore: storeId }).select('_id');
  const all = [storeId, ...children.map(c => c._id)];
  return all.map((id) => new mongoose.Types.ObjectId(id));
}

async function findProductNameByModelNumber(modelNumber, activeStoreId) {
  if (!modelNumber) return null;
  const filter = {};
  if (activeStoreId) {
    filter.$or = [
      { store: activeStoreId },
      { store: null },
      { store: { $exists: false } }
    ];
  }
  const products = await Product.find(filter).lean();
  const target = String(modelNumber).trim().toLowerCase();
  let foundName = null;

  const traverse = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node) continue;
      const model = String(node.model_number || '').trim().toLowerCase();
      if (model && model === target && node.name) {
        foundName = node.name;
        return;
      }
      if (node.children && node.children.length > 0) {
        traverse(node.children);
        if (foundName) return;
      }
    }
  };

  traverse(products);
  return foundName;
}

async function resolveProductHierarchyNames(baseName, activeStoreId) {
  const raw = String(baseName || '').trim();
  if (!raw) return [];

  const target = raw.toLowerCase();
  const filter = {};
  if (activeStoreId) {
    filter.$or = [
      { store: activeStoreId },
      { store: null },
      { store: { $exists: false } }
    ];
  }

  const roots = await Product.find(filter).lean();
  const collected = new Set();

  const collectSubtree = (node) => {
    if (!node || !node.name) return;
    collected.add(node.name);
    if (Array.isArray(node.children) && node.children.length > 0) {
      node.children.forEach(collectSubtree);
    }
  };

  const traverse = (nodes) => {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((node) => {
      if (!node || !node.name) return;
      const nameLower = String(node.name).toLowerCase();
      if (nameLower === target) {
        collectSubtree(node);
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        traverse(node.children);
      }
    });
  };

  traverse(roots);
  return Array.from(collected);
}

// @desc    Get assets (paginated, optional filters)
// @route   GET /api/assets
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 5000);
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const storeId = String(req.query.store || '').trim();
    const category = ''; // Removed category filter
    const manufacturer = String(req.query.manufacturer || '').trim();
    const modelNumber = String(req.query.model_number || '').trim();
    const serialNumber = String(req.query.serial_number || '').trim();
    const macAddress = String(req.query.mac_address || '').trim();
    const productType = ''; // Removed product_type filter
    const productName = String(req.query.product_name || '').trim();
    const ticketNumber = String(req.query.ticket_number || '').trim();
    const rfid = String(req.query.rfid || '').trim();
    const qrCode = String(req.query.qr_code || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const source = String(req.query.source || '').trim();
    const condition = String(req.query.condition || '').trim();
    const location = String(req.query.location || '').trim();
    const deliveredBy = String(req.query.delivered_by || '').trim();
    const vendorName = String(req.query.vendor_name || '').trim();

    const filter = {};
    if (q) {
      const rx = new RegExp(q, 'i');
      const orClauses = [
        { name: rx },
        { model_number: rx },
        { serial_number: rx },
        { serial_last_4: rx },
        { mac_address: rx },
        { rfid: rx },
        { qr_code: rx },
        { uniqueId: rx },
        { manufacturer: rx },
        { ticket_number: rx },
        { po_number: rx },
        { condition: rx },
        { status: rx },
        { previous_status: rx },
        { location: rx },
        { vendor_name: rx },
        { source: rx },
        { delivered_by_name: rx }
      ];

      const n = Number(q);
      if (!Number.isNaN(n)) {
        orClauses.push({ quantity: n });
        orClauses.push({ price: n });
      }

      filter.$or = orClauses;
    }
    if (status) {
      if (status === 'In Use') {
        filter.status = 'In Use';
      } else if (status === 'Spare') {
        filter.assigned_to = null;
        filter.condition = { $in: ['New', 'Used'] };
        filter.status = { $nin: ['Faulty', 'Under Repair', 'Disposed', 'In Use'] };
      } else if (status === 'Faulty') {
        filter.$or = [
          { status: 'Faulty' },
          { condition: 'Faulty' }
        ];
      } else if (status === 'Disposed') {
        filter.$or = [
          { status: 'Disposed' },
          { condition: 'Disposed' }
        ];
      } else if (status === 'New' || status === 'Used') {
        filter.status = status;
        filter.assigned_to = null;
        filter.assigned_to_external = null;
      } else if (status.includes(',')) {
        filter.status = { $in: status.split(',').map(s => s.trim()) };
      } else {
        filter.status = status;
      }
    }

    if (deliveredBy) {
      const rxDelivered = new RegExp(deliveredBy, 'i');
      filter.delivered_by_name = rxDelivered;
    }

    // RBAC: Store Access Control (Include Child Stores)
    let contextStoreId = req.activeStore || (req.user.role !== 'Super Admin' ? req.user.assignedStore : null);
    
    if (contextStoreId) {
      const allowedIds = await getStoreIds(contextStoreId);
      
      if (storeId) {
         // Check if requested storeId is allowed
         if (allowedIds.some(id => id.toString() === storeId)) {
            // Valid filter.
            // 1. Get specific IDs (selected store + its children)
            const specificIds = await getStoreIds(storeId);
            
            // 2. Get Store Name for legacy/string-based matching
            const selectedStore = await Store.findById(storeId);
            
            // 3. Construct Filter:
            //    - Match assets explicitly assigned to these IDs
            //    - OR Match assets assigned to any allowed store (e.g. Parent) BUT with matching location string
            filter.$or = [
               ...(filter.$or || []), // Preserve existing $or (e.g. search query)
               {
                 $or: [
                  { store: { $in: specificIds } },
                  { 
                    store: { $in: allowedIds }, 
                    location: selectedStore ? new RegExp(`^${selectedStore.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') : '___' 
                  }
                 ]
               }
            ];
            // Note: We don't set filter.store directly here to allow the $or logic to work
         } else {
            // Invalid filter (out of scope). Return nothing.
            filter.store = { $in: [] };
         }
      } else {
         // No specific filter. Show all allowed.
         filter.store = { $in: allowedIds };
      }
    } else {
      // No restricted context (Super Admin global or Viewer Global)
      
      // Viewer Global Scope Enforcement
      if (req.user.role === 'Viewer') {
        const scope = req.user.accessScope || 'All';
        if (scope !== 'All') {
          // Find all allowed store IDs
          const allowedMainStores = await Store.find({ 
            isMainStore: true, 
            name: { $regex: scope, $options: 'i' } 
          }).select('_id');
          const allowedMainIds = allowedMainStores.map(s => s._id);
          
          const childStores = await Store.find({
            parentStore: { $in: allowedMainIds }
          }).select('_id');
          const childIds = childStores.map(s => s._id);
          
          const allAllowedIds = [...allowedMainIds, ...childIds];
          
          // Apply filter
          filter.store = { $in: allAllowedIds };
        }
      }

      if (storeId) {
         const ids = await getStoreIds(storeId);
         const selectedStore = await Store.findById(storeId);
         
         // Same hybrid logic for Super Admin
        filter.$or = [
            ...(filter.$or || []),
            {
              $or: [
                { store: { $in: ids } },
                { location: selectedStore ? new RegExp(`^${selectedStore.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') : '___' }
              ]
            }
         ];
      }
    }

    // category removed

    if (req.query.recent_upload === 'true') {
      const batchQuery = { importBatchId: { $exists: true } };
      
      if (storeId) {
        const ids = await getStoreIds(storeId);
        batchQuery.store = { $in: ids };
      } else if (contextStoreId) {
        const allowedIds = await getStoreIds(contextStoreId);
        batchQuery.store = { $in: allowedIds };
      }

      const lastBatch = await Asset.findOne(batchQuery).sort({ createdAt: -1 }).select('importBatchId');
      if (lastBatch && lastBatch.importBatchId) {
        filter.importBatchId = lastBatch.importBatchId;
      } else {
        return res.json({
          assets: [],
          page: 1,
          pages: 0,
          total: 0
        });
      }
    }
    if (manufacturer) filter.manufacturer = new RegExp(manufacturer, 'i');
    if (modelNumber) filter.model_number = new RegExp(modelNumber, 'i');
    if (serialNumber) filter.serial_number = new RegExp(serialNumber, 'i');
    if (macAddress) filter.mac_address = new RegExp(macAddress, 'i');
    // product_type removed
    if (productName) {
      let names = [];
      try {
        names = await resolveProductHierarchyNames(productName, req.activeStore);
      } catch (e) {
        names = [];
      }
      const list = (names && names.length > 0 ? names : [productName]).filter(Boolean);
      if (list.length === 1) {
        const escaped = list[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.product_name = new RegExp(`^${escaped}$`, 'i');
      } else if (list.length > 1) {
        const regexes = list.map((n) => {
          const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`^${escaped}$`, 'i');
        });
        filter.product_name = { $in: regexes };
      }
    }
    if (ticketNumber) filter.ticket_number = new RegExp(ticketNumber, 'i');
    if (rfid) filter.rfid = new RegExp(rfid, 'i');
    if (qrCode) filter.qr_code = new RegExp(qrCode, 'i');
    if (source) filter.source = source;
    if (condition) filter.condition = condition;
    if (location) {
      const escaped = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.location = new RegExp(`^${escaped}$`, 'i');
    }
    if (vendorName) {
      const escapedVendor = vendorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.vendor_name = new RegExp(escapedVendor, 'i');
    }
    
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endDate;
      }
    }

    const [total, items] = await Promise.all([
      Asset.countDocuments(filter),
      Asset.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('name model_number serial_number serial_last_4 mac_address manufacturer ticket_number po_number rfid qr_code uniqueId store location status previous_status condition product_name assigned_to assigned_to_external return_pending return_request source vendor_name delivered_by_name delivered_at quantity price history createdAt updatedAt')
        .populate({
          path: 'store',
          select: 'name parentStore',
          populate: {
            path: 'parentStore',
            select: 'name'
          }
        })
        .populate('assigned_to', 'name email')
        .lean()
    ]);

    // Check for duplicates in the current page items
    const serials = items.map(i => i.serial_number);
    if (serials.length > 0) {
      const counts = await Asset.aggregate([
        { $match: { serial_number: { $in: serials }, store: filter.store } }, // Scope duplicate check to store(s)
        { $group: { _id: '$serial_number', count: { $sum: 1 } } }
      ]);
      const countMap = {};
      counts.forEach(c => countMap[c._id] = c.count);
      
      items.forEach(item => {
        if ((countMap[item.serial_number] || 0) > 1) {
          item.isDuplicate = true;
        }
      });
    }

    res.json({
      items,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error in GET /stats:', error);
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get a single asset by ID with full details and history
// @route   GET /api/assets/:id
// @access  Private
router.get('/:id([0-9a-fA-F]{24})', protect, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .select('name model_number serial_number serial_last_4 mac_address manufacturer ticket_number po_number rfid qr_code uniqueId store location status previous_status condition product_name assigned_to assigned_to_external return_pending return_request source vendor_name delivered_by_name delivered_at quantity price history createdAt updatedAt')
      .populate({
        path: 'store',
        select: 'name parentStore',
        populate: {
          path: 'parentStore',
          select: 'name'
        }
      })
      .populate('assigned_to', 'name email')
      .populate('return_request.requested_by', 'name email')
      .lean();
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    res.json(asset);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Search assets by serial suffix (last 4+ chars)
// @route   GET /api/assets/search-serial
// @access  Private
router.get('/search-serial', protect, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 3) {
      return res.json([]);
    }

    const query = {};
    if (req.activeStore) {
      const storeIds = await getStoreIds(req.activeStore);
      query.store = { $in: storeIds };
    }

    // Optimization: If exactly 4 chars, try exact match on serial_last_4 first (extremely fast)
    if (q.length === 4) {
      query.$or = [
        { serial_last_4: q },
        { serial_number: new RegExp(`${q}$`, 'i') }
      ];
    } else {
       const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
       query.serial_number = new RegExp(`${escapedQ}$`, 'i');
    }

    const assets = await Asset.find(query)
      .select('name model_number serial_number description')
      .limit(20)
      .lean();
      
    res.json(assets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get asset statistics
// @route   GET /api/assets/stats
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const filter = {};
    let targetStoreId = null;

    if (req.activeStore && mongoose.isValidObjectId(req.activeStore)) {
      targetStoreId = req.activeStore;
    } else if (req.user.role !== 'Super Admin' && req.user.assignedStore) {
      targetStoreId = req.user.assignedStore;
    }

    if (targetStoreId) {
      const storeIds = await getStoreIds(targetStoreId);
      filter.store = { $in: storeIds };
    }

    const requestFilter = { status: 'Pending' };
    if (targetStoreId) {
       // Also apply hierarchy to requests? Maybe.
       // Requests usually have a specific store.
       // But if we are viewing parent store, we might want to see requests from children.
       const storeIds = await getStoreIds(targetStoreId);
       requestFilter.store = { $in: storeIds };
    }

    const quantityExpr = {
      $cond: [
        { $gt: ['$quantity', 0] },
        '$quantity',
        1
      ]
    };

    const sumQuantity = async (match) => {
      const result = await Asset.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: quantityExpr }
          }
        }
      ]);
      return (result[0] && result[0].total) || 0;
    };

    // Parallel execution for 5x faster stats loading
    const [
      totalAssets,
      assignedCount,
      faultyCount,
      underRepairCount,
      disposedCount,
      inStoreCount,
      pendingReturnsCount,
      pendingRequestsCount,
      spareCount,
      conditionCounts,
      statusCounts,
      modelCounts,
      productCounts,
      locationCounts,
      categoryCounts,
      growthStats,
      usageBreakdownCounts,
      assetTypeCountAgg
    ] = await Promise.all([
      sumQuantity(filter),
      sumQuantity({ 
        ...filter,
        $or: [
          { status: 'In Use' },
          { assigned_to: { $ne: null } },
          { 'assigned_to_external.name': { $exists: true, $ne: '' } }
        ]
      }),
      sumQuantity({ 
        ...filter,
        $or: [
          { status: 'Faulty' },
          { condition: 'Faulty' }
        ]
      }),
      sumQuantity({ ...filter, status: 'Under Repair' }),
      sumQuantity({ 
        ...filter,
        $or: [
          { status: 'Disposed' },
          { condition: 'Disposed' }
        ]
      }),
      sumQuantity({ ...filter, status: { $in: ['In Store', 'Faulty'] } }),
      Asset.countDocuments({ ...filter, return_pending: true }),
      Request.countDocuments(requestFilter),
      sumQuantity({ 
        ...filter,
        assigned_to: null, 
        condition: { $in: ['New', 'Used'] }, 
        status: { $nin: ['Faulty', 'Under Repair', 'Disposed', 'In Use'] } 
      }),
      Asset.aggregate([
        { $match: filter },
        { 
          $project: { 
            condBucket: {
              $switch: {
                branches: [
                  { case: { $eq: ['$status', 'Faulty'] }, then: 'Faulty' },
                  { case: { $eq: ['$status', 'Under Repair'] }, then: 'Under Repair' },
                  { case: { $eq: ['$status', 'Disposed'] }, then: 'Disposed' },
                  { case: { $regexMatch: { input: { $ifNull: ['$condition', ''] }, regex: /disposed/i } }, then: 'Disposed' },
                  { case: { $eq: ['$status', 'Scrapped'] }, then: 'Scrapped' },
                  { case: { $eq: ['$status', 'New'] }, then: 'New' },
                  { case: { $eq: ['$status', 'Used'] }, then: 'Used' },
                  { case: { $regexMatch: { input: { $ifNull: ['$condition', ''] }, regex: /new/i } }, then: 'New' },
                  { case: { $regexMatch: { input: { $ifNull: ['$condition', ''] }, regex: /used/i } }, then: 'Used' }
                ],
                default: 'Used'
              }
            }
          } 
        },
        { $group: { _id: '$condBucket', count: { $sum: quantityExpr } } }
      ]),
      Asset.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: quantityExpr } } }]),
      Asset.aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ['$model_number', '' ] } }, 0] },
                { $toLower: '$model_number' },
                { $toLower: '$product_name' }
              ]
            },
            count: { $sum: quantityExpr }
          }
        },
        { $match: { _id: { $ne: '' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      Asset.aggregate([
        { $match: filter },
        { $group: { _id: { $toLower: '$product_name' }, count: { $sum: quantityExpr } } },
        { $match: { _id: { $ne: '' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      Asset.aggregate([
        { $match: filter },
        { $group: { _id: { $toLower: '$location' }, count: { $sum: quantityExpr } } },
        { $match: { _id: { $ne: '' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      Promise.resolve([]),
      Asset.aggregate([
        { $match: { ...filter, createdAt: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 6)) } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, count: { $sum: quantityExpr } } },
        { $sort: { _id: 1 } }
      ]),
      Asset.aggregate([
        { $match: filter },
        { 
          $project: { 
            isInstalled: {
              $or: [
                { $eq: ['$status', 'In Use'] },
                { $ne: ['$assigned_to', null] },
                { $regexMatch: { input: { $ifNull: ['$assigned_to_external.name', '' ] }, regex: /.+/ } }
              ]
            },
            isFaulty: {
              $or: [
                { $eq: ['$status', 'Faulty'] },
                { $eq: ['$condition', 'Faulty'] }
              ]
            },
            isUsed: { $eq: ['$condition', 'Used'] }
          }
        },
        {
          $project: {
            category: {
              $switch: {
                branches: [
                  { case: '$isInstalled', then: 'Installed' },
                  { case: '$isFaulty', then: 'Faulty' },
                  { case: '$isUsed', then: 'Used' }
                ],
                default: 'Other'
              }
            }
          }
        },
        { $group: { _id: '$category', count: { $sum: quantityExpr } } }
      ]),
      Asset.aggregate([
        { $match: filter },
        { $group: { _id: { $toLower: '$model_number' } } },
        { $match: { _id: { $ne: '' } } },
        { $count: 'count' }
      ])
    ]);

    const inStoreExclusive = Math.max(
      totalAssets - assignedCount - faultyCount - underRepairCount - disposedCount,
      0
    );
    const stats = {
      overview: {
        total: totalAssets,
        inUse: assignedCount,
        inStore: inStoreExclusive,
        spare: spareCount,
        faulty: faultyCount,
        underRepair: underRepairCount,
        disposed: disposedCount,
        pendingReturns: pendingReturnsCount,
        pendingRequests: pendingRequestsCount,
        assetTypes: (assetTypeCountAgg[0] && assetTypeCountAgg[0].count) || 0
      },
      conditions: {
        New: 0,
        Used: 0,
        Faulty: 0,
        'Under Repair': 0,
        Disposed: 0,
        Scrapped: 0
      },
      models: [],
      products: [],
      locations: [],
      categories: [],
      growth: growthStats.map(g => ({ name: g._id, value: g.count }))
    };

    const usageMap = { Installed: 0, Used: 0, Faulty: 0, Other: 0 };
    usageBreakdownCounts.forEach(u => { if (u._id && usageMap.hasOwnProperty(u._id)) usageMap[u._id] = u.count; });
    stats.usageBreakdown = {
      installed: usageMap.Installed,
      used: usageMap.Used,
      faulty: usageMap.Faulty,
      other: usageMap.Other
    };

    conditionCounts.forEach(item => {
      if (item._id) stats.conditions[item._id] = item.count;
    });
    const scr = statusCounts.find(s => s._id === 'Scrapped');
    if (scr) stats.conditions.Scrapped = scr.count;

    stats.models = modelCounts.map(item => ({
      name: item._id || 'Unknown',
      value: item.count
    }));
    stats.products = productCounts.map(item => ({
      name: item._id || 'Unknown',
      value: item.count
    }));
    stats.locations = locationCounts.map(item => ({
      name: item._id || 'Unknown',
      value: item.count
    }));

    res.json(stats);
  } catch (error) {
    console.error('Error in GET /stats:', error);
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get asset by Serial (Full or Last 4)
// @route   GET /api/assets/search
// @access  Private
router.get('/search', protect, async (req, res) => {
  const { query } = req.query;
  
  if (!query || query.trim() === '') {
    return res.json([]);
  }

  const cleanQuery = query.trim();
  // Escape special regex characters
  const escapedQuery = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  try {
    // Search using 'contains' logic (covers full serial, last 4 digits, middle, etc.)
    const qObj = {
      $or: [
        { serial_number: { $regex: new RegExp(escapedQuery, 'i') } },
        { uniqueId: { $regex: new RegExp(escapedQuery, 'i') } }
      ]
    };
    
    if (req.activeStore) {
      const storeIds = await getStoreIds(req.activeStore);
      qObj.store = { $in: storeIds };
    }

    const assets = await Asset.find(qObj)
      .select('name model_number serial_number uniqueId store status condition location assigned_to updatedAt')
      .populate('store', 'name')
      .populate('assigned_to', 'name email')
      .lean();
    
    res.json(assets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get assets related to current technician
// @route   GET /api/assets/my
// @access  Private
router.get('/my', protect, async (req, res) => {
  try {
    const assets = await Asset.find({
      $or: [
        { assigned_to: req.user._id },
        { history: { $elemMatch: { user: req.user.name, action: { $regex: /^Returned\//i } } } },
        { history: { $elemMatch: { user: req.user.name, action: 'Collected' } } },
        { history: { $elemMatch: { user: req.user.name, action: 'Reported Faulty' } } }
      ]
    })
      .populate('store')
      .populate('assigned_to', 'name')
      .lean();
    res.json(assets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Download Excel Template
router.get('/template', async (req, res) => {
  try {
    const wb = xlsx.utils.book_new();

    const headers = [
      'Category',
      'Product Type',
      'Product Name',
      'Model Number',
      'Quantity',
      'Price',
      'Serial Number',
      'MAC Address',
      'Manufacturer',
      'Ticket Number',
      'RFID',
      'QR Code',
      'Store',
      'Location',
      'Status',
      'Condition',
      'Delivered By',
      'Delivered At'
    ];

    // Sheet 1: Template (headers only)
    const templateRows = [headers];
    const wsTemplate = xlsx.utils.aoa_to_sheet(templateRows);
    wsTemplate['!cols'] = headers.map((_, idx) => ({ wch: idx === 0 ? 28 : 20 }));
    xlsx.utils.book_append_sheet(wb, wsTemplate, 'Template');

    // Sheet 2: Sample (headers + one example row)
    const sampleRow = [
      'ACCESS CONTROL SYSTEMS',
      'LOCKS',
      'MAGNETIC LOCKS',
      'MEC-1200',
      '1',
      '100',
      '1584632152',
      '',
      'SIEMENS',
      '-',
      '-',
      '-',
      'SCY STORE',
      'MOBILITY STORE-10',
      'IN STORE',
      'USED',
      'JOHN DOE',
      '2024-01-01 10:00'
    ];
    const wsSample = xlsx.utils.aoa_to_sheet([headers, sampleRow]);
    wsSample['!cols'] = headers.map((_, idx) => ({ wch: idx === 0 ? 28 : 20 }));
    xlsx.utils.book_append_sheet(wb, wsSample, 'Sample');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="Asset_Import_Template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Template generation error:', err);
    res.status(500).json({ message: 'Failed to generate template' });
  }
});

// Removed duplicate simple import handler

// @desc    Create an asset
// @route   POST /api/assets
// @access  Private (Admin or Technician)
router.post('/', protect, restrictViewer, async (req, res) => {
  const { name, model_number, serial_number, mac_address, manufacturer, store, location, status, condition, ticket_number, po_number, product_name, rfid, qr_code, quantity } = req.body;
  try {
    const normName = capitalizeWords(name);
    const normProduct = capitalizeWords(product_name || '');
    const normManufacturer = capitalizeWords(manufacturer || '');
    const normLocation = capitalizeWords(location || '');
    const qty = Number.parseInt(quantity, 10) > 0 ? Number.parseInt(quantity, 10) : 1;
    // Check for duplicate serial number within the same store
    const duplicateQuery = { serial_number };
    if (req.activeStore) {
      duplicateQuery.store = req.activeStore;
    } else if (store) {
      duplicateQuery.store = store;
    }
    
    const assetExists = await Asset.findOne(duplicateQuery);
    if (assetExists) {
      return res.status(400).json({ message: 'Asset with this serial number already exists in this store' });
    }

    // Auto-create hierarchy removed; rely on bulk product assignment routes
    let linkedProductName = null;
    try {
      if (!normProduct && model_number) {
        linkedProductName = await findProductNameByModelNumber(model_number, req.activeStore);
      }
    } catch {}
    const finalProductName = normProduct || linkedProductName || '';
 
    const uniqueId = await generateUniqueId(name);
    const asset = await Asset.create({
      name: normName,
      model_number,
      serial_number,
      serial_last_4: (serial_number || '').slice(-4),
      mac_address,
      manufacturer: normManufacturer || '',
      ticket_number: ticket_number || '',
      po_number: po_number || '',
      product_name: finalProductName,
      rfid: rfid || '',
      qr_code: qr_code || '',
      uniqueId,
      store: req.activeStore || store,
      status: status || 'New',
      condition: condition || 'New / Excellent',
      location: normLocation || '',
      quantity: qty
    });

    // Log Activity
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Create Asset',
      details: `Created asset ${name} (SN: ${serial_number}) qty=${qty}`,
      store: req.activeStore || store
    });

    res.status(201).json(asset);
  } catch (error) {
    console.error('Error creating asset:', error);
    res.status(400).json({ message: error.message });
  }
});

// @desc    Bulk create assets (force duplicate)
// @route   POST /api/assets/bulk
// @access  Private/Admin
router.post('/bulk', protect, admin, async (req, res) => {
  const { assets } = req.body;
  if (!Array.isArray(assets) || assets.length === 0) {
    return res.status(400).json({ message: 'No assets provided' });
  }

  try {
    // Inject active store if present and ensure serial_last_4
    const assetsWithStore = assets.map(asset => ({
      ...asset,
      name: capitalizeWords(asset.name || ''),
      product_name: capitalizeWords(asset.product_name || ''),
      manufacturer: capitalizeWords(asset.manufacturer || ''),
      location: capitalizeWords(asset.location || ''),
      store: req.activeStore || asset.store,
      serial_last_4: asset.serial_last_4 || (asset.serial_number ? String(asset.serial_number).slice(-4) : '')
    }));

    // If activeStore is set, ensure all assets get it.
    // If not set (Super Admin without context?), maybe allow manual store?
    // But Super Admin usually selects store in Portal.
    
    const created = [];
    const warnings = [];
    for (const a of assetsWithStore) {
      try {
        // Auto-create hierarchy removed for bulk; use products routes
        if (a.serial_number) {
          const exists = await Asset.findOne({ serial_number: a.serial_number, store: a.store }).lean();
          if (exists) warnings.push({ serial: a.serial_number, message: 'Duplicate accepted (Admin)' });
        }
        const item = await Asset.create({
          ...a,
          serial_last_4: a.serial_last_4 || (a.serial_number ? String(a.serial_number).slice(-4) : '')
        });
        created.push(item);
      } catch {}
    }
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Bulk Force Import',
      details: `Imported ${created.length} assets${warnings.length ? ` with ${warnings.length} duplicate warnings` : ''}`,
      store: req.activeStore || (created.length > 0 ? created[0].store : undefined)
    });
    res.status(201).json({ message: `Successfully added ${created.length} assets`, warnings });
  } catch (error) {
    console.error('Bulk create error:', error);
    res.status(500).json({ message: 'Error adding assets', error: error.message });
  }
});

// @desc    Bulk update assets
// @route   POST /api/assets/bulk-update
// @access  Private/Admin
router.post('/bulk-update', protect, admin, async (req, res) => {
  try {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No asset IDs provided' });
    }
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ message: 'No updates provided' });
    }

    const data = {};
    if (updates.status) data.status = updates.status;
    if (updates.condition) data.condition = updates.condition;
    if (updates.manufacturer) data.manufacturer = capitalizeWords(updates.manufacturer);
    if (updates.location) data.location = capitalizeWords(updates.location);
    let prodName = updates.product_name ? String(updates.product_name) : '';
    if (prodName) data.product_name = capitalizeWords(prodName);

    const result = await Asset.updateMany({ _id: { $in: ids } }, { $set: data });

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Bulk Edit Assets',
      details: `Updated ${result.modifiedCount || 0} assets`,
      store: req.activeStore
    });

    const updated = await Asset.find({ _id: { $in: ids } })
      .populate('store', 'name')
      .lean();

    res.json({ message: `Updated ${result.modifiedCount || 0} assets`, items: updated });
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({ message: 'Error updating assets', error: error.message });
  }
});

// @desc    Bulk delete assets
// @route   POST /api/assets/bulk-delete
// @access  Private/Admin
router.post('/bulk-delete', protect, admin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No asset IDs provided' });
    }
    const toDelete = await Asset.find({ _id: { $in: ids } }).lean();
    const result = await Asset.deleteMany({ _id: { $in: ids } });

    // Log activity summary
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Bulk Delete Assets',
      details: `Deleted ${result.deletedCount || 0} assets`,
      store: req.activeStore
    });

    res.json({ message: `Deleted ${result.deletedCount || 0} assets`, deletedIds: ids, preview: toDelete.slice(0, 5) });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ message: 'Error deleting assets', error: error.message });
  }
});

// @desc    Split asset quantity (e.g., report faulty items from a batch)
// @route   POST /api/assets/split
// @access  Private (Admin/Technician)
router.post('/split', protect, restrictViewer, async (req, res) => {
  const { assetId, splitQuantity, newStatus, newCondition } = req.body;
  const qtyToSplit = parseInt(splitQuantity, 10);

  if (!assetId || !qtyToSplit || qtyToSplit <= 0) {
    return res.status(400).json({ message: 'Invalid parameters' });
  }

  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    // RBAC: Check store access
    if (req.activeStore && asset.store && asset.store.toString() !== req.activeStore.toString()) {
      return res.status(403).json({ message: 'Access denied to this store asset' });
    }

    if (asset.quantity <= qtyToSplit) {
      return res.status(400).json({ message: 'Split quantity must be less than current asset quantity. Use Edit to change status of entire batch.' });
    }

    // 1. Decrement original asset quantity
    asset.quantity -= qtyToSplit;
    await asset.save();

    // 2. Create new asset with split quantity and new status
    const newAssetData = asset.toObject();
    delete newAssetData._id;
    delete newAssetData.createdAt;
    delete newAssetData.updatedAt;
    delete newAssetData.__v;
    
    // Generate new Unique ID for the new batch
    newAssetData.uniqueId = await generateUniqueId(asset.name);
    newAssetData.quantity = qtyToSplit;
    newAssetData.status = newStatus || 'Faulty';
    newAssetData.condition = newCondition || 'Faulty';
    newAssetData.source = 'Split from ' + asset.uniqueId;
    
    // Clear assignment if splitting (usually split items go to store/faulty pile, not stay assigned to same person immediately)
    newAssetData.assigned_to = null;
    newAssetData.assigned_to_external = null;

    const newAsset = await Asset.create(newAssetData);

    // 3. Log Activity
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      store: asset.store,
      action: 'Split Asset',
      details: `Split ${qtyToSplit} items from ${asset.name} (${asset.uniqueId}) as ${newStatus}`
    });

    res.status(200).json({ original: asset, new: newAsset });
  } catch (error) {
    console.error('Error splitting asset:', error);
    res.status(500).json({ message: error.message });
  }
});

// @desc    Preview bulk upload assets via Excel (no database writes)
// @route   POST /api/assets/import/preview
// @access  Private (Admin or Technician)
router.post('/import/preview', protect, restrictViewer, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  try {
    const importBatchId = `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no sheets found' });
    }
    let rows = [];
    for (const name of workbook.SheetNames) {
      const ws = workbook.Sheets[name];
      if (!ws) continue;
      const out = xlsx.utils.sheet_to_json(ws, { defval: '', blankrows: false });
      if (Array.isArray(out) && out.length > 0) {
        rows = out;
        break;
      }
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no data rows found' });
    }
    const stores = await Store.find().lean();
    const storeMapLower = {};
    stores.forEach(s => { if (s.name) storeMapLower[s.name.trim().toLowerCase()] = s._id; });
    const allProducts = await Product.find().lean();
    const productLookup = {};
    const traverse = (list) => {
      (list || []).forEach(p => {
        const key = String(p.name).trim().toLowerCase();
        if (!productLookup[key]) productLookup[key] = p.name;
        if (p.children && p.children.length > 0) traverse(p.children);
      });
    };
    allProducts.forEach(root => {
      productLookup[String(root.name).trim().toLowerCase()] = root.name;
      if (root.children) traverse(root.children);
    });
    const normalizeText = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return '';
      if (/^(?:N\/A|NA|-|—)$/i.test(s)) return '';
      return s;
    };
    const preview = [];
    const invalid_rows = [];
    for (const item of rows) {
      const norm = {};
      Object.keys(item).forEach(k => { norm[String(k).trim().toLowerCase()] = item[k]; });
      let productName = norm['product name'] || norm['product'] || norm['asset type'] || '';
      if (productName) {
        const found = productLookup[String(productName).trim().toLowerCase()];
        if (found) productName = found;
      }
      const name = productName || '-';
      const model = norm['model number'] || norm['model'] || '-';
      const qtyRaw = norm['quantity'] || norm['qty'] || '1';
      let quantity = parseInt(String(qtyRaw).trim(), 10);
      if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
      const priceRaw = norm['price'] || norm['unit price'] || '0';
      let price = parseFloat(String(priceRaw).toString().replace(/[, ]/g, ''));
      if (!Number.isFinite(price) || price < 0) price = 0;
      const serial = norm['serial number'] || norm['serial'] || '-';
      const mac = norm['mac address'] || norm['mac'] || '-';
      const manufacturer = norm['manufacturer'] || '-';
      const ticketNumber = norm['ticket number'] || norm['ticket'] || '-';
      const rfid = norm['rfid'] || '-';
      const qrCode = norm['qr code'] || norm['qr'] || '-';
      const storeName = normalizeText(norm['store location'] || norm['storename'] || norm['store'] || '');
      const locationRawCombined = norm['location'] || norm['physical location'] || norm['room'] || norm['area'] || '';
      let location = normalizeText(locationRawCombined);
      if (!location && storeName) location = storeName;
      const statusRaw = norm['status'];
      const statusNorm = String(statusRaw || '').trim().toLowerCase();
      const statusMap = {
        'available/new': 'New',
        'new': 'New',
        'spare': 'New',
        'spare (new)': 'New',
        'spare (used)': 'Used',
        'available/used': 'Used',
        'used': 'Used',
        'in store': 'In Store',
        'in use': 'In Use',
        'available faulty': 'Faulty',
        'faulty': 'Faulty',
        'disposed': 'Disposed',
        'under repair': 'Under Repair'
      };
      const status = statusMap[statusNorm] || 'New';
      const conditionRaw = norm['condition'];
      let condition = 'New';
      if (conditionRaw) {
        const cNorm = String(conditionRaw).trim().toLowerCase();
        if (cNorm.includes('new')) condition = 'New';
        else if (cNorm.includes('used')) condition = 'Used';
        else if (cNorm.includes('faulty')) condition = 'Faulty';
        else if (cNorm.includes('repair')) condition = 'Under Repair';
        else if (cNorm.includes('disposed')) condition = 'Disposed';
        else if (cNorm.includes('repaired')) condition = 'Repaired';
      }
      let storeId = storeMapLower[String(storeName || '').toLowerCase()];
      if (req.activeStore) {
        storeId = req.activeStore;
      }
      const uniqueId = await generateUniqueId(name);
      const deliveredByFromRow = norm['delivered by'] || norm['delivered_by'] || norm['deliveredby'] || '';
      const vendorNameFromRow = norm['vendor name'] || norm['vendor'] || '';
      const deliveredAtRaw = norm['delivered at'] || norm['delivered_at'] || '';
      const deliveredAtDate = deliveredAtRaw ? new Date(deliveredAtRaw) : new Date();
      const assetData = {
        name: capitalizeWords(name || ''),
        model_number: model,
        serial_number: String(serial || '').trim(),
        serial_last_4: String(serial || '').trim() ? String(serial).slice(-4) : '',
        mac_address: mac,
        manufacturer: capitalizeWords(manufacturer || ''),
        ticket_number: ticketNumber,
        rfid,
        qr_code: qrCode,
        uniqueId,
        store: storeId,
        status,
        condition,
        product_name: capitalizeWords(productName || ''),
        source: '',
        location: capitalizeWords(location || ''),
        vendor_name: vendorNameFromRow || '',
        delivered_by_name: deliveredByFromRow || '',
        delivered_at: deliveredAtDate,
        quantity,
        price
      };
      if (!assetData.serial_number) {
        invalid_rows.push({ serial: '', reason: 'Missing serial number' });
        continue;
      }
      preview.push(assetData);
    }
    res.json({ assets: preview, invalid_rows });
  } catch (error) {
    res.status(500).json({ message: 'Error parsing file', error: error.message });
  }
});

// @desc    Bulk upload assets via Excel
// @route   POST /api/assets/import
// @access  Private (Admin or Technician)
router.post('/import', protect, restrictViewer, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const importBatchId = `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no sheets found' });
    }
    const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
    let data = [];
    let sheetName = null;
    for (const name of sheetNames) {
      const ws = workbook.Sheets[name];
      if (!ws) continue;
      const rows = xlsx.utils.sheet_to_json(ws, { defval: '', blankrows: false });
      if (Array.isArray(rows) && rows.length > 0) {
        data = rows;
        sheetName = name;
        break;
      }
    }
    // Fallback: manual header parsing if standard conversion returns empty
    if (!Array.isArray(data) || data.length === 0) {
      for (const name of sheetNames) {
        const ws = workbook.Sheets[name];
        if (!ws) continue;
        const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
        if (Array.isArray(raw) && raw.length > 0) {
          // Find header row dynamically (matches at least one known header)
          const KNOWN = ['product name','name','model number','serial number','mac address','manufacturer','ticket number','rfid','qr code','store','store location','location','status','condition','asset type'];
          let headerIdx = -1;
          for (let i = 0; i < raw.length; i++) {
            const row = raw[i] || [];
            const lower = row.map(c => String(c || '').trim().toLowerCase());
            const matchCount = lower.filter(c => KNOWN.includes(c)).length;
            if (matchCount >= 2) { // require at least 2 header hits
              headerIdx = i;
              break;
            }
          }
          if (headerIdx >= 0 && raw.length > headerIdx + 1) {
            const headers = (raw[headerIdx] || []).map(h => String(h || '').trim());
            const body = raw.slice(headerIdx + 1);
            const converted = body.map(row => {
              const obj = {};
              headers.forEach((h, idx) => { obj[h] = row[idx] !== undefined ? row[idx] : ''; });
              return obj;
            }).filter(r => Object.values(r).some(v => String(v || '').trim() !== ''));
            if (converted.length > 0) {
              data = converted;
              sheetName = name;
              break;
            }
          }
        }
      }
    }
    if (!Array.isArray(data) || data.length === 0) {
      // Fallback #2: decode cells manually via !ref to tolerate exotic formatting
      for (const name of sheetNames) {
        const ws = workbook.Sheets[name];
        if (!ws || !ws['!ref']) continue;
        try {
          const range = xlsx.utils.decode_range(ws['!ref']);
          const KNOWN = new Set(['product name','name','model number','serial number','mac address','manufacturer','ticket number','rfid','qr code','store','store location','location','status','condition','asset type']);
          let headerIdx = -1;
          let headers = [];
          for (let r = range.s.r; r <= range.e.r; r++) {
            const rowVals = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = xlsx.utils.encode_cell({ c, r });
              const cell = ws[addr];
              const val = cell && cell.v !== undefined ? String(cell.v).trim() : '';
              rowVals.push(val);
            }
            const matchCount = rowVals.map(v => v.toLowerCase()).filter(v => KNOWN.has(v)).length;
            if (matchCount >= 2) {
              headerIdx = r;
              headers = rowVals;
              break;
            }
          }
          if (headerIdx >= 0) {
            const converted = [];
            for (let r = headerIdx + 1; r <= range.e.r; r++) {
              const obj = {};
              let nonEmpty = false;
              for (let c = range.s.c; c <= range.e.c; c++) {
                const addr = xlsx.utils.encode_cell({ c, r });
                const cell = ws[addr];
                const val = cell && cell.v !== undefined ? String(cell.v).trim() : '';
                const header = headers[c - range.s.c] || `COL${c}`;
                obj[header] = val;
                if (val !== '') nonEmpty = true;
              }
              if (nonEmpty) converted.push(obj);
            }
            if (converted.length > 0) {
              data = converted;
              sheetName = name;
              break;
            }
          }
        } catch (e) {
          // ignore and continue
        }
      }
    }
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no data rows found' });
    }

    const duplicates = [];
    const createdCount = { v: 0 };
    const updatedCount = { v: 0 };
    const {
      product_name: reqProductName,
      source: reqSource,
      location: reqLocation,
      delivered_by_name: reqDeliveredByName,
      delivered_at: reqDeliveredAt,
      vendor_name: reqVendorName
    } = req.body;
    
    const stores = await Store.find();
    const storeMap = {};
    const storeMapLower = {};
    const locationNameSet = new Set();
    stores.forEach(s => {
      if (s.name) {
        storeMap[s.name] = s._id;
        storeMapLower[s.name.trim().toLowerCase()] = s._id;
        locationNameSet.add(s.name.trim().toLowerCase());
      }
    });

    // Pre-fetch products for smart lookup
    const allProducts = await Product.find().lean();
    const productLookup = {}; // productName -> canonical name
    allProducts.forEach(root => {
      const traverse = (list) => {
        list.forEach(p => {
          const key = String(p.name).trim().toLowerCase();
          if (!productLookup[key]) productLookup[key] = p.name;
          if (p.children && p.children.length > 0) traverse(p.children);
        });
      };
      productLookup[String(root.name).trim().toLowerCase()] = root.name;
      if (root.children) traverse(root.children);
    });

    const fileSeenSerials = new Set();
    const invalidRows = [];
    
    // Helper to check for N/A
    const isNA = (val) => {
      const s = String(val || '').trim();
      return s === '' || s.toUpperCase() === 'N/A' || s === '-';
    };

    // Helper: normalized text cell (trim, collapse N/A)
    const normalizeText = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return '';
      if (/^(?:N\/A|NA|-|—)$/i.test(s)) return '';
      return s;
    };

    for (const item of data) {
      const norm = {};
      Object.keys(item).forEach(k => { norm[String(k).trim().toLowerCase()] = item[k]; });
      
      // Mapping based on User Request + Aliases
      // "Excel headers supported: asset type, Model number, Serial number, mac address, Manufacturer, Ticket number, RFID, QR Code, Store location, Status"
      
      let productName = reqProductName || norm['product name'] || norm['product'] || '-';

      const categoryFromRow = norm['category'] || '';
      const typeFromRow = norm['product type'] || norm['producttype'] || '';

      if (!productName && (norm['asset type'] || norm['assettype'])) {
        productName = norm['asset type'] || norm['assettype'];
      }
      
      // Smart Lookup: canonical casing
      if (productName) {
        const found = productLookup[String(productName).trim().toLowerCase()];
        if (found) productName = found;
      }
      
      // Name fallback strategy
      const name = productName || '-';
      
      const model = norm['model number'] || norm['model'] || '-';
      const qtyRaw = norm['quantity'] || norm['qty'] || '1';
      let quantity = parseInt(String(qtyRaw).trim(), 10);
      if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
      const priceRaw = norm['price'] || norm['unit price'] || '0';
      let price = parseFloat(String(priceRaw).toString().replace(/[, ]/g, ''));
      if (!Number.isFinite(price) || price < 0) price = 0;
      const serial = norm['serial number'] || norm['serial'] || '-';
      const mac = norm['mac address'] || norm['mac'] || '-';
      const manufacturer = norm['manufacturer'] || '-';
      const ticketNumber = norm['ticket number'] || norm['ticket'] || '-';
      const rfid = norm['rfid'] || '-';
      const qrCode = norm['qr code'] || norm['qr'] || '-';
      
      const storeNameRaw = norm['store location'] || norm['storename'] || norm['store'] || '';
      const storeName = normalizeText(storeNameRaw);
      
      // Robust location normalization: trim, drop placeholders, fallback to store name if empty
      const locationRawCombined = reqLocation || norm['location'] || norm['physical location'] || norm['room'] || norm['area'] || '';
      let location = normalizeText(locationRawCombined);
      if (!location && storeName) {
        location = storeName;
      }
      
      const statusRaw = norm['status'];
      const statusNorm = String(statusRaw || '').trim().toLowerCase();
      const statusMap = {
        'available/new': 'New',
        'new': 'New',
        'spare': 'New',
        'spare (new)': 'New',
        'spare (used)': 'Used',
        'available/used': 'Used',
        'used': 'Used',
        'in store': 'In Store',
        'in use': 'In Use',
        'available faulty': 'Faulty',
        'faulty': 'Faulty',
        'disposed': 'Disposed',
        'under repair': 'Under Repair'
      };
      const status = statusMap[statusNorm] || 'New';

      const deliveredByFromRow = norm['delivered by'] || norm['delivered_by'] || norm['deliveredby'] || '';
      const vendorNameFromRow = norm['vendor name'] || norm['vendor'] || '';
      const deliveredAtRaw = norm['delivered at'] || norm['delivered_at'] || '';
      
      // Condition Logic (strict enum mapping)
      const conditionRaw = norm['condition'];
      let condition = 'New';
      if (conditionRaw) {
         const cNorm = String(conditionRaw).trim().toLowerCase();
         if (cNorm === 'new' || cNorm.includes('new')) condition = 'New';
         else if (cNorm === 'used' || cNorm.includes('used')) condition = 'Used';
         else if (cNorm === 'faulty' || cNorm.includes('faulty')) condition = 'Faulty';
         else if (cNorm === 'under repair' || cNorm.includes('repair')) condition = 'Under Repair';
         else if (cNorm === 'disposed' || cNorm.includes('disposed')) condition = 'Disposed';
         else if (cNorm === 'repaired' || cNorm.includes('repaired')) condition = 'Repaired';
      }

      let storeId = storeMap[storeName] || storeMapLower[storeName.toLowerCase()];
      
      // Enforce active store context if present
      if (req.activeStore) {
        storeId = req.activeStore;
      }
      
      // Uppercase enforcement: trim first before check
      const hasLower = (s) => /[a-z]/.test(String(s || '').trim());
      const uppercaseViolations = [];
      if (hasLower(categoryFromRow)) uppercaseViolations.push('Category');
      if (hasLower(typeFromRow)) uppercaseViolations.push('Product Type');
      if (hasLower(productName)) uppercaseViolations.push('Product Name');
      if (hasLower(model)) uppercaseViolations.push('Model Number');
      if (hasLower(mac)) uppercaseViolations.push('MAC Address');
      if (hasLower(manufacturer)) uppercaseViolations.push('Manufacturer');
      if (hasLower(ticketNumber)) uppercaseViolations.push('Ticket Number');
      if (hasLower(rfid)) uppercaseViolations.push('RFID');
      if (hasLower(qrCode)) uppercaseViolations.push('QR Code');
      if (hasLower(location)) uppercaseViolations.push('Location');
      if (hasLower(deliveredByFromRow)) uppercaseViolations.push('Delivered By');
      if (hasLower(vendorNameFromRow)) uppercaseViolations.push('Vendor Name');
      if (uppercaseViolations.length > 0) {
        invalidRows.push({
          serial,
          reason: `Non-capital letters in: ${uppercaseViolations.join(', ')}`
        });
        continue;
      }
      
      // Upsert by Serial (Store-scoped)
      {
        const serialStr = String(serial).trim();
        const uniqueId = await generateUniqueId(name);
        
        let deliveredAtDate;
        if (deliveredAtRaw) {
          deliveredAtDate = new Date(deliveredAtRaw);
        } else if (reqDeliveredAt) {
          deliveredAtDate = new Date(reqDeliveredAt);
        } else {
          deliveredAtDate = new Date();
        }

        const assetData = {
          importBatchId,
          name: String(name || '').toUpperCase(),
          model_number: model,
          serial_number: serialStr,
          serial_last_4: isNA(serialStr) ? '-' : serialStr.slice(-4),
          mac_address: mac,
          manufacturer: String(manufacturer || '').toUpperCase(),
          ticket_number: ticketNumber,
          rfid,
          qr_code: qrCode,
          uniqueId,
          store: storeId,
          status,
          condition,
          product_name: productName,
          source: reqSource,
          location: String(location || '').trim() ? String(location).toUpperCase() : (storeName ? storeName.toUpperCase() : 'UNKNOWN'),
          vendor_name: vendorNameFromRow || reqVendorName || '',
          delivered_by_name: deliveredByFromRow || reqDeliveredByName || '',
          delivered_at: deliveredAtDate,
          quantity,
          price
        };

        try {
          // If serial present, try upsert; otherwise create new
          if (serialStr) {
            const existing = await Asset.findOne({ serial_number: serialStr, store: storeId });
            if (existing) {
              // Update only with provided fields
              await Asset.updateOne(
                { _id: existing._id },
                { $set: {
                  importBatchId: assetData.importBatchId,
                  name: assetData.name,
                  model_number: assetData.model_number,
                  mac_address: assetData.mac_address,
                  manufacturer: assetData.manufacturer,
                  ticket_number: assetData.ticket_number,
                  rfid: assetData.rfid,
                  qr_code: assetData.qr_code,
                  status: assetData.status,
                  condition: assetData.condition,
                  product_name: assetData.product_name,
                  location: assetData.location,
                  vendor_name: assetData.vendor_name,
                  delivered_by_name: assetData.delivered_by_name,
                  delivered_at: assetData.delivered_at,
                  quantity: assetData.quantity,
                  price: assetData.price,
                  serial_last_4: assetData.serial_last_4
                } }
              );
              updatedCount.v++;
            } else {
              await Asset.create(assetData);
              createdCount.v++;
            }
          } else {
            await Asset.create(assetData);
            createdCount.v++;
          }
        } catch (e) {
          duplicates.push({ serial: serialStr || '', reason: e.message || 'Upsert error' });
        }
      }
    }

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Bulk Upsert Assets',
      details: `Upsert completed. Created ${createdCount.v}, Updated ${updatedCount.v}`,
      store: req.activeStore
    });
    const suffix = invalidRows.length
      ? `, ${invalidRows.length} row(s) skipped due to invalid formatting/capitalization`
      : '';
    res.json({
      message: `Processed ${createdCount.v + updatedCount.v} assets (created ${createdCount.v}, updated ${updatedCount.v})${suffix}`,
      skipped_duplicates: duplicates,
      invalid_rows: invalidRows
    });

  } catch (error) {
    console.error('Import processing error:', error);
    res.status(500).json({
      message: 'Error processing file',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// @desc    Download asset report
// @route   GET /api/assets/export
// @access  Private/Admin
router.get('/export', protect, admin, async (req, res) => {
  try {
    const assets = await Asset.find().populate('store').populate('assigned_to');

    const headerMain = [
      'PRODUCT NAME','NAME','MODEL NUMBER','SERIAL NUMBER',
      'MAC ADDRESS','MANUFACTURER','TICKET NUMBER','RFID','QR CODE','STORE','LOCATION',
      'STATUS','CONDITION','UNIQUE ID','ASSIGNED TO','VENDOR NAME','SOURCE','DELIVERED BY','DELIVERED AT','UPDATED AT'
    ];
    const rowsMain = assets.map(a => ([
      a.product_name || '',
      a.name || '',
      a.model_number || '',
      a.serial_number || '',
      a.mac_address || '',
      a.manufacturer || '',
      a.ticket_number || '',
      a.rfid || '',
      a.qr_code || '',
      a.store ? a.store.name : 'N/A',
      a.location || '',
      a.status || '',
      a.condition || 'New / Excellent',
      a.uniqueId || '',
      a.assigned_to ? a.assigned_to.name : '',
      a.vendor_name || '',
      a.source || '',
      a.delivered_by_name || '',
      a.delivered_at || '',
      a.updatedAt || ''
    ]));

    const headerHistory = ['UNIQUE ID','NAME','ACTION','TICKET/DETAILS','USER','DATE'];
    const rowsHistory = [];
    assets.forEach(a => {
      const hist = Array.isArray(a.history) ? [...a.history].sort((x,y) => new Date(y.date) - new Date(x.date)) : [];
      if (hist.length === 0) {
        rowsHistory.push([a.uniqueId || '', a.name || '', 'NO HISTORY', '', '', '']);
      } else {
        hist.forEach(h => {
          rowsHistory.push([a.uniqueId || '', a.name || '', h.action || '', h.ticket_number || '', h.user || '', h.date || '']);
        });
      }
    });

    const wb = xlsx.utils.book_new();
    const wsMain = xlsx.utils.aoa_to_sheet([headerMain, ...rowsMain]);
    wsMain['!cols'] = [
      { wch: 24 },{ wch: 22 },{ wch: 24 },{ wch: 22 },{ wch: 16 },{ wch: 16 },
      { wch: 18 },{ wch: 18 },{ wch: 16 },{ wch: 12 },{ wch: 12 },{ wch: 16 },{ wch: 24 },
      { wch: 12 },{ wch: 20 },{ wch: 14 },{ wch: 22 },{ wch: 18 },{ wch: 22 },{ wch: 22 },{ wch: 22 }
    ];
    wsMain['!autofilter'] = { ref: 'A1:U1' };
    xlsx.utils.book_append_sheet(wb, wsMain, 'ASSETS');

    const wsHist = xlsx.utils.aoa_to_sheet([headerHistory, ...rowsHistory]);
    wsHist['!cols'] = [{ wch: 14 },{ wch: 22 },{ wch: 24 },{ wch: 22 },{ wch: 16 },{ wch: 22 }];
    wsHist['!autofilter'] = { ref: 'A1:F1' };
    xlsx.utils.book_append_sheet(wb, wsHist, 'HISTORY');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=ASSETS_EXPORT.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Download empty bulk import template
// @route   GET /api/assets/import-template
// @access  Private/Admin
router.get('/import-template', protect, admin, async (req, res) => {
  try {
    const template = [
      {
        'Asset Type': '',
        'Model Number': '',
        'Serial Number': '',
        'MAC Address': '',
        'Manufacturer': '',
        'Ticket Number': '',
        'RFID': '',
        'QR Code': '',
        'Condition': '',
        'Store': '',
        'Location': '',
        'Status': '',
        'Quantity': '',
        'Price': ''
      }
    ];
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(template, { skipHeader: false });
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Template');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=assets_import_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
router.get('/by-technician', protect, admin, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 200);
    const q = (req.query.query || '').trim();

    let query = {};
    if (!q) {
      query = {
        $or: [
          { assigned_to: { $ne: null } },
          { history: { $elemMatch: { action: { $regex: /^(Collected|Returned\/|Reported Faulty)/i } } } }
        ]
      };
    } else {
      const rx = new RegExp(q, 'i');
      const users = await User.find({
        $or: [
          { name: rx },
          { email: rx },
          { phone: rx },
          { username: rx }
        ],
        role: 'Technician'
      });
      const userIds = users.map(u => u._id);
      const userNames = users.map(u => u.name);
      
      query = {
        $or: [
          { assigned_to: { $in: userIds } },
          { history: { $elemMatch: { user: { $in: userNames } } } }
        ]
      };
    }

    const total = await Asset.countDocuments(query);
    const assets = await Asset.find(query)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('store')
      .populate('assigned_to', 'name email phone');

    res.json({
      items: assets,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Assign asset to technician (Admin)
// @route   POST /api/assets/assign
// @access  Private/Admin
router.post('/assign', protect, admin, async (req, res) => {
  const { assetId, technicianId, ticketNumber, otherRecipient } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    
    // Admin can assign either to a technician or to an external person
    if (technicianId) {
      const technician = await User.findById(technicianId);
      if (!technician) {
        return res.status(404).json({ message: 'Technician not found' });
      }
      // Save previous status before assignment
      asset.previous_status = asset.status;
      
      asset.assigned_to = technicianId;
      asset.status = 'In Use';
      if (ticketNumber) asset.ticket_number = ticketNumber;
      asset.history.push({
        action: 'Assigned (Admin)',
        ticket_number: ticketNumber || 'N/A',
        user: req.user.name
      });
      await asset.save();
      await ActivityLog.create({
        user: req.user.name,
        email: req.user.email,
        role: req.user.role,
        action: 'Assign Asset',
        details: `Assigned asset ${asset.name} (SN: ${asset.serial_number}) to ${technician.name} (Ticket: ${ticketNumber || 'N/A'})`,
        store: asset.store
      });
      return res.json(asset);
    } else if (otherRecipient && otherRecipient.name) {
      // Assign to external person without linking to a User
      // Save previous status before assignment
      asset.previous_status = asset.status;

      asset.status = 'In Use';
      
      asset.assigned_to_external = {
        name: otherRecipient.name,
        phone: otherRecipient.phone,
        note: otherRecipient.note
      };
      asset.assigned_to = null;
      if (ticketNumber) asset.ticket_number = ticketNumber;

      const otherInfo = `Name: ${otherRecipient.name}${otherRecipient.phone ? `, Phone: ${otherRecipient.phone}` : ''}${otherRecipient.note ? `, Note: ${otherRecipient.note}` : ''}`;
      asset.history.push({
        action: `Assigned (External) — ${otherInfo}`,
        ticket_number: ticketNumber || 'N/A',
        user: req.user.name
      });
      await asset.save();
      await ActivityLog.create({
        user: req.user.name,
        email: req.user.email,
        role: req.user.role,
        action: 'Assign Asset (External)',
        details: `Assigned asset ${asset.name} (SN: ${asset.serial_number}) externally — ${otherInfo} (Ticket: ${ticketNumber || 'N/A'})`,
        store: asset.store
      });
      return res.json(asset);
    } else {
      return res.status(400).json({ message: 'Provide technicianId or otherRecipient.name' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Unassign asset (Admin)
// @route   POST /api/assets/unassign
// @access  Private/Admin
router.post('/unassign', protect, admin, async (req, res) => {
  const { assetId } = req.body;
  try {
    const asset = await Asset.findById(assetId).populate('assigned_to');
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    if (!asset.assigned_to && (!asset.assigned_to_external || !asset.assigned_to_external.name)) {
      return res.status(400).json({ message: 'Asset is not currently assigned' });
    }

    let previousUser = 'Unknown';
    if (asset.assigned_to) {
      previousUser = asset.assigned_to.name;
      asset.assigned_to = null;
    } else if (asset.assigned_to_external && asset.assigned_to_external.name) {
      previousUser = `${asset.assigned_to_external.name} (External)`;
      asset.assigned_to_external = null;
    }
    
    // Restore previous status if exists, otherwise set to In Store
    if (asset.previous_status) {
      asset.status = asset.previous_status;
      asset.previous_status = null;
    } else {
      asset.status = 'In Store';
    }
    
    asset.history.push({
      action: 'Unassigned (Admin)',
      user: req.user.name,
      date: new Date()
    });

    await asset.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Unassign Asset',
      details: `Unassigned asset ${asset.name} (SN: ${asset.serial_number}) from ${previousUser}`,
      store: asset.store
    });

    res.json(asset);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Collect Material (Technician)
// @route   POST /api/assets/collect
// @access  Private/Technician
router.post('/collect', protect, restrictViewer, async (req, res) => {
  const { assetId, ticketNumber, installationLocation } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    if (asset.assigned_to) {
      return res.status(400).json({ message: 'Asset is already assigned' });
    }
    if (asset.status === 'Faulty' || asset.status === 'Disposed' || asset.status === 'Under Repair') {
      return res.status(400).json({ message: 'Asset is not available (Faulty/Under Repair/Disposed)' });
    }

    const prev = asset.status;
    asset.status = 'In Use';
    asset.assigned_to = req.user._id;
    asset.history.push({
      action: prev === 'In Store' ? 'Collected/In Store' : 'Collected',
      ticket_number: ticketNumber,
      details: installationLocation ? `Location: ${installationLocation}` : undefined,
      user: req.user.name
    });

    await asset.save();

    // Log Activity
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Collect Asset',
      details: `Collected asset ${asset.name} (SN: ${asset.serial_number})`,
      store: asset.store
    });

    // Send Email to Technician
    if (req.user.email) {
      try {
        await sendEmail({
          email: req.user.email,
          subject: 'Asset Collected Successfully',
          message: `You have successfully collected the asset:\n\nName: ${asset.name}\nSerial: ${asset.serial_number}\nTicket: ${ticketNumber}\nInstallation Location: ${installationLocation || 'N/A'}\n\nDate: ${new Date().toLocaleString()}`
        });
      } catch (emailErr) {
        console.error('Email sending failed:', emailErr);
        // Don't fail the request if email fails, just log it
      }
    }

    res.json(asset);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Report Faulty (Technician)
// @route   POST /api/assets/faulty
// @access  Private/Technician
router.post('/faulty', protect, restrictViewer, async (req, res) => {
  const { assetId, ticketNumber } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    asset.status = 'Faulty';
    asset.history.push({
      action: 'Reported Faulty',
      ticket_number: ticketNumber,
      user: req.user.name
    });

    await asset.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Report Faulty',
      details: `Reported faulty: ${asset.name} (SN: ${asset.serial_number}) - Ticket: ${ticketNumber}`,
      store: asset.store
    });

    res.json(asset);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Mark asset as In Use (Technician)
// @route   POST /api/assets/in-use
// @access  Private/Technician
router.post('/in-use', protect, restrictViewer, async (req, res) => {
  const { assetId, ticketNumber, location } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    
    // Check if assigned to current user
    if (!asset.assigned_to || String(asset.assigned_to) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only mark your assigned assets as In Use' });
    }

    const previousUser = req.user.name;

    asset.status = 'In Use';
    
    // Add history
    asset.history.push({
      action: 'In Use',
      ticket_number: ticketNumber,
      user: req.user.name,
      details: location ? `Location: ${location}` : `Marked as In Use by ${req.user.name}`
    });

    await asset.save();

    // Log activity
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Asset In Use',
      details: `Asset ${asset.name} (SN: ${asset.serial_number}) marked as In Use by ${req.user.name}`,
      store: asset.store
    });

    res.json({ message: 'Asset marked as In Use', asset });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Return asset (Technician)
// @route   POST /api/assets/return
// @access  Private/Technician
router.post('/return', protect, restrictViewer, async (req, res) => {
  const { assetId, condition, ticketNumber } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    // Convert condition
    const condRaw = String(condition || '').trim().toLowerCase();
    const condMap = { new: 'New', used: 'Used', faulty: 'Faulty', 'under repair': 'Under Repair', repaired: 'Repaired' };
    const cond = condMap[condRaw];
    if (!cond) return res.status(400).json({ message: 'Invalid return condition' });
    
    // Auto-approve return logic
    const previousUser = asset.assigned_to ? req.user.name : 'Unknown';
    
    asset.status = 'In Store';
    asset.assigned_to = null;
    asset.assigned_to_external = null;
    
    // Clear any pending requests
    asset.return_pending = false;
    asset.return_request = null;

    asset.history.push({
      action: `Returned/${cond}`,
      ticket_number: ticketNumber,
      user: req.user.name,
      details: `Auto-approved return from ${req.user.name}`
    });

    await asset.save();
    
    // Log activity
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Return Asset',
      details: `Returned asset ${asset.name} (SN: ${asset.serial_number}) as ${cond}`,
      store: asset.store
    });

    res.json({ message: 'Asset returned successfully', asset });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Return request (Technician) - My Assets quick action
// @route   POST /api/assets/return-request
// @access  Private/Technician
router.post('/return-request', protect, restrictViewer, async (req, res) => {
  const { assetId, condition, ticketNumber } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (!asset.assigned_to || String(asset.assigned_to) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only request return for your assigned assets' });
    }
    const condRaw = String(condition || '').trim().toLowerCase();
    const condMap = { new: 'New', used: 'Used', faulty: 'Faulty', 'under repair': 'Under Repair', repaired: 'Repaired' };
    const cond = condMap[condRaw];
    if (!cond) return res.status(400).json({ message: 'Invalid return condition' });
    
    // Auto-approve return logic
    asset.status = cond;
    asset.assigned_to = null;
    asset.assigned_to_external = null;
    asset.return_pending = false;
    asset.return_request = null;

    asset.history.push({
      action: `Returned/${cond}`,
      ticket_number: ticketNumber,
      user: req.user.name,
      details: `Auto-approved return from ${req.user.name}`
    });
    
    await asset.save();
    
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Return Asset',
      details: `Returned asset ${asset.name} (SN: ${asset.serial_number}) as ${cond}`,
      store: asset.store
    });

    res.json({ message: 'Asset returned successfully', asset });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    List pending returns (Admin)
// @route   GET /api/assets/return-pending
// @access  Private/Admin
router.get('/return-pending', protect, admin, async (req, res) => {
  try {
    const assets = await Asset.find({ return_pending: true })
      .populate('store')
      .populate('assigned_to', 'name email');
    res.json(assets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Approve return (Admin)
// @route   POST /api/assets/return-approve
// @access  Private/Admin
router.post('/return-approve', protect, admin, async (req, res) => {
  const { assetId } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (!asset.return_pending || !asset.return_request) {
      return res.status(400).json({ message: 'No pending return for this asset' });
    }
    // apply return
    const cond = asset.return_request.condition;
    const ticketNumber = asset.return_request.ticket_number;
    asset.assigned_to = undefined;
    asset.status = 'In Store';
    asset.return_pending = false;
    asset.return_request = undefined;
    asset.history.push({
      action: `Returned/${cond}`,
      ticket_number: ticketNumber,
      user: req.user.name
    });
    await asset.save();
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Approve Return',
      details: `Approved return of ${asset.name} (SN: ${asset.serial_number}) as ${cond}`,
      store: asset.store
    });
    res.json({ message: 'Return approved', asset });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Reject return (Admin)
// @route   POST /api/assets/return-reject
// @access  Private/Admin
router.post('/return-reject', protect, admin, async (req, res) => {
  const { assetId, reason } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (!asset.return_pending || !asset.return_request) {
      return res.status(400).json({ message: 'No pending return for this asset' });
    }
    const cond = asset.return_request.condition;
    const ticketNumber = asset.return_request.ticket_number;
    asset.history.push({
      action: `Return Rejected/${cond}${reason ? ` — ${reason}` : ''}`,
      ticket_number: ticketNumber,
      user: req.user.name
    });
    asset.return_pending = false;
    asset.return_request = undefined;
    await asset.save();
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Reject Return',
      details: `Rejected return of ${asset.name} (SN: ${asset.serial_number})${reason ? ` — ${reason}` : ''}`,
      store: asset.store
    });
    res.json({ message: 'Return rejected', asset });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Update asset
// @route   PUT /api/assets/:id
// @access  Private/Admin
router.put('/:id', protect, admin, async (req, res) => {
  const { name, model_number, serial_number, mac_address, manufacturer, store, location, status, condition, ticket_number, product_name, rfid, qr_code } = req.body;
  try {
    const asset = await Asset.findById(req.params.id);
    if (asset) {
      const oldSerial = asset.serial_number;
      let prodName = product_name ? String(product_name) : '';
      asset.name = name ? capitalizeWords(name) : asset.name;
      asset.model_number = model_number || asset.model_number;
      asset.serial_number = serial_number || asset.serial_number;
      asset.serial_last_4 = asset.serial_number.slice(-4);
      asset.mac_address = mac_address || asset.mac_address;
      asset.manufacturer = manufacturer ? capitalizeWords(manufacturer) : (asset.manufacturer || '');
      asset.ticket_number = ticket_number || asset.ticket_number || '';
      // Model Number Sync on edit: if no explicit product_name provided, try linking by model_number
      if (prodName) {
        asset.product_name = capitalizeWords(prodName);
      } else {
        try {
          const linked = await findProductNameByModelNumber(model_number || asset.model_number, req.activeStore);
          if (linked) asset.product_name = linked;
        } catch {
          asset.product_name = asset.product_name || '';
        }
      }
      asset.rfid = rfid || asset.rfid || '';
      asset.qr_code = qr_code || asset.qr_code || '';
      asset.store = store || asset.store;
      if (location !== undefined) asset.location = capitalizeWords(location);
      // Normalize status/condition
      let normStatus = status || asset.status;
      let normCondition = condition || asset.condition;
      if (typeof normCondition === 'string') {
        const c = normCondition.trim().toLowerCase();
        if (c === 'scrap') normCondition = 'Scrapped';
      }
      asset.status = normStatus;
      asset.condition = normCondition;

      const updatedAsset = await asset.save();

      // Log Activity (+ mark disposal candidate when condition is Scrapped or status is Faulty)
      await ActivityLog.create({
        user: req.user.name,
        email: req.user.email,
        role: req.user.role,
        action: 'Edit Asset',
        details: `Edited asset ${updatedAsset.name} (SN: ${oldSerial} -> ${updatedAsset.serial_number})`,
        store: updatedAsset.store
      });
      if (updatedAsset.condition === 'Scrapped' || updatedAsset.status === 'Faulty') {
        await ActivityLog.create({
          user: req.user.name,
          email: req.user.email,
          role: req.user.role,
          action: 'Queued for Disposal',
          details: `Asset ${updatedAsset.name} marked for disposal (status: ${updatedAsset.status}, condition: ${updatedAsset.condition})`,
          store: updatedAsset.store
        });
      }

      res.json(updatedAsset);
    } else {
      res.status(404).json({ message: 'Asset not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete asset
// @route   DELETE /api/assets/:id
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const asset = await Asset.findById(req.params.id);
        if (asset) {
            const serial = asset.serial_number;
            await asset.deleteOne();

            // Log Activity
            await ActivityLog.create({
              user: req.user.name,
              email: req.user.email,
              role: req.user.role,
              action: 'Delete Asset',
              details: `Deleted asset ${asset.name} (SN: ${serial})`,
              store: asset.store
            });

            res.json({ message: 'Asset removed' });
        } else {
            res.status(404).json({ message: 'Asset not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Get system activity logs
// @route   GET /api/assets/activity-logs
// @access  Private/Admin
router.get('/activity-logs', protect, admin, async (req, res) => {
  try {
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).limit(100);
    res.json(logs);
  } catch (error) {
    console.error('Error in GET /activity-logs:', error);
    res.status(500).json({ message: error.message });
  }
});

// @desc    Recent technician activity (admin)
// @route   GET /api/assets/recent-activity
// @access  Private/Admin
router.get('/recent-activity', protect, admin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const pipeline = [
      { $unwind: '$history' },
      { $sort: { 'history.date': -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'stores',
          localField: 'store',
          foreignField: '_id',
          as: 'storeDoc'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'assigned_to',
          foreignField: '_id',
          as: 'assignedDoc'
        }
      },
      {
        $project: {
          name: 1,
          model_number: 1,
          serial_number: 1,
          status: 1,
          store: { $arrayElemAt: ['$storeDoc.name', 0] },
          assigned_to: {
            name: { $arrayElemAt: ['$assignedDoc.name', 0] },
            email: { $arrayElemAt: ['$assignedDoc.email', 0] }
          },
          history: 1,
          updatedAt: 1
        }
      }
    ];
    const events = await Asset.aggregate(pipeline);
    res.json(events);
  } catch (error) {
    console.error('Error in GET /recent-activity:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
