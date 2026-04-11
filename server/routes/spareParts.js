const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const router = express.Router();
const mongoose = require('mongoose');
const SparePart = require('../models/SparePart');
const Asset = require('../models/Asset');
const User = require('../models/User');
const Store = require('../models/Store');
const Vendor = require('../models/Vendor');
const PurchaseOrder = require('../models/PurchaseOrder');
const ActivityLog = require('../models/ActivityLog');
const { protect, adminOrViewer, restrictViewer } = require('../middleware/authMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const normalize = (v) => String(v || '').trim();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const managerLikeRole = (role) => String(role || '').toLowerCase().includes('manager');

const canAdminSpareAssign = (user) =>
  Boolean(user && (user.role === 'Admin' || user.role === 'Super Admin' || managerLikeRole(user.role)));

const cellVal = (v) => {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v.text != null) return normalize(v.text);
  if (typeof v === 'object' && Array.isArray(v.richText)) {
    return normalize(v.richText.map((x) => x.text).join(''));
  }
  if (typeof v === 'object' && v.result != null) return normalize(String(v.result));
  return normalize(String(v));
};

const storeChainLabelById = async (storeId) => {
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) return '';
  const s = await Store.findById(storeId).select('name parentStore').populate('parentStore', 'name').lean();
  if (!s) return '';
  const p = normalize(s.parentStore?.name);
  const n = normalize(s.name);
  return p && n ? `${p} › ${n}` : (n || p);
};

const assertLocationIsChild = async (locationStoreId, mainStoreId) => {
  if (!mainStoreId) {
    const e = new Error('Store context is required to link a receipt location');
    e.statusCode = 400;
    throw e;
  }
  const loc = await Store.findById(locationStoreId).select('parentStore isMainStore').lean();
  if (!loc) {
    const e = new Error('Linked receipt location not found');
    e.statusCode = 400;
    throw e;
  }
  if (loc.isMainStore || String(loc.parentStore || '') !== String(mainStoreId)) {
    const e = new Error('Receipt location must be a Locations (child) site under this store');
    e.statusCode = 400;
    throw e;
  }
};

const resolveLocationStoreFromCell = async (mainStoreId, rawCell) => {
  const raw = normalize(rawCell);
  if (!raw) return null;
  if (mongoose.Types.ObjectId.isValid(raw) && String(new mongoose.Types.ObjectId(raw)) === raw) {
    const loc = await Store.findById(raw).select('parentStore isMainStore').lean();
    if (loc && !loc.isMainStore && String(loc.parentStore) === String(mainStoreId)) {
      return new mongoose.Types.ObjectId(raw);
    }
    return null;
  }
  const sep = raw.includes('›') ? '›' : (raw.includes('>') ? '>' : null);
  const childName = sep ? normalize(raw.split(sep).pop()) : raw;
  if (!childName) return null;
  const child = await Store.findOne({
    parentStore: mainStoreId,
    name: new RegExp(`^${escapeRegex(childName)}$`, 'i')
  })
    .select('_id')
    .lean();
  return child ? child._id : null;
};

const resolveReceiptLocationFields = async (storeId, body) => {
  const lsRaw = body.receiptLocationStore;
  const detail = normalize(body.receiptLocationDetail);
  const free = normalize(body.receiptLocation);
  if (lsRaw && mongoose.Types.ObjectId.isValid(String(lsRaw))) {
    await assertLocationIsChild(lsRaw, storeId);
    const chain = await storeChainLabelById(lsRaw);
    return {
      receiptLocationStore: lsRaw,
      receiptLocationDetail: detail,
      receiptLocation: [chain, detail].filter(Boolean).join(' — ')
    };
  }
  return {
    receiptLocationStore: null,
    receiptLocationDetail: '',
    receiptLocation: free
  };
};

const populateSparePartRefs = (q) =>
  q
    .populate('vendor', 'name status contactPerson phone')
    .populate({
      path: 'purchaseOrder',
      select: 'poNumber status grandTotal orderDate vendor',
      populate: { path: 'vendor', select: 'name' }
    })
    .populate({
      path: 'receiptLocationStore',
      select: 'name parentStore',
      populate: { path: 'parentStore', select: 'name' }
    });

const SP_IMPORT_HEADERS = [
  'Name',
  'Part number',
  'Type',
  'Compatible models',
  'Bin / shelf',
  'Quantity',
  'Min quantity',
  'Vendor name',
  'PO number',
  'When received',
  'Receipt location link',
  'Receipt location detail',
  'Comment'
];

const findVendorByName = async (storeId, name) => {
  const n = normalize(name);
  if (!n || !storeId) return null;
  return Vendor.findOne({ store: storeId, name: new RegExp(`^${escapeRegex(n)}$`, 'i') })
    .select('_id name')
    .lean();
};

const findPoByNumber = async (storeId, poNumber) => {
  const n = normalize(poNumber);
  if (!n || !storeId) return null;
  return PurchaseOrder.findOne({ store: storeId, poNumber: new RegExp(`^${escapeRegex(n)}$`, 'i') })
    .select('_id vendor poNumber')
    .lean();
};

function unwrapValueLayers(v, maxDepth = 12) {
  let x = v;
  let d = 0;
  while (
    x != null &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    !(x instanceof Date) &&
    Object.prototype.hasOwnProperty.call(x, 'value') &&
    d < maxDepth
  ) {
    x = x.value;
    d += 1;
  }
  return x;
}

const toNumber = (v, fallback = 0) => {
  const x = unwrapValueLayers(v);
  if (typeof x === 'number') return Number.isFinite(x) ? x : fallback;
  if (x === null || x === undefined || x === '') return fallback;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
};

const toDate = (v, fallback = null) => {
  if (v === null || v === undefined || v === '') return fallback;
  const x = unwrapValueLayers(v);
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return fallback;
  return d;
};

/**
 * Validates vendor + PO belong to store and are mutually consistent.
 * If only PO is set, vendor is taken from the PO.
 */
