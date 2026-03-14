const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const unzipper = require('unzipper');
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
const BackupArtifact = require('../models/BackupArtifact');
const BackupLog = require('../models/BackupLog');
const bcrypt = require('bcryptjs');
const { backupDatabase } = require('../backup_db');
const Setting = require('../models/Setting');
const { sendStoreEmail, buildTransport } = require('../utils/storeEmail');
const {
  BACKUP_ROOT,
  createBackupArtifact,
  restoreBackupArtifact,
  restoreFromUploadedZip,
  createBackupLog
} = require('../utils/backupRecovery');
const ResilienceJob = require('../models/ResilienceJob');
const {
  previewRestoreToTime,
  restoreToTimestamp,
  syncShadowDatabase,
  promoteShadowToPrimary,
  failbackFromBackup,
  verifyLatestBackupRestore,
  createResilienceJob,
  updateResilienceJob,
  getResilienceStatus,
  appendJournalEntry,
  computeChecksum,
  writeUploadChecksum
} = require('../utils/resilienceManager');
const appPackage = require('../../package.json');

const maxBackupUploadMb = Number.parseInt(process.env.MAX_BACKUP_UPLOAD_MB || '1024', 10);
const MAX_BACKUP_UPLOAD_BYTES = Math.max(10, maxBackupUploadMb) * 1024 * 1024;
const backupUploadTempDir = path.join(__dirname, '../uploads/tmp-backups');
if (!fs.existsSync(backupUploadTempDir)) {
  fs.mkdirSync(backupUploadTempDir, { recursive: true });
}

const backupDiskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, backupUploadTempDir),
  filename: (req, file, cb) => {
    const safeName = String(file.originalname || 'backup.json').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
  }
});

const backupZipUpload = multer({
  storage: backupDiskStorage,
  limits: {
    fileSize: MAX_BACKUP_UPLOAD_BYTES
  },
  fileFilter: (req, file, cb) => {
    const lower = String(file.originalname || '').toLowerCase();
    const okType = lower.endsWith('.zip') || lower.endsWith('.json') || file.mimetype === 'application/zip' || file.mimetype === 'application/json' || file.mimetype === 'text/plain';
    if (!okType) {
      return cb(new Error(`Invalid file type for ${file.originalname}. Allowed: .zip, .json`));
    }
    cb(null, true);
  }
});

const backupUpload = multer({
  storage: backupDiskStorage,
  limits: {
    fileSize: MAX_BACKUP_UPLOAD_BYTES
  },
  fileFilter: (req, file, cb) => {
    const okType = file.mimetype === 'application/json' || file.mimetype === 'text/plain' || file.originalname.toLowerCase().endsWith('.json');
    if (!okType) {
      return cb(new Error(`Invalid file type for ${file.originalname}. Only .json backups are allowed.`));
    }
    cb(null, true);
  }
});
const bulkUpload = multer({
  storage: backupDiskStorage,
  limits: {
    fileSize: MAX_BACKUP_UPLOAD_BYTES
  },
  fileFilter: (req, file, cb) => {
    const okType = file.mimetype === 'application/json' || file.mimetype === 'text/plain' || file.originalname.toLowerCase().endsWith('.json');
    if (!okType) {
      return cb(new Error(`Invalid file type for ${file.originalname}. Only .json backups are allowed.`));
    }
    cb(null, true);
  }
});

const handleUpload = (uploader) => (req, res, next) => {
  uploader.single('backup')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: `Backup file is too large. Maximum size is ${Math.floor(MAX_BACKUP_UPLOAD_BYTES / (1024 * 1024))} MB.` });
      }
      return res.status(400).json({ message: error.message || 'Upload failed' });
    }
    return res.status(400).json({ message: error.message || 'Upload failed' });
  });
};

const parseUploadedBackupPayload = async (file) => {
  if (!file?.path) throw new Error('Uploaded backup file path is missing');
  const content = await fs.promises.readFile(file.path, 'utf8');
  const normalizedContent = String(content || '').replace(/^\uFEFF/, '');
  if (!normalizedContent.trim()) {
    throw new Error('Backup file is empty');
  }
  return JSON.parse(normalizedContent);
};

