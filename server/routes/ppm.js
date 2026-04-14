const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const multer = require('multer');
const PpmTask = require('../models/PpmTask');
const PpmWorkflowTask = require('../models/PpmWorkflowTask');
const PpmAssetTemp = require('../models/PpmAssetTemp');
const PpmHistoryLog = require('../models/PpmHistoryLog');
const Asset = require('../models/Asset');
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const Store = require('../models/Store');
const {
  sendStoreEmail,
  getStoreNotificationRecipients,
  getStoreNotificationSubjects
} = require('../utils/storeEmail');
const { protect, restrictViewer, resolveAssignedStoreId } = require('../middleware/authMiddleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/** PPM cycle length (default due / next-service horizon) — 180 days */
const PPM_CYCLE_MS = 180 * 24 * 60 * 60 * 1000;

/** Match `store` whether it was stored as ObjectId or as the same 24-hex string (mixed/legacy data). */
const matchPpmStoreScope = (storeOid) => {
  const oid =
    storeOid instanceof mongoose.Types.ObjectId
      ? storeOid
      : new mongoose.Types.ObjectId(String(storeOid));
  return { $in: [oid, String(oid)] };
};

/**
 * Active store for manager queue / section / reviews (matches GET /manager/pending):
 * req.activeStore, then populated-safe assignedStore, then x-active-store header.
 */
function resolvePpmManagerQueueStoreId(req) {
  if (req.activeStore && mongoose.Types.ObjectId.isValid(String(req.activeStore))) {
    return String(req.activeStore);
  }
  const fromUser = resolveAssignedStoreId(req.user);
  if (fromUser && mongoose.Types.ObjectId.isValid(fromUser)) {
    return fromUser;
  }
  const hs = req.headers['x-active-store'] && String(req.headers['x-active-store']).trim();
  if (hs && hs !== 'undefined' && hs !== 'all' && mongoose.Types.ObjectId.isValid(hs)) {
    return hs;
  }
  return null;
}

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

/** Same buckets as GET /ppm/overview (latest non-cancelled task per asset). */
const ppmAssetSelfServiceBucket = (latestRow, nowMs = Date.now()) => {
  if (!latestRow) return 'pending';
  const st = String(latestRow.status || '');
  if (st === 'Not Completed') return 'not_completed';
  if (st === 'Completed') {
    return completionOutsideCurrentCycle(latestRow.completed_at, nowMs) ? 'pending' : 'completed';
  }
  return 'pending';
};

const aggregateLatestPpmRowByAsset = async (storeScope, assetObjectIds) => {
  if (!assetObjectIds.length) return new Map();
  const rows = await PpmTask.aggregate([
    {
      $match: {
        store: storeScope,
        asset: { $in: assetObjectIds },
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
  ]);
  return new Map(rows.map((x) => [String(x._id), { status: x.status, completed_at: x.completed_at }]));
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
    value: '',
    notes: ''
  }
];

const normalizeStandardItemValue = (raw) => {
  const s = String(raw || '');
  return ['Good', 'Needs Replace', 'No'].includes(s) ? s : 'Good';
};

const normalizeVmsItemValue = (raw) => {
  const s = String(raw || '');
  return s === 'Online' || s === 'Offline' ? s : '';
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

/** ActivityLog requires non-empty email/role; some users omit email in the database. */
const activityLogUserEmail = (req) => {
  const e = String(req?.user?.email || '').trim();
  return e || 'noreply@activity-log.local';
};

const activityLogUserRole = (req) => {
  const r = String(req?.user?.role || '').trim();
  return r || 'unknown';
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

const isManagerLikeRole = (role) => String(role || '').toLowerCase().includes('manager');
const isAdminRole = (role) => role === 'Admin' || isManagerLikeRole(role) || role === 'Super Admin';
/** Flowchart: only Admin submits work to the manager queue (not store Manager role). */
const canSubmitPpmToManagerQueue = (role) => role === 'Admin' || role === 'Super Admin';
const canUsePpmRole = (role) => role === 'Technician' || isAdminRole(role);
const canAccessPpmAssetList = (role) => canUsePpmRole(role) || role === 'Viewer';

const allowPpmRead = (req, res, next) => {
  const ok = canUsePpmRole(req.user?.role) || req.user?.role === 'Viewer';
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

/** Admin has not yet put this open PPM in the manager queue → hide from Manager dashboards (Admin still sees all). */
const excludeProgramAssetsUnsubmittedManagerQueue = async (storeScope, programAssetIds) => {
  if (!programAssetIds.length) return [];
  const blocked = await PpmTask.distinct('asset', {
    store: storeScope,
    asset: { $in: programAssetIds },
    status: { $in: ['Scheduled', 'In Progress', 'Overdue'] },
    'manager_review.status': 'Pending',
    manager_notification_pending: { $ne: true }
  });
  const blockedSet = new Set(blocked.map((id) => String(id)));
  return programAssetIds.filter((id) => !blockedSet.has(String(id)));
};

/**
 * Same asset set as GET /ppm/overview "in program": ppm_enabled ∪ in-store asset with a non-cancelled PPM task.
 * Work Orders (self-service) must use this for empty search so KPIs match the table.
 *
 * @param storeOid Store ObjectId
 * @param [options] For Technician/Viewer, assets with an open PPM task whose
 *   manager_review.status is not Approved are excluded, plus assets whose latest PPM row is
 *   Cancelled after a manager Reject (task leaves "open" states but must stay hidden until new work).
 *   For Manager (not Admin/Super Admin), assets whose open PPM is still Pending but not yet submitted to
 *   the manager queue (admin has not clicked Send notification) are excluded so draft imports stay admin-only.
 */
const loadProgramScopedAssetObjectIds = async (storeOid, options = {}) => {
  const viewerRole = String(options.viewerRole || '');
  const storeScope = matchPpmStoreScope(storeOid);
  const [enabledIds, taskAssetIdsRaw] = await Promise.all([
    Asset.find({
      store: storeScope,
      disposed: { $ne: true },
      ppm_enabled: true
    }).distinct('_id'),
    PpmTask.distinct('asset', {
      store: storeScope,
      status: { $ne: 'Cancelled' }
    })
  ]);

  const taskAssetIdsValid =
    taskAssetIdsRaw.length > 0
      ? await Asset.find({
        _id: { $in: taskAssetIdsRaw },
        store: storeScope,
        disposed: { $ne: true }
      }).distinct('_id')
      : [];

  const programIdSet = new Set([
    ...enabledIds.map((id) => String(id)),
    ...taskAssetIdsValid.map((id) => String(id))
  ]);
  let ids = [...programIdSet].map((id) => new mongoose.Types.ObjectId(id));
  if (viewerRole === 'Technician' || viewerRole === 'Viewer') {
    ids = await excludeProgramAssetsPendingManagerReview(storeScope, ids);
  } else if (
    isManagerLikeRole(viewerRole)
    && viewerRole !== 'Admin'
    && viewerRole !== 'Super Admin'
  ) {
    ids = await excludeProgramAssetsUnsubmittedManagerQueue(storeScope, ids);
  }
  return ids;
};

/** Open work not manager-approved, or latest row is a post-reject cancellation → hidden from Technician/Viewer. */
const excludeProgramAssetsPendingManagerReview = async (storeScope, programAssetIds) => {
  if (!programAssetIds.length) return [];
  const oidList = programAssetIds.map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id))
  );
  const [blockedOpenNotApproved, blockedTailRejection] = await Promise.all([
    PpmTask.aggregate([
      {
        $match: {
          store: storeScope,
          asset: { $in: oidList },
          status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }
        }
      },
      {
        $group: {
          _id: '$asset',
          openCount: { $sum: 1 },
          approvedOpenCount: {
            $sum: {
              $cond: [{ $eq: ['$manager_review.status', 'Approved'] }, 1, 0]
            }
          }
        }
      },
      {
        $match: {
          openCount: { $gt: 0 },
          approvedOpenCount: 0
        }
      },
      { $project: { _id: 0, asset: '$_id' } }
    ]),
    PpmTask.aggregate([
      { $match: { store: storeScope, asset: { $in: oidList } } },
      { $sort: { updatedAt: -1 } },
      {
        $group: {
          _id: '$asset',
          lastStatus: { $first: '$status' },
          lastReview: { $first: '$manager_review.status' }
        }
      },
      {
        $match: {
          lastStatus: 'Cancelled',
          lastReview: 'Rejected'
        }
      },
      { $project: { _id: 0, asset: '$_id' } }
    ])
  ]);
  const openBlocked = (blockedOpenNotApproved || []).map((r) => r.asset).filter(Boolean);
  const fromAgg = (blockedTailRejection || []).map((r) => r.asset).filter(Boolean);
  const blockedSet = new Set(
    [...openBlocked, ...fromAgg].map((id) => String(id))
  );
  return programAssetIds.filter((id) => !blockedSet.has(String(id)));
};

const technicianBlockedByManagerReview = (task) => {
  const open = ['Scheduled', 'In Progress', 'Overdue'].includes(String(task?.status || ''));
  if (!open) return false;
  return String(task?.manager_review?.status || '') !== 'Approved';
};

/** Match PpmAssetTemp / import row fields to a store asset (same rules as bulk upload). */
/**
 * Latest PPM task per asset that carries manager_notes or manager_review.comment.
 * Used so the work-order table still shows manager feedback after a task is Cancelled
 * (open_task query uses Scheduled / In Progress / Overdue).
 */
const latestManagerCommentByAsset = async (storeScope, assetObjectIds) => {
  if (!assetObjectIds.length) return new Map();
  const rows = await PpmTask.aggregate([
    {
      $match: {
        store: storeScope,
        asset: { $in: assetObjectIds },
        $or: [
          { manager_notes: { $exists: true, $nin: [null, ''] } },
          { 'manager_review.comment': { $exists: true, $nin: [null, ''] } }
        ]
      }
    },
    { $sort: { updatedAt: -1 } },
    {
      $group: {
        _id: '$asset',
        manager_notes: { $first: '$manager_notes' },
        manager_review: { $first: '$manager_review' }
      }
    }
  ]);
  const m = new Map();
  for (const r of rows) {
    m.set(String(r._id), {
      manager_notes: r.manager_notes != null ? String(r.manager_notes) : '',
      manager_review: r.manager_review && typeof r.manager_review === 'object' ? r.manager_review : {}
    });
  }
  return m;
};

/**
 * Latest technician completion context per asset so Work Orders table can
 * show technician feedback even after task is closed (Completed / Not Completed).
 */
const latestTechnicianUpdateByAsset = async (storeScope, assetObjectIds) => {
  if (!assetObjectIds.length) return new Map();
  const rows = await PpmTask.aggregate([
    {
      $match: {
        store: storeScope,
        asset: { $in: assetObjectIds },
        status: { $in: ['Completed', 'Not Completed'] }
      }
    },
    {
      $addFields: {
        _activityAt: {
          $ifNull: ['$completed_at', { $ifNull: ['$incomplete_at', '$updatedAt'] }]
        }
      }
    },
    { $sort: { _activityAt: -1, updatedAt: -1 } },
    {
      $group: {
        _id: '$asset',
        technician_notes: { $first: '$technician_notes' },
        equipment_used: { $first: '$equipment_used' },
        checklist: { $first: '$checklist' },
        status: { $first: '$status' },
        completed_at: { $first: '$completed_at' },
        incomplete_at: { $first: '$incomplete_at' }
      }
    }
  ]);
  const m = new Map();
  for (const r of rows) {
    m.set(String(r._id), {
      technician_notes: r.technician_notes != null ? String(r.technician_notes) : '',
      equipment_used: Array.isArray(r.equipment_used)
        ? r.equipment_used.map((x) => String(x || '').trim()).filter(Boolean)
        : [],
      checklist: mergePpmChecklistShape(Array.isArray(r.checklist) ? r.checklist : []),
      status: String(r.status || ''),
      at: r.completed_at || r.incomplete_at || null
    });
  }
  return m;
};

/** In-memory match from PpmAssetTemp-shaped rows to store assets (same rules as bulk import). */
const buildPpmTempRowMatcher = (assets) => {
  const norm = (v) => String(v || '').trim().toLowerCase();
  const alnum = (v) => norm(v).replace(/[^a-z0-9]/g, '');
  const byUniqueId = new Map();
  const byAbs = new Map();
  const bySerial = new Map();
  const byMac = new Map();
  const byQr = new Map();
  const byRf = new Map();
  for (const a of assets || []) {
    const uid = alnum(a.uniqueId);
    const abs = alnum(a.abs_code);
    const sn = alnum(a.serial_number);
    const mac = alnum(a.mac_address);
    const qr = alnum(a.qr_code);
    const rf = alnum(a.rfid);
    if (uid && !byUniqueId.has(uid)) byUniqueId.set(uid, a);
    if (abs && !byAbs.has(abs)) byAbs.set(abs, a);
    if (sn && !bySerial.has(sn)) bySerial.set(sn, a);
    if (mac && !byMac.has(mac)) byMac.set(mac, a);
    if (qr && !byQr.has(qr)) byQr.set(qr, a);
    if (rf && !byRf.has(rf)) byRf.set(rf, a);
  }
  const matchRow = (row) => {
    const uid = alnum(row?.unique_id);
    if (uid && byUniqueId.has(uid)) return byUniqueId.get(uid);
    const abs = alnum(row?.abs_code);
    if (abs && byAbs.has(abs)) return byAbs.get(abs);
    const sn = alnum(row?.serial_number);
    if (sn && bySerial.has(sn)) return bySerial.get(sn);
    const qr = alnum(row?.qr_code);
    if (qr && byQr.has(qr)) return byQr.get(qr);
    const rf = alnum(row?.rf_id);
    if (rf && byRf.has(rf)) return byRf.get(rf);
    const mac = alnum(row?.mac_address);
    if (mac && byMac.has(mac)) return byMac.get(mac);
    return null;
  };
  return { matchRow };
};

const assetIdStringsFromTempRows = (tempRows, matchRow) => {
  const out = new Set();
  for (const row of tempRows || []) {
    const m = matchRow(row);
    if (m?._id) out.add(String(m._id));
  }
  return out;
};

const resolveAssetIdsFromPpmTempRows = async (storeOid, tempRows) => {
  const storeScope = matchPpmStoreScope(storeOid);
  const assets = await Asset.find({ store: storeScope, disposed: { $ne: true } })
    .select('_id uniqueId abs_code serial_number mac_address qr_code rfid')
    .lean();
  const { matchRow } = buildPpmTempRowMatcher(assets);
  const ids = assetIdStringsFromTempRows(tempRows, matchRow);
  return [...ids].map((id) => new mongoose.Types.ObjectId(id));
};

/**
 * Manager workflow card: ticket + schedule mirror admin PPM (asset ticket_number preferred over WO),
 * plus earliest scheduled_for / latest due_at and “days until due” from linked open tasks.
 */
async function hydrateWorkflowManagerCardFields(workflowLean, storeOid, tempAssets) {
  const w = workflowLean && typeof workflowLean === 'object' ? { ...workflowLean } : {};
  try {
    const linkedIds = await resolveAssetIdsFromPpmTempRows(storeOid, tempAssets || []);
    if (!linkedIds.length) return w;
    const storeScope = matchPpmStoreScope(storeOid);
    const [assetDocs, openTasks] = await Promise.all([
      Asset.find({ _id: { $in: linkedIds }, disposed: { $ne: true } }).select('ticket_number').lean(),
      PpmTask.find({
        store: storeScope,
        asset: { $in: linkedIds },
        status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }
      })
        .select('asset work_order_ticket scheduled_for due_at createdAt')
        .sort({ createdAt: -1 })
        .lean()
    ]);
    const assetById = new Map(assetDocs.map((a) => [String(a._id), a]));
    const taskByAsset = new Map();
    for (const t of openTasks) {
      const k = String(t.asset);
      if (!taskByAsset.has(k)) taskByAsset.set(k, t);
    }

    const ticketSet = new Set();
    for (const row of tempAssets || []) {
      const rt = String(row.ticket || '').trim();
      if (rt) ticketSet.add(rt);
    }
    for (const oid of linkedIds) {
      const aid = String(oid);
      const ast = assetById.get(aid);
      const tsk = taskByAsset.get(aid);
      const assetTk = String(ast?.ticket_number || '').trim();
      const wot = String(tsk?.work_order_ticket || '').trim();
      const eff = assetTk || wot;
      if (eff) ticketSet.add(eff);
    }

    if (!String(w.batch_ticket || '').trim()) {
      const arr = [...ticketSet];
      if (arr.length === 1) w.batch_ticket = arr[0];
      else if (arr.length > 1) w.batch_ticket = arr.join(', ');
    }

    const schedMs = openTasks
      .map((t) => new Date(t.scheduled_for).getTime())
      .filter((x) => Number.isFinite(x));
    const dueMs = openTasks
      .map((t) => new Date(t.due_at).getTime())
      .filter((x) => Number.isFinite(x));
    if (schedMs.length) {
      w.ppm_linked_scheduled_for = new Date(Math.min(...schedMs));
    }
    if (dueMs.length) {
      const maxDue = Math.max(...dueMs);
      w.ppm_linked_due_at = new Date(maxDue);
      const days = Math.ceil((maxDue - Date.now()) / 86400000);
      w.ppm_linked_days_label = days < 0 ? 'Overdue' : `${days} Day${days === 1 ? '' : 's'}`;
      if (schedMs.length) {
        const minSched = Math.min(...schedMs);
        w.ppm_linked_cycle_days = Math.round((maxDue - minSched) / 86400000);
      }
    }
  } catch {
    /* ignore */
  }
  return w;
}

