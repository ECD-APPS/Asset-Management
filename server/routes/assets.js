const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const Asset = require('../models/Asset');
const Product = require('../models/Product');
const Store = require('../models/Store');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Request = require('../models/Request');
const Pass = require('../models/Pass');
const CollectionApproval = require('../models/CollectionApproval');
const AssetImportUpdateBatch = require('../models/AssetImportUpdateBatch');
const { protect, admin, restrictViewer } = require('../middleware/authMiddleware');
const ExcelJS = require('exceljs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const {
  sendStoreEmail,
  getStoreNotificationRecipients,
  getStoreNotificationSubjects
} = require('../utils/storeEmail');
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const MAX_IMPORT_UPLOAD_BYTES = Math.min(
  Math.max(15 * 1024 * 1024, (Number.parseInt(process.env.MAX_IMPORT_UPLOAD_MB || '100', 10) || 100) * 1024 * 1024),
  250 * 1024 * 1024
);
/** Hard safety cap; override with env MAX_BULK_IMPORT_ROWS (e.g. 1000000). */
const MAX_BULK_IMPORT_ROWS = Math.min(
  Math.max(20000, Number.parseInt(process.env.MAX_BULK_IMPORT_ROWS || '500000', 10) || 500000),
  2000000
);
/** Max asset objects returned in import preview JSON (full file is still validated server-side). */
const IMPORT_PREVIEW_RESPONSE_CAP = Math.min(
  Math.max(5000, Number.parseInt(process.env.IMPORT_PREVIEW_MAX_ROWS || '20000', 10) || 20000),
  100000
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_UPLOAD_BYTES }
});

 

function capitalizeWords(s) {
  if (!s) return s;
  return String(s).toUpperCase();
}

/** Flat keys only; used on create/update so nested paths cannot be injected via customFields. */
function sanitizeCustomFieldsPayload(input) {
  const out = {};
  Object.entries(input || {}).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || '').trim();
    if (!key || key.startsWith('$') || key.includes('.')) return;
    if (rawValue === null || rawValue === undefined) {
      out[key] = '';
      return;
    }
    if (typeof rawValue === 'object') {
      out[key] = JSON.stringify(rawValue);
      return;
    }
    out[key] = String(rawValue);
  });
  return out;
}

/** Bulk import / export / template column order (keep in sync with client `BULK_ASSET_EXCEL_HEADERS`). */
const BULK_ASSET_EXCEL_HEADERS = [
  'Category',
  'Product Type',
  'Product Name',
  'Unique ID',
  'ABS Code',
  'Expo Tag',
  'Model Number',
  'Quantity',
  'Serial Number',
  'MAC Address',
  'IP Address',
  'Manufacturer',
  'Ticket Number',
  'Assigned To',
  'Inbound From',
  'Outbound To',
  'PO Number',
  'Vendor Name',
  'Price',
  'RFID',
  'QR Code',
  'Store Location',
  'Status',
  'Condition',
  'Maintenance Vendor',
  'Device Group',
  'Location',
  'Product Number',
  'Operating System',
  'Specification',
  'Service Tag',
  'Assign To Department',
  'Building',
  'State Comments',
  'Remarks',
  'Comments',
  'Delivered By',
  'Delivered At'
];

const BULK_IMPORT_TEMPLATE_EMPTY_ROW = Object.fromEntries(BULK_ASSET_EXCEL_HEADERS.map((h) => [h, '']));

const BULK_TEMPLATE_SAMPLE_ROW = [
  'ACCESS CONTROL SYSTEMS',
  'LOCKS',
  'MAGNETIC LOCKS',
  'AST-88421',
  'ABS-99',
  'EXPO-001',
  'MEC-1200',
  '1',
  '1584632152',
  '',
  '10.0.10.42',
  'SIEMENS',
  'TKT-1001',
  '',
  'Logistics Hub',
  'Site Alpha',
  'PO-1001',
  'ABC TRADERS',
  '1250',
  '',
  '',
  'SCY ASSET',
  'In Store',
  'New',
  'Siemens',
  'Core Security',
  'Main Warehouse',
  'PN-12345',
  'Windows 11 Pro',
  '16GB RAM / 512GB SSD',
  'ST-88421',
  'IT Operations',
  'Block A',
  'Rack and power state verified',
  'Initial install batch',
  'Commissioned by infra team',
  'JOHN DOE',
  '2024-01-01 10:00'
];

function excelColumnLetterFromIndex1Based(n) {
  let s = '';
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

function buildAssigneeLookupMap(users) {
  const m = new Map();
  for (const u of users || []) {
    if (!u?._id) continue;
    const n = String(u.name || '').trim().toLowerCase();
    if (n) m.set(n, u._id);
    const em = String(u.email || '').trim().toLowerCase();
    if (em) m.set(em, u._id);
  }
  return m;
}

function resolveAssigneeIdFromCell(raw, lookup) {
  const s = String(raw || '').trim();
  if (!s) return null;
  return lookup.get(s.toLowerCase()) || null;
}
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toContainsRegex = (value) => new RegExp(escapeRegex(value), 'i');

/** Keep aligned with server/models/Asset.js condition.enum */
const ASSET_CONDITION_ENUM = Object.freeze([
  'New',
  'Used',
  'Faulty',
  'Repaired',
  'Workshop',
  'Under Repair/Workshop'
]);

/**
 * If the search box text clearly refers to asset condition labels, return matching enum value(s).
 * Used to filter current `condition` only and skip the broad $or (history, comments, return_request, etc.).
 */
function resolveAssetConditionEnumMatches(q) {
  const raw = String(q || '').trim();
  if (!raw) return null;
  const qLower = raw.toLowerCase();
  if (qLower.length < 2) return null;
  if ('reserved'.startsWith(qLower)) return null;

  const matches = new Set();
  for (const e of ASSET_CONDITION_ENUM) {
    const el = e.toLowerCase();
    if (el === qLower || el.startsWith(qLower)) {
      matches.add(e);
      continue;
    }
    if (qLower.length >= 4 && el.includes(qLower)) {
      matches.add(e);
    }
  }
  if (matches.size === 0) return null;
  return Array.from(matches);
}

const getScopedStoreId = (req) => String(req.activeStore || req.user?.assignedStore || '').trim();
const hasAssetStoreAccess = (req, storeId) => {
  if (req.user?.role === 'Super Admin') return true;
  const scopedStoreId = getScopedStoreId(req);
  if (!scopedStoreId) return false;
  return String(storeId || '') === scopedStoreId;
};

const hasAssetStoreAccessDeep = async (req, storeId) => {
  if (req.user?.role === 'Super Admin') return true;
  const scopedStoreId = getScopedStoreId(req);
  if (!scopedStoreId) return false;
  if (String(storeId || '') === String(scopedStoreId)) return true;
  if (!mongoose.isValidObjectId(scopedStoreId)) return false;
  const allowedIds = await getStoreIds(scopedStoreId);
  return allowedIds.some((id) => String(id) === String(storeId || ''));
};

const resolveScopedStoreName = async (req) => {
  const scoped = req.activeStore || req.user?.assignedStore || null;
  if (!scoped) return '';
  if (typeof scoped === 'object' && scoped?.name) return String(scoped.name || '');
  const scopedId = String(scoped?._id || scoped || '').trim();
  if (!mongoose.isValidObjectId(scopedId)) return '';
  const storeDoc = await Store.findById(scopedId).select('name').lean();
  return String(storeDoc?.name || '');
};

const isScyScopedContext = async (req) => {
  try {
    const name = await resolveScopedStoreName(req);
    return /(^|\s)scy(\s|$)/i.test(name) || /scy asset/i.test(name);
  } catch {
    return false;
  }
};

/** Aligns G-42, G 42, etc. with G42 (and similar spacing for Siemens) for filters & stats */
function normalizeMaintenanceVendorKeyForCompare(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_.]+/g, '');
}

/** Mongo: same normalization as normalizeMaintenanceVendorKeyForCompare (MongoDB 4.4+ $replaceAll) */
function buildMongoNormalizeMaintenanceVendorKeyExpr(inputExpr) {
  const trimmed = {
    $trim: {
      input: {
        $toString: {
          $ifNull: [inputExpr, '']
        }
      }
    }
  };
  let e = { $toLower: trimmed };
  for (const ch of ['-', ' ', '_', '.']) {
    e = { $replaceAll: { input: e, find: ch, replacement: '' } };
  }
  return e;
}

/**
 * Mongo $expr: first non-empty maintenance-related string, same cascade order as
 * client getMaintenanceVendorValue() (then vendor_name fallback). Prevents
 * matching a stale customFields value when top-level maintenance_vendor differs.
 */
function buildEffectiveMaintenanceVendorStringExpr() {
  const trimPath = (path) => ({
    $trim: { input: { $toString: { $ifNull: [path, ''] } } }
  });
  const trimGetField = (fieldName) => ({
    $trim: {
      input: {
        $toString: {
          $ifNull: [
            { $getField: { field: fieldName, input: { $ifNull: ['$customFields', {}] } } },
            ''
          ]
        }
      }
    }
  });

  let acc = trimPath('$vendor_name');
  const priorityLayers = [
    trimPath('$maintenance_vendor'),
    trimPath('$maintenanceVendor'),
    trimPath('$customFields.maintenance_vendor'),
    trimPath('$customFields.maintenance_vandor'),
    trimPath('$customFields.maintenanceVendor'),
    trimGetField('maintenance vendor'),
    trimGetField('maintenance vandor')
  ];
  for (const layer of priorityLayers) {
    acc = {
      $cond: [{ $gt: [{ $strLenCP: layer }, 0] }, layer, acc]
    };
  }
  return acc;
}

/** Query value for "Maintenance Vendor" filter = assets with no assigned vendor (UI shows "–"). */
const MAINTENANCE_VENDOR_FILTER_NONE = '__NO_MAINTENANCE_VENDOR__';

/**
 * First non-empty trimmed maintenance-related field, same candidate order as
 * client getMaintenanceVendorValue() before the vendor_name Siemens/G42 fallback.
 */
function buildFirstNonEmptyMaintenanceCandidateExpr() {
  const trimPath = (path) => ({
    $trim: { input: { $toString: { $ifNull: [path, ''] } } }
  });
  const trimGetField = (fieldName) => ({
    $trim: {
      input: {
        $toString: {
          $ifNull: [
            { $getField: { field: fieldName, input: { $ifNull: ['$customFields', {}] } } },
            ''
          ]
        }
      }
    }
  });
  const layers = [
    trimPath('$maintenance_vendor'),
    trimPath('$maintenanceVendor'),
    trimPath('$customFields.maintenance_vendor'),
    trimPath('$customFields.maintenance_vandor'),
    trimPath('$customFields.maintenanceVendor'),
    trimGetField('maintenance vendor'),
    trimGetField('maintenance vandor')
  ];
  function fold(i) {
    if (i >= layers.length) return '';
    const head = layers[i];
    if (i === layers.length - 1) {
      return { $cond: [{ $gt: [{ $strLenCP: head }, 0] }, head, ''] };
    }
    return { $cond: [{ $gt: [{ $strLenCP: head }, 0] }, head, fold(i + 1)] };
  }
  return fold(0);
}

/** Matches assets whose Maintenance Vendor column would show "–" (forgotten on import, etc.). */
function buildMaintenanceVendorMissingMatchClause() {
  const firstMaint = buildFirstNonEmptyMaintenanceCandidateExpr();
  const vnTrimmed = {
    $trim: { input: { $toString: { $ifNull: ['$vendor_name', ''] } } }
  };
  const vnNorm = buildMongoNormalizeMaintenanceVendorKeyExpr(vnTrimmed);
  const impliedFromVendorName = {
    $or: [
      { $eq: [vnNorm, 'siemens'] },
      { $eq: [vnNorm, 'g42'] }
    ]
  };
  return {
    $expr: {
      $and: [
        { $eq: [{ $strLenCP: firstMaint }, 0] },
        { $not: [impliedFromVendorName] }
      ]
    }
  };
}

/** SCY maintenance vendor filter: same effective field as UI; G-42 matches G42 */
function buildMaintenanceVendorMatchClause(maintenanceVendor) {
  const raw = String(maintenanceVendor || '').trim();
  if (raw === MAINTENANCE_VENDOR_FILTER_NONE) {
    return buildMaintenanceVendorMissingMatchClause();
  }
  const normalizedFilter = normalizeMaintenanceVendorKeyForCompare(raw);
  if (!normalizedFilter) {
    return { $expr: { $eq: [1, 0] } };
  }
  const coalesced = buildEffectiveMaintenanceVendorStringExpr();
  const normalizedField = buildMongoNormalizeMaintenanceVendorKeyExpr(coalesced);
  return {
    $expr: {
      $eq: [normalizedField, normalizedFilter]
    }
  };
}

function buildEffectiveCustomFieldStringExpr(fieldAliases = []) {
  const trimPath = (path) => ({
    $trim: { input: { $toString: { $ifNull: [path, ''] } } }
  });
  const trimGetField = (fieldName) => ({
    $trim: {
      input: {
        $toString: {
          $ifNull: [
            { $getField: { field: fieldName, input: { $ifNull: ['$customFields', {}] } } },
            ''
          ]
        }
      }
    }
  });

  let acc = '';
  for (const alias of fieldAliases) {
    const key = String(alias || '').trim();
    if (!key) continue;
    const layer = key.includes(' ')
      ? trimGetField(key)
      : trimPath(`$customFields.${key}`);
    acc = {
      $cond: [{ $gt: [{ $strLenCP: layer }, 0] }, layer, acc || '']
    };
  }
  return acc || '';
}

function buildExclusiveStatusBucketExpr() {
  return {
    $switch: {
      branches: [
        { case: { $eq: ['$disposed', true] }, then: 'Disposed' },
        { case: { $eq: ['$reserved', true] }, then: 'Reserved' },
        { case: { $in: ['$status', ['Under Repair/Workshop', 'Under Repair']] }, then: 'Under Repair/Workshop' },
        { case: { $eq: ['$status', 'Missing'] }, then: 'Missing' },
        { case: { $eq: ['$condition', 'Faulty'] }, then: 'Faulty' },
        { case: { $eq: ['$condition', 'Repaired'] }, then: 'Repaired' },
        { case: { $eq: ['$status', 'In Use'] }, then: 'In Use' }
      ],
      default: 'In Store'
    }
  };
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

/** Fast non-colliding IDs for bulk import / preview (real create path uses the same pattern). */
function createFastUniqueIdGenerator() {
  let seq = 0;
  return (assetType) => {
    seq += 1;
    const raw = String(assetType || 'AST').replace(/[^a-z0-9]/gi, '').toUpperCase();
    const prefix = (raw.slice(0, 3) || 'AST').padEnd(3, 'X');
    const ts = Date.now().toString(36).toUpperCase();
    const n = seq.toString(36).toUpperCase();
    const rand = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
    return `${prefix}${ts}${n}${rand}`;
  };
}

async function notifyAssetEvent({ asset, recipientEmail, subject, lines = [] }) {
  const configuredRecipients = await getStoreNotificationRecipients(asset?.store || null);
  const storeId = asset?.store || null;
  const subjects = await getStoreNotificationSubjects(storeId);
  const assetPrefix = subjects.asset || 'Expo City Dubai Asset Notification';
  const adminUsers = await User.find({
    role: { $in: ['Admin', 'Super Admin'] },
    $or: [
      { role: 'Super Admin' },
      { assignedStore: storeId }
    ]
  })
    .select('email')
    .lean();
  const adminRecipients = adminUsers.map((u) => String(u.email || '').trim().toLowerCase()).filter(Boolean);
  const recipients = Array.from(
    new Set([recipientEmail, ...configuredRecipients, ...adminRecipients]
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean))
  );
  if (recipients.length === 0) return;
  try {
    const safeLines = lines.filter(Boolean).map((line) => String(line));
    const scopedSubject = `${assetPrefix}: ${String(subject || 'Asset Update')}`;
    await sendStoreEmail({
      storeId: asset?.store || null,
      to: recipients.join(','),
      subject: scopedSubject,
      text: safeLines.join('\n'),
      html: `<div><p><strong>${assetPrefix}</strong></p>${safeLines.map((line) => `<p>${line}</p>`).join('')}</div>`,
      context: 'expo-city-dubai-asset-notification'
    });
  } catch (error) {
    console.error('Asset notification email error:', error.message);
  }
}

async function createAssignmentGatePass(
  {
    asset,
    allAssets,
    issuedBy,
    recipientName,
    recipientEmail,
    recipientPhone,
    recipientCompany,
    ticketNumber,
    origin,
    destination,
    justification
  },
  options = {}
) {
  const pendingAdminApproval = options.pendingAdminApproval === true;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = 'OUT';
  const todayRegex = new RegExp(`^${prefix}-${dateStr}`);
  const lastPass = await Pass.findOne({ pass_number: todayRegex }).sort({ pass_number: -1 }).lean();
  let sequence = '001';
  if (lastPass?.pass_number) {
    const lastSeq = parseInt(String(lastPass.pass_number).split('-')[2], 10);
    if (Number.isFinite(lastSeq)) {
      sequence = String(lastSeq + 1).padStart(3, '0');
    }
  }
  const passNumber = `${prefix}-${dateStr}-${sequence}`;

  const passAssets = (Array.isArray(allAssets) && allAssets.length > 0 ? allAssets : [asset]).filter(Boolean);
  const passAssetEntries = passAssets.map((a) => ({
    asset: a._id,
    name: a.name || '',
    model: a.model_number || '',
    serial_number: a.serial_number || '',
    unique_id: String(a.uniqueId || '').trim(),
    brand: a.manufacturer || '',
    asset_model: a.model_number || '',
    location: a.location || '',
    movement: 'Outbound',
    status: a.condition || 'Good',
    remarks: `Auto-created during assignment of ${a.name || 'asset'}`,
    quantity: Number(a.quantity || 1)
  }));

  const pass = await Pass.create({
    pass_number: passNumber,
    file_no: `ECD/ECT/EXITPASS/${passNumber}`,
    ticket_no: ticketNumber || '',
    type: 'Outbound',
    requested_by: String(recipientName || '').trim(),
    provided_by: pendingAdminApproval ? '' : String(issuedBy?.name || '').trim(),
    collected_by: String(recipientName || '').trim(),
    approved_by: pendingAdminApproval ? '' : String(issuedBy?.name || '').trim(),
    approvalStatus: pendingAdminApproval ? 'pending' : 'approved',
    technicianNotifyEmail: pendingAdminApproval ? String(recipientEmail || '').trim() : '',
    approvedAt: pendingAdminApproval ? undefined : new Date(),
    assets: passAssetEntries,
    issued_to: {
      name: String(recipientName || '').trim() || 'Recipient',
      company: String(recipientCompany || '').trim() || (recipientEmail ? `Email: ${recipientEmail}` : ''),
      contact: String(recipientPhone || '').trim(),
      id_number: ''
    },
    issued_by: issuedBy._id,
    destination: String(destination || recipientName || '').trim(),
    origin: String(origin || asset.location || '').trim(),
    justification: String(justification || '').trim() || `Asset assignment for ${passAssets.length} asset(s)`,
    notes: `Auto-generated gate pass for asset assignment (${passAssets.map((a) => [a.serial_number || 'N/A', a.uniqueId || ''].filter(Boolean).join(' / ')).join('; ')})`,
    store: asset.store || null
  });

  return pass;
}

const resolveAuditWhere = (asset, explicitLocation = '') => {
  const direct = String(explicitLocation || '').trim();
  if (direct) return direct;
  const fromAsset = String(asset?.location || '').trim();
  if (fromAsset) return fromAsset;
  return 'N/A';
};

const appendAssetHistory = (asset, {
  action,
  req,
  ticketNumber = '',
  details = '',
  previousStatus = '',
  previousCondition = '',
  location = '',
  storeName = '',
  status = '',
  condition = ''
} = {}) => {
  if (!asset || !action) return;
  const lastEvent = Array.isArray(asset.history) && asset.history.length > 0
    ? asset.history[asset.history.length - 1]
    : null;
  const derivedPreviousStatus = String(
    previousStatus
    || lastEvent?.status
    || asset.previous_status
    || ''
  ).trim();
  const derivedPreviousCondition = String(
    previousCondition
    || lastEvent?.condition
    || ''
  ).trim();
  const safeLocation = String(location || asset.location || '').trim();
  const derivedStoreName =
    String(storeName || asset?.store?.name || asset?.store?.store_name || '').trim();
  asset.history.push({
    action: String(action),
    ticket_number: String(ticketNumber || '').trim(),
    details: String(details || '').trim(),
    user: String(req?.user?.name || '').trim(),
    actor_email: String(req?.user?.email || '').trim(),
    actor_role: String(req?.user?.role || '').trim(),
    previous_status: derivedPreviousStatus,
    previous_condition: derivedPreviousCondition,
    status: String(status || asset.status || '').trim(),
    condition: String(condition || asset.condition || '').trim(),
    location: safeLocation,
    store_name: derivedStoreName,
    date: new Date()
  });
};

