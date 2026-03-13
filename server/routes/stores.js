const express = require('express');
const router = express.Router();
const Store = require('../models/Store');
const Asset = require('../models/Asset');
const mongoose = require('mongoose');
const { protect, admin } = require('../middleware/authMiddleware');
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const resolveCreateStoreContext = (req, payload = {}) => {
  let finalParentStore = payload.parentStore;
  let finalIsMainStore = payload.isMainStore || false;

  if (req.user.role !== 'Super Admin') {
    finalIsMainStore = false;
    if (!req.user.assignedStore) {
      return { error: 'No assigned store found for Admin' };
    }
    finalParentStore = req.user.assignedStore;
  } else if (req.activeStore && !finalParentStore && !finalIsMainStore) {
    finalParentStore = req.activeStore;
  }

  return { finalParentStore, finalIsMainStore };
};

// @desc    Get all stores (with optional filtering)
// @route   GET /api/stores
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const filter = {};
    const q = String(req.query.q || '').trim();
    const requestedPage = Number.parseInt(String(req.query.page || ''), 10);
    const requestedLimit = Number.parseInt(String(req.query.limit || ''), 10);
    const usePagination = Number.isFinite(requestedPage) || Number.isFinite(requestedLimit);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 200)
      : 50;
    
    // Filter by isMainStore
    if (req.query.main === 'true') {
      filter.isMainStore = true;
    } else if (req.query.main === 'false') {
      filter.isMainStore = false;
    }

    // Filter by parentStore
    if (req.query.parent) {
      filter.parentStore = req.query.parent;
    }

    // Filter by deletionRequested
    if (req.query.deletionRequested === 'true') {
      filter.deletionRequested = true;
    }
    if (q) {
      filter.name = { $regex: new RegExp(escapeRegex(q), 'i') };
    }

    // Role-Based Filtering
    if (req.user.role !== 'Super Admin' && req.user.assignedStore) {
        // If user is restricted to a store, only show that store OR its children
        // But logic depends on what is being requested.
        // If requesting main stores (Portal), show only the assigned one.
        if (req.query.main === 'true') {
            filter._id = req.user.assignedStore;
        } 
        // If requesting children (Locations page), force parentStore to be assignedStore
        // (This prevents them from seeing other store's locations even if they try)
        else if (req.query.parent) {
             if (req.query.parent !== req.user.assignedStore.toString()) {
                 return res.json([]); // Not allowed to see other parents
             }
        }
        // If just requesting all stores generally (fallback)
        else {
             // Show assigned store OR children of assigned store
             filter.$or = [
                 { _id: req.user.assignedStore },
                 { parentStore: req.user.assignedStore }
             ];
        }
    } else if (req.user.role === 'Viewer') {
        const scope = req.user.accessScope || 'All';
        
        if (scope !== 'All') {
            // Filter Main Stores by name
            if (req.query.main === 'true') {
                 filter.name = { $regex: scope, $options: 'i' };
            }
            // Filter Locations (child stores)
            else if (req.query.parent) {
                 // Verify parent store matches scope
                 const parent = await Store.findById(req.query.parent);
                 if (!parent || !parent.name.toUpperCase().includes(scope)) {
                     return res.json([]);
                 }
            }
            // Fallback: restrict to allowed main stores and their children
            else {
                 const allowedMainStores = await Store.find({ 
                     isMainStore: true, 
                     name: { $regex: scope, $options: 'i' } 
                 }).select('_id');
                 const allowedIds = allowedMainStores.map(s => s._id);
                 
                 filter.$or = [
                     { _id: { $in: allowedIds } },
                     { parentStore: { $in: allowedIds } }
                 ];
            }
        }
    }

    // Sort by name for better UX
    let stores = [];
    let total = 0;
    if (usePagination) {
      total = await Store.countDocuments(filter);
      stores = await Store.find(filter)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
    } else {
      stores = await Store.find(filter).sort({ name: 1 }).lean();
      total = stores.length;
    }

    if (req.query.includeAssetTotals === 'true' && stores.length > 0) {
      const locationNames = Array.from(
        new Set(
          stores
            .map((s) => normalizeName(s?.name).toLowerCase())
            .filter(Boolean)
        )
      );

      const totalsByLocation = {};
      const qtyExpr = {
        $cond: [
          { $and: [{ $ne: ['$quantity', null] }, { $gt: ['$quantity', 0] }] },
          '$quantity',
          1
        ]
      };

      if (locationNames.length > 0) {
        const locationRegexes = locationNames.map((name) => new RegExp(`^${escapeRegex(name)}$`, 'i'));
        const groupedByLocation = await Asset.aggregate([
          {
            $match: {
              disposed: { $ne: true },
              location: { $in: locationRegexes }
            }
          },
          {
            $group: {
              _id: { $toLower: { $trim: { input: { $ifNull: ['$location', ''] } } } },
              available: { $sum: qtyExpr }
            }
          }
        ]);
        for (const row of groupedByLocation) {
          const available = Number(row?.available || 0);
          if (available <= 0) continue;
          const loc = String(row?._id || '');
          totalsByLocation[loc] = (totalsByLocation[loc] || 0) + available;
        }
      }

      stores = stores.map((s) => {
        const byLocation = totalsByLocation[normalizeName(s?.name).toLowerCase()];
        return {
          ...s,
          availableAssetCount: byLocation || 0
        };
      });
    }

    if (usePagination) {
      return res.json({
        items: stores,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit))
        }
      });
    }

    res.json(stores);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create a store (Location)
