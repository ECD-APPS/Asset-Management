const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { protect, admin, superAdmin } = require('../middleware/authMiddleware');
const User = require('../models/User');
const Asset = require('../models/Asset');
const Store = require('../models/Store');
const Request = require('../models/Request');
const ActivityLog = require('../models/ActivityLog');
const PurchaseOrder = require('../models/PurchaseOrder');
const Vendor = require('../models/Vendor');
const Pass = require('../models/Pass');
const Permit = require('../models/Permit');
const AssetCategory = require('../models/AssetCategory');
const EmailLog = require('../models/EmailLog');
const bcrypt = require('bcryptjs');
const { backupDatabase } = require('../backup_db');
const Setting = require('../models/Setting');
const { sendStoreEmail, buildTransport } = require('../utils/storeEmail');

const upload = multer({ storage: multer.memoryStorage() });
const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const okType = file.mimetype === 'application/json' || file.originalname.toLowerCase().endsWith('.json');
    if (!okType) {
      return cb(new Error(`Invalid file type for ${file.originalname}. Only .json backups are allowed.`));
    }
    cb(null, true);
  }
});

// Branding logo upload (disk storage)
const brandingDir = path.join(__dirname, '../uploads/branding');
if (!fs.existsSync(brandingDir)) {
  fs.mkdirSync(brandingDir, { recursive: true });
}
const allowedMime = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const createBrandingUpload = (prefix) => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, brandingDir),
    filename: (req, file, cb) => {
      const ts = Date.now();
      const extMatch = file.originalname.match(/\.[a-zA-Z0-9]+$/);
      const ext = extMatch ? extMatch[0].toLowerCase() : '';
      cb(null, `${prefix}-${ts}${ext}`);
    }
  });
  return multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
      if (!allowedMime.has(file.mimetype)) {
        return cb(new Error('Invalid file type. Allowed: PNG, JPG, SVG'));
      }
      cb(null, true);
    }
  });
};
const brandingUpload = createBrandingUpload('app-logo');
const gatePassLogoUpload = createBrandingUpload('gatepass-logo');

// Simple in-process lock to prevent concurrent resets
let RESET_LOCK = false;
const RESTORE_SCANS = new Map();
const SCAN_TTL_MS = 30 * 60 * 1000;

const normalizeIdentity = (value) => String(value || '').trim().toLowerCase();
const toPlain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeRecipientList = (input) => {
  const list = Array.isArray(input)
    ? input
    : String(input || '')
      .split(',');
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_RX.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
};

const pickDuplicateKeys = (assetLike = {}) => {
  const uniqueId = String(assetLike.uniqueId || assetLike.asset_id || '').trim();
  const serialNumber = String(assetLike.serial_number || assetLike.serialNumber || '').trim();
  const assetTag = String(
    assetLike.asset_tag || assetLike.assetTag || assetLike.tag || assetLike.rfid || assetLike.qr_code || ''
  ).trim();
  return { uniqueId, serialNumber, assetTag };
};

const sanitizeBackupAsset = (asset) => {
  const cleaned = { ...asset };
  delete cleaned._id;
  delete cleaned.__v;
  delete cleaned.createdAt;
  delete cleaned.updatedAt;
  if (!cleaned.uniqueId && cleaned.asset_id) cleaned.uniqueId = cleaned.asset_id;
  if (!cleaned.serial_number && cleaned.serialNumber) cleaned.serial_number = cleaned.serialNumber;
  if (!cleaned.name && cleaned.asset_name) cleaned.name = cleaned.asset_name;
  cleaned.name = cleaned.name || 'Unnamed Asset';
  return cleaned;
};