const resolveReceiptLinks = async (storeId, vendorIdRaw, poIdRaw) => {
  let vendorId = mongoose.Types.ObjectId.isValid(String(vendorIdRaw || '')) ? vendorIdRaw : null;
  let poId = mongoose.Types.ObjectId.isValid(String(poIdRaw || '')) ? poIdRaw : null;

  if (!storeId) {
    const e = new Error('Store is required');
    e.statusCode = 400;
    throw e;
  }

  let poDoc = null;
  if (poId) {
    poDoc = await PurchaseOrder.findById(poId).select('vendor store poNumber').lean();
    if (!poDoc) {
      const e = new Error('Purchase order not found');
      e.statusCode = 404;
      throw e;
    }
    if (String(poDoc.store) !== String(storeId)) {
      const e = new Error('Purchase order does not belong to this store');
      e.statusCode = 400;
      throw e;
    }
    if (vendorId && String(poDoc.vendor) !== String(vendorId)) {
      const e = new Error('Selected purchase order does not match the selected vendor');
      e.statusCode = 400;
      throw e;
    }
    if (!vendorId) {
      vendorId = poDoc.vendor;
    }
  }

  let vendorDoc = null;
  if (vendorId) {
    vendorDoc = await Vendor.findById(vendorId).select('name store').lean();
    if (!vendorDoc) {
      const e = new Error('Vendor not found');
      e.statusCode = 404;
      throw e;
    }
    if (String(vendorDoc.store) !== String(storeId)) {
      const e = new Error('Vendor does not belong to this store');
      e.statusCode = 400;
      throw e;
    }
  }

  const vendorNameSnapshot = vendorDoc ? normalize(vendorDoc.name) : '';
  const poNumberSnapshot = poDoc ? normalize(poDoc.poNumber) : '';

  return {
    vendor: vendorId || null,
    purchaseOrder: poId || null,
    vendorNameSnapshot,
    poNumberSnapshot
  };
};

const buildPurchaseLotLabel = ({ vendorNameSnapshot, poNumberSnapshot, receiptLocation }) => {
  const bits = ['Purchase / new stock'];
  if (normalize(poNumberSnapshot)) bits.push(`PO ${normalize(poNumberSnapshot)}`);
  if (normalize(vendorNameSnapshot)) bits.push(`Vendor: ${normalize(vendorNameSnapshot)}`);
  if (normalize(receiptLocation)) bits.push(`Received @ ${normalize(receiptLocation)}`);
  return bits.join(' — ');
};

const canAccess = (req, item) => {
  if (req.user.role === 'Super Admin') return true;
  if (!req.activeStore || !item?.store) return false;
  return String(req.activeStore) === String(item.store);
};

const canAccessAssetStore = (req, asset) => {
  if (req.user.role === 'Super Admin') return true;
  if (!asset?.store || !req.activeStore) return false;
  return String(req.activeStore) === String(asset.store);
};

const sumLotsRemaining = (doc) => (doc.stockLots || []).reduce(
  (s, l) => s + Math.max(0, toNumber(l.quantityRemaining, 0)),
  0
);

/** Older rows may have quantity but no lots; back-fill a single anonymous lot so FIFO stays consistent. */
const ensureLotsCoverQuantity = (doc) => {
  if (!Array.isArray(doc.stockLots)) doc.stockLots = [];
  const q = Math.max(0, toNumber(doc.quantity, 0));
  const sum = sumLotsRemaining(doc);
  if (sum < q - 1e-6) {
    doc.stockLots.push({
      sourceAssetId: null,
      sourceAssetLabel: 'Legacy / unidentified on-hand stock',
      quantityRemaining: q - sum,
      quantityInitial: q - sum,
      harvestedAt: doc.createdAt || new Date(0),
      harvestTicket: '',
      harvestActorName: '',
      harvestActorEmail: ''
    });
  }
  doc.markModified('stockLots');
};

/**
 * Consume quantity FIFO by harvestedAt. Mutates doc.stockLots and doc.quantity.
 * @returns {Map<string, { label: string, qty: number }>} donor key -> aggregate (key "__pool__" = no donor)
 */
const consumeStockLotsFifo = (doc, consumeQty) => {
  ensureLotsCoverQuantity(doc);
  const donorMap = new Map();
  let left = Math.max(0, toNumber(consumeQty, 0));
  const lots = doc.stockLots || [];
  const ordered = [...lots].map((lot) => lot).sort(
    (a, b) => new Date(a.harvestedAt || 0).getTime() - new Date(b.harvestedAt || 0).getTime()
  );

  for (const lot of ordered) {
    if (left <= 0) break;
    const rem = Math.max(0, toNumber(lot.quantityRemaining, 0));
    if (rem <= 0) continue;
    const take = Math.min(left, rem);
    lot.quantityRemaining = rem - take;
    left -= take;

    const key = lot.sourceAssetId ? String(lot.sourceAssetId) : '__pool__';
    const label = lot.sourceAssetId
      ? normalize(lot.sourceAssetLabel) || key
      : 'Manual / unidentified pool';
    const cur = donorMap.get(key) || { label, qty: 0 };
    cur.qty += take;
    if (lot.sourceAssetLabel) cur.label = normalize(lot.sourceAssetLabel);
    donorMap.set(key, cur);
  }

  if (left > 0) {
    const err = new Error('LOT_UNDERFLOW');
    err.code = 'LOT_UNDERFLOW';
    throw err;
  }

  doc.quantity = sumLotsRemaining(doc);
  doc.markModified('stockLots');
  return donorMap;
};

const pushAssetSparePartAudit = (asset, { req, action, details, ticketNumber = '' }) => {
  if (!asset || !action) return;
  const lastEvent = Array.isArray(asset.history) && asset.history.length > 0
    ? asset.history[asset.history.length - 1]
    : null;
  asset.history.push({
    action: String(action),
    ticket_number: String(ticketNumber || '').trim(),
    details: String(details || '').trim(),
    user: String(req?.user?.name || '').trim(),
    actor_email: String(req?.user?.email || '').trim(),
    actor_role: String(req?.user?.role || '').trim(),
    previous_status: String(lastEvent?.status || asset.previous_status || '').trim(),
    previous_condition: String(lastEvent?.condition || '').trim(),
    status: String(asset.status || '').trim(),
    condition: String(asset.condition || '').trim(),
    location: String(asset.location || '').trim(),
    store_name: String(asset?.store?.name || asset?.store?.store_name || '').trim(),
    date: new Date()
  });
};