const normalizeBackupCollections = (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid backup format. Expected a JSON object.');
  }

  if (payload.collections && typeof payload.collections === 'object') {
    return payload.collections;
  }

  // Backward compatibility: legacy backup shape with top-level arrays.
  const legacyKeys = [
    'users',
    'stores',
    'assets',
    'requests',
    'activityLogs',
    'purchaseOrders',
    'vendors',
    'passes',
    'permits',
    'assetCategories'
  ];
  const hasLegacyShape = legacyKeys.some((key) => Array.isArray(payload[key]));
  if (hasLegacyShape) {
    const normalized = {};
    legacyKeys.forEach((key) => {
      normalized[key] = Array.isArray(payload[key]) ? payload[key] : [];
    });
    return normalized;
  }

  if (typeof payload.message === 'string' && payload.message.length > 0) {
    throw new Error(`This file appears to be an error response, not a backup file: ${payload.message}`);
  }

  throw new Error('Invalid backup format. Expected an Expo backup JSON file.');
};

const getBackupAssetsFromPayload = (payload) => {
  const collections = normalizeBackupCollections(payload);
  return Array.isArray(collections.assets) ? collections.assets : [];
};

const getBackupCollectionsFromPayload = (payload) => {
  return normalizeBackupCollections(payload);
};

const parseMajorVersion = (version) => {
  const v = String(version || '').trim();
  const major = Number.parseInt(v.split('.')[0], 10);
  return Number.isFinite(major) ? major : null;
};

const buildVersionCompatibility = (sourceVersion) => {
  const currentVersion = appPackage.version || 'unknown';
  const sourceMajor = parseMajorVersion(sourceVersion);
  const currentMajor = parseMajorVersion(currentVersion);
  if (sourceMajor === null || currentMajor === null) {
    return {
      currentVersion,
      sourceVersion: sourceVersion || 'unknown',
      status: 'warning',
      reason: 'Could not parse semantic versions; proceed with caution.'
    };
  }
  if (sourceMajor > currentMajor) {
    return {
      currentVersion,
      sourceVersion: sourceVersion || 'unknown',
      status: 'blocked',
      reason: 'Backup is from a newer major app version and cannot be safely restored.'
    };
  }
  if (sourceMajor < currentMajor) {
    return {
      currentVersion,
      sourceVersion: sourceVersion || 'unknown',
      status: 'warning',
      reason: 'Backup is from an older major app version. Compatibility migration may be required.'
    };
  }
  return {
    currentVersion,
    sourceVersion: sourceVersion || 'unknown',
    status: 'safe',
    reason: 'Major app versions match.'
  };
};

const summarizeCollections = (collections = {}) => {
  const names = [
    'users',
    'stores',
    'assets',
    'requests',
    'activityLogs',
    'purchaseOrders',
    'vendors',
    'passes',
    'permits',
    'assetCategories'
  ];
  const out = {};
  names.forEach((name) => {
    out[name] = Array.isArray(collections[name]) ? collections[name].length : 0;
  });
  return out;
};

const validateJsonBackupPayload = (payload) => {
  const collections = getBackupCollectionsFromPayload(payload);
  const counts = summarizeCollections(collections);
  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
  const sourceVersion = payload?.meta?.app_version || payload?.meta?.appVersion || 'unknown';
  const version = buildVersionCompatibility(sourceVersion);
  let status = version.status;
  const issues = [];
  if (totalRecords === 0) {
    status = 'blocked';
    issues.push('Backup contains zero records across all tracked collections.');
  }
  if (!payload?.collections && !payload?.users && !payload?.assets && !payload?.stores) {
    status = 'blocked';
    issues.push('Backup does not match supported JSON backup shapes.');
  }
  return {
    ok: status !== 'blocked',
    status,
    format: 'json',
    backupType: payload?.meta?.backup_type || payload?.meta?.backupType || 'unknown',
    version,
    issues,
    summary: {
      totalRecords,
      collections: counts
    }
  };
};

