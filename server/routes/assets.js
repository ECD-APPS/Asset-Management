const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Asset = require('../models/Asset');
const AssetCategory = require('../models/AssetCategory');
const Store = require('../models/Store');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Request = require('../models/Request');
const { protect, admin } = require('../middleware/authMiddleware');
const multer = require('multer');
const xlsx = require('xlsx');
const sendEmail = require('../utils/sendEmail');

// Multer setup for memory storage
const upload = multer({ storage: multer.memoryStorage() });

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
// @access  Private (Admin/Technician)
router.get('/recent-activity', protect, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const query = {};
    
    if (req.activeStore) {
      query.store = req.activeStore;
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

// Helper to get store and its children IDs
async function getStoreIds(storeId) {
  if (!storeId) return [];
  const children = await Store.find({ parentStore: storeId }).select('_id');
  return [storeId, ...children.map(c => c._id)];
}

// @desc    Get assets (paginated, optional filters)
// @route   GET /api/assets
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 200);
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const storeId = String(req.query.store || '').trim();
    const category = String(req.query.category || '').trim();
    const manufacturer = String(req.query.manufacturer || '').trim();
    const modelNumber = String(req.query.model_number || '').trim();
    const serialNumber = String(req.query.serial_number || '').trim();
    const macAddress = String(req.query.mac_address || '').trim();
    const productType = String(req.query.product_type || '').trim();
    const productName = String(req.query.product_name || '').trim();
    const ticketNumber = String(req.query.ticket_number || '').trim();
    const rfid = String(req.query.rfid || '').trim();
    const qrCode = String(req.query.qr_code || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const source = String(req.query.source || '').trim();
    const condition = String(req.query.condition || '').trim();
    const location = String(req.query.location || '').trim();

    const filter = {};
    if (q) {
      const rx = new RegExp(q, 'i');
      filter.$or = [
        { name: rx },
        { model_number: rx },
        { serial_number: rx },
        { mac_address: rx },
        { rfid: rx },
        { qr_code: rx },
        { uniqueId: rx },
        { manufacturer: rx }
      ];
    }
    if (status) {
      if (status === 'In Use') {
        // Filter for assigned assets (Technician OR External)
        filter.$or = [
          { assigned_to: { $ne: null } },
          { 'assigned_to_external.name': { $exists: true, $ne: '' } }
        ];
      } else if (status === 'New' || status === 'Used') {
        // Filter for Spare (Unassigned) assets of specific status
        filter.status = status;
        filter.assigned_to = null;
        filter.assigned_to_external = null;
      } else if (status.includes(',')) {
        filter.status = { $in: status.split(',').map(s => s.trim()) };
      } else {
        filter.status = status;
      }
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
      // No restricted context (Super Admin global)
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

    if (category) filter.category = category;
    if (manufacturer) filter.manufacturer = new RegExp(manufacturer, 'i');
    if (modelNumber) filter.model_number = new RegExp(modelNumber, 'i');
    if (serialNumber) filter.serial_number = new RegExp(serialNumber, 'i');
    if (macAddress) filter.mac_address = new RegExp(macAddress, 'i');
    if (productType) filter.product_type = new RegExp(productType, 'i');
    if (productName) filter.product_name = new RegExp(productName, 'i');
    if (ticketNumber) filter.ticket_number = new RegExp(ticketNumber, 'i');
    if (rfid) filter.rfid = new RegExp(rfid, 'i');
    if (qrCode) filter.qr_code = new RegExp(qrCode, 'i');
    if (source) filter.source = source;
    if (condition) filter.condition = condition;
    if (location) {
      const escaped = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.location = new RegExp(`^${escaped}$`, 'i');
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

    // Parallel execution for 5x faster stats loading
    const [
      totalAssets,
      assignedCount,
      faultyCount,
      underRepairCount,
      disposedCount,
      pendingReturnsCount,
      pendingRequestsCount,
      spareCount,
      statusCounts,
      modelCounts,
      categoryCounts,
      growthStats
    ] = await Promise.all([
      Asset.countDocuments(filter),
      Asset.countDocuments({ ...filter, assigned_to: { $ne: null } }),
      Asset.countDocuments({ ...filter, status: 'Faulty' }),
      Asset.countDocuments({ ...filter, status: 'Under Repair' }),
      Asset.countDocuments({ ...filter, status: 'Disposed' }),
      Asset.countDocuments({ ...filter, return_pending: true }),
      Request.countDocuments(requestFilter),
      Asset.countDocuments({ ...filter, status: { $in: ['New', 'Used'] }, assigned_to: null }),
      Asset.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Asset.aggregate([
        { $match: filter },
        { $group: { _id: '$model_number', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      Asset.aggregate([
        { $match: filter },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Asset.aggregate([
        { $match: { ...filter, createdAt: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 6)) } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ])
    ]);

    const stats = {
      overview: {
        total: totalAssets,
        inUse: assignedCount,
        spare: spareCount,
        faulty: faultyCount,
        underRepair: underRepairCount,
        disposed: disposedCount,
        pendingReturns: pendingReturnsCount,
        pendingRequests: pendingRequestsCount
      },
      status: {
        New: 0,
        Used: 0,
        Faulty: 0,
        'Under Repair': 0,
        Disposed: 0
      },
      models: [],
      categories: categoryCounts.map(c => ({ name: c._id || 'Uncategorized', value: c.count })),
      growth: growthStats.map(g => ({ name: g._id, value: g.count }))
    };

    statusCounts.forEach(item => {
      if (item._id) stats.status[item._id] = item.count;
    });

    stats.models = modelCounts.map(item => ({
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
      .populate('store')
      .populate('assigned_to')
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
      'Name',
      'Model Number',
      'Serial Number',
      'MAC Address',
      'Manufacturer',
      'Ticket Number',
      'RFID',
      'QR Code',
      'Store',
      'Location',
      'Status',
      'Condition'
    ];

    const rows = [headers];

    const ws = xlsx.utils.aoa_to_sheet(rows);
    ws['!cols'] = headers.map((_, idx) => ({ wch: idx <= 2 ? 28 : 20 }));
    xlsx.utils.book_append_sheet(wb, ws, 'Template');

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
router.post('/', protect, async (req, res) => {
  const { name, model_number, serial_number, mac_address, manufacturer, store, location, status, condition, ticket_number, category, product_type, product_name, rfid, qr_code } = req.body;
  try {
    const normName = capitalizeWords(name);
    const normCategory = capitalizeWords(category || 'Other');
    const normType = capitalizeWords(product_type || '');
    const normProduct = capitalizeWords(product_name || '');
    const normManufacturer = capitalizeWords(manufacturer || '');
    const normLocation = capitalizeWords(location || '');
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

    // --- AUTO-CREATE HIERARCHY LOGIC ---
    if (category && product_type && product_name) {
      let catQuery = {};
      if (req.activeStore) {
        catQuery.store = req.activeStore;
      }
      catQuery.name = new RegExp(`^${category}$`, 'i');
      let catDoc = await AssetCategory.findOne(catQuery);
      
      if (!catDoc) {
        // Create new Category
        catDoc = await AssetCategory.create({
          name: category,
          types: [{
            name: product_type,
            products: [{ name: product_name, children: [] }]
          }],
          store: req.activeStore
        });
      } else {
        // Check Type
        let typeDoc = catDoc.types.find(t => String(t.name).toLowerCase() === String(product_type).toLowerCase());
        
        if (!typeDoc) {
          // Add Type and Product
          catDoc.types.push({
            name: product_type,
            products: [{ name: product_name, children: [] }]
          });
          await catDoc.save();
        } else {
          // Check Product (Deep check including children?)
          // For simple auto-add, we just check the top-level product list of the type
          // or we can implement recursive check if needed. 
          // Requirement: "add product in Products Management"
          
          const productExists = typeDoc.products.some(p => String(p.name).toLowerCase() === String(product_name).toLowerCase());
          // Also check deep children if we want to avoid duplicates? 
          // For now, let's just add to root of type if not found at root.
          // Or better: Use the findInTree logic?
          
          // Simple implementation: Only add if not found in immediate list
          if (!productExists) {
             typeDoc.products.push({ name: product_name, children: [] });
             await catDoc.save();
          }
        }
      }
    }
    // -----------------------------------

    const uniqueId = await generateUniqueId(name);
    const asset = await Asset.create({
      name: normName,
      model_number,
      serial_number,
      serial_last_4: (serial_number || '').slice(-4),
      mac_address,
      manufacturer: normManufacturer || '',
      ticket_number: ticket_number || '',
      category: normCategory || 'Other',
      product_type: normType || '',
      product_name: normProduct || '',
      rfid: rfid || '',
      qr_code: qr_code || '',
      uniqueId,
      store: req.activeStore || store,
      status: status || 'New',
      condition: condition || 'New / Excellent',
      location: normLocation || ''
    });

    // Log Activity
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Create Asset',
      details: `Created asset ${name} (SN: ${serial_number})`,
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
      category: capitalizeWords(asset.category || 'Other'),
      product_type: capitalizeWords(asset.product_type || ''),
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
    if (updates.category) data.category = capitalizeWords(updates.category);
    if (updates.product_type) data.product_type = capitalizeWords(updates.product_type);
    if (updates.product_name) data.product_name = capitalizeWords(updates.product_name);

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

// @desc    Bulk upload assets via Excel
// @route   POST /api/assets/import
// @access  Private (Admin or Technician)
router.post('/import', protect, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no sheets found' });
    }
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return res.status(400).json({ message: 'Invalid Excel file: first sheet is unreadable' });
    }
    const data = xlsx.utils.sheet_to_json(sheet);
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no data rows found' });
    }

    const assetsToInsert = [];
    const duplicates = [];
    const allowDuplicates = String(req.body.allowDuplicates || '').toLowerCase() === 'true';
    const { category: reqCategory, product_type: reqProductType, product_name: reqProductName, source: reqSource, location: reqLocation } = req.body;
    
    const stores = await Store.find();
    const storeMap = {};
    const storeMapLower = {};
    stores.forEach(s => storeMap[s.name] = s._id);
    stores.forEach(s => storeMapLower[s.name.trim().toLowerCase()] = s._id);

    // Pre-fetch categories for smart lookup (fix for missing hierarchy in Excel)
    const allCategories = await AssetCategory.find().lean();
    const productLookup = {}; // productName -> { category: name, type: name }
    
    allCategories.forEach(cat => {
      if (cat.types) {
        cat.types.forEach(type => {
          if (type.products) {
            type.products.forEach(prod => {
               // Use lower case for loose matching
               productLookup[prod.name.trim().toLowerCase()] = { category: cat.name, type: type.name, name: prod.name };
               if (prod.children) {
                 prod.children.forEach(child => {
                   productLookup[child.name.trim().toLowerCase()] = { category: cat.name, type: type.name, name: child.name };
                 });
               }
            });
          }
        });
      }
    });

    const fileSeenSerials = new Set();
    const invalidRows = [];
    
    // Helper to check for N/A
    const isNA = (val) => !val || String(val).trim().toUpperCase() === 'N/A';

    for (const item of data) {
      const norm = {};
      Object.keys(item).forEach(k => { norm[String(k).trim().toLowerCase()] = item[k]; });
      
      // Mapping based on User Request + Aliases
      // "Excel headers supported: asset type, Model number, Serial number, mac address, Manufacturer, Ticket number, RFID, QR Code, Store location, Status"
      
      let productType = reqProductType || norm['product type'] || norm['type'] || '';
      let productName = reqProductName || norm['product name'] || norm['product'] || '';
      let category = reqCategory || norm['category'] || '';

      // Fallback: If Product Name is empty, use "Asset Type" as it's the specific identifier in user's Excel
      if (!productName && (norm['asset type'] || norm['assettype'])) {
        productName = norm['asset type'] || norm['assettype'];
      }
      
      // Smart Lookup: If we have productName but missing Category/Type
      // This links uploaded assets to existing hierarchy even if Excel lacks Category/Type columns
      if (productName && (!category || !productType)) {
         const found = productLookup[String(productName).trim().toLowerCase()];
         if (found) {
            if (!category) category = found.category;
            if (!productType) productType = found.type;
            // Use canonical casing from DB
            productName = found.name;
         }
      }
      
      if (!category) category = 'Other';
      
      // Name fallback strategy
      const name = norm['asset name'] || norm['name'] || productName || productType || 'Unknown Asset';
      
      const model = norm['model number'] || norm['model'] || 'N/A';
      const serial = norm['serial number'] || norm['serial'] || 'N/A';
      const mac = norm['mac address'] || norm['mac'] || '';
      const manufacturer = norm['manufacturer'] || '';
      const ticketNumber = norm['ticket number'] || norm['ticket'] || '';
      const rfid = norm['rfid'] || '';
      const qrCode = norm['qr code'] || norm['qr'] || '';
      
      const storeNameRaw = norm['store location'] || norm['storename'] || norm['store'] || '';
      const storeName = String(storeNameRaw || '').trim();
      
      // Location (Physical Location within the store)
      const location = reqLocation || norm['location'] || norm['physical location'] || norm['room'] || norm['area'] || '';
      
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
        'available faulty': 'Faulty',
        'faulty': 'Faulty',
        'disposed': 'Disposed',
        'under repair': 'Under Repair'
      };
      const status = statusMap[statusNorm] || 'New';
      
      // Condition Logic
      const conditionRaw = norm['condition'];
      let condition = 'New / Excellent';
      if (conditionRaw) {
         const cNorm = String(conditionRaw).trim().toLowerCase();
         if (cNorm.includes('excellent') || cNorm === 'new') condition = 'New / Excellent';
         else if (cNorm.includes('good') || cNorm.includes('fair')) condition = 'Good / Fair';
         else if (cNorm.includes('substandard') || cNorm === 'used') condition = 'Used / Substandard';
         else if (cNorm.includes('repaired') || cNorm.includes('reconditioned')) condition = 'Repaired / Reconditioned';
         else if (cNorm.includes('defective') || cNorm.includes('faulty')) condition = 'Faulty / Defective';
         else if (cNorm.includes('poor') || cNorm.includes('failure')) condition = 'Poor / Near Failure';
         else if (cNorm.includes('failed') || cNorm.includes('unserviceable')) condition = 'Failed / Unserviceable';
      }

      let storeId = storeMap[storeName] || storeMapLower[storeName.toLowerCase()];
      
      // Enforce active store context if present
      if (req.activeStore) {
        storeId = req.activeStore;
      }
      
      // Hierarchy Creation Logic (Auto-create if info present)
      if (category && productName) {
        if (!productType) productType = 'General';
        
        try {
          // Case-insensitive check for category
          let catQuery = { name: { $regex: new RegExp(`^${category}$`, 'i') } };
          if (req.activeStore) {
            catQuery.store = req.activeStore;
          }
          let catDoc = await AssetCategory.findOne(catQuery);

          if (!catDoc) {
            catDoc = await AssetCategory.create({
              name: category,
              types: [{ name: productType, products: [{ name: productName, children: [] }] }],
              store: req.activeStore
            });
          } else {
            // Use canonical Category Name to ensure consistency
            category = catDoc.name;

            // Case-insensitive check for type
            let typeDoc = catDoc.types.find(t => t.name.toLowerCase() === productType.toLowerCase());
            
            if (!typeDoc) {
              catDoc.types.push({ name: productType, products: [{ name: productName, children: [] }] });
              await catDoc.save();
            } else {
              // Use canonical Type Name
              productType = typeDoc.name;

              // Case-insensitive check for product
              const existingProduct = typeDoc.products.find(p => p.name.toLowerCase() === productName.toLowerCase());
              if (!existingProduct) {
                typeDoc.products.push({ name: productName, children: [] });
                await catDoc.save();
              } else {
                // Use canonical Product Name
                productName = existingProduct.name;
              }
            }
          }
        } catch (hErr) {
          console.error('Hierarchy creation error:', hErr);
          // Continue import even if hierarchy fails
        }
      }

      const reqMissing = [];
      if (!name) reqMissing.push('Name');
      if (!category) reqMissing.push('Category');
      if (!productType) reqMissing.push('Product Type');
      if (!productName) reqMissing.push('Product Name');
      const isValid = reqMissing.length === 0;
      
      if (isValid) {
        const serialStr = String(serial).trim();
        const uniqueId = await generateUniqueId(name);
        
        if (serialStr && !allowDuplicates) {
          if (fileSeenSerials.has(serialStr)) {
            duplicates.push({ 
              serial: serialStr, 
              reason: 'Duplicate in upload file',
              asset: { name, model_number: model, serial_number: serialStr, serial_last_4: serialStr.slice(-4), mac_address: mac, manufacturer, uniqueId, store: storeId, status, category, product_type: productType, product_name: productName }
            });
            continue;
          }
          fileSeenSerials.add(serialStr);
        }

        assetsToInsert.push({
          name: capitalizeWords(name),
          model_number: model,
          serial_number: serialStr,
          serial_last_4: serialStr.slice(-4),
          mac_address: mac,
          manufacturer: capitalizeWords(manufacturer),
          ticket_number: ticketNumber,
          rfid,
          qr_code: qrCode,
          uniqueId,
          store: storeId,
          status,
          condition,
          category: capitalizeWords(category),
          product_type: capitalizeWords(productType),
          product_name: capitalizeWords(productName),
          source: reqSource,
          location: capitalizeWords(location)
        });
      } else {
        const reason = `Missing required: ${reqMissing.join(', ')}`;
        invalidRows.push({
          name, model, serial: String(serial || ''), store: storeName || '',
          reason
        });
      }
    }

    // Check existing serials in DB (Scoped to Store)
    let toInsert = assetsToInsert;
    if (!allowDuplicates && assetsToInsert.length > 0) {
      // Only check serials that are NOT N/A
      const serialsToCheck = assetsToInsert
        .map(a => a.serial_number)
        .filter(s => s);
      
      if (serialsToCheck.length > 0) {
        // Find assets with these serials
        const existing = await Asset.find({ serial_number: { $in: serialsToCheck } })
          .select('serial_number store')
          .lean();
          
        // Create a Set of "serial_storeId" strings for fast lookup
        // If an existing asset has no store, we treat it as global (collision for everyone) or maybe ignore?
        // Let's assume store is required.
        const existingSet = new Set();
        existing.forEach(e => {
          if (e.store) existingSet.add(`${e.serial_number}_${e.store.toString()}`);
        });
        
        toInsert = assetsToInsert.filter(a => {
          // Always allow N/A serials to proceed
          if (isNA(a.serial_number)) return true;
          
          // Check if this specific asset (serial + target store) exists
          // a.store is the ID we resolved earlier
          const key = `${a.serial_number}_${a.store}`;
          const isDup = existingSet.has(key);
          
          if (isDup) {
            duplicates.push({ 
              serial: a.serial_number, 
              reason: 'Duplicate in database (same store)',
              asset: a 
            });
          }
          return !isDup;
        });
      }
    }

    if (toInsert.length > 0) {
      try {
        const created = [];
        const warnings = [];
        for (const a of toInsert) {
          try {
            if (a.serial_number) {
              const exists = await Asset.findOne({ serial_number: a.serial_number, store: a.store }).lean();
              if (exists) warnings.push({ serial: a.serial_number, message: 'Duplicate accepted (Admin)' });
            }
            const item = await Asset.create(a);
            created.push(item);
          } catch {}
        }
        await ActivityLog.create({
          user: req.user.name,
          email: req.user.email,
          role: req.user.role,
          action: 'Bulk Import',
          details: `Imported ${created.length} assets${warnings.length ? ` with ${warnings.length} duplicate warnings` : ''}`,
          store: req.activeStore || (toInsert.length > 0 ? toInsert[0].store : undefined),
          source: reqSource
        });
      } catch (e) {
        console.error('Bulk insert error:', e?.message || e);
      }
      res.json({ message: `${toInsert.length} assets processed`, skipped_duplicates: duplicates, invalid_rows: invalidRows });
    } else {
      res.status(400).json({ message: 'No valid assets found to import', skipped_duplicates: duplicates, invalid_rows: invalidRows });
    }

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
      'CATEGORY','PRODUCT TYPE','PRODUCT NAME','NAME','MODEL NUMBER','SERIAL NUMBER',
      'MAC ADDRESS','MANUFACTURER','TICKET NUMBER','RFID','QR CODE','STORE','LOCATION',
      'STATUS','CONDITION','UNIQUE ID','ASSIGNED TO','UPDATED AT'
    ];
    const rowsMain = assets.map(a => ([
      a.category || '',
      a.product_type || '',
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
      { wch: 12 },{ wch: 20 },{ wch: 14 },{ wch: 18 },{ wch: 22 }
    ];
    wsMain['!autofilter'] = { ref: 'A1:R1' };
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
        'Status': ''
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
      if (asset.status === 'New') asset.status = 'Used';
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

      if (asset.status === 'New') asset.status = 'Used';
      
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
    
    // Restore previous status if exists
    if (asset.previous_status) {
      asset.status = asset.previous_status;
      asset.previous_status = null; // Clear it
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
router.post('/collect', protect, async (req, res) => {
  const { assetId, ticketNumber, installationLocation } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    if (asset.assigned_to) {
      return res.status(400).json({ message: 'Asset is already assigned' });
    }
    if (asset.status === 'Faulty' || asset.status === 'Disposed') {
      return res.status(400).json({ message: 'Asset is not available (Faulty/Disposed)' });
    }

    const prev = asset.status;
    asset.status = 'Used';
    asset.assigned_to = req.user._id;
    asset.history.push({
      action: prev === 'New' ? 'Collected/New' : 'Collected/Used',
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
router.post('/faulty', protect, async (req, res) => {
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
router.post('/in-use', protect, async (req, res) => {
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
    asset.assigned_to = null;
    asset.assigned_to_external = null;
    
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
router.post('/return', protect, async (req, res) => {
  const { assetId, condition, ticketNumber } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    // Convert condition
    const condRaw = String(condition || '').trim().toLowerCase();
    const condMap = { new: 'New', used: 'Used', faulty: 'Faulty', 'under repair': 'Under Repair' };
    const cond = condMap[condRaw];
    if (!cond) return res.status(400).json({ message: 'Invalid return condition' });
    
    // Auto-approve return logic
    const previousUser = asset.assigned_to ? req.user.name : 'Unknown';
    
    asset.status = cond; // Set status to returned condition (New/Used/Faulty)
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
router.post('/return-request', protect, async (req, res) => {
  const { assetId, condition, ticketNumber } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (!asset.assigned_to || String(asset.assigned_to) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only request return for your assigned assets' });
    }
    const condRaw = String(condition || '').trim().toLowerCase();
    const condMap = { new: 'New', used: 'Used', faulty: 'Faulty', 'under repair': 'Under Repair' };
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
    asset.status = cond;
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
  const { name, model_number, serial_number, mac_address, manufacturer, store, location, status, condition, ticket_number, category, product_type, product_name, rfid, qr_code } = req.body;
  try {
    const asset = await Asset.findById(req.params.id);
    if (asset) {
      const oldSerial = asset.serial_number;
      asset.name = name ? capitalizeWords(name) : asset.name;
      asset.model_number = model_number || asset.model_number;
      asset.serial_number = serial_number || asset.serial_number;
      asset.serial_last_4 = asset.serial_number.slice(-4);
      asset.mac_address = mac_address || asset.mac_address;
      asset.manufacturer = manufacturer ? capitalizeWords(manufacturer) : (asset.manufacturer || '');
      asset.ticket_number = ticket_number || asset.ticket_number || '';
      asset.category = category ? capitalizeWords(category) : (asset.category || 'Other');
      asset.product_type = product_type ? capitalizeWords(product_type) : (asset.product_type || '');
      asset.product_name = product_name ? capitalizeWords(product_name) : (asset.product_name || '');
      asset.rfid = rfid || asset.rfid || '';
      asset.qr_code = qr_code || asset.qr_code || '';
      asset.store = store || asset.store;
      if (location !== undefined) asset.location = capitalizeWords(location);
      asset.status = status || asset.status;
      asset.condition = condition || asset.condition;

      const updatedAsset = await asset.save();

      // Log Activity
      await ActivityLog.create({
        user: req.user.name,
        email: req.user.email,
        role: req.user.role,
        action: 'Edit Asset',
        details: `Edited asset ${updatedAsset.name} (SN: ${oldSerial} -> ${updatedAsset.serial_number})`,
        store: updatedAsset.store
      });

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
