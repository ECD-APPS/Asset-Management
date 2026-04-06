const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const PpmTask = require('../models/PpmTask');
const Asset = require('../models/Asset');
const ActivityLog = require('../models/ActivityLog');
const { protect, restrictViewer } = require('../middleware/authMiddleware');

const router = express.Router();

/** PPM cycle length (default due / next-service horizon) — 180 days */
const PPM_CYCLE_MS = 180 * 24 * 60 * 60 * 1000;

const VMS_CHECKLIST_KEY = 'vms_online';

const DEFAULT_CHECKLIST = [
  { key: 'camera_maintenance_checklist', label: 'Camera Maintenance Checklist', value: 'Good', notes: '' },
  { key: 'camera_abs_label', label: 'Camera ABS Label', value: 'Good', notes: '' },
  { key: 'cable_terminations', label: 'Cable Terminations', value: 'Good', notes: '' },
  { key: 'camera_glass_cover', label: 'Camera Glass Cover', value: 'Good', notes: '' },
  {
    key: VMS_CHECKLIST_KEY,
    label: 'VMS — camera shows online in VMS',
    value: 'Offline',
    notes: ''
  }
];

const normalizeStandardItemValue = (raw) => {
  const s = String(raw || '');
  return ['Good', 'Needs Replace', 'No'].includes(s) ? s : 'Good';
};

const normalizeVmsItemValue = (raw) => {
  const s = String(raw || '');
  return s === 'Online' || s === 'Offline' ? s : 'Offline';
};

/** Merge saved checklist with current default shape (adds VMS row to older tasks). */
const mergePpmChecklistShape = (items) => {
  const arr = Array.isArray(items) ? items : [];
  const defaultKeys = new Set(DEFAULT_CHECKLIST.map((d) => d.key));
  const byKey = new Map(arr.map((it) => [String(it?.key || ''), it]));

  const head = DEFAULT_CHECKLIST.map((def) => {
    const inc = byKey.get(def.key);
    if (!inc) {
      return { ...def };
    }
    const value =
      def.key === VMS_CHECKLIST_KEY
        ? normalizeVmsItemValue(inc.value)
        : normalizeStandardItemValue(inc.value);
    return {
      key: def.key,
      label: String(inc.label || def.label),
      value,
      notes: String(inc.notes || '')
    };
  });

  const tail = arr
    .filter((it) => it && String(it.key || '') && !defaultKeys.has(String(it.key)))
    .map((it, idx) => ({
      key: String(it.key || `extra_${idx + 1}`),
      label: String(it.label || it.key || `Item ${idx + 1}`),
      value: normalizeStandardItemValue(it.value),
      notes: String(it.notes || '')
    }));

  return [...head, ...tail];
};

const normalizeChecklist = (items) => mergePpmChecklistShape(items);

const vmsLabelFromChecklist = (checklist) => {
  const item = (checklist || []).find((i) => String(i?.key) === VMS_CHECKLIST_KEY);
  if (item?.value === 'Online') return 'Online';
  if (item?.value === 'Offline') return 'Offline';
  return null;
};

const vmsLabelFromCustomFields = (cf) => {
  const o = cf && typeof cf === 'object' ? cf : {};
  const vmsRaw = o.vms_status ?? o.vmsStatus ?? o.vms_online;
  if (vmsRaw === true || String(vmsRaw).toLowerCase() === 'online') return 'Online';
  if (vmsRaw === false || String(vmsRaw).toLowerCase() === 'offline') return 'Offline';
  if (vmsRaw != null && String(vmsRaw).trim() !== '') return String(vmsRaw);
  return null;
};

const syncVmsFromChecklistToAsset = async (assetId, checklist) => {
  if (!assetId || !mongoose.Types.ObjectId.isValid(assetId)) return;
  const vms = (checklist || []).find((i) => String(i?.key) === VMS_CHECKLIST_KEY);
  if (!vms || (vms.value !== 'Online' && vms.value !== 'Offline')) return;
  const slug = vms.value === 'Online' ? 'online' : 'offline';
  await Asset.updateOne(
    { _id: assetId },
    {
      $set: {
        'customFields.vms_status': slug,
        'customFields.vms_online': vms.value === 'Online'
      }
    }
  );
};

const addTaskHistory = (task, req, action, details = '') => {
  task.history.push({
    action,
    user: req.user?.name || '',
    email: req.user?.email || '',
    role: req.user?.role || '',
    details: String(details || '')
  });
};