const generateForceAddUniqueId = async (seed = 'AST') => {
  const base = String(seed || 'AST').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6) || 'AST';
  for (let i = 0; i < 12; i += 1) {
    const candidate = `${base}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9999)}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Asset.findOne({ uniqueId: candidate }).lean();
    if (!exists) return candidate;
  }
  return `${base}-${Date.now()}`;
};

// Helper to get directory size
const getDirSize = (dirPath) => {
  let size = 0;
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        size += getDirSize(filePath);
      } else {
        size += stats.size;
      }
    });
  }
  return size;
};

// @desc    Get system storage stats
// @route   GET /api/system/storage
// @access  Private/Admin
router.get('/storage', protect, admin, async (req, res) => {
  try {
    const dbStats = await mongoose.connection.db.stats();
    const dbSize = dbStats.dataSize || 0;
    
    const uploadsPath = path.join(__dirname, '../uploads');
    const uploadsSize = getDirSize(uploadsPath);
    
    const usedBytes = dbSize + uploadsSize;
    const limitBytes = 512 * 1024 * 1024; // 512 MB limit
    const percentUsed = Math.min(Math.round((usedBytes / limitBytes) * 100), 100);
    
    res.json({
      usedBytes,
      limitBytes,
      percentUsed
    });
  } catch (error) {
    console.error('Error fetching storage stats:', error);
    res.status(500).json({ message: error.message });
  }
});

// @desc    Public configuration (branding, etc.)
// @route   GET /api/system/public-config
// @access  Public
router.get('/public-config', async (req, res) => {
  try {
    const requestedStoreId = String(req.query?.storeId || '').trim();
    const [logoSetting, gatePassLogoSetting, themeSetting, storeThemeDoc] = await Promise.all([
      Setting.findOne({ key: 'logoUrl' }).lean(),
      Setting.findOne({ key: 'gatePassLogoUrl' }).lean(),
      Setting.findOne({ key: 'theme' }).lean(),
      requestedStoreId ? Store.findById(requestedStoreId).select('appTheme').lean() : Promise.resolve(null)
    ]);
    const logoUrl = logoSetting?.value || '/logo.svg';
    const gatePassLogoUrl = gatePassLogoSetting?.value || logoUrl;
    const fallbackTheme = typeof themeSetting?.value === 'string' ? themeSetting.value : 'default';
    const theme = storeThemeDoc?.appTheme || fallbackTheme;
    res.json({ logoUrl, gatePassLogoUrl, theme });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Upload/replace application logo (Super Admin only)
// @route   POST /api/system/logo
// @access  Private/SuperAdmin
router.post('/logo', protect, superAdmin, brandingUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Logo file is required' });
    }
    // Optionally, remove very old logos to save space (keep latest 5)
    try {
      const files = fs.readdirSync(brandingDir).filter(f => f.startsWith('app-logo-'));
      files.sort(); // oldest first by name since includes timestamp
      while (files.length > 5) {
        const toDelete = files.shift();
        if (toDelete) {
          fs.unlinkSync(path.join(brandingDir, toDelete));
        }
      }
    } catch {}

    const relativeUrl = `/uploads/branding/${req.file.filename}`;
    await Setting.updateOne(
      { key: 'logoUrl' },
      { $set: { value: relativeUrl, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ message: 'Logo updated', logoUrl: relativeUrl });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Upload/replace gate pass logo (Super Admin only)
// @route   POST /api/system/gatepass-logo
// @access  Private/SuperAdmin
router.post('/gatepass-logo', protect, superAdmin, gatePassLogoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Logo file is required' });
    }
    // Keep latest gate pass logos only
    try {
      const files = fs.readdirSync(brandingDir).filter((f) => f.startsWith('gatepass-logo-'));
      files.sort();
      while (files.length > 5) {
        const toDelete = files.shift();
        if (toDelete) fs.unlinkSync(path.join(brandingDir, toDelete));
      }
    } catch {}

    const relativeUrl = `/uploads/branding/${req.file.filename}`;
    await Setting.updateOne(
      { key: 'gatePassLogoUrl' },
      { $set: { value: relativeUrl, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ message: 'Gate pass logo updated', gatePassLogoUrl: relativeUrl });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update application theme (Admin or Super Admin)
// @route   POST /api/system/theme
// @access  Private/Admin
router.post('/theme', protect, admin, async (req, res) => {
  try {
    const { theme, storeId: inputStoreId } = req.body || {};
    const allowed = ['default', 'ocean', 'emerald', 'sunset', 'midnight', 'mono'];
    if (!allowed.includes(theme)) {
      return res.status(400).json({ message: 'Invalid theme selected' });
    }

    const targetStoreId = req.user.role === 'Super Admin'
      ? (inputStoreId || req.activeStore || null)
      : (req.user.assignedStore || null);

    if (!targetStoreId) {
      return res.status(400).json({ message: 'Store context is required to update theme' });
    }

    const store = await Store.findByIdAndUpdate(
      targetStoreId,
      { $set: { appTheme: theme } },
      { new: true }
    ).select('name appTheme');

    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }

    res.json({ message: 'Theme updated', theme: store.appTheme, storeId: store._id, storeName: store.name });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Trigger database backup
// @route   POST /api/system/backup
// @access  Private/Admin
router.post('/backup', protect, admin, async (req, res) => {
  try {
    const backupDir = await backupDatabase();
    res.json({ message: 'Backup completed successfully', path: backupDir });
  } catch (error) {
    console.error('Error running backup:', error);
    res.status(500).json({ message: error.message || 'Backup failed' });
  }
});

// @desc    Download full backup as JSON file
// @route   GET /api/system/backup-file
// @access  Private/SuperAdmin
router.get('/backup-file', protect, superAdmin, async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const [
      users,
      stores,
      assets,
      requests,
      activityLogs,
      purchaseOrders,
      vendors,
      passes,
      permits,
      assetCategories
    ] = await Promise.all([
      User.find({}).lean(),
      Store.find({}).lean(),
      Asset.find({}).lean(),
      Request.find({}).lean(),
      ActivityLog.find({}).lean(),
      PurchaseOrder.find({}).lean(),
      Vendor.find({}).lean(),
      Pass.find({}).lean(),
      Permit.find({}).lean(),
      AssetCategory.find({}).lean()
    ]);

    const payload = {
      meta: {
        createdAt: new Date().toISOString(),
        version: 1
      },
      collections: {
        users,
        stores,
        assets,
        requests,
        activityLogs,
        purchaseOrders,
        vendors,
        passes,
        permits,
        assetCategories
      }
    };

    const json = JSON.stringify(payload, null, 2);
    const fileName = `expo-backup-${timestamp}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.send(json);
  } catch (error) {
    console.error('Error generating backup file:', error);
    res.status(500).json({ message: error.message || 'Failed to generate backup file' });
  }
});