/**
 * Manager actions on PpmWorkflowTask set manager_comment on the workflow and try to copy to PpmTask.
 * If temp-row → asset resolution failed at that moment, tasks never get manager_review.comment.
 * This map surfaces the workflow comment for program assets so the work-order table still shows it.
 */
const latestWorkflowManagerCommentByAsset = async (storeScope, programAssetIdSet) => {
  if (!programAssetIdSet || programAssetIdSet.size === 0) return new Map();
  const workflows = await PpmWorkflowTask.find({
    store: storeScope,
    manager_comment: { $exists: true, $nin: [null, ''] },
    status: { $in: ['Approved', 'Rejected', 'Modified'] }
  })
    .sort({ updatedAt: -1 })
    .limit(400)
    .lean();
  if (!workflows.length) return new Map();
  const wfIds = workflows.map((w) => w._id);
  const allTemps = await PpmAssetTemp.find({ ppm_task_id: { $in: wfIds } }).lean();
  const tempsByWf = new Map();
  for (const t of allTemps) {
    const k = String(t.ppm_task_id);
    if (!tempsByWf.has(k)) tempsByWf.set(k, []);
    tempsByWf.get(k).push(t);
  }
  const assets = await Asset.find({ store: storeScope, disposed: { $ne: true } })
    .select('_id uniqueId abs_code serial_number mac_address qr_code rfid')
    .lean();
  const { matchRow } = buildPpmTempRowMatcher(assets);
  const out = new Map();
  for (const w of workflows) {
    const comment = String(w.manager_comment || '').trim();
    if (!comment) continue;
    const temps = tempsByWf.get(String(w._id)) || [];
    const matched = assetIdStringsFromTempRows(temps, matchRow);
    for (const sid of matched) {
      if (!programAssetIdSet.has(sid)) continue;
      if (!out.has(sid)) {
        out.set(sid, { comment, status: w.status, at: w.updatedAt || w.createdAt || null });
      }
    }
  }
  return out;
};

/** Assets tied to a Pending/Modified workflow that was already submitted to the manager (dedupe vs per-asset queue). */
const assetIdsCoveredByPendingWorkflowQueues = async (storeOid) => {
  const storeScope = matchPpmStoreScope(storeOid);
  const wfs = await PpmWorkflowTask.find({
    store: storeScope,
    status: { $in: ['Pending', 'Modified'] },
    sent_to_manager_at: { $ne: null }
  })
    .select('_id')
    .lean();
  if (!wfs.length) return new Set();
  const wfIds = wfs.map((w) => w._id);
  const allTemps = await PpmAssetTemp.find({ ppm_task_id: { $in: wfIds } }).lean();
  const tempsByWf = new Map();
  for (const row of allTemps) {
    const k = String(row.ppm_task_id);
    if (!tempsByWf.has(k)) tempsByWf.set(k, []);
    tempsByWf.get(k).push(row);
  }
  const assets = await Asset.find({ store: storeScope, disposed: { $ne: true } })
    .select('_id uniqueId abs_code serial_number mac_address qr_code rfid')
    .lean();
  const { matchRow } = buildPpmTempRowMatcher(assets);
  const out = new Set();
  for (const w of wfs) {
    const temps = tempsByWf.get(String(w._id)) || [];
    for (const sid of assetIdStringsFromTempRows(temps, matchRow)) {
      out.add(sid);
    }
  }
  return out;
};

/** Import workflow batches not yet submitted — per-asset PPM rows must be notified via POST /ppm/notify-manager, not bulk task email. */
const assetIdsLinkedToUnsentWorkflowBatches = async (storeOid) => {
  const storeScope = matchPpmStoreScope(storeOid);
  const wfs = await PpmWorkflowTask.find({
    store: storeScope,
    status: { $in: ['Pending', 'Modified'] },
    $or: [{ sent_to_manager_at: null }, { sent_to_manager_at: { $exists: false } }]
  })
    .select('_id')
    .lean();
  if (!wfs.length) return new Set();
  const wfIds = wfs.map((w) => w._id);
  const allTemps = await PpmAssetTemp.find({ ppm_task_id: { $in: wfIds } }).lean();
  const tempsByWf = new Map();
  for (const row of allTemps) {
    const k = String(row.ppm_task_id);
    if (!tempsByWf.has(k)) tempsByWf.set(k, []);
    tempsByWf.get(k).push(row);
  }
  const assets = await Asset.find({ store: storeScope, disposed: { $ne: true } })
    .select('_id uniqueId abs_code serial_number mac_address qr_code rfid')
    .lean();
  const { matchRow } = buildPpmTempRowMatcher(assets);
  const out = new Set();
  for (const w of wfs) {
    const temps = tempsByWf.get(String(w._id)) || [];
    for (const sid of assetIdStringsFromTempRows(temps, matchRow)) {
      out.add(sid);
    }
  }
  return out;
};

const ppmTaskDocToBellRow = (t) => ({
  task_id: String(t._id),
  kind: 'work_order',
  status: String(t.manager_review?.status || 'Pending'),
  manager_comment: String(t.manager_review?.comment || t.manager_notes || '').trim(),
  assets_included: 1,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
  approved_broadcast_at: null
});