const isAdminRole = (role) => role === 'Admin' || role === 'Super Admin';

const allowPpmRead = (req, res, next) => {
  const ok = ['Admin', 'Super Admin', 'Viewer', 'Technician'].includes(req.user?.role);
  if (!ok) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  return next();
};

const applyStoreScope = (req, baseFilter = {}) => {
  const filter = { ...baseFilter };
  if (req.activeStore && mongoose.Types.ObjectId.isValid(req.activeStore)) {
    filter.store = new mongoose.Types.ObjectId(req.activeStore);
  }
  return filter;
};

const taskInActiveStore = (task, req) => {
  if (!req.activeStore) return false;
  return String(task.store || '') === String(req.activeStore);
};

const ensureTaskAccess = (task, req) => {
  if (!task) return false;
  if (isAdminRole(req.user?.role)) return taskInActiveStore(task, req);
  if (req.user?.role === 'Technician') {
    return taskInActiveStore(task, req);
  }
  if (req.user?.role === 'Viewer') {
    return taskInActiveStore(task, req);
  }
  return false;
};

router.get('/overview', protect, allowPpmRead, async (req, res) => {
  try {
    const now = new Date();
    const filter = applyStoreScope(req, { status: { $ne: 'Cancelled' } });
    const [total, overdue, completed, notCompleted] = await Promise.all([
      PpmTask.countDocuments(filter),
      PpmTask.countDocuments({ ...filter, status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }, due_at: { $lt: now } }),
      PpmTask.countDocuments({ ...filter, status: 'Completed' }),
      PpmTask.countDocuments({ ...filter, status: 'Not Completed' })
    ]);
    const health = total > 0 ? Math.round((completed / total) * 100) : 100;
    res.json({ total, overdue, completed, notCompleted, health });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load PPM overview', error: error.message });
  }
});