const pushAssetHarvestHistory = (asset, { req, details, ticketNumber = '' }) => {
  pushAssetSparePartAudit(asset, { req, action: 'Spare Parts Harvested', details, ticketNumber });
};

const pushPartHistory = (doc, {
  action,
  actor,
  quantity = 0,
  quantityAfter = 0,
  note = '',
  sourceAssetId = null,
  sourceAssetLabel = '',
  targetAssetId = null,
  targetAssetLabel = '',
  ticketNumber = '',
  usedAtLocation = '',
  donorTraceSummary = '',
  recipientUserId = null,
  recipientUserName = '',
  recipientExternalName = '',
  recipientExternalEmail = '',
  recipientExternalPhone = '',
  assignmentGatePassSummary = ''
}) => {
  doc.history.push({
    action,
    actorId: actor?._id || null,
    actorName: actor?.name || '',
    quantity: Math.max(toNumber(quantity, 0), 0),
    quantityAfter: Math.max(toNumber(quantityAfter, 0), 0),
    note: normalize(note),
    sourceAssetId: sourceAssetId || null,
    sourceAssetLabel: normalize(sourceAssetLabel),
    targetAssetId: targetAssetId || null,
    targetAssetLabel: normalize(targetAssetLabel),
    ticketNumber: normalize(ticketNumber),
    usedAtLocation: normalize(usedAtLocation),
    donorTraceSummary: normalize(donorTraceSummary),
    recipientUserId: recipientUserId || null,
    recipientUserName: normalize(recipientUserName),
    recipientExternalName: normalize(recipientExternalName),
    recipientExternalEmail: normalize(recipientExternalEmail),
    recipientExternalPhone: normalize(recipientExternalPhone),
    assignmentGatePassSummary: normalize(assignmentGatePassSummary)
  });
};

const formatDonorTraceSummary = (donorMap) => {
  const parts = [];
  for (const [key, v] of donorMap) {
    if (!v?.qty) continue;
    parts.push(`${v.label}: ${v.qty}`);
  }
  return parts.join('; ');
};

const resolveStoreId = (req) => {
  if (req.user.role === 'Super Admin') {
    return req.body.store || req.activeStore || null;
  }
  return req.activeStore || req.user.assignedStore || null;
};

// @desc    List spare parts
// @route   GET /api/spare-parts
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const q = normalize(req.query.q);
    const filter = {};
    if (req.activeStore) filter.store = req.activeStore;

    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { name: rx },
        { part_number: rx },
        { type: rx },
        { compatible_models: rx },
        { location: rx },
        { comment: rx },
        { vendorNameSnapshot: rx },
        { poNumberSnapshot: rx },
        { receiptLocation: rx }
      ];
    }

    const rows = await SparePart.find(filter)
      .sort({ updatedAt: -1 })
      .populate('store', 'name')
      .populate('vendor', 'name status contactPerson phone')
      .populate({
        path: 'purchaseOrder',
        select: 'poNumber status grandTotal orderDate vendor',
        populate: { path: 'vendor', select: 'name' }
      })
      .populate({
        path: 'receiptLocationStore',
        select: 'name parentStore',
        populate: { path: 'parentStore', select: 'name' }
      })
      .lean();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Export spare parts (Excel)
