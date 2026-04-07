const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const PpmTask = require('../models/PpmTask');
const Asset = require('../models/Asset');
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const {
  sendStoreEmail,
  getStoreNotificationRecipients,
  getStoreNotificationSubjects
} = require('../utils/storeEmail');
const { protect, restrictViewer } = require('../middleware/authMiddleware');

const router = express.Router();

/** PPM cycle length (default due / next-service horizon) — 180 days */
const PPM_CYCLE_MS = 180 * 24 * 60 * 60 * 1000;

/** Unique .xlsx filename per download (avoids overwriting the same file in Downloads). */
const ppmExportFilename = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `PPM_Report_${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}.xlsx`;
};

/** Latest completion is outside current 180-day window → due for a new cycle. */
const completionOutsideCurrentCycle = (completedAt, nowMs = Date.now()) => {
  if (!completedAt) return true;
  const t = new Date(completedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= PPM_CYCLE_MS;
};

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

const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const buildPpmStatusEmailRecipients = async ({ storeId, actorEmail }) => {
  const configuredRecipients = await getStoreNotificationRecipients(storeId || null);
  const admins = await User.find({
    role: { $in: ['Admin', 'Super Admin'] },
    $or: [
      { role: 'Super Admin' },
      { assignedStore: storeId || null }
    ]
  })
    .select('email')
    .lean();
  const adminEmails = admins.map((u) => String(u.email || '').trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set([
    ...configuredRecipients,
    ...adminEmails,
    String(actorEmail || '').trim().toLowerCase()
  ].filter(Boolean)));
};

const notifyPpmStatusChange = async ({
  task,
  req,
  status,
  actionLabel,
  details = ''
}) => {
  try {
    const recipients = await buildPpmStatusEmailRecipients({
      storeId: task?.store || req.activeStore || req.user?.assignedStore || null,
      actorEmail: req.user?.email || ''
    });
    if (recipients.length === 0) return;
    const assetName = String(
      task?.asset?.model_number ||
      task?.asset?.name ||
      task?.asset?.product_name ||
      'Asset'
    );
    const uid = String(task?.asset?.uniqueId || '—');
    const abs = String(task?.asset?.abs_code || '—');
    const ip = String(task?.asset?.ip_address || '—');
    const assignedTo = String(task?.assigned_to?.name || 'Unassigned');
    const by = `${String(req.user?.name || 'Unknown')} (${String(req.user?.role || '-')})`;
    const taskId = String(task?._id || '');
    const safeDetails = String(details || '').trim();
    const subjects = await getStoreNotificationSubjects(task?.store || req.activeStore || null);
    const ppmPrefix = subjects.ppm || 'Expo City Dubai PPM Notification';

    const subject = `${ppmPrefix}: ${status} - ${uid} (${assetName})`;
    const lines = [
      `PPM status updated: ${status}`,
      `Action: ${actionLabel}`,
      `Asset: ${assetName}`,
      `Unique ID: ${uid}`,
      `ABS Code: ${abs}`,
      `IP Address: ${ip}`,
      `Assigned To: ${assignedTo}`,
      `Task ID: ${taskId}`,
      `Updated By: ${by}`
    ];
    if (safeDetails) lines.push(`Details: ${safeDetails}`);
    const text = lines.join('\n');
    const html = `<div>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>`;

    await sendStoreEmail({
      storeId: task?.store || req.activeStore || null,
      to: recipients.join(','),
      subject,
      text,
      html,
      context: 'expo-city-dubai-ppm-notification'
    });
  } catch (error) {
    console.error('PPM status notification email error:', error.message);
  }
};

const loadTaskForStatusNotification = async (taskId) => PpmTask.findById(taskId)
  .populate('asset', 'name model_number product_name uniqueId abs_code ip_address')
  .populate('assigned_to', 'name email role')
  .lean();

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

/**
 * Same asset set as GET /ppm/overview "in program": ppm_enabled ∪ in-store asset with a non-cancelled PPM task.
 * Work Orders (self-service) must use this for empty search so KPIs match the table.
 */
const loadProgramScopedAssetObjectIds = async (storeOid) => {
  const [enabledIds, taskAssetIdsRaw] = await Promise.all([
    Asset.find({
      store: storeOid,
      disposed: { $ne: true },
      ppm_enabled: true
    }).distinct('_id'),
    PpmTask.distinct('asset', {
      store: storeOid,
      status: { $ne: 'Cancelled' }
    })
  ]);

  const taskAssetIdsValid =
    taskAssetIdsRaw.length > 0
      ? await Asset.find({
        _id: { $in: taskAssetIdsRaw },
        store: storeOid,
        disposed: { $ne: true }
      }).distinct('_id')
      : [];

  const programIdSet = new Set([
    ...enabledIds.map((id) => String(id)),
    ...taskAssetIdsValid.map((id) => String(id))
  ]);
  return [...programIdSet].map((id) => new mongoose.Types.ObjectId(id));
};

router.get('/overview', protect, allowPpmRead, async (req, res) => {
  try {
    const now = new Date();
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) {
      return res.json({ total: 0, overdue: 0, completed: 0, notCompleted: 0, open: 0, health: 100 });
    }
    const storeOid = new mongoose.Types.ObjectId(req.activeStore);

    const programAssetIds = await loadProgramScopedAssetObjectIds(storeOid);

    const total = programAssetIds.length;

    if (total === 0) {
      return res.json({ total: 0, overdue: 0, completed: 0, notCompleted: 0, open: 0, health: 100 });
    }

    const [latestTasks, taskOverdueCount] = await Promise.all([
      PpmTask.aggregate([
        {
          $match: {
            store: storeOid,
            asset: { $in: programAssetIds },
            status: { $ne: 'Cancelled' }
          }
        },
        { $sort: { updatedAt: -1 } },
        {
          $group: {
            _id: '$asset',
            status: { $first: '$status' },
            completed_at: { $first: '$completed_at' }
          }
        }
      ]),
      PpmTask.countDocuments({
        store: storeOid,
        asset: { $in: programAssetIds },
        status: { $in: ['Scheduled', 'In Progress', 'Overdue'] },
        due_at: { $lt: now }
      })
    ]);

    const byAsset = new Map(latestTasks.map((x) => [String(x._id), x]));

    const nowMs = now.getTime();
    let completed = 0;
    let notCompleted = 0;
    let open = 0;
    let cycleDue = 0;
    for (const aid of programAssetIds) {
      const row = byAsset.get(String(aid));
      if (!row) {
        open += 1;
        continue;
      }
      const st = row.status;
      if (st === 'Completed') {
        if (completionOutsideCurrentCycle(row.completed_at, nowMs)) {
          open += 1;
          cycleDue += 1;
        } else {
          completed += 1;
        }
      } else if (st === 'Not Completed') notCompleted += 1;
      else open += 1;
    }

    const overdue = taskOverdueCount + cycleDue;

    const health = total > 0 ? Math.round((completed / total) * 100) : 100;
    res.json({ total, overdue, completed, notCompleted, open, health });
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
    const ws = wb.addWorksheet('PPM tasks');
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

    const generatedAt = new Date().toISOString();
    const info = wb.addWorksheet('Export info');
    info.addRows([
      ['PPM Excel export'],
      ['Generated (UTC)', generatedAt],
      ['PPM cycle', '180 days — after this from last completion, dashboards treat the asset as due for the next cycle.'],
      ['Filename', 'Each download uses a new date+time in the name so files are not overwritten in your Downloads folder.'],
      ['Tasks sheet', 'All PPM task rows in your active store scope (up to 8000, newest first).']
    ]);
    info.getColumn(1).width = 22;
    info.getColumn(2).width = 72;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const fname = ppmExportFilename();
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
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
    const programOnly =
      String(req.query.program_only || '').toLowerCase() === 'true';

    const assetSelect =
      'name model_number uniqueId abs_code ip_address serial_number mac_address expo_tag ticket_number status condition product_name customFields store assigned_to ppm_enabled';

    let assets;
    if (keywordLower) {
      assets = await Asset.find({ store: storeOid, disposed: { $ne: true } })
        .select(assetSelect)
        .populate('assigned_to', 'name email')
        .sort({ uniqueId: 1, name: 1 })
        .limit(2500)
        .lean();
      assets = assets.filter((a) => assetMatchesPpmSearch(a, keyword));
    } else if (cameraOnly) {
      assets = await Asset.find({ store: storeOid, disposed: { $ne: true } })
        .select(assetSelect)
        .populate('assigned_to', 'name email')
        .sort({ uniqueId: 1, name: 1 })
        .limit(1200)
        .lean();
      assets = assets.filter((a) =>
        /camera/i.test(String(a.product_name || a.name || a.model_number || ''))
      );
    } else {
      /**
       * Empty search: same asset universe as GET /ppm/overview so KPIs match the table.
       * (Previously: admins only saw ppm_enabled; overview also counted task-only assets → wrong % / counts.)
       */
      const useProgramListScope =
        req.user?.role === 'Technician' ||
        (isAdminRole(req.user?.role) && programOnly);
      if (!useProgramListScope) {
        return res.json([]);
      }
      const programIds = await loadProgramScopedAssetObjectIds(storeOid);
      if (programIds.length === 0) {
        return res.json([]);
      }
      assets = await Asset.find({
        store: storeOid,
        disposed: { $ne: true },
        _id: { $in: programIds }
      })
        .select(assetSelect)
        .populate('assigned_to', 'name email')
        .sort({ uniqueId: 1, name: 1 })
        .limit(8000)
        .lean();
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

const ppmListKeywordMatch = (row, keyword) => {
  if (!keyword) return true;
  if (assetMatchesPpmSearch(row.asset || {}, keyword)) return true;
  if (String(row.status || '').toLowerCase().includes(keyword.toLowerCase())) return true;
  return String(row.technician_notes || '').toLowerCase().includes(keyword.toLowerCase());
};

const applyPpmTaskListPopulates = (q) =>
  q
    .populate('assigned_to', 'name email role')
    .populate('completed_by', 'name email')
    .populate('incomplete_by', 'name email')
    .populate(
      'asset',
      'name model_number uniqueId abs_code ip_address serial_number mac_address expo_tag product_name ticket_number status store'
    );

router.get('/', protect, allowPpmRead, async (req, res) => {
  try {
    const {
      status = '',
      assigned_to = '',
      q = '',
      from = '',
      to = '',
      limit = '200',
      page: pageRaw
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

    const keyword = String(q || '').trim();
    const hasPage =
      pageRaw !== undefined && pageRaw !== null && String(pageRaw).trim() !== '';
    const pageNum = hasPage ? Math.max(1, parseInt(String(pageRaw), 10) || 1) : 1;
    const legacyLimit = Math.min(1000, Math.max(1, Number(limit) || 200));
    const pageSize = hasPage
      ? Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50))
      : legacyLimit;

    let rows;
    let totalForPage = 0;

    if (hasPage) {
      if (!keyword) {
        totalForPage = await PpmTask.countDocuments(filter);
        const pages = Math.max(1, Math.ceil(totalForPage / pageSize));
        const safePage = Math.min(pageNum, pages);
        rows = await applyPpmTaskListPopulates(
          PpmTask.find(filter).sort({ due_at: 1, createdAt: -1 })
        )
          .skip((safePage - 1) * pageSize)
          .limit(pageSize)
          .lean();
      } else {
        /** Keyword filter still runs in memory; cap scan so huge stores stay bounded. */
        const scanCap = 10000;
        const scanned = await applyPpmTaskListPopulates(
          PpmTask.find(filter).sort({ due_at: 1, createdAt: -1 }).limit(scanCap)
        ).lean();
        const filtered = scanned.filter((r) => ppmListKeywordMatch(r, keyword));
        totalForPage = filtered.length;
        const pages = Math.max(1, Math.ceil(totalForPage / pageSize));
        const safePage = Math.min(pageNum, pages);
        rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
      }
    } else {
      rows = await applyPpmTaskListPopulates(
        PpmTask.find(filter).sort({ due_at: 1, createdAt: -1 }).limit(legacyLimit)
      ).lean();
      rows = keyword ? rows.filter((r) => ppmListKeywordMatch(r, keyword)) : rows;
    }

    const now = Date.now();
    const withDerived = rows.map((row) => {
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

    if (hasPage) {
      const pages = Math.max(1, Math.ceil((totalForPage || 0) / pageSize));
      const safePage = Math.min(pageNum, pages);
      return res.json({
        items: withDerived,
        total: totalForPage,
        page: safePage,
        limit: pageSize,
        pages
      });
    }

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

// @route   POST /api/ppm/reset-program
// @desc    Remove all PPM tasks for the active store and clear ppm_enabled on assets (admin password required)
router.post('/reset-program', protect, restrictViewer, async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin can reset the PPM program' });
    }
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) {
      return res.status(400).json({ message: 'Active store is required' });
    }
    const password = String(req.body?.password || '');
    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const storeOid = new mongoose.Types.ObjectId(req.activeStore);
    const del = await PpmTask.deleteMany({ store: storeOid });
    const assetUpd = await Asset.updateMany(
      { store: storeOid, disposed: { $ne: true } },
      { $set: { ppm_enabled: false } }
    );

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'PPM Program Reset',
      details: `Removed ${del.deletedCount} PPM task(s); cleared PPM inclusion on ${assetUpd.modifiedCount} asset(s) in active store`,
      store: req.activeStore
    });

    return res.json({
      deletedTasks: del.deletedCount,
      assetsPpmCleared: assetUpd.modifiedCount
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to reset PPM program', error: error.message });
  }
});

// @route   PATCH /api/ppm/assets/bulk-ppm-enabled (must be before /assets/:assetId/...)
router.patch('/assets/bulk-ppm-enabled', protect, restrictViewer, async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin can mark assets for PPM' });
    }
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) {
      return res.status(400).json({ message: 'Active store is required' });
    }
    const storeOid = new mongoose.Types.ObjectId(req.activeStore);
    const raw = req.body?.asset_ids;
    const enabled = Boolean(req.body?.enabled);
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({ message: 'asset_ids array is required' });
    }
    const ids = raw
      .map((id) => (mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(id) : null))
      .filter(Boolean);
    if (ids.length === 0) {
      return res.status(400).json({ message: 'No valid asset ids' });
    }
    if (ids.length > 2000) {
      return res.status(400).json({ message: 'Too many assets in one request (max 2000)' });
    }
    const result = await Asset.updateMany(
      { _id: { $in: ids }, store: storeOid, disposed: { $ne: true } },
      { $set: { ppm_enabled: enabled } }
    );
    return res.json({ matched: result.matchedCount, modified: result.modifiedCount });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to bulk-update PPM inclusion', error: error.message });
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

    const notifyTask = await loadTaskForStatusNotification(task._id);
    if (notifyTask) {
      await notifyPpmStatusChange({
        task: notifyTask,
        req,
        status: 'In Progress',
        actionLabel: 'PPM Started',
        details: 'Technician started PPM checklist'
      });
    }

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
    const prevStatus = task.status;
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

    if (prevStatus === 'Scheduled' && task.status === 'In Progress') {
      const notifyTask = await loadTaskForStatusNotification(task._id);
      if (notifyTask) {
        await notifyPpmStatusChange({
          task: notifyTask,
          req,
          status: 'In Progress',
          actionLabel: 'PPM Checklist Submitted',
          details: 'Checklist responses updated'
        });
      }
    }

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

    const notifyTask = await loadTaskForStatusNotification(task._id);
    if (notifyTask) {
      await notifyPpmStatusChange({
        task: notifyTask,
        req,
        status: 'Completed',
        actionLabel: 'PPM Completed',
        details: task.technician_notes || ''
      });
    }

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
    if (out) {
      await notifyPpmStatusChange({
        task: out,
        req,
        status: 'Not Completed',
        actionLabel: 'PPM Not Completed',
        details: reason
      });
    }
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
    if (out) {
      await notifyPpmStatusChange({
        task: out,
        req,
        status: 'In Progress',
        actionLabel: 'PPM Reopened for Edit',
        details: 'Closed checklist reopened for correction'
      });
    }
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

    const notifyTask = await loadTaskForStatusNotification(task._id);
    if (notifyTask) {
      await notifyPpmStatusChange({
        task: notifyTask,
        req,
        status: 'Cancelled',
        actionLabel: 'PPM Cancelled',
        details: String(req.body?.reason || 'Cancelled by admin')
      });
    }

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