// @route   GET /api/ppm/export
router.get('/export', protect, allowPpmRead, async (req, res) => {
  try {
    const filter = applyStoreScope(req, {});
    const rows = await PpmTask.find(filter)
      .populate('assigned_to', 'name email')
      .populate('completed_by', 'name email')
      .populate('incomplete_by', 'name email')
      .populate('asset', 'name model_number uniqueId abs_code ip_address product_name')
      .sort({ updatedAt: -1 })
      .limit(8000)
      .lean();

    const header = [
      'Status',
      'Unique ID',
      'ABS Code',
      'IP Address',
      'Asset / model',
      'Due date',
      'Completed at',
      'Not completed at',
      'Technician comment',
      'Recorded by (not completed)',
      'Assigned to',
      'Manager notes'
    ];
    const body = rows.map((t) => {
      const a = t.asset || {};
      return [
        t.status || '',
        a.uniqueId || '',
        a.abs_code || '',
        a.ip_address || '',
        a.model_number || a.name || a.product_name || '',
        t.due_at ? new Date(t.due_at).toISOString().slice(0, 10) : '',
        t.completed_at ? new Date(t.completed_at).toISOString() : '',
        t.incomplete_at ? new Date(t.incomplete_at).toISOString() : '',
        String(t.technician_notes || '').replace(/\r?\n/g, ' '),
        t.incomplete_by?.name || '',
        t.assigned_to?.name || '',
        String(t.manager_notes || '').replace(/\r?\n/g, ' ')
      ];
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('PPM Report');
    ws.addRows([header, ...body]);
    ws.columns = [
      { width: 16 },
      { width: 18 },
      { width: 12 },
      { width: 14 },
      { width: 24 },
      { width: 12 },
      { width: 22 },
      { width: 22 },
      { width: 48 },
      { width: 22 },
      { width: 18 },
      { width: 32 }
    ];
    ws.autoFilter = `A1:${String.fromCharCode(64 + header.length)}1`;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename=PPM_Report_${stamp}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to export PPM report', error: error.message });
  }
});

const assetMatchesPpmSearch = (a, rawKeyword) => {
  const query = String(rawKeyword || '').trim().toLowerCase();
  if (!query) return true;
  const compact = query.replace(/\s+/g, '');
  const uid = String(a.uniqueId || '').trim().toLowerCase();
  const abs = String(a.abs_code || '').trim().toLowerCase();
  const ip = String(a.ip_address || '').trim().toLowerCase().replace(/\s/g, '');
  const serial = String(a.serial_number || '').trim().toLowerCase();
  const mac = String(a.mac_address || '').trim().toLowerCase().replace(/\s/g, '');
  const expo = String(a.expo_tag || a.expoTag || '').trim().toLowerCase();
  if (uid && (uid.includes(query) || uid.includes(compact))) return true;
  if (abs && (abs.includes(query) || abs.includes(compact))) return true;
  if (ip && (ip.includes(query) || ip.includes(compact))) return true;
  if (serial && (serial.includes(query) || serial.includes(compact))) return true;
  if (mac && (mac.includes(query) || mac.includes(compact))) return true;
  if (expo && (expo.includes(query) || expo.includes(compact))) return true;
  return [a.name, a.model_number, a.product_name, a.ticket_number]
    .some((v) => String(v || '').toLowerCase().includes(query));
};

router.get('/self-service-assets', protect, restrictViewer, async (req, res) => {
  try {
    if (!['Technician', 'Admin', 'Super Admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) {
      return res.status(400).json({ message: 'Active store is required' });
    }
    const storeOid = new mongoose.Types.ObjectId(req.activeStore);
    const keyword = String(req.query.q || '').trim();
    const keywordLower = keyword.toLowerCase();
    const cameraOnly = String(req.query.camera_only || 'false').toLowerCase() === 'true';

    const limit = keywordLower ? 2500 : 1200;
    let assets = await Asset.find({ store: storeOid, disposed: { $ne: true } })
      .select(
        'name model_number uniqueId abs_code ip_address serial_number mac_address expo_tag ticket_number status condition product_name customFields store assigned_to ppm_enabled'
      )
      .populate('assigned_to', 'name email')
      .sort({ uniqueId: 1, name: 1 })
      .limit(limit)
      .lean();

    if (keywordLower) {
      assets = assets.filter((a) => assetMatchesPpmSearch(a, keyword));
    } else if (cameraOnly) {
      assets = assets.filter((a) =>
        /camera/i.test(String(a.product_name || a.name || a.model_number || ''))
      );
    }

    let assignedOpenAssetIds = null;
    if (req.user?.role === 'Technician') {
      const assignedOpen = await PpmTask.find({
        store: storeOid,
        status: { $in: ['Scheduled', 'In Progress'] },
        assigned_to: req.user._id
      })
        .select('asset')
        .lean();
      assignedOpenAssetIds = new Set(assignedOpen.map((t) => String(t.asset)));
      assets = assets.filter(
        (a) => Boolean(a.ppm_enabled) || assignedOpenAssetIds.has(String(a._id))
      );
    }

    const assetIds = assets.map((a) => a._id);
    if (assetIds.length === 0) {
      return res.json([]);
    }

    const [openTasks, lastCompleted] = await Promise.all([
      PpmTask.find({
        asset: { $in: assetIds },
        store: storeOid,
        status: { $in: ['Scheduled', 'In Progress'] }
      })
        .sort({ createdAt: -1 })
        .lean(),
      PpmTask.aggregate([
        { $match: { asset: { $in: assetIds }, store: storeOid, status: 'Completed' } },
        { $sort: { completed_at: -1 } },
        { $group: { _id: '$asset', completed_at: { $first: '$completed_at' } } }
      ])
    ]);

    const openByAsset = new Map();
    for (const t of openTasks) {
      const k = String(t.asset);
      if (!openByAsset.has(k)) {
        openByAsset.set(k, {
          ...t,
          checklist: mergePpmChecklistShape(t.checklist || [])
        });
      }
    }
    const lastMap = new Map(lastCompleted.map((x) => [String(x._id), x.completed_at]));

    const rows = assets.map((a) => {
      const cf = a.customFields && typeof a.customFields === 'object' ? a.customFields : {};
      const open = openByAsset.get(String(a._id)) || null;
      const fromTask = vmsLabelFromChecklist(open?.checklist);
      const fromCf = vmsLabelFromCustomFields(cf);
      const vmsLabel = fromTask || fromCf || '—';

      const assignedToName = a.assigned_to?.name || '—';
      const { assigned_to: _omit, ...assetOut } = a;

      return {
        asset: assetOut,
        vms_label: vmsLabel,
        assigned_to_name: assignedToName,
        open_task: open,
        last_completed_at: lastMap.get(String(a._id)) || null
      };
    });

    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load PPM asset list', error: error.message });
  }
});

router.get('/', protect, allowPpmRead, async (req, res) => {
  try {
    const {
      status = '',
      assigned_to = '',
      q = '',
      from = '',
      to = '',
      limit = '200'
    } = req.query || {};
    const filter = applyStoreScope(req);
    if (status) filter.status = status;
    if (assigned_to && mongoose.Types.ObjectId.isValid(assigned_to)) {
      filter.assigned_to = new mongoose.Types.ObjectId(assigned_to);
    }
    if (from || to) {
      filter.due_at = {};
      if (from) filter.due_at.$gte = new Date(from);
      if (to) filter.due_at.$lte = new Date(to);
    }

    const rows = await PpmTask.find(filter)
      .populate('assigned_to', 'name email role')
      .populate('completed_by', 'name email')
      .populate('incomplete_by', 'name email')
      .populate(
        'asset',
        'name model_number uniqueId abs_code ip_address serial_number mac_address expo_tag product_name ticket_number status store'
      )
      .sort({ due_at: 1, createdAt: -1 })
      .limit(Math.min(1000, Math.max(1, Number(limit) || 200)))
      .lean();

    const keyword = String(q || '').trim();
    const filtered = keyword
      ? rows.filter((r) => {
        if (assetMatchesPpmSearch(r.asset || {}, keyword)) return true;
        if (String(r.status || '').toLowerCase().includes(keyword.toLowerCase())) return true;
        return String(r.technician_notes || '').toLowerCase().includes(keyword.toLowerCase());
      })
      : rows;

    const now = Date.now();
    const withDerived = filtered.map((row) => {
      const derived = { ...row };
      if (
        (derived.status === 'Scheduled' || derived.status === 'In Progress')
        && derived.due_at
        && new Date(derived.due_at).getTime() < now
      ) {
        derived.status = 'Overdue';
      }
      derived.checklist = mergePpmChecklistShape(derived.checklist || []);
      return derived;
    });

    res.json(withDerived);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load PPM tasks', error: error.message });
  }
});

router.post('/', protect, restrictViewer, async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin can create PPM tasks' });
    }
    const {
      asset_id,
      assigned_to,
      scheduled_for,
      due_at,
      checklist,
      manager_notes
    } = req.body || {};

    if (!asset_id || !mongoose.Types.ObjectId.isValid(asset_id)) {
      return res.status(400).json({ message: 'Valid asset_id is required' });
    }
    const asset = await Asset.findById(asset_id).select('store');
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (req.activeStore && String(asset.store || '') !== String(req.activeStore)) {
      return res.status(403).json({ message: 'Asset is outside active store scope' });
    }

    const now = new Date();
    const dueDate = due_at ? new Date(due_at) : new Date(now.getTime() + PPM_CYCLE_MS);

    const task = await PpmTask.create({
      asset: asset._id,
      store: asset.store || null,
      status: 'Scheduled',
      scheduled_for: scheduled_for ? new Date(scheduled_for) : now,
      due_at: dueDate,
      checklist: normalizeChecklist(checklist),
      manager_notes: String(manager_notes || ''),
      assigned_to: (assigned_to && mongoose.Types.ObjectId.isValid(assigned_to)) ? assigned_to : undefined,
      created_by: req.user?._id,
      history: [{
        action: 'PPM Created',
        user: req.user?.name || '',
        email: req.user?.email || '',
        role: req.user?.role || '',
        details: 'Task created'
      }]
    });

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'PPM Created',
      details: `PPM task created for asset ${String(asset._id)}`,
      store: req.activeStore || asset.store || null
    });

    const out = await PpmTask.findById(task._id)
      .populate('assigned_to', 'name email role')
      .populate('asset', 'name model_number uniqueId abs_code ip_address status store')
      .lean();
    return res.status(201).json(out);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create PPM task', error: error.message });
  }
});