const fetchOpenPpmTasksForManagerBell = async (storeOid, coveredAssetIds, limit, { sinceDate } = {}) => {
  if (limit <= 0) return [];
  const storeScope = matchPpmStoreScope(storeOid);
  const needsAttention = {
    $or: [
      { 'manager_review.status': 'Pending' },
      { manager_notification_pending: true }
    ]
  };
  const q = {
    store: storeScope,
    status: { $in: ['Scheduled', 'In Progress', 'Overdue', 'Not Completed'] },
    $and: [needsAttention]
  };
  if (sinceDate) {
    q.$and.push({
      $or: [{ updatedAt: { $gte: sinceDate } }, { createdAt: { $gte: sinceDate } }]
    });
  }
  const nin = [...coveredAssetIds].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (nin.length) {
    q.asset = { $nin: nin.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  const rows = await PpmTask.find(q)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('_id manager_review manager_notes manager_notification_pending createdAt updatedAt')
    .lean();
  return rows.map(ppmTaskDocToBellRow);
};

const fetchPpmTasksWithManagerDecisionSince = async (storeOid, since, limit) => {
  if (limit <= 0) return [];
  const storeScope = matchPpmStoreScope(storeOid);
  const rows = await PpmTask.find({
    store: storeScope,
    'manager_review.reviewed_at': { $gte: since },
    'manager_review.status': { $in: ['Approved', 'Rejected', 'Modified'] }
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('_id manager_review manager_notes createdAt updatedAt')
    .lean();
  return rows.map(ppmTaskDocToBellRow);
};

const fetchPpmTaskDecisionRowsForRole = async (storeOid, limit, { sinceDate, statuses } = {}) => {
  if (limit <= 0) return [];
  const wanted = Array.isArray(statuses) && statuses.length > 0
    ? statuses.map((s) => String(s))
    : ['Approved', 'Rejected', 'Modified'];
  const query = {
    store: matchPpmStoreScope(storeOid),
    'manager_review.status': { $in: wanted }
  };
  if (sinceDate) {
    query.$or = [{ updatedAt: { $gte: sinceDate } }, { createdAt: { $gte: sinceDate } }];
  }
  const rows = await PpmTask.find(query)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('_id manager_review manager_notes createdAt updatedAt')
    .lean();
  return rows.map(ppmTaskDocToBellRow);
};

const sortBellRowsDesc = (rows) =>
  [...rows].sort((a, b) => {
    const tb = new Date(b.updated_at || b.created_at || 0).getTime();
    const ta = new Date(a.updated_at || a.created_at || 0).getTime();
    return tb - ta;
  });

router.get('/overview', protect, allowPpmRead, async (req, res) => {
  try {
    const now = new Date();
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) {
      return res.json({ total: 0, overdue: 0, completed: 0, notCompleted: 0, open: 0, health: 100 });
    }
    const storeOid = new mongoose.Types.ObjectId(req.activeStore);
    const storeScope = matchPpmStoreScope(storeOid);

    const programAssetIds = await loadProgramScopedAssetObjectIds(storeOid, { viewerRole: req.user?.role });

    const total = programAssetIds.length;

    if (total === 0) {
      return res.json({ total: 0, overdue: 0, completed: 0, notCompleted: 0, open: 0, health: 100 });
    }

    const [latestTasks, taskOverdueCount] = await Promise.all([
      PpmTask.aggregate([
        {
          $match: {
            store: storeScope,
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
        store: storeScope,
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
    let filter = applyStoreScope(req, {});
    if (
      isManagerLikeRole(req.user?.role)
      && req.user?.role !== 'Admin'
      && req.user?.role !== 'Super Admin'
    ) {
      filter = {
        ...filter,
        $and: [
          ...(Array.isArray(filter.$and) ? filter.$and : []),
          {
            $nor: [{
              status: { $in: ['Scheduled', 'In Progress', 'Overdue'] },
              'manager_review.status': 'Pending',
              manager_notification_pending: { $ne: true }
            }]
          }
        ]
      };
    }
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

// @route   GET /api/ppm/export-bulk-sheet
// @desc    Export current PPM program assets in the same format used by bulk import.
router.get('/export-bulk-sheet', protect, allowPpmRead, async (req, res) => {
  try {
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) {
      return res.status(400).json({ message: 'Active store is required' });
    }
    const storeOid = new mongoose.Types.ObjectId(req.activeStore);
    const storeScope = matchPpmStoreScope(storeOid);
    const programAssetIds = await loadProgramScopedAssetObjectIds(storeOid, { viewerRole: req.user?.role });
    if (programAssetIds.length === 0) {
      return res.status(400).json({ message: 'No assets in PPM program for this store.' });
    }

    const assets = await Asset.find({
      _id: { $in: programAssetIds },
      store: storeScope,
      disposed: { $ne: true }
    })
      .select('uniqueId abs_code name model_number serial_number qr_code rfid mac_address location ticket_number manufacturer status maintenance_vendor')
      .sort({ uniqueId: 1, abs_code: 1, name: 1 })
      .lean();

    const header = [
      'Unique ID',
      'ABS Code',
      'Name',
      'Model Number',
      'Serial Number',
      'QR Code',
      'RF ID',
      'MAC Address',
      'Location',
      'Ticket',
      'Manufacturer',
      'Status',
      'Maintenance Vendor'
    ];

    const body = assets.map((a) => [
      String(a.uniqueId || ''),
      String(a.abs_code || ''),
      String(a.name || ''),
      String(a.model_number || ''),
      String(a.serial_number || ''),
      String(a.qr_code || ''),
      String(a.rfid || ''),
      String(a.mac_address || ''),
      String(a.location || ''),
      String(a.ticket_number || ''),
      String(a.manufacturer || ''),
      String(a.status || ''),
      String(a.maintenance_vendor || '')
    ]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('PPM Bulk Export');
    ws.addRows([header, ...body]);
    ws.columns = [
      { width: 18 },
      { width: 14 },
      { width: 24 },
      { width: 28 },
      { width: 22 },
      { width: 16 },
      { width: 14 },
      { width: 20 },
      { width: 18 },
      { width: 16 },
      { width: 18 },
      { width: 14 },
      { width: 24 }
    ];
    ws.autoFilter = `A1:${String.fromCharCode(64 + header.length)}1`;

    const fname = `PPM_Bulk_Export_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to export PPM bulk sheet', error: error.message });
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
  const qr = String(a.qr_code || '').trim().toLowerCase();
  const rf = String(a.rfid || '').trim().toLowerCase();
  if (uid && (uid.includes(query) || uid.includes(compact))) return true;
  if (abs && (abs.includes(query) || abs.includes(compact))) return true;
  if (ip && (ip.includes(query) || ip.includes(compact))) return true;
  if (serial && (serial.includes(query) || serial.includes(compact))) return true;
  if (mac && (mac.includes(query) || mac.includes(compact))) return true;
  if (expo && (expo.includes(query) || expo.includes(compact))) return true;
  if (qr && (qr.includes(query) || qr.includes(compact))) return true;
  if (rf && (rf.includes(query) || rf.includes(compact))) return true;
  return [
    a.name,
    a.model_number,
    a.product_name,
    a.ticket_number,
    a.location,
    a.manufacturer,
    a.status,
    a.maintenance_vendor
  ]
    .some((v) => String(v || '').toLowerCase().includes(query));
};

router.get('/self-service-assets', protect, allowPpmRead, async (req, res) => {
  try {
    if (!canAccessPpmAssetList(req.user?.role)) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) {
      return res.status(400).json({ message: 'Active store is required' });
    }
    const storeOid = new mongoose.Types.ObjectId(req.activeStore);
    const storeScope = matchPpmStoreScope(storeOid);
    const bucketRaw = String(req.query.ppm_bucket || 'all').trim().toLowerCase().replace(/\s+/g, '_');
    const ppmBucket =
      bucketRaw === 'completed' || bucketRaw === 'not_completed' || bucketRaw === 'pending'
        ? bucketRaw
        : 'all';
    const keyword = String(req.query.q || '').trim();
    const keywordLower = keyword.toLowerCase();
    const cameraOnly = String(req.query.camera_only || 'false').toLowerCase() === 'true';
    const programOnly =
      String(req.query.program_only || '').toLowerCase() === 'true';
    const hasPage =
      req.query.page !== undefined && req.query.page !== null && String(req.query.page).trim() !== '';
    const pageNum = hasPage ? Math.max(1, parseInt(String(req.query.page), 10) || 1) : 1;
    const pageSize = hasPage ? Math.min(200, Math.max(1, parseInt(String(req.query.limit), 10) || 50)) : null;

    const assetSelect =
      'name model_number uniqueId abs_code ip_address serial_number mac_address expo_tag ticket_number status condition product_name customFields store assigned_to ppm_enabled manufacturer maintenance_vendor qr_code rfid location';

    let assets;
    let pageMeta = null;
    if (keywordLower) {
      assets = await Asset.find({ store: storeScope, disposed: { $ne: true } })
        .select(assetSelect)
        .populate('assigned_to', 'name email')
        .sort({ uniqueId: 1, name: 1 })
        .limit(2500)
        .lean();
      assets = assets.filter((a) => assetMatchesPpmSearch(a, keyword));
      if (req.user?.role === 'Technician' || req.user?.role === 'Viewer') {
        const allowed = new Set(
          (await loadProgramScopedAssetObjectIds(storeOid, { viewerRole: req.user.role })).map(String)
        );
        assets = assets.filter((a) => allowed.has(String(a._id)));
      } else if (
        isManagerLikeRole(req.user?.role)
        && req.user?.role !== 'Admin'
        && req.user?.role !== 'Super Admin'
      ) {
        const allowed = new Set(
          (await loadProgramScopedAssetObjectIds(storeOid, { viewerRole: req.user.role })).map(String)
        );
        assets = assets.filter((a) => allowed.has(String(a._id)));
      }
    } else if (cameraOnly) {
      assets = await Asset.find({ store: storeScope, disposed: { $ne: true } })
        .select(assetSelect)
        .populate('assigned_to', 'name email')
        .sort({ uniqueId: 1, name: 1 })
        .limit(1200)
        .lean();
      assets = assets.filter((a) =>
        /camera/i.test(String(a.product_name || a.name || a.model_number || ''))
      );
      if (req.user?.role === 'Technician' || req.user?.role === 'Viewer') {
        const allowed = new Set(
          (await loadProgramScopedAssetObjectIds(storeOid, { viewerRole: req.user.role })).map(String)
        );
        assets = assets.filter((a) => allowed.has(String(a._id)));
      } else if (
        isManagerLikeRole(req.user?.role)
        && req.user?.role !== 'Admin'
        && req.user?.role !== 'Super Admin'
      ) {
        const allowed = new Set(
          (await loadProgramScopedAssetObjectIds(storeOid, { viewerRole: req.user.role })).map(String)
        );
        assets = assets.filter((a) => allowed.has(String(a._id)));
      }
    } else {
      /**
       * Empty search: same asset universe as GET /ppm/overview so KPIs match the table.
       * (Previously: admins only saw ppm_enabled; overview also counted task-only assets → wrong % / counts.)
       */
      const useProgramListScope =
        req.user?.role === 'Technician' ||
        isAdminRole(req.user?.role) ||
        (req.user?.role === 'Viewer' && programOnly) ||
        (isManagerLikeRole(req.user?.role) && programOnly);
      if (!useProgramListScope) {
        return res.json([]);
      }
      const programIds = await loadProgramScopedAssetObjectIds(storeOid, { viewerRole: req.user?.role });
      if (programIds.length === 0) {
        if (hasPage) {
          return res.json({ items: [], total: 0, page: 1, pages: 1, limit: pageSize || 50 });
        }
        return res.json([]);
      }
      let scopedProgramIds = programIds;
      if (ppmBucket !== 'all') {
        const latestByAsset = await aggregateLatestPpmRowByAsset(storeScope, programIds);
        const nowMs = Date.now();
        scopedProgramIds = programIds.filter(
          (id) => ppmAssetSelfServiceBucket(latestByAsset.get(String(id)), nowMs) === ppmBucket
        );
      }
      if (scopedProgramIds.length === 0) {
        if (hasPage) {
          return res.json({ items: [], total: 0, page: 1, pages: 1, limit: pageSize || 50 });
        }
        return res.json([]);
      }
      const baseFilter = {
        store: storeScope,
        disposed: { $ne: true },
        _id: { $in: scopedProgramIds }
      };
      if (hasPage) {
        const total = await Asset.countDocuments(baseFilter);
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(pageNum, pages);
        assets = await Asset.find(baseFilter)
          .select(assetSelect)
          .populate('assigned_to', 'name email')
          .sort({ uniqueId: 1, name: 1 })
          .skip((safePage - 1) * pageSize)
          .limit(pageSize)
          .lean();
        pageMeta = { total, page: safePage, pages, limit: pageSize };
      } else {
        assets = await Asset.find(baseFilter)
          .select(assetSelect)
          .populate('assigned_to', 'name email')
          .sort({ uniqueId: 1, name: 1 })
          .limit(8000)
          .lean();
      }
    }

    const assetIds = assets.map((a) => a._id);
    if (assetIds.length === 0) {
      if (pageMeta) {
        return res.json({ items: [], total: pageMeta.total, page: pageMeta.page, pages: pageMeta.pages, limit: pageMeta.limit });
      }
      return res.json([]);
    }

    const programAssetIdSet = new Set(assetIds.map((id) => String(id)));

    const [openTasks, lastCompleted, managerCommentByAsset, workflowCommentByAsset, technicianUpdateByAsset] = await Promise.all([
      PpmTask.find({
        asset: { $in: assetIds },
        store: storeScope,
        status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }
      })
        .sort({ createdAt: -1 })
        .lean(),
      PpmTask.aggregate([
        { $match: { asset: { $in: assetIds }, store: storeScope, status: 'Completed' } },
        { $sort: { completed_at: -1 } },
        { $group: { _id: '$asset', completed_at: { $first: '$completed_at' } } }
      ]),
      latestManagerCommentByAsset(storeScope, assetIds),
      latestWorkflowManagerCommentByAsset(storeScope, programAssetIdSet),
      latestTechnicianUpdateByAsset(storeScope, assetIds)
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

    let rows = assets.map((a) => {
      const cf = a.customFields && typeof a.customFields === 'object' ? a.customFields : {};
      const open = openByAsset.get(String(a._id)) || null;
      const fb = managerCommentByAsset.get(String(a._id)) || null;
      const wfFb = workflowCommentByAsset.get(String(a._id)) || null;
      const techFb = technicianUpdateByAsset.get(String(a._id)) || null;
      const adminNotes = String(open?.manager_notes || fb?.manager_notes || '').trim();
      let wfReviewFallback = '';
      if (open && wfFb && String(wfFb.comment || '').trim()) {
        const wfMs = wfFb.at ? new Date(wfFb.at).getTime() : 0;
        const openMs = open.createdAt ? new Date(open.createdAt).getTime() : 0;
        if (wfMs >= openMs || !openMs) {
          wfReviewFallback = String(wfFb.comment).trim();
        }
      }
      const reviewComment = String(
        open?.manager_review?.comment || fb?.manager_review?.comment || wfReviewFallback || ''
      ).trim();
      const technicianNotes = String(open?.technician_notes || techFb?.technician_notes || '').trim();
      const technicianEquipment = Array.isArray(open?.equipment_used) && open.equipment_used.length > 0
        ? open.equipment_used
        : (Array.isArray(techFb?.equipment_used) ? techFb.equipment_used : []);
      const technicianChecklist = Array.isArray(open?.checklist) && open.checklist.length > 0
        ? mergePpmChecklistShape(open.checklist)
        : (Array.isArray(techFb?.checklist) ? techFb.checklist : []);
      const technicianStatus = String(open?.status || techFb?.status || '').trim();
      const technicianAt = open?.updatedAt || techFb?.at || null;
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
        last_completed_at: lastMap.get(String(a._id)) || null,
        manager_comment_display: { admin: adminNotes, review: reviewComment },
        technician_comment_display: {
          notes: technicianNotes,
          equipment_used: technicianEquipment,
          checklist: technicianChecklist,
          status: technicianStatus,
          at: technicianAt
        }
      };
    });

    if (req.user?.role === 'Technician' || req.user?.role === 'Viewer') {
      rows = rows.filter((r) => {
        const o = r.open_task;
        if (!o || !String(o._id || '').trim()) return true;
        return String(o.manager_review?.status || '') === 'Approved';
      });
    }

    if (ppmBucket !== 'all' && rows.length > 0) {
      const rowAssetIds = rows.map((r) => r.asset?._id).filter(Boolean);
      const latestByAsset = await aggregateLatestPpmRowByAsset(storeScope, rowAssetIds);
      const nowMs = Date.now();
      rows = rows.filter(
        (r) => ppmAssetSelfServiceBucket(latestByAsset.get(String(r.asset?._id)), nowMs) === ppmBucket
      );
    }

    if (pageMeta) {
      return res.json({
        items: rows,
        total: pageMeta.total,
        page: pageMeta.page,
        pages: pageMeta.pages,
        limit: pageMeta.limit
      });
    }
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load PPM asset list', error: error.message });
  }
});

router.get('/assets/:assetId/last-ticket', protect, allowPpmRead, async (req, res) => {
  try {
    if (!canUsePpmRole(req.user?.role)) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    const { assetId } = req.params || {};
    if (!assetId || !mongoose.Types.ObjectId.isValid(assetId)) {
      return res.status(400).json({ message: 'Valid asset ID is required' });
    }
    const asset = await Asset.findById(assetId).select('store');
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (req.activeStore && String(asset.store || '') !== String(req.activeStore)) {
      return res.status(403).json({ message: 'Asset is outside active store scope' });
    }

    const latestTaskWithTicket = await PpmTask.findOne({
      asset: asset._id,
      store: asset.store || null,
      work_order_ticket: { $exists: true, $ne: '' }
    })
      .sort({ createdAt: -1 })
      .select('work_order_ticket createdAt')
      .lean();

    const ticket = String(latestTaskWithTicket?.work_order_ticket || '').trim();
    return res.json({
      asset_id: String(asset._id),
      work_order_ticket: ticket,
      has_previous_ticket: Boolean(ticket),
      last_ticket_at: latestTaskWithTicket?.createdAt || null
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load previous PPM ticket', error: error.message });
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
      'name model_number uniqueId abs_code ip_address serial_number mac_address expo_tag product_name ticket_number status store manufacturer maintenance_vendor'
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
    const statusNorm = String(status || '').trim();
    if (statusNorm) {
      if (/^pending$/i.test(statusNorm)) {
        filter.status = { $in: ['Scheduled', 'In Progress', 'Overdue'] };
      } else {
        filter.status = statusNorm;
      }
    }
    if (assigned_to && mongoose.Types.ObjectId.isValid(assigned_to)) {
      filter.assigned_to = new mongoose.Types.ObjectId(assigned_to);
    }
    if (from || to) {
      filter.due_at = {};
      if (from) filter.due_at.$gte = new Date(from);
      if (to) filter.due_at.$lte = new Date(to);
    }

    if (req.user?.role === 'Technician' || req.user?.role === 'Viewer') {
      filter.$nor = [
        {
          status: { $in: ['Scheduled', 'In Progress', 'Overdue'] },
          'manager_review.status': { $ne: 'Approved' }
        }
      ];
    } else if (
      isManagerLikeRole(req.user?.role)
      && req.user?.role !== 'Admin'
      && req.user?.role !== 'Super Admin'
    ) {
      filter.$and = [
        ...(Array.isArray(filter.$and) ? filter.$and : []),
        {
          $nor: [{
            status: { $in: ['Scheduled', 'In Progress', 'Overdue'] },
            'manager_review.status': 'Pending',
            manager_notification_pending: { $ne: true }
          }]
        }
      ];
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
      manager_notes,
      work_order_ticket
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
    const workOrderTicket = String(work_order_ticket || '').trim();
    if (!workOrderTicket) {
      return res.status(400).json({ message: 'Work order ticket number is required' });
    }

    const task = await PpmTask.create({
      asset: asset._id,
      store: asset.store || null,
      status: 'Scheduled',
      scheduled_for: scheduled_for ? new Date(scheduled_for) : now,
      due_at: dueDate,
      checklist: normalizeChecklist(checklist),
      manager_notes: String(manager_notes || ''),
      work_order_ticket: workOrderTicket,
      assigned_to: (assigned_to && mongoose.Types.ObjectId.isValid(assigned_to)) ? assigned_to : undefined,
      created_by: req.user?._id,
      history: [{
        action: 'PPM Created',
        user: req.user?.name || '',
        email: req.user?.email || '',
        role: req.user?.role || '',
        details: 'Task created'
      }],
      manager_review: {
        status: 'Pending',
        comment: '',
        reviewed_at: null,
        reviewed_by: null
      },
      /** Admin submits to manager manually via POST /ppm/notify-bulk-program with task_ids. */
      manager_notification_pending: false,
      manager_notification_sent_at: null
    });

    await Asset.updateOne(
      { _id: asset._id, disposed: { $ne: true } },
      { $set: { ticket_number: workOrderTicket } }
    );

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
      action: 'PPM Created',
      details: `PPM task created for asset ${String(asset._id)}`,
      store: req.activeStore || asset.store || null
    });

    const out = await PpmTask.findById(task._id)
      .populate('assigned_to', 'name email role')
      .populate('asset', 'name model_number product_name uniqueId abs_code ip_address status store serial_number mac_address ticket_number manufacturer maintenance_vendor')
      .lean();
    if (out) {
      void notifyPpmStatusChange({
        task: out,
        req,
        status: 'Scheduled',
        actionLabel: 'PPM Scheduled',
        details: String(manager_notes || 'PPM task scheduled by admin')
      }).catch((err) => {
        console.error('PPM status notification failed:', err?.message || err);
      });
    }
    return res.status(201).json(out);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create PPM task', error: error.message });
  }
});

// @route   POST /api/ppm/batch
// @desc    Create many PPM tasks in one request; one manager notification email listing all assets
router.post('/batch', protect, restrictViewer, async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin can create PPM tasks' });
    }
    const raw = req.body?.asset_ids;
    const asset_ids = Array.isArray(raw)
      ? [...new Set(raw.map((id) => String(id || '').trim()).filter((id) => mongoose.Types.ObjectId.isValid(id)))]
      : [];
    if (asset_ids.length === 0) {
      return res.status(400).json({ message: 'asset_ids must be a non-empty array of valid asset ids' });
    }
    const {
      assigned_to,
      scheduled_for,
      due_at,
      checklist,
      manager_notes,
      work_order_ticket
    } = req.body || {};
    const workOrderTicket = String(work_order_ticket || '').trim();
    if (!workOrderTicket) {
      return res.status(400).json({ message: 'Work order ticket number is required' });
    }
    const now = new Date();
    const dueDate = due_at ? new Date(due_at) : new Date(now.getTime() + PPM_CYCLE_MS);
    const scheduledFor = scheduled_for ? new Date(scheduled_for) : now;
    if (Number.isNaN(dueDate.getTime())) return res.status(400).json({ message: 'Invalid due_at' });
    if (Number.isNaN(scheduledFor.getTime())) return res.status(400).json({ message: 'Invalid scheduled_for' });

    const assetOids = asset_ids.map((id) => new mongoose.Types.ObjectId(id));
    const assets = await Asset.find({ _id: { $in: assetOids } }).select('store').lean();
    const byId = new Map(assets.map((a) => [String(a._id), a]));
    const storeScopeOid =
      req.activeStore && mongoose.Types.ObjectId.isValid(req.activeStore)
        ? new mongoose.Types.ObjectId(req.activeStore)
        : null;
    const openFilter = {
      asset: { $in: assetOids },
      status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }
    };
    if (storeScopeOid) openFilter.store = matchPpmStoreScope(storeScopeOid);
    const openTasks = await PpmTask.find(openFilter)
      .select('_id asset status work_order_ticket')
      .lean();
    const hasOpen = new Set(openTasks.map((t) => String(t.asset)));
    const openTaskByAsset = new Map(openTasks.map((t) => [String(t.asset), t]));

    const failed = [];
    const createdIds = [];
    const newCreatedIds = [];
    const reusedTaskIds = [];
    const updatedExistingIds = [];
    /** Assets whose PPM ticket should match the admin-entered WO (table + manager). */
    const ticketSyncAssetIds = new Set();
    const historyEntry = {
      action: 'PPM Created',
      user: req.user?.name || '',
      email: req.user?.email || '',
      role: req.user?.role || '',
      details: 'Task created (batch)'
    };
    const assignedOid =
      assigned_to && mongoose.Types.ObjectId.isValid(assigned_to) ? assigned_to : undefined;

    for (const asset_id of asset_ids) {
      const asset = byId.get(String(asset_id));
      if (!asset) {
        failed.push({ asset_id, message: 'Asset not found' });
        continue;
      }
      if (req.activeStore && String(asset.store || '') !== String(req.activeStore)) {
        failed.push({ asset_id, message: 'Asset is outside active store scope' });
        continue;
      }
      if (hasOpen.has(String(asset_id))) {
        const existing = openTaskByAsset.get(String(asset_id));
        const existingTicket = String(existing?.work_order_ticket || '').trim();
        if (existing && existingTicket && existingTicket === workOrderTicket) {
          // Idempotent retry: same asset + same open ticket => reuse existing task.
          createdIds.push(existing._id);
          reusedTaskIds.push(existing._id);
          ticketSyncAssetIds.add(String(asset_id));
          continue;
        }
        if (existing && String(existing.status || '') === 'Scheduled') {
          // Upsert-like behavior for pending/scheduled open tasks:
          // update metadata/ticket instead of blocking admin with duplicate-open error.
          try {
            await PpmTask.updateOne(
              { _id: existing._id },
              {
                $set: {
                  scheduled_for: scheduledFor,
                  due_at: dueDate,
                  checklist: normalizeChecklist(checklist),
                  manager_notes: String(manager_notes || ''),
                  work_order_ticket: workOrderTicket,
                  assigned_to: assignedOid,
                  manager_notification_pending: false
                }
              }
            );
            createdIds.push(existing._id);
            updatedExistingIds.push(existing._id);
            ticketSyncAssetIds.add(String(asset_id));
            openTaskByAsset.set(String(asset_id), {
              ...existing,
              work_order_ticket: workOrderTicket
            });
            continue;
          } catch (e) {
            failed.push({
              asset_id,
              message: e?.message || 'Failed to update existing scheduled task'
            });
            continue;
          }
        }
        failed.push({
          asset_id,
          message: 'Asset already has an open PPM task in progress',
          existing_task_id: existing?._id || null,
          existing_ticket: existingTicket || null,
          existing_status: existing?.status || null
        });
        continue;
      }
      try {
        const task = await PpmTask.create({
          asset: new mongoose.Types.ObjectId(asset_id),
          store: asset.store || null,
          status: 'Scheduled',
          scheduled_for: scheduledFor,
          due_at: dueDate,
          checklist: normalizeChecklist(checklist),
          manager_notes: String(manager_notes || ''),
          work_order_ticket: workOrderTicket,
          assigned_to: assignedOid,
          created_by: req.user?._id,
          history: [historyEntry],
          manager_review: {
            status: 'Pending',
            comment: '',
            reviewed_at: null,
            reviewed_by: null
          },
          manager_notification_pending: false,
          manager_notification_sent_at: null
        });
        createdIds.push(task._id);
        newCreatedIds.push(task._id);
        ticketSyncAssetIds.add(String(asset_id));
        hasOpen.add(String(asset_id));
        openTaskByAsset.set(String(asset_id), {
          _id: task._id,
          asset: task.asset,
          status: task.status,
          work_order_ticket: task.work_order_ticket
        });
      } catch (e) {
        failed.push({ asset_id, message: e?.message || 'Create failed' });
      }
    }

    if (ticketSyncAssetIds.size > 0) {
      const syncOids = [...ticketSyncAssetIds]
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (syncOids.length > 0) {
        const assetTicketFilter = { _id: { $in: syncOids }, disposed: { $ne: true } };
        if (storeScopeOid) {
          assetTicketFilter.store = matchPpmStoreScope(storeScopeOid);
        }
        await Asset.updateMany(assetTicketFilter, { $set: { ticket_number: workOrderTicket } });
      }
    }

    if (createdIds.length === 0) {
      return res.status(400).json({
        message: 'No PPM tasks could be created',
        failed,
        created: [],
        created_count: 0
      });
    }

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
      action: 'PPM Batch Created',
      details: `Batch PPM: ${createdIds.length} task(s); ticket ${workOrderTicket}`,
      store: req.activeStore || null
    });

    const populated = await PpmTask.find({ _id: { $in: createdIds } })
      .populate('assigned_to', 'name email role')
      .populate('asset', 'name model_number product_name uniqueId abs_code ip_address status store serial_number mac_address ticket_number manufacturer maintenance_vendor')
      .lean();

    const newCreatedSet = new Set(newCreatedIds.map((id) => String(id)));
    const newlyCreatedRows = populated.filter((row) => newCreatedSet.has(String(row._id)));
    for (const row of newlyCreatedRows) {
      void notifyPpmStatusChange({
        task: row,
        req,
        status: 'Scheduled',
        actionLabel: 'PPM Scheduled',
        details: String(manager_notes || 'PPM batch scheduled by admin')
      }).catch((err) => {
        console.error('PPM batch status notification failed:', err?.message || err);
      });
    }

    return res.status(newCreatedIds.length > 0 ? 201 : 200).json({
      created: populated,
      failed,
      created_count: populated.length,
      new_created_count: newCreatedIds.length,
      reused_existing_count: reusedTaskIds.length,
      updated_existing_count: updatedExistingIds.length
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create PPM tasks (batch)', error: error.message });
  }
});

// @route   POST /api/ppm/reset-program
// @desc    Remove all PPM data for the active store: work-order tasks, import workflows, temp import rows,
//          isolated history logs, and clear ppm_enabled / ppm_import_only on assets (Admin or Super Admin + password)
router.post('/reset-program', protect, restrictViewer, async (req, res) => {
  try {
    if (req.user?.role !== 'Admin' && req.user?.role !== 'Super Admin') {
      return res.status(403).json({ message: 'Only Admin or Super Admin can reset the PPM program' });
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
    const storeScope = matchPpmStoreScope(storeOid);
    const [del, wfDel, tempDel, histDel, assetUpd] = await Promise.all([
      PpmTask.deleteMany({ store: storeScope }),
      PpmWorkflowTask.deleteMany({ store: storeScope }),
      PpmAssetTemp.deleteMany({ store: storeScope }),
      PpmHistoryLog.deleteMany({ store: storeScope }),
      Asset.updateMany(
        { store: storeScope, disposed: { $ne: true } },
        { $set: { ppm_enabled: false, ppm_import_only: false } }
      )
    ]);

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
      action: 'PPM Program Reset',
      details:
        `Removed ${del.deletedCount} PPM work-order task(s), ${wfDel.deletedCount} workflow batch(es), ` +
        `${tempDel.deletedCount} import temp row(s), ${histDel.deletedCount} PPM history log(s); ` +
        `cleared PPM flags on ${assetUpd.modifiedCount} asset(s) in active store`,
      store: req.activeStore
    });

    return res.json({
      deletedTasks: del.deletedCount,
      deletedWorkflows: wfDel.deletedCount,
      deletedTempAssets: tempDel.deletedCount,
      deletedHistoryLogs: histDel.deletedCount,
      assetsPpmCleared: assetUpd.modifiedCount
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to reset PPM program', error: error.message });
  }
});

// @route   POST /api/ppm/notify-bulk-program
// @desc    Submit explicit PpmTask ids to the manager queue (email + in-app); assets in an unsent import workflow must use POST /ppm/notify-manager instead
router.post('/notify-bulk-program', protect, restrictViewer, async (req, res) => {
  try {
    if (!canSubmitPpmToManagerQueue(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin or Super Admin can send manager notifications' });
    }
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) {
      return res.status(400).json({ message: 'Active store is required' });
    }
    const storeId = req.activeStore;
    const storeOid = new mongoose.Types.ObjectId(storeId);
    const storeScope = matchPpmStoreScope(storeOid);
    const rawIds = Array.isArray(req.body?.task_ids) ? req.body.task_ids : [];
    const requested = [...new Set(rawIds.map((id) => String(id || '').trim()).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
    if (requested.length === 0) {
      return res.status(400).json({
        message:
          'task_ids is required (non-empty array of PPM task ids). Select assets whose new tasks are not yet sent, or use Send notification after a bulk import to submit the import workflow.'
      });
    }
    const requestedOids = requested.map((id) => new mongoose.Types.ObjectId(id));
    const unsentImportAssets = await assetIdsLinkedToUnsentWorkflowBatches(storeOid);
    const candidates = await PpmTask.find({
      _id: { $in: requestedOids },
      store: storeScope,
      manager_notification_pending: { $ne: true },
      'manager_review.status': { $in: ['Pending', 'Modified'] },
      status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }
    })
      .populate('asset', 'uniqueId abs_code name model_number serial_number ticket_number')
      .lean();
    const skippedWrongState = requested.length - candidates.length;
    const blockedByImport = [];
    const toStage = [];
    for (const t of candidates) {
      const aid = String(t.asset?._id || t.asset || '');
      if (aid && unsentImportAssets.has(aid)) {
        blockedByImport.push(String(t._id));
        continue;
      }
      toStage.push(t);
    }
    if (toStage.length === 0) {
      const hint =
        blockedByImport.length > 0
          ? ' These assets belong to a bulk import batch: click Send notification to managers (after import) so the import workflow is submitted, not individual PPM rows.'
          : '';
      return res.status(400).json({
        message:
          `No eligible PPM tasks to submit (must be Scheduled/In Progress/Overdue, manager review Pending or Modified after you revised the task, not already in manager queue, in this store).${hint}`,
        skipped_wrong_state: skippedWrongState,
        blocked_import_workflow: blockedByImport.length
      });
    }
    const stageIds = toStage.map((t) => t._id);
    const sentAt = new Date();
    await PpmTask.updateMany(
      { _id: { $in: stageIds } },
      {
        $set: {
          manager_notification_pending: true,
          manager_notification_sent_at: sentAt,
          'manager_review.status': 'Pending',
          'manager_review.reviewed_at': null,
          'manager_review.reviewed_by': null
        }
      }
    );

    const storeDoc = await Store.findById(storeId).select('name emailConfig.managerRecipients emailConfig.ppmNotificationSubject').lean();
    const configuredManagers = Array.isArray(storeDoc?.emailConfig?.managerRecipients)
      ? storeDoc.emailConfig.managerRecipients
      : [];
    const recipients = Array.from(new Set(
      configuredManagers.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
    ));
    const ppmPrefix = String(storeDoc?.emailConfig?.ppmNotificationSubject || 'Expo City Dubai PPM Notification').trim() || 'Expo City Dubai PPM Notification';
    const createdByLine = `${String(req.user?.name || 'Admin')} (${String(req.user?.role || '')})`;
    const tickets = [...new Set(toStage.map((t) => String(t.work_order_ticket || '').trim()).filter(Boolean))];
    const workOrderTicket =
      tickets.length === 0 ? '—' : tickets.length === 1 ? tickets[0] : `Multiple (${tickets.length} distinct tickets — see table)`;
    const assetRows = toStage.map((t) => {
      const a = t.asset || {};
      const uid = String(a.uniqueId || '—');
      const abs = String(a.abs_code || '—');
      const title = String(a.name || a.model_number || 'Asset');
      return {
        textLine: `UID:${uid} | ABS:${abs} | ${title} | Task:${String(t._id)} | Ticket:${String(t.work_order_ticket || a.ticket_number || '—')}`,
        uid,
        abs,
        title,
        taskId: String(t._id)
      };
    });
    const { subject, text, html } = buildPpmManagerCreatedEmail({
      ppmPrefix,
      introHtml: `<p>An Admin submitted <strong>${assetRows.length}</strong> PPM work order(s) for <strong>Manager review</strong> (pending approval).</p>`,
      introText: `An Admin submitted ${assetRows.length} PPM work order(s) for Manager review (pending approval).`,
      workOrderTicket,
      createdByLine,
      managerNotes: '',
      assetRows
    });
    let emailSent = false;
    if (recipients.length > 0) {
      await sendStoreEmail({
        storeId,
        to: recipients.join(','),
        subject,
        text,
        html,
        context: 'expo-city-dubai-ppm-bulk-program'
      });
      emailSent = true;
    }
    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
      action: 'PPM manager notification sent',
      details: `Submitted tasks: ${toStage.length}; skipped_wrong_state: ${skippedWrongState}; blocked_import_workflow: ${blockedByImport.length}; manager recipient emails: ${recipients.length}; emailSent=${emailSent}`,
      store: req.activeStore || null
    });
    return res.json({
      ok: true,
      recipientCount: recipients.length,
      recipientEmails: recipients,
      taskCount: toStage.length,
      skipped_wrong_state: skippedWrongState,
      blocked_import_workflow: blockedByImport.length,
      blocked_import_task_ids: blockedByImport,
      emailSent
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send manager notification', error: error.message });
  }
});

// @route   GET /api/ppm/manager/pending
// @desc    List pending manager PPM reviews in active store
router.get('/manager/pending', protect, restrictViewer, async (req, res) => {
  try {
    if (!isManagerLikeRole(req.user?.role) && req.user?.role !== 'Admin' && req.user?.role !== 'Super Admin') {
      return res.status(403).json({ message: 'Only Manager/Admin can view manager PPM queue' });
    }
    const effectiveStore = resolvePpmManagerQueueStoreId(req);
    if (!effectiveStore) {
      return res.status(400).json({ message: 'Active store is required' });
    }
    const storeScope = matchPpmStoreScope(new mongoose.Types.ObjectId(effectiveStore));
    const storeOid = new mongoose.Types.ObjectId(effectiveStore);
    const coveredByWorkflow = await assetIdsCoveredByPendingWorkflowQueues(storeOid);
    const rows = await PpmTask.find({
      store: storeScope,
      manager_notification_pending: true,
      $or: [
        { 'manager_review.status': 'Pending' },
        { manager_review: { $exists: false } },
        { 'manager_review.status': { $exists: false } }
      ],
      status: { $in: ['Scheduled', 'In Progress', 'Overdue', 'Not Completed'] }
    })
      .populate('asset', 'uniqueId abs_code name model_number serial_number ticket_number maintenance_vendor')
      .populate('created_by', 'name email role')
      .populate('assigned_to', 'name email role')
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();
    /** Bulk import already surfaces as one workflow card — hide per-asset duplicates here. */
    const filtered = rows.filter((row) => !coveredByWorkflow.has(String(row.asset?._id || row.asset || '')));
    return res.json(filtered);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load manager queue', error: error.message });
  }
});

// @route   PATCH /api/ppm/:id/manager-review
// @desc    Manager approves/rejects/modifies PPM with comment
router.patch('/:id/manager-review', protect, restrictViewer, async (req, res) => {
  try {
    if (!isManagerLikeRole(req.user?.role) && req.user?.role !== 'Admin' && req.user?.role !== 'Super Admin') {
      return res.status(403).json({ message: 'Only Manager/Admin can review PPM tasks' });
    }
    const taskId = String(req.params?.id || '');
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    const resolvedStoreId = resolvePpmManagerQueueStoreId(req);
    if (!resolvedStoreId) {
      return res.status(400).json({ message: 'Active store is required' });
    }
    const decision = String(req.body?.decision || '').trim();
    if (!['Approved', 'Rejected', 'Modified'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be Approved, Rejected, or Modified' });
    }
    const comment = String(req.body?.comment || '').trim();
    if (!comment) {
      return res.status(400).json({ message: 'Comment is required' });
    }
    const task = await PpmTask.findOne({
      _id: new mongoose.Types.ObjectId(taskId),
      store: matchPpmStoreScope(new mongoose.Types.ObjectId(resolvedStoreId))
    });
    if (!task) return res.status(404).json({ message: 'PPM task not found in active store' });
    task.manager_review = {
      status: decision,
      comment,
      reviewed_at: new Date(),
      reviewed_by: req.user?._id || null
    };
    task.manager_notification_pending = false;
    if (decision === 'Rejected') {
      task.status = 'Cancelled';
      task.cancelled_at = new Date();
    }
    addTaskHistory(task, req, `Manager ${decision}`, comment);
    await task.save();
    if (decision === 'Rejected' && task.asset) {
      await Asset.updateOne(
        { _id: task.asset, store: matchPpmStoreScope(new mongoose.Types.ObjectId(resolvedStoreId)) },
        { $set: { ppm_enabled: false } }
      );
    }
    const taskWithAsset = await PpmTask.findById(task._id)
      .populate('asset', 'uniqueId abs_code name model_number serial_number ticket_number')
      .lean();
    const assetData = taskWithAsset?.asset || {};
    const assetRows = [{
      textLine: `UID:${String(assetData.uniqueId || '—')} | ABS:${String(assetData.abs_code || '—')} | ${String(assetData.name || assetData.model_number || 'Asset')} | Task:${String(task._id)}`,
      uid: String(assetData.uniqueId || '—'),
      abs: String(assetData.abs_code || '—'),
      title: String(assetData.name || assetData.model_number || 'Asset'),
      taskId: String(task._id)
    }];
    let emailWarning = null;
    if (decision === 'Approved') {
      const recipients = await getPpmApprovedBroadcastEmailsFromConfig(resolvedStoreId);
      if (recipients.length > 0) {
        const subjects = await getStoreNotificationSubjects(resolvedStoreId);
        const ppmPrefix = subjects.ppm || 'Expo City Dubai PPM Notification';
        const { subject, text, html } = buildPpmManagerCreatedEmail({
          ppmPrefix,
          introHtml: '<p>A Manager <strong>approved</strong> a PPM work order. The approved task is now available to assigned teams.</p>',
          introText: 'A Manager approved a PPM work order. The approved task is now available to assigned teams.',
          workOrderTicket: String(task.work_order_ticket || assetData.ticket_number || '—'),
          createdByLine: `${String(req.user?.name || 'Manager')} (${String(req.user?.role || '')})`,
          managerNotes: comment,
          assetRows
        });
        try {
          await sendStoreEmail({
            storeId: resolvedStoreId,
            to: recipients.join(','),
            subject,
            text,
            html,
            context: 'ppm-work-order-approved-broadcast'
          });
        } catch (mailErr) {
          emailWarning = mailErr?.message || String(mailErr);
          console.error('PPM manager-review approve email failed:', emailWarning);
        }
      }
      task.manager_notification_sent_at = new Date();
      await task.save();
    } else {
      const adminRecipients = await getPpmAdminRecipientEmailsFromConfig(resolvedStoreId);
      if (adminRecipients.length > 0) {
        const subjects = await getStoreNotificationSubjects(resolvedStoreId);
        const ppmPrefix = subjects.ppm || 'Expo City Dubai PPM Notification';
        const { subject, text, html } = buildPpmManagerCreatedEmail({
          ppmPrefix,
          introHtml: `<p>A Manager marked a PPM work order as <strong>${escapeHtml(decision)}</strong>. Admin action is required.</p>`,
          introText: `A Manager marked a PPM work order as ${decision}. Admin action is required.`,
          workOrderTicket: String(task.work_order_ticket || assetData.ticket_number || '—'),
          createdByLine: `${String(req.user?.name || 'Manager')} (${String(req.user?.role || '')})`,
          managerNotes: comment,
          assetRows
        });
        try {
          await sendStoreEmail({
            storeId: resolvedStoreId,
            to: adminRecipients.join(','),
            subject,
            text,
            html,
            context: 'ppm-work-order-manager-feedback'
          });
        } catch (mailErr) {
          emailWarning = mailErr?.message || String(mailErr);
          console.error(`PPM manager-review ${decision} email failed:`, emailWarning);
        }
      }
      task.manager_notification_sent_at = new Date();
      await task.save();
    }
    return res.json({
      ok: true,
      taskId: String(task._id),
      manager_review: task.manager_review,
      status: task.status,
      ...(emailWarning ? { emailWarning } : {})
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to submit manager review', error: error.message });
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
      { _id: { $in: ids }, store: matchPpmStoreScope(storeOid), disposed: { $ne: true } },
      { $set: { ppm_enabled: enabled } }
    );
    return res.json({ matched: result.matchedCount, modified: result.modifiedCount });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to bulk-update PPM inclusion', error: error.message });
  }
});

// @route   PATCH /api/ppm/bulk-work-order-ticket
router.patch('/bulk-work-order-ticket', protect, restrictViewer, async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin can update work order tickets' });
    }
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) {
      return res.status(400).json({ message: 'Active store is required' });
    }
    const rawIds = Array.isArray(req.body?.task_ids) ? req.body.task_ids : [];
    const ticket = String(req.body?.work_order_ticket || '').trim();
    if (!ticket) {
      return res.status(400).json({ message: 'Work order ticket number is required' });
    }
    if (rawIds.length === 0) {
      return res.status(400).json({ message: 'task_ids array is required' });
    }
    const ids = rawIds
      .map((id) => (mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(id) : null))
      .filter(Boolean);
    if (ids.length === 0) {
      return res.status(400).json({ message: 'No valid task ids' });
    }
    if (ids.length > 2000) {
      return res.status(400).json({ message: 'Too many tasks in one request (max 2000)' });
    }
    const storeOid = new mongoose.Types.ObjectId(req.activeStore);
    const storeScope = matchPpmStoreScope(storeOid);
    const result = await PpmTask.updateMany(
      {
        _id: { $in: ids },
        store: storeScope,
        status: { $in: ['Scheduled', 'In Progress', 'Overdue', 'Not Completed'] }
      },
      { $set: { work_order_ticket: ticket } }
    );
    const touched = await PpmTask.find({ _id: { $in: ids }, store: storeScope })
      .select('asset')
      .lean();
    const assetIds = [...new Set(touched.map((t) => t.asset).filter(Boolean))];
    if (assetIds.length > 0) {
      await Asset.updateMany(
        { _id: { $in: assetIds }, store: storeScope, disposed: { $ne: true } },
        { $set: { ticket_number: ticket } }
      );
    }
    return res.json({ matched: result.matchedCount, modified: result.modifiedCount, work_order_ticket: ticket });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to bulk update work order ticket', error: error.message });
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
    if (!canUsePpmRole(req.user?.role)) {
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

    const existing = await PpmTask.findOne({
      asset: asset._id,
      store: asset.store,
      status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }
    }).sort({ createdAt: -1 });

    /** Tech: any open work, ppm flag, or any non-cancelled PPM history on this asset (e.g. closed as Not Completed). */
    if (req.user?.role === 'Technician') {
      if (existing && technicianBlockedByManagerReview(existing)) {
        return res.status(403).json({
          message:
            'This PPM is waiting for manager approval (or was returned by the manager). You can open it after a manager approves it in PPM Manager.'
        });
      }
      const inPpmProgram =
        Boolean(asset.ppm_enabled) ||
        Boolean(existing) ||
        (await PpmTask.exists({
          asset: asset._id,
          store: asset.store,
          status: { $ne: 'Cancelled' }
        }));
      if (!inPpmProgram) {
        return res.status(403).json({
          message: 'This asset is not marked for PPM. Ask an admin to include it under PPM Work Orders.'
        });
      }
    }

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

    const latestClosed = await PpmTask.findOne({
      asset: asset._id,
      store: asset.store,
      status: { $in: ['Completed', 'Not Completed'] }
    })
      .sort({ updatedAt: -1 });

    if (latestClosed) {
      const merged = mergePpmChecklistShape(latestClosed.checklist || []);
      const prevLen = Array.isArray(latestClosed.checklist) ? latestClosed.checklist.length : 0;
      const hadVms = (latestClosed.checklist || []).some((x) => String(x?.key) === VMS_CHECKLIST_KEY);
      if (!hadVms || merged.length !== prevLen) {
        latestClosed.checklist = merged;
        await latestClosed.save();
      }
      const out = await PpmTask.findById(latestClosed._id)
        .populate('assigned_to', 'name email role')
        .populate('completed_by', 'name email')
        .populate('incomplete_by', 'name email')
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
      /** Ad-hoc self-service PPM does not use the manager queue — treat as approved so tech lists stay consistent. */
      manager_review: {
        status: 'Approved',
        comment: '',
        reviewed_at: now,
        reviewed_by: req.user?._id || null
      },
      manager_notification_pending: false,
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
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
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
    if (req.user?.role === 'Technician' && technicianBlockedByManagerReview(task)) {
      return res.status(403).json({
        message:
          'This PPM is waiting for manager approval (or was returned by the manager). You can work it after a manager approves it.'
      });
    }
    if (task.status === 'Cancelled') return res.status(400).json({ message: 'Cancelled task cannot be started' });
    if (task.status === 'Completed') return res.status(400).json({ message: 'Task is already completed' });
    if (task.status === 'Not Completed') return res.status(400).json({ message: 'Task is closed as not completed' });

    task.status = 'In Progress';
    if (!task.started_at) task.started_at = new Date();
    addTaskHistory(task, req, 'PPM Started', 'Technician started PPM checklist');
    await task.save();

    await ActivityLog.create({
      user: req.user?.name || 'Unknown',
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
      action: 'PPM Started',
      details: `PPM task ${task._id} started`,
      store: req.activeStore || task.store || null
    });

    const notifyTask = await loadTaskForStatusNotification(task._id);
    if (notifyTask) {
      void notifyPpmStatusChange({
        task: notifyTask,
        req,
        status: 'In Progress',
        actionLabel: 'PPM Started',
        details: 'Technician started PPM checklist'
      }).catch((err) => {
        console.error('PPM status notification failed:', err?.message || err);
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
    if (req.user?.role === 'Technician' && technicianBlockedByManagerReview(task)) {
      return res.status(403).json({
        message:
          'This PPM is waiting for manager approval (or was returned by the manager). You can work it after a manager approves it.'
      });
    }
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
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
      action: 'PPM Checklist Submitted',
      details: `PPM checklist updated for task ${task._id}`,
      store: req.activeStore || task.store || null
    });

    if (prevStatus === 'Scheduled' && task.status === 'In Progress') {
      const notifyTask = await loadTaskForStatusNotification(task._id);
      if (notifyTask) {
        void notifyPpmStatusChange({
          task: notifyTask,
          req,
          status: 'In Progress',
          actionLabel: 'PPM Checklist Submitted',
          details: 'Checklist responses updated'
        }).catch((err) => {
          console.error('PPM status notification failed:', err?.message || err);
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
    if (req.user?.role === 'Technician' && technicianBlockedByManagerReview(task)) {
      return res.status(403).json({
        message:
          'This PPM is waiting for manager approval (or was returned by the manager). You can work it after a manager approves it.'
      });
    }
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
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
      action: 'PPM Completed',
      details: `PPM task ${task._id} completed`,
      store: req.activeStore || task.store || null
    });

    const notifyTask = await loadTaskForStatusNotification(task._id);
    if (notifyTask) {
      void notifyPpmStatusChange({
        task: notifyTask,
        req,
        status: 'Completed',
        actionLabel: 'PPM Completed',
        details: task.technician_notes || ''
      }).catch((err) => {
        console.error('PPM status notification failed:', err?.message || err);
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
    if (req.user?.role === 'Technician' && technicianBlockedByManagerReview(task)) {
      return res.status(403).json({
        message:
          'This PPM is waiting for manager approval (or was returned by the manager). You can work it after a manager approves it.'
      });
    }
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
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
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
      void notifyPpmStatusChange({
        task: out,
        req,
        status: 'Not Completed',
        actionLabel: 'PPM Not Completed',
        details: reason
      }).catch((err) => {
        console.error('PPM status notification failed:', err?.message || err);
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
    if (!canUsePpmRole(role)) {
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
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
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
      void notifyPpmStatusChange({
        task: out,
        req,
        status: 'In Progress',
        actionLabel: 'PPM Reopened for Edit',
        details: 'Closed checklist reopened for correction'
      }).catch((err) => {
        console.error('PPM status notification failed:', err?.message || err);
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
      email: activityLogUserEmail(req),
      role: activityLogUserRole(req),
      action: 'PPM Cancelled',
      details: `PPM task ${task._id} cancelled`,
      store: req.activeStore || task.store || null
    });

    const notifyTask = await loadTaskForStatusNotification(task._id);
    if (notifyTask) {
      void notifyPpmStatusChange({
        task: notifyTask,
        req,
        status: 'Cancelled',
        actionLabel: 'PPM Cancelled',
        details: String(req.body?.reason || 'Cancelled by admin')
      }).catch((err) => {
        console.error('PPM status notification failed:', err?.message || err);
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

// ---------------- Isolated PPM Workflow (separate collections) ----------------
/** ExcelJS sometimes returns rich-text objects; normalize to plain string. */
const ppmCellToString = (v) => {
  if (v == null || v === '') return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text).trim();
    if (Array.isArray(v.richText)) {
      return v.richText.map((p) => String(p?.text ?? '')).join('').trim();
    }
    if (v.result != null && v.sharedFormula == null) return String(v.result).trim();
  }
  return String(v).trim();
};

const stripPpmInvisibleChars = (s) =>
  String(s || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();

const ppmNormalizeHeader = (h) =>
  stripPpmInvisibleChars(h).toLowerCase().replace(/\s+/g, '_');

const ppmAlias = {
  uniqueid: 'unique_id',
  unique_id: 'unique_id',
  asset_id: 'unique_id',
  uid: 'unique_id',
  abs_code: 'abs_code',
  abscode: 'abs_code',
  abs: 'abs_code',
  name: 'name',
  asset_name: 'name',
  model_number: 'model_number',
  model: 'model_number',
  serial_number: 'serial_number',
  serial: 'serial_number',
  qr_code: 'qr_code',
  rf_id: 'rf_id',
  rfid: 'rf_id',
  mac_address: 'mac_address',
  mac: 'mac_address',
  location: 'location',
  ticket: 'ticket',
  ticket_number: 'ticket',
  work_order_ticket: 'ticket',
  wo_ticket: 'ticket',
  wo: 'ticket',
  ppm_ticket: 'ticket',
  manufacturer: 'manufacturer',
  status: 'status',
  maintenance_vendor: 'maintenance_vendor'
};

const scorePpmHeaderRow = (vals) => {
  const cells = (vals || []).slice(1).map((h) => stripPpmInvisibleChars(ppmCellToString(h)));
  let score = 0;
  for (const cell of cells) {
    if (!cell) continue;
    const nk = ppmNormalizeHeader(cell).replace(/[^\w]/g, '_');
    if (ppmAlias[nk]) score += 1;
  }
  return score;
};

const extractPpmRowsFromWorksheet = (ws) => {
  const maxRow = Math.min(ws.rowCount || 0, 8000);
  if (maxRow < 2) return [];
  let bestIdx = 1;
  let bestScore = 0;
  const scanLimit = Math.min(20, maxRow);
  for (let idx = 1; idx <= scanLimit; idx += 1) {
    const row = ws.getRow(idx);
    const vals = row.values || [];
    const sc = scorePpmHeaderRow(vals);
    if (sc > bestScore) {
      bestScore = sc;
      bestIdx = idx;
    }
  }
  if (bestScore < 1) return [];

  const headerVals = ws.getRow(bestIdx).values || [];
  const headers = headerVals.slice(1).map((h) => stripPpmInvisibleChars(ppmCellToString(h)));
  const out = [];
  for (let idx = bestIdx + 1; idx <= maxRow; idx += 1) {
    const row = ws.getRow(idx);
    const vals = row.values || [];
    const obj = {};
    headers.forEach((label, i) => {
      const clean = stripPpmInvisibleChars(label);
      if (!clean) return;
      obj[clean] = ppmCellToString(vals[i + 1]);
    });
    const mapped = ppmMapRow(obj);
    const hasAny = Object.values(mapped).some((v) => String(v || '').trim() !== '');
    if (hasAny) out.push(mapped);
  }
  return out;
};

const ppmMapRow = (rowObj = {}) => {
  const out = {
    unique_id: '',
    abs_code: '',
    name: '',
    model_number: '',
    serial_number: '',
    qr_code: '',
    rf_id: '',
    mac_address: '',
    location: '',
    ticket: '',
    manufacturer: '',
    status: '',
    maintenance_vendor: ''
  };
  for (const [k, v] of Object.entries(rowObj || {})) {
    const nk = ppmNormalizeHeader(k).replace(/[^\w]/g, '_');
    const key = ppmAlias[nk];
    if (!key) continue;
    out[key] = String(v ?? '').trim();
  }
  return out;
};

const parsePpmExcelRows = async (file) => {
  if (!file?.buffer) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const sheets = wb.worksheets || [];
  for (const ws of sheets) {
    const rows = extractPpmRowsFromWorksheet(ws);
    if (rows.length > 0) return rows;
  }
  return [];
};

const loadStoreRecipientBuckets = async (storeId) => {
  const store = await Store.findById(storeId).select('emailConfig').lean();
  const cfg = store?.emailConfig || {};
  const list = (arr) => (Array.isArray(arr) ? arr.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean) : []);
  return {
    manager: Array.from(new Set(list(cfg.managerRecipients))),
    technician: Array.from(new Set(list(cfg.technicianRecipients))),
    admin: Array.from(new Set(list(cfg.adminRecipients))),
    viewer: Array.from(new Set(list(cfg.viewerRecipients)))
  };
};

/** Manager notification emails: Super Admin Portal → Manager notification box only (no User-table fallback). */
const getPpmManagerRecipientEmails = async (storeId) => {
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) return [];
  const buckets = await loadStoreRecipientBuckets(storeId);
  return Array.from(new Set((buckets.manager || []).filter(Boolean)));
};

/** Admin notification emails: Portal adminRecipients only. */
const getPpmAdminRecipientEmailsFromConfig = async (storeId) => {
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) return [];
  const buckets = await loadStoreRecipientBuckets(storeId);
  return Array.from(new Set((buckets.admin || []).filter(Boolean)));
};

/**
 * Approved PPM broadcast: technician + admin + viewer boxes only (one combined recipient list, one email).
 */
const getPpmApprovedBroadcastEmailsFromConfig = async (storeId) => {
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) return [];
  const buckets = await loadStoreRecipientBuckets(storeId);
  return Array.from(new Set([
    ...(buckets.technician || []),
    ...(buckets.admin || []),
    ...(buckets.viewer || [])
  ].filter(Boolean)));
};

/**
 * Grouped PPM lifecycle status emails (nodemailer): flowchart — after manager Approve, technicians and viewers
 * participate; until then admin work orders (ticket present) only notify Portal admin + manager lists.
 */
const getPpmStakeholderBroadcastEmailsFromConfig = async (storeId) => {
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) return [];
  const buckets = await loadStoreRecipientBuckets(storeId);
  return Array.from(new Set([
    ...(buckets.technician || []),
    ...(buckets.admin || []),
    ...(buckets.viewer || []),
    ...(buckets.manager || [])
  ].filter(Boolean)));
};

const loadTaskForStatusNotification = async (taskId) => PpmTask.findById(taskId)
  .populate('asset', 'name model_number product_name uniqueId abs_code ip_address')
  .populate('assigned_to', 'name email role')
  .lean();

/** Admin-created work order (ticket) still in manager queue or not yet Approved — do not email technicians/viewers. */
const ppmWorkOrderTaskAwaitingManagerBroadcast = (task) =>
  Boolean(String(task?.work_order_ticket || '').trim())
  && String(task?.manager_review?.status || '') !== 'Approved';

const resolvePpmLifecycleStatusEmailRecipients = async (storeId, task) => {
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) return [];
  if (ppmWorkOrderTaskAwaitingManagerBroadcast(task)) {
    const admins = await getPpmAdminRecipientEmailsFromConfig(storeId);
    const managers = await getPpmManagerRecipientEmails(storeId);
    return Array.from(new Set([...admins, ...managers]));
  }
  return getPpmStakeholderBroadcastEmailsFromConfig(storeId);
};

const notifyPpmStatusChange = async ({
  task,
  req,
  status,
  actionLabel,
  details = ''
}) => {
  try {
    if (process.env.DISABLE_LEGACY_PPM_STATUS_EMAILS === 'true') return;
    const storeId = task?.store || req.activeStore || resolveAssignedStoreId(req.user) || null;
    const recipients = await resolvePpmLifecycleStatusEmailRecipients(storeId, task);
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
    const subjects = await getStoreNotificationSubjects(storeId);
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
      storeId,
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

const buildPpmManagerCreatedEmail = ({
  ppmPrefix,
  introHtml,
  introText,
  workOrderTicket,
  createdByLine,
  managerNotes,
  assetRows
}) => {
  const notesBlockText = String(managerNotes || '').trim()
    ? `\nManager notes (admin): ${String(managerNotes).trim()}`
    : '';
  const notesBlockHtml = String(managerNotes || '').trim()
    ? `<p><strong>Manager notes (admin):</strong> ${escapeHtml(String(managerNotes).trim())}</p>`
    : '';
  const lines = [
    introText,
    `Work order ticket: ${workOrderTicket}`,
    `Created by: ${createdByLine}`,
    notesBlockText.trim() ? notesBlockText.trim() : null,
    '',
    'Assets / tasks:',
    ...assetRows.map((r, idx) => `${idx + 1}. ${r.textLine}`)
  ].filter(Boolean);
  const text = lines.join('\n');
  const tableBody = assetRows
    .map(
      (r, idx) =>
        `<tr><td>${idx + 1}</td><td>${escapeHtml(r.uid)}</td><td>${escapeHtml(r.abs)}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.taskId)}</td></tr>`
    )
    .join('');
  const html = `<div>
    ${introHtml}
    <p><strong>Work order ticket:</strong> ${escapeHtml(workOrderTicket)}</p>
    <p><strong>Created by:</strong> ${escapeHtml(createdByLine)}</p>
    ${notesBlockHtml}
    <p><strong>Assets (${assetRows.length}):</strong></p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
      <thead><tr><th>#</th><th>Unique ID</th><th>ABS</th><th>Asset</th><th>Ticket / PPM task ID</th></tr></thead>
      <tbody>${tableBody}</tbody>
    </table>
  </div>`;
  const subject = `${ppmPrefix}: Manager review required (${assetRows.length} asset${assetRows.length !== 1 ? 's' : ''})`;
  return { subject, text, html };
};

// @route POST /api/ppm/upload
// @desc  Create isolated PPM task and temp assets (excel/manual)
router.post('/upload', protect, restrictViewer, upload.single('file'), async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role)) return res.status(403).json({ message: 'Only Admin can upload PPM task' });
    if (!req.activeStore || !mongoose.Types.ObjectId.isValid(req.activeStore)) return res.status(400).json({ message: 'Active store is required' });
    const storeId = new mongoose.Types.ObjectId(req.activeStore);
    const storeScope = matchPpmStoreScope(storeId);
    let scheduleDate = req.body?.schedule_date ? new Date(req.body.schedule_date) : new Date();
    if (Number.isNaN(scheduleDate.getTime())) scheduleDate = new Date();
    const manualAssets = Array.isArray(req.body?.assets) ? req.body.assets : [];
    const excelRows = await parsePpmExcelRows(req.file);
    const combined = [...excelRows, ...manualAssets.map((r) => ppmMapRow(r))].filter((r) => Object.values(r).some((v) => String(v || '').trim() !== ''));
    if (combined.length === 0) {
      return res.status(400).json({
        message: 'No assets found in upload/manual payload',
        hint:
          'Use row headers like Unique ID, ABS Code, Name (see Download Sample Excel). A title row above headers is OK. If you picked a file, confirm it is .xlsx and the sheet is not empty.',
        file_received: Boolean(req.file?.buffer),
        file_size_bytes: req.file?.buffer?.length || 0,
        excel_rows_after_parse: excelRows.length,
        active_store: String(req.activeStore)
      });
    }

    const batchTicket = String(req.body?.work_order_ticket || req.body?.batch_ticket || '').trim();
    if (!batchTicket) {
      return res.status(400).json({
        message: 'PPM work order ticket is required for PPM bulk import.',
        hint:
          'Enter the same ticket in the “PPM WO ticket” field as when creating tasks from selected assets so every imported row, manager workflow card, and asset Ticket column stay aligned.'
      });
    }
    const confirmRecentCycle = String(req.body?.confirm_recent_cycle_completion || '').trim().toLowerCase();

    const dueRaw = req.body?.due_date || req.body?.due_at;
    let dueAtMs = scheduleDate.getTime() + PPM_CYCLE_MS;
    if (dueRaw) {
      const parsedDue = new Date(dueRaw);
      if (!Number.isNaN(parsedDue.getTime())) {
        dueAtMs = parsedDue.getTime();
      }
    }
    const dueAtForTasks = new Date(dueAtMs);

    // Match sheet rows to store assets before any PPM workflow write (flowchart: warn if PPM was completed
    // recently inside the standard cycle window, then allow explicit confirm to re-import the same program).
    const norm = (v) => String(v || '').trim().toLowerCase();
    const alnum = (v) => norm(v).replace(/[^a-z0-9]/g, '');
    const assets = await Asset.find({ store: storeScope, disposed: { $ne: true } })
      .select('_id uniqueId abs_code serial_number mac_address qr_code rfid ticket_number ppm_enabled')
      .lean();
    const byUniqueId = new Map();
    const byAbs = new Map();
    const bySerial = new Map();
    const byMac = new Map();
    const byQr = new Map();
    const byRf = new Map();
    for (const a of assets) {
      const uid = alnum(a.uniqueId);
      const abs = alnum(a.abs_code);
      const sn = alnum(a.serial_number);
      const mac = alnum(a.mac_address);
      const qr = alnum(a.qr_code);
      const rf = alnum(a.rfid);
      if (uid && !byUniqueId.has(uid)) byUniqueId.set(uid, a);
      if (abs && !byAbs.has(abs)) byAbs.set(abs, a);
      if (sn && !bySerial.has(sn)) bySerial.set(sn, a);
      if (mac && !byMac.has(mac)) byMac.set(mac, a);
      if (qr && !byQr.has(qr)) byQr.set(qr, a);
      if (rf && !byRf.has(rf)) byRf.set(rf, a);
    }

    const matchByRow = (row) => {
      const uid = alnum(row?.unique_id);
      if (uid && byUniqueId.has(uid)) return byUniqueId.get(uid);
      const abs = alnum(row?.abs_code);
      if (abs && byAbs.has(abs)) return byAbs.get(abs);
      const sn = alnum(row?.serial_number);
      if (sn && bySerial.has(sn)) return bySerial.get(sn);
      const qr = alnum(row?.qr_code);
      if (qr && byQr.has(qr)) return byQr.get(qr);
      const rf = alnum(row?.rf_id);
      if (rf && byRf.has(rf)) return byRf.get(rf);
      const mac = alnum(row?.mac_address);
      if (mac && byMac.has(mac)) return byMac.get(mac);
      return null;
    };

    const matchedByAssetId = new Map();
    const unmatchedImportRows = [];
    let unmatchedRows = 0;
    let matchedExistingAssets = 0;
    for (const row of combined) {
      const matched = matchByRow(row);
      if (!matched?._id) {
        unmatchedRows += 1;
        unmatchedImportRows.push(row);
        continue;
      }
      const k = String(matched._id);
      if (!matchedByAssetId.has(k)) {
        matchedByAssetId.set(k, { asset: matched, row });
        matchedExistingAssets += 1;
      }
    }

    const normalizeImportedStatus = (raw) => {
      const v = String(raw || '').trim().toLowerCase();
      if (!v) return 'In Store';
      if (['in use', 'in_use', 'used', 'active'].includes(v)) return 'In Use';
      if (['in store', 'instore', 'in_store', 'store'].includes(v)) return 'In Store';
      if (['missing', 'lost'].includes(v)) return 'Missing';
      if (['under repair', 'under repair/workshop', 'workshop', 'repair'].includes(v)) return 'Under Repair/Workshop';
      return 'In Store';
    };
    const normalizeImportedCondition = (raw) => {
      const v = String(raw || '').trim().toLowerCase();
      if (!v) return 'New';
      if (['new', 'brand new'].includes(v)) return 'New';
      if (['used', 'in use', 'active'].includes(v)) return 'Used';
      if (['faulty', 'broken', 'defective'].includes(v)) return 'Faulty';
      if (['repaired', 'fixed'].includes(v)) return 'Repaired';
      if (['workshop', 'under repair/workshop', 'under repair', 'repair'].includes(v)) return 'Under Repair/Workshop';
      return 'New';
    };
    const makeImportUniqueId = async (seed) => {
      const base = String(seed || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 18);
      const prefix = base || 'PPM-IMP';
      for (let i = 0; i < 120; i += 1) {
        const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
        const candidate = `${prefix}-${suffix}`.slice(0, 30);
        // uniqueId is globally unique on Asset model.
        // eslint-disable-next-line no-await-in-loop
        const exists = await Asset.exists({ uniqueId: candidate });
        if (!exists) return candidate;
      }
      return `PPM-IMP-${Date.now()}`;
    };

    const existingMatchedOids = [...matchedByAssetId.keys()]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const openTasksPreCheck = existingMatchedOids.length > 0
      ? await PpmTask.find({
        store: storeScope,
        asset: { $in: existingMatchedOids },
        status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }
      })
        .select('asset')
        .lean()
      : [];
    const hasOpenTaskPre = new Set(openTasksPreCheck.map((t) => String(t.asset)));
    const candidateIdsForNewTask = existingMatchedOids.filter((oid) => !hasOpenTaskPre.has(String(oid)));
    if (candidateIdsForNewTask.length > 0 && confirmRecentCycle !== 'true' && confirmRecentCycle !== '1') {
      const nowMs = Date.now();
      const latestCompleted = await PpmTask.aggregate([
        {
          $match: {
            store: storeScope,
            asset: { $in: candidateIdsForNewTask },
            status: 'Completed',
            completed_at: { $exists: true, $ne: null }
          }
        },
        { $sort: { completed_at: -1, updatedAt: -1 } },
        { $group: { _id: '$asset', completed_at: { $first: '$completed_at' } } }
      ]);
      const recentlyCompleted = [];
      for (const r of latestCompleted) {
        const ca = r.completed_at;
        if (!ca) continue;
        if (!completionOutsideCurrentCycle(ca, nowMs)) {
          const aid = String(r._id);
          const entry = matchedByAssetId.get(aid);
          const asset = entry?.asset || {};
          const ms = new Date(ca).getTime();
          const days = Math.max(0, Math.floor((nowMs - ms) / 86400000));
          recentlyCompleted.push({
            asset_id: aid,
            unique_id: String(asset.uniqueId || ''),
            abs_code: String(asset.abs_code || ''),
            completed_at: ca,
            days_since_completion: days,
            cycle_days: Math.round(PPM_CYCLE_MS / 86400000)
          });
        }
      }
      if (recentlyCompleted.length > 0) {
        return res.status(409).json({
          message:
            'Some matched assets already have a PPM completed inside the current service window. Confirm if you still want to create new PPM tasks for them.',
          requires_confirmation: true,
          recently_completed: recentlyCompleted
        });
      }
    }

    // If a row doesn't match an existing asset in this store, create a minimal asset so PPM rows become visible.
    let createdAssetsFromImport = 0;
    for (const row of unmatchedImportRows) {
      const rawUid = String(row?.unique_id || '').trim();
      const uniqueId = rawUid || await makeImportUniqueId(row?.abs_code || row?.serial_number || row?.name);
      const assetName = String(row?.name || row?.model_number || 'PPM Imported Asset').trim() || 'PPM Imported Asset';
      const status = normalizeImportedStatus(row?.status);
      const condition = normalizeImportedCondition(row?.status);
      const doc = await Asset.create({
        name: assetName,
        model_number: String(row?.model_number || '').trim(),
        serial_number: String(row?.serial_number || '').trim(),
        qr_code: String(row?.qr_code || '').trim(),
        rfid: String(row?.rf_id || '').trim(),
        mac_address: String(row?.mac_address || '').trim(),
        location: String(row?.location || '').trim(),
        ticket_number: String(batchTicket || row?.ticket || '').trim(),
        manufacturer: String(row?.manufacturer || '').trim(),
        maintenance_vendor: String(row?.maintenance_vendor || '').trim(),
        abs_code: String(row?.abs_code || '').trim(),
        uniqueId,
        status,
        condition,
        store: storeId,
        ppm_enabled: true,
        ppm_import_only: true,
        source: 'PPM Bulk Import',
        history: [{
          action: 'Asset Created (PPM Bulk Import)',
          details: 'Auto-created from PPM bulk import row',
          user: req.user?.name || '',
          actor_email: req.user?.email || '',
          actor_role: req.user?.role || '',
          status,
          condition,
          location: String(row?.location || '').trim()
        }]
      });
      matchedByAssetId.set(String(doc._id), { asset: doc, row });
      createdAssetsFromImport += 1;
    }
    unmatchedRows = 0;

    const task = await PpmWorkflowTask.create({
      store: storeId,
      created_by: req.user?._id || null,
      schedule_date: scheduleDate,
      status: 'Pending',
      batch_ticket: batchTicket
    });
    const docs = combined.map((a) => {
      const row = { ...a, ticket: batchTicket };
      return {
        ppm_task_id: task._id,
        store: storeId,
        source: excelRows.includes(a) ? 'excel' : 'manual',
        ...row
      };
    });
    await PpmAssetTemp.insertMany(docs);

    const matchedAssetIds = [...matchedByAssetId.keys()].map((id) => new mongoose.Types.ObjectId(id));
    const openTasks = matchedAssetIds.length > 0
      ? await PpmTask.find({
        store: storeScope,
        asset: { $in: matchedAssetIds },
        status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }
      })
        .select('asset')
        .lean()
      : [];
    const hasOpenTask = new Set(openTasks.map((t) => String(t.asset)));

    const importTicketFallback = `PPM-IMPORT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const createTaskDocs = [];
    for (const [assetId, payload] of matchedByAssetId.entries()) {
      if (hasOpenTask.has(assetId)) continue;
      const row = payload.row || {};
      const asset = payload.asset || {};
      const rowTicket = String(row.ticket || '').trim();
      const assetTicket = String(asset.ticket_number || '').trim();
      const workOrderTicket = batchTicket || rowTicket || assetTicket || importTicketFallback;
      createTaskDocs.push({
        asset: new mongoose.Types.ObjectId(assetId),
        store: storeId,
        status: 'Scheduled',
        scheduled_for: scheduleDate,
        due_at: dueAtForTasks,
        checklist: normalizeChecklist(),
        manager_notes: 'Created from PPM bulk import',
        work_order_ticket: workOrderTicket,
        created_by: req.user?._id || null,
        history: [{
          action: 'PPM Created',
          user: req.user?.name || '',
          email: req.user?.email || '',
          role: req.user?.role || '',
          details: 'Task created from bulk import'
        }],
        manager_review: {
          status: 'Pending',
          comment: '',
          reviewed_at: null,
          reviewed_by: null
        },
        /** Manager reviews the workflow batch card; do not duplicate rows in /ppm/manager/pending. */
        manager_notification_pending: false,
        manager_notification_sent_at: null
      });
    }

    if (matchedAssetIds.length > 0) {
      await Asset.updateMany(
        { _id: { $in: matchedAssetIds }, disposed: { $ne: true } },
        { $set: { ppm_enabled: true } }
      );
    }
    if (createTaskDocs.length > 0) {
      await PpmTask.insertMany(createTaskDocs, { ordered: false });
      for (const doc of createTaskDocs) {
        const payload = matchedByAssetId.get(String(doc.asset));
        const row = payload?.row || {};
        const ast = payload?.asset || {};
        const wo = String(String(doc.work_order_ticket || '').trim() || String(ast.ticket_number || '').trim()).trim();
        if (!wo) continue;
        const q = { ppm_task_id: task._id, store: storeId };
        const uid = String(row.unique_id || '').trim();
        const abs = String(row.abs_code || '').trim();
        if (uid) Object.assign(q, { unique_id: uid });
        else if (abs) Object.assign(q, { abs_code: abs });
        else continue;
        await PpmAssetTemp.updateMany(q, { $set: { ticket: wo } });
      }
      const importedAssetOids = createTaskDocs.map((d) => d.asset).filter(Boolean);
      if (batchTicket && importedAssetOids.length > 0) {
        await Asset.updateMany(
          { _id: { $in: importedAssetOids }, store: storeScope, disposed: { $ne: true } },
          { $set: { ticket_number: batchTicket } }
        );
      }
    }
    const skippedOpenTask = matchedByAssetId.size - createTaskDocs.length;

    await PpmHistoryLog.create({
      ppm_task_id: task._id,
      store: storeId,
      user: req.user?.name || '',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'Created Task (Excel/Manual Upload)',
      comments: String(req.body?.comments || ''),
      assets_included: docs.length
    });
    const managerRecipients = await getPpmManagerRecipientEmails(task.store);
    const managerEmailSent = false;
    try {
      await ActivityLog.create({
        user: req.user?.name || 'Unknown',
        email: activityLogUserEmail(req),
        role: activityLogUserRole(req),
        action: 'PPM import batch saved (notify manager manually)',
        details: `Workflow task ${task._id} created; assets=${docs.length}; managerRecipientsConfigured=${managerRecipients.length} (email sent only after Admin uses Send notification)`,
        store: req.activeStore || task.store || null
      });
    } catch (logErr) {
      console.error('PPM upload: activity log failed (upload still succeeded):', logErr?.message || logErr);
    }
    return res.status(201).json({
      ok: true,
      task_id: task._id,
      assets_included: docs.length,
      status: task.status,
      matched_assets: matchedByAssetId.size,
      matched_existing_assets: matchedExistingAssets,
      created_assets_from_import: createdAssetsFromImport,
      created_ppm_tasks: createTaskDocs.length,
      skipped_open_task: skippedOpenTask,
      unmatched_rows: unmatchedRows,
      manager_email_sent: managerEmailSent,
      manager_recipient_count: managerRecipients.length,
      recent_completion_acknowledged: confirmRecentCycle === 'true' || confirmRecentCycle === '1',
      debug: {
        active_store: String(req.activeStore),
        file_received: Boolean(req.file?.buffer),
        file_size_bytes: req.file?.buffer?.length || 0,
        excel_rows_parsed: excelRows.length,
        combined_rows: combined.length
      }
    });
  } catch (error) {
    const msg = error?.message || String(error);
    const dup = /E11000|duplicate key/i.test(msg);
    return res.status(500).json({
      message: 'Failed to upload isolated PPM task',
      error: msg,
      hint: dup
        ? 'Duplicate Unique ID (or another unique field): that value already exists on another asset. Change Unique ID in the sheet or remove the duplicate row.'
        : undefined
    });
  }
});

// @route POST /api/ppm/notify-manager
// @desc  Mark task sent to manager queue and email manager recipients
router.post('/notify-manager', protect, restrictViewer, async (req, res) => {
  try {
    if (!canSubmitPpmToManagerQueue(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin or Super Admin can notify manager' });
    }
    const taskId = String(req.body?.ppm_task_id || '');
    if (!mongoose.Types.ObjectId.isValid(taskId)) return res.status(400).json({ message: 'Valid ppm_task_id required' });
    const task = await PpmWorkflowTask.findById(taskId);
    if (!task) return res.status(404).json({ message: 'PPM task not found' });
    if (!req.activeStore || String(task.store) !== String(req.activeStore)) return res.status(403).json({ message: 'Task outside active store scope' });

    const assets = await PpmAssetTemp.find({ ppm_task_id: task._id }).lean();
    task.sent_to_manager_at = new Date();
    task.status = 'Pending';
    await task.save();
    await PpmHistoryLog.create({
      ppm_task_id: task._id,
      store: task.store,
      user: req.user?.name || '',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: 'Task Created & Sent to Manager',
      comments: '',
      assets_included: assets.length
    });

    const managerRecipients = await getPpmManagerRecipientEmails(task.store);
    let emailSent = false;
    if (managerRecipients.length > 0) {
      const subjects = await getStoreNotificationSubjects(task.store);
      const ppmPrefix = subjects.ppm || 'Expo City Dubai PPM Notification';
      const assetRows = assets.map((d) => {
        const uid = String(d.unique_id || '—');
        const abs = String(d.abs_code || '—');
        const title = String(d.name || d.model_number || '—');
        const tix = String(d.ticket || '').trim() || '—';
        return {
          textLine: `UID:${uid} | ABS:${abs} | ${title} | Ticket:${tix}`,
          uid,
          abs,
          title,
          taskId: tix
        };
      });
      const { subject, text, html } = buildPpmManagerCreatedEmail({
        ppmPrefix,
        introHtml: `<p>A PPM workflow batch was <strong>sent to the manager queue</strong> for review.</p><p><strong>Workflow / batch ID:</strong> ${escapeHtml(String(task._id))}</p>`,
        introText: `A PPM workflow batch was sent to the manager queue for review. Workflow / batch ID: ${String(task._id)}`,
        workOrderTicket: 'Per row (Ticket column)',
        createdByLine: `${String(req.user?.name || 'Admin')} (${String(req.user?.role || '')})`,
        managerNotes: '',
        assetRows
      });
      await sendStoreEmail({
        storeId: task.store,
        to: managerRecipients.join(','),
        subject,
        text,
        html,
        context: 'ppm-notify-manager'
      });
      emailSent = true;
    }
    return res.json({ ok: true, task_id: task._id, managerRecipients, emailSent, assets_included: assets.length });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to notify manager', error: error.message });
  }
});

// @route PATCH /api/ppm/manager-action
// @desc  Manager approves/rejects/modifies isolated ppm task; approved triggers final broadcast
router.patch('/manager-action', protect, restrictViewer, async (req, res) => {
  try {
    const taskId = String(req.body?.ppm_task_id || '');
    const action = String(req.body?.status || '').trim();
    const comment = String(req.body?.comment || '').trim();
    if (!canUsePpmRole(req.user?.role)) return res.status(403).json({ message: 'Not allowed' });
    if (!isManagerLikeRole(req.user?.role) && !isAdminRole(req.user?.role)) return res.status(403).json({ message: 'Only Manager/Admin can act' });
    if (!mongoose.Types.ObjectId.isValid(taskId)) return res.status(400).json({ message: 'Valid ppm_task_id required' });
    if (!['Approved', 'Rejected', 'Modified'].includes(action)) return res.status(400).json({ message: 'status must be Approved/Rejected/Modified' });
    if (!comment) return res.status(400).json({ message: 'Comment is required' });

    const task = await PpmWorkflowTask.findById(taskId);
    if (!task) return res.status(404).json({ message: 'PPM task not found' });
    task.status = action;
    task.manager_comment = comment;
    await task.save();

    const storeScope = matchPpmStoreScope(task.store);
    const tempRows = await PpmAssetTemp.find({ ppm_task_id: task._id }).lean();
    const linkedAssetIds = await resolveAssetIdsFromPpmTempRows(task.store, tempRows);
    if (linkedAssetIds.length > 0) {
      const reviewPatch = {
        'manager_review.status': action,
        'manager_review.comment': comment,
        'manager_review.reviewed_at': new Date(),
        'manager_review.reviewed_by': req.user?._id || null
      };
      const openFilter = {
        store: storeScope,
        asset: { $in: linkedAssetIds },
        status: { $in: ['Scheduled', 'In Progress', 'Overdue'] }
      };
      if (action === 'Rejected') {
        await PpmTask.updateMany(openFilter, {
          $set: {
            ...reviewPatch,
            status: 'Cancelled',
            cancelled_at: new Date()
          }
        });
        await Asset.updateMany(
          { _id: { $in: linkedAssetIds }, store: storeScope, disposed: { $ne: true } },
          { $set: { ppm_enabled: false } }
        );
      } else {
        await PpmTask.updateMany(openFilter, { $set: reviewPatch });
      }
    }

    const assetsCount = await PpmAssetTemp.countDocuments({ ppm_task_id: task._id });
    await PpmHistoryLog.create({
      ppm_task_id: task._id,
      store: task.store,
      user: req.user?.name || '',
      email: req.user?.email || '',
      role: req.user?.role || '',
      action: `Manager ${action} Task`,
      comments: comment,
      assets_included: assetsCount
    });

    let broadcasted = false;
    if (action === 'Approved') {
      const recipients = await getPpmApprovedBroadcastEmailsFromConfig(task.store);
      if (recipients.length > 0) {
        const subjects = await getStoreNotificationSubjects(task.store);
        const ppmPrefix = subjects.ppm || 'Expo City Dubai PPM Notification';
        const subject = `${ppmPrefix}: PPM approved (${assetsCount} asset${assetsCount !== 1 ? 's' : ''})`;
        const text = [
          'A PPM workflow task was approved by a Manager.',
          `Task ID: ${String(task._id)}`,
          `Assets included: ${assetsCount}`,
          'Recipients are taken only from Technician, Admin, and Viewer notification email lists in the Super Admin Portal.'
        ].join('\n');
        const html = `<div>
          <p>A PPM workflow task was <strong>approved</strong> by a Manager.</p>
          <p><strong>Task ID:</strong> ${escapeHtml(String(task._id))}</p>
          <p><strong>Assets included:</strong> ${assetsCount}</p>
          <p>One consolidated notice was sent to addresses configured under Technician, Admin, and Viewer notification emails.</p>
        </div>`;
        try {
          await sendStoreEmail({
            storeId: task.store,
            to: recipients.join(','),
            subject,
            text,
            html,
            context: 'ppm-broadcast-approved'
          });
          broadcasted = true;
        } catch (mailErr) {
          console.error('PPM manager-action approve email failed:', mailErr?.message || mailErr);
        }
      }
      task.approved_broadcast_at = new Date();
      await task.save();
      await ActivityLog.create({
        user: req.user?.name || 'Unknown',
        email: activityLogUserEmail(req),
        role: activityLogUserRole(req),
        action: 'PPM Manager Approved',
        details: `Workflow task ${task._id} approved. Broadcast (config lists only): ${recipients.length} recipient email(s).`,
        store: req.activeStore || task.store || null
      });
      await PpmHistoryLog.create({
        ppm_task_id: task._id,
        store: task.store,
        user: 'System',
        email: '',
        role: 'System',
        action: 'Bulk Notification Sent',
        comments: `Approved broadcast: ${recipients.length} recipient email(s) (Technician + Admin + Viewer lists in Portal only)`,
        assets_included: assetsCount
      });
    } else {
      // Rejected/Modified => Admin notification emails (Portal) only.
      const adminRecipients = await getPpmAdminRecipientEmailsFromConfig(task.store);
      let adminEmailSent = false;
      if (adminRecipients.length > 0) {
        const subject = `PPM Manager ${action} - Admin Action Required`;
        const text = [
          `Manager ${action.toLowerCase()} a PPM task.`,
          `Task ID: ${String(task._id)}`,
          `Assets included: ${assetsCount}`,
          `Manager comment: ${comment}`
        ].join('\n');
        const html = `<div>
          <p>Manager <strong>${escapeHtml(action)}</strong> a PPM task.</p>
          <p><strong>Task ID:</strong> ${escapeHtml(String(task._id))}</p>
          <p><strong>Assets included:</strong> ${assetsCount}</p>
          <p><strong>Manager comment:</strong> ${escapeHtml(comment)}</p>
        </div>`;
        try {
          await sendStoreEmail({
            storeId: task.store,
            to: adminRecipients.join(','),
            subject,
            text,
            html,
            context: 'ppm-manager-feedback-to-admin'
          });
          adminEmailSent = true;
        } catch (mailErr) {
          console.error(`PPM manager-action ${action} email failed:`, mailErr?.message || mailErr);
        }
      }
      await ActivityLog.create({
        user: req.user?.name || 'Unknown',
        email: activityLogUserEmail(req),
        role: activityLogUserRole(req),
        action: `PPM Manager ${action}`,
        details: `Workflow task ${task._id} ${action.toLowerCase()}; adminEmailSent=${adminEmailSent}; adminRecipients=${adminRecipients.length}.`,
        store: req.activeStore || task.store || null
      });
    }

    return res.json({ ok: true, task_id: task._id, status: task.status, broadcasted });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to process manager action', error: error.message });
  }
});

// @route GET /api/ppm/notification-history
// @desc Same shape as dashboard-alerts, but up to `days` lookback (default 365) for header history panel
router.get('/notification-history', protect, restrictViewer, async (req, res) => {
  try {
    const storeId = resolvePpmManagerQueueStoreId(req);
    if (!storeId) return res.json([]);
    const storeOid = new mongoose.Types.ObjectId(storeId);
    const role = String(req.user?.role || '');
    const days = Math.min(366, Math.max(1, Number(req.query.days) || 365));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 500));
    const since = new Date(Date.now() - days * 86400000);

    const workflowRowsWithCounts = async (wfFilter, rowLimit) => {
      const tasks = await PpmWorkflowTask.find(wfFilter)
        .sort({ updatedAt: -1 })
        .limit(rowLimit)
        .select('_id status manager_comment createdAt updatedAt approved_broadcast_at')
        .lean();
      const taskIds = tasks.map((t) => t._id);
      const assetCounts = taskIds.length
        ? await PpmAssetTemp.aggregate([
          { $match: { ppm_task_id: { $in: taskIds } } },
          { $group: { _id: '$ppm_task_id', count: { $sum: 1 } } }
        ])
        : [];
      const countMap = new Map(assetCounts.map((x) => [String(x._id), Number(x.count || 0)]));
      return tasks.map((t) => ({
        task_id: String(t._id),
        kind: 'workflow',
        status: String(t.status || ''),
        manager_comment: String(t.manager_comment || ''),
        assets_included: countMap.get(String(t._id)) || 0,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        approved_broadcast_at: t.approved_broadcast_at || null
      }));
    };

    if (isManagerLikeRole(role)) {
      const wfFilter = {
        store: matchPpmStoreScope(storeOid),
        $or: [{ createdAt: { $gte: since } }, { updatedAt: { $gte: since } }]
      };
      const [wfRows, covered] = await Promise.all([
        workflowRowsWithCounts(wfFilter, limit),
        assetIdsCoveredByPendingWorkflowQueues(storeOid)
      ]);
      const [openRows, histRows] = await Promise.all([
        fetchOpenPpmTasksForManagerBell(storeOid, covered, limit, {}),
        fetchPpmTasksWithManagerDecisionSince(storeOid, since, limit)
      ]);
      const out = sortBellRowsDesc([...wfRows, ...openRows, ...histRows]).slice(0, limit);
      return res.json(out);
    }

    let filter = {
      store: matchPpmStoreScope(storeOid),
      $or: [{ createdAt: { $gte: since } }, { updatedAt: { $gte: since } }]
    };
    let workOrderStatuses = [];
    if (isAdminRole(role)) {
      workOrderStatuses = ['Approved', 'Rejected', 'Modified'];
    } else if (role === 'Technician' || role === 'Viewer') {
      filter = { ...filter, status: 'Approved' };
      workOrderStatuses = ['Approved'];
    } else {
      return res.json([]);
    }

    const [workflowRows, workOrderRows] = await Promise.all([
      workflowRowsWithCounts(filter, limit),
      fetchPpmTaskDecisionRowsForRole(storeOid, limit, { sinceDate: since, statuses: workOrderStatuses })
    ]);
    return res.json(sortBellRowsDesc([...workflowRows, ...workOrderRows]).slice(0, limit));
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load PPM notification history', error: error.message });
  }
});

// @route GET /api/ppm/dashboard-alerts
// @desc Role-targeted PPM workflow alerts to show on dashboard
router.get('/dashboard-alerts', protect, restrictViewer, async (req, res) => {
  try {
    const storeId = resolvePpmManagerQueueStoreId(req);
    if (!storeId) return res.json([]);
    const storeOid = new mongoose.Types.ObjectId(storeId);
    const role = String(req.user?.role || '');

    const mapWorkflowTasksToBellRows = async (tasks) => {
      const taskIds = tasks.map((t) => t._id);
      const assetCounts = taskIds.length
        ? await PpmAssetTemp.aggregate([
          { $match: { ppm_task_id: { $in: taskIds } } },
          { $group: { _id: '$ppm_task_id', count: { $sum: 1 } } }
        ])
        : [];
      const countMap = new Map(assetCounts.map((x) => [String(x._id), Number(x.count || 0)]));
      return tasks.map((t) => ({
        task_id: String(t._id),
        kind: 'workflow',
        status: String(t.status || ''),
        manager_comment: String(t.manager_comment || ''),
        assets_included: countMap.get(String(t._id)) || 0,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        approved_broadcast_at: t.approved_broadcast_at || null
      }));
    };

    if (isManagerLikeRole(role)) {
      const wfFilter = {
        store: matchPpmStoreScope(storeOid),
        status: { $in: ['Pending', 'Modified'] },
        sent_to_manager_at: { $ne: null }
      };
      const [tasks, covered] = await Promise.all([
        PpmWorkflowTask.find(wfFilter)
          .sort({ updatedAt: -1 })
          .limit(30)
          .select('_id status manager_comment createdAt updatedAt approved_broadcast_at')
          .lean(),
        assetIdsCoveredByPendingWorkflowQueues(storeOid)
      ]);
      const wfRows = await mapWorkflowTasksToBellRows(tasks);
      const openRows = await fetchOpenPpmTasksForManagerBell(storeOid, covered, 30, {});
      return res.json(sortBellRowsDesc([...wfRows, ...openRows]).slice(0, 30));
    }

    let filter = { store: matchPpmStoreScope(storeOid) };
    let workOrderStatuses = [];
    if (isAdminRole(role)) {
      filter = { ...filter, status: { $in: ['Approved', 'Rejected', 'Modified'] } };
      workOrderStatuses = ['Approved', 'Rejected', 'Modified'];
    } else if (role === 'Technician' || role === 'Viewer') {
      filter = { ...filter, status: 'Approved' };
      workOrderStatuses = ['Approved'];
    } else {
      return res.json([]);
    }
    const [tasks, workOrderRows] = await Promise.all([
      PpmWorkflowTask.find(filter)
        .sort({ updatedAt: -1 })
        .limit(30)
        .select('_id status manager_comment createdAt updatedAt approved_broadcast_at')
        .lean(),
      fetchPpmTaskDecisionRowsForRole(storeOid, 30, { statuses: workOrderStatuses })
    ]);
    const out = await mapWorkflowTasksToBellRows(tasks);
    return res.json(sortBellRowsDesc([...out, ...workOrderRows]).slice(0, 30));
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load PPM dashboard alerts', error: error.message });
  }
});

// @route GET /api/ppm/manager/section
// @desc  Manager isolated queue (separate section data)
router.get('/manager/section', protect, restrictViewer, async (req, res) => {
  try {
    if (!isManagerLikeRole(req.user?.role) && req.user?.role !== 'Admin' && req.user?.role !== 'Super Admin') {
      return res.status(403).json({ message: 'Only Manager/Admin can view manager PPM workflow queue' });
    }
    const storeId = resolvePpmManagerQueueStoreId(req);
    if (!storeId) return res.status(400).json({ message: 'Active store is required' });
    const tasks = await PpmWorkflowTask.find({
      store: matchPpmStoreScope(new mongoose.Types.ObjectId(storeId)),
      status: { $in: ['Pending', 'Modified'] },
      sent_to_manager_at: { $ne: null }
    })
      .populate('created_by', 'name email role')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const ids = tasks.map((t) => t._id);
    const assets = await PpmAssetTemp.find({ ppm_task_id: { $in: ids } }).lean();
    const byTask = new Map();
    assets.forEach((a) => {
      const k = String(a.ppm_task_id);
      if (!byTask.has(k)) byTask.set(k, []);
      byTask.get(k).push(a);
    });
    const storeOid = new mongoose.Types.ObjectId(storeId);
    const enriched = [];
    for (const t of tasks) {
      const arr = byTask.get(String(t._id)) || [];
      const hydrated = await hydrateWorkflowManagerCardFields(t, storeOid, arr);
      enriched.push({ ...hydrated, assets: arr });
    }
    return res.json(enriched);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load manager section', error: error.message });
  }
});

// @route GET /api/ppm/history-logs
// @desc  Read-only isolated timeline for Admin/Manager
router.get('/history-logs', protect, restrictViewer, async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role) && !isManagerLikeRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only Admin/Manager can view PPM history logs' });
    }
    const storeId = resolvePpmManagerQueueStoreId(req);
    if (!storeId) return res.status(400).json({ message: 'Active store is required' });
    const rows = await PpmHistoryLog.find({ store: matchPpmStoreScope(new mongoose.Types.ObjectId(storeId)) })
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load PPM history logs', error: error.message });
  }
});

module.exports = router;