const getPublicBaseUrl = (req) => {
  const envBase = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (envBase) {
    return envBase.replace(/\/+$/, '');
  }

  const rawHost = String(req.get('host') || '').trim();
  const requestProto = String(req.protocol || 'http').trim();
  const candidate = rawHost ? `${requestProto}://${rawHost}` : '';
  const allowedOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (candidate) {
    try {
      const candidateUrl = new URL(candidate);
      const isAllowed = allowedOrigins.length === 0 || allowedOrigins.some((origin) => {
        try {
          return new URL(origin).host === candidateUrl.host;
        } catch {
          return false;
        }
      });
      if (isAllowed) return candidateUrl.origin;
    } catch {
      // fallback below
    }
  }

  if (allowedOrigins.length > 0) {
    return allowedOrigins[0].replace(/\/+$/, '');
  }
  return 'http://localhost:5000';
};

const buildCollectionApprovalHtml = ({ title, message, token, approved = false }) => {
  const safeTitle = String(title || '');
  const safeMessage = String(message || '');
  if (approved) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;"><h2 style="margin:0 0 12px 0;color:#0f172a;">${safeTitle}</h2><p style="color:#334155;margin:0;">${safeMessage}</p></div></body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;"><h2 style="margin:0 0 12px 0;color:#0f172a;">${safeTitle}</h2><p style="color:#334155;margin:0 0 16px 0;">${safeMessage}</p><a href="/api/assets/collect-approval/${token}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;padding:10px 16px;">Open Approval Page</a></div></body></html>`;
};

const excelCellToPlain = (raw, defval = '') => {
  if (raw == null) return defval;
  if (raw instanceof Date) return raw;
  if (typeof raw !== 'object') return raw;
  if (Array.isArray(raw.richText)) {
    return raw.richText.map((part) => String(part?.text || '')).join('');
  }
  if (raw.text != null) return raw.text;
  if (raw.result != null) return raw.result;
  if (raw.hyperlink) return raw.text || raw.hyperlink;
  return defval;
};

/** ExcelJS columnCount often under-reports; scan cells so trailing columns (e.g. Model Number) are not dropped. */
function detectWorksheetMaxColumn(worksheet) {
  let maxCol = 0;
  try {
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (_cell, colNumber) => {
        const n = Number(colNumber);
        if (Number.isFinite(n) && n > maxCol) maxCol = n;
      });
    });
  } catch {
    /* ignore */
  }
  return maxCol > 0 ? maxCol : Math.max(worksheet?.columnCount || 0, 1);
}

const worksheetToAoa = (worksheet, { defval = '', blankrows = false } = {}) => {
  const rows = [];
  const maxCol = detectWorksheetMaxColumn(worksheet);
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const out = [];
    let hasData = false;
    for (let c = 1; c <= maxCol; c += 1) {
      const value = excelCellToPlain(row.getCell(c).value, defval);
      if (!(value === '' || value == null)) hasData = true;
      out.push(value == null ? defval : value);
    }
    if (blankrows || hasData) rows.push(out);
  });
  return rows;
};

/** Lowercase keys → list of acceptable header strings (longer synonyms first via sort in resolver). */
const BULK_IMPORT_HEADER_SYNONYMS = {
  category: ['category', 'asset category'],
  'product type': ['product type', 'prod type', 'type'],
  'product name': ['product name', 'product description', 'item name'],
  'unique id': ['unique id', 'uniqueid', 'uid', 'asset id'],
  'abs code': ['abs code', 'abscode', 'abs'],
  'expo tag': ['expo tag', 'expotag', 'expo'],
  'model number': [
    'model number',
    'model no',
    'model no.',
    'model #',
    'model#',
    'mod. no',
    'mod no',
    'mod no.',
    'asset model',
    'modle number',
    'modal number',
    'model'
  ],
  quantity: ['quantity', 'qty', 'qnty'],
  'serial number': ['serial number', 'serial no', 'serial #', 'serial#', 's/n', 's.n', 'sr no', 'serail number', 'serial'],
  'mac address': ['mac address', 'mac', 'mac addr', 'macaddress'],
  'ip address': ['ip address', 'ip', 'ipaddr', 'ipv4'],
  manufacturer: ['manufacturer', 'mfr', 'make', 'vendor mfr'],
  'ticket number': ['ticket number', 'ticket', 'ticket #', 'ticket#', 'tkt'],
  'assigned to': ['assigned to', 'assigned_to', 'assignee', 'technician', 'user'],
  'inbound from': ['inbound from', 'inbound_from', 'inbound'],
  'outbound to': ['outbound to', 'outbound_to', 'outbound'],
  'po number': ['po number', 'po #', 'po#', 'purchase order', 'p.o.'],
  'vendor name': ['vendor name', 'vendor', 'supplier'],
  price: ['price', 'unit price', 'cost'],
  rfid: ['rfid', 'rf id'],
  'qr code': ['qr code', 'qr', 'qrcode'],
  'store location': ['store location', 'store', 'store name', 'site'],
  status: ['status', 'asset status'],
  condition: ['condition', 'cond'],
  'maintenance vendor': ['maintenance vendor', 'maintenance_vendor', 'maint vendor', 'maint. vendor', 'maintenance vandor'],
  'device group': ['device group', 'device_group', 'devicegroup', 'group'],
  location: ['location', 'physical location', 'room', 'area', 'bin'],
  'product number': ['product number', 'product no', 'product #', 'part number', 'p/n', 'pn', 'productno'],
  'operating system': ['operating system', 'os', 'o/s'],
  specification: ['specification', 'spec', 'specs'],
  'service tag': ['service tag', 'service_tag', 'svc tag', 'asset tag'],
  'assign to department': [
    'assign to department',
    'assign_to_department',
    'assign to depratment',
    'assign_to_depratment',
    'department'
  ],
  building: ['building', 'bldg'],
  'state comments': ['state comments', 'state_comments', 'state'],
  remarks: ['remarks', 'remark'],
  comments: ['comments', 'comment', 'notes'],
  'delivered by': ['delivered by', 'delivered_by', 'deliveredby'],
  'delivered at': ['delivered at', 'delivered_at', 'delivery date', 'delivered']
};

function normalizeBulkImportHeaderLabel(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/_/g, ' ');
}

function buildBulkImportColumnIndexMap(headerCells) {
  const cells = headerCells.map((c, idx) => ({
    idx,
    norm: normalizeBulkImportHeaderLabel(c)
  }));
  const used = new Set();
  const map = {};

  for (const canonical of BULK_ASSET_EXCEL_HEADERS) {
    const key = canonical.trim().toLowerCase();
    const synonyms = BULK_IMPORT_HEADER_SYNONYMS[key] || [key];
    const ordered = [...new Set([key, ...synonyms])].sort((a, b) => b.length - a.length);
    let found = -1;
    for (const syn of ordered) {
      const sn = normalizeBulkImportHeaderLabel(syn);
      if (!sn) continue;
      const hit = cells.find((h) => !used.has(h.idx) && h.norm === sn);
      if (hit) {
        found = hit.idx;
        break;
      }
    }
    if (found < 0) {
      for (const syn of ordered) {
        const sn = normalizeBulkImportHeaderLabel(syn);
        if (sn.length < 8) continue;
        const hit = cells.find(
          (h) => !used.has(h.idx) && (h.norm.startsWith(`${sn} `) || h.norm === sn || h.norm.startsWith(sn))
        );
        if (hit) {
          found = hit.idx;
          break;
        }
      }
    }
    if (found >= 0) {
      used.add(found);
      map[canonical] = found;
    }
  }
  return map;
}

function matrixToTemplateKeyedBulkRows(matrix, { defval = '', blankrows = false, minMappedHeaders = 6 } = {}) {
  if (!Array.isArray(matrix) || matrix.length < 2) return null;
  const headerCells = matrix[0] || [];
  const colMap = buildBulkImportColumnIndexMap(headerCells);
  if (Object.keys(colMap).length < minMappedHeaders) return null;
  if (colMap['Serial Number'] == null) return null;

  const body = matrix.slice(1).map((dataRow) => {
    const obj = {};
    for (const canonical of BULK_ASSET_EXCEL_HEADERS) {
      const idx = colMap[canonical];
      let val = defval;
      if (idx != null && idx >= 0 && dataRow[idx] !== undefined && dataRow[idx] !== null) {
        val = dataRow[idx];
      }
      obj[canonical] = val;
    }
    return obj;
  });
  if (blankrows) return body;
  return body.filter((record) =>
    Object.values(record).some((value) => String(value == null ? '' : value).trim() !== '')
  );
}

const BULK_IMPORT_UPDATE_COMPARE_KEYS = [
  'name', 'model_number', 'mac_address', 'manufacturer', 'ticket_number', 'po_number', 'rfid', 'qr_code',
  'status', 'condition', 'product_name', 'source', 'location', 'vendor_name', 'delivered_by_name',
  'device_group', 'inbound_from', 'outbound_to', 'expo_tag', 'abs_code', 'product_number',
  'operating_system', 'specification', 'service_tag', 'assign_to_department',
  'ip_address', 'building', 'state_comments', 'remarks', 'comments',
  'quantity', 'price'
];

const BULK_IMPORT_PRESERVE_IF_IMPORT_BLANK = new Set([
  'model_number',
  'product_number',
  'mac_address',
  'manufacturer',
  'ticket_number',
  'po_number',
  'rfid',
  'qr_code',
  'expo_tag',
  'abs_code',
  'operating_system',
  'specification',
  'service_tag',
  'device_group',
  'inbound_from',
  'outbound_to',
  'building',
  'state_comments',
  'remarks',
  'comments',
  'ip_address',
  'assign_to_department'
]);

const BULK_IMPORT_FIELD_LABELS = {
  name: 'Name',
  model_number: 'Model number',
  mac_address: 'MAC address',
  manufacturer: 'Manufacturer',
  ticket_number: 'Ticket number',
  po_number: 'PO number',
  rfid: 'RFID',
  qr_code: 'QR code',
  status: 'Status',
  condition: 'Condition',
  product_name: 'Product name',
  source: 'Source',
  location: 'Location',
  vendor_name: 'Vendor name',
  delivered_by_name: 'Delivered by',
  device_group: 'Device group',
  inbound_from: 'Inbound from',
  outbound_to: 'Outbound to',
  expo_tag: 'Expo tag',
  abs_code: 'ABS code',
  product_number: 'Product number',
  operating_system: 'Operating system',
  specification: 'Specification',
  service_tag: 'Service tag',
  assign_to_department: 'Assign to department',
  ip_address: 'IP address',
  building: 'Building',
  state_comments: 'State comments',
  remarks: 'Remarks',
  comments: 'Comments',
  quantity: 'Quantity',
  price: 'Price',
  delivered_at: 'Delivered at',
  assigned_to: 'Assigned to',
  maintenance_vendor: 'Maintenance vendor'
};

function bulkImportCellIsEmpty(v) {
  const s = String(v ?? '').trim();
  return s === '' || s === '-' || /^N\/A$/i.test(s) || s === '—';
}

function buildPatchForBulkImportUpdate(existingDoc, rowAssetData) {
  const patch = {};
  const changedFields = [];
  BULK_IMPORT_UPDATE_COMPARE_KEYS.forEach((key) => {
    const nextValue = rowAssetData[key];
    const prevValue = existingDoc[key];
    if (key === 'delivered_at') return;
    if (
      BULK_IMPORT_PRESERVE_IF_IMPORT_BLANK.has(key)
      && bulkImportCellIsEmpty(nextValue)
      && !bulkImportCellIsEmpty(prevValue)
    ) {
      return;
    }
    if (String(prevValue ?? '') !== String(nextValue ?? '')) {
      patch[key] = nextValue;
      changedFields.push(key);
    }
  });

  const incomingDeliveredAt = rowAssetData.delivered_at ? new Date(rowAssetData.delivered_at) : null;
  const existingDeliveredAt = existingDoc.delivered_at ? new Date(existingDoc.delivered_at) : null;
  if (
    incomingDeliveredAt
    && (!existingDeliveredAt || incomingDeliveredAt.getTime() !== existingDeliveredAt.getTime())
  ) {
    patch.delivered_at = incomingDeliveredAt;
    changedFields.push('delivered_at');
  }

  if (Object.prototype.hasOwnProperty.call(rowAssetData, 'assigned_to')) {
    const nextA = rowAssetData.assigned_to ? String(rowAssetData.assigned_to) : '';
    const prevA = existingDoc.assigned_to ? String(existingDoc.assigned_to) : '';
    if (nextA !== prevA) {
      patch.assigned_to = rowAssetData.assigned_to;
      changedFields.push('assigned_to');
    }
  }

  const incomingMaintenanceVendor = String(rowAssetData?.customFields?.maintenance_vendor || '').trim();
  if (incomingMaintenanceVendor) {
    const existingMaintenanceVendor = String(existingDoc?.customFields?.maintenance_vendor || '').trim();
    if (incomingMaintenanceVendor !== existingMaintenanceVendor) {
      patch.customFields = {
        ...(existingDoc.customFields && typeof existingDoc.customFields === 'object' ? existingDoc.customFields : {}),
        maintenance_vendor: incomingMaintenanceVendor
      };
      changedFields.push('maintenance_vendor');
    }
  }

  return { patch, changedFields };
}

function filterBulkImportPatchByAllowlist(fullPatch, changedFields, allowedSet) {
  if (!allowedSet) {
    return { patch: fullPatch, changedFields };
  }
  if (allowedSet.size === 0) {
    return { patch: {}, changedFields: [] };
  }
  const nextPatch = {};
  const nextChanged = [];
  for (const field of changedFields) {
    if (!allowedSet.has(field)) continue;
    if (field === 'maintenance_vendor') {
      if (fullPatch.customFields != null) {
        nextPatch.customFields = fullPatch.customFields;
        nextChanged.push('maintenance_vendor');
      }
    } else if (fullPatch[field] !== undefined) {
      nextPatch[field] = fullPatch[field];
      nextChanged.push(field);
    }
  }
  return { patch: nextPatch, changedFields: nextChanged };
}

function formatBulkImportDiffValue(field, value, assigneeById) {
  if (value == null || value === '') return '(empty)';
  if (field === 'assigned_to' && value && assigneeById) {
    const u = assigneeById.get(String(value));
    if (u) return u.name;
  }
  if (field === 'delivered_at' && value) {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (field === 'maintenance_vendor') {
    return String(value);
  }
  const s = String(value);
  if (s.length > 120) return `${s.slice(0, 117)}…`;
  return s;
}

function aoaToJsonRows(matrix, { defval = '', blankrows = false } = {}) {
  if (!Array.isArray(matrix) || matrix.length === 0) return [];
  const headers = (matrix[0] || []).map((header, idx) => {
    const normalized = String(header == null ? '' : header).trim();
    return normalized || `__EMPTY_${idx}`;
  });
  return matrix
    .slice(1)
    .map((row = []) => {
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = row[idx] == null ? defval : row[idx];
      });
      return obj;
    })
    .filter((record) => {
      if (blankrows) return true;
      return Object.values(record).some((value) => String(value == null ? '' : value).trim() !== '');
    });
}

const worksheetToJsonRows = (worksheet, options = {}) => {
  const matrix = worksheetToAoa(worksheet, { ...options, blankrows: true });
  const viaTemplate = matrixToTemplateKeyedBulkRows(matrix, options);
  if (Array.isArray(viaTemplate) && viaTemplate.length > 0) return viaTemplate;
  return aoaToJsonRows(matrix, options);
};

/** First non-empty cell across normalized header aliases (skips -, N/A). */
function readBulkTextFromNorm(norm, keys) {
  for (const k of keys) {
    const v = norm[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || s === '-' || /^N\/A$/i.test(s) || s === '—') continue;
    return s;
  }
  return '';
}

async function readUploadedWorkbook(file) {
  if (!file) {
    throw new Error('No file uploaded');
  }
  const workbook = new ExcelJS.Workbook();
  if (file.buffer) {
    await workbook.xlsx.load(file.buffer);
    return workbook;
  }
  if (file.path && fs.existsSync(file.path)) {
    const buf = fs.readFileSync(file.path);
    await workbook.xlsx.load(buf);
    return workbook;
  }
  throw new Error('Uploaded file is not readable');
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

/**
 * Map every product tree node name -> top-level root `Product.name` (Excel "Category").
 */
function buildNameToCategoryMap(productRoots) {
  const map = new Map();
  const visit = (rootName, node) => {
    if (!node || !node.name) return;
    const key = String(node.name).trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, rootName);
    (node.children || []).forEach((ch) => visit(rootName, ch));
  };
  (productRoots || []).forEach((root) => {
    if (root?.name) visit(String(root.name).trim(), root);
  });
  return map;
}

/** Mutates lean asset objects: sets `category` from customFields or product hierarchy. */
async function attachProductCategoriesToAssets(items, req) {
  if (!Array.isArray(items) || items.length === 0) return;

  const storeIds = new Set();
  for (const item of items) {
    const sid = item.store?._id || item.store;
    if (sid) storeIds.add(String(sid));
  }

  const scopedId = getScopedStoreId(req);
  if (scopedId && mongoose.isValidObjectId(scopedId)) {
    storeIds.add(String(scopedId));
  }

  const orClauses = [{ store: null }, { store: { $exists: false } }];
  for (const id of storeIds) {
    if (mongoose.isValidObjectId(id)) {
      orClauses.push({ store: new mongoose.Types.ObjectId(id) });
    }
  }

  let products = [];
  try {
    products = await Product.find({ $or: orClauses }).lean();
  } catch {
    return;
  }

  const nameToCategory = buildNameToCategoryMap(products);

  const pickCategory = (asset) => {
    const cf = asset.customFields && typeof asset.customFields === 'object' ? asset.customFields : {};
    const explicit = cf.category || cf.Category || '';
    if (String(explicit || '').trim()) return String(explicit).trim();

    const candidates = [asset.product_name, asset.name, asset.model_number];
    for (const c of candidates) {
      const k = String(c || '').trim().toLowerCase();
      if (k && nameToCategory.has(k)) return nameToCategory.get(k);
    }
    return '';
  };

  for (const item of items) {
    item.category = pickCategory(item);
  }
}