router.patch('/assets/:assetId/ppm-enabled', protect, restrictViewer, async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin can mark assets for PPM' });
    }
    const { assetId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(assetId)) {
      return res.status(400).json({ message: 'Invalid asset id' });
    }
    const enabled = Boolean(req.body?.enabled);
    const asset = await Asset.findById(assetId).select('store');
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (!req.activeStore || String(asset.store || '') !== String(req.activeStore)) {
      return res.status(403).json({ message: 'Asset is outside active store scope' });
    }
    await Asset.updateOne({ _id: asset._id }, { $set: { ppm_enabled: enabled } });
    return res.json({ _id: asset._id, ppm_enabled: enabled });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update PPM inclusion', error: error.message });
  }
});

router.post('/assets/:assetId/session', protect, restrictViewer, async (req, res) => {
  try {
    if (!['Technician', 'Admin', 'Super Admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    const { assetId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(assetId)) {
      return res.status(400).json({ message: 'Invalid asset id' });
    }
    const asset = await Asset.findById(assetId).select('store ppm_enabled');
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (!req.activeStore || String(asset.store || '') !== String(req.activeStore)) {
      return res.status(403).json({ message: 'Asset is outside active store scope' });
    }

    if (req.user?.role === 'Technician') {
      const openAssigned = await PpmTask.findOne({
        asset: asset._id,
        store: asset.store,
        status: { $in: ['Scheduled', 'In Progress'] },
        assigned_to: req.user._id
      })
        .select('_id')
        .lean();
      if (!asset.ppm_enabled && !openAssigned) {
        return res.status(403).json({
          message: 'This asset is not marked for PPM. Ask an admin to include it under PPM Work Orders.'
        });
      }
    }

    const existing = await PpmTask.findOne({
      asset: asset._id,
      store: asset.store,
      status: { $in: ['Scheduled', 'In Progress'] }
    }).sort({ createdAt: -1 });

    if (existing) {
      const merged = mergePpmChecklistShape(existing.checklist);
      const prevLen = Array.isArray(existing.checklist) ? existing.checklist.length : 0;
      const hadVms = (existing.checklist || []).some((x) => String(x?.key) === VMS_CHECKLIST_KEY);
      if (!hadVms || merged.length !== prevLen) {
        existing.checklist = merged;
        await existing.save();
      }
      const out = await PpmTask.findById(existing._id)
        .populate('assigned_to', 'name email role')
        .populate('asset', 'name model_number uniqueId abs_code ip_address status store product_name customFields')
        .lean();
      return res.json(out);
    }

    const now = new Date();
    const due = new Date(now.getTime() + PPM_CYCLE_MS);
    const task = await PpmTask.create({
      asset: asset._id,
      store: asset.store || null,
      status: 'In Progress',
      scheduled_for: now,
      due_at: due,
      started_at: now,
      checklist: normalizeChecklist(),
      created_by: req.user?._id,
      history: [{
        action: 'PPM Session Opened',
        user: req.user?.name || '',
        email: req.user?.email || '',
        role: req.user?.role || '',
        details: 'Technician self-service PPM (no assignment required)'
      }]
    });

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'PPM Session Opened',
      details: `Self-service PPM started for asset ${String(asset._id)}`,
      store: req.activeStore || asset.store || null
    });

    const out = await PpmTask.findById(task._id)
      .populate('assigned_to', 'name email role')
      .populate('asset', 'name model_number uniqueId abs_code ip_address status store product_name customFields')
      .lean();
    return res.status(201).json(out);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to open PPM session', error: error.message });
  }
});