const validateZipBackupFile = async (zipFilePath) => {
  const zip = await unzipper.Open.file(zipFilePath);
  const files = new Set(zip.files.map((f) => f.path));
  const hasPath = (p) => files.has(p);
  const findPath = (candidates = []) => candidates.find((p) => hasPath(p)) || '';
  const metaPath = findPath(['backup/meta.json', 'meta.json']);
  const ndjsonPath = findPath(['backup/database.ndjson', 'database.ndjson']);
  const jsonPath = findPath(['backup/database.json', 'database.json']);
  const hasMeta = Boolean(metaPath);
  const hasDatabaseNdjson = Boolean(ndjsonPath);
  const hasDatabaseJson = Boolean(jsonPath);
  const hasFilesDir = Array.from(files).some((f) => f.startsWith('backup/files/') || f.startsWith('files/'));
  const issues = [];
  let status = 'safe';
  let meta = {};
  const escalate = (next) => {
    if (next === 'blocked') {
      status = 'blocked';
      return;
    }
    if (next === 'warning' && status !== 'blocked') {
      status = 'warning';
    }
  };

  if (!hasDatabaseNdjson && !hasDatabaseJson) {
    escalate('blocked');
    issues.push('Missing database export in zip (expected database.ndjson or database.json).');
  } else if (!hasDatabaseNdjson && hasDatabaseJson) {
    escalate('warning');
    issues.push('Using legacy database.json backup format. Restore is supported with compatibility mode.');
  }
  if (!hasMeta) {
    escalate('warning');
    issues.push('Missing meta.json. Version compatibility cannot be fully verified.');
  } else {
    const metaEntry = zip.files.find((f) => f.path === metaPath);
    try {
      meta = JSON.parse((await metaEntry.buffer()).toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      escalate('warning');
      issues.push('meta.json exists but could not be parsed.');
    }
  }
  if (!hasFilesDir) {
    escalate('warning');
    issues.push('No backup/files directory found. Uploaded media/documents may not be restored.');
  }

  const sourceVersion = meta?.app_version || meta?.appVersion || 'unknown';
  const version = buildVersionCompatibility(sourceVersion);
  escalate(version.status);

  return {
    ok: status !== 'blocked',
    status,
    format: 'zip',
    backupType: meta?.backup_type || meta?.backupType || 'unknown',
    version,
    issues,
    summary: {
      containsDatabase: hasDatabaseNdjson || hasDatabaseJson,
      databaseFormat: hasDatabaseNdjson ? 'ndjson' : (hasDatabaseJson ? 'json' : 'none'),
      containsFiles: hasFilesDir,
      fileCount: files.size
    }
  };
};

const cleanupUploadedBackupFile = async (file) => {
  if (!file?.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch {
    // Best-effort cleanup
  }
};

const heavyOpsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many heavy operations. Please try again later.' }
});