// @route   GET /api/spare-parts/export
// @access  Private/Admin|Viewer
router.get('/export', protect, adminOrViewer, async (req, res) => {
  try {
    const q = normalize(req.query.q);
    const filter = {};
    if (req.activeStore) filter.store = req.activeStore;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { name: rx },
        { part_number: rx },
        { type: rx },
        { compatible_models: rx },
        { location: rx },
        { comment: rx },
        { vendorNameSnapshot: rx },
        { poNumberSnapshot: rx },
        { receiptLocation: rx }
      ];
    }
    const rows = await SparePart.find(filter)
      .sort({ updatedAt: -1 })
      .populate({
        path: 'receiptLocationStore',
        select: 'name parentStore',
        populate: { path: 'parentStore', select: 'name' }
      })
      .lean();

    const outRows = rows.map((r) => {
      let link = '';
      if (r.receiptLocationStore) {
        const p = normalize(r.receiptLocationStore?.parentStore?.name);
        const n = normalize(r.receiptLocationStore?.name);
        link = p && n ? `${p} › ${n}` : (n || p);
      }
      return [
        r.name,
        r.part_number,
        r.type,
        r.compatible_models,
        r.location,
        r.quantity,
        r.min_quantity,
        r.vendorNameSnapshot,
        r.poNumberSnapshot,
        r.receiptReceivedAt ? new Date(r.receiptReceivedAt).toISOString() : '',
        link,
        r.receiptLocationDetail || '',
        r.comment
      ];
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Spare parts');
    ws.addRow(SP_IMPORT_HEADERS);
    outRows.forEach((row) => ws.addRow(row));
    ws.columns = SP_IMPORT_HEADERS.map(() => ({ width: 18 }));
    ws.autoFilter = `A1:${String.fromCharCode(64 + SP_IMPORT_HEADERS.length)}1`;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Disposition', 'attachment; filename=spare_parts_export.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Spare parts import template
// @route   GET /api/spare-parts/import/template
// @access  Private/Admin (not Viewer)
router.get('/import/template', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Spare parts');
    ws.addRow(SP_IMPORT_HEADERS);
    ws.addRow([
      'Example RAM kit',
      'RAM-DDR4-16',
      'Memory',
      'Model X',
      'Bin A12',
      5,
      1,
      'Example Vendor Ltd',
      'PO-2026-001',
      new Date().toISOString(),
      'Main Site › GRN Dock',
      'Bay 2',
      'Initial stock'
    ]);
    ws.columns = SP_IMPORT_HEADERS.map(() => ({ width: 22 }));
    const readme = wb.addWorksheet('README');
    readme.addRows([
      ['Spare parts bulk import'],
      ['Name and Quantity are required on each data row.'],
      ['Vendor name / PO number: optional; must match records in this store.'],
      ['Receipt location link: use Locations from the sidebar — "Parent › Child" or paste child location id.'],
      ['When received: ISO date-time or leave blank for "now".']
    ]);
    readme.getColumn(1).width = 88;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Disposition', 'attachment; filename=spare_parts_import_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Import spare parts from Excel
// @route   POST /api/spare-parts/import
// @access  Private/Admin (not Viewer)
router.post('/import', protect, adminOrViewer, restrictViewer, upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'Upload an Excel file (.xlsx) as field "file"' });
    }
    const storeId = resolveStoreId(req);
    if (!storeId) return res.status(400).json({ message: 'Active store is required' });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.getWorksheet('Spare parts') || wb.worksheets[0];
    if (!ws) return res.status(400).json({ message: 'Workbook has no sheets' });

    const headerRow = ws.getRow(1);
    const hmap = {};
    headerRow.eachCell((cell, colNumber) => {
      const k = normalize(cellVal(cell.value)).toLowerCase();
      if (k) hmap[k] = colNumber - 1;
    });

    const pick = (rowArr, labels) => {
      for (const lab of labels) {
        const ix = hmap[normalize(lab).toLowerCase()];
        if (ix !== undefined && rowArr[ix] !== undefined && rowArr[ix] !== '') {
          return normalize(rowArr[ix]);
        }
      }
      return '';
    };

    const maxCol = Math.max(
      SP_IMPORT_HEADERS.length,
      ...Object.values(hmap).map((i) => Number(i) + 1),
      1
    );

    const imported = [];
    const errors = [];

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const vals = [];
      for (let c = 1; c <= maxCol; c++) {
        vals.push(cellVal(row.getCell(c).value));
      }

      const name = pick(vals, ['Name', 'name']);
      if (!name) {
        const any = vals.some((v) => normalize(v));
        if (!any) continue;
        errors.push({ row: r, message: 'Name is required' });
        continue;
      }

      const part_number = pick(vals, ['Part number', 'part number', 'Part #']);
      const type = pick(vals, ['Type', 'type']);
      const compatible_models = pick(vals, ['Compatible models', 'compatible models']);
      const location = pick(vals, ['Bin / shelf', 'bin / shelf', 'Bin']);
      const qtyIx = hmap[normalize('Quantity').toLowerCase()];
      const qtyRaw = qtyIx !== undefined ? vals[qtyIx] : '';
      const qty = Math.max(toNumber(qtyRaw, 0), 0);
      if (!qty) {
        errors.push({ row: r, message: 'Quantity must be greater than 0' });
        continue;
      }
      const minIx = hmap[normalize('Min quantity').toLowerCase()];
      const minRaw = minIx !== undefined ? vals[minIx] : '';
      const min_quantity = Math.max(toNumber(minRaw, 0), 0);
      const vendorName = pick(vals, ['Vendor name', 'vendor name', 'Vendor']);
      const poNum = pick(vals, ['PO number', 'po number', 'PO Number', 'PO']);
      let vendorId = null;
      let poId = null;
      if (vendorName) {
        const vdoc = await findVendorByName(storeId, vendorName);
        if (!vdoc) {
          errors.push({ row: r, message: `Vendor not found: "${vendorName}"` });
          continue;
        }
        vendorId = vdoc._id;
      }
      if (poNum) {
        const pdoc = await findPoByNumber(storeId, poNum);
        if (!pdoc) {
          errors.push({ row: r, message: `PO not found: "${poNum}"` });
          continue;
        }
        poId = pdoc._id;
        if (vendorId && String(pdoc.vendor) !== String(vendorId)) {
          errors.push({ row: r, message: 'PO does not match vendor for this row' });
          continue;
        }
        if (!vendorId) vendorId = pdoc.vendor;
      }

      let links;
      try {
        links = await resolveReceiptLinks(storeId, vendorId, poId);
      } catch (e) {
        errors.push({ row: r, message: e.message || 'Vendor/PO validation failed' });
        continue;
      }

      const whenRaw = pick(vals, ['When received', 'when received']);
      const receiptAt = toDate(whenRaw, new Date());

      const linkCell = pick(vals, ['Receipt location link', 'receipt location link']);
      const detCell = pick(vals, ['Receipt location detail', 'receipt location detail']);
      let receiptLocationStore = null;
      let receiptLocationDetail = '';
      let receiptLocation = '';
      if (linkCell) {
        receiptLocationStore = await resolveLocationStoreFromCell(storeId, linkCell);
        if (receiptLocationStore) {
          receiptLocationDetail = normalize(detCell);
          const chain = await storeChainLabelById(receiptLocationStore);
          receiptLocation = [chain, receiptLocationDetail].filter(Boolean).join(' — ');
        } else {
          receiptLocation = [normalize(linkCell), normalize(detCell)].filter(Boolean).join(' — ');
        }
      } else {
        receiptLocation = normalize(detCell);
      }

      const comment = pick(vals, ['Comment', 'comment']);
      const lotLabel = buildPurchaseLotLabel({
        vendorNameSnapshot: links.vendorNameSnapshot,
        poNumberSnapshot: links.poNumberSnapshot,
        receiptLocation
      });

      const manualLot = {
        sourceAssetId: null,
        sourceAssetLabel: lotLabel,
        quantityRemaining: qty,
        quantityInitial: qty,
        harvestedAt: receiptAt || new Date(),
        harvestTicket: normalize(links.poNumberSnapshot),
        harvestActorName: normalize(req.user.name),
        harvestActorEmail: normalize(req.user.email)
      };

      try {
        const item = await SparePart.create({
          name,
          part_number,
          type,
          compatible_models,
          location,
          comment,
          quantity: qty,
          min_quantity,
          store: storeId,
          stockLots: [manualLot],
          vendor: links.vendor,
          purchaseOrder: links.purchaseOrder,
          vendorNameSnapshot: links.vendorNameSnapshot,
          poNumberSnapshot: links.poNumberSnapshot,
          receiptReceivedAt: receiptAt,
          receiptLocation,
          receiptLocationStore,
          receiptLocationDetail: receiptLocationStore ? receiptLocationDetail : '',
          receiptRecordedBy: req.user?._id || null,
          receiptRecordedByName: normalize(req.user.name),
          receiptRecordedByEmail: normalize(req.user.email)
        });
        pushPartHistory(item, {
          action: 'Created',
          actor: req.user,
          quantity: qty,
          quantityAfter: qty,
          note: 'Imported from Excel'
        });
        await item.save();
        imported.push(item._id);
      } catch (e) {
        errors.push({ row: r, message: e.message || 'Create failed' });
      }
    }

    res.json({
      message: `Imported ${imported.length} spare part(s)`,
      imported: imported.length,
      errors
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Register spare part (manual / purchased stock)
// @route   POST /api/spare-parts
// @access  Private/Admin
router.post('/', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const {
      name,
      part_number,
      type,
      compatible_models,
      location,
      comment,
      quantity,
      min_quantity,
      vendor,
      purchaseOrder,
      receiptReceivedAt
    } = req.body;

    if (!normalize(name)) return res.status(400).json({ message: 'Name is required' });

    const storeId = resolveStoreId(req);
    if (!storeId) return res.status(400).json({ message: 'Active store is required' });

    const links = await resolveReceiptLinks(storeId, vendor, purchaseOrder);
    const receiptAt = toDate(receiptReceivedAt, new Date());
    const receiptFields = await resolveReceiptLocationFields(storeId, req.body);
    const receiptLoc = receiptFields.receiptLocation;
    const lotLabel = buildPurchaseLotLabel({
      vendorNameSnapshot: links.vendorNameSnapshot,
      poNumberSnapshot: links.poNumberSnapshot,
      receiptLocation: receiptLoc
    });

    const qty = Math.max(toNumber(quantity, 0), 0);
    const manualLot = {
      sourceAssetId: null,
      sourceAssetLabel: lotLabel,
      quantityRemaining: qty,
      quantityInitial: qty,
      harvestedAt: receiptAt || new Date(),
      harvestTicket: normalize(links.poNumberSnapshot),
      harvestActorName: normalize(req.user.name),
      harvestActorEmail: normalize(req.user.email)
    };

    const item = await SparePart.create({
      name: normalize(name),
      part_number: normalize(part_number),
      type: normalize(type),
      compatible_models: normalize(compatible_models),
      location: normalize(location),
      comment: normalize(comment),
      quantity: qty,
      min_quantity: Math.max(toNumber(min_quantity, 0), 0),
      store: storeId,
      stockLots: [manualLot],
      vendor: links.vendor,
      purchaseOrder: links.purchaseOrder,
      vendorNameSnapshot: links.vendorNameSnapshot,
      poNumberSnapshot: links.poNumberSnapshot,
      receiptReceivedAt: receiptAt,
      ...receiptFields,
      receiptRecordedBy: req.user?._id || null,
      receiptRecordedByName: normalize(req.user.name),
      receiptRecordedByEmail: normalize(req.user.email)
    });

    const noteBits = ['Purchased / new stock'];
    if (links.vendorNameSnapshot) noteBits.push(`Vendor: ${links.vendorNameSnapshot}`);
    if (links.poNumberSnapshot) noteBits.push(`PO: ${links.poNumberSnapshot}`);
    if (receiptAt) noteBits.push(`When received: ${receiptAt.toISOString()}`);
    if (receiptLoc) noteBits.push(`Where received: ${receiptLoc}`);
    noteBits.push(`Recorded in system by: ${req.user.name} (${req.user.email})`);

    pushPartHistory(item, {
      action: 'Created',
      actor: req.user,
      quantity: qty,
      quantityAfter: qty,
      note: noteBits.join(' | ')
    });
    await item.save();

    const populated = await populateSparePartRefs(SparePart.findById(item._id));

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Register Spare Part',
      details: [
        `Registered ${item.name} (PN: ${item.part_number || '—'}) qty ${qty}`,
        links.vendorNameSnapshot ? `Vendor: ${links.vendorNameSnapshot}` : null,
        links.poNumberSnapshot ? `PO: ${links.poNumberSnapshot}` : null,
        receiptLoc ? `Receipt location: ${receiptLoc}` : null,
        receiptAt ? `Receipt time: ${receiptAt.toISOString()}` : null
      ].filter(Boolean).join(' | '),
      store: item.store
    });

    res.status(201).json(populated);
  } catch (error) {
    const code = error.statusCode || 400;
    res.status(code).json({ message: error.message });
  }
});