router.patch('/:id/start', protect, restrictViewer, async (req, res) => {
  try {
    const task = await PpmTask.findById(req.params.id).populate('assigned_to', 'name email role');
    if (!task) return res.status(404).json({ message: 'PPM task not found' });
    if (!ensureTaskAccess(task, req)) return res.status(403).json({ message: 'Not allowed to start this task' });
    if (task.status === 'Cancelled') return res.status(400).json({ message: 'Cancelled task cannot be started' });
    if (task.status === 'Completed') return res.status(400).json({ message: 'Task is already completed' });
    if (task.status === 'Not Completed') return res.status(400).json({ message: 'Task is closed as not completed' });

    task.status = 'In Progress';
    if (!task.started_at) task.started_at = new Date();
    addTaskHistory(task, req, 'PPM Started', 'Technician started PPM checklist');
    await task.save();

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'PPM Started',
      details: `PPM task ${task._id} started`,
      store: req.activeStore || task.store || null
    });

    return res.json(task);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to start PPM task', error: error.message });
  }
});

router.patch('/:id/submit', protect, restrictViewer, async (req, res) => {
  try {
    const task = await PpmTask.findById(req.params.id).populate('assigned_to', 'name email role');
    if (!task) return res.status(404).json({ message: 'PPM task not found' });
    if (!ensureTaskAccess(task, req)) return res.status(403).json({ message: 'Not allowed to submit this task' });
    if (task.status === 'Cancelled' || task.status === 'Completed' || task.status === 'Not Completed') {
      return res.status(400).json({ message: 'Task is closed' });
    }
    const { checklist, equipment_used, technician_notes } = req.body || {};
    if (Array.isArray(checklist)) {
      task.checklist = normalizeChecklist(checklist.length ? checklist : task.checklist);
    }
    if (Array.isArray(equipment_used)) {
      task.equipment_used = equipment_used.map((x) => String(x || '').trim()).filter(Boolean);
    }
    task.technician_notes = String(technician_notes || task.technician_notes || '');
    if (task.status === 'Scheduled') {
      task.status = 'In Progress';
      task.started_at = task.started_at || new Date();
    }
    addTaskHistory(task, req, 'PPM Checklist Submitted', 'Checklist responses updated');
    await task.save();
    await syncVmsFromChecklistToAsset(task.asset, task.checklist);

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'PPM Checklist Submitted',
      details: `PPM checklist updated for task ${task._id}`,
      store: req.activeStore || task.store || null
    });

    return res.json(task);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to submit checklist', error: error.message });
  }
});