// @desc    Restore database from uploaded backup file
// @route   POST /api/system/restore-from-file
// @access  Private/SuperAdmin
router.post('/restore-from-file', protect, superAdmin, upload.single('backup'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Backup file is required' });
  }

  try {
    const content = req.file.buffer.toString('utf8');
    const payload = JSON.parse(content);
    const collections = payload.collections || {};

    await User.deleteMany({});
    await Store.deleteMany({});
    await Asset.deleteMany({});
    await Request.deleteMany({});
    await ActivityLog.deleteMany({});
    await PurchaseOrder.deleteMany({});
    await Vendor.deleteMany({});
    await Pass.deleteMany({});
    await Permit.deleteMany({});
    await AssetCategory.deleteMany({});

    if (collections.users?.length) await User.insertMany(collections.users, { ordered: false });
    if (collections.stores?.length) await Store.insertMany(collections.stores, { ordered: false });
    if (collections.assets?.length) await Asset.insertMany(collections.assets, { ordered: false });
    if (collections.requests?.length) await Request.insertMany(collections.requests, { ordered: false });
    if (collections.activityLogs?.length) await ActivityLog.insertMany(collections.activityLogs, { ordered: false });
    if (collections.purchaseOrders?.length) await PurchaseOrder.insertMany(collections.purchaseOrders, { ordered: false });
    if (collections.vendors?.length) await Vendor.insertMany(collections.vendors, { ordered: false });
    if (collections.passes?.length) await Pass.insertMany(collections.passes, { ordered: false });
    if (collections.permits?.length) await Permit.insertMany(collections.permits, { ordered: false });
    if (collections.assetCategories?.length) await AssetCategory.insertMany(collections.assetCategories, { ordered: false });

    res.json({ message: 'Restore completed successfully' });
  } catch (error) {
    console.error('Error restoring from backup file:', error);
    res.status(500).json({ message: error.message || 'Failed to restore from backup file' });
  }
});