// @route   POST /api/stores
// @access  Private/Admin
router.post('/', protect, admin, async (req, res) => {
  const { name, isMainStore, parentStore } = req.body;
  try {
    const context = resolveCreateStoreContext(req, { isMainStore, parentStore });
    if (context.error) {
      return res.status(403).json({ message: context.error });
    }
    const { finalParentStore, finalIsMainStore } = context;

    const cleanName = normalizeName(name);
    if (!cleanName) {
      return res.status(400).json({ message: 'Location name is required' });
    }

    const existing = await Store.findOne({
      parentStore: finalParentStore || null,
      name: { $regex: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') }
    }).lean();
    if (existing) {
      return res.status(400).json({ message: 'A location with this name already exists in this store' });
    }

    const store = await Store.create({
      name: cleanName,
      isMainStore: finalIsMainStore,
      parentStore: finalParentStore
    });
    res.status(201).json(store);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ message: 'A location with this name already exists in this store' });
    }
    res.status(400).json({ message: error.message });
  }
});

// @desc    Bulk create locations
// @route   POST /api/stores/bulk
// @access  Private/Admin
router.post('/bulk', protect, admin, async (req, res) => {
  try {
    const names = Array.isArray(req.body?.names) ? req.body.names : [];
    if (names.length === 0) {
      return res.status(400).json({ message: 'At least one location name is required.' });
    }
    if (names.length > 1000) {
      return res.status(400).json({ message: 'Maximum 1000 locations can be added at once.' });
    }

    const context = resolveCreateStoreContext(req, {
      isMainStore: false,
      parentStore: req.body?.parentStore
    });
    if (context.error) {
      return res.status(403).json({ message: context.error });
    }
    const { finalParentStore } = context;

    const normalizedNames = names
      .map((name) => normalizeName(name))
      .filter(Boolean);
    if (normalizedNames.length === 0) {
      return res.status(400).json({ message: 'No valid location names found after normalization.' });
    }

    const uniqueNames = [];
    const seen = new Set();
    const skipped = [];
    for (const name of normalizedNames) {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        skipped.push({ name, reason: 'duplicate in request' });
        continue;
      }
      seen.add(key);
      uniqueNames.push(name);
    }

    const existingRows = await Store.find({ parentStore: finalParentStore || null })
      .select('name')
      .lean();
    const existingSet = new Set(existingRows.map((row) => normalizeName(row?.name).toLowerCase()));

    const toInsert = [];
    for (const name of uniqueNames) {
      if (existingSet.has(name.toLowerCase())) {
        skipped.push({ name, reason: 'already exists' });
        continue;
      }
      toInsert.push({
        name,
        isMainStore: false,
        parentStore: finalParentStore
      });
    }

    let inserted = [];
    if (toInsert.length > 0) {
      try {
        inserted = await Store.insertMany(toInsert, { ordered: false });
      } catch (error) {
        const writeErrors = Array.isArray(error?.writeErrors) ? error.writeErrors : [];
        const duplicateIndexes = new Set(
          writeErrors
            .filter((e) => e?.code === 11000 && Number.isInteger(e?.index))
            .map((e) => e.index)
        );
        if (duplicateIndexes.size > 0) {
          for (const idx of duplicateIndexes) {
            const row = toInsert[idx];
            if (!row?.name) continue;
            skipped.push({ name: row.name, reason: 'already exists' });
          }
        }
        inserted = Array.isArray(error?.insertedDocs) ? error.insertedDocs : [];
        if (!writeErrors.length) {
          return res.status(400).json({ message: error.message });
        }
      }
    }

    return res.status(201).json({
      requested: names.length,
      normalized: normalizedNames.length,
      created: inserted.length,
      skippedCount: skipped.length,
      skipped
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

// @desc    Update a store
// @route   PUT /api/stores/:id
// @access  Private/Admin
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);
    if (store) {
      // RBAC & Isolation
      if (req.user.role !== 'Super Admin') {
        // Can only edit their own assigned store OR children of their assigned store
        const isAssignedStore = req.user.assignedStore && store._id.toString() === req.user.assignedStore.toString();
        const isChildOfAssignedStore = req.user.assignedStore && store.parentStore?.toString() === req.user.assignedStore.toString();

        if (!isAssignedStore && !isChildOfAssignedStore) {
          return res.status(403).json({ message: 'Not authorized to update this store' });
        }

        // Prevent changing critical fields
        if (req.body.parentStore || req.body.isMainStore !== undefined) {
             // For safety, ignore these fields or throw error. Here we just ensure they aren't used.
             // (Logic below uses req.body directly, so we must be careful)
             // Let's explicitly block if they try to change structure
             if (req.body.parentStore && req.body.parentStore !== store.parentStore?.toString()) {
                return res.status(403).json({ message: 'Cannot move store to another parent' });
             }
        }
      }

      const cleanName = normalizeName(req.body.name || store.name);
      if (!cleanName) {
        return res.status(400).json({ message: 'Location name is required' });
      }

      const existing = await Store.findOne({
        _id: { $ne: store._id },
        parentStore: store.parentStore || null,
        name: { $regex: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') }
      }).lean();
      if (existing) {
        return res.status(400).json({ message: 'A location with this name already exists in this store' });
      }

      store.name = cleanName;
      
      // Only allow structure changes if Super Admin
      if (req.user.role === 'Super Admin') {
        if (req.body.parentStore !== undefined) {
          store.parentStore = req.body.parentStore;
        }
        if (req.body.isMainStore !== undefined) {
          store.isMainStore = req.body.isMainStore;
        }
      }

      const updatedStore = await store.save();
      res.json(updatedStore);
    } else {
      res.status(404).json({ message: 'Store not found' });
    }
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ message: 'A location with this name already exists in this store' });
    }
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete a store
// @route   DELETE /api/stores/:id
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);
    if (store) {
      // RBAC & Isolation
      if (req.user.role !== 'Super Admin') {
        // Prevent deleting Main Store
        if (store.isMainStore) {
            return res.status(403).json({ message: 'Cannot delete Main Store' });
        }
        
        // Prevent deleting their own assigned root store (The "Database")
        if (req.user.assignedStore && store._id.toString() === req.user.assignedStore.toString()) {
            return res.status(403).json({ message: 'Cannot delete your assigned root store. Please request a reset via Setup.' });
        }

        // Can only delete children of their assigned store
        const isChildOfAssignedStore = req.user.assignedStore && store.parentStore?.toString() === req.user.assignedStore.toString();

        if (!isChildOfAssignedStore) {
          return res.status(403).json({ message: 'Not authorized to delete this store' });
        }
      }

      await store.deleteOne();
      res.json({ message: 'Store removed' });
    } else {
      res.status(404).json({ message: 'Store not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