router.patch('/:id/complete', protect, restrictViewer, async (req, res) => {
  try {
    const task = await PpmTask.findById(req.params.id).populate('asset', 'name status condition location store history');
    if (!task) return res.status(404).json({ message: 'PPM task not found' });
    if (!ensureTaskAccess(task, req)) return res.status(403).json({ message: 'Not allowed to complete this task' });
    if (task.status === 'Cancelled') return res.status(400).json({ message: 'Task is cancelled' });
    if (task.status === 'Completed') return res.status(400).json({ message: 'Task already completed' });
    if (task.status === 'Not Completed') return res.status(400).json({ message: 'Task was marked as not completed' });

    const { checklist, equipment_used, technician_notes } = req.body || {};
    if (Array.isArray(checklist) && checklist.length > 0) {
      task.checklist = normalizeChecklist(checklist);
    }
    if (Array.isArray(equipment_used)) {
      task.equipment_used = equipment_used.map((x) => String(x || '').trim()).filter(Boolean);
    }
    if (technician_notes !== undefined) {
      task.technician_notes = String(technician_notes || '');
    }

    task.status = 'Completed';
    task.completed_at = new Date();
    task.completed_by = req.user?._id;
    addTaskHistory(task, req, 'PPM Completed', 'Task completed by technician');
    await task.save();
    await syncVmsFromChecklistToAsset(task.asset?._id || task.asset, task.checklist);

    const assetDoc = await Asset.findById(task.asset?._id || task.asset).select('history status condition location store');
    if (assetDoc) {
      assetDoc.history = Array.isArray(assetDoc.history) ? assetDoc.history : [];
      assetDoc.history.push({
        action: 'PPM Completed',
        details: `PPM task completed (${String(task._id)})`,
        user: req.user?.name || '',
        actor_email: req.user?.email || '',
        actor_role: req.user?.role || '',
        previous_status: assetDoc.status || '',
        previous_condition: assetDoc.condition || '',
        status: assetDoc.status || '',
        condition: assetDoc.condition || '',
        location: assetDoc.location || ''
      });
      await assetDoc.save();
    }

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'PPM Completed',
      details: `PPM task ${task._id} completed`,
      store: req.activeStore || task.store || null
    });

    return res.json(task);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to complete task', error: error.message });
  }
});