// @desc    Harvest components from a faulty asset into spare inventory
// @route   POST /api/spare-parts/harvest
// @access  Private/Admin
router.post('/harvest', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const { assetId, ticketNumber, parts } = req.body;
    if (!mongoose.Types.ObjectId.isValid(String(assetId || ''))) {
      return res.status(400).json({ message: 'Valid assetId is required' });
    }
    if (!Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ message: 'parts[] is required (name + quantity per line)' });
    }

    const asset = await Asset.findById(assetId).populate('store', 'name store_name');
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (asset.disposed) return res.status(400).json({ message: 'Cannot harvest from a disposed asset' });
    if (String(asset.condition || '').trim() !== 'Faulty') {
      return res.status(400).json({ message: 'Harvest is only allowed for assets in Faulty condition' });
    }
    if (!canAccessAssetStore(req, asset)) {
      return res.status(403).json({ message: 'Not authorized for this asset store' });
    }

    const storeId = asset.store?._id || asset.store;
    if (!storeId) return res.status(400).json({ message: 'Asset has no store' });

    const lines = [];
    for (const raw of parts) {
      const name = normalize(raw?.name);
      const qty = Math.max(toNumber(raw?.quantity, 0), 0);
      if (!name || !qty) continue;
      lines.push({
        name,
        part_number: normalize(raw?.part_number),
        type: normalize(raw?.type),
        compatible_models: normalize(raw?.compatible_models),
        location: normalize(raw?.location),
        note: normalize(raw?.note),
        quantity: qty
      });
    }
    if (lines.length === 0) {
      return res.status(400).json({ message: 'Add at least one part line with name and quantity greater than 0' });
    }

    const assetLabel = `${asset.name} (SN: ${asset.serial_number || 'n/a'})`;
    const harvestSummary = [];

    for (const line of lines) {
      const filter = {
        store: storeId,
        name: line.name,
        part_number: line.part_number
      };
      const incQty = line.quantity;
      const lotEntry = {
        sourceAssetId: asset._id,
        sourceAssetLabel: assetLabel,
        quantityRemaining: incQty,
        quantityInitial: incQty,
        harvestedAt: new Date(),
        harvestTicket: normalize(ticketNumber),
        harvestActorName: normalize(req.user.name),
        harvestActorEmail: normalize(req.user.email)
      };

      let doc = await SparePart.findOne(filter);
      if (!doc) {
        doc = await SparePart.create({
          name: line.name,
          part_number: line.part_number,
          type: line.type,
          compatible_models: line.compatible_models,
          location: line.location,
          comment: '',
          quantity: incQty,
          min_quantity: 0,
          store: storeId,
          stockLots: [lotEntry]
        });
      } else {
        if (!Array.isArray(doc.stockLots)) doc.stockLots = [];
        doc.stockLots.push(lotEntry);
        doc.quantity = sumLotsRemaining(doc);
        doc.markModified('stockLots');
      }

      const detailNote = [line.note, `from ${assetLabel}`].filter(Boolean).join(' — ');
      pushPartHistory(doc, {
        action: 'Harvested',
        actor: req.user,
        quantity: incQty,
        quantityAfter: doc.quantity,
        note: detailNote,
        sourceAssetId: asset._id,
        sourceAssetLabel: assetLabel
      });
      await doc.save();
      harvestSummary.push(`${line.name} ×${incQty}`);
    }

    const who = `Collected/recorded by: ${req.user.name} (${req.user.email}), role: ${req.user.role}`;
    const detailText = `Harvested: ${harvestSummary.join('; ')}. ${who}${normalize(ticketNumber) ? `. Ticket/WO: ${normalize(ticketNumber)}` : ''}`;
    pushAssetHarvestHistory(asset, {
      req,
      ticketNumber,
      details: detailText
    });
    await asset.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Harvest Spare Parts',
      details: `${detailText} | Asset: ${assetLabel}`,
      store: storeId
    });

    res.json({
      message: 'Harvest recorded',
      assetId: asset._id,
      summary: harvestSummary
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update spare part metadata (not quantity — use issue/restock)
// @route   PUT /api/spare-parts/:id
// @access  Private/Admin
router.put('/:id', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const item = await SparePart.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Spare part not found' });
    if (!canAccess(req, item)) return res.status(403).json({ message: 'Not authorized for this store item' });

    const fields = ['name', 'part_number', 'type', 'compatible_models', 'location', 'comment', 'min_quantity'];
    fields.forEach((key) => {
      if (req.body[key] !== undefined) {
        if (key === 'min_quantity') {
          item.min_quantity = Math.max(toNumber(req.body.min_quantity, 0), 0);
        } else {
          item[key] = normalize(req.body[key]);
        }
      }
    });

    const vendorTouched = Object.prototype.hasOwnProperty.call(req.body, 'vendor');
    const poTouched = Object.prototype.hasOwnProperty.call(req.body, 'purchaseOrder');
    if (vendorTouched || poTouched) {
      const nextV = vendorTouched
        ? (req.body.vendor === '' || req.body.vendor === null ? null : req.body.vendor)
        : item.vendor;
      const nextP = poTouched
        ? (req.body.purchaseOrder === '' || req.body.purchaseOrder === null ? null : req.body.purchaseOrder)
        : item.purchaseOrder;
      const links = await resolveReceiptLinks(item.store, nextV, nextP);
      item.vendor = links.vendor;
      item.purchaseOrder = links.purchaseOrder;
      item.vendorNameSnapshot = links.vendorNameSnapshot;
      item.poNumberSnapshot = links.poNumberSnapshot;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'receiptReceivedAt')) {
      item.receiptReceivedAt = req.body.receiptReceivedAt === '' || req.body.receiptReceivedAt === null
        ? null
        : toDate(req.body.receiptReceivedAt, new Date());
    }

    const mainId = item.store;
    if (Object.prototype.hasOwnProperty.call(req.body, 'receiptLocationStore')) {
      const raw = req.body.receiptLocationStore;
      if (raw == null || raw === '') {
        item.receiptLocationStore = null;
        item.receiptLocationDetail = Object.prototype.hasOwnProperty.call(req.body, 'receiptLocationDetail')
          ? normalize(req.body.receiptLocationDetail)
          : '';
        item.receiptLocation = Object.prototype.hasOwnProperty.call(req.body, 'receiptLocation')
          ? normalize(req.body.receiptLocation)
          : '';
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(raw))) {
          return res.status(400).json({ message: 'Invalid receiptLocationStore' });
        }
        await assertLocationIsChild(raw, mainId);
        item.receiptLocationStore = raw;
        if (Object.prototype.hasOwnProperty.call(req.body, 'receiptLocationDetail')) {
          item.receiptLocationDetail = normalize(req.body.receiptLocationDetail);
        }
        const chain = await storeChainLabelById(raw);
        item.receiptLocation = [chain, normalize(item.receiptLocationDetail)].filter(Boolean).join(' — ');
      }
    } else if (
      Object.prototype.hasOwnProperty.call(req.body, 'receiptLocationDetail') &&
      item.receiptLocationStore
    ) {
      item.receiptLocationDetail = normalize(req.body.receiptLocationDetail);
      const chain = await storeChainLabelById(item.receiptLocationStore);
      item.receiptLocation = [chain, normalize(item.receiptLocationDetail)].filter(Boolean).join(' — ');
    } else if (Object.prototype.hasOwnProperty.call(req.body, 'receiptLocation') && !item.receiptLocationStore) {
      item.receiptLocation = normalize(req.body.receiptLocation);
    }

    ensureLotsCoverQuantity(item);
    const receiptLocTouched = Object.prototype.hasOwnProperty.call(req.body, 'receiptReceivedAt')
      || Object.prototype.hasOwnProperty.call(req.body, 'receiptLocation')
      || Object.prototype.hasOwnProperty.call(req.body, 'receiptLocationStore')
      || Object.prototype.hasOwnProperty.call(req.body, 'receiptLocationDetail');
    const noteExtra = vendorTouched || poTouched || receiptLocTouched
      ? 'Metadata & purchase receipt updated'
      : 'Metadata updated';
    pushPartHistory(item, {
      action: 'Updated',
      actor: req.user,
      quantity: 0,
      quantityAfter: sumLotsRemaining(item),
      note: noteExtra
    });
    await item.save();
    const out = await populateSparePartRefs(SparePart.findById(item._id));
    res.json(out);
  } catch (error) {
    const code = error.statusCode || 400;
    res.status(code).json({ message: error.message });
  }
});