// Branding logo upload (disk storage)
const brandingDir = path.join(__dirname, '../uploads/branding');
if (!fs.existsSync(brandingDir)) {
  fs.mkdirSync(brandingDir, { recursive: true });
}
const allowedMime = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/webp'
]);
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
      const mime = String(file.mimetype || '').toLowerCase();
      const ext = path.extname(String(file.originalname || '')).toLowerCase();
      const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp']);
      if (!allowedMime.has(mime) && !allowedExt.has(ext)) {
        return cb(new Error('Invalid file type. Allowed: PNG, JPG/JPEG, SVG, WEBP'));
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
const UPLOAD_SESSIONS = new Map();

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
router.post('/backup', protect, admin, heavyOpsLimiter, async (req, res) => {
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

// @desc    Create backup artifact (zip) and store metadata
// @route   POST /api/system/backups/create
// @access  Private/SuperAdmin
router.post('/backups/create', protect, superAdmin, heavyOpsLimiter, async (req, res) => {
  try {
    const requestedType = String(req.body?.backupType || 'Full').toLowerCase();
    const backupType = requestedType === 'incremental' ? 'Incremental' : (requestedType === 'auto' ? 'Auto' : 'Full');
    const trigger = String(req.body?.trigger || 'manual');
    const artifact = await createBackupArtifact({
      backupType,
      trigger,
      user: req.user
    });
    res.status(201).json({
      message: `${backupType} backup created successfully`,
      backup: artifact
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create backup' });
  }
});

// @desc    List backup artifacts
// @route   GET /api/system/backups
// @access  Private/SuperAdmin
router.get('/backups', protect, superAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number.parseInt(String(req.query.limit || '100'), 10) || 100, 500);
    const backups = await BackupArtifact.find({}).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(backups);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to list backups' });
  }
});

// @desc    Download backup artifact
// @route   GET /api/system/backups/:id/download
// @access  Private/SuperAdmin
router.get('/backups/:id/download', protect, superAdmin, async (req, res) => {
  try {
    const backup = await BackupArtifact.findById(req.params.id).lean();
    if (!backup) return res.status(404).json({ message: 'Backup not found' });
    if (!backup.filePath || !fs.existsSync(backup.filePath)) {
      return res.status(404).json({ message: 'Backup file does not exist on server' });
    }
    res.download(backup.filePath, backup.fileName);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to download backup' });
  }
});

// @desc    Delete backup artifact
// @route   DELETE /api/system/backups/:id
// @access  Private/SuperAdmin
router.delete('/backups/:id', protect, superAdmin, heavyOpsLimiter, async (req, res) => {
  try {
    const backup = await BackupArtifact.findById(req.params.id);
    if (!backup) return res.status(404).json({ message: 'Backup not found' });
    if (backup.filePath && fs.existsSync(backup.filePath)) {
      await fs.promises.unlink(backup.filePath);
    }
    await BackupArtifact.deleteOne({ _id: backup._id });
    await createBackupLog({
      action: 'backup_deleted',
      backupId: backup._id,
      backupName: backup.name,
      user: req.user,
      details: `Backup deleted: ${backup.fileName}`
    });
    res.json({ message: 'Backup deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete backup' });
  }
});

// @desc    Restore from backup artifact
// @route   POST /api/system/backups/:id/restore
// @access  Private/SuperAdmin
router.post('/backups/:id/restore', protect, superAdmin, heavyOpsLimiter, async (req, res) => {
  try {
    const backup = await BackupArtifact.findById(req.params.id);
    if (!backup) return res.status(404).json({ message: 'Backup not found' });
    if (!backup.filePath || !fs.existsSync(backup.filePath)) {
      return res.status(404).json({ message: 'Backup file does not exist on server' });
    }
    await BackupArtifact.updateOne({ _id: backup._id }, { $set: { status: 'restoring' } });
    await restoreBackupArtifact({ backupArtifact: backup, user: req.user, createSafetyBackup: true });
    await BackupArtifact.updateOne({ _id: backup._id }, { $set: { status: 'ready' } });
    res.json({ message: 'System restore completed successfully' });
  } catch (error) {
    await BackupArtifact.updateOne({ _id: req.params.id }, { $set: { status: 'failed' } }).catch(() => {});
    res.status(500).json({ message: error.message || 'Restore failed' });
  }
});

// @desc    Upload zip/json backup and restore
// @route   POST /api/system/backups/upload-restore
// @access  Private/SuperAdmin
router.post('/backups/upload-restore', protect, superAdmin, heavyOpsLimiter, handleUpload(backupZipUpload), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Backup file is required' });
  }
  try {
    const checksum = await computeChecksum(req.file.path);
    await writeUploadChecksum({
      checksum,
      fileName: req.file.originalname || req.file.filename,
      sizeBytes: req.file.size || 0
    });
    const lower = String(req.file.originalname || '').toLowerCase();
    if (lower.endsWith('.zip') || req.file.mimetype === 'application/zip') {
      await restoreFromUploadedZip({ zipPath: req.file.path, user: req.user });
      return res.json({ message: 'System restore completed successfully', checksum });
    }
    // Fallback: keep legacy JSON restore compatibility via existing route behavior
    const payload = await parseUploadedBackupPayload(req.file);
    const collections = getBackupCollectionsFromPayload(payload);
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
    return res.json({ message: 'Legacy JSON restore completed successfully', checksum });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Restore failed' });
  } finally {
    await cleanupUploadedBackupFile(req.file);
  }
});

