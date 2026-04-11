const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const ExcelJS = require('exceljs');
const router = express.Router();
const Tool = require('../models/Tool');
const Store = require('../models/Store');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const { protect, adminOrViewer, restrictViewer } = require('../middleware/authMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const normalize = (v) => String(v || '').trim();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const managerLikeRole = (role) => String(role || '').toLowerCase().includes('manager');

const canAssignToolFromAdminUi = (user) =>
  Boolean(user && (user.role === 'Admin' || user.role === 'Super Admin' || managerLikeRole(user.role)));

const clearExternalHolder = (tool) => {
  tool.externalHolder = { name: '', email: '', phone: '' };
};

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

const populateToolDoc = (q) =>
  q
    .populate('store', 'name')
    .populate('currentHolder', 'name email')
    .populate({ path: 'locationStore', select: 'name parentStore', populate: { path: 'parentStore', select: 'name' } });

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

const parseRegisteredAtInput = (raw) => {
  if (raw === undefined || raw === null || raw === '') return new Date();
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d;
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
    const err = new Error('Store context is required to link a location');
    err.status = 400;
    throw err;
  }
  const loc = await Store.findById(locationStoreId).select('parentStore isMainStore').lean();
  if (!loc) {
    const err = new Error('Linked location not found');
    err.status = 400;
    throw err;
  }
  if (loc.isMainStore || String(loc.parentStore || '') !== String(mainStoreId)) {
    const err = new Error('Location must be a row from Locations (child site) under this store');
    err.status = 400;
    throw err;
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

const TOOL_IMPORT_HEADERS = [
  'Tool Name',
  'Type',
  'Model',
  'Serial',
  'MAC',
  'PO Number',
  'Vendor',
  'Registered At',
  'Location Link',
  'Location Detail',
  'Status',
  'Comment'
];

const buildToolListFilter = (req) => {
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
        { vendor_name: rx },
        { comment: rx },
        { location: rx }
      ]
    });
  }
  return filter;
};