// @desc    Issue spare parts (consumption)
// @route   POST /api/spare-parts/:id/issue
// @access  Private (Technician/Admin; not Viewer)
router.post('/:id/issue', protect, restrictViewer, async (req, res) => {
  try {
    const qty = Math.max(toNumber(req.body.quantity, 0), 0);
    if (!qty) return res.status(400).json({ message: 'Quantity must be greater than 0' });

    const doc = await SparePart.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Spare part not found' });
    if (!canAccess(req, doc)) return res.status(403).json({ message: 'Not authorized for this store item' });

    ensureLotsCoverQuantity(doc);
    const availableQty = sumLotsRemaining(doc);
    if (availableQty < qty) {
      return res.status(400).json({ message: `Not enough stock. Available: ${availableQty}` });
    }

    const ticket = normalize(req.body.ticketNumber);
    const note = normalize(req.body.note || req.body.comment);
    const installLoc = normalize(req.body.installationLocation);

    let targetAsset = null;
    const rawTarget = req.body.targetAssetId;
    if (mongoose.Types.ObjectId.isValid(String(rawTarget || ''))) {
      targetAsset = await Asset.findById(rawTarget).populate('store', 'name store_name');
      if (!targetAsset) return res.status(404).json({ message: 'Target asset not found' });
      if (!canAccessAssetStore(req, targetAsset)) {
        return res.status(403).json({ message: 'Not authorized for the target asset store' });
      }
    }

    const fromAssignModal = Boolean(req.body.fromAssignModal);
    let recipientUserId = null;
    let recipientUserName = '';
    let recipientExternalName = '';
    let recipientExternalEmail = '';
    let recipientExternalPhone = '';
    let assignmentGatePassSummary = '';

    if (fromAssignModal) {
      if (!canAdminSpareAssign(req.user)) {
        return res.status(403).json({ message: 'Only admins or managers can use the assign workflow' });
      }
      const recipientType = normalize(req.body.recipientType).toLowerCase() === 'other' ? 'Other' : 'Technician';
      const needGatePass = Boolean(req.body.needGatePass);
      const sendGatePassEmail = Boolean(req.body.sendGatePassEmail);
      const gatePassOrigin = normalize(req.body.gatePassOrigin);
      const gatePassDestination = normalize(req.body.gatePassDestination);
      const gatePassJustification = normalize(req.body.gatePassJustification);
      const rEmail = normalize(req.body.recipientEmail);
      const rPhone = normalize(req.body.recipientPhone);

      if (recipientType === 'Technician') {
        const tid = req.body.technicianId || req.body.assignedTechnicianId;
        if (!mongoose.Types.ObjectId.isValid(String(tid || ''))) {
          return res.status(400).json({ message: 'Technician is required' });
        }
        const tech = await User.findById(tid).select('name email phone role').lean();
        if (!tech || tech.role !== 'Technician') {
          return res.status(400).json({ message: 'Invalid technician' });
        }
        if (!installLoc) {
          return res.status(400).json({ message: 'Installation location is required for technician assignment' });
        }
        if (!rEmail) {
          return res.status(400).json({ message: 'Recipient email is required' });
        }
        recipientUserId = tech._id;
        recipientUserName = normalize(tech.name);
      } else {
        const o = req.body.otherRecipient || {};
        recipientExternalName = normalize(o.name);
        recipientExternalEmail = normalize(o.email);
        recipientExternalPhone = normalize(o.phone);
        if (!recipientExternalName || !recipientExternalEmail) {
          return res.status(400).json({ message: 'External recipient name and email are required' });
        }
      }

      if (needGatePass) {
        if (!ticket) {
          return res.status(400).json({ message: 'Ticket / reference is required when gate pass is requested' });
        }
        if (!gatePassOrigin || !gatePassDestination) {
          return res.status(400).json({ message: 'Moving From and Moving To are required when gate pass is requested' });
        }
        if (recipientType === 'Other' && !recipientExternalPhone) {
          return res.status(400).json({ message: 'Recipient phone is required for external gate pass requests' });
        }
        if (recipientType === 'Technician' && !rPhone) {
          return res.status(400).json({ message: 'Recipient phone is required for gate pass when assigning to a technician' });
        }
        assignmentGatePassSummary = [
          'Gate pass requested (record only — use Gate Passes to issue a PDF if needed)',
          `from ${gatePassOrigin}`,
          `to ${gatePassDestination}`,
          gatePassJustification ? `justification: ${gatePassJustification}` : null,
          `ticket: ${ticket}`,
          `email notify requested: ${sendGatePassEmail ? 'yes' : 'no'}`
        ].filter(Boolean).join(' | ');
      }
    }

    const assigneeLine =
      fromAssignModal && recipientUserName
        ? `Assign to technician: ${recipientUserName}`
        : fromAssignModal && recipientExternalName
          ? `Assign to external: ${recipientExternalName} <${recipientExternalEmail}>`
          : '';

    const targetLabel = targetAsset
      ? `${targetAsset.name} (SN: ${targetAsset.serial_number || 'n/a'})`
      : '';
    const partPn = normalize(doc.part_number);

    let donorMap;
    try {
      donorMap = consumeStockLotsFifo(doc, qty);
    } catch (e) {
      if (e?.code === 'LOT_UNDERFLOW') {
        return res.status(400).json({ message: 'Stock allocation failed. Refresh and try again.' });
      }
      throw e;
    }

    const donorTraceSummary = formatDonorTraceSummary(donorMap);

    const issuerLine = `Issued by: ${req.user.name} (${req.user.email}), role: ${req.user.role}`;
    const whereLine = `Work / install location: ${installLoc || '—'}`;
    const targetLine = targetLabel ? `Target asset: ${targetLabel}` : 'Target asset: not linked (site-only)';

    for (const [donorKey, { qty: donorQty }] of donorMap) {
      if (donorKey === '__pool__' || !mongoose.Types.ObjectId.isValid(donorKey)) continue;
      const donorAsset = await Asset.findById(donorKey).populate('store', 'name store_name');
      if (!donorAsset || !canAccessAssetStore(req, donorAsset)) continue;
      const donorDetails = [
        `${donorQty}× ${doc.name} (PN: ${partPn || '—'}) recovered from this unit was drawn from spare inventory and issued.`,
        targetLine,
        whereLine,
        ticket ? `Ticket/WO: ${ticket}` : null,
        note ? `Note: ${note}` : null,
        issuerLine
      ].filter(Boolean).join(' ');
      pushAssetSparePartAudit(donorAsset, {
        req,
        action: 'Spare Part Stock Issued (from this unit)',
        ticketNumber: ticket,
        details: donorDetails
      });
      await donorAsset.save();
    }

    if (targetAsset) {
      const recvDetails = [
        `${qty}× ${doc.name} (PN: ${partPn || '—'}) applied from spare parts inventory.`,
        `FIFO provenance: ${donorTraceSummary || '—'}`,
        whereLine,
        ticket ? `Ticket/WO: ${ticket}` : null,
        note ? `Note: ${note}` : null,
        issuerLine
      ].filter(Boolean).join(' ');
      pushAssetSparePartAudit(targetAsset, {
        req,
        action: 'Spare Parts Applied From Inventory',
        ticketNumber: ticket,
        details: recvDetails
      });
      await targetAsset.save();
    }

    const historyNote = [
      assigneeLine,
      ticket ? `Ticket/WO: ${ticket}` : '',
      note,
      targetLine,
      whereLine,
      assignmentGatePassSummary || ''
    ]
      .filter(Boolean)
      .join(' | ') || 'Issued from inventory';

    pushPartHistory(doc, {
      action: 'Issued',
      actor: req.user,
      quantity: qty,
      quantityAfter: doc.quantity,
      note: historyNote,
      targetAssetId: targetAsset?._id || null,
      targetAssetLabel: targetLabel,
      ticketNumber: ticket,
      usedAtLocation: installLoc,
      donorTraceSummary,
      recipientUserId,
      recipientUserName,
      recipientExternalName,
      recipientExternalEmail,
      recipientExternalPhone,
      assignmentGatePassSummary
    });
    await doc.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Issue Spare Part',
      details: [
        `Issued ${qty} of ${doc.name} (PN: ${partPn || '—'}). Remaining: ${doc.quantity}`,
        assigneeLine || null,
        donorTraceSummary ? `Provenance: ${donorTraceSummary}` : null,
        targetLabel ? `Target: ${targetLabel}` : null,
        installLoc ? `Location: ${installLoc}` : null,
        ticket ? `Ticket: ${ticket}` : null
      ].filter(Boolean).join(' | '),
      store: doc.store
    });

    res.json(doc);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Restock spare parts
// @route   POST /api/spare-parts/:id/restock
// @access  Private/Admin
router.post('/:id/restock', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const qty = Math.max(toNumber(req.body.quantity, 0), 0);
    if (!qty) return res.status(400).json({ message: 'Quantity must be greater than 0' });

    const item = await SparePart.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Spare part not found' });
    if (!canAccess(req, item)) return res.status(403).json({ message: 'Not authorized for this store item' });

    if (!Array.isArray(item.stockLots)) item.stockLots = [];
    const restockNote = normalize(req.body.note);
    item.stockLots.push({
      sourceAssetId: null,
      sourceAssetLabel: restockNote ? `Vendor restock — ${restockNote}` : 'Vendor restock',
      quantityRemaining: qty,
      quantityInitial: qty,
      harvestedAt: new Date(),
      harvestTicket: '',
      harvestActorName: normalize(req.user.name),
      harvestActorEmail: normalize(req.user.email)
    });
    item.quantity = sumLotsRemaining(item);
    item.markModified('stockLots');
    pushPartHistory(item, {
      action: 'Restocked',
      actor: req.user,
      quantity: qty,
      quantityAfter: item.quantity,
      note: restockNote || 'Restock'
    });
    await item.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Restock Spare Part',
      details: `Restocked ${qty} of ${item.name}. New qty: ${item.quantity}`,
      store: item.store
    });

    res.json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete spare part
// @route   DELETE /api/spare-parts/:id
// @access  Private/Admin
router.delete('/:id', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const item = await SparePart.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Spare part not found' });
    if (!canAccess(req, item)) return res.status(403).json({ message: 'Not authorized for this store item' });

    pushPartHistory(item, {
      action: 'Deleted',
      actor: req.user,
      quantity: Math.max(toNumber(item.quantity, 0), 0),
      quantityAfter: 0,
      note: 'Spare part removed from catalog'
    });
    await item.save();
    await item.deleteOne();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Delete Spare Part',
      details: `Deleted spare part: ${item.name} (PN: ${item.part_number || '—'})`,
      store: item.store
    });

    res.json({ message: 'Spare part removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get spare part history
// @route   GET /api/spare-parts/:id/history
// @access  Private
router.get('/:id/history', protect, async (req, res) => {
  try {
    const item = await SparePart.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Spare part not found' });
    if (!canAccess(req, item)) return res.status(403).json({ message: 'Not authorized for this store item' });
    res.json(item.history || []);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