router.patch('/:id/mark-not-completed', protect, restrictViewer, async (req, res) => {
  try {
    const task = await PpmTask.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'PPM task not found' });
    if (!ensureTaskAccess(task, req)) return res.status(403).json({ message: 'Not allowed to update this task' });
    if (['Cancelled', 'Completed', 'Not Completed'].includes(task.status)) {
      return res.status(400).json({ message: 'This PPM is already closed' });
    }
    const reason = String(req.body?.technician_notes || '').trim();
    if (reason.length < 8) {
      return res.status(400).json({
        message: 'Please explain why the PPM could not be completed (at least 8 characters).'
      });
    }
    const { checklist, equipment_used } = req.body || {};
    if (Array.isArray(checklist) && checklist.length > 0) {
      task.checklist = normalizeChecklist(checklist);
    }
    if (Array.isArray(equipment_used)) {
      task.equipment_used = equipment_used.map((x) => String(x || '').trim()).filter(Boolean);
    }
    task.technician_notes = reason;
    task.status = 'Not Completed';
    task.incomplete_at = new Date();
    task.incomplete_by = req.user?._id;
    addTaskHistory(task, req, 'PPM Not Completed', reason);
    await task.save();
    await syncVmsFromChecklistToAsset(task.asset, task.checklist);

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'PPM Not Completed',
      details: `PPM task ${task._id} marked not completed`,
      store: req.activeStore || task.store || null
    });

    const out = await PpmTask.findById(task._id)
      .populate('assigned_to', 'name email role')
      .populate('incomplete_by', 'name email')
      .populate('asset', 'name model_number uniqueId abs_code ip_address status store product_name customFields')
      .lean();
    return res.json(out);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to mark PPM as not completed', error: error.message });
  }
});

// @route   PATCH /api/ppm/:id/reopen-for-edit
// Reopens a closed PPM so admin/technician can correct checklist and complete again.
router.patch('/:id/reopen-for-edit', protect, restrictViewer, async (req, res) => {
  try {
    const role = req.user?.role;
    if (!['Technician', 'Admin', 'Super Admin'].includes(role)) {
      return res.status(403).json({ message: 'Not allowed to reopen this PPM' });
    }

    const task = await PpmTask.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'PPM task not found' });
    if (!ensureTaskAccess(task, req)) return res.status(403).json({ message: 'Not allowed to edit this PPM' });

    if (task.status === 'Cancelled') {
      if (!isAdminRole(role)) {
        return res.status(403).json({ message: 'Only an admin can reopen a cancelled PPM' });
      }
      task.status = 'In Progress';
      task.cancelled_at = null;
      addTaskHistory(task, req, 'PPM Reopened for Edit', 'Previously cancelled — reopened for correction');
    } else if (task.status === 'Completed') {
      task.status = 'In Progress';
      task.completed_at = null;
      task.completed_by = null;
      addTaskHistory(task, req, 'PPM Reopened for Edit', 'Completed record reopened for correction');
    } else if (task.status === 'Not Completed') {
      task.status = 'In Progress';
      task.incomplete_at = null;
      task.incomplete_by = null;
      addTaskHistory(task, req, 'PPM Reopened for Edit', 'Not-completed record reopened for correction');
    } else {
      return res.status(400).json({
        message: 'Only completed, not completed, or cancelled PPMs can be reopened for editing'
      });
    }

    task.started_at = task.started_at || new Date();
    task.checklist = mergePpmChecklistShape(task.checklist || []);
    await task.save();

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'PPM Reopened for Edit',
      details: `Task ${task._id} reopened for checklist correction`,
      store: req.activeStore || task.store || null
    });

    const out = await PpmTask.findById(task._id)
      .populate('assigned_to', 'name email role')
      .populate('completed_by', 'name email')
      .populate('incomplete_by', 'name email')
      .populate('asset', 'name model_number uniqueId abs_code ip_address status store product_name customFields')
      .lean();
    if (out) out.checklist = mergePpmChecklistShape(out.checklist || []);
    return res.json(out);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to reopen PPM for editing', error: error.message });
  }
});

router.patch('/:id/cancel', protect, restrictViewer, async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin can cancel PPM tasks' });
    }
    const task = await PpmTask.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'PPM task not found' });
    if (task.status === 'Completed') return res.status(400).json({ message: 'Completed task cannot be cancelled' });

    task.status = 'Cancelled';
    task.cancelled_at = new Date();
    addTaskHistory(task, req, 'PPM Cancelled', String(req.body?.reason || 'Cancelled by admin'));
    await task.save();

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'PPM Cancelled',
      details: `PPM task ${task._id} cancelled`,
      store: req.activeStore || task.store || null
    });

    return res.json(task);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to cancel task', error: error.message });
  }
});

router.get('/:id/history', protect, allowPpmRead, async (req, res) => {
  try {
    const task = await PpmTask.findById(req.params.id).select('history store assigned_to');
    if (!task) return res.status(404).json({ message: 'PPM task not found' });
    if (!ensureTaskAccess(task, req)) return res.status(403).json({ message: 'Not allowed' });
    return res.json(task.history || []);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load task history', error: error.message });
  }
});

module.exports = router;