// @desc    List tools
// @route   GET /api/tools
// @access  Private/Admin|Viewer|Technician
router.get('/', protect, async (req, res) => {
  try {
    const filter = buildToolListFilter(req);
    const tools = await Tool.find(filter)
      .sort({ updatedAt: -1 })
      .populate('store', 'name')
      .populate('currentHolder', 'name email')
      .populate({ path: 'locationStore', select: 'name parentStore', populate: { path: 'parentStore', select: 'name' } })
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

// @desc    Export tools as Excel (current filters)
// @route   GET /api/tools/export
// @access  Private/Admin|Viewer
router.get('/export', protect, adminOrViewer, async (req, res) => {
  try {
    const filter = buildToolListFilter(req);
    const tools = await Tool.find(filter)
      .sort({ updatedAt: -1 })
      .populate({ path: 'locationStore', select: 'name parentStore', populate: { path: 'parentStore', select: 'name' } })
      .lean();

    const rows = [];
    for (const t of tools) {
      let link = '';
      if (t.locationStore) {
        const p = normalize(t.locationStore?.parentStore?.name);
        const n = normalize(t.locationStore?.name);
        link = p && n ? `${p} › ${n}` : (n || p);
      }
      rows.push([
        t.name,
        t.type,
        t.model,
        t.serial_number,
        t.mac_address,
        t.po_number,
        t.vendor_name,
        t.registered_at ? new Date(t.registered_at).toISOString() : '',
        link,
        t.locationDetail || '',
        t.status,
        t.comment
      ]);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tools');
    ws.addRow(TOOL_IMPORT_HEADERS);
    rows.forEach((r) => ws.addRow(r));
    ws.columns = TOOL_IMPORT_HEADERS.map(() => ({ width: 18 }));
    ws.autoFilter = `A1:${String.fromCharCode(64 + TOOL_IMPORT_HEADERS.length)}1`;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Disposition', 'attachment; filename=tools_export.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Download tools import template
// @route   GET /api/tools/import/template
// @access  Private/Admin (not Viewer)
router.get('/import/template', protect, adminOrViewer, restrictViewer, async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tools');
    ws.addRow(TOOL_IMPORT_HEADERS);
    ws.addRow([
      'Example Drill',
      'Power',
      'EX-100',
      'SN-0001',
      '',
      'PO-123',
      'Example Vendor',
      new Date().toISOString(),
      'Main Site › Workshop',
      'Shelf A1',
      'Available',
      'Optional notes'
    ]);
    ws.columns = TOOL_IMPORT_HEADERS.map(() => ({ width: 22 }));
    const readme = wb.addWorksheet('README');
    readme.addRows([
      ['Tools bulk import'],
      ['Location Link: use Locations from the sidebar — format "Parent › Child" or paste the child location MongoDB id.'],
      ['Registered At: ISO date-time (e.g. 2026-04-11T14:30:00.000Z) or leave blank for "now".'],
      ['Status: Available | Issued | Maintenance | Retired'],
      ['Tool Name is required on each data row.']
    ]);
    readme.getColumn(1).width = 90;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Disposition', 'attachment; filename=tools_import_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Import tools from Excel
// @route   POST /api/tools/import
// @access  Private/Admin (not Viewer)
router.post('/import', protect, adminOrViewer, restrictViewer, upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'Upload an Excel file (.xlsx) as field "file"' });
    }

    const storeId =
      req.user.role === 'Super Admin'
        ? (req.body.store || req.activeStore || null)
        : (req.activeStore || req.user.assignedStore || null);
    if (!storeId) {
      return res.status(400).json({ message: 'Active store is required to import tools' });
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.getWorksheet('Tools') || wb.worksheets[0];
    if (!ws) {
      return res.status(400).json({ message: 'Workbook has no sheets' });
    }

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

    const imported = [];
    const errors = [];
    const statusOk = new Set(['Available', 'Issued', 'Maintenance', 'Retired']);

    const maxCol = Math.max(
      TOOL_IMPORT_HEADERS.length,
      ...Object.values(hmap).map((i) => Number(i) + 1),
      1
    );

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const vals = [];
      for (let c = 1; c <= maxCol; c++) {
        vals.push(cellVal(row.getCell(c).value));
      }
      const name = pick(vals, ['Tool Name', 'tool name', 'Name', 'name']);
      if (!name) {
        const any = vals.some((v) => normalize(v));
        if (!any) continue;
        errors.push({ row: r, message: 'Tool Name is required' });
        continue;
      }

      const type = pick(vals, ['Type', 'type']);
      const model = pick(vals, ['Model', 'model']);
      const serial_number = pick(vals, ['Serial', 'serial', 'Serial Number']);
      const mac_address = pick(vals, ['MAC', 'mac', 'Mac']);
      const po_number = pick(vals, ['PO Number', 'po number', 'PO']);
      const vendor_name = pick(vals, ['Vendor', 'vendor', 'vendor name']);
      let registeredRaw = pick(vals, ['Registered At', 'registered at', 'Date', 'datetime']);
      const locCell = pick(vals, ['Location Link', 'location link', 'Location', 'location']);
      const locationDetail = pick(vals, ['Location Detail', 'location detail', 'Detail']);
      const statusRaw = pick(vals, ['Status', 'status']);
      const comment = pick(vals, ['Comment', 'comment', 'Notes']);

      const registered_at = parseRegisteredAtInput(registeredRaw || '');
      if (!registered_at) {
        errors.push({ row: r, message: 'Invalid Registered At' });
        continue;
      }

      let status = 'Available';
      if (statusRaw) {
        if (!statusOk.has(statusRaw)) {
          errors.push({ row: r, message: `Invalid status "${statusRaw}"` });
          continue;
        }
        status = statusRaw;
      }

      let locationStore = null;
      let location = '';
      if (locCell) {
        locationStore = await resolveLocationStoreFromCell(storeId, locCell);
        if (locationStore) {
          const chain = await storeChainLabelById(locationStore);
          location = [chain, normalize(locationDetail)].filter(Boolean).join(' — ');
        } else {
          location = [normalize(locCell), normalize(locationDetail)].filter(Boolean).join(' — ');
        }
      } else {
        location = normalize(locationDetail);
      }

      try {
        const tool = await Tool.create({
          name,
          type,
          model,
          serial_number,
          mac_address,
          po_number,
          vendor_name,
          registered_at,
          comment,
          location,
          locationStore,
          locationDetail: locationStore ? normalize(locationDetail) : '',
          status,
          store: storeId
        });
        appendHistory(tool, { action: 'Created', actor: req.user, note: 'Imported from Excel' });
        await tool.save();
        imported.push(tool._id);
      } catch (e) {
        errors.push({ row: r, message: e.message || 'Create failed' });
      }
    }

    res.json({
      message: `Imported ${imported.length} tool(s)`,
      imported: imported.length,
      errors
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
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
      status,
      vendor_name,
      locationStore,
      locationDetail
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

    const registered_at = parseRegisteredAtInput(req.body.registered_at);
    if (!registered_at) {
      return res.status(400).json({ message: 'Invalid registered_at' });
    }

    const payload = {
      name: normalize(name),
      type: normalize(type),
      model: normalize(model),
      serial_number: normalize(serial_number),
      mac_address: normalize(mac_address),
      comment: normalize(comment),
      po_number: normalize(po_number),
      vendor_name: normalize(vendor_name),
      registered_at,
      status: normalize(status) || 'Available',
      store: storeId,
      locationStore: null,
      locationDetail: '',
      location: ''
    };

    if (locationStore && mongoose.Types.ObjectId.isValid(String(locationStore))) {
      await assertLocationIsChild(locationStore, storeId);
      payload.locationStore = locationStore;
      payload.locationDetail = normalize(locationDetail);
      const chain = await storeChainLabelById(locationStore);
      payload.location = [chain, payload.locationDetail].filter(Boolean).join(' — ');
    } else {
      payload.location = normalize(location);
      payload.locationDetail = normalize(locationDetail);
    }

    const tool = await Tool.create(payload);

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

    const full = await populateToolDoc(Tool.findById(tool._id));
    res.status(201).json(full);
  } catch (error) {
    const code = error.status || 400;
    res.status(code).json({ message: error.message });
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

    const fields = ['name', 'type', 'model', 'serial_number', 'mac_address', 'comment', 'po_number', 'status', 'vendor_name'];
    fields.forEach((key) => {
      if (req.body[key] !== undefined) {
        tool[key] = normalize(req.body[key]);
      }
    });

    if (req.body.registered_at !== undefined) {
      const d = parseRegisteredAtInput(req.body.registered_at);
      if (!d) return res.status(400).json({ message: 'Invalid registered_at' });
      tool.registered_at = d;
    }

    const mainId = tool.store;

    if (req.body.locationStore !== undefined) {
      const raw = req.body.locationStore;
      if (raw == null || raw === '') {
        tool.locationStore = null;
        if (req.body.locationDetail !== undefined) tool.locationDetail = normalize(req.body.locationDetail);
        if (req.body.location !== undefined) tool.location = normalize(req.body.location);
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(raw))) {
          return res.status(400).json({ message: 'Invalid locationStore' });
        }
        await assertLocationIsChild(raw, mainId);
        tool.locationStore = raw;
        if (req.body.locationDetail !== undefined) tool.locationDetail = normalize(req.body.locationDetail);
        const chain = await storeChainLabelById(raw);
        tool.location = [chain, normalize(tool.locationDetail)].filter(Boolean).join(' — ');
      }
    } else if (req.body.locationDetail !== undefined && tool.locationStore) {
      tool.locationDetail = normalize(req.body.locationDetail);
      const chain = await storeChainLabelById(tool.locationStore);
      tool.location = [chain, normalize(tool.locationDetail)].filter(Boolean).join(' — ');
    } else if (req.body.location !== undefined && !tool.locationStore) {
      tool.location = normalize(req.body.location);
    }

    if (tool.status !== 'Issued') {
      tool.currentHolder = null;
      clearExternalHolder(tool);
    }

    appendHistory(tool, { action: 'Updated', actor: req.user, note: 'Tool details updated' });
    await tool.save();

    const full = await populateToolDoc(Tool.findById(tool._id));
    res.json(full);
  } catch (error) {
    const code = error.status || 400;
    res.status(code).json({ message: error.message });
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

    const full = await populateToolDoc(Tool.findById(tool._id));
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
    const hasTechHolder = tool.currentHolder != null;
    const ext = tool.externalHolder || {};
    const hasExternalHolder = Boolean(normalize(ext.name) || normalize(ext.email));
    if (tool.status !== 'Issued' || (!hasTechHolder && !hasExternalHolder)) {
      return res.status(400).json({ message: 'Tool is not currently issued' });
    }

    const isPrivileged =
      req.user.role === 'Admin' || req.user.role === 'Super Admin' || managerLikeRole(req.user.role);

    if (!isPrivileged) {
      if (req.user.role === 'Technician') {
        if (!hasTechHolder || String(tool.currentHolder) !== String(req.user._id)) {
          return res.status(403).json({ message: 'You can only return tools assigned to you' });
        }
      } else {
        return res.status(403).json({ message: 'Not authorized to return this tool' });
      }
    }

    tool.status = 'Available';
    tool.currentHolder = null;
    clearExternalHolder(tool);
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

    const full = await populateToolDoc(Tool.findById(tool._id));
    res.json(full);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Admin/manager assign a tool to a technician or external recipient (same audit fields as asset assign UI)
// @route   POST /api/tools/:id/assign
// @access  Private — Admin, Super Admin, or Manager
router.post('/:id/assign', protect, restrictViewer, async (req, res) => {
  try {
    if (!canAssignToolFromAdminUi(req.user)) {
      return res.status(403).json({ message: 'Only admins or managers can assign tools from this screen' });
    }

    const tool = await Tool.findById(req.params.id);
    if (!tool) return res.status(404).json({ message: 'Tool not found' });
    if (!canAccessTool(req, tool)) return res.status(403).json({ message: 'Not authorized for this store tool' });
    if (tool.status !== 'Available') {
      return res.status(400).json({ message: `Tool must be Available to assign (current: ${tool.status})` });
    }

    const recipientType = normalize(req.body.recipientType).toLowerCase() === 'other' ? 'Other' : 'Technician';
    const installationLocation = normalize(req.body.installationLocation);
    const ticketNumber = normalize(req.body.ticketNumber);
    const needGatePass = Boolean(req.body.needGatePass);
    const sendGatePassEmail = Boolean(req.body.sendGatePassEmail);
    const gatePassOrigin = normalize(req.body.gatePassOrigin);
    const gatePassDestination = normalize(req.body.gatePassDestination);
    const gatePassJustification = normalize(req.body.gatePassJustification);
    const recipientEmail = normalize(req.body.recipientEmail);
    const recipientPhone = normalize(req.body.recipientPhone);

    let targetUserDoc = null;

    if (recipientType === 'Technician') {
      const techId = req.body.technicianId || req.body.userId;
      if (!mongoose.Types.ObjectId.isValid(String(techId || ''))) {
        return res.status(400).json({ message: 'Technician is required' });
      }
      const tech = await User.findById(techId).select('name email phone role assignedStore').lean();
      if (!tech) return res.status(404).json({ message: 'Technician not found' });
      if (tech.role !== 'Technician') {
        return res.status(400).json({ message: 'Selected user must be a Technician' });
      }
      if (!installationLocation) {
        return res.status(400).json({ message: 'Installation location is required for technician assignment' });
      }
      if (!recipientEmail) {
        return res.status(400).json({ message: 'Recipient email is required' });
      }
      tool.currentHolder = tech._id;
      clearExternalHolder(tool);
      targetUserDoc = tech;
    } else {
      const other = req.body.otherRecipient || {};
      const ext = {
        name: normalize(other.name),
        email: normalize(other.email),
        phone: normalize(other.phone)
      };
      if (!ext.name || !ext.email) {
        return res.status(400).json({ message: 'External recipient name and email are required' });
      }
      tool.currentHolder = null;
      tool.externalHolder = ext;
    }

    if (needGatePass) {
      if (!ticketNumber) {
        return res.status(400).json({ message: 'Ticket / reference is required when gate pass is requested' });
      }
      if (!gatePassOrigin || !gatePassDestination) {
        return res.status(400).json({ message: 'Moving From and Moving To are required when gate pass is requested' });
      }
      if (recipientType === 'Other' && !normalize(req.body.otherRecipient?.phone)) {
        return res.status(400).json({ message: 'Recipient phone is required for external gate pass requests' });
      }
      if (recipientType === 'Technician' && !recipientPhone) {
        return res.status(400).json({ message: 'Recipient phone is required for gate pass when assigning to a technician' });
      }
    }

    const gpSummary = needGatePass
      ? [
          'Gate pass requested (record only for tools — create a pass in Gate Passes if needed)',
          `from ${gatePassOrigin}`,
          `to ${gatePassDestination}`,
          gatePassJustification ? `justification: ${gatePassJustification}` : null,
          `ticket: ${ticketNumber}`,
          `email notify requested: ${sendGatePassEmail ? 'yes' : 'no'}`
        ].filter(Boolean).join(' | ')
      : 'Gate pass not requested';

    const recipientSummary =
      recipientType === 'Technician'
        ? `Technician assign: ${targetUserDoc.name}; notify ${recipientEmail}; install: ${installationLocation}; phone: ${recipientPhone || '—'}`
        : `External assign: ${tool.externalHolder.name} <${tool.externalHolder.email}>; phone: ${tool.externalHolder.phone || '—'}`;

    tool.status = 'Issued';
    appendHistory(tool, {
      action: 'Issued',
      actor: req.user,
      targetUser: targetUserDoc ? { _id: targetUserDoc._id, name: targetUserDoc.name } : null,
      note: `${recipientSummary}. ${gpSummary}`
    });
    await tool.save();

    await ActivityLog.create({
      user: req.user.name,
      email: req.user.email,
      role: req.user.role,
      action: 'Assign Tool',
      details: `Assigned tool ${tool.name} (${tool.serial_number || 'NO-SERIAL'}) — ${recipientSummary}`,
      store: tool.store
    });

    const full = await populateToolDoc(Tool.findById(tool._id));
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