// @desc    Validate uploaded backup compatibility (pre-restore)
// @route   POST /api/system/backups/validate-upload
// @access  Private/SuperAdmin
router.post('/backups/validate-upload', protect, superAdmin, heavyOpsLimiter, handleUpload(backupZipUpload), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Backup file is required' });
  }
  try {
    const lower = String(req.file.originalname || '').toLowerCase();
    let report;
    if (lower.endsWith('.zip') || req.file.mimetype === 'application/zip') {
      report = await validateZipBackupFile(req.file.path);
    } else {
      const payload = await parseUploadedBackupPayload(req.file);
      report = validateJsonBackupPayload(payload);
    }
    return res.json({
      message: report.ok ? 'Backup validation completed' : 'Backup validation failed',
      report
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Failed to validate backup file' });
  } finally {
    await cleanupUploadedBackupFile(req.file);
  }
});

// @desc    Emergency restore from latest full backup
// @route   POST /api/system/backups/emergency-restore
// @access  Private/SuperAdmin
router.post('/backups/emergency-restore', protect, superAdmin, heavyOpsLimiter, async (req, res) => {
  try {
    const latestFull = await BackupArtifact.findOne({ backupType: 'Full', status: 'ready' }).sort({ createdAt: -1 });
    if (!latestFull) return res.status(404).json({ message: 'No full backup found' });
    await restoreBackupArtifact({ backupArtifact: latestFull, user: req.user, createSafetyBackup: true });
    res.json({ message: 'Emergency restore completed', backupId: latestFull._id });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Emergency restore failed' });
  }
});

// @desc    Backup operation logs
// @route   GET /api/system/backup-logs
// @access  Private/SuperAdmin
router.get('/backup-logs', protect, superAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number.parseInt(String(req.query.limit || '100'), 10) || 100, 500);
    const logs = await BackupLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to fetch backup logs' });
  }
});

// @desc    Get cloud backup configuration
// @route   GET /api/system/backup-cloud-config
// @access  Private/SuperAdmin
router.get('/backup-cloud-config', protect, superAdmin, async (req, res) => {
  try {
    const doc = await Setting.findOne({ key: 'backupCloudConfig' }).lean();
    const value = doc?.value || {};
    res.json({
      ...value,
      // Never expose raw secrets to client
      secretAccessKey: value.secretAccessKey ? '********' : '',
      serviceRoleKey: value.serviceRoleKey ? '********' : ''
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load cloud backup config' });
  }
});

// @desc    Update cloud backup configuration
// @route   PUT /api/system/backup-cloud-config
// @access  Private/SuperAdmin
router.put('/backup-cloud-config', protect, superAdmin, async (req, res) => {
  try {
    const existing = await Setting.findOne({ key: 'backupCloudConfig' }).lean();
    const previous = existing?.value || {};
    const payload = req.body || {};
    const merged = {
      enabled: Boolean(payload.enabled),
      provider: payload.provider || '',
      bucket: payload.bucket || '',
      region: payload.region || '',
      endpoint: payload.endpoint || '',
      accessKeyId: payload.accessKeyId || previous.accessKeyId || '',
      secretAccessKey: payload.secretAccessKey && payload.secretAccessKey !== '********' ? payload.secretAccessKey : (previous.secretAccessKey || ''),
      forcePathStyle: Boolean(payload.forcePathStyle),
      url: payload.url || previous.url || '',
      serviceRoleKey: payload.serviceRoleKey && payload.serviceRoleKey !== '********' ? payload.serviceRoleKey : (previous.serviceRoleKey || '')
    };
    await Setting.updateOne(
      { key: 'backupCloudConfig' },
      { $set: { value: merged, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ message: 'Cloud backup config updated' });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Failed to update cloud config' });
  }
});

// @desc    Restore database from uploaded backup file
// @route   POST /api/system/restore-from-file
// @access  Private/SuperAdmin
router.post('/restore-from-file', protect, superAdmin, heavyOpsLimiter, handleUpload(backupUpload), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Backup file is required' });
  }

  try {
    const payload = await parseUploadedBackupPayload(req.file);
    const collections = getBackupCollectionsFromPayload(payload);

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
  } finally {
    await cleanupUploadedBackupFile(req.file);
  }
});

// @desc    Scan backup file and detect duplicate conflicts
// @route   POST /api/system/backup-upload/scan
// @access  Private/SuperAdmin
router.post('/backup-upload/scan', protect, superAdmin, heavyOpsLimiter, handleUpload(bulkUpload), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Backup file is required' });
  }

  try {
    const payload = await parseUploadedBackupPayload(req.file);
    const assets = getBackupAssetsFromPayload(payload);
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
  } finally {
    await cleanupUploadedBackupFile(req.file);
  }
});