// @desc    Scan backup file and detect duplicate conflicts
// @route   POST /api/system/backup-upload/scan
// @access  Private/SuperAdmin
router.post('/backup-upload/scan', protect, superAdmin, bulkUpload.single('backup'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Backup file is required' });
  }

  try {
    const content = req.file.buffer.toString('utf8');
    const payload = JSON.parse(content);
    const assets = Array.isArray(payload?.collections?.assets) ? payload.collections.assets : [];
    const fileName = req.file.originalname || `backup-${Date.now()}.json`;

    if (assets.length === 0) {
      return res.status(400).json({ message: `No assets found in ${fileName}` });
    }

    const prepared = [];
    const conflicts = [];
    const duplicateQueries = [];

    for (const raw of assets) {
      const asset = sanitizeBackupAsset(raw);
      const keys = pickDuplicateKeys(asset);
      const clauses = [];
      if (keys.uniqueId) clauses.push({ uniqueId: keys.uniqueId });
      if (keys.serialNumber) clauses.push({ serial_number: keys.serialNumber });
      if (keys.assetTag) clauses.push({ $or: [{ asset_tag: keys.assetTag }, { rfid: keys.assetTag }, { qr_code: keys.assetTag }] });
      if (clauses.length > 0) duplicateQueries.push({ $or: clauses });
      prepared.push({ asset, keys });
    }

    let existingMatches = [];
    if (duplicateQueries.length > 0) {
      existingMatches = await Asset.find({ $or: duplicateQueries }).lean();
    }

    const byUnique = new Map();
    const bySerial = new Map();
    const byTag = new Map();
    existingMatches.forEach((doc) => {
      if (doc.uniqueId) byUnique.set(normalizeIdentity(doc.uniqueId), doc);
      if (doc.serial_number) bySerial.set(normalizeIdentity(doc.serial_number), doc);
      if (doc.asset_tag) byTag.set(normalizeIdentity(doc.asset_tag), doc);
      if (doc.rfid) byTag.set(normalizeIdentity(doc.rfid), doc);
      if (doc.qr_code) byTag.set(normalizeIdentity(doc.qr_code), doc);
    });

    const normalizedAssets = [];
    prepared.forEach(({ asset, keys }, idx) => {
      const existing =
        (keys.uniqueId && byUnique.get(normalizeIdentity(keys.uniqueId))) ||
        (keys.serialNumber && bySerial.get(normalizeIdentity(keys.serialNumber))) ||
        (keys.assetTag && byTag.get(normalizeIdentity(keys.assetTag)));

      const row = {
        rowId: `${fileName}-${idx}`,
        fileName,
        backupAsset: asset,
        duplicateKeys: keys
      };
      normalizedAssets.push(row);

      if (existing) {
        conflicts.push({
          rowId: row.rowId,
          fileName,
          assetName: asset.name || 'Unnamed Asset',
          serialNumber: asset.serial_number || '',
          existingRecord: {
            _id: existing._id,
            name: existing.name,
            uniqueId: existing.uniqueId || '',
            serial_number: existing.serial_number || '',
            status: existing.status || '',
            store: existing.store || null
          },
          backupRecord: {
            name: asset.name || '',
            uniqueId: asset.uniqueId || '',
            serial_number: asset.serial_number || '',
            status: asset.status || '',
            store: asset.store || null
          },
          suggestedAction: 'skip'
        });
      }
    });

    const scanId = `scan-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    RESTORE_SCANS.set(scanId, {
      createdAt: Date.now(),
      fileName,
      assets: normalizedAssets,
      conflicts
    });

    res.json({
      message: `Scanned ${fileName}`,
      scanId,
      fileName,
      totals: {
        processed: normalizedAssets.length,
        conflicts: conflicts.length,
        readyToInsert: normalizedAssets.length - conflicts.length
      },
      conflicts
    });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Failed to parse backup file' });
  }
});

// @desc    Apply conflict resolution for scanned backups
// @route   POST /api/system/backup-upload/apply
// @access  Private/SuperAdmin
router.post('/backup-upload/apply', protect, superAdmin, async (req, res) => {
  try {
    const {
      scanIds = [],
      actions = {},
      defaultAction = 'skip',
      applyActionToAll = false
    } = req.body || {};

    if (!Array.isArray(scanIds) || scanIds.length === 0) {
      return res.status(400).json({ message: 'scanIds is required' });
    }

    const now = Date.now();
    for (const [id, scan] of RESTORE_SCANS.entries()) {
      if (now - scan.createdAt > SCAN_TTL_MS) {
        RESTORE_SCANS.delete(id);
      }
    }

    const scans = scanIds.map((id) => RESTORE_SCANS.get(id)).filter(Boolean);
    if (scans.length === 0) {
      return res.status(404).json({ message: 'No valid scanned backup sessions found' });
    }

    const allRows = scans.flatMap((scan) => scan.assets || []);
    const summary = {
      totalProcessed: allRows.length,
      added: 0,
      updated: 0,
      skipped: 0,
      conflictsResolved: 0
    };

    for (const row of allRows) {
      const assetData = sanitizeBackupAsset(row.backupAsset || {});
      const keys = row.duplicateKeys || pickDuplicateKeys(assetData);

      const clauses = [];
      if (keys.uniqueId) clauses.push({ uniqueId: keys.uniqueId });
      if (keys.serialNumber) clauses.push({ serial_number: keys.serialNumber });
      if (keys.assetTag) clauses.push({ $or: [{ asset_tag: keys.assetTag }, { rfid: keys.assetTag }, { qr_code: keys.assetTag }] });
      // eslint-disable-next-line no-await-in-loop
      const existing = clauses.length ? await Asset.findOne({ $or: clauses }) : null;

      if (!existing) {
        // eslint-disable-next-line no-await-in-loop
        await Asset.create(assetData);
        summary.added += 1;
        continue;
      }

      const explicit = actions[row.rowId];
      const action = (applyActionToAll ? defaultAction : (explicit?.action || defaultAction || 'skip')).toLowerCase();
      const mergeData = explicit?.mergeData || {};

      if (action === 'skip') {
        summary.skipped += 1;
      } else if (action === 'replace') {
        Object.assign(existing, assetData, { _id: existing._id });
        // eslint-disable-next-line no-await-in-loop
        await existing.save();
        summary.updated += 1;
        summary.conflictsResolved += 1;
      } else if (action === 'edit' || action === 'merge') {
        Object.assign(existing, assetData, mergeData, { _id: existing._id });
        // eslint-disable-next-line no-await-in-loop
        await existing.save();
        summary.updated += 1;
        summary.conflictsResolved += 1;
      } else if (action === 'force_add') {
        const forced = { ...assetData };
        forced.uniqueId = await generateForceAddUniqueId(assetData.uniqueId || assetData.name || 'AST');
        // eslint-disable-next-line no-await-in-loop
        await Asset.create(forced);
        summary.added += 1;
        summary.conflictsResolved += 1;
      } else {
        summary.skipped += 1;
      }
    }

    scanIds.forEach((id) => RESTORE_SCANS.delete(id));

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Bulk Backup Restore',
      details: `Processed ${summary.totalProcessed}, Added ${summary.added}, Updated ${summary.updated}, Skipped ${summary.skipped}`,
      store: null
    });

    res.json({
      message: 'Bulk backup restore completed',
      summary
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to apply restore actions' });
  }
});

const resolveEmailConfigStoreId = (req, inputStoreId) => {
  if (req.user.role === 'Super Admin') {
    return inputStoreId || req.query.storeId || req.activeStore || req.user.assignedStore || null;
  }
  return req.user.assignedStore || null;
};

// @desc    Get store email configuration
// @route   GET /api/system/email-config
// @access  Private/Admin
router.get('/email-config', protect, admin, async (req, res) => {
  try {
    const storeId = resolveEmailConfigStoreId(req, req.query.storeId);
    if (!storeId) return res.status(400).json({ message: 'Store context is required' });

    const store = await Store.findById(storeId).lean();
    if (!store) return res.status(404).json({ message: 'Store not found' });

    const cfg = store.emailConfig || {};
    res.json({
      storeId: store._id,
      storeName: store.name,
      emailConfig: {
        smtpHost: cfg.smtpHost || '',
        smtpPort: cfg.smtpPort || 587,
        username: cfg.username || '',
        password: cfg.password || '',
        encryption: cfg.encryption || 'TLS',
        fromEmail: cfg.fromEmail || '',
        fromName: cfg.fromName || '',
        notificationRecipients: Array.isArray(cfg.notificationRecipients) ? cfg.notificationRecipients : [],
        lineManagerRecipients: Array.isArray(cfg.lineManagerRecipients) ? cfg.lineManagerRecipients : [],
        requireLineManagerApprovalForCollection: Boolean(cfg.requireLineManagerApprovalForCollection),
        collectionApprovalRecipients: Array.isArray(cfg.collectionApprovalRecipients) ? cfg.collectionApprovalRecipients : [],
        enabled: Boolean(cfg.enabled)
      },
      canOverrideAllStores: req.user.role === 'Super Admin'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Save store email configuration
// @route   PUT /api/system/email-config
// @access  Private/Admin
router.put('/email-config', protect, admin, async (req, res) => {
  try {
    const storeId = resolveEmailConfigStoreId(req, req.body.storeId);
    if (!storeId) return res.status(400).json({ message: 'Store context is required' });

    const {
      smtpHost,
      smtpPort,
      username,
      password,
      encryption = 'TLS',
      fromEmail,
      fromName,
      notificationRecipients,
      lineManagerRecipients,
      requireLineManagerApprovalForCollection,
      collectionApprovalRecipients,
      enabled
    } = req.body;

    if (!smtpHost || !smtpPort || !username || !password) {
      return res.status(400).json({ message: 'SMTP host, port, username and password are required' });
    }
    if (!['TLS', 'SSL'].includes(String(encryption).toUpperCase())) {
      return res.status(400).json({ message: 'Encryption must be TLS or SSL' });
    }

    const existingStore = await Store.findById(storeId).lean();
    if (!existingStore) return res.status(404).json({ message: 'Store not found' });
    const mergedRecipients = notificationRecipients === undefined
      ? (Array.isArray(existingStore?.emailConfig?.notificationRecipients) ? existingStore.emailConfig.notificationRecipients : [])
      : normalizeRecipientList(notificationRecipients);
    const mergedLineManagerRecipients = lineManagerRecipients === undefined
      ? (Array.isArray(existingStore?.emailConfig?.lineManagerRecipients) ? existingStore.emailConfig.lineManagerRecipients : [])
      : normalizeRecipientList(lineManagerRecipients);
    const mergedCollectionApprovalRecipients = collectionApprovalRecipients === undefined
      ? (Array.isArray(existingStore?.emailConfig?.collectionApprovalRecipients) ? existingStore.emailConfig.collectionApprovalRecipients : [])
      : normalizeRecipientList(collectionApprovalRecipients);

    const update = {
      emailConfig: {
        smtpHost: String(smtpHost).trim(),
        smtpPort: Number(smtpPort),
        username: String(username).trim(),
        password: String(password),
        encryption: String(encryption).toUpperCase(),
        fromEmail: String(fromEmail || username).trim(),
        fromName: String(fromName || '').trim(),
        notificationRecipients: mergedRecipients,
        lineManagerRecipients: mergedLineManagerRecipients,
        requireLineManagerApprovalForCollection: requireLineManagerApprovalForCollection === undefined
          ? Boolean(existingStore?.emailConfig?.requireLineManagerApprovalForCollection)
          : Boolean(requireLineManagerApprovalForCollection),
        collectionApprovalRecipients: mergedCollectionApprovalRecipients,
        enabled: Boolean(enabled !== false),
        updatedBy: req.user._id,
        updatedAt: new Date()
      }
    };

    const store = await Store.findByIdAndUpdate(storeId, { $set: update }, { new: true });
    if (!store) return res.status(404).json({ message: 'Store not found' });

    res.json({ message: 'Email configuration saved', storeId: store._id, storeName: store.name });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Send test email with store configuration
// @route   POST /api/system/email-config/test
// @access  Private/Admin
router.post('/email-config/test', protect, admin, async (req, res) => {
  try {
    const storeId = resolveEmailConfigStoreId(req, req.body.storeId);
    const recipient = String(req.body?.to || req.user.email || '').trim();
    if (!recipient) return res.status(400).json({ message: 'Recipient email is required' });
    if (!storeId) return res.status(400).json({ message: 'Store context is required' });

    const store = await Store.findById(storeId).lean();
    if (!store) return res.status(404).json({ message: 'Store not found' });
    const cfg = store.emailConfig || {};
    if (!cfg.enabled) return res.status(400).json({ message: 'Email config is disabled for this store' });

    const forceConfig = {
      smtpHost: cfg.smtpHost,
      smtpPort: cfg.smtpPort,
      username: cfg.username,
      password: cfg.password,
      encryption: cfg.encryption,
      fromEmail: cfg.fromEmail || cfg.username,
      fromName: cfg.fromName || store.name || 'Expo Asset',
      storeName: store.name
    };
    const transporter = buildTransport(forceConfig);
    await transporter.verify();

    await sendStoreEmail({
      storeId,
      to: recipient,
      subject: `Test Email - ${store.name}`,
      text: `This is a test email from ${store.name} SMTP configuration.`,
      html: `<p>This is a test email from <strong>${store.name}</strong> SMTP configuration.</p>`,
      forceConfig
    });

    res.json({ message: `Test email sent to ${recipient}` });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Failed to send test email' });
  }
});

// @desc    Get email logs
// @route   GET /api/system/email-logs
// @access  Private/Admin
router.get('/email-logs', protect, admin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 300);
    const query = {};
    if (req.user.role !== 'Super Admin' && req.user.assignedStore) {
      query.store = req.user.assignedStore;
    } else if (req.query.storeId) {
      query.store = req.query.storeId;
    }
    const logs = await EmailLog.find(query).sort({ createdAt: -1 }).limit(limit).populate('store', 'name').lean();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get notification preferences
// @route   GET /api/system/notification-preferences
// @access  Private/Admin
router.get('/notification-preferences', protect, admin, async (req, res) => {
  try {
    const targetUserId = req.user.role === 'Super Admin' ? (req.query.userId || req.user._id) : req.user._id;
    const targetUser = await User.findById(targetUserId).select('notificationPreferences role email name').lean();
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    const prefs = targetUser.notificationPreferences || {};
    res.json({
      userId: targetUser._id,
      userRole: targetUser.role,
      email: targetUser.email,
      name: targetUser.name,
      notificationPreferences: {
        enabled: prefs.enabled !== false,
        notifyReceiver: prefs.notifyReceiver !== false,
        notifyIssuer: prefs.notifyIssuer !== false,
        notifyLineManager: Boolean(prefs.notifyLineManager)
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Update notification preferences
// @route   PUT /api/system/notification-preferences
// @access  Private/Admin
router.put('/notification-preferences', protect, admin, async (req, res) => {
  try {
    const targetUserId = req.user.role === 'Super Admin' ? (req.body.userId || req.user._id) : req.user._id;
    const {
      enabled = true,
      notifyReceiver = true,
      notifyIssuer = true,
      notifyLineManager = false
    } = req.body || {};

    const updated = await User.findByIdAndUpdate(
      targetUserId,
      {
        $set: {
          notificationPreferences: {
            enabled: Boolean(enabled),
            notifyReceiver: Boolean(notifyReceiver),
            notifyIssuer: Boolean(notifyIssuer),
            notifyLineManager: Boolean(notifyLineManager)
          }
        }
      },
      { new: true }
    ).select('notificationPreferences role email name');

    if (!updated) return res.status(404).json({ message: 'User not found' });

    res.json({
      message: 'Notification preferences updated',
      userId: updated._id,
      userRole: updated.role,
      email: updated.email,
      name: updated.name,
      notificationPreferences: updated.notificationPreferences
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Request database reset (Store Admin)
// @route   POST /api/system/request-reset
// @access  Private/Admin
router.post('/request-reset', protect, admin, async (req, res) => {
  try {
    // If Super Admin, they can just use /reset. This is for Store Admins.
    if (req.user.role === 'Super Admin') {
      return res.status(400).json({ message: 'Super Admin should use the main reset function.' });
    }

    if (!req.user.assignedStore) {
      return res.status(400).json({ message: 'No assigned store found for this admin.' });
    }

    const store = await Store.findById(req.user.assignedStore);
    if (!store) {
      return res.status(404).json({ message: 'Store not found.' });
    }

    store.deletionRequested = true;
    store.deletionRequestedAt = new Date();
    store.deletionRequestedBy = `${req.user.name} (${req.user.email})`;
    await store.save();

    // Log the request
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'System Reset Request',
      details: `Deletion requested for Store: ${store.name}`,
      store: store._id
    });

    res.json({ message: 'Deletion request submitted to Super Admin.' });
  } catch (error) {
    console.error('Error requesting reset:', error);
    res.status(500).json({ message: error.message });
  }
});

// @desc    Reset database (keep users)
// @route   POST /api/system/reset
// @access  Private/SuperAdmin
router.post('/reset', protect, superAdmin, async (req, res) => {
  const { password, storeId, includeUsers } = req.body;
  
  if (!password) {
    return res.status(400).json({ message: 'Password is required' });
  }

  try {
    if (RESET_LOCK) {
      return res.status(429).json({ message: 'Another reset is in progress. Please wait and try again.' });
    }
    RESET_LOCK = true;

    // Verify admin password
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    // Safety Check: Require explicit storeId
    if (!storeId) {
      return res.status(400).json({ message: 'Safety Error: storeId is required. Use "all" for full reset.' });
    }

    let filter = {};
    let resetScope = "Full System";

    if (storeId !== 'all') {
      filter = { store: storeId };
      resetScope = `Store: ${storeId}`;
    }
    // If storeId === 'all', filter remains {} (Delete All)

    // Handle User Deletion if requested
    if (includeUsers) {
      const userFilter = { ...filter };
      // NEVER delete Super Admin accounts
      userFilter.role = { $ne: 'Super Admin' };
      
      // If specific store reset, we target users assigned to that store
      if (storeId !== 'all') {
        userFilter.assignedStore = storeId;
      }

      await User.deleteMany(userFilter);
    }

    // Clear collections
    // NOTE: We intentionally preserve 'User' (Admins/Technicians), 'Store' (Definitions), and 'AssetCategory' (Configuration)
    // as per requirements to only delete "operational/transactional" data.
    // Delete sequentially to reduce transient failures
    const deleted = {};
    deleted.assets = await Asset.deleteMany(filter);
    deleted.requests = await Request.deleteMany(filter);
    deleted.activityLogs = await ActivityLog.deleteMany(filter);
    deleted.purchaseOrders = await PurchaseOrder.deleteMany(filter);
    deleted.vendors = await Vendor.deleteMany(filter);
    deleted.passes = await Pass.deleteMany(filter);
    deleted.permits = await Permit.deleteMany(filter);

    // Reset deletionRequested flag if a specific store was reset
    if (storeId && storeId !== 'all') {
      await Store.findByIdAndUpdate(storeId, { 
        deletionRequested: false, 
        deletionRequestedAt: null,
        deletionRequestedBy: null
      });
    }

    // Optional: Clear uploads folder except .gitkeep
    // Only if full reset? Or if we track file ownership by store?
    // Currently file ownership isn't strictly tracked by store in filesystem structure, 
    // but referenced in DB.
    // If we delete DB records, files become orphans.
    // For specific store reset, cleaning files is hard without scanning all records.
    // Let's skip file cleanup for store-specific reset to be safe, 
    // or only do it for full reset.
    if (!storeId || storeId === 'all') {
        const uploadsPath = path.join(__dirname, '../uploads');
        if (fs.existsSync(uploadsPath)) {
          const files = fs.readdirSync(uploadsPath);
          files.forEach(file => {
            if (file !== '.gitkeep') {
              try {
                fs.unlinkSync(path.join(uploadsPath, file));
              } catch (e) {
                // Ignore file deletion errors to avoid aborting reset
              }
            }
          });
        }
    }

    // Log this action (create new log)
    // If we just deleted logs for this store, this new log will start the history again.
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'System Reset',
      details: `${resetScope} reset performed (${includeUsers ? 'Users DELETED' : 'Users preserved'})`,
      store: storeId && storeId !== 'all' ? storeId : null
    });

    res.json({ 
      message: 'System reset successful',
      stats: {
        scope: resetScope,
        usersDeleted: includeUsers ? 'Yes' : 'No',
        assetsDeleted: deleted.assets?.deletedCount ?? 0,
        requestsDeleted: deleted.requests?.deletedCount ?? 0,
        logsDeleted: deleted.activityLogs?.deletedCount ?? 0,
        purchaseOrdersDeleted: deleted.purchaseOrders?.deletedCount ?? 0,
        vendorsDeleted: deleted.vendors?.deletedCount ?? 0,
        passesDeleted: deleted.passes?.deletedCount ?? 0,
        permitsDeleted: deleted.permits?.deletedCount ?? 0
      }
    });
  } catch (error) {
    console.error('Error resetting system:', error);
    res.status(500).json({ message: error.message });
  } finally {
    RESET_LOCK = false;
  }
});

// @desc    Cancel database reset request (Super Admin)
// @route   POST /api/system/cancel-reset
// @access  Private/SuperAdmin
router.post('/cancel-reset', protect, superAdmin, async (req, res) => {
  const { storeId } = req.body;
  
  if (!storeId) {
    return res.status(400).json({ message: 'Store ID is required' });
  }

  try {
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }

    store.deletionRequested = false;
    store.deletionRequestedAt = null;
    await store.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'System Reset Cancelled',
      details: `Deletion request rejected/cancelled for Store: ${store.name}`,
      store: store._id
    });

    res.json({ message: 'Reset request cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling reset:', error);
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get all stores
// @route   GET /api/system/stores
// @access  Private
router.get('/stores', protect, async (req, res) => {
  try {
    const stores = await Store.find({});
    res.json(stores);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Seed default stores
// @route   POST /api/system/seed
// @access  Private/SuperAdmin
router.post('/seed', protect, superAdmin, async (req, res) => {
  try {
    const storesData = [
      { name: 'SCY ASSET', alias: 'scy' },
      { name: 'IT ASSET', alias: 'it' },
      { name: 'NOC ASSET', alias: 'noc' }
    ];

    const results = [];

    for (const data of storesData) {
      let store = await Store.findOne({ name: data.name });
      if (!store) {
        store = await Store.create({ 
            name: data.name, 
            isMainStore: true
        });
        results.push(`Created: ${store.name}`);
      } else {
        if (!store.isMainStore) {
            store.isMainStore = true;
            await store.save();
            results.push(`Updated (set Main): ${store.name}`);
        } else {
            results.push(`Exists: ${store.name}`);
        }
      }
    }

    res.json({ message: 'Seeding complete', results });
  } catch (error) {
    console.error('Seeding error:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