// @desc    Get assets (paginated, optional filters)
// @route   GET /api/assets
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 5000);
    const q = String(req.query.q || '').trim();
    const derivedStatus = String(req.query.derived_status || '').trim();
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
    const maintenanceVendor = String(req.query.maintenance_vendor || '').trim();
    const deviceGroup = String(req.query.device_group || '').trim();
    const inboundFrom = String(req.query.inbound_from || '').trim();
    const ipAddress = String(req.query.ip_address || '').trim();
    const building = String(req.query.building || '').trim();
    const stateComments = String(req.query.state_comments || '').trim();
    const remarks = String(req.query.remarks || '').trim();
    const comments = String(req.query.comments || '').trim();
    const reservedParam = String(req.query.reserved || '').trim().toLowerCase();
    const disposedParam = String(req.query.disposed || '').trim().toLowerCase();
    const duplicateParam = String(req.query.duplicate || '').trim().toLowerCase();

    const filter = {};
    // Exclude disposed assets by default from inventory views.
    if (disposedParam === 'all') {
      // Include both active and disposed assets.
    } else if (disposedParam === 'true') {
      filter.disposed = true;
    } else if (disposedParam === 'false') {
      filter.disposed = false;
    } else {
      filter.disposed = false;
    }
    if (q) {
      const qLowerForMode = q.toLowerCase();
      const reservedPrefixActive = qLowerForMode.length > 0 && 'reserved'.startsWith(qLowerForMode);
      let useConditionOnlySearch = false;
      if (!condition && !reservedPrefixActive) {
        const condMatches = resolveAssetConditionEnumMatches(q);
        if (condMatches && condMatches.length > 0) {
          filter.condition = condMatches.length === 1 ? condMatches[0] : { $in: condMatches };
          useConditionOnlySearch = true;
        }
      }

      if (!useConditionOnlySearch) {
      const escapedQ = escapeRegex(q);
      const rx = toContainsRegex(q);
      const orClauses = [
        { name: rx },
        { expo_tag: rx },
        { expoTag: rx },
        { abs_code: rx },
        { absCode: rx },
        { model_number: rx },
        { product_number: rx },
        { productNumber: rx },
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
        { delivered_by_name: rx },
        { device_group: rx },
        { inbound_from: rx },
        { outbound_to: rx },
        { outboundTo: rx },
        { ip_address: rx },
        { building: rx },
        { state_comments: rx },
        { remarks: rx },
        { comments: rx },
        { operating_system: rx },
        { operatingSystem: rx },
        { specification: rx },
        { service_tag: rx },
        { serviceTag: rx },
        { assign_to_department: rx },
        { assignToDepartment: rx }
      ];
      const expoTagExpr = buildEffectiveCustomFieldStringExpr(['expo_tag', 'expoTag', 'expo tag']);
      const absCodeExpr = buildEffectiveCustomFieldStringExpr(['abs_code', 'absCode', 'abs code']);
      const productNumberExpr = buildEffectiveCustomFieldStringExpr(['product_number', 'productNumber', 'product number']);
      orClauses.push({
        $expr: { $regexMatch: { input: expoTagExpr, regex: escapedQ, options: 'i' } }
      });
      orClauses.push({
        $expr: { $regexMatch: { input: absCodeExpr, regex: escapedQ, options: 'i' } }
      });
      orClauses.push({
        $expr: { $regexMatch: { input: productNumberExpr, regex: escapedQ, options: 'i' } }
      });
      const outboundToExpr = buildEffectiveCustomFieldStringExpr(['outbound_to', 'outboundTo', 'outbound to']);
      orClauses.push({
        $expr: { $regexMatch: { input: outboundToExpr, regex: escapedQ, options: 'i' } }
      });
      const operatingSystemExpr = buildEffectiveCustomFieldStringExpr([
        'operating_system',
        'operatingSystem',
        'operating system'
      ]);
      orClauses.push({
        $expr: { $regexMatch: { input: operatingSystemExpr, regex: escapedQ, options: 'i' } }
      });
      const specificationExpr = buildEffectiveCustomFieldStringExpr(['specification', 'spec']);
      orClauses.push({
        $expr: { $regexMatch: { input: specificationExpr, regex: escapedQ, options: 'i' } }
      });
      const serviceTagExpr = buildEffectiveCustomFieldStringExpr(['service_tag', 'serviceTag', 'service tag']);
      orClauses.push({
        $expr: { $regexMatch: { input: serviceTagExpr, regex: escapedQ, options: 'i' } }
      });
      const assignDeptExpr = buildEffectiveCustomFieldStringExpr([
        'assign_to_department',
        'assignToDepartment',
        'assign to department',
        'assign to depratment'
      ]);
      orClauses.push({
        $expr: { $regexMatch: { input: assignDeptExpr, regex: escapedQ, options: 'i' } }
      });

      const maintenanceVendorSearchExpr = buildEffectiveMaintenanceVendorStringExpr();
      orClauses.push({
        $expr: {
          $regexMatch: {
            input: maintenanceVendorSearchExpr,
            regex: escapedQ,
            options: 'i'
          }
        }
      });

      // Any string value in customFields (keys already covered individually above still benefit).
      orClauses.push({
        $expr: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: {
                    $objectToArray: {
                      $cond: [
                        { $eq: [{ $type: '$customFields' }, 'object'] },
                        '$customFields',
                        {}
                      ]
                    }
                  },
                  as: 'cv',
                  cond: {
                    $regexMatch: {
                      input: { $toString: '$$cv.v' },
                      regex: escapedQ,
                      options: 'i'
                    }
                  }
                }
              }
            },
            0
          ]
        }
      });

      // Do not match on history snapshot condition/status fields: a Repaired asset often still has
      // older events with previous_condition "Faulty", which wrongly satisfies q=faulty via $or.
      // Current condition/status are already covered by top-level { condition: rx }, { status: rx }.
      // Do not apply substring search on history.actor_email unless the query looks like an email:
      // e.g. q=expo matches scy@expo.com on every asset that user ever touched (false positives).
      const historyMatchOr = [
        { action: rx },
        { details: rx },
        { user: rx },
        { ticket_number: rx },
        { actor_role: rx },
        { store_name: rx },
        { location: rx }
      ];
      if (q.includes('@')) {
        historyMatchOr.push({ actor_email: rx });
      }
      orClauses.push({
        history: {
          $elemMatch: {
            $or: historyMatchOr
          }
        }
      });

      orClauses.push(
        { 'assigned_to_external.name': rx },
        { 'assigned_to_external.phone': rx },
        { 'assigned_to_external.note': rx }
      );
      if (q.includes('@')) {
        orClauses.push({ 'assigned_to_external.email': rx });
      }
      orClauses.push(
        { 'return_request.condition': rx },
        { 'return_request.ticket_number': rx },
        { 'return_request.notes': rx }
      );
      orClauses.push({ disposed_by: rx }, { disposal_reason: rx }, { importBatchId: rx });

      orClauses.push({ product_name: rx });
      orClauses.push({ reservation_note: rx });
      orClauses.push({ reserved_by: rx });
      // Reserved assets keep status "In Store"; UI shows "Reserved" from the boolean only — so substring
      // search on "r", "re", … must still return those rows for grid highlighting.
      const qLower = q.toLowerCase();
      if (qLower.length > 0 && 'reserved'.startsWith(qLower)) {
        orClauses.push({ reserved: true });
      }

      const n = Number(q);
      if (!Number.isNaN(n)) {
        orClauses.push({ quantity: n });
        orClauses.push({ price: n });
      }

      try {
        // Substring on email (e.g. q=expo) matches every *@expo.com user and floods results via assigned_to.
        // Match email only when the query looks like an address fragment (contains @).
        const userOr = [
          { name: rx },
          { phone: rx },
          { username: rx }
        ];
        if (q.includes('@')) {
          userOr.push({ email: rx });
        }
        const userHits = await User.find({ $or: userOr })
          .select('_id')
          .limit(120)
          .lean();
        const uids = userHits.map((u) => u._id).filter(Boolean);
        if (uids.length > 0) {
          orClauses.push({ assigned_to: { $in: uids } });
          orClauses.push({ 'return_request.requested_by': { $in: uids } });
        }
      } catch {
        /* ignore user search errors */
      }

      try {
        const storeRoots = await Store.find({ name: rx }).select('_id').limit(120).lean();
        const rootIds = storeRoots.map((s) => s._id).filter(Boolean);
        if (rootIds.length > 0) {
          const childStores = await Store.find({ parentStore: { $in: rootIds } }).select('_id').lean();
          const allStoreIds = [...rootIds, ...childStores.map((c) => c._id)];
          orClauses.push({ store: { $in: allStoreIds } });
        }
      } catch {
        /* ignore store search errors */
      }

      filter.$or = orClauses;
      }
    }
    if (derivedStatus) {
      const addAndClause = (clause) => {
        filter.$and = [...(filter.$and || []), clause];
      };
      const normalizedDerived = derivedStatus === 'Under Repair' ? 'Under Repair/Workshop' : derivedStatus;
      const supported = new Set(['In Store', 'In Use', 'Faulty', 'Missing', 'Disposed', 'Reserved', 'Repaired', 'Under Repair/Workshop']);
      if (supported.has(normalizedDerived)) {
        delete filter.disposed;
        delete filter.reserved;
        addAndClause({ $expr: { $eq: [buildExclusiveStatusBucketExpr(), normalizedDerived] } });
      }
    } else if (status) {
      if (status === 'In Use') {
        filter.status = 'In Use';
      } else if (status === 'In Store') {
        filter.status = 'In Store';
      } else if (status === 'Missing') {
        filter.status = 'Missing';
      } else if (status === 'Faulty') {
        filter.condition = 'Faulty';
      } else if (status === 'Disposed') {
        filter.disposed = true;
      } else if (status === 'Under Repair/Workshop') {
        filter.status = { $in: ['Under Repair/Workshop', 'Under Repair'] };
      } else if (status.includes(',')) {
        const allowed = new Set(['In Store', 'In Use', 'Missing']);
        const normalized = status.split(',').map((s) => s.trim()).filter((s) => allowed.has(s));
        if (normalized.length > 0) filter.status = { $in: normalized };
      } else {
        filter.status = status;
      }
    }

    if (deliveredBy) {
      const rxDelivered = toContainsRegex(deliveredBy);
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
            name: { $regex: escapeRegex(scope), $options: 'i' }
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
    if (manufacturer) filter.manufacturer = toContainsRegex(manufacturer);
    if (modelNumber) filter.model_number = toContainsRegex(modelNumber);
    if (serialNumber) filter.serial_number = toContainsRegex(serialNumber);
    if (macAddress) filter.mac_address = toContainsRegex(macAddress);
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
    if (ticketNumber) filter.ticket_number = toContainsRegex(ticketNumber);
    if (rfid) filter.rfid = toContainsRegex(rfid);
    if (qrCode) filter.qr_code = toContainsRegex(qrCode);
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
    if (deviceGroup) filter.device_group = toContainsRegex(deviceGroup);
    if (inboundFrom) filter.inbound_from = toContainsRegex(inboundFrom);
    if (ipAddress) filter.ip_address = toContainsRegex(ipAddress);
    if (building) filter.building = toContainsRegex(building);
    if (stateComments) filter.state_comments = toContainsRegex(stateComments);
    if (remarks) filter.remarks = toContainsRegex(remarks);
    if (comments) filter.comments = toContainsRegex(comments);
    if (maintenanceVendor) {
      const allowMaintenanceFilter = await isScyScopedContext(req);
      if (allowMaintenanceFilter) {
        filter.$and = [
          ...(filter.$and || []),
          buildMaintenanceVendorMatchClause(maintenanceVendor)
        ];
      }
    }
    if (reservedParam === 'true') {
      filter.reserved = true;
    } else if (reservedParam === 'false') {
      filter.reserved = false;
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

    let duplicateSerials = null;
    let duplicateAssetIds = null;
    if (duplicateParam === 'true') {
      const duplicateIdRows = await Asset.aggregate([
        {
          $match: {
            $and: [
              filter,
              { serial_number: { $type: 'string', $nin: [''] } }
            ]
          }
        },
        {
          $project: {
            serialKey: {
              $toString: '$serial_number'
            }
          }
        },
        { $match: { serialKey: { $ne: '' } } },
        {
          $group: {
            _id: '$serialKey',
            count: { $sum: 1 },
            ids: { $push: '$_id' }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ]);
      duplicateSerials = duplicateIdRows.map((row) => String(row._id || '')).filter(Boolean);
      duplicateAssetIds = duplicateIdRows.flatMap((row) => Array.isArray(row?.ids) ? row.ids : []);
      if (duplicateSerials.length === 0 || duplicateAssetIds.length === 0) {
        return res.json({
          items: [],
          total: 0,
          page,
          pages: 0
        });
      }
      filter._id = { $in: duplicateAssetIds };
    }

    /** Dashboard “recent activity”: skip count, duplicate scan, category hydration, heavy populate */
    const lightList =
      String(req.query.light || '').trim() === '1'
      && page === 1
      && limit <= 50
      && duplicateParam !== 'true'
      && !q;

    if (lightList) {
      const fetchedItems = await Asset.find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select('name serial_number status condition location updatedAt store')
        .populate('store', 'name')
        .lean();
      const items = Array.isArray(fetchedItems) ? fetchedItems : [];
      return res.json({
        items,
        total: items.length,
        page: 1,
        pages: 1
      });
    }

    const [total, fetchedItems] = await Promise.all([
      Asset.countDocuments(filter),
      Asset.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('name model_number serial_number serial_last_4 mac_address manufacturer ticket_number po_number rfid qr_code uniqueId store location status previous_status condition product_name assigned_to assigned_to_external return_pending return_request reserved reserved_at reserved_by reservation_note source vendor_name delivered_by_name delivered_at device_group inbound_from outbound_to expo_tag abs_code product_number operating_system specification service_tag assign_to_department ip_address building state_comments remarks comments disposed disposed_at disposed_by disposal_reason quantity price customFields history createdAt updatedAt')
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
    let items = Array.isArray(fetchedItems) ? fetchedItems : [];
    const normalizeSerialKey = (value) => String(value || '');

    // Check for duplicates in the current page items
    const serials = items.map(i => i.serial_number);
    if (serials.length > 0) {
      const duplicateSet = new Set((duplicateSerials || []).map((s) => String(s)));
      if (duplicateSet.size === 0) {
        const counts = await Asset.aggregate([
          {
            $match: {
              $and: [
                filter,
                { serial_number: { $in: serials } }
              ]
            }
          },
          { $group: { _id: '$serial_number', count: { $sum: 1 } } }
        ]);
        counts.forEach((c) => {
          if (Number(c?.count || 0) > 1) duplicateSet.add(normalizeSerialKey(c._id));
        });
      }
      
      items.forEach(item => {
        if (duplicateSet.has(normalizeSerialKey(item.serial_number))) {
          item.isDuplicate = true;
        }
      });

      // Extra safety: when duplicate filter is active, return only verified duplicates.
      if (duplicateParam === 'true') {
        items = items
          .filter((item) => duplicateSet.has(normalizeSerialKey(item.serial_number)))
          .map((item) => ({ ...item, isDuplicate: true }));
      }
    }

    await attachProductCategoriesToAssets(items, req);

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
      .select('name model_number serial_number serial_last_4 mac_address manufacturer ticket_number po_number rfid qr_code uniqueId store location status previous_status condition product_name assigned_to assigned_to_external return_pending return_request reserved reserved_at reserved_by reservation_note source vendor_name delivered_by_name delivered_at device_group inbound_from outbound_to expo_tag abs_code product_number operating_system specification service_tag assign_to_department ip_address building state_comments remarks comments disposed disposed_at disposed_by disposal_reason quantity price customFields history createdAt updatedAt')
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
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      if (!scopedStoreId) {
        return res.status(403).json({ message: 'Asset is outside your store scope' });
      }
      const scopedStoreIds = await getStoreIds(scopedStoreId);
      const scopedSet = new Set(scopedStoreIds.map((id) => String(id)));
      const assetStoreId = String(asset.store?._id || asset.store || '');
      if (!scopedSet.has(assetStoreId)) {
        return res.status(403).json({ message: 'Asset is outside your store scope' });
      }
    }
    await attachProductCategoriesToAssets([asset], req);
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
    const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escapedQ, 'i');
    if (q.length === 4) {
      query.$or = [
        { serial_last_4: q },
        { serial_number: new RegExp(`${escapedQ}`, 'i') },
        { uniqueId: rx }
      ];
    } else {
      query.$or = [
        { serial_number: rx },
        { uniqueId: rx }
      ];
    }

    const assets = await Asset.find(query)
      .select('name model_number serial_number uniqueId manufacturer store')
      .populate('store', 'name')
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
    const LOW_STOCK_THRESHOLD = 5;
    const filter = { disposed: false };
    const maintenanceVendor = String(req.query.maintenance_vendor || '').trim();
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

    if (maintenanceVendor) {
      const allowMaintenanceFilter = await isScyScopedContext(req);
      if (allowMaintenanceFilter) {
        filter.$and = [
          ...(filter.$and || []),
          buildMaintenanceVendorMatchClause(maintenanceVendor)
        ];
      }
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
      $let: {
        vars: {
          qty: {
            $convert: {
              input: '$quantity',
              to: 'double',
              onError: 1,
              onNull: 1
            }
          }
        },
        in: {
          $cond: [
            { $gt: ['$$qty', 0] },
            '$$qty',
            1
          ]
        }
      }
    };
    const toSafeLower = (field) => ({
      $toLower: {
        $trim: {
          input: {
            $toString: { $ifNull: [field, ''] }
          }
        }
      }
    });

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
    const countAssets = async (match) => Asset.countDocuments(match);

    // Parallel execution for 5x faster stats loading
    const disposedScopeFilter = { ...filter };
    delete disposedScopeFilter.disposed;

    const [
      totalAssets,
      bucketCounts,
      fleetTotalQuantity,
      lowStockCount,
      lowStockItems,
      pendingReturnsCount,
      pendingRequestsCount,
      conditionCounts,
      statusCounts,
      modelCounts,
      productCounts,
      locationCounts,
      categoryCounts,
      growthStats,
      usageBreakdownCounts,
      assetTypeCountAgg,
      maintenanceVendorCounts,
      maintenanceVendorAssetCounts
    ] = await Promise.all([
      // Total should represent full fleet (including disposed) for consistent KPI math.
      countAssets(disposedScopeFilter),
      Asset.aggregate([
        { $match: disposedScopeFilter },
        {
          $project: {
            bucket: buildExclusiveStatusBucketExpr(),
            quantity: '$quantity'
          }
        },
        { $group: { _id: '$bucket', count: { $sum: 1 }, qty: { $sum: quantityExpr } } }
      ]),
      sumQuantity(disposedScopeFilter),
      Asset.countDocuments({
        ...filter,
        quantity: { $lte: LOW_STOCK_THRESHOLD, $gte: 1 }
      }),
      Asset.find({
        ...filter,
        quantity: { $lte: LOW_STOCK_THRESHOLD, $gte: 1 }
      })
        .sort({ quantity: 1, updatedAt: -1 })
        .limit(8)
        .select('name serial_number quantity location status condition')
        .lean(),
      Asset.countDocuments({ ...filter, return_pending: true }),
      Request.countDocuments(requestFilter),
      Asset.aggregate([
        { $match: filter },
        {
          $project: {
            condBucket: {
              $switch: {
                branches: [
                  { case: { $regexMatch: { input: { $toString: { $ifNull: ['$condition', ''] } }, regex: /new/i } }, then: 'New' },
                  { case: { $regexMatch: { input: { $toString: { $ifNull: ['$condition', ''] } }, regex: /faulty/i } }, then: 'Faulty' },
                  { case: { $regexMatch: { input: { $toString: { $ifNull: ['$condition', ''] } }, regex: /repaired|workshop/i } }, then: 'Repaired' },
                  { case: { $regexMatch: { input: { $toString: { $ifNull: ['$condition', ''] } }, regex: /used/i } }, then: 'Used' }
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
                toSafeLower('$model_number'),
                toSafeLower('$product_name')
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
        { $group: { _id: toSafeLower('$product_name'), count: { $sum: quantityExpr } } },
        { $match: { _id: { $ne: '' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      Asset.aggregate([
        { $match: filter },
        { $group: { _id: toSafeLower('$location'), count: { $sum: quantityExpr } } },
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
                { $regexMatch: { input: { $toString: { $ifNull: ['$assigned_to_external.name', '' ] } }, regex: /.+/ } }
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
        { $group: { _id: toSafeLower('$model_number') } },
        { $match: { _id: { $ne: '' } } },
        { $count: 'count' }
      ]),
      // Use $addFields (not $project) so root fields like quantity remain for quantityExpr in $group.
      Asset.aggregate([
        { $match: filter },
        {
          $addFields: {
            effectiveMv: buildEffectiveMaintenanceVendorStringExpr()
          }
        },
        {
          $addFields: {
            vendorKey: buildMongoNormalizeMaintenanceVendorKeyExpr('$effectiveMv'),
            effLo: {
              $toLower: {
                $trim: {
                  input: { $toString: { $ifNull: ['$effectiveMv', ''] } }
                }
              }
            }
          }
        },
        {
          $addFields: {
            vendorBucket: {
              $switch: {
                branches: [
                  // G-42, G 42, etc. → G42 (substring /g42/ misses hyphenated forms)
                  { case: { $eq: ['$vendorKey', 'g42'] }, then: 'G42' },
                  // Keep "Siemens AG" etc. as Siemens (normalize-only would be siemensag → Other)
                  { case: { $regexMatch: { input: '$effLo', regex: /siemens/ } }, then: 'Siemens' }
                ],
                default: 'Other'
              }
            }
          }
        },
        { $group: { _id: '$vendorBucket', count: { $sum: quantityExpr } } }
      ]),
      Asset.aggregate([
        { $match: filter },
        {
          $addFields: {
            effectiveMv: buildEffectiveMaintenanceVendorStringExpr()
          }
        },
        {
          $addFields: {
            vendorKey: buildMongoNormalizeMaintenanceVendorKeyExpr('$effectiveMv'),
            effLo: {
              $toLower: {
                $trim: {
                  input: { $toString: { $ifNull: ['$effectiveMv', ''] } }
                }
              }
            }
          }
        },
        {
          $addFields: {
            vendorBucket: {
              $switch: {
                branches: [
                  { case: { $eq: ['$vendorKey', 'g42'] }, then: 'G42' },
                  { case: { $regexMatch: { input: '$effLo', regex: /siemens/ } }, then: 'Siemens' }
                ],
                default: 'Other'
              }
            }
          }
        },
        { $group: { _id: '$vendorBucket', count: { $sum: 1 } } }
      ])
    ]);

    const bucketMap = {
      'In Store': 0,
      'In Use': 0,
      Faulty: 0,
      Missing: 0,
      Disposed: 0,
      Reserved: 0,
      Repaired: 0,
      'Under Repair/Workshop': 0
    };
    bucketCounts.forEach((item) => {
      if (item?._id && Object.prototype.hasOwnProperty.call(bucketMap, item._id)) {
        bucketMap[item._id] = Number(item.count || 0);
      }
    });
    const bucketQtyMap = {
      'In Store': 0,
      'In Use': 0,
      Faulty: 0,
      Missing: 0,
      Disposed: 0,
      Reserved: 0,
      Repaired: 0,
      'Under Repair/Workshop': 0
    };
    bucketCounts.forEach((item) => {
      if (item?._id && Object.prototype.hasOwnProperty.call(bucketQtyMap, item._id)) {
        bucketQtyMap[item._id] = Number(item.qty || 0);
      }
    });
    const stats = {
      overview: {
        // Total KPI should represent ACTIVE fleet only (do not include disposed assets).
        total: Math.max(totalAssets - bucketMap.Disposed, 0),
        totalQuantity: Math.max(Number(fleetTotalQuantity || 0) - bucketQtyMap.Disposed, 0),
        inUse: bucketMap['In Use'],
        inUseQuantity: bucketQtyMap['In Use'],
        inStore: bucketMap['In Store'],
        inStoreQuantity: bucketQtyMap['In Store'],
        missing: bucketMap.Missing,
        missingQuantity: bucketQtyMap.Missing,
        disposed: bucketMap.Disposed,
        disposedQuantity: bucketQtyMap.Disposed,
        reserved: bucketMap.Reserved,
        reservedQuantity: bucketQtyMap.Reserved,
        repaired: bucketMap.Repaired,
        repairedQuantity: bucketQtyMap.Repaired,
        underRepairWorkshop: bucketMap['Under Repair/Workshop'],
        underRepairWorkshopQuantity: bucketQtyMap['Under Repair/Workshop'],
        faulty: bucketMap.Faulty,
        faultyQuantity: bucketQtyMap.Faulty,
        lowStock: Number(lowStockCount || 0),
        pendingReturns: pendingReturnsCount,
        pendingRequests: pendingRequestsCount,
        assetTypes: (assetTypeCountAgg[0] && assetTypeCountAgg[0].count) || 0,
        activeTotal: Math.max(totalAssets - bucketMap.Disposed, 0)
      },
      conditions: {
        New: 0,
        Used: 0,
        Faulty: 0,
        Repaired: 0
      },
      models: [],
      products: [],
      locations: [],
      categories: [],
      growth: growthStats.map(g => ({ name: g._id, value: g.count })),
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      lowStockItems: Array.isArray(lowStockItems) ? lowStockItems : [],
      maintenanceVendors: {
        Siemens: 0,
        G42: 0,
        Other: 0
      },
      maintenanceVendorAssets: {
        Siemens: 0,
        G42: 0,
        Other: 0
      }
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
    maintenanceVendorCounts.forEach((item) => {
      if (item?._id && Object.prototype.hasOwnProperty.call(stats.maintenanceVendors, item._id)) {
        stats.maintenanceVendors[item._id] = item.count;
      }
    });
    maintenanceVendorAssetCounts.forEach((item) => {
      if (item?._id && Object.prototype.hasOwnProperty.call(stats.maintenanceVendorAssets, item._id)) {
        stats.maintenanceVendorAssets[item._id] = item.count;
      }
    });

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
  const searchType = String(req.query?.type || req.query?.search_type || '').trim().toLowerCase();
  
  if (!query || query.trim() === '') {
    return res.json([]);
  }

  const cleanQuery = query.trim();
  // Escape special regex characters
  const escapedQuery = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  try {
    // Search using 'contains' logic.
    // searchType:
    //  - serial (default): serial_number + uniqueId
    //  - rfid: rfid
    //  - qr: qr_code
    let qObj;
    if (searchType === 'rfid') {
      qObj = { $or: [{ rfid: { $regex: new RegExp(escapedQuery, 'i') } }] };
    } else if (searchType === 'qr' || searchType === 'qrcode' || searchType === 'qr_code') {
      qObj = { $or: [{ qr_code: { $regex: new RegExp(escapedQuery, 'i') } }] };
    } else {
      qObj = {
        $or: [
          { serial_number: { $regex: new RegExp(escapedQuery, 'i') } },
          { uniqueId: { $regex: new RegExp(escapedQuery, 'i') } }
        ]
      };
    }
    
    if (req.activeStore) {
      const storeIds = await getStoreIds(req.activeStore);
      qObj.store = { $in: storeIds };
    }

    const assets = await Asset.find(qObj)
      .select('name model_number serial_number uniqueId store status condition location assigned_to reserved updatedAt')
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
    const wb = new ExcelJS.Workbook();

    const headers = BULK_ASSET_EXCEL_HEADERS;

    // Sheet 1: Template (headers only)
    const templateRows = [headers];
    const wsTemplate = wb.addWorksheet('Template');
    wsTemplate.addRows(templateRows);
    wsTemplate.columns = headers.map((_, idx) => ({ width: idx === 0 ? 28 : 20 }));

    // Sheet 2: Sample (headers + one example row)
    const sampleRow = BULK_TEMPLATE_SAMPLE_ROW;
    const wsSample = wb.addWorksheet('Sample');
    wsSample.addRows([headers, sampleRow]);
    wsSample.columns = headers.map((_, idx) => ({ width: idx === 0 ? 28 : 20 }));

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
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
  const {
    name, model_number, serial_number, mac_address, manufacturer, store, location, status, condition,
    ticket_number, po_number, product_name, rfid, qr_code, quantity, vendor_name, price,
    device_group, inbound_from, outbound_to, expo_tag, abs_code, product_number,
    operating_system, specification, service_tag, assign_to_department,
    ip_address, building, state_comments, remarks, comments, customFields
  } = req.body;
  try {
    const normName = capitalizeWords(name);
    const normProduct = capitalizeWords(product_name || '');
    const normManufacturer = capitalizeWords(manufacturer || '');
    const normLocation = capitalizeWords(location || '');
    const qty = Number.parseInt(quantity, 10) > 0 ? Number.parseInt(quantity, 10) : 1;
    const unitPrice = Number.isFinite(Number(price)) ? Number(price) : 0;
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
    const requestedStoreId = store || req.activeStore;
    let finalStoreId = requestedStoreId;
    if (store && req.activeStore) {
      const selectedStore = await Store.findById(store).select('_id parentStore').lean();
      // If user has an active main store context, allow selected child location under it.
      if (selectedStore && String(selectedStore.parentStore || '') === String(req.activeStore)) {
        finalStoreId = selectedStore._id;
      } else if (String(store) === String(req.activeStore)) {
        finalStoreId = req.activeStore;
      } else {
        finalStoreId = req.activeStore;
      }
    }

    const createPayload = {
      name: normName,
      model_number,
      serial_number,
      serial_last_4: (serial_number || '').slice(-4),
      mac_address,
      manufacturer: normManufacturer || '',
      ticket_number: ticket_number || '',
      po_number: po_number || '',
      vendor_name: capitalizeWords(vendor_name || ''),
      product_name: finalProductName,
      rfid: rfid || '',
      qr_code: qr_code || '',
      uniqueId,
      store: finalStoreId,
      status: status || 'In Store',
      condition: condition || 'New',
      location: normLocation || '',
      device_group: capitalizeWords(device_group || ''),
      inbound_from: capitalizeWords(inbound_from || ''),
      outbound_to: capitalizeWords(outbound_to || ''),
      expo_tag: String(expo_tag || '').trim(),
      abs_code: String(abs_code || '').trim(),
      product_number: String(product_number || '').trim(),
      operating_system: String(operating_system || '').trim(),
      specification: String(specification || '').trim(),
      service_tag: String(service_tag || '').trim(),
      assign_to_department: String(assign_to_department || '').trim(),
      ip_address: String(ip_address || '').trim(),
      building: capitalizeWords(building || ''),
      state_comments: String(state_comments || '').trim(),
      remarks: String(remarks || '').trim(),
      comments: String(comments || '').trim(),
      quantity: qty,
      price: unitPrice,
      history: [
        {
          action: 'Created Asset',
          ticket_number: ticket_number || '',
          user: req.user?.name || 'Unknown User',
          details: `Asset added by ${req.user?.name || 'Unknown User'}${req.user?.email ? ` (${req.user.email})` : ''}`
        }
      ]
    };
    if (customFields && typeof customFields === 'object' && !Array.isArray(customFields)) {
      const sanitized = sanitizeCustomFieldsPayload(customFields);
      if (Object.keys(sanitized).length > 0) {
        createPayload.customFields = sanitized;
      }
    }

    const asset = await Asset.create(createPayload);

    // Log Activity
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Create Asset',
      details: `Created asset ${name} (SN: ${serial_number}) qty=${qty}`,
      store: finalStoreId
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
    if (updates.reserved !== undefined) data.reserved = updates.reserved === true || String(updates.reserved).toLowerCase() === 'true';
    if (updates.manufacturer) data.manufacturer = capitalizeWords(updates.manufacturer);
    if (updates.location) data.location = capitalizeWords(updates.location);
    if (updates.device_group !== undefined) data.device_group = capitalizeWords(updates.device_group || '');
    if (updates.inbound_from !== undefined) data.inbound_from = capitalizeWords(updates.inbound_from || '');
    if (updates.outbound_to !== undefined) data.outbound_to = capitalizeWords(updates.outbound_to || '');
    if (updates.expo_tag !== undefined) data.expo_tag = String(updates.expo_tag || '').trim();
    if (updates.abs_code !== undefined) data.abs_code = String(updates.abs_code || '').trim();
    if (updates.product_number !== undefined) data.product_number = String(updates.product_number || '').trim();
    if (updates.operating_system !== undefined) data.operating_system = String(updates.operating_system || '').trim();
    if (updates.specification !== undefined) data.specification = String(updates.specification || '').trim();
    if (updates.service_tag !== undefined) data.service_tag = String(updates.service_tag || '').trim();
    if (updates.assign_to_department !== undefined) {
      data.assign_to_department = String(updates.assign_to_department || '').trim();
    }
    if (updates.ip_address !== undefined) data.ip_address = String(updates.ip_address || '').trim();
    if (updates.building !== undefined) data.building = capitalizeWords(updates.building || '');
    if (updates.state_comments !== undefined) data.state_comments = String(updates.state_comments || '').trim();
    if (updates.remarks !== undefined) data.remarks = String(updates.remarks || '').trim();
    if (updates.comments !== undefined) data.comments = String(updates.comments || '').trim();
    let prodName = updates.product_name ? String(updates.product_name) : '';
    if (prodName) data.product_name = capitalizeWords(prodName);

    const mvRaw = String(updates.maintenance_vendor ?? updates.customFields?.maintenance_vendor ?? '').trim();
    if (mvRaw) {
      data['customFields.maintenance_vendor'] = mvRaw;
    }

    const match = { _id: { $in: ids } };
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      if (!scopedStoreId) {
        return res.status(403).json({ message: 'Store context is required for bulk updates' });
      }
      const scopedStoreIds = await getStoreIds(scopedStoreId);
      match.store = { $in: scopedStoreIds };
      const scopedCount = await Asset.countDocuments(match);
      if (scopedCount !== ids.length) {
        return res.status(403).json({ message: 'One or more assets are outside your store scope' });
      }
    }

    const result = await Asset.updateMany(match, { $set: data });

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Bulk Edit Assets',
      details: `Updated ${result.modifiedCount || 0} assets`,
      store: req.activeStore
    });

    const updated = await Asset.find(match)
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
    const match = { _id: { $in: ids } };
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      if (!scopedStoreId) {
        return res.status(403).json({ message: 'Store context is required for bulk deletes' });
      }
      const scopedStoreIds = await getStoreIds(scopedStoreId);
      match.store = { $in: scopedStoreIds };
      const scopedCount = await Asset.countDocuments(match);
      if (scopedCount !== ids.length) {
        return res.status(403).json({ message: 'One or more assets are outside your store scope' });
      }
    }

    const toDelete = await Asset.find(match).lean();
    const result = await Asset.deleteMany(match);

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

    // RBAC: Check store access (active store + its child stores)
    if (req.activeStore) {
      const scopedStoreIds = await getStoreIds(req.activeStore);
      const scopedStoreSet = new Set(scopedStoreIds.map((id) => String(id)));
      const assetStoreId = asset.store ? String(asset.store) : '';
      if (!scopedStoreSet.has(assetStoreId)) {
        return res.status(403).json({ message: 'Access denied to this store asset' });
      }
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
    const allowedStatuses = new Set(['In Store', 'In Use', 'Missing']);
    const allowedConditions = new Set(['New', 'Used', 'Faulty', 'Repaired']);
    newAssetData.status = allowedStatuses.has(newStatus) ? newStatus : 'In Store';
    newAssetData.condition = allowedConditions.has(newCondition) ? newCondition : 'Faulty';
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
      details: `Split ${qtyToSplit} items from ${asset.name} (${asset.uniqueId}) as ${newAssetData.status}/${newAssetData.condition}`
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
    const workbook = await readUploadedWorkbook(req.file);
    const worksheets = Array.isArray(workbook?.worksheets) ? workbook.worksheets : [];
    if (worksheets.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no sheets found' });
    }
    let rows = [];
    for (const ws of worksheets) {
      const out = worksheetToJsonRows(ws, { defval: '', blankrows: false });
      if (Array.isArray(out) && out.length > 0) {
        rows = out;
        break;
      }
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no data rows found' });
    }
    if (rows.length > MAX_BULK_IMPORT_ROWS) {
      return res.status(400).json({
        message: `Too many rows (${rows.length.toLocaleString()}). Maximum per file is ${MAX_BULK_IMPORT_ROWS.toLocaleString()}. Split the file or raise MAX_BULK_IMPORT_ROWS on the server.`
      });
    }
    const {
      product_name: reqProductName,
      source: reqSource,
      location: reqLocation,
      delivered_by_name: reqDeliveredByName,
      delivered_at: reqDeliveredAt,
      vendor_name: reqVendorName
    } = req.body || {};
    const stores = await Store.find().lean();
    const storeMap = {};
    const storeMapLower = {};
    stores.forEach((s) => {
      if (s.name) {
        storeMap[s.name] = s._id;
        storeMapLower[s.name.trim().toLowerCase()] = s._id;
      }
    });
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
    const assigneeUsers = await User.find({}).select('name email').lean();
    const assigneeLookup = buildAssigneeLookupMap(assigneeUsers);
    const assigneeById = new Map(assigneeUsers.map((u) => [String(u._id), u]));
    const makeFastUniqueId = createFastUniqueIdGenerator();
    const normalizeText = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return '';
      if (/^(?:N\/A|NA|-|—)$/i.test(s)) return '';
      return s;
    };
    const staged = [];
    const invalid_rows = [];
    let duplicate_rows_total = 0;
    const duplicate_rows_sample = [];
    const allowDuplicates = String(req.body?.allowDuplicates || '').toLowerCase() === 'true';
    const isAdminUser = req.user?.role === 'Admin' || req.user?.role === 'Super Admin';
    const seenSerialByStore = new Set();
    const previewIsNA = (val) => {
      const s = String(val || '').trim();
      return s === '' || s.toUpperCase() === 'N/A' || s === '-';
    };
    for (const item of rows) {
      const norm = {};
      Object.keys(item).forEach(k => { norm[String(k).trim().toLowerCase()] = item[k]; });
      let productName = reqProductName || norm['product name'] || norm['product'] || norm['product type'] || norm['category'] || '-';
      if (!productName && (norm['asset type'] || norm['assettype'])) {
        productName = norm['asset type'] || norm['assettype'];
      }
      if (productName) {
        const found = productLookup[String(productName).trim().toLowerCase()];
        if (found) productName = found;
      }
      const name = productName || '-';
      const model = readBulkTextFromNorm(norm, [
        'model number',
        'model no',
        'model no.',
        'model #',
        'model#',
        'mod. no',
        'mod no',
        'asset model',
        'modle number',
        'modal number',
        'model'
      ]);
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
      const poNumber = norm['po number'] || norm['po'] || norm['purchase order'] || '';
      const rfid = norm['rfid'] || '-';
      const qrCode = norm['qr code'] || norm['qr'] || '-';
      const storeName = normalizeText(norm['store location'] || norm['storename'] || norm['store'] || '');
      const locationRawCombined = reqLocation || norm['location'] || norm['physical location'] || norm['room'] || norm['area'] || '';
      let location = normalizeText(locationRawCombined);
      if (!location && storeName) location = storeName;
      const statusRaw = norm['status'];
      const statusNorm = String(statusRaw || '').trim().toLowerCase();
      const statusMap = {
        'available/new': 'In Store',
        'new': 'In Store',
        'spare': 'In Store',
        'spare (new)': 'In Store',
        'spare (used)': 'In Store',
        'available/used': 'In Store',
        'used': 'In Store',
        'in store': 'In Store',
        'in use': 'In Use',
        'available faulty': 'In Store',
        'faulty': 'In Store',
        'disposed': 'In Store',
        'under repair': 'In Store',
        'scrapped': 'In Store',
        'missing': 'Missing'
      };
      const status = statusMap[statusNorm] || 'In Store';
      const conditionRaw = norm['condition'];
      let condition = 'New';
      if (conditionRaw) {
        const cNorm = String(conditionRaw).trim().toLowerCase();
        if (cNorm === 'new' || cNorm.includes('new')) condition = 'New';
        else if (cNorm === 'used' || cNorm.includes('used')) condition = 'Used';
        else if (cNorm === 'faulty' || cNorm.includes('faulty')) condition = 'Faulty';
        else if (cNorm === 'under repair' || cNorm.includes('repair')) condition = 'Repaired';
        else if (cNorm === 'disposed' || cNorm.includes('disposed') || cNorm.includes('scrap')) condition = 'Faulty';
        else if (cNorm === 'repaired' || cNorm.includes('repaired')) condition = 'Repaired';
      } else {
        if (statusNorm === 'used' || statusNorm === 'available/used' || statusNorm === 'spare (used)') {
          condition = 'Used';
        } else if (statusNorm === 'faulty' || statusNorm === 'available faulty') {
          condition = 'Faulty';
        } else if (statusNorm === 'under repair') {
          condition = 'Repaired';
        } else if (statusNorm === 'disposed' || statusNorm === 'scrapped') {
          condition = 'Faulty';
        } else if (statusNorm === 'repaired') {
          condition = 'Repaired';
        }
      }
      let storeId = storeMap[storeName] || storeMapLower[storeName.toLowerCase()];
      if (req.activeStore) {
        storeId = req.activeStore;
      }
      const uniqueId = makeFastUniqueId(name);
      const deliveredByFromRow = norm['delivered by'] || norm['delivered_by'] || norm['deliveredby'] || '';
      const vendorNameFromRow = norm['vendor name'] || norm['vendor'] || '';
      const deviceGroupFromRow = norm['device group'] || norm['device_group'] || '';
      const inboundFromRow = norm['inbound from'] || norm['inbound_from'] || '';
      const outboundToRow = norm['outbound to'] || norm['outbound_to'] || '';
      const expoTagRow = norm['expo tag'] || norm['expo_tag'] || '';
      const absCodeRow = norm['abs code'] || norm['abs_code'] || '';
      const productNumberRow = readBulkTextFromNorm(norm, [
        'product number',
        'product_number',
        'product no',
        'part number',
        'pn',
        'p/n'
      ]);
      const operatingSystemRow = norm['operating system'] || norm['operating_system'] || '';
      const specificationRow = norm['specification'] || norm['spec'] || '';
      const serviceTagRow = norm['service tag'] || norm['service_tag'] || '';
      const assignDeptRow =
        norm['assign to department']
        || norm['assign_to_department']
        || norm['assign to depratment']
        || norm['assign_to_depratment']
        || '';
      const ipAddressFromRow = norm['ip address'] || norm['ip_address'] || '';
      const buildingFromRow = norm['building'] || '';
      const stateCommentsFromRow = norm['state comments'] || norm['state_comments'] || '';
      const remarksFromRow = norm['remarks'] || '';
      const commentsFromRow = norm['comments'] || '';
      const maintenanceVendorFromRow =
        norm['maintenance vendor']
        || norm['maintenance vendors']
        || norm['maintenance vandor']
        || norm['maintenance_vendor']
        || norm['maintenance_vandor']
        || '';
      const deliveredAtRaw = norm['delivered at'] || norm['delivered_at'] || '';
      let deliveredAtDate;
      if (deliveredAtRaw) {
        deliveredAtDate = new Date(deliveredAtRaw);
      } else if (reqDeliveredAt) {
        deliveredAtDate = new Date(reqDeliveredAt);
      } else {
        deliveredAtDate = new Date();
      }
      const assignedToRaw =
        norm['assigned to'] || norm['assigned_to'] || norm['assignee'] || '';
      const assignedToId = resolveAssigneeIdFromCell(assignedToRaw, assigneeLookup);
      let assignedToLabel = '';
      if (assignedToId) {
        const u = assigneeById.get(String(assignedToId));
        assignedToLabel = u ? u.name : String(assignedToRaw).trim();
      } else if (String(assignedToRaw).trim()) {
        assignedToLabel = `${String(assignedToRaw).trim()} (unmatched)`;
      }
      const serialStr = String(serial || '').trim();
      const assetData = {
        importBatchId,
        name: String(name || '').toUpperCase(),
        model_number: model,
        serial_number: serialStr,
        serial_last_4: previewIsNA(serialStr) ? '-' : serialStr.slice(-4),
        mac_address: mac,
        manufacturer: String(manufacturer || '').toUpperCase(),
        ticket_number: ticketNumber,
        po_number: poNumber || '',
        rfid,
        qr_code: qrCode,
        uniqueId,
        store: storeId,
        status,
        condition,
        product_name: productName,
        source: reqSource || '',
        location: String(location || '').trim() ? String(location).toUpperCase() : (storeName ? storeName.toUpperCase() : 'UNKNOWN'),
        vendor_name: vendorNameFromRow || reqVendorName || '',
        delivered_by_name: deliveredByFromRow || reqDeliveredByName || '',
        device_group: String(deviceGroupFromRow || '').toUpperCase(),
        inbound_from: String(inboundFromRow || '').toUpperCase(),
        outbound_to: String(outboundToRow || '').toUpperCase(),
        expo_tag: String(expoTagRow || '').trim(),
        abs_code: String(absCodeRow || '').trim(),
        product_number: String(productNumberRow || '').trim(),
        operating_system: String(operatingSystemRow || '').trim(),
        specification: String(specificationRow || '').trim(),
        service_tag: String(serviceTagRow || '').trim(),
        assign_to_department: String(assignDeptRow || '').trim(),
        ip_address: String(ipAddressFromRow || '').trim(),
        building: String(buildingFromRow || '').toUpperCase(),
        state_comments: String(stateCommentsFromRow || '').trim(),
        remarks: String(remarksFromRow || '').trim(),
        comments: String(commentsFromRow || '').trim(),
        delivered_at: deliveredAtDate,
        quantity,
        price
      };
      if (assignedToId) {
        assetData.assigned_to = assignedToId;
      }
      assetData._assignedToLabel = assignedToLabel;
      if (String(maintenanceVendorFromRow || '').trim()) {
        assetData.customFields = {
          ...(assetData.customFields || {}),
          maintenance_vendor: String(maintenanceVendorFromRow).trim()
        };
      }
      if (!assetData.serial_number) {
        invalid_rows.push({ serial: '', reason: 'Missing serial number' });
        continue;
      }
      const serialKey = String(assetData.serial_number || '').trim().toLowerCase();
      const storeKey = String(storeId || '').trim();
      const dedupeKey = `${storeKey}::${serialKey}`;
      let fileDuplicateReason = '';
      if (seenSerialByStore.has(dedupeKey)) {
        fileDuplicateReason = 'Duplicate serial in uploaded file';
      }
      if (serialKey) seenSerialByStore.add(dedupeKey);
      staged.push({ assetData, serialKey, storeId, fileDuplicateReason });
    }

    const queryPairs = [];
    const queryPairSeen = new Set();
    for (const row of staged) {
      if (row.fileDuplicateReason || !row.serialKey || !row.storeId) continue;
      const pair = `${String(row.storeId)}::${row.serialKey}`;
      if (queryPairSeen.has(pair)) continue;
      queryPairSeen.add(pair);
      queryPairs.push({ store: row.storeId, serial_number: row.assetData.serial_number });
    }
    const existingPairSet = new Set();
    const existingDocsByPair = new Map();
    const PREVIEW_CHUNK = 500;
    const previewExistingSelect =
      'store serial_number name model_number serial_last_4 mac_address manufacturer ticket_number po_number rfid qr_code status condition product_name source location vendor_name delivered_by_name device_group inbound_from outbound_to expo_tag abs_code product_number operating_system specification service_tag assign_to_department ip_address building state_comments remarks comments delivered_at quantity price customFields assigned_to';
    for (let i = 0; i < queryPairs.length; i += PREVIEW_CHUNK) {
      const chunk = queryPairs.slice(i, i + PREVIEW_CHUNK);
      // eslint-disable-next-line no-await-in-loop
      const existing = await Asset.find({ $or: chunk }).select(previewExistingSelect).lean();
      existing.forEach((doc) => {
        const pk = `${String(doc.store)}::${String(doc.serial_number || '').trim().toLowerCase()}`;
        existingPairSet.add(pk);
        existingDocsByPair.set(pk, doc);
      });
    }

    const preview = [];
    const distinctUpdateFields = new Set();
    const updateDiffSamples = [];
    let existingDbMatchRows = 0;
    let rowsWithIncomingChanges = 0;
    for (const row of staged) {
      const { assetData, serialKey, storeId, fileDuplicateReason } = row;
      let duplicateReason = fileDuplicateReason;
      if (!duplicateReason && serialKey && storeId) {
        const pk = `${String(storeId)}::${serialKey}`;
        if (existingPairSet.has(pk)) duplicateReason = 'Duplicate serial already exists in store';
      }
      if (duplicateReason) {
        duplicate_rows_total += 1;
        if (duplicate_rows_sample.length < 200) {
          duplicate_rows_sample.push({ serial: assetData.serial_number, reason: duplicateReason });
        }
      }
      assetData._duplicateSerial = Boolean(duplicateReason);
      assetData._duplicateReason = duplicateReason;
      assetData._duplicateAllowed = Boolean(duplicateReason && allowDuplicates && isAdminUser);
      assetData._dbWouldUpdate = false;
      assetData._fieldChanges = [];
      if (!fileDuplicateReason && serialKey && storeId) {
        const pk = `${String(storeId)}::${serialKey}`;
        if (existingPairSet.has(pk)) {
          existingDbMatchRows += 1;
          const existingDoc = existingDocsByPair.get(pk);
          if (existingDoc) {
            const { patch, changedFields } = buildPatchForBulkImportUpdate(existingDoc, assetData);
            if (changedFields.length > 0) {
              rowsWithIncomingChanges += 1;
              assetData._dbWouldUpdate = true;
              const changes = changedFields.map((field) => {
                const prevVal = field === 'maintenance_vendor'
                  ? existingDoc?.customFields?.maintenance_vendor
                  : existingDoc[field];
                const nextVal = field === 'maintenance_vendor'
                  ? patch?.customFields?.maintenance_vendor
                  : patch[field];
                const toDisplay = field === 'assigned_to' && assetData._assignedToLabel
                  ? assetData._assignedToLabel
                  : formatBulkImportDiffValue(field, nextVal, assigneeById);
                return {
                  field,
                  label: BULK_IMPORT_FIELD_LABELS[field] || field,
                  from: formatBulkImportDiffValue(field, prevVal, assigneeById),
                  to: toDisplay
                };
              });
              assetData._fieldChanges = changes;
              changedFields.forEach((f) => distinctUpdateFields.add(f));
              if (updateDiffSamples.length < 40) {
                updateDiffSamples.push({ serial: assetData.serial_number, changes });
              }
            }
          }
        }
      }
      preview.push(assetData);
    }

    const totalPreviewRows = preview.length;
    const assetsOut = preview.length > IMPORT_PREVIEW_RESPONSE_CAP
      ? preview.slice(0, IMPORT_PREVIEW_RESPONSE_CAP)
      : preview;
    const invalidSample = invalid_rows.slice(0, 200);

    res.json({
      assets: assetsOut,
      invalid_rows: invalidSample,
      invalid_rows_total: invalid_rows.length,
      duplicate_rows: duplicate_rows_sample,
      duplicate_rows_total,
      summary: {
        file_rows: rows.length,
        rows_with_serial: totalPreviewRows,
        preview_rows_total: totalPreviewRows,
        preview_rows_returned: assetsOut.length,
        preview_truncated: totalPreviewRows > IMPORT_PREVIEW_RESPONSE_CAP,
        invalid: invalid_rows.length,
        duplicates_flagged: duplicate_rows_total,
        existing_db_match_rows: existingDbMatchRows,
        rows_with_incoming_field_changes: rowsWithIncomingChanges,
        distinct_update_fields: Array.from(distinctUpdateFields).sort(),
        update_diff_samples: updateDiffSamples
      }
    });
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
    const workbook = await readUploadedWorkbook(req.file);
    const worksheets = Array.isArray(workbook?.worksheets) ? workbook.worksheets : [];
    if (worksheets.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no sheets found' });
    }
    let data = [];
    let sheetName = null;
    for (const ws of worksheets) {
      const rows = worksheetToJsonRows(ws, { defval: '', blankrows: false });
      if (Array.isArray(rows) && rows.length > 0) {
        data = rows;
        sheetName = ws.name;
        break;
      }
    }
    // Fallback: manual header parsing if standard conversion returns empty
    if (!Array.isArray(data) || data.length === 0) {
      for (const ws of worksheets) {
        const raw = worksheetToAoa(ws, { defval: '', blankrows: false });
        if (Array.isArray(raw) && raw.length > 0) {
          // Find header row dynamically (matches at least one known header)
          const KNOWN = ['product name','name','model number','serial number','unique id','unique_id','mac address','manufacturer','ticket number','assigned to','assigned_to','assignee','rfid','qr code','store','store location','location','status','condition','asset type','maintenance vendor','device group','inbound from','outbound to','expo tag','abs code','product number','operating system','specification','service tag','assign to department','assign to depratment','ip address','building','state comments','remarks','comments'];
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
            const subMatrix = raw.slice(headerIdx);
            const templated = matrixToTemplateKeyedBulkRows(subMatrix, { defval: '', blankrows: false });
            if (Array.isArray(templated) && templated.length > 0) {
              data = templated;
              sheetName = ws.name;
              break;
            }
            const headers = (raw[headerIdx] || []).map(h => String(h || '').trim());
            const body = raw.slice(headerIdx + 1);
            const converted = body.map(row => {
              const obj = {};
              headers.forEach((h, idx) => { obj[h] = row[idx] !== undefined ? row[idx] : ''; });
              return obj;
            }).filter(r => Object.values(r).some(v => String(v || '').trim() !== ''));
            if (converted.length > 0) {
              data = converted;
              sheetName = ws.name;
              break;
            }
          }
        }
      }
    }
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ message: 'Invalid Excel file: no data rows found' });
    }
    if (data.length > MAX_BULK_IMPORT_ROWS) {
      return res.status(400).json({
        message: `Too many rows in one import file (${data.length.toLocaleString()}). Maximum is ${MAX_BULK_IMPORT_ROWS.toLocaleString()} per upload (set MAX_BULK_IMPORT_ROWS to raise).`
      });
    }

    const duplicates = [];
    const createdCount = { v: 0 };
    const updatedCount = { v: 0 };
    const allowDuplicates = String(req.body?.allowDuplicates || '').toLowerCase() === 'true';
    const isAdminUser = req.user?.role === 'Admin' || req.user?.role === 'Super Admin';
    let selectiveDuplicateUpdates = false;
    let allowedUpdateFieldsSet = null;
    try {
      if (String(req.body?.selective_duplicate_updates || '').toLowerCase() === 'true') {
        const raw = req.body?.allowed_update_fields;
        const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
        if (Array.isArray(parsed)) {
          selectiveDuplicateUpdates = true;
          allowedUpdateFieldsSet = new Set(parsed.filter(Boolean));
        }
      }
    } catch {
      // ignore malformed allowed_update_fields JSON
    }
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

    const assigneeUsers = await User.find({}).select('name email').lean();
    const assigneeLookup = buildAssigneeLookupMap(assigneeUsers);

    const fileSeenSerials = new Set();
    const parsedAssets = [];
    const makeFastUniqueId = createFastUniqueIdGenerator();
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
      
      let productName = reqProductName || norm['product name'] || norm['product'] || norm['product type'] || norm['category'] || '-';

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

      const model = readBulkTextFromNorm(norm, [
        'model number',
        'model no',
        'model no.',
        'model #',
        'model#',
        'mod. no',
        'mod no',
        'asset model',
        'modle number',
        'modal number',
        'model'
      ]);
      const qtyRaw = norm['quantity'] || norm['qty'] || '1';
      let quantity = parseInt(String(qtyRaw).trim(), 10);
      if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
      if (quantity > 1000000) quantity = 1000000;
      const priceRaw = norm['price'] || norm['unit price'] || '0';
      let price = parseFloat(String(priceRaw).toString().replace(/[, ]/g, ''));
      if (!Number.isFinite(price) || price < 0) price = 0;
      const serial = norm['serial number'] || norm['serial'] || '-';
      const mac = norm['mac address'] || norm['mac'] || '-';
      const manufacturer = norm['manufacturer'] || '-';
      const ticketNumber = norm['ticket number'] || norm['ticket'] || '-';
      const poNumber = norm['po number'] || norm['po'] || norm['purchase order'] || '';
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
        'available/new': 'In Store',
        'new': 'In Store',
        'spare': 'In Store',
        'spare (new)': 'In Store',
        'spare (used)': 'In Store',
        'available/used': 'In Store',
        'used': 'In Store',
        'in store': 'In Store',
        'in use': 'In Use',
        'available faulty': 'In Store',
        'faulty': 'In Store',
        'disposed': 'In Store',
        'under repair': 'In Store',
        'scrapped': 'In Store',
        'missing': 'Missing'
      };
      const status = statusMap[statusNorm] || 'In Store';

      const deliveredByFromRow = norm['delivered by'] || norm['delivered_by'] || norm['deliveredby'] || '';
      const vendorNameFromRow = norm['vendor name'] || norm['vendor'] || '';
      const deviceGroupFromRow = norm['device group'] || norm['device_group'] || '';
      const inboundFromRow = norm['inbound from'] || norm['inbound_from'] || '';
      const outboundToRow = norm['outbound to'] || norm['outbound_to'] || '';
      const expoTagRow = norm['expo tag'] || norm['expo_tag'] || '';
      const absCodeRow = norm['abs code'] || norm['abs_code'] || '';
      const productNumberRow = readBulkTextFromNorm(norm, [
        'product number',
        'product_number',
        'product no',
        'part number',
        'pn',
        'p/n'
      ]);
      const operatingSystemRow = norm['operating system'] || norm['operating_system'] || '';
      const specificationRow = norm['specification'] || norm['spec'] || '';
      const serviceTagRow = norm['service tag'] || norm['service_tag'] || '';
      const assignDeptRow =
        norm['assign to department']
        || norm['assign_to_department']
        || norm['assign to depratment']
        || norm['assign_to_depratment']
        || '';
      const ipAddressFromRow = norm['ip address'] || norm['ip_address'] || '';
      const buildingFromRow = norm['building'] || '';
      const stateCommentsFromRow = norm['state comments'] || norm['state_comments'] || '';
      const remarksFromRow = norm['remarks'] || '';
      const commentsFromRow = norm['comments'] || '';
      const maintenanceVendorFromRow =
        norm['maintenance vendor']
        || norm['maintenance vendors']
        || norm['maintenance vandor']
        || norm['maintenance_vendor']
        || norm['maintenance_vandor']
        || '';
      const deliveredAtRaw = norm['delivered at'] || norm['delivered_at'] || '';
      const assignedToRaw =
        norm['assigned to'] || norm['assigned_to'] || norm['assignee'] || '';
      const assignedToId = resolveAssigneeIdFromCell(assignedToRaw, assigneeLookup);

      // Condition Logic (strict enum mapping)
      const conditionRaw = norm['condition'];
      let condition = 'New';
      if (conditionRaw) {
         const cNorm = String(conditionRaw).trim().toLowerCase();
         if (cNorm === 'new' || cNorm.includes('new')) condition = 'New';
         else if (cNorm === 'used' || cNorm.includes('used')) condition = 'Used';
         else if (cNorm === 'faulty' || cNorm.includes('faulty')) condition = 'Faulty';
         else if (cNorm === 'under repair' || cNorm.includes('repair')) condition = 'Repaired';
         else if (cNorm === 'disposed' || cNorm.includes('disposed') || cNorm.includes('scrap')) condition = 'Faulty';
         else if (cNorm === 'repaired' || cNorm.includes('repaired')) condition = 'Repaired';
      } else {
         // If condition column is empty, infer sensible condition from status text
         if (statusNorm === 'used' || statusNorm === 'available/used' || statusNorm === 'spare (used)') {
           condition = 'Used';
         } else if (statusNorm === 'faulty' || statusNorm === 'available faulty') {
           condition = 'Faulty';
         } else if (statusNorm === 'under repair') {
           condition = 'Repaired';
         } else if (statusNorm === 'disposed' || statusNorm === 'scrapped') {
           condition = 'Faulty';
         } else if (statusNorm === 'repaired') {
           condition = 'Repaired';
         }
      }

      let storeId = storeMap[storeName] || storeMapLower[storeName.toLowerCase()];
      
      // Enforce active store context if present
      if (req.activeStore) {
        storeId = req.activeStore;
      }
      
      // Build normalized row first; duplicates are resolved in batched DB step.
      {
        const serialStr = String(serial).trim();
        const uniqueId = makeFastUniqueId(name);

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
          po_number: poNumber || '',
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
          device_group: String(deviceGroupFromRow || '').toUpperCase(),
          inbound_from: String(inboundFromRow || '').toUpperCase(),
          outbound_to: String(outboundToRow || '').toUpperCase(),
          expo_tag: String(expoTagRow || '').trim(),
          abs_code: String(absCodeRow || '').trim(),
          product_number: String(productNumberRow || '').trim(),
          operating_system: String(operatingSystemRow || '').trim(),
          specification: String(specificationRow || '').trim(),
          service_tag: String(serviceTagRow || '').trim(),
          assign_to_department: String(assignDeptRow || '').trim(),
          ip_address: String(ipAddressFromRow || '').trim(),
          building: String(buildingFromRow || '').toUpperCase(),
          state_comments: String(stateCommentsFromRow || '').trim(),
          remarks: String(remarksFromRow || '').trim(),
          comments: String(commentsFromRow || '').trim(),
          delivered_at: deliveredAtDate,
          quantity,
          price
        };
        if (assignedToId) {
          assetData.assigned_to = assignedToId;
        }
        if (String(maintenanceVendorFromRow || '').trim()) {
          assetData.customFields = {
            ...(assetData.customFields || {}),
            maintenance_vendor: String(maintenanceVendorFromRow).trim()
          };
        }

        parsedAssets.push({ serialStr, storeId, assetData });
      }
    }

    // Resolve duplicates in bulk for performance with large imports.
    const queryPairs = [];
    const queryPairSeen = new Set();
    for (const row of parsedAssets) {
      const serialKey = String(row.serialStr || '').trim().toLowerCase();
      const storeKey = String(row.storeId || '').trim();
      if (!serialKey || !storeKey) continue;
      const pair = `${storeKey}::${serialKey}`;
      if (queryPairSeen.has(pair)) continue;
      queryPairSeen.add(pair);
      queryPairs.push({ store: row.storeId, serial_number: row.serialStr });
    }

    const existingPairSet = new Set();
    const existingDocsByPair = new Map();
    const CHUNK = 500;
    for (let i = 0; i < queryPairs.length; i += CHUNK) {
      const chunk = queryPairs.slice(i, i + CHUNK);
      // eslint-disable-next-line no-await-in-loop
      const existing = await Asset.find({ $or: chunk })
        .select('store serial_number name model_number serial_last_4 mac_address manufacturer ticket_number po_number rfid qr_code status condition product_name source location vendor_name delivered_by_name device_group inbound_from outbound_to expo_tag abs_code product_number operating_system specification service_tag assign_to_department ip_address building state_comments remarks comments delivered_at quantity price customFields assigned_to')
        .lean();
      existing.forEach((doc) => {
        const pairKey = `${String(doc.store)}::${String(doc.serial_number || '').trim().toLowerCase()}`;
        existingPairSet.add(pairKey);
        existingDocsByPair.set(pairKey, doc);
      });
    }

    const docsToInsert = [];
    const warnings = [];
    const updatedRows = [];
    const importUpdateEntries = [];
    for (const row of parsedAssets) {
      const serialKey = String(row.serialStr || '').trim().toLowerCase();
      const storeKey = String(row.storeId || '').trim();
      const pair = `${storeKey}::${serialKey}`;

      if (!serialKey || !storeKey) {
        docsToInsert.push(row.assetData);
        continue;
      }

      if (fileSeenSerials.has(pair)) {
        duplicates.push({
          serial: row.serialStr,
          reason: 'Duplicate serial in uploaded file',
          asset: row.assetData
        });
        continue;
      }
      fileSeenSerials.add(pair);

      if (existingPairSet.has(pair) && !(allowDuplicates && isAdminUser)) {
        const existingDoc = existingDocsByPair.get(pair);
        if (!existingDoc) {
          duplicates.push({
            serial: row.serialStr,
            reason: isAdminUser
              ? 'Duplicate serial exists in same store (enable Allow duplicates to force add)'
              : 'Duplicate serial exists in same store (Admin permission required)',
            asset: row.assetData
          });
          continue;
        }

        let { patch, changedFields } = buildPatchForBulkImportUpdate(existingDoc, row.assetData);
        if (selectiveDuplicateUpdates) {
          ({ patch, changedFields } = filterBulkImportPatchByAllowlist(patch, changedFields, allowedUpdateFieldsSet));
        }

        if (changedFields.length > 0) {
          const previousValues = {};
          const nextValues = {};
          changedFields.forEach((field) => {
            if (field === 'maintenance_vendor') {
              previousValues[field] = existingDoc?.customFields?.maintenance_vendor;
              nextValues[field] = patch?.customFields?.maintenance_vendor;
            } else {
              previousValues[field] = existingDoc[field];
              nextValues[field] = patch[field];
            }
          });
          // eslint-disable-next-line no-await-in-loop
          await Asset.updateOne({ _id: existingDoc._id }, { $set: patch });
          updatedCount.v += 1;
          updatedRows.push({
            serial: row.serialStr,
            changed_fields: changedFields
          });
          importUpdateEntries.push({
            assetId: existingDoc._id,
            serial: row.serialStr,
            changedFields,
            previousValues,
            nextValues
          });
          warnings.push(`Updated serial ${row.serialStr}: ${changedFields.join(', ')}`);
        } else {
          warnings.push(`No change for serial ${row.serialStr}`);
        }
        continue;
      }

      docsToInsert.push(row.assetData);
    }

    if (docsToInsert.length > 0) {
      try {
        const inserted = await Asset.insertMany(docsToInsert, { ordered: false });
        createdCount.v += inserted.length;
      } catch (e) {
        const insertedCount = Number(e?.result?.nInserted || e?.insertedDocs?.length || 0);
        createdCount.v += insertedCount;
        if (Array.isArray(e?.writeErrors)) {
          e.writeErrors.forEach((we) => {
            duplicates.push({
              serial: we?.err?.op?.serial_number || '',
              reason: we?.errmsg || 'Insert error',
              asset: we?.err?.op
            });
          });
        } else {
          throw e;
        }
      }
    }

    const totalQuantityCreated = docsToInsert.reduce((sum, a) => {
      const q = Number(a?.quantity);
      return sum + (Number.isFinite(q) && q > 0 ? q : 1);
    }, 0);
    const totalColumnsUpdated = updatedRows.reduce((sum, row) => sum + (Array.isArray(row.changed_fields) ? row.changed_fields.length : 0), 0);
    let importUpdateBatchId = null;
    let importUpdateBatchCreatedAt = null;
    if (importUpdateEntries.length > 0) {
      const batchDoc = await AssetImportUpdateBatch.create({
        importBatchId,
        createdBy: req.user?._id,
        store: req.activeStore || null,
        updates: importUpdateEntries,
        totalRowsUpdated: importUpdateEntries.length,
        totalColumnsUpdated
      });
      importUpdateBatchId = String(batchDoc._id);
      importUpdateBatchCreatedAt = batchDoc.createdAt || new Date();
    }
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Bulk Upsert Assets',
      details: `Import completed. Created ${createdCount.v} records, Updated ${updatedCount.v} records, Columns changed ${totalColumnsUpdated}, Quantity ${totalQuantityCreated}`,
      store: req.activeStore
    });
    const suffix = invalidRows.length
      ? `, ${invalidRows.length} row(s) skipped due to invalid formatting/capitalization`
      : '';
    res.json({
      message: `Processed ${createdCount.v + updatedCount.v} assets (created ${createdCount.v}, updated ${updatedCount.v})${suffix}`,
      totals: {
        records_created: createdCount.v,
        quantity_created: totalQuantityCreated,
        records_updated: updatedCount.v,
        columns_updated: totalColumnsUpdated
      },
      warnings,
      updated_rows: updatedRows,
      import_update_batch_id: importUpdateBatchId,
      import_update_batch_created_at: importUpdateBatchCreatedAt,
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

// @desc    Revert latest import updates batch
// @route   POST /api/assets/import/revert-last
// @access  Private/Admin
router.post('/import/revert-last', protect, admin, async (req, res) => {
  try {
    const q = {
      revertedAt: null
    };
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      if (!scopedStoreId) {
        return res.status(403).json({ message: 'Store context is required to revert import updates' });
      }
      q.store = scopedStoreId;
    } else if (req.activeStore) {
      q.store = req.activeStore;
    }

    const batch = await AssetImportUpdateBatch.findOne(q).sort({ createdAt: -1 }).lean();
    if (!batch || !Array.isArray(batch.updates) || batch.updates.length === 0) {
      return res.status(404).json({ message: 'No reversible import update batch found' });
    }

    const ops = [];
    for (const entry of batch.updates) {
      const assetId = entry?.assetId;
      const previousValues = entry?.previousValues && typeof entry.previousValues === 'object' ? entry.previousValues : null;
      if (!assetId || !previousValues) continue;
      ops.push({
        updateOne: {
          filter: { _id: assetId },
          update: { $set: previousValues }
        }
      });
    }
    if (ops.length === 0) {
      return res.status(400).json({ message: 'No reversible field changes found in latest batch' });
    }

    await Asset.bulkWrite(ops, { ordered: false });
    await AssetImportUpdateBatch.updateOne(
      { _id: batch._id },
      { $set: { revertedAt: new Date(), revertedBy: req.user?._id || null } }
    );

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Revert Import Updates',
      details: `Reverted ${ops.length} asset updates from import batch ${batch.importBatchId || batch._id}`,
      store: req.activeStore || batch.store || null
    });

    return res.json({
      message: `Reverted ${ops.length} updated asset(s) from latest import batch`,
      reverted_assets: ops.length,
      import_batch_id: batch.importBatchId || ''
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to revert latest import updates' });
  }
});

// @desc    Download asset report
// @route   GET /api/assets/export
// @access  Private/Admin
router.get('/export', protect, admin, async (req, res) => {
  try {
    const assets = await Asset.find().populate('store').populate('assigned_to');

    // Export columns aligned with the bulk import Excel headers
    // so re-importing the exported file doesn't cause field mismatches.
    const headerMain = BULK_ASSET_EXCEL_HEADERS;

    const rowsMain = assets.map((a) => {
      const maintenanceVendor = a?.customFields?.maintenance_vendor || '';
      const assignedName =
        a.assigned_to && typeof a.assigned_to === 'object' && a.assigned_to.name
          ? a.assigned_to.name
          : '';
      return ([
        '',
        '',
        a.product_name || '',
        a.uniqueId || '',
        a.abs_code || '',
        a.expo_tag || '',
        a.model_number || '',
        a.quantity ?? '',
        a.serial_number || '',
        a.mac_address || '',
        a.ip_address || '',
        a.manufacturer || '',
        a.ticket_number || '',
        assignedName,
        a.inbound_from || '',
        a.outbound_to || '',
        a.po_number || '',
        a.vendor_name || '',
        typeof a.price === 'number' ? a.price : '',
        a.rfid || '',
        a.qr_code || '',
        a.store ? a.store.name : '',
        a.status || '',
        a.condition || '',
        maintenanceVendor,
        a.device_group || '',
        a.location || '',
        a.product_number || '',
        a.operating_system || '',
        a.specification || '',
        a.service_tag || '',
        a.assign_to_department || '',
        a.building || '',
        a.state_comments || '',
        a.remarks || '',
        a.comments || '',
        a.delivered_by_name || '',
        a.delivered_at || ''
      ]);
    });

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

    const wb = new ExcelJS.Workbook();
    const wsMain = wb.addWorksheet('ASSETS');
    wsMain.addRows([headerMain, ...rowsMain]);
    wsMain.columns = headerMain.map((_, idx) => ({ width: idx < 3 ? 18 : 16 }));
    const lastCol = excelColumnLetterFromIndex1Based(headerMain.length);
    wsMain.autoFilter = `A1:${lastCol}1`;

    const wsHist = wb.addWorksheet('HISTORY');
    wsHist.addRows([headerHistory, ...rowsHistory]);
    wsHist.columns = [{ width: 14 },{ width: 22 },{ width: 24 },{ width: 22 },{ width: 16 },{ width: 22 }];
    wsHist.autoFilter = 'A1:F1';

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

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
    const template = [{ ...BULK_IMPORT_TEMPLATE_EMPTY_ROW }];
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Template');
    const headers = Object.keys(template[0] || {});
    worksheet.addRow(headers);
    template.forEach((row) => worksheet.addRow(headers.map((h) => row[h])));
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
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
      const rx = toContainsRegex(q);
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
  const {
    assetId,
    assetIds,
    assignQuantity,
    technicianId,
    installationLocation,
    ticketNumber,
    otherRecipient,
    needGatePass,
    recipientEmail,
    recipientPhone,
    gatePassOrigin,
    gatePassDestination,
    gatePassJustification
  } = req.body;
  try {
    const normalizedIds = Array.from(
      new Set(
        [
          ...(Array.isArray(assetIds) ? assetIds : []),
          ...(assetId ? [assetId] : [])
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );
    if (normalizedIds.length === 0) {
      return res.status(400).json({ message: 'Provide assetId or assetIds' });
    }

    const assets = await Asset.find({ _id: { $in: normalizedIds } });
    if (assets.length !== normalizedIds.length) {
      return res.status(404).json({ message: 'One or more assets were not found' });
    }
    const accessChecks = await Promise.all(assets.map((asset) => hasAssetStoreAccessDeep(req, asset.store)));
    if (!accessChecks.every(Boolean)) {
      return res.status(403).json({ message: 'One or more assets are outside your store scope' });
    }

    const isFaultyCondition = (a) => String(a?.condition || '').trim().toLowerCase() === 'faulty';
    const disposedPre = assets.filter((a) => a.disposed === true);
    if (disposedPre.length > 0) {
      return res.status(400).json({
        message: `Cannot assign: ${disposedPre.length} selected asset(s) are disposed`
      });
    }
    if (technicianId) {
      const reservedPre = assets.filter((a) => a.reserved === true);
      if (reservedPre.length > 0) {
        return res.status(400).json({
          message: `Cannot assign: ${reservedPre.length} selected asset(s) are reserved`
        });
      }
      const faultyPre = assets.filter(isFaultyCondition);
      if (faultyPre.length > 0) {
        return res.status(400).json({
          message: `Cannot assign: ${faultyPre.length} selected asset(s) are faulty and cannot be issued to technicians`
        });
      }
    }
    const alreadyAssignedPre = assets.filter(
      (a) => a.assigned_to || (a.assigned_to_external && a.assigned_to_external.name)
    );
    if (alreadyAssignedPre.length > 0) {
      return res.status(400).json({
        message: `Cannot assign: ${alreadyAssignedPre.length} selected asset(s) are already assigned`
      });
    }

    // Optional partial assignment: only supported for single-asset assignment.
    let assetsForAssignment = assets;
    const hasAssignQuantity = assignQuantity !== undefined && assignQuantity !== null && String(assignQuantity).trim() !== '';
    if (hasAssignQuantity) {
      if (normalizedIds.length !== 1) {
        return res.status(400).json({ message: 'Partial quantity assignment is only supported for a single selected asset' });
      }
      const srcAsset = assets[0];
      const srcQty = Number.parseInt(srcAsset.quantity, 10) > 0 ? Number.parseInt(srcAsset.quantity, 10) : 1;
      const qtyToAssign = Number.parseInt(assignQuantity, 10);
      if (!Number.isFinite(qtyToAssign) || qtyToAssign <= 0) {
        return res.status(400).json({ message: 'assignQuantity must be a positive integer' });
      }
      if (qtyToAssign > srcQty) {
        return res.status(400).json({ message: `assignQuantity cannot exceed available quantity (${srcQty})` });
      }

      if (qtyToAssign < srcQty) {
        // Keep the remainder on the original asset and create a new split row for assigned quantity.
        srcAsset.quantity = srcQty - qtyToAssign;
        appendAssetHistory(srcAsset, {
          action: 'Split for Assignment',
          req,
          ticketNumber: ticketNumber || 'N/A',
          details: `Split ${qtyToAssign} from quantity batch for assignment; remaining ${srcAsset.quantity}`,
          previousStatus: srcAsset.status,
          previousCondition: srcAsset.condition
        });
        await srcAsset.save();

        const splitData = srcAsset.toObject();
        delete splitData._id;
        delete splitData.__v;
        delete splitData.createdAt;
        delete splitData.updatedAt;
        // uniqueId is globally unique; split rows must get a new one.
        splitData.uniqueId = await generateUniqueId(srcAsset?.name || srcAsset?.model_number || 'AST');
        splitData.quantity = qtyToAssign;
        splitData.assigned_to = null;
        splitData.assigned_to_external = null;
        splitData.reserved = false;
        splitData.reserved_at = null;
        splitData.reserved_by = '';
        splitData.reservation_note = '';
        splitData.return_pending = false;
        splitData.return_request = null;
        splitData.history = [
          ...(Array.isArray(srcAsset.history) ? srcAsset.history.slice(-20) : []),
          {
            action: 'Created via Quantity Split',
            ticket_number: ticketNumber || 'N/A',
            details: `Created split row with quantity ${qtyToAssign} for assignment`,
            user: req.user.name,
            actor_email: req.user.email || '',
            actor_role: req.user.role || '',
            previous_status: srcAsset.status || '',
            previous_condition: srcAsset.condition || '',
            status: srcAsset.status || '',
            condition: srcAsset.condition || '',
            location: srcAsset.location || '',
            date: new Date()
          }
        ];
        const splitAsset = new Asset(splitData);
        assetsForAssignment = [splitAsset];
      }
    }

    let gatePass = null;
    const updatedAssets = [];

    // Admin can assign either to a technician or to an external person.
    if (technicianId) {
      const finalInstallationLocation = String(installationLocation || '').trim();
      if (!finalInstallationLocation) {
        return res.status(400).json({ message: 'Installation location is required when assigning to a technician' });
      }
      const technician = await User.findById(technicianId).lean();
      if (!technician) {
        return res.status(404).json({ message: 'Technician not found' });
      }

      for (const asset of assetsForAssignment) {
        const prevStatus = asset.status;
        const prevCondition = asset.condition;
        asset.previous_status = asset.status;
        asset.assigned_to = technicianId;
        asset.assigned_to_external = null;
        asset.status = 'In Use';
        asset.location = finalInstallationLocation;
        if (ticketNumber) asset.ticket_number = ticketNumber;
        appendAssetHistory(asset, {
          action: 'Assigned (Admin)',
          req,
          ticketNumber: ticketNumber || 'N/A',
          details: `Installation location: ${finalInstallationLocation}`,
          previousStatus: prevStatus,
          previousCondition: prevCondition,
          location: finalInstallationLocation
        });
        await asset.save();
        updatedAssets.push(asset);

        await ActivityLog.create({
          user: req.user.name,
          email: req.user.email,
          role: req.user.role,
          action: 'Assign Asset',
          details: `Assigned asset ${asset.name} (SN: ${asset.serial_number}) to ${technician.name} (Ticket: ${ticketNumber || 'N/A'})`,
          store: asset.store
        });
      }

      const primaryAsset = updatedAssets[0];
      const targetEmail = String(recipientEmail || technician.email || '').trim().toLowerCase();
      if (needGatePass === true) {
        const finalOrigin = String(gatePassOrigin || primaryAsset.location || '').trim();
        const finalDestination = String(gatePassDestination || technician.name || '').trim();
        if (!ticketNumber) {
          return res.status(400).json({ message: 'Ticket number is required when gate pass is enabled' });
        }
        if (!finalOrigin || !finalDestination) {
          return res.status(400).json({ message: 'Gate pass origin and destination are required' });
        }
        gatePass = await createAssignmentGatePass({
          asset: primaryAsset,
          allAssets: updatedAssets,
          issuedBy: req.user,
          recipientName: technician.name,
          recipientEmail: targetEmail,
          recipientPhone: String(recipientPhone || technician.phone || '').trim(),
          recipientCompany: '',
          ticketNumber,
          origin: finalOrigin,
          destination: finalDestination,
          justification: gatePassJustification
        });
      }
      await notifyAssetEvent({
        asset: primaryAsset,
        recipientEmail: targetEmail,
        subject: 'Asset Assigned to You',
        lines: [
          `Asset assignment update for ${technician.name}.`,
          `Assigned Count: ${updatedAssets.length}`,
          updatedAssets.length === 1 ? `Asset: ${primaryAsset.name}` : `Assets: ${updatedAssets.map((a) => a.name).join(', ')}`,
          updatedAssets.length === 1 ? `Model: ${primaryAsset.model_number || 'N/A'}` : null,
          `Serial(s): ${updatedAssets.map((a) => a.serial_number || 'N/A').join(', ')}`,
          `Store Location: ${primaryAsset.location || 'N/A'}`,
          `Ticket: ${ticketNumber || 'N/A'}`,
          gatePass?.pass_number ? `Gate Pass: ${gatePass.pass_number}` : null,
          gatePass?.origin ? `From: ${gatePass.origin}` : null,
          gatePass?.destination ? `To: ${gatePass.destination}` : null,
          `Action: Assigned by ${req.user.name}`
        ]
      });
      return res.json({
        asset: primaryAsset,
        assets: updatedAssets,
        assignedCount: updatedAssets.length,
        gatePass: gatePass || null
      });
    } else if (otherRecipient && otherRecipient.name) {
      const otherInfo = `Name: ${otherRecipient.name}${otherRecipient.phone ? `, Phone: ${otherRecipient.phone}` : ''}${otherRecipient.note ? `, Note: ${otherRecipient.note}` : ''}`;

      for (const asset of assetsForAssignment) {
        asset.previous_status = asset.status;
        asset.status = 'In Use';
        asset.assigned_to_external = {
          name: otherRecipient.name,
          email: otherRecipient.email,
          phone: otherRecipient.phone,
          note: otherRecipient.note
        };
        asset.assigned_to = null;
        if (ticketNumber) asset.ticket_number = ticketNumber;
        asset.history.push({
          action: `Assigned (External) — ${otherInfo}`,
          ticket_number: ticketNumber || 'N/A',
          user: req.user.name
        });
        await asset.save();
        updatedAssets.push(asset);

        await ActivityLog.create({
          user: req.user.name,
          email: req.user.email,
          role: req.user.role,
          action: 'Assign Asset (External)',
          details: `Assigned asset ${asset.name} (SN: ${asset.serial_number}) externally — ${otherInfo} (Ticket: ${ticketNumber || 'N/A'})`,
          store: asset.store
        });
      }

      const primaryAsset = updatedAssets[0];
      const externalEmail = String(otherRecipient.email || recipientEmail || '').trim().toLowerCase();
      if (needGatePass === true) {
        const finalOrigin = String(gatePassOrigin || primaryAsset.location || '').trim();
        const finalDestination = String(gatePassDestination || otherRecipient.name || '').trim();
        if (!ticketNumber) {
          return res.status(400).json({ message: 'Ticket number is required when gate pass is enabled' });
        }
        if (!finalOrigin || !finalDestination) {
          return res.status(400).json({ message: 'Gate pass origin and destination are required' });
        }
        gatePass = await createAssignmentGatePass({
          asset: primaryAsset,
          allAssets: updatedAssets,
          issuedBy: req.user,
          recipientName: otherRecipient.name,
          recipientEmail: externalEmail,
          recipientPhone: String(recipientPhone || otherRecipient.phone || '').trim(),
          recipientCompany: otherRecipient.note || '',
          ticketNumber,
          origin: finalOrigin,
          destination: finalDestination,
          justification: gatePassJustification || otherRecipient.note || ''
        });
      }
      await notifyAssetEvent({
        asset: primaryAsset,
        recipientEmail: externalEmail,
        subject: 'Asset Assigned to You',
        lines: [
          `Asset assignment update for ${otherRecipient.name}.`,
          `Assigned Count: ${updatedAssets.length}`,
          updatedAssets.length === 1 ? `Asset: ${primaryAsset.name}` : `Assets: ${updatedAssets.map((a) => a.name).join(', ')}`,
          updatedAssets.length === 1 ? `Model: ${primaryAsset.model_number || 'N/A'}` : null,
          `Serial(s): ${updatedAssets.map((a) => a.serial_number || 'N/A').join(', ')}`,
          `Store Location: ${primaryAsset.location || 'N/A'}`,
          `Ticket: ${ticketNumber || 'N/A'}`,
          gatePass?.pass_number ? `Gate Pass: ${gatePass.pass_number}` : null,
          gatePass?.origin ? `From: ${gatePass.origin}` : null,
          gatePass?.destination ? `To: ${gatePass.destination}` : null,
          `Action: Assigned by ${req.user.name}`
        ]
      });
      return res.json({
        asset: primaryAsset,
        assets: updatedAssets,
        assignedCount: updatedAssets.length,
        gatePass: gatePass || null
      });
    } else {
      return res.status(400).json({ message: 'Provide technicianId or otherRecipient.name' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Reserve asset(s) to block issuing
// @route   POST /api/assets/reserve
// @access  Private/Admin
router.post('/reserve', protect, admin, async (req, res) => {
  const { assetId, assetIds, note } = req.body;
  try {
    const normalizedIds = Array.from(
      new Set(
        [
          ...(Array.isArray(assetIds) ? assetIds : []),
          ...(assetId ? [assetId] : [])
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );
    if (normalizedIds.length === 0) {
      return res.status(400).json({ message: 'Provide assetId or assetIds' });
    }

    const assets = await Asset.find({ _id: { $in: normalizedIds } });
    if (assets.length !== normalizedIds.length) {
      return res.status(404).json({ message: 'One or more assets were not found' });
    }
    const accessChecks = await Promise.all(assets.map((asset) => hasAssetStoreAccessDeep(req, asset.store)));
    if (!accessChecks.every(Boolean)) {
      return res.status(403).json({ message: 'One or more assets are outside your store scope' });
    }

    const blocked = assets.filter((a) => a.assigned_to || (a.assigned_to_external && a.assigned_to_external.name));
    if (blocked.length > 0) {
      return res.status(400).json({ message: 'Unassign selected assets before reserving' });
    }

    const reserveNote = String(note || '').trim().slice(0, 300);
    const now = new Date();
    for (const asset of assets) {
      if (asset.reserved === true) continue;
      asset.reserved = true;
      asset.reserved_at = now;
      asset.reserved_by = req.user.name || '';
      asset.reservation_note = reserveNote;
      asset.history.push({
        action: 'Reserved',
        details: reserveNote || 'Reserved for controlled stock',
        user: req.user.name,
        date: now
      });
      await asset.save();
      await ActivityLog.create({
        user: req.user.name,
        email: req.user.email,
        role: req.user.role,
        action: 'Reserve Asset',
        details: `Reserved asset ${asset.name} (SN: ${asset.serial_number || 'N/A'})`,
        store: asset.store
      });
    }

    const refreshed = await Asset.find({ _id: { $in: normalizedIds } })
      .select('name model_number serial_number serial_last_4 mac_address manufacturer ticket_number po_number rfid qr_code uniqueId store location status previous_status condition product_name assigned_to assigned_to_external return_pending return_request reserved reserved_at reserved_by reservation_note source vendor_name delivered_by_name delivered_at device_group inbound_from outbound_to expo_tag abs_code product_number operating_system specification service_tag assign_to_department ip_address building state_comments remarks comments disposed disposed_at disposed_by disposal_reason quantity price customFields history createdAt updatedAt')
      .populate('store', 'name parentStore')
      .populate('assigned_to', 'name email');

    return res.json({
      message: `${normalizedIds.length} asset(s) reserved successfully`,
      items: refreshed
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// @desc    Remove reservation from asset(s)
// @route   POST /api/assets/unreserve
// @access  Private/Admin
router.post('/unreserve', protect, admin, async (req, res) => {
  const { assetId, assetIds } = req.body;
  try {
    const normalizedIds = Array.from(
      new Set(
        [
          ...(Array.isArray(assetIds) ? assetIds : []),
          ...(assetId ? [assetId] : [])
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );
    if (normalizedIds.length === 0) {
      return res.status(400).json({ message: 'Provide assetId or assetIds' });
    }

    const assets = await Asset.find({ _id: { $in: normalizedIds } });
    if (assets.length !== normalizedIds.length) {
      return res.status(404).json({ message: 'One or more assets were not found' });
    }
    const accessChecks = await Promise.all(assets.map((asset) => hasAssetStoreAccessDeep(req, asset.store)));
    if (!accessChecks.every(Boolean)) {
      return res.status(403).json({ message: 'One or more assets are outside your store scope' });
    }

    const now = new Date();
    for (const asset of assets) {
      if (asset.reserved !== true) continue;
      asset.reserved = false;
      asset.reserved_at = null;
      asset.reserved_by = '';
      asset.reservation_note = '';
      asset.history.push({
        action: 'Unreserved',
        user: req.user.name,
        date: now
      });
      await asset.save();
      await ActivityLog.create({
        user: req.user.name,
        email: req.user.email,
        role: req.user.role,
        action: 'Unreserve Asset',
        details: `Unreserved asset ${asset.name} (SN: ${asset.serial_number || 'N/A'})`,
        store: asset.store
      });
    }

    const refreshed = await Asset.find({ _id: { $in: normalizedIds } })
      .select('name model_number serial_number serial_last_4 mac_address manufacturer ticket_number po_number rfid qr_code uniqueId store location status previous_status condition product_name assigned_to assigned_to_external return_pending return_request reserved reserved_at reserved_by reservation_note source vendor_name delivered_by_name delivered_at device_group inbound_from outbound_to expo_tag abs_code product_number operating_system specification service_tag assign_to_department ip_address building state_comments remarks comments disposed disposed_at disposed_by disposal_reason quantity price customFields history createdAt updatedAt')
      .populate('store', 'name parentStore')
      .populate('assigned_to', 'name email');

    return res.json({
      message: `${normalizedIds.length} asset(s) unreserved successfully`,
      items: refreshed
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// @desc    Dispose asset as non-repairable (Admin)
// @route   POST /api/assets/dispose
// @access  Private/Admin
router.post('/dispose', protect, admin, async (req, res) => {
  const { assetId, reason } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      // If no store context is selected for an Admin session, allow action
      // (same behavior as list visibility in this maintenance flow).
      if (scopedStoreId) {
        const scopedStoreIds = await getStoreIds(scopedStoreId);
        const inScope = scopedStoreIds.some((id) => String(id) === String(asset.store || ''));
        if (!inScope) {
          return res.status(403).json({ message: 'Asset is outside your store scope' });
        }
      }
    }
    if (asset.disposed === true) {
      return res.status(400).json({ message: 'Asset is already disposed' });
    }

    asset.disposed = true;
    asset.disposed_at = new Date();
    asset.disposed_by = req.user.name || '';
    asset.disposal_reason = String(reason || '').trim();
    asset.previous_status = asset.status;
    asset.status = 'Missing';
    asset.condition = 'Faulty';
    asset.assigned_to = null;
    asset.assigned_to_external = null;
    asset.return_pending = false;
    asset.return_request = null;
    asset.history.push({
      action: 'Disposed (Not Repairable)',
      details: asset.disposal_reason || 'No reason provided',
      user: req.user.name,
      date: new Date()
    });

    await asset.save();
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Dispose Asset',
      details: `Disposed asset ${asset.name} (SN: ${asset.serial_number})${asset.disposal_reason ? ` - Reason: ${asset.disposal_reason}` : ''}`,
      store: asset.store
    });

    return res.json({ message: 'Asset disposed successfully', asset });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// @desc    Mark faulty asset as repaired from maintenance screen
// @route   POST /api/assets/maintenance/mark-repaired
// @access  Private (non-viewer)
router.post('/maintenance/mark-repaired', protect, restrictViewer, async (req, res) => {
  const { assetId } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      if (scopedStoreId) {
        const scopedStoreIds = await getStoreIds(scopedStoreId);
        const inScope = scopedStoreIds.some((id) => String(id) === String(asset.store || ''));
        if (!inScope) {
          return res.status(403).json({ message: 'Asset is outside your store scope' });
        }
      }
    }

    asset.status = 'In Store';
    asset.condition = 'Repaired';
    // Repaired assets should return to store pool and be collectible again.
    asset.assigned_to = null;
    asset.assigned_to_external = null;
    asset.return_pending = false;
    asset.return_request = null;
    asset.history.push({
      action: 'Marked Repaired',
      details: 'Asset moved to repaired history',
      user: req.user?.name || 'Unknown User',
      date: new Date()
    });
    await asset.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Mark Repaired',
      details: `Marked repaired ${asset.name} (SN: ${asset.serial_number})`,
      store: asset.store
    });

    return res.json({ message: 'Asset marked as repaired', asset });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// @desc    Dispose asset from maintenance screen
// @route   POST /api/assets/maintenance/dispose
// @access  Private (non-viewer)
router.post('/maintenance/dispose', protect, restrictViewer, async (req, res) => {
  const { assetId, reason } = req.body;
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      if (scopedStoreId) {
        const scopedStoreIds = await getStoreIds(scopedStoreId);
        const inScope = scopedStoreIds.some((id) => String(id) === String(asset.store || ''));
        if (!inScope) {
          return res.status(403).json({ message: 'Asset is outside your store scope' });
        }
      }
    }
    if (asset.disposed === true) {
      return res.status(400).json({ message: 'Asset is already disposed' });
    }

    asset.disposed = true;
    asset.disposed_at = new Date();
    asset.disposed_by = req.user?.name || '';
    asset.disposal_reason = String(reason || '').trim();
    asset.previous_status = asset.status;
    asset.status = 'Missing';
    asset.condition = 'Faulty';
    asset.assigned_to = null;
    asset.assigned_to_external = null;
    asset.return_pending = false;
    asset.return_request = null;
    asset.history.push({
      action: 'Disposed (Not Repairable)',
      details: asset.disposal_reason || 'No reason provided',
      user: req.user?.name || 'Unknown User',
      date: new Date()
    });
    await asset.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Dispose Asset',
      details: `Disposed asset ${asset.name} (SN: ${asset.serial_number})${asset.disposal_reason ? ` - Reason: ${asset.disposal_reason}` : ''}`,
      store: asset.store
    });

    return res.json({ message: 'Asset disposed successfully', asset });
  } catch (error) {
    return res.status(500).json({ message: error.message });
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
    if (!hasAssetStoreAccess(req, asset.store)) {
      return res.status(403).json({ message: 'Asset is outside your store scope' });
    }

    if (!asset.assigned_to && (!asset.assigned_to_external || !asset.assigned_to_external.name)) {
      return res.status(400).json({ message: 'Asset is not currently assigned' });
    }

    let previousUser = 'Unknown';
    const previousAssigneeEmail = asset.assigned_to?.email || '';
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
    if (previousAssigneeEmail) {
      await notifyAssetEvent({
        asset,
        recipientEmail: previousAssigneeEmail,
        subject: 'Asset Unassigned',
        lines: [
          'An asset assigned to you has been returned to store.',
          `Asset: ${asset.name}`,
          `Serial: ${asset.serial_number || 'N/A'}`,
          `Action: Unassigned by ${req.user.name}`
        ]
      });
    }

    res.json(asset);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Open line manager collection approval page (public token)
// @route   GET /api/assets/collect-approval/:token
// @access  Public (token)
router.get('/collect-approval/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).send('Invalid approval token');
    const approval = await CollectionApproval.findOne({ token }).lean();
    if (!approval) {
      return res.status(404).send(buildCollectionApprovalHtml({
        title: 'Approval Link Invalid',
        message: 'This approval link is invalid or has been removed.',
        approved: true
      }));
    }
    if (approval.status !== 'Pending') {
      return res.status(200).send(buildCollectionApprovalHtml({
        title: 'Approval Already Processed',
        message: `This request is already ${approval.status.toLowerCase()}.`,
        approved: true
      }));
    }
    if (new Date(approval.expiresAt) <= new Date()) {
      return res.status(410).send(buildCollectionApprovalHtml({
        title: 'Approval Link Expired',
        message: 'This approval request has expired. Ask technician to request again.',
        approved: true
      }));
    }
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
    return res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><title>Technician Collection Approval</title></head><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;"><h2 style="margin:0 0 12px 0;color:#0f172a;">Technician Collection Approval</h2><p style="color:#334155;margin:0 0 16px 0;">Review and confirm to grant line manager permission for this collection request.</p><form method="POST" action="/api/assets/collect-approval/${token}/approve?_csrf=${encodeURIComponent(String(csrfToken || ''))}"><button type="submit" style="display:inline-block;background:#16a34a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;">Grant Permission</button></form></div></body></html>`);
  } catch (error) {
    return res.status(500).send(`Approval error: ${error.message}`);
  }
});

// @desc    Approve technician collection request (public token)
// @route   POST /api/assets/collect-approval/:token/approve
// @access  Public (token)
router.get('/collect-approval/:token/approve', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).send('Invalid approval token');
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
    return res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><title>Confirm Approval</title></head><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;"><h2 style="margin:0 0 12px 0;color:#0f172a;">Confirm Approval</h2><p style="color:#334155;margin:0 0 16px 0;">For security, approval now requires explicit confirmation.</p><form method="POST" action="/api/assets/collect-approval/${token}/approve?_csrf=${encodeURIComponent(String(csrfToken || ''))}"><button type="submit" style="display:inline-block;background:#16a34a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;">Grant Permission</button></form></div></body></html>`);
  } catch (error) {
    return res.status(500).send(`Approval error: ${error.message}`);
  }
});

router.post('/collect-approval/:token/approve', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).send('Invalid approval token');
    const approval = await CollectionApproval.findOne({ token });
    if (!approval) {
      return res.status(404).send(buildCollectionApprovalHtml({
        title: 'Approval Link Invalid',
        message: 'This approval link is invalid or has been removed.',
        approved: true
      }));
    }
    if (approval.status !== 'Pending') {
      return res.status(200).send(buildCollectionApprovalHtml({
        title: 'Approval Already Processed',
        message: `This request is already ${approval.status.toLowerCase()}.`,
        approved: true
      }));
    }
    if (new Date(approval.expiresAt) <= new Date()) {
      approval.status = 'Rejected';
      await approval.save();
      return res.status(410).send(buildCollectionApprovalHtml({
        title: 'Approval Link Expired',
        message: 'This approval request has expired. Ask technician to request again.',
        approved: true
      }));
    }

    approval.status = 'Approved';
    approval.approvedAt = new Date();
    approval.approvedByEmail = approval.lineManagerEmail || 'line-manager-link';
    await approval.save();

    const asset = await Asset.findById(approval.asset).lean();
    if (asset) {
      await ActivityLog.create({
        user: 'Line Manager',
        email: approval.approvedByEmail,
        role: 'Line Manager',
        action: 'Approve Technician Collection',
        details: `Approved collection for ${asset.name} (SN: ${asset.serial_number || 'N/A'})`,
        store: asset.store
      });
    }

    return res.status(200).send(buildCollectionApprovalHtml({
      title: 'Permission Granted',
      message: 'Line manager approval granted successfully. Technician can now collect the asset.',
      approved: true
    }));
  } catch (error) {
    return res.status(500).send(`Approval error: ${error.message}`);
  }
});

// @desc    Collect Material (Technician)
// @route   POST /api/assets/collect
// @access  Private/Technician
router.post('/collect', protect, restrictViewer, async (req, res) => {
  const { assetId, ticketNumber, installationLocation } = req.body;
  try {
    const finalInstallationLocation = String(installationLocation || '').trim();
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    if (!hasAssetStoreAccess(req, asset.store)) {
      return res.status(403).json({ message: 'Asset is outside your store scope' });
    }

    if (asset.disposed === true) {
      return res.status(400).json({ message: 'Disposed asset cannot be collected' });
    }
    if (asset.reserved === true) {
      return res.status(400).json({ message: 'Asset is reserved and cannot be issued' });
    }
    if (String(asset.condition || '').trim().toLowerCase() === 'faulty') {
      return res.status(400).json({ message: 'Asset is not available (Faulty)' });
    }
    if (!finalInstallationLocation) {
      return res.status(400).json({ message: 'Installation location is required' });
    }

    let approvedRequestToConsume = null;
    if (req.user.role === 'Technician') {
      const storeDoc = await Store.findById(asset.store).select('name emailConfig').lean();
      const cfg = storeDoc?.emailConfig || {};
      const approvalRequired = Boolean(cfg.requireLineManagerApprovalForCollection);

      if (approvalRequired) {
        approvedRequestToConsume = await CollectionApproval.findOne({
          asset: asset._id,
          technician: req.user._id,
          status: 'Approved',
          expiresAt: { $gt: new Date() }
        }).sort({ approvedAt: -1 });

        if (!approvedRequestToConsume) {
          let pendingRequest = await CollectionApproval.findOne({
            asset: asset._id,
            technician: req.user._id,
            status: 'Pending',
            expiresAt: { $gt: new Date() }
          }).sort({ createdAt: -1 });

          if (!pendingRequest) {
            const lmRecipients = Array.isArray(cfg.collectionApprovalRecipients) && cfg.collectionApprovalRecipients.length > 0
              ? cfg.collectionApprovalRecipients
              : (Array.isArray(cfg.lineManagerRecipients) ? cfg.lineManagerRecipients : []);
            const uniqueRecipients = Array.from(new Set(
              lmRecipients.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
            ));
            if (uniqueRecipients.length === 0) {
              return res.status(400).json({
                message: 'Line manager approval is enabled but no line manager email is configured. Please contact Super Admin.'
              });
            }

            const token = crypto.randomBytes(24).toString('hex');
            const approvalLink = `${getPublicBaseUrl(req)}/api/assets/collect-approval/${token}`;
            const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000));

            pendingRequest = await CollectionApproval.create({
              token,
              asset: asset._id,
              technician: req.user._id,
              store: asset.store || null,
              ticketNumber: String(ticketNumber || ''),
              installationLocation: String(installationLocation || ''),
              lineManagerEmail: uniqueRecipients.join(','),
              status: 'Pending',
              expiresAt
            });

            const lines = [
              `Technician ${req.user.name} (${req.user.email}) requested to collect an asset.`,
              `Store: ${storeDoc?.name || 'N/A'}`,
              `Asset: ${asset.name}`,
              `Serial: ${asset.serial_number || 'N/A'}`,
              `Ticket: ${ticketNumber || 'N/A'}`,
              `Location: ${installationLocation || 'N/A'}`,
              `Approval link: ${approvalLink}`,
              `This link expires on: ${expiresAt.toLocaleString()}`
            ];
            await sendStoreEmail({
              storeId: asset.store || null,
              to: uniqueRecipients.join(','),
              subject: `Line Manager Approval Required - ${asset.name}`,
              text: lines.join('\n'),
              html: `<div>${lines.map((line) => `<p>${line}</p>`).join('')}</div>`,
              context: 'collection-approval-request'
            });

            await ActivityLog.create({
              user: req.user.name,
              email: req.user.email,
              role: req.user.role,
              action: 'Collection Approval Requested',
              details: `Requested line manager approval for ${asset.name} (SN: ${asset.serial_number || 'N/A'})`,
              store: asset.store
            });
          }

          return res.status(202).json({
            pendingApproval: true,
            message: 'Line manager approval is required. Approval link sent to configured line manager email(s).'
          });
        }
      }
    }

    const prev = asset.status;
    const prevCondition = asset.condition;
    asset.previous_status = prev;
    asset.status = 'In Use';
    asset.assigned_to = req.user._id;
    asset.location = finalInstallationLocation;
    appendAssetHistory(asset, {
      action: prev === 'In Store' ? 'Collected/In Store' : 'Collected',
      req,
      ticketNumber,
      details: `Location: ${finalInstallationLocation}`,
      previousStatus: prev,
      previousCondition: prevCondition,
      location: finalInstallationLocation
    });

    await asset.save();

    if (approvedRequestToConsume) {
      approvedRequestToConsume.status = 'Consumed';
      approvedRequestToConsume.consumedAt = new Date();
      await approvedRequestToConsume.save();
    }

    // Log Activity
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Collect Asset',
      details: [
        `Collected asset ${asset.name} (SN: ${asset.serial_number || 'N/A'})`,
        `Collected By: ${req.user.name} <${req.user.email}>`,
        `Where: ${resolveAuditWhere(asset, finalInstallationLocation)}`,
        `Ticket: ${ticketNumber || 'N/A'}`,
        `At: ${new Date().toISOString()}`
      ].join(' | '),
      store: asset.store
    });

    void notifyAssetEvent({
      asset,
      recipientEmail: req.user.email,
      subject: 'Asset Collected Successfully',
      lines: [
        `You have successfully collected an asset.`,
        `Asset: ${asset.name}`,
        `Serial: ${asset.serial_number || 'N/A'}`,
        `Ticket: ${ticketNumber || 'N/A'}`,
        `Location: ${finalInstallationLocation || 'N/A'}`,
        `Date: ${new Date().toLocaleString()}`
      ]
    }).catch((err) => {
      console.error('Asset notification failed:', err?.message || err);
    });

    res.json(asset);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Generate gate pass after technician bulk collection
// @route   POST /api/assets/collect-gatepass
// @access  Private/Technician
router.post('/collect-gatepass', protect, restrictViewer, async (req, res) => {
  const { assetIds, ticketNumber, installationLocation, justification } = req.body || {};
  try {
    const ids = Array.isArray(assetIds) ? assetIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
    if (ids.length === 0) {
      return res.status(400).json({ message: 'No assets selected for gate pass' });
    }
    if (!ticketNumber) {
      return res.status(400).json({ message: 'Ticket number is required for gate pass' });
    }

    const assets = await Asset.find({ _id: { $in: ids } });
    if (assets.length !== ids.length) {
      return res.status(404).json({ message: 'One or more assets were not found' });
    }

    const uniqueById = new Map();
    assets.forEach((asset) => uniqueById.set(String(asset._id), asset));
    const orderedAssets = ids.map((id) => uniqueById.get(id)).filter(Boolean);

    for (const asset of orderedAssets) {
      if (!hasAssetStoreAccess(req, asset.store)) {
        return res.status(403).json({ message: 'One or more assets are outside your store scope' });
      }
      if (String(asset.assigned_to || '') !== String(req.user._id || '')) {
        return res.status(400).json({ message: `Asset ${asset.serial_number || asset._id} is not assigned to you` });
      }
      if (asset.disposed === true) {
        return res.status(400).json({ message: `Asset ${asset.serial_number || asset._id} is disposed` });
      }
    }

    const pass = await createAssignmentGatePass(
      {
        asset: orderedAssets[0],
        allAssets: orderedAssets,
        issuedBy: req.user,
        recipientName: req.user.name || 'Technician',
        recipientEmail: req.user.email || '',
        recipientPhone: req.user.phone || '',
        recipientCompany: 'Expo Stores',
        ticketNumber,
        origin: orderedAssets[0]?.location || 'Store',
        destination: String(installationLocation || '').trim() || req.user.name || 'Technician',
        justification: String(justification || '').trim() || `Technician bulk collection (${orderedAssets.length} assets)`
      },
      { pendingAdminApproval: true }
    );

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Generate Collection Gate Pass',
      details: `Submitted gate pass ${pass.pass_number} for ${orderedAssets.length} collected asset(s) — pending admin approval`,
      store: orderedAssets[0]?.store || null
    });

    return res.status(201).json({
      message: 'Gate pass saved. An admin must approve it before the final copy is emailed to the technician.',
      passNumber: pass.pass_number,
      passId: pass._id,
      pendingApproval: true,
      emailSent: false,
      emailSkippedReason: 'Awaiting admin approval'
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// @desc    Report Faulty (Technician)
// @route   POST /api/assets/faulty
// @access  Private/Technician
router.post('/faulty', protect, restrictViewer, async (req, res) => {
  const { assetId, ticketNumber, installationLocation } = req.body;
  try {
    const finalInstallationLocation = String(installationLocation || '').trim();
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    // Technician users are typically scoped to a parent store; allow access to the
    // asset if it belongs to the parent store or any descendant child stores.
    if (!(await hasAssetStoreAccessDeep(req, asset.store))) {
      return res.status(403).json({ message: 'Asset is outside your store scope' });
    }
    if (!finalInstallationLocation) {
      return res.status(400).json({ message: 'Installation location is required when reporting faulty' });
    }

    const prevStatus = asset.status;
    const prevCondition = asset.condition;
    asset.previous_status = prevStatus;
    if (asset.status !== 'Missing') {
      asset.status = 'In Store';
    }
    asset.condition = 'Faulty';
    asset.location = finalInstallationLocation;
    appendAssetHistory(asset, {
      action: 'Reported Faulty',
      req,
      ticketNumber,
      details: `Location: ${finalInstallationLocation}`,
      previousStatus: prevStatus,
      previousCondition: prevCondition,
      location: finalInstallationLocation
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

    const prevStatus = asset.status;
    const prevCondition = asset.condition;
    asset.previous_status = prevStatus;
    asset.status = 'In Use';
    
    // Add history
    appendAssetHistory(asset, {
      action: 'In Use',
      req,
      ticketNumber,
      details: location ? `Location: ${location}` : `Marked as In Use by ${req.user.name}`,
      previousStatus: prevStatus,
      previousCondition: prevCondition,
      location: location || asset.location
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
    await notifyAssetEvent({
      asset,
      recipientEmail: req.user.email,
      subject: 'Asset Marked In Use',
      lines: [
        `Asset movement event completed.`,
        `Asset: ${asset.name}`,
        `Serial: ${asset.serial_number || 'N/A'}`,
        `Ticket: ${ticketNumber || 'N/A'}`,
        `Location: ${location || 'N/A'}`,
        `Action: In Use`
      ]
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
    if (!hasAssetStoreAccess(req, asset.store)) {
      return res.status(403).json({ message: 'Asset is outside your store scope' });
    }
    // Convert condition
    const condRaw = String(condition || '').trim().toLowerCase();
    const condMap = { new: 'New', used: 'Used', faulty: 'Faulty', repaired: 'Repaired', 'under repair': 'Repaired' };
    const cond = condMap[condRaw];
    if (!cond) return res.status(400).json({ message: 'Invalid return condition' });
    
    // Auto-approve return logic
    const prevStatus = asset.status;
    const prevCondition = asset.condition;
    asset.previous_status = prevStatus;
    
    asset.status = 'In Store';
    asset.condition = cond;
    asset.assigned_to = null;
    asset.assigned_to_external = null;
    
    // Clear any pending requests
    asset.return_pending = false;
    asset.return_request = null;

    appendAssetHistory(asset, {
      action: `Returned/${cond}`,
      req,
      ticketNumber,
      details: `Auto-approved return from ${req.user.name}`,
      previousStatus: prevStatus,
      previousCondition: prevCondition
    });

    await asset.save();
    
    // Log activity
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Return Asset',
      details: [
        `Returned asset ${asset.name} (SN: ${asset.serial_number || 'N/A'}) as ${cond}`,
        `Returned By: ${req.user.name} <${req.user.email}>`,
        `From Location: ${resolveAuditWhere(asset)}`,
        `Ticket: ${ticketNumber || 'N/A'}`,
        `At: ${new Date().toISOString()}`
      ].join(' | '),
      store: asset.store
    });
    await notifyAssetEvent({
      asset,
      recipientEmail: req.user.email,
      subject: 'Asset Returned Successfully',
      lines: [
        `Asset movement event completed.`,
        `Asset: ${asset.name}`,
        `Serial: ${asset.serial_number || 'N/A'}`,
        `Ticket: ${ticketNumber || 'N/A'}`,
        `Condition: ${cond}`,
        `Action: Returned to store`
      ]
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
    const condMap = { new: 'New', used: 'Used', faulty: 'Faulty', repaired: 'Repaired', 'under repair': 'Repaired' };
    const cond = condMap[condRaw];
    if (!cond) return res.status(400).json({ message: 'Invalid return condition' });
    
    // Auto-approve return logic
    const prevStatus = asset.status;
    const prevCondition = asset.condition;
    asset.previous_status = prevStatus;
    asset.status = 'In Store';
    asset.condition = cond;
    asset.assigned_to = null;
    asset.assigned_to_external = null;
    asset.return_pending = false;
    asset.return_request = null;

    appendAssetHistory(asset, {
      action: `Returned/${cond}`,
      req,
      ticketNumber,
      details: `Auto-approved return from ${req.user.name}`,
      previousStatus: prevStatus,
      previousCondition: prevCondition
    });
    
    await asset.save();
    
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Return Asset',
      details: [
        `Returned asset ${asset.name} (SN: ${asset.serial_number || 'N/A'}) as ${cond}`,
        `Returned By: ${req.user.name} <${req.user.email}>`,
        `From Location: ${resolveAuditWhere(asset)}`,
        `Ticket: ${ticketNumber || 'N/A'}`,
        `At: ${new Date().toISOString()}`
      ].join(' | '),
      store: asset.store
    });
    await notifyAssetEvent({
      asset,
      recipientEmail: req.user.email,
      subject: 'Asset Return Completed',
      lines: [
        `Asset movement event completed.`,
        `Asset: ${asset.name}`,
        `Serial: ${asset.serial_number || 'N/A'}`,
        `Ticket: ${ticketNumber || 'N/A'}`,
        `Condition: ${cond}`,
        `Action: Returned`
      ]
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
    const requestedBy = asset.return_request.requested_by;
    const prevStatus = asset.status;
    const prevCondition = asset.condition;
    asset.assigned_to = undefined;
    asset.previous_status = prevStatus;
    asset.status = 'In Store';
    asset.condition = cond;
    asset.return_pending = false;
    asset.return_request = undefined;
    appendAssetHistory(asset, {
      action: `Returned/${cond}`,
      req,
      ticketNumber,
      details: 'Return approved by admin',
      previousStatus: prevStatus,
      previousCondition: prevCondition
    });
    await asset.save();
    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Approve Return',
      details: [
        `Approved return of ${asset.name} (SN: ${asset.serial_number || 'N/A'}) as ${cond}`,
        `Approved By: ${req.user.name} <${req.user.email}>`,
        `Original Requested By: ${requestedBy ? String(requestedBy) : 'N/A'}`,
        `Ticket: ${ticketNumber || 'N/A'}`,
        `At: ${new Date().toISOString()}`
      ].join(' | '),
      store: asset.store
    });
    if (requestedBy) {
      const requester = await User.findById(requestedBy).lean();
      await notifyAssetEvent({
        asset,
        recipientEmail: requester?.email,
        subject: 'Asset Return Approved',
        lines: [
          'Your return request was approved.',
          `Asset: ${asset.name}`,
          `Serial: ${asset.serial_number || 'N/A'}`,
          `Ticket: ${ticketNumber || 'N/A'}`,
          `Condition: ${cond}`
        ]
      });
    }
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
    const requestedBy = asset.return_request.requested_by;
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
      details: [
        `Rejected return of ${asset.name} (SN: ${asset.serial_number || 'N/A'})`,
        `Rejected By: ${req.user.name} <${req.user.email}>`,
        `Original Requested By: ${requestedBy ? String(requestedBy) : 'N/A'}`,
        `Ticket: ${ticketNumber || 'N/A'}`,
        reason ? `Reason: ${reason}` : null,
        `At: ${new Date().toISOString()}`
      ].filter(Boolean).join(' | '),
      store: asset.store
    });
    if (requestedBy) {
      const requester = await User.findById(requestedBy).lean();
      await notifyAssetEvent({
        asset,
        recipientEmail: requester?.email,
        subject: 'Asset Return Rejected',
        lines: [
          'Your return request was rejected.',
          `Asset: ${asset.name}`,
          `Serial: ${asset.serial_number || 'N/A'}`,
          `Ticket: ${ticketNumber || 'N/A'}`,
          reason ? `Reason: ${reason}` : null
        ]
      });
    }
    res.json({ message: 'Return rejected', asset });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Update asset
// @route   PUT /api/assets/:id
// @access  Private/Admin
router.post('/:id/comment', protect, restrictViewer, async (req, res) => {
  try {
    const rawComment = String(req.body?.comment || '').trim();
    if (!rawComment) {
      return res.status(400).json({ message: 'Comment is required' });
    }
    if (rawComment.length > 500) {
      return res.status(400).json({ message: 'Comment is too long (max 500 characters)' });
    }

    const asset = await Asset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    if (!hasAssetStoreAccess(req, asset.store)) {
      return res.status(403).json({ message: 'Asset is outside your store scope' });
    }

    asset.history.push({
      action: 'Comment Added',
      details: rawComment,
      user: req.user.name,
      ticket_number: asset.ticket_number || '',
      date: new Date()
    });
    await asset.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Asset Comment',
      details: `Added comment on ${asset.name} (${asset.uniqueId || asset.serial_number || asset._id})`,
      store: asset.store
    });

    res.json({ message: 'Comment added to asset history', asset });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id', protect, admin, async (req, res) => {
  const {
    name, model_number, serial_number, mac_address, manufacturer, store, location, status, condition,
    ticket_number, po_number, product_name, rfid, qr_code, vendor_name, delivered_by_name, price, quantity, customFields,
    device_group, inbound_from, outbound_to, expo_tag, abs_code, product_number,
    operating_system, specification, service_tag, assign_to_department,
    ip_address, building, state_comments, remarks, comments, disposed, reserved
  } = req.body;
  try {
    const asset = await Asset.findById(req.params.id);
    if (asset) {
      if (req.user?.role !== 'Super Admin') {
        const scopedStoreId = getScopedStoreId(req);
        // If no store context is selected for an Admin session, allow edit
        // (same behavior as list visibility in this maintenance flow).
        if (scopedStoreId) {
          const scopedStoreIds = await getStoreIds(scopedStoreId);
          const inScope = scopedStoreIds.some((id) => String(id) === String(asset.store || ''));
          if (!inScope) {
            return res.status(403).json({ message: 'Asset is outside your store scope' });
          }
        }
      }
      const oldSerial = asset.serial_number;
      const before = {
        status: String(asset.status || ''),
        condition: String(asset.condition || ''),
        reserved: Boolean(asset.reserved),
        disposed: Boolean(asset.disposed),
        location: String(asset.location || ''),
        ticketNumber: String(asset.ticket_number || '')
      };
      let prodName = product_name ? String(product_name) : '';
      asset.name = name ? capitalizeWords(name) : asset.name;
      asset.model_number = model_number || asset.model_number;
      asset.serial_number = serial_number || asset.serial_number;
      asset.serial_last_4 = asset.serial_number.slice(-4);
      asset.mac_address = mac_address || asset.mac_address;
      asset.manufacturer = manufacturer ? capitalizeWords(manufacturer) : (asset.manufacturer || '');
      asset.ticket_number = ticket_number || asset.ticket_number || '';
      if (po_number !== undefined) asset.po_number = po_number || '';
      if (vendor_name !== undefined) asset.vendor_name = capitalizeWords(vendor_name || '');
      if (delivered_by_name !== undefined) asset.delivered_by_name = capitalizeWords(delivered_by_name || '');
      if (device_group !== undefined) asset.device_group = capitalizeWords(device_group || '');
      if (inbound_from !== undefined) asset.inbound_from = capitalizeWords(inbound_from || '');
      if (outbound_to !== undefined) asset.outbound_to = capitalizeWords(outbound_to || '');
      if (expo_tag !== undefined) asset.expo_tag = String(expo_tag || '').trim();
      if (abs_code !== undefined) asset.abs_code = String(abs_code || '').trim();
      if (product_number !== undefined) asset.product_number = String(product_number || '').trim();
      if (operating_system !== undefined) asset.operating_system = String(operating_system || '').trim();
      if (specification !== undefined) asset.specification = String(specification || '').trim();
      if (service_tag !== undefined) asset.service_tag = String(service_tag || '').trim();
      if (assign_to_department !== undefined) asset.assign_to_department = String(assign_to_department || '').trim();
      if (ip_address !== undefined) asset.ip_address = String(ip_address || '').trim();
      if (building !== undefined) asset.building = capitalizeWords(building || '');
      if (state_comments !== undefined) asset.state_comments = String(state_comments || '').trim();
      if (remarks !== undefined) asset.remarks = String(remarks || '').trim();
      if (comments !== undefined) asset.comments = String(comments || '').trim();
      if (price !== undefined && price !== '') {
        const parsedPrice = Number(price);
        if (Number.isFinite(parsedPrice)) asset.price = parsedPrice;
      }
      if (quantity !== undefined && quantity !== '') {
        const parsedQty = Number.parseInt(quantity, 10);
        if (Number.isFinite(parsedQty) && parsedQty > 0) {
          const currentQty = Number.parseInt(asset.quantity, 10) > 0 ? Number.parseInt(asset.quantity, 10) : 1;
          const isCurrentlyAssigned = Boolean(asset.assigned_to || (asset.assigned_to_external && asset.assigned_to_external.name));
          if (isCurrentlyAssigned && parsedQty < currentQty) {
            return res.status(400).json({
              message: 'Cannot reduce quantity while asset is assigned. Unassign/split first, then update quantity.'
            });
          }
          asset.quantity = parsedQty;
        }
      }
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
      // Normalize status/condition to allowed values.
      let normStatus = status || asset.status;
      let normCondition = condition || asset.condition;
      if (typeof normStatus === 'string') {
        const s = normStatus.trim().toLowerCase();
        if (s === 'spare' || s === 'faulty' || s === 'disposed' || s === 'scrapped') normStatus = 'In Store';
        if (s === 'under repair' || s === 'under repair/workshop') normStatus = 'Under Repair/Workshop';
      }
      if (typeof normCondition === 'string') {
        const c = normCondition.trim().toLowerCase();
        if (c === 'under repair') normCondition = 'Repaired';
        if (c === 'under repair/workshop') normCondition = 'Under Repair/Workshop';
        if (c === 'workshop') normCondition = 'Workshop';
        if (c === 'disposed' || c === 'scrapped' || c === 'scrap') normCondition = 'Faulty';
      }
      if (
        typeof status === 'string'
        && (status.trim().toLowerCase() === 'under repair' || status.trim().toLowerCase() === 'under repair/workshop')
      ) {
        normStatus = 'Under Repair/Workshop';
        normCondition = 'Under Repair/Workshop';
      }
      asset.status = normStatus;
      asset.condition = normCondition;
      if (before.status !== String(asset.status || '')) {
        asset.previous_status = before.status || asset.previous_status;
      }
      if (disposed !== undefined) {
        const nextDisposed = disposed === true || String(disposed).toLowerCase() === 'true';
        asset.disposed = nextDisposed;
        if (nextDisposed) {
          asset.disposed_at = asset.disposed_at || new Date();
          asset.disposed_by = String(req.user?.name || req.user?.email || 'System');
          asset.status = 'In Store';
          asset.condition = 'Faulty';
        } else {
          asset.disposed_at = null;
          asset.disposed_by = '';
        }
      }
      if (reserved !== undefined) {
        const nextReserved = reserved === true || String(reserved).toLowerCase() === 'true';
        asset.reserved = nextReserved;
        if (nextReserved) {
          asset.reserved_at = asset.reserved_at || new Date();
          asset.reserved_by = asset.reserved_by || String(req.user?.name || req.user?.email || '');
        } else {
          asset.reserved_at = null;
          asset.reserved_by = '';
          asset.reservation_note = '';
        }
      }
      if (customFields && typeof customFields === 'object' && !Array.isArray(customFields)) {
        asset.customFields = {
          ...(asset.customFields && typeof asset.customFields === 'object' ? asset.customFields : {}),
          ...sanitizeCustomFieldsPayload(customFields)
        };
      }

      const after = {
        status: String(asset.status || ''),
        condition: String(asset.condition || ''),
        reserved: Boolean(asset.reserved),
        disposed: Boolean(asset.disposed),
        location: String(asset.location || ''),
        ticketNumber: String(asset.ticket_number || '')
      };
      const historyCountBefore = Array.isArray(asset.history) ? asset.history.length : 0;

      const transitionParts = [];
      if (before.status !== after.status) transitionParts.push(`Status: ${before.status || '-'} -> ${after.status || '-'}`);
      if (before.condition !== after.condition) transitionParts.push(`Condition: ${before.condition || '-'} -> ${after.condition || '-'}`);
      if (before.location !== after.location) transitionParts.push(`Location: ${before.location || '-'} -> ${after.location || '-'}`);
      if (before.ticketNumber !== after.ticketNumber) transitionParts.push(`Ticket: ${before.ticketNumber || '-'} -> ${after.ticketNumber || '-'}`);

      if (before.reserved !== after.reserved) {
        appendAssetHistory(asset, {
          action: after.reserved ? 'Reserved' : 'Unreserved',
          req,
          ticketNumber: after.ticketNumber || '',
          details: after.reserved ? 'Reserved via Edit Asset' : 'Unreserved via Edit Asset',
          previousStatus: before.status,
          previousCondition: before.condition,
          location: after.location
        });
      }
      if (before.disposed !== after.disposed) {
        appendAssetHistory(asset, {
          action: after.disposed ? 'Disposed (Not Repairable)' : 'Restored from Disposed',
          req,
          ticketNumber: after.ticketNumber || '',
          details: after.disposed ? 'Disposed via Edit Asset' : 'Disposed flag removed via Edit Asset',
          previousStatus: before.status,
          previousCondition: before.condition,
          location: after.location
        });
      }
      if (before.condition.toLowerCase() !== 'faulty' && after.condition.toLowerCase() === 'faulty') {
        appendAssetHistory(asset, {
          action: 'Marked Faulty (Edit)',
          req,
          ticketNumber: after.ticketNumber || '',
          details: transitionParts.join(' | ') || 'Condition changed to Faulty via Edit Asset',
          previousStatus: before.status,
          previousCondition: before.condition,
          location: after.location
        });
      } else if (transitionParts.length > 0) {
        appendAssetHistory(asset, {
          action: 'Edit Asset',
          req,
          ticketNumber: after.ticketNumber || '',
          details: transitionParts.join(' | '),
          previousStatus: before.status,
          previousCondition: before.condition,
          location: after.location
        });
      }
      if ((Array.isArray(asset.history) ? asset.history.length : 0) === historyCountBefore) {
        appendAssetHistory(asset, {
          action: 'Edit Asset',
          req,
          ticketNumber: after.ticketNumber || '',
          details: 'Asset updated via Edit Asset',
          previousStatus: before.status,
          previousCondition: before.condition,
          location: after.location
        });
      }

      const updatedAsset = await asset.save();

      // Log activity (+ mark maintenance candidate when condition is Faulty)
      await ActivityLog.create({
        user: req.user.name,
        email: req.user.email,
        role: req.user.role,
        action: 'Edit Asset',
        details: `Edited asset ${updatedAsset.name} (SN: ${oldSerial} -> ${updatedAsset.serial_number})`,
        store: updatedAsset.store
      });
      if (updatedAsset.condition === 'Faulty') {
        await ActivityLog.create({
          user: req.user.name,
          email: req.user.email,
          role: req.user.role,
          action: 'Queued for Maintenance',
          details: `Asset ${updatedAsset.name} marked for maintenance (status: ${updatedAsset.status}, condition: ${updatedAsset.condition})`,
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
            if (!hasAssetStoreAccess(req, asset.store)) {
              return res.status(403).json({ message: 'Asset is outside your store scope' });
            }
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
    const query = {};
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      if (!scopedStoreId) {
        return res.status(403).json({ message: 'Store context is required to view activity logs' });
      }
      const scopedStoreIds = await getStoreIds(scopedStoreId);
      query.store = { $in: scopedStoreIds };
    }
    const logs = await ActivityLog.find(query).sort({ createdAt: -1 }).limit(100);
    res.json(logs);
  } catch (error) {
    console.error('Error in GET /activity-logs:', error);
    res.status(500).json({ message: error.message });
  }
});

// @desc    Recent technician activity (admin)
// @route   GET /api/assets/recent-activity
// @access  Private/Admin
router.get('/recent-asset-history', protect, admin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const pipeline = [];
    if (req.user?.role !== 'Super Admin') {
      const scopedStoreId = getScopedStoreId(req);
      if (!scopedStoreId) {
        return res.status(403).json({ message: 'Store context is required to view recent activity' });
      }
      const scopedStoreIds = await getStoreIds(scopedStoreId);
      pipeline.push({ $match: { store: { $in: scopedStoreIds } } });
    }
    pipeline.push(
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
    );
    const events = await Asset.aggregate(pipeline);
    res.json(events);
  } catch (error) {
    console.error('Error in GET /recent-activity:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