// @desc    Apply conflict resolution for scanned backups
// @route   POST /api/system/backup-upload/apply
// @access  Private/SuperAdmin
router.post('/backup-upload/apply', protect, superAdmin, heavyOpsLimiter, async (req, res) => {
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
router.post('/reset', protect, superAdmin, heavyOpsLimiter, async (req, res) => {
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

// @desc    Get resilience status snapshot
// @route   GET /api/system/resilience/status
// @access  Private/SuperAdmin
router.get('/resilience/status', protect, superAdmin, async (req, res) => {
  try {
    const status = await getResilienceStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load resilience status' });
  }
});

// @desc    Preview restore-to-time impact
// @route   POST /api/system/resilience/restore-to-time/preview
// @access  Private/SuperAdmin
router.post('/resilience/restore-to-time/preview', protect, superAdmin, async (req, res) => {
  try {
    const ts = String(req.body?.targetTimestamp || '').trim();
    if (!ts) return res.status(400).json({ message: 'targetTimestamp is required' });
    const targetDate = new Date(ts);
    if (Number.isNaN(targetDate.getTime())) return res.status(400).json({ message: 'Invalid targetTimestamp' });
    const preview = await previewRestoreToTime(targetDate);
    res.json(preview);
  } catch (error) {
    res.status(400).json({ message: error.message || 'Failed to preview restore-to-time' });
  }
});

// @desc    Apply restore-to-time
// @route   POST /api/system/resilience/restore-to-time/apply
// @access  Private/SuperAdmin
router.post('/resilience/restore-to-time/apply', protect, superAdmin, heavyOpsLimiter, async (req, res) => {
  let job = null;
  try {
    const ts = String(req.body?.targetTimestamp || '').trim();
    if (!ts) return res.status(400).json({ message: 'targetTimestamp is required' });
    const targetDate = new Date(ts);
    if (Number.isNaN(targetDate.getTime())) return res.status(400).json({ message: 'Invalid targetTimestamp' });

    job = await createResilienceJob({
      jobType: 'restore_to_time',
      actor: req.user,
      metadata: { targetTimestamp: targetDate.toISOString() }
    });
    await updateResilienceJob(job._id, { phase: 'validating', status: 'running' });
    const preview = await previewRestoreToTime(targetDate);
    await updateResilienceJob(job._id, { phase: 'restoring', metadata: { ...job.metadata, preview } });
    const result = await restoreToTimestamp({ targetDate, user: req.user });
    await updateResilienceJob(job._id, { phase: 'verifying' });
    await verifyLatestBackupRestore().catch(() => {});
    await updateResilienceJob(job._id, { status: 'done', phase: 'done', finishedAt: new Date() });
    res.json({ message: 'Restore-to-time completed', jobId: job._id, result });
  } catch (error) {
    if (job?._id) {
      await updateResilienceJob(job._id, { status: 'failed', phase: 'failed', error: error.message || String(error), finishedAt: new Date() });
    }
    res.status(500).json({ message: error.message || 'Restore-to-time failed' });
  }
});

// @desc    Sync shadow database
// @route   POST /api/system/resilience/shadow/sync
// @access  Private/SuperAdmin
router.post('/resilience/shadow/sync', protect, superAdmin, async (req, res) => {
  let job = null;
  try {
    const fullResync = Boolean(req.body?.fullResync);
    job = await createResilienceJob({
      jobType: 'shadow_sync',
      actor: req.user,
      metadata: { fullResync }
    });
    await updateResilienceJob(job._id, { phase: 'syncing' });
    const shadow = await syncShadowDatabase({ fullResync, actor: req.user });
    await updateResilienceJob(job._id, { status: 'done', phase: 'done', finishedAt: new Date() });
    res.json({ message: fullResync ? 'Full shadow resync completed' : 'Shadow incremental sync completed', shadow, jobId: job._id });
  } catch (error) {
    if (job?._id) {
      await updateResilienceJob(job._id, { status: 'failed', phase: 'failed', error: error.message || String(error), finishedAt: new Date() });
    }
    res.status(500).json({ message: error.message || 'Shadow sync failed' });
  }
});

// @desc    Promote shadow DB to primary
// @route   POST /api/system/resilience/shadow/promote
// @access  Private/SuperAdmin
router.post('/resilience/shadow/promote', protect, superAdmin, heavyOpsLimiter, async (req, res) => {
  let job = null;
  try {
    const confirm = String(req.body?.confirm || '').trim().toUpperCase();
    if (confirm !== 'PROMOTE') {
      return res.status(400).json({ message: 'Confirmation token required: PROMOTE' });
    }
    job = await createResilienceJob({ jobType: 'shadow_promote', actor: req.user });
    await updateResilienceJob(job._id, { phase: 'restoring' });
    await promoteShadowToPrimary({ actor: req.user });
    await updateResilienceJob(job._id, { status: 'done', phase: 'done', finishedAt: new Date() });
    res.json({ message: 'Shadow promoted to primary successfully', jobId: job._id });
  } catch (error) {
    if (job?._id) {
      await updateResilienceJob(job._id, { status: 'failed', phase: 'failed', error: error.message || String(error), finishedAt: new Date() });
    }
    res.status(500).json({ message: error.message || 'Shadow promotion failed' });
  }
});

// @desc    Failback from selected/latest backup
// @route   POST /api/system/resilience/shadow/failback
// @access  Private/SuperAdmin
router.post('/resilience/shadow/failback', protect, superAdmin, heavyOpsLimiter, async (req, res) => {
  let job = null;
  try {
    const backupId = req.body?.backupId || null;
    job = await createResilienceJob({ jobType: 'shadow_failback', actor: req.user, metadata: { backupId } });
    await updateResilienceJob(job._id, { phase: 'restoring' });
    const restored = await failbackFromBackup({ backupId, actor: req.user });
    await updateResilienceJob(job._id, { status: 'done', phase: 'done', finishedAt: new Date() });
    res.json({ message: 'Failback completed successfully', backupId: restored?._id || null, jobId: job._id });
  } catch (error) {
    if (job?._id) {
      await updateResilienceJob(job._id, { status: 'failed', phase: 'failed', error: error.message || String(error), finishedAt: new Date() });
    }
    res.status(500).json({ message: error.message || 'Failback failed' });
  }
});

// @desc    Run latest backup verification now
// @route   POST /api/system/resilience/verify-latest
// @access  Private/SuperAdmin
router.post('/resilience/verify-latest', protect, superAdmin, async (req, res) => {
  let job = null;
  try {
    job = await createResilienceJob({ jobType: 'verify_backup', actor: req.user });
    await updateResilienceJob(job._id, { phase: 'verifying' });
    const result = await verifyLatestBackupRestore();
    await updateResilienceJob(job._id, { status: 'done', phase: 'done', finishedAt: new Date() });
    res.json({ message: 'Backup verification completed', result, jobId: job._id });
  } catch (error) {
    if (job?._id) {
      await updateResilienceJob(job._id, { status: 'failed', phase: 'failed', error: error.message || String(error), finishedAt: new Date() });
    }
    res.status(500).json({ message: error.message || 'Backup verification failed' });
  }
});

// @desc    List resilience jobs
// @route   GET /api/system/resilience/jobs
// @access  Private/SuperAdmin
router.get('/resilience/jobs', protect, superAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number.parseInt(String(req.query.limit || '30'), 10) || 30, 200);
    const jobs = await ResilienceJob.find({}).sort({ startedAt: -1 }).limit(limit).lean();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to fetch resilience jobs' });
  }
});

// @desc    Add manual resilience marker entry
// @route   POST /api/system/resilience/marker
// @access  Private/SuperAdmin
router.post('/resilience/marker', protect, superAdmin, async (req, res) => {
  try {
    const label = String(req.body?.label || '').trim() || `marker-${Date.now()}`;
    const entry = await appendJournalEntry({
      opType: 'marker',
      collectionName: 'system',
      actor: req.user,
      metadata: {
        label,
        note: String(req.body?.note || '')
      }
    });
    res.json({ message: 'Marker added', marker: entry });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to add marker' });
  }
});

// @desc    Start resumable upload session
// @route   POST /api/system/backups/upload-session/start
// @access  Private/SuperAdmin
router.post('/backups/upload-session/start', protect, superAdmin, async (req, res) => {
  const fileName = String(req.body?.fileName || '').trim();
  const totalChunks = Number.parseInt(String(req.body?.totalChunks || '0'), 10);
  const totalSize = Number.parseInt(String(req.body?.totalSize || '0'), 10);
  if (!fileName || !Number.isFinite(totalChunks) || totalChunks <= 0) {
    return res.status(400).json({ message: 'fileName and totalChunks are required' });
  }
  const sessionId = cryptoRandomId();
  const tempPath = path.join(backupUploadTempDir, `${sessionId}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}.part`);
  UPLOAD_SESSIONS.set(sessionId, {
    sessionId,
    fileName,
    totalChunks,
    totalSize: Number.isFinite(totalSize) ? totalSize : 0,
    tempPath,
    received: new Set(),
    createdAt: Date.now()
  });
  fs.writeFileSync(tempPath, '');
  res.json({ sessionId });
});

// @desc    Upload chunk for resumable backup upload
// @route   POST /api/system/backups/upload-session/chunk
// @access  Private/SuperAdmin
router.post('/backups/upload-session/chunk', protect, superAdmin, multer({ storage: multer.memoryStorage() }).single('chunk'), async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const chunkIndex = Number.parseInt(String(req.body?.chunkIndex || '-1'), 10);
    const session = UPLOAD_SESSIONS.get(sessionId);
    if (!session) return res.status(404).json({ message: 'Upload session not found' });
    if (!req.file?.buffer) return res.status(400).json({ message: 'Chunk file is required' });
    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      return res.status(400).json({ message: 'Invalid chunk index' });
    }
    if (session.received.has(chunkIndex)) return res.json({ ok: true, duplicate: true });
    fs.appendFileSync(session.tempPath, req.file.buffer);
    session.received.add(chunkIndex);
    res.json({ ok: true, received: session.received.size, totalChunks: session.totalChunks });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Chunk upload failed' });
  }
});

// @desc    Complete resumable upload and return checksum
// @route   POST /api/system/backups/upload-session/complete
// @access  Private/SuperAdmin
router.post('/backups/upload-session/complete', protect, superAdmin, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const expectedChecksum = String(req.body?.checksum || '').trim().toLowerCase();
    const session = UPLOAD_SESSIONS.get(sessionId);
    if (!session) return res.status(404).json({ message: 'Upload session not found' });
    if (session.received.size !== session.totalChunks) {
      return res.status(400).json({ message: 'Upload incomplete: missing chunks' });
    }
    const finalName = `${Date.now()}-${session.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const finalPath = path.join(backupUploadTempDir, finalName);
    fs.renameSync(session.tempPath, finalPath);
    const checksum = await computeChecksum(finalPath);
    if (expectedChecksum && expectedChecksum !== checksum.toLowerCase()) {
      fs.unlinkSync(finalPath);
      UPLOAD_SESSIONS.delete(sessionId);
      return res.status(400).json({ message: 'Checksum mismatch for uploaded file' });
    }
    await writeUploadChecksum({
      checksum,
      fileName: session.fileName,
      sizeBytes: fs.statSync(finalPath).size
    });
    UPLOAD_SESSIONS.delete(sessionId);
    res.json({ ok: true, filePath: finalPath, checksum, fileName: session.fileName });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to finalize upload session' });
  }
});

const cryptoRandomId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

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
