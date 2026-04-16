import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Eye, Pencil, Wrench } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import api from '../api/axios';
import PpmInlineAssetEditModal from '../components/PpmInlineAssetEditModal';
import { useAuth } from '../context/AuthContext';

const EQUIPMENT_OPTIONS = ['Ladder', 'Scaffold', 'Manlift', 'Rope', 'Safety Harness'];

/** Must match server `PPM_CYCLE_MS` (180-day PPM cycle). */
const PPM_CYCLE_MS = 180 * 24 * 60 * 60 * 1000;

const ppmDownloadFallbackFilename = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `PPM_Report_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.xlsx`;
};

/** GET /api/assets returns `{ items, total, page, pages }` (not `assets`). */
const assetListFromResponse = (data) => {
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.assets)) return data.assets;
  if (Array.isArray(data)) return data;
  return [];
};

const formatCreateAssetLabel = (a) => {
  if (!a) return '';
  const title = a.product_name || a.name || a.model_number || 'Asset';
  return `${title} | UID:${a.uniqueId || '—'} | ABS:${a.abs_code || '—'} | SN:${a.serial_number || '—'} | IP:${a.ip_address || '—'} | MAC:${a.mac_address || '—'}`;
};

const formatCreateAssetShortLabel = (a) => {
  if (!a) return '';
  const title = a.product_name || a.name || a.model_number || 'Asset';
  const uid = a.uniqueId || '—';
  return `${title} · ${uid}`;
};

const nextServiceMeta = (openTask, lastCompletedAt) => {
  if (openTask?.due_at) {
    const d = new Date(openTask.due_at);
    if (!Number.isNaN(d.getTime())) {
      const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
      if (days < 0) return { label: 'Overdue', tone: 'rose' };
      return { label: `${days} Days`, tone: 'amber' };
    }
  }
  if (lastCompletedAt) {
    const next = new Date(new Date(lastCompletedAt).getTime() + PPM_CYCLE_MS);
    if (!Number.isNaN(next.getTime())) {
      const days = Math.ceil((next.getTime() - Date.now()) / 86400000);
      if (days < 0) return { label: 'Overdue', tone: 'rose' };
      return { label: `${days} Days`, tone: 'amber' };
    }
  }
  return { label: '—', tone: 'slate' };
};

const vmsBadgeClass = (label) => {
  if (label === 'Online') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (label === 'Offline') return 'bg-rose-100 text-rose-800 border-rose-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

const nextBadgeClass = (tone) => {
  if (tone === 'rose') return 'bg-rose-100 text-rose-900 border-rose-200';
  if (tone === 'amber') return 'bg-amber-100 text-amber-900 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

/** Admin manager notes + optional manager review comment from open PpmTask. */
const openTaskManagerCommentParts = (openTask) => {
  if (!openTask) return { admin: '', review: '' };
  return {
    admin: String(openTask.manager_notes || '').trim(),
    review: String(openTask.manager_review?.comment || '').trim()
  };
};

/** Server merges open task + latest task with feedback (e.g. after Cancelled following rejection). */
const rowManagerCommentParts = (row) => {
  const d = row?.manager_comment_display;
  if (d && typeof d === 'object') {
    return {
      admin: String(d.admin || '').trim(),
      review: String(d.review || '').trim()
    };
  }
  return openTaskManagerCommentParts(row?.open_task);
};

const rowTechnicianCommentDetails = (row) => {
  const d = row?.technician_comment_display;
  const notes = String(d?.notes || row?.open_task?.technician_notes || '').trim();
  const equipment = Array.isArray(d?.equipment_used)
    ? d.equipment_used.map((x) => String(x || '').trim()).filter(Boolean)
    : (Array.isArray(row?.open_task?.equipment_used)
      ? row.open_task.equipment_used.map((x) => String(x || '').trim()).filter(Boolean)
      : []);
  const checklistItems = Array.isArray(d?.checklist)
    ? d.checklist
    : (Array.isArray(row?.open_task?.checklist) ? row.open_task.checklist : []);
  const checklistSummary = checklistItems
    .filter((item) => {
      const value = String(item?.value || '').trim();
      const note = String(item?.notes || '').trim();
      return Boolean(value || note);
    })
    .slice(0, 2)
    .map((item) => {
      const label = String(item?.label || item?.key || 'Checklist');
      const value = String(item?.value || '').trim();
      const note = String(item?.notes || '').trim();
      if (value && note) return `${label}: ${value} (${note})`;
      return `${label}: ${value || note}`;
    });
  return { notes, equipment, checklistSummary };
};

const UNHEALTHY_CONDITIONS = new Set(['faulty', 'workshop', 'under repair/workshop']);

const isAssetUnhealthy = (condition) => UNHEALTHY_CONDITIONS.has(String(condition || '').trim().toLowerCase());

const isRowUnhealthyForSystemHealth = (r) => {
  if (isAssetUnhealthy(r?.asset?.condition)) return true;
  return String(r?.vms_label || '').trim() === 'Offline';
};

/** Must match server `VMS_CHECKLIST_KEY` */
const VMS_CHECKLIST_KEY = 'vms_online';
const WORKORDER_PAGE_SIZE = 50;

const PPM_BULK_NOTIFY_SESSION_PREFIX = 'ppm_pending_bulk_notify_';
const PPM_CREATE_DRAFT_SESSION_PREFIX = 'ppm_create_draft_';
const PPM_REMOVE_UNDO_MS = 6000;
const ppmSearchFields = (asset, row) => ([
  asset?.uniqueId,
  asset?.abs_code,
  asset?.name,
  asset?.model_number,
  asset?.serial_number,
  asset?.qr_code,
  asset?.rfid,
  asset?.mac_address,
  asset?.location,
  asset?.ticket_number || row?.open_task?.work_order_ticket,
  asset?.manufacturer,
  asset?.status,
  asset?.maintenance_vendor,
  row?.manager_comment_display?.admin,
  row?.manager_comment_display?.review,
  row?.open_task?.manager_notes,
  row?.open_task?.manager_review?.comment,
  row?.technician_comment_display?.notes,
  ...(Array.isArray(row?.technician_comment_display?.equipment_used)
    ? row.technician_comment_display.equipment_used
    : [])
]);

const TechPpmPanel = () => {
  const { user, activeStore } = useAuth();
  const [searchParams] = useSearchParams();
  const roleLower = String(user?.role || '').toLowerCase();
  const managerLikeRole = roleLower.includes('manager');
  const adminLikeRole = roleLower.includes('admin');
  const canOpenAssetHistory = user?.role === 'Admin' || user?.role === 'Super Admin' || user?.role === 'Viewer';
  const canManagePpmInclusion = adminLikeRole || managerLikeRole || user?.role === 'Super Admin';
  /** “Notify managers” reminder is admin-only; managers should not see it on their own account. */
  const canShowBulkManagerNotifyBanner = adminLikeRole || user?.role === 'Super Admin';
  const [rows, setRows] = useState([]);
  const [overview, setOverview] = useState({
    total: 0,
    overdue: 0,
    completed: 0,
    notCompleted: 0,
    open: 0,
    health: 100
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [assetPage, setAssetPage] = useState(1);
  const [assetMeta, setAssetMeta] = useState({ total: 0, pages: 1, limit: WORKORDER_PAGE_SIZE });
  const [density, setDensity] = useState('comfortable');
  const [columnPreset, setColumnPreset] = useState('full');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [task, setTask] = useState(null);
  const [ppmHistoryOpen, setPpmHistoryOpen] = useState(false);
  const [ppmHistoryBusy, setPpmHistoryBusy] = useState(false);
  const [ppmHistoryError, setPpmHistoryError] = useState('');
  const [ppmHistoryData, setPpmHistoryData] = useState({ asset: null, tasks: [], spareRequests: [] });
  const [spareForm, setSpareForm] = useState({ item_name: '', quantity: 1, description: '' });
  const [spareSubmitting, setSpareSubmitting] = useState(false);
  /** Filters PPM program assets: all, or by latest task vs 180-day cycle (same idea as overview). */
  const [ppmListFilter, setPpmListFilter] = useState('all');
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [techs, setTechs] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    asset_id: '',
    assigned_to: '',
    scheduled_for: '',
    due_at: '',
    work_order_ticket: ''
  });
  const [createAssetSearch, setCreateAssetSearch] = useState('');
  const [createAssetResults, setCreateAssetResults] = useState([]);
  const [createAssetPickLoading, setCreateAssetPickLoading] = useState(false);
  const [ppmTicketAutofillHint, setPpmTicketAutofillHint] = useState('');
  const [createAssetMenuOpen, setCreateAssetMenuOpen] = useState(false);
  const [ppmPickHint, setPpmPickHint] = useState(null);
  const createPickerRef = useRef(null);
  const [resetProgramOpen, setResetProgramOpen] = useState(false);
  const [resetProgramPassword, setResetProgramPassword] = useState('');
  const [resetProgramBusy, setResetProgramBusy] = useState(false);
  const [pendingBulkPpmNotify, setPendingBulkPpmNotify] = useState(false);
  const [bulkNotifyBusy, setBulkNotifyBusy] = useState(false);
  const [managerNotifyEmails, setManagerNotifyEmails] = useState([]);
  const [toast, setToast] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingDrawerCancel, setPendingDrawerCancel] = useState(null);
  const ticketLookupGen = useRef(0);
  const pendingRemoveTimerRef = useRef(null);
  const pendingDrawerCancelTimerRef = useRef(null);
  const importFileInputRef = useRef(null);
  /** PpmTask ids from the latest checkbox/batch create — used when Send notification runs with no selection. */
  const lastCreatedPpmTaskIdsRef = useRef([]);
  /** Latest bulk-import workflow id (PpmWorkflowTask) — Send notification falls back to POST /ppm/notify-manager. */
  const lastImportWorkflowIdRef = useRef(null);
  const [ppmInlineEditAssetId, setPpmInlineEditAssetId] = useState(null);
  const assetsLoadGen = useRef(0);
  const toastTimerRef = useRef(null);
  const workOrderColSpan = canManagePpmInclusion ? 20 : 19;

  const bulkNotifySessionKey = useMemo(() => {
    const id = activeStore?._id != null ? String(activeStore._id) : '';
    return `${PPM_BULK_NOTIFY_SESSION_PREFIX}${id || 'default'}`;
  }, [activeStore]);
  const createDraftSessionKey = useMemo(() => {
    const id = activeStore?._id != null ? String(activeStore._id) : '';
    return `${PPM_CREATE_DRAFT_SESSION_PREFIX}${id || 'default'}`;
  }, [activeStore]);

  const updatePendingBulkNotify = useCallback(
    (next) => {
      if (canShowBulkManagerNotifyBanner) {
        setPendingBulkPpmNotify(next);
      } else {
        setPendingBulkPpmNotify(false);
      }
      if (!bulkNotifySessionKey || !canManagePpmInclusion) return;
      if (next) sessionStorage.setItem(bulkNotifySessionKey, '1');
      else sessionStorage.removeItem(bulkNotifySessionKey);
    },
    [bulkNotifySessionKey, canManagePpmInclusion, canShowBulkManagerNotifyBanner]
  );

  useEffect(() => {
    if (!bulkNotifySessionKey) {
      setPendingBulkPpmNotify(false);
      return;
    }
    if (!canShowBulkManagerNotifyBanner) {
      setPendingBulkPpmNotify(false);
      return;
    }
    setPendingBulkPpmNotify(sessionStorage.getItem(bulkNotifySessionKey) === '1');
  }, [canShowBulkManagerNotifyBanner, bulkNotifySessionKey]);

  useEffect(() => {
    if (!canShowBulkManagerNotifyBanner || !pendingBulkPpmNotify) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [canShowBulkManagerNotifyBanner, pendingBulkPpmNotify]);

  useEffect(() => {
    if (!canShowBulkManagerNotifyBanner || !activeStore?._id) {
      setManagerNotifyEmails([]);
      return;
    }
    let cancelled = false;
    const loadManagerRecipients = async () => {
      try {
        const { data } = await api.get('/system/email-config', { params: { storeId: activeStore._id } });
        if (cancelled) return;
        const cfg = data?.emailConfig || {};
        const emails = Array.isArray(cfg?.managerRecipients)
          ? cfg.managerRecipients.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
          : [];
        setManagerNotifyEmails(Array.from(new Set(emails)));
      } catch {
        if (!cancelled) setManagerNotifyEmails([]);
      }
    };
    void loadManagerRecipients();
    return () => { cancelled = true; };
  }, [canShowBulkManagerNotifyBanner, activeStore?._id]);

  useEffect(() => {
    if (!canManagePpmInclusion || !createDraftSessionKey) return;
    try {
      const raw = sessionStorage.getItem(createDraftSessionKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      setCreateForm((f) => ({
        ...f,
        assigned_to: String(draft?.assigned_to || ''),
        scheduled_for: String(draft?.scheduled_for || ''),
        due_at: String(draft?.due_at || ''),
        work_order_ticket: String(draft?.work_order_ticket || '')
      }));
    } catch {
      // Ignore malformed draft payload.
    }
  }, [canManagePpmInclusion, createDraftSessionKey]);

  useEffect(() => {
    if (!canManagePpmInclusion || !createDraftSessionKey) return;
    const draft = {
      assigned_to: String(createForm.assigned_to || ''),
      scheduled_for: String(createForm.scheduled_for || ''),
      due_at: String(createForm.due_at || ''),
      work_order_ticket: String(createForm.work_order_ticket || '')
    };
    sessionStorage.setItem(createDraftSessionKey, JSON.stringify(draft));
  }, [
    createForm.assigned_to,
    createForm.scheduled_for,
    createForm.due_at,
    createForm.work_order_ticket,
    canManagePpmInclusion,
    createDraftSessionKey
  ]);

  const resetCreateAssetPickerUi = () => {
    setCreateAssetSearch('');
    setCreateAssetResults([]);
    setCreateAssetMenuOpen(false);
    setPpmPickHint(null);
    setPpmTicketAutofillHint('');
  };

  const clearCreateAssetSelection = () => {
    setCreateForm((f) => ({ ...f, asset_id: '', work_order_ticket: '' }));
    resetCreateAssetPickerUi();
  };

  const prefillCreateFromAsset = (a) => {
    if (!a?._id || !canManagePpmInclusion) return;
    setPpmPickHint(a);
    const suggestedTicket = String(a?.open_task?.work_order_ticket || '').trim();
    setCreateForm((f) => ({ ...f, asset_id: String(a._id), work_order_ticket: suggestedTicket }));
    setCreateAssetSearch(formatCreateAssetLabel(a));
    setCreateAssetMenuOpen(false);
    setPpmTicketAutofillHint('Loading previous PPM ticket...');
  };

  const createSelectedPreview = useMemo(() => {
    if (!createForm.asset_id) return null;
    const id = String(createForm.asset_id);
    if (ppmPickHint && String(ppmPickHint._id) === id) return ppmPickHint;
    return createAssetResults.find((x) => String(x._id) === id) || null;
  }, [createForm.asset_id, ppmPickHint, createAssetResults]);

  const load = useCallback(async () => {
    const gen = ++assetsLoadGen.current;
    try {
      setLoading(true);
      const q = query.trim();
      const params = { page: assetPage, limit: WORKORDER_PAGE_SIZE };
      if (q) {
        params.q = q;
      } else if (canManagePpmInclusion || user?.role === 'Viewer') {
        params.program_only = true;
      }
      if (ppmListFilter && ppmListFilter !== 'all') {
        params.ppm_bucket = ppmListFilter;
      }
      const [assetsRes, ovRes] = await Promise.all([
        api.get('/ppm/self-service-assets', { params }),
        api.get('/ppm/overview')
      ]);
      if (gen !== assetsLoadGen.current) return;
      if (user?.role === 'Admin' || user?.role === 'Super Admin') {
        try {
          const u = await api.get('/users');
          if (gen !== assetsLoadGen.current) return;
          const techRows = (Array.isArray(u?.data) ? u.data : []).filter((x) => x.role === 'Technician');
          setTechs(techRows);
        } catch {
          if (gen !== assetsLoadGen.current) return;
          setTechs([]);
        }
      } else {
        setTechs([]);
      }
      const payload = assetsRes?.data;
      const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
      setRows(items);
      setAssetMeta({
        total: Number(payload?.total ?? items.length),
        pages: Math.max(1, Number(payload?.pages ?? 1)),
        limit: Number(payload?.limit ?? WORKORDER_PAGE_SIZE)
      });
      if (payload?.page != null) {
        setAssetPage(Math.max(1, Number(payload.page) || 1));
      }
      setOverview(
        ovRes.data || { total: 0, overdue: 0, completed: 0, notCompleted: 0, open: 0, health: 100 }
      );
    } catch (error) {
      if (gen !== assetsLoadGen.current) return;
      const msg = String(error?.response?.data?.message || '');
      if (managerLikeRole && /not allowed/i.test(msg)) {
        // Manager gets redirected to /ppm/manager-section above.
        setRows([]);
        setOverview({ total: 0, overdue: 0, completed: 0, notCompleted: 0, open: 0, health: 100 });
      } else {
        alert(msg || 'Failed to load PPM data');
      }
    } finally {
      if (gen === assetsLoadGen.current) setLoading(false);
    }
  }, [query, canManagePpmInclusion, assetPage, user?.role, managerLikeRole, ppmListFilter]);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    setAssetPage(1);
  }, [query, canManagePpmInclusion, ppmListFilter]);

  useEffect(() => {
    const q0 = searchParams.get('q');
    if (q0 != null && String(q0).trim() !== '') setQuery(String(q0).trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time ?q= from URL (e.g. old /ppm/panel?q=… bookmarks)
  }, []);

  useEffect(() => {
    let cancelled = false;
    const qt = createAssetSearch.trim();
    if (!qt) {
      setCreateAssetResults([]);
      setCreateAssetPickLoading(false);
      return undefined;
    }
    setCreateAssetPickLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/assets', { params: { q: qt, limit: 75, page: 1 } });
        if (cancelled) return;
        setCreateAssetResults(assetListFromResponse(res.data));
      } catch {
        if (!cancelled) setCreateAssetResults([]);
      } finally {
        if (!cancelled) setCreateAssetPickLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [createAssetSearch]);

  useEffect(() => {
    const onDown = (e) => {
      if (!createPickerRef.current?.contains(e.target)) setCreateAssetMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (!canManagePpmInclusion) return;
    const assetId = String(createForm.asset_id || '').trim();
    if (!assetId) {
      setPpmTicketAutofillHint('');
      return;
    }
    const gen = ++ticketLookupGen.current;
    const loadLastTicket = async () => {
      try {
        const { data } = await api.get(`/ppm/assets/${assetId}/last-ticket`);
        if (gen !== ticketLookupGen.current) return;
        const ticket = String(data?.work_order_ticket || '').trim();
        const lastTicketAt = data?.last_ticket_at ? new Date(data.last_ticket_at) : null;
        const lastTicketLabel =
          lastTicketAt && !Number.isNaN(lastTicketAt.getTime())
            ? lastTicketAt.toLocaleDateString()
            : '';
        setCreateForm((f) => {
          if (String(f.asset_id || '') !== assetId) return f;
          return { ...f, work_order_ticket: ticket };
        });
        setPpmTicketAutofillHint(
          ticket
            ? `Using last PPM ticket${lastTicketLabel ? ` (${lastTicketLabel})` : ''}. You can edit it before creating.`
            : 'First PPM for this asset: enter a work order ticket. Next times it will auto-fill.'
        );
      } catch {
        if (gen !== ticketLookupGen.current) return;
        setPpmTicketAutofillHint('Could not fetch previous PPM ticket. Enter the work order ticket manually.');
      }
    };
    void loadLastTicket();
  }, [createForm.asset_id, canManagePpmInclusion]);

  const downloadPpmExcel = async () => {
    try {
      setExportBusy(true);
      const res = await api.get('/ppm/export', { responseType: 'blob' });
      const blob = res.data;
      if (blob?.type?.includes('application/json')) {
        const text = await blob.text();
        const j = JSON.parse(text);
        alert(j.message || 'Export failed');
        return;
      }
      const dispo = res.headers['content-disposition'];
      const match = dispo && /filename="([^"]+)"|filename=([^;\s]+)/i.exec(dispo);
      const name = (match && (match[1] || match[2])?.trim()) || ppmDownloadFallbackFilename();
      const url = window.URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.response?.data?.message || 'Could not download PPM report');
    } finally {
      setExportBusy(false);
    }
  };

  const downloadPpmBulkExportSheet = async () => {
    try {
      setExportBusy(true);
      const res = await api.get('/ppm/export-bulk-sheet', { responseType: 'blob' });
      const blob = res.data;
      if (blob?.type?.includes('application/json')) {
        const text = await blob.text();
        const j = JSON.parse(text);
        alert(j.message || 'Bulk export failed');
        return;
      }
      const dispo = res.headers['content-disposition'];
      const match = dispo && /filename="([^"]+)"|filename=([^;\s]+)/i.exec(dispo);
      const name = (match && (match[1] || match[2])?.trim()) || `PPM_Bulk_Export_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
      const url = window.URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.response?.data?.message || 'Could not download PPM bulk export sheet');
    } finally {
      setExportBusy(false);
    }
  };

  const openPpmBulkImportPicker = () => {
    if (importBusy) return;
    importFileInputRef.current?.click();
  };

  const runPpmBulkImportUpload = async (file, { confirmRecentCompletion = false } = {}) => {
    const form = new FormData();
    form.append('file', file);
    form.append('schedule_date', createForm.scheduled_for || new Date().toISOString());
    form.append('comments', 'PPM bulk import from PPM section');
    const bulkTicket = String(createForm.work_order_ticket || '').trim();
    form.append('work_order_ticket', bulkTicket);
    if (String(createForm.due_at || '').trim()) {
      form.append('due_date', createForm.due_at);
    }
    if (confirmRecentCompletion) {
      form.append('confirm_recent_cycle_completion', 'true');
    }
    return api.post('/ppm/upload', form, {
      // Very large single-sheet imports can run much longer than default axios timeout.
      timeout: 2 * 60 * 60 * 1000
    });
  };

  const handlePpmBulkImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!String(createForm.work_order_ticket || '').trim()) {
      alert('Enter the PPM work order ticket before bulk import (required for PPM assets, same as batch create).');
      return;
    }
    const finishBulkImportSuccess = async (res) => {
      const count = Number(res.data?.assets_included || 0);
      const taskId = String(res.data?.task_id || '');
      if (taskId) {
        lastImportWorkflowIdRef.current = taskId;
        lastCreatedPpmTaskIdsRef.current = [];
      }
      const hasTaskStats = Object.prototype.hasOwnProperty.call(res.data || {}, 'created_ppm_tasks')
        || Object.prototype.hasOwnProperty.call(res.data || {}, 'matched_assets');
      const createdTasks = Number(res.data?.created_ppm_tasks || 0);
      const matchedAssets = Number(res.data?.matched_assets || 0);
      const matchedExistingAssets = Number(res.data?.matched_existing_assets || 0);
      const createdFromImport = Number(res.data?.created_assets_from_import || 0);
      const skippedOpen = Number(res.data?.skipped_open_task || 0);
      const unmatchedRows = Number(res.data?.unmatched_rows || 0);
      const dbg = res.data?.debug || {};
      const dbgLine = dbg.active_store
        ? ` Store: ${dbg.active_store}. File: ${dbg.file_received ? `${dbg.file_size_bytes || 0} bytes` : 'not received'}. Excel rows parsed: ${dbg.excel_rows_parsed ?? '—'}.`
        : '';
      const taskPart = hasTaskStats
        ? ` Created ${createdTasks} visible PPM task(s) for ${matchedAssets} asset(s).`
        : '';
      const sourcePart = hasTaskStats
        ? ` Existing matched: ${matchedExistingAssets}. Auto-created from import: ${createdFromImport}.`
        : '';
      const ack = res.data?.recent_completion_acknowledged ? ' (Confirmed: re-import after recent completion.)' : '';
      alert(
        count > 0
          ? `PPM bulk import completed. ${count} row(s) saved${taskId ? ` (Task: ${taskId})` : ''}.${taskPart}${sourcePart}${skippedOpen > 0 ? ` ${skippedOpen} skipped because an open task already exists.` : ''}${unmatchedRows > 0 ? ` ${unmatchedRows} row(s) could not be processed.` : ''}${dbgLine}${ack}`
          : `PPM bulk import completed.${dbgLine}${ack}`
      );
      setAssetPage(1);
      if (canShowBulkManagerNotifyBanner) updatePendingBulkNotify(true);
      await load();
    };

    try {
      setImportBusy(true);
      try {
        const res = await runPpmBulkImportUpload(file, {});
        await finishBulkImportSuccess(res);
      } catch (firstErr) {
        const st = Number(firstErr?.response?.status);
        const d = firstErr?.response?.data;
        if (st === 409 && d?.requires_confirmation && Array.isArray(d.recently_completed) && d.recently_completed.length > 0) {
          const list = d.recently_completed;
          const cycle = Number(list[0]?.cycle_days) || 180;
          const lines = list.slice(0, 12).map((r) => {
            const label = String(r.unique_id || r.abs_code || r.asset_id || '').trim() || String(r.asset_id || '');
            const days = Number(r.days_since_completion);
            const dayLabel = Number.isFinite(days) ? `${days} day(s) ago` : 'recently';
            return `• ${label} — last PPM completed ${dayLabel}`;
          }).join('\n');
          const more = list.length > 12 ? `\n… and ${list.length - 12} more asset(s).` : '';
          const ok = window.confirm(
            `${d.message || 'These assets had a PPM completed inside the current service window.'}\n\n`
            + `${list.length} asset(s) still fall inside the usual ${cycle}-day window since their last completed PPM:\n\n`
            + `${lines}${more}\n\n`
            + 'Press OK to create new PPM tasks anyway, or Cancel to stop without importing.'
          );
          if (ok) {
            const res2 = await runPpmBulkImportUpload(file, { confirmRecentCompletion: true });
            await finishBulkImportSuccess(res2);
            return;
          }
          return;
        }
        throw firstErr;
      }
    } catch (error) {
      const d = error.response?.data;
      const hint = d?.hint ? `\n\n${d.hint}` : '';
      const extra = d?.file_received === false && d?.message
        ? '\n\nThe server did not receive the file bytes. Try again or use Download Sample Excel as a template.'
        : '';
      alert(`${d?.message || error.message || 'Failed to import Excel file into PPM section'}${hint}${extra}`);
    } finally {
      setImportBusy(false);
    }
  };

  const pieData = useMemo(() => {
    const programTotal = overview.total || 0;
    if (programTotal === 0) {
      return [{ name: 'No data', value: 1, empty: true }];
    }
    const completed = overview.completed || 0;
    const notCompleted = overview.notCompleted || 0;
    const open =
      overview.open != null
        ? overview.open
        : Math.max(0, programTotal - completed - notCompleted);
    if (completed === 0 && notCompleted === 0 && open === 0) {
      return [{ name: 'No data', value: 1, empty: true }];
    }
    return [
      { name: 'Completed', value: completed, empty: false },
      { name: 'Not completed', value: notCompleted, empty: false },
      { name: 'Open', value: open, empty: false }
    ];
  }, [overview]);

  const taskTotal = overview.total || 0;
  const completedCount = overview.completed || 0;
  const notCompletedCount = overview.notCompleted || 0;
  const openCount =
    overview.open != null
      ? overview.open
      : Math.max(0, taskTotal - completedCount - notCompletedCount);
  const completedPct = taskTotal > 0 ? Math.round((completedCount / taskTotal) * 100) : 0;
  const overduePct = taskTotal > 0 ? Math.round(((overview.overdue || 0) / taskTotal) * 100) : 0;
  const notCompletedPct = taskTotal > 0 ? Math.round((notCompletedCount / taskTotal) * 100) : 0;

  /** Drop invalid / duplicate assets so the table and KPIs stay aligned (duplicate React keys caused blank rows). */
  const displayRows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const id = r?.asset?._id;
      if (id == null || id === '') continue;
      const k = String(id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  }, [rows]);

  useEffect(() => {
    const valid = new Set(displayRows.map((r) => String(r?.asset?._id || '')).filter(Boolean));
    setSelectedAssetIds((prev) => prev.filter((id) => valid.has(id)));
  }, [displayRows]);

  const hasActiveSearch = String(query || '').trim().length > 0;
  const visibleAssetIds = useMemo(
    () => displayRows.map((r) => String(r?.asset?._id || '')).filter(Boolean),
    [displayRows]
  );
  const allVisibleSelected = useMemo(
    () => visibleAssetIds.length > 0 && visibleAssetIds.every((id) => selectedAssetIds.includes(id)),
    [visibleAssetIds, selectedAssetIds]
  );
  const selectedVisibleCount = useMemo(
    () => visibleAssetIds.filter((id) => selectedAssetIds.includes(id)).length,
    [visibleAssetIds, selectedAssetIds]
  );
  const rowMatchesSearch = useCallback((row) => {
    if (!hasActiveSearch) return false;
    const q = String(query || '').trim().toLowerCase();
    const compact = q.replace(/\s+/g, '');
    const a = row?.asset || {};
    return ppmSearchFields(a, row).some((v) => {
      const s = String(v || '').trim().toLowerCase();
      if (!s) return false;
      const squashed = s.replace(/\s+/g, '');
      return s.includes(q) || squashed.includes(compact);
    });
  }, [hasActiveSearch, query]);

  const systemHealthPct = useMemo(() => {
    if (!displayRows.length) return overview.health ?? 100;
    const unhealthy = displayRows.filter((r) => isRowUnhealthyForSystemHealth(r)).length;
    return Math.round(((displayRows.length - unhealthy) / displayRows.length) * 100);
  }, [displayRows, overview.health]);
  const unhealthyCount = Math.max(0, displayRows.length - Math.round((systemHealthPct / 100) * displayRows.length));

  const overduePie = useMemo(() => ([
    { name: 'Overdue', value: overview.overdue || 0 },
    { name: 'Other', value: Math.max(0, taskTotal - (overview.overdue || 0)) }
  ]), [overview.overdue, taskTotal]);

  const notCompletedPie = useMemo(() => ([
    { name: 'Not completed', value: notCompletedCount || 0 },
    { name: 'Other', value: Math.max(0, taskTotal - notCompletedCount) }
  ]), [notCompletedCount, taskTotal]);

  const healthPie = useMemo(() => ([
    { name: 'Healthy', value: Math.max(0, displayRows.length - unhealthyCount) },
    { name: 'Unhealthy', value: unhealthyCount }
  ]), [displayRows.length, unhealthyCount]);

  const createDateMeta = useMemo(() => {
    const scheduledRaw = String(createForm.scheduled_for || '').trim();
    const dueRaw = String(createForm.due_at || '').trim();
    if (!scheduledRaw && !dueRaw) return '';
    const scheduledAt = scheduledRaw ? new Date(`${scheduledRaw}T00:00:00`) : null;
    const dueAt = dueRaw ? new Date(`${dueRaw}T00:00:00`) : null;
    const validScheduled = scheduledAt && !Number.isNaN(scheduledAt.getTime());
    const validDue = dueAt && !Number.isNaN(dueAt.getTime());
    if (validScheduled && validDue) {
      const days = Math.round((dueAt.getTime() - scheduledAt.getTime()) / 86400000);
      return `${days} day${Math.abs(days) === 1 ? '' : 's'} between dates`;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (validDue) {
      const days = Math.round((dueAt.getTime() - today.getTime()) / 86400000);
      return `${days} day${Math.abs(days) === 1 ? '' : 's'} from today to due`;
    }
    return '';
  }, [createForm.scheduled_for, createForm.due_at]);

  const openChecklist = async (assetId) => {
    try {
      setBusy(true);
      const res = await api.post(`/ppm/assets/${assetId}/session`);
      setTask(res.data);
      setDrawerOpen(true);
    } catch (error) {
      alert(error.response?.data?.message || 'Could not open PPM checklist');
    } finally {
      setBusy(false);
    }
  };

  const toggleAssetSelection = (assetId, checked) => {
    const id = String(assetId || '').trim();
    if (!id) return;
    setSelectedAssetIds((prev) => {
      const set = new Set(prev);
      if (checked) set.add(id);
      else set.delete(id);
      return Array.from(set);
    });
  };

  const toggleSelectAllVisible = (checked) => {
    setSelectedAssetIds((prev) => {
      const set = new Set(prev);
      if (checked) {
        visibleAssetIds.forEach((id) => set.add(id));
      } else {
        visibleAssetIds.forEach((id) => set.delete(id));
      }
      return Array.from(set);
    });
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setTask(null);
    setSpareForm({ item_name: '', quantity: 1, description: '' });
  };

  const showToast = useCallback((message, tone = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message: String(message || ''), tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const updateItem = (idx, value) => {
    if (!task) return;
    const checklist = [...(task.checklist || [])];
    checklist[idx] = { ...checklist[idx], value };
    setTask({ ...task, checklist });
  };

  const save = async () => {
    if (!task?._id) return;
    try {
      setBusy(true);
      if (task.status === 'Scheduled') {
        await api.patch(`/ppm/${task._id}/start`);
      }
      const res = await api.patch(`/ppm/${task._id}/submit`, {
        checklist: task.checklist || [],
        technician_notes: task.technician_notes || '',
        equipment_used: task.equipment_used || []
      });
      if (res?.data) setTask(res.data);
      void load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to save checklist');
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!task?._id) return;
    try {
      setBusy(true);
      await api.patch(`/ppm/${task._id}/complete`, {
        checklist: task.checklist || [],
        equipment_used: task.equipment_used || [],
        technician_notes: task.technician_notes || ''
      });
      closeDrawer();
      showToast('PPM completed.');
      void load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to complete PPM');
    } finally {
      setBusy(false);
    }
  };

  const reopenForEditDrawer = async () => {
    if (!task?._id) return;
    if (
      !window.confirm(
        'Reopen this PPM for editing? It will return to In Progress so you can update the checklist and save or complete again.'
      )
    ) {
      return;
    }
    try {
      setBusy(true);
      const res = await api.patch(`/ppm/${task._id}/reopen-for-edit`);
      setTask(res.data);
      showToast('PPM reopened for editing.');
      void load();
    } catch (error) {
      alert(error.response?.data?.message || 'Could not reopen PPM for editing');
    } finally {
      setBusy(false);
    }
  };

  const markNotCompleted = async () => {
    if (!task?._id) return;
    const reason = String(task.technician_notes || '').trim();
    if (reason.length < 8) {
      alert('Write at least 8 characters in the comment box explaining why this PPM could not be completed, then tap “Not completed”.');
      return;
    }
    try {
      setBusy(true);
      await api.patch(`/ppm/${task._id}/mark-not-completed`, {
        technician_notes: reason,
        checklist: task.checklist || [],
        equipment_used: task.equipment_used || []
      });
      closeDrawer();
      void load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to mark PPM as not completed');
    } finally {
      setBusy(false);
    }
  };

  const toggleEquipment = (eq) => {
    if (!task) return;
    const current = new Set(task.equipment_used || []);
    if (current.has(eq)) current.delete(eq);
    else current.add(eq);
    setTask({ ...task, equipment_used: Array.from(current) });
  };

  const assetName = (a) => String(a?.model_number || a?.name || a?.product_name || '—');

  const openPpmTaskCanCancel = (t) =>
    Boolean(t?._id && t.status !== 'Completed' && t.status !== 'Cancelled');

  const performRemoveFromPpmList = useCallback(async (taskId, assetId) => {
    if (!taskId) return;
    try {
      setBusy(true);
      await api.patch(`/ppm/${taskId}/cancel`, { reason: 'Cancelled from PPM work orders' });
      if (assetId) {
        await api.patch(`/ppm/assets/${assetId}/ppm-enabled`, {
          enabled: false,
          isolate_from_inventory: true,
        });
      }
      void load();
    } catch (error) {
      alert(error.response?.data?.message || 'Could not remove this asset from the PPM list');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const cancelOpenPpmTask = (taskId, assetId) => {
    if (!taskId) return;
    if (
      !window.confirm(
        'Do you want to delete this PPM from the list? This will cancel the open task and remove the asset from the PPM program.'
      )
    ) {
      return;
    }
    if (pendingRemoveTimerRef.current) {
      window.clearTimeout(pendingRemoveTimerRef.current);
      pendingRemoveTimerRef.current = null;
    }
    setPendingRemove({ taskId, assetId });
    pendingRemoveTimerRef.current = window.setTimeout(() => {
      pendingRemoveTimerRef.current = null;
      setPendingRemove((current) => {
        if (!current) return null;
        void performRemoveFromPpmList(current.taskId, current.assetId);
        return null;
      });
    }, PPM_REMOVE_UNDO_MS);
  };

  const undoPendingRemove = () => {
    if (pendingRemoveTimerRef.current) {
      window.clearTimeout(pendingRemoveTimerRef.current);
      pendingRemoveTimerRef.current = null;
    }
    setPendingRemove(null);
  };

  useEffect(() => () => {
    if (pendingRemoveTimerRef.current) {
      window.clearTimeout(pendingRemoveTimerRef.current);
      pendingRemoveTimerRef.current = null;
    }
    if (pendingDrawerCancelTimerRef.current) {
      window.clearTimeout(pendingDrawerCancelTimerRef.current);
      pendingDrawerCancelTimerRef.current = null;
    }
  }, []);

  const submitSpareRequest = async () => {
    if (!task?._id || !task?.asset?._id) return;
    const itemName = String(spareForm.item_name || '').trim();
    const qty = Math.max(1, Number(spareForm.quantity) || 1);
    const description = String(spareForm.description || '').trim();
    if (!itemName) {
      alert('Enter required spare part name.');
      return;
    }
    try {
      setSpareSubmitting(true);
      await api.post('/requests', {
        item_name: itemName,
        quantity: qty,
        description: `PPM spare request\nTask: ${task._id}\nAsset UID: ${task.asset?.uniqueId || 'N/A'}\nAsset ABS: ${task.asset?.abs_code || 'N/A'}\n${description}`.trim(),
        request_type: 'PPM Spare Parts',
        ppm_task: task._id,
        asset: task.asset._id
      });
      setSpareForm({ item_name: '', quantity: 1, description: '' });
      alert('Spare parts request sent to admin for approve/reject/modify.');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to send spare parts request');
    } finally {
      setSpareSubmitting(false);
    }
  };

  const openPpmAssetHistory = async (assetId) => {
    const aid = String(assetId || '').trim();
    if (!aid) return;
    setPpmHistoryOpen(true);
    setPpmHistoryBusy(true);
    setPpmHistoryError('');
    setPpmHistoryData({ asset: null, tasks: [], spareRequests: [] });
    try {
      const { data } = await api.get(`/ppm/assets/${aid}/history`);
      setPpmHistoryData({
        asset: data?.asset || null,
        tasks: Array.isArray(data?.tasks) ? data.tasks : [],
        spareRequests: Array.isArray(data?.spareRequests) ? data.spareRequests : []
      });
    } catch (error) {
      setPpmHistoryError(error.response?.data?.message || 'Failed to load PPM asset history');
    } finally {
      setPpmHistoryBusy(false);
    }
  };

  const createTask = async () => {
    const selectedIds = Array.from(new Set(selectedAssetIds.map((id) => String(id || '').trim()).filter(Boolean)));
    const createForSelection = selectedIds.length > 0;
    if (!createForSelection && !createForm.asset_id) {
      alert('Select asset(s) using PPM checkbox, or pick one asset from the search picker.');
      return;
    }
    if (!String(createForm.work_order_ticket || '').trim()) {
      alert('PPM work order ticket is required for this asset.');
      return;
    }
    if (createForSelection && !String(createForm.scheduled_for || '').trim()) {
      alert('Scheduled date is required when creating tasks from selected assets.');
      return;
    }
    if (createForSelection && !String(createForm.due_at || '').trim()) {
      alert('Due date is required when creating tasks from selected assets.');
      return;
    }
    try {
      setCreating(true);
      const idsToCreate = createForSelection ? selectedIds : [String(createForm.asset_id)];
      const sharedBody = {
        work_order_ticket: createForm.work_order_ticket,
        scheduled_for: createForm.scheduled_for || new Date().toISOString(),
        due_at: createForm.due_at,
        checklist: createForm.checklist,
        manager_notes: createForm.manager_notes,
        assigned_to: createForm.assigned_to || undefined
      };

      let data;
      let legacyMultiCreateFallback = false;
      if (idsToCreate.length === 1) {
        const { data: one } = await api.post('/ppm', {
          ...sharedBody,
          asset_id: idsToCreate[0]
        });
        data = { created: one ? [one] : [], failed: [], created_count: one ? 1 : 0 };
      } else {
        try {
          const res = await api.post('/ppm/batch', {
            asset_ids: idsToCreate,
            ...sharedBody
          });
          data = res.data;
        } catch (batchErr) {
          if (batchErr.response?.status !== 404) throw batchErr;
          legacyMultiCreateFallback = true;
          const created = [];
          const failed = [];
          for (const asset_id of idsToCreate) {
            try {
              const { data: row } = await api.post('/ppm', { ...sharedBody, asset_id });
              if (row) created.push(row);
            } catch (e) {
              const msg =
                e.response?.data?.message ||
                e.response?.data?.error ||
                e.message ||
                'failed';
              failed.push({ asset_id, message: msg });
            }
          }
          data = {
            created,
            failed,
            created_count: created.length
          };
        }
      }

      const success = Number(data?.created_count ?? data?.created?.length ?? 0);
      const failedCount = Array.isArray(data?.failed) ? data.failed.length : 0;
      if (success === 0) {
        alert(
          failedCount > 0
            ? 'Could not create PPM task(s). Each selected asset may already have an open task or be outside this store.'
            : 'Could not create PPM task(s). Some assets may already have an open task.'
        );
        return;
      }
      const createdList = Array.isArray(data?.created) ? data.created : [];
      const newTaskIds = createdList.map((t) => String(t?._id || '')).filter(Boolean);
      if (newTaskIds.length > 0) {
        lastCreatedPpmTaskIdsRef.current = newTaskIds;
        /**
         * Keep lastImportWorkflowIdRef after batch create: import assets already have open tasks;
         * create only updates ticket/dates. Clearing the ref made "Send notification" call
         * notify-bulk-program on import-linked rows (blocked). Submit stays POST /ppm/notify-manager until sent.
         */
      }
      if (canManagePpmInclusion) updatePendingBulkNotify(true);
      const queueHint = canShowBulkManagerNotifyBanner
        ? 'Use "Send notification to managers" when you are ready so the manager queue and email go out (import batches use the same button).'
        : '';
      const legacyHint = legacyMultiCreateFallback
        ? ' (This server responded without the batch endpoint; consider updating the backend.)'
        : '';
      if (failedCount > 0) {
        alert(
          `Created ${success} task(s). ${failedCount} asset(s) were skipped (for example, already has an open PPM or invalid for this store).${legacyHint}${queueHint ? ` ${queueHint}` : ''}`
        );
      } else if (queueHint) {
        alert(`Created ${success} task(s). ${queueHint}`);
      } else {
        alert(`Created ${success} task(s).`);
      }
      setSelectedAssetIds([]);
      setCreateForm((f) => ({ ...f, asset_id: '' }));
      resetCreateAssetPickerUi();
      await load();
    } catch (error) {
      const d = error.response?.data;
      const status = error.response?.status;
      const base =
        (d && typeof d === 'object' && d.message) ||
        (d && typeof d === 'object' && d.error) ||
        (status === 404
          ? 'PPM API path was not found. Check that the backend is running the latest version and the dev proxy points at the correct port.'
          : null) ||
        error.message ||
        'Failed to create PPM task';
      const failed = d && typeof d === 'object' && Array.isArray(d.failed) ? d.failed : [];
      if (failed.length > 0) {
        const lines = failed.map((f) => `${String(f.asset_id || '').slice(-8) || 'asset'}: ${f.message || 'failed'}`);
        alert(`${base}\n\n${lines.join('\n')}`);
      } else {
        alert(base);
      }
    } finally {
      setCreating(false);
    }
  };

  const confirmResetPpmProgram = async () => {
    const password = resetProgramPassword.trim();
    if (!password) {
      alert('Enter your account password to confirm.');
      return;
    }
    try {
      setResetProgramBusy(true);
      const { data } = await api.post('/ppm/reset-program', { password });
      setResetProgramOpen(false);
      setResetProgramPassword('');
      lastImportWorkflowIdRef.current = null;
      lastCreatedPpmTaskIdsRef.current = [];
      if (canShowBulkManagerNotifyBanner) updatePendingBulkNotify(false);
      closeDrawer();
      clearCreateAssetSelection();
      await load();
      const n = data?.deletedTasks ?? 0;
      const wf = data?.deletedWorkflows ?? 0;
      const tmp = data?.deletedTempAssets ?? 0;
      const a = data?.assetsPpmCleared ?? 0;
      const hist = data?.deletedHistoryLogs ?? 0;
      alert(
        `PPM program reset for this store.\n\n` +
          `Work-order tasks removed: ${n}\n` +
          `Import workflow batches removed: ${wf}\n` +
          `Import staging rows removed: ${tmp}\n` +
          `PPM history logs removed: ${hist}\n` +
          `Assets cleared from PPM program: ${a}`
      );
    } catch (error) {
      alert(error.response?.data?.message || 'Could not reset PPM program');
    } finally {
      setResetProgramBusy(false);
    }
  };

  const cancelTaskDrawer = async () => {
    if (!task?._id) return;
    if (!window.confirm('Cancel this PPM task? It will be marked cancelled.')) return;
    if (pendingDrawerCancelTimerRef.current) {
      window.clearTimeout(pendingDrawerCancelTimerRef.current);
      pendingDrawerCancelTimerRef.current = null;
    }
    setPendingDrawerCancel({ taskId: task._id });
    pendingDrawerCancelTimerRef.current = window.setTimeout(() => {
      pendingDrawerCancelTimerRef.current = null;
      setPendingDrawerCancel((current) => {
        if (!current?.taskId) return null;
        void (async () => {
          try {
            setBusy(true);
            await api.patch(`/ppm/${current.taskId}/cancel`, { reason: 'Cancelled from PPM work orders' });
            closeDrawer();
            void load();
          } catch (error) {
            alert(error.response?.data?.message || 'Failed to cancel task');
          } finally {
            setBusy(false);
          }
        })();
        return null;
      });
    }, PPM_REMOVE_UNDO_MS);
  };

  const undoPendingDrawerCancel = () => {
    if (pendingDrawerCancelTimerRef.current) {
      window.clearTimeout(pendingDrawerCancelTimerRef.current);
      pendingDrawerCancelTimerRef.current = null;
    }
    setPendingDrawerCancel(null);
  };

  const collectUnstagedPpmTaskIdsFromSelection = () => {
    const sel = new Set(selectedAssetIds.map((id) => String(id || '').trim()).filter(Boolean));
    const out = [];
    for (const row of rows) {
      const aid = String(row?.asset?._id || '');
      if (!sel.has(aid)) continue;
      const open = row.open_task;
      if (!open?._id) continue;
      if (String(open.manager_review?.status || 'Pending') !== 'Pending') continue;
      if (open.manager_notification_pending === true) continue;
      out.push(String(open._id));
    }
    return [...new Set(out)];
  };

  const sendBulkPpmNotification = async () => {
    try {
      setBulkNotifyBusy(true);
      const wfId = String(lastImportWorkflowIdRef.current || '').trim();
      /**
       * Bulk import always has a workflow row (PpmWorkflowTask). Per-asset rows are blocked from
       * notify-bulk-program until that workflow is submitted — so submit the workflow first whenever
       * it is still pending (even if the admin ticked checkboxes on imported assets).
       */
      if (wfId) {
        const { data } = await api.post('/ppm/notify-manager', { ppm_task_id: wfId });
        lastImportWorkflowIdRef.current = null;
        const emails = Array.isArray(data?.managerRecipients) ? data.managerRecipients : [];
        if (data?.emailSent && emails.length > 0) {
          alert(`Import batch sent to manager queue. Email sent to: ${emails.join(', ')}`);
        } else {
          alert(
            'Import batch submitted to the manager queue.' +
              (emails.length === 0 ? ' Configure manager notification emails in Portal to also send email.' : '')
          );
        }
        updatePendingBulkNotify(false);
        await load();
        return;
      }

      const fromSelection = collectUnstagedPpmTaskIdsFromSelection();
      const fromLastCreate = Array.isArray(lastCreatedPpmTaskIdsRef.current)
        ? lastCreatedPpmTaskIdsRef.current.filter(Boolean)
        : [];
      const task_ids = fromSelection.length > 0 ? fromSelection : fromLastCreate;
      if (task_ids.length > 0) {
        const { data } = await api.post('/ppm/notify-bulk-program', { task_ids });
        lastCreatedPpmTaskIdsRef.current = [];
        const n = Number(data?.recipientCount);
        const emails = Array.isArray(data?.recipientEmails) ? data.recipientEmails : [];
        const tc = Number(data?.taskCount || 0);
        const blocked = Number(data?.blocked_import_workflow || 0);
        if (blocked > 0) {
          alert(
            `Submitted ${tc} PPM task(s) to the manager queue.${blocked} task(s) belong to a bulk import batch and must be submitted using the same button after import (workflow). Configure manager emails in Portal to also send email.`
          );
        } else if (emails.length > 0 && data?.emailSent) {
          alert(`Submitted ${tc} task(s). Email sent to: ${emails.join(', ')}`);
        } else if (tc > 0) {
          alert(
            `Submitted ${tc} task(s) to the manager dashboard queue.${emails.length === 0 ? ' Email was skipped because manager notification emails are not configured in Portal.' : ''}`
          );
        } else {
          alert(Number.isFinite(n) && n > 0 ? `Notification sent to ${n} manager email(s).` : 'Notification sent to manager.');
        }
        updatePendingBulkNotify(false);
        await load();
        return;
      }

      alert(
        'Nothing to send. Create PPM tasks from selected assets (or run a bulk import), then click Send again — or tick the checkboxes for assets whose new tasks are not yet in the manager queue.'
      );
    } catch (error) {
      alert(error.response?.data?.message || 'Could not send manager notification');
    } finally {
      setBulkNotifyBusy(false);
    }
  };

  const dismissBulkPpmNotifyReminder = () => {
    if (
      !window.confirm(
        'Dismiss this reminder without sending? It stays cleared until you create new PPM tasks or run another bulk import.'
      )
    ) {
      return;
    }
    updatePendingBulkNotify(false);
  };

  return (
    <div className="space-y-4">
      {toast ? (
        <div className="fixed right-4 top-4 z-[120]">
          <div
            className={`rounded-lg border px-3 py-2 text-sm shadow-lg ${
              toast.tone === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-slate-50 border-slate-300 text-slate-800'
            }`}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">PPM program overview</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          {canManagePpmInclusion ? (
            <>
              <span className="font-semibold">Type in the search box</span> to find assets in the store; use the{' '}
              <span className="font-semibold">PPM</span> column checkboxes to select assets. Then set date/ticket and click create task. With an empty search, this table lists the same{' '}
              <span className="font-semibold">PPM scope as the overview</span> (flagged for PPM or with a non-cancelled PPM task). Open the wrench to run the checklist.
            </>
          ) : (
            <>Search by Unique ID, ABS code, or IP. Open the wrench on a listed asset to run the checklist.</>
          )}
        </p>
      </div>

      {canShowBulkManagerNotifyBanner && pendingBulkPpmNotify ? (
        <div
          role="status"
          className="rounded-xl border border-[rgb(var(--accent-color)/0.35)] bg-app-accent-soft px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm"
        >
          <p className="text-sm text-app-main">
            New PPM work is saved but not yet in the manager queue—only an Admin or Super Admin can send this. Use the button when you are ready so managers can approve, reject, or modify. After a bulk import, this submits the import batch first; for checkbox-created tasks it uses your selection or the last batch you created. If a manager chose <strong>Modify</strong>, revise the task on the PPM program page, then send again to return it to the manager queue.
          </p>
          <div className="flex flex-wrap gap-2 shrink-0">
            {managerNotifyEmails.length === 0 ? (
              <span className="inline-flex items-center justify-center rounded-lg border border-[rgb(var(--accent-color)/0.35)] bg-[rgb(var(--bg-primary))] px-3 py-2 text-sm font-semibold text-app-accent">
                No manager notification emails configured in Portal
              </span>
            ) : null}
            {managerNotifyEmails.length === 1 ? (
              <span className="inline-flex items-center justify-center rounded-lg border border-[rgb(var(--accent-color)/0.35)] bg-[rgb(var(--bg-primary))] px-3 py-2 text-sm font-semibold text-app-main">
                Will send to: {managerNotifyEmails[0]}
              </span>
            ) : null}
            {managerNotifyEmails.length > 1 ? (
              <span className="inline-flex items-center justify-center rounded-lg border border-[rgb(var(--accent-color)/0.35)] bg-[rgb(var(--bg-primary))] px-3 py-2 text-sm font-semibold text-app-main">
                Will send to {managerNotifyEmails.length} emails: {managerNotifyEmails.join(', ')}
              </span>
            ) : null}
            <button
              type="button"
              disabled={bulkNotifyBusy}
              onClick={sendBulkPpmNotification}
              className="btn-app-primary-md disabled:opacity-60"
            >
              {bulkNotifyBusy ? 'Sending…' : 'Send notification to managers'}
            </button>
            <button
              type="button"
              disabled={bulkNotifyBusy}
              onClick={dismissBulkPpmNotifyReminder}
              className="btn-app-outline-md disabled:opacity-60"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {canManagePpmInclusion && pendingRemove ? (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm"
        >
          <p className="text-sm text-slate-800">
            Removing from PPM list in a few seconds.
          </p>
          <button type="button" onClick={undoPendingRemove} className="btn-app-outline-md">
            Undo
          </button>
        </div>
      ) : null}

      {canManagePpmInclusion && pendingDrawerCancel ? (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm"
        >
          <p className="text-sm text-slate-800">
            Cancelling this drawer task in a few seconds.
          </p>
          <button type="button" onClick={undoPendingDrawerCancel} className="btn-app-outline-md">
            Undo
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col min-h-[220px]">
          <div className="text-xs font-semibold uppercase text-slate-500">PPM coverage</div>
          <div className="relative flex-1 min-h-[180px] mt-2">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={78} paddingAngle={2}>
                  {pieData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={
                        entry.empty
                          ? '#cbd5e1'
                          : entry.name === 'Completed'
                            ? '#10b981'
                            : entry.name === 'Not completed'
                              ? '#f97316'
                              : '#fbbf24'
                      }
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
              style={{ paddingBottom: 8 }}
            >
              {!pieData[0]?.empty ? (
                <>
                  <div className="text-4xl font-bold text-emerald-700 leading-none">{completedPct}%</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mt-1">Completed</div>
                </>
              ) : (
                <div className="text-sm text-slate-400">No assets in PPM</div>
              )}
            </div>
          </div>
          <div className="text-center text-sm text-slate-600">
            {!pieData[0]?.empty ? (
              <span>
                <span className="font-semibold text-orange-700">{notCompletedCount}</span> not completed
                <span className="mx-2 text-slate-300">·</span>
                <span className="font-semibold text-amber-600">{openCount}</span> open
              </span>
            ) : null}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm min-h-[220px]">
          <div className="text-xs font-semibold uppercase text-slate-500">Overdue PPMs</div>
          <div className="relative min-h-[170px] mt-2">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={overduePie} dataKey="value" innerRadius={42} outerRadius={64} strokeWidth={0}>
                  <Cell fill="#f43f5e" />
                  <Cell fill="#e2e8f0" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center">
              <div>
                <div className="text-3xl font-bold text-rose-600 leading-none">{overduePct}%</div>
                <div className="text-[11px] uppercase text-slate-500 mt-1">{overview.overdue ?? 0} tasks</div>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm min-h-[220px]">
          <div className="text-xs font-semibold uppercase text-slate-500">Not completed</div>
          <div className="relative min-h-[170px] mt-2">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={notCompletedPie} dataKey="value" innerRadius={42} outerRadius={64} strokeWidth={0}>
                  <Cell fill="#f97316" />
                  <Cell fill="#e2e8f0" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center">
              <div>
                <div className="text-3xl font-bold text-orange-600 leading-none">{notCompletedPct}%</div>
                <div className="text-[11px] uppercase text-slate-500 mt-1">{notCompletedCount} tasks</div>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm min-h-[220px]">
          <div className="text-xs font-semibold uppercase text-slate-500">PPM task health</div>
          <div className="relative min-h-[170px] mt-2">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={healthPie} dataKey="value" innerRadius={42} outerRadius={64} strokeWidth={0}>
                  <Cell fill="#10b981" />
                  <Cell fill="#ef4444" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center">
              <div>
                <div className="text-3xl font-bold text-emerald-700 leading-none">{systemHealthPct}%</div>
                <div className="text-[11px] uppercase text-slate-500 mt-1">{unhealthyCount} unhealthy</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {canManagePpmInclusion && ppmPickHint && createForm.asset_id ? (
        <div className="rounded-xl border border-[rgb(var(--accent-color)/0.35)] bg-app-accent-soft px-4 py-3 text-sm text-app-main flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-semibold">Asset pre-selected for new PPM task</div>
            <div className="text-xs mt-1 font-mono">
              UID {ppmPickHint.uniqueId || '—'} · ABS {ppmPickHint.abs_code || '—'} · IP {ppmPickHint.ip_address || '—'}
            </div>
            <p className="text-xs mt-1 text-app-muted">
              The program table and manager workflow show the asset ticket when set (e.g. final111…); otherwise the PPM work order ticket on the open task. The WO field auto-fills from the last PPM task and stays editable for new work.
            </p>
          </div>
          <button type="button" className="btn-app-outline shrink-0 px-2 py-1 text-xs" onClick={clearCreateAssetSelection}>
            Clear
          </button>
        </div>
      ) : null}

      {canManagePpmInclusion ? (
        <div className="overflow-visible rounded-xl border border-slate-200/90 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold tracking-tight text-slate-800 sm:text-base">New PPM work order</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-snug text-slate-500">
              Pick assets with the PPM checkboxes (or one asset in the picker), enter dates and one work order ticket, then create. That ticket is saved on each open PPM task and on each asset’s Ticket field so the manager queue and emails match what you typed.
            </p>
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
              <div
                className="relative min-w-0 w-full flex-1 lg:max-w-md xl:max-w-lg"
                ref={createPickerRef}
              >
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Asset
                </label>
                <div className="flex gap-1.5">
                  <input
                    value={createAssetSearch}
                    onChange={(e) => {
                      setCreateAssetSearch(e.target.value);
                      setCreateForm((f) => ({ ...f, asset_id: '' }));
                      setCreateAssetMenuOpen(true);
                    }}
                    onFocus={() => setCreateAssetMenuOpen(true)}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-sm shadow-sm focus:border-[rgb(var(--accent-color))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent-color)/0.2)]"
                    placeholder="UID, ABS, serial, IP, MAC, model…"
                    autoComplete="off"
                    aria-label="Search asset for new PPM task"
                    title="Search assets — pick a row to assign this PPM."
                  />
                  {createForm.asset_id ? (
                    <button
                      type="button"
                      className="h-9 shrink-0 rounded-lg border border-slate-300 px-2.5 text-sm text-slate-600 hover:bg-slate-50"
                      title="Remove selected asset"
                      onClick={clearCreateAssetSelection}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                {createForm.asset_id ? (
                  <span className="mt-1.5 inline-flex w-fit max-w-full items-center gap-1 rounded-md border border-[rgb(var(--accent-color)/0.35)] bg-app-accent-soft px-2 py-0.5 text-[10px] font-medium text-app-accent">
                    <span className="truncate min-w-0">
                      {createSelectedPreview ? formatCreateAssetShortLabel(createSelectedPreview) : 'Selected'}
                    </span>
                  </span>
                ) : (
                  <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                    Or use <span className="font-medium text-slate-700">Create task</span> on a table row when no open PPM exists.
                  </p>
                )}
                {createAssetMenuOpen && createAssetSearch.trim() ? (
                  <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg max-h-64 overflow-y-auto">
                    {createAssetPickLoading ? (
                      <div className="px-3 py-3 text-sm text-slate-500">Searching assets…</div>
                    ) : createAssetResults.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-slate-500">No assets match. Try another UID, ABS, serial, IP, or MAC.</div>
                    ) : (
                      createAssetResults.map((a) => (
                        <button
                          key={a._id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-xs border-b border-slate-100 last:border-0 hover:bg-[rgb(var(--accent-color)/0.08)]"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setCreateForm((f) => ({ ...f, asset_id: String(a._id), work_order_ticket: '' }));
                            setCreateAssetSearch(formatCreateAssetLabel(a));
                            setCreateAssetMenuOpen(false);
                            setPpmPickHint(null);
                            setPpmTicketAutofillHint('Loading previous PPM ticket...');
                          }}
                        >
                          <div className="font-medium text-slate-800 truncate">{formatCreateAssetLabel(a)}</div>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-1 hidden text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:block">
                  Schedule & ticket
                </div>
                <div className="flex flex-wrap items-end gap-2 sm:gap-2.5">
                  <div className="w-full min-w-[10rem] sm:w-auto sm:min-w-[9.5rem]">
                    <label className="mb-1 block text-[11px] font-medium text-slate-500 lg:hidden">Technician</label>
                    <select
                      value={createForm.assigned_to}
                      onChange={(e) => setCreateForm({ ...createForm, assigned_to: e.target.value })}
                      className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-[rgb(var(--accent-color))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent-color)/0.2)]"
                      title="Assign technician (optional)"
                    >
                      <option value="">Technician (optional)</option>
                      {techs.map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500 lg:sr-only">Start</label>
                    <input
                      type="date"
                      value={createForm.scheduled_for}
                      onChange={(e) => setCreateForm({ ...createForm, scheduled_for: e.target.value })}
                      className="h-9 w-full min-w-[9.5rem] rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-[rgb(var(--accent-color))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent-color)/0.2)] sm:w-[9.75rem]"
                      title="Scheduled for"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500 lg:sr-only">Due</label>
                    <input
                      type="date"
                      value={createForm.due_at}
                      onChange={(e) => setCreateForm({ ...createForm, due_at: e.target.value })}
                      className="h-9 w-full min-w-[9.5rem] rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-[rgb(var(--accent-color))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent-color)/0.2)] sm:w-[9.75rem]"
                      title="Due date (defaults to ~180 days if empty for batch)"
                    />
                  </div>
                  {createDateMeta ? (
                    <span className="hidden pb-1 text-[10px] leading-tight text-slate-500 xl:block xl:max-w-[5.5rem]">
                      {createDateMeta}
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1 sm:flex-initial sm:basis-[11rem]">
                    <label className="mb-1 block text-[11px] font-medium text-slate-500 lg:sr-only">PPM WO ticket</label>
                    <input
                      value={createForm.work_order_ticket}
                      onChange={(e) => setCreateForm({ ...createForm, work_order_ticket: e.target.value })}
                      className="h-9 w-full min-w-[8rem] rounded-lg border border-slate-300 bg-white px-2.5 text-sm shadow-sm focus:border-[rgb(var(--accent-color))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent-color)/0.2)] sm:w-[11rem]"
                      placeholder="PPM WO ticket *"
                      title="Used for create/batch and for Excel bulk import (manager sees this as Ticket number). Auto-filled when picking one asset."
                    />
                  </div>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={createTask}
                    className="inline-flex h-9 w-full shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--accent-color))] px-4 text-sm font-semibold text-[rgb(var(--accent-contrast))] shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {creating ? 'Creating…' : 'Create PPM task'}
                  </button>
                </div>
                {createDateMeta ? (
                  <p className="mt-1.5 text-[10px] text-slate-500 xl:hidden">{createDateMeta}</p>
                ) : null}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
              {selectedAssetIds.length > 0 ? (
                <p className="font-semibold text-[rgb(var(--accent-color))]">
                  {selectedAssetIds.length} row(s) selected for batch create
                </p>
              ) : null}
              {createForm.asset_id ? (
                <p className={selectedAssetIds.length > 0 ? 'mt-1' : ''}>
                  {ppmTicketAutofillHint || 'PPM work order ticket will auto-fill from the last PPM task for this asset.'}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {canManagePpmInclusion ? (
        <div className="px-4 py-4 border-t border-slate-200 bg-slate-50/40">
          {/* Export | import | reset */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800 tracking-tight">Exports, imports &amp; program reset</h3>
              <p className="text-xs text-slate-600 mt-0.5 max-w-3xl">
                Work left to right: download data → use the sample file → upload import. Reset is only when you need to clear this store&apos;s whole PPM program.
              </p>
            </div>
            <div
              className={`grid grid-cols-1 lg:divide-x lg:divide-slate-200 ${
                adminLikeRole || user?.role === 'Super Admin' ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
              }`}
            >
              <section className="p-3 sm:p-4 flex flex-col gap-2.5 bg-white">
                <div>
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[rgb(var(--accent-color))] text-[rgb(var(--accent-contrast))] text-[10px] font-bold">
                    1
                  </span>
                  <h4 className="mt-1.5 text-sm font-semibold text-slate-900">Export</h4>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">Task history report, or a sheet in bulk-import layout.</p>
                </div>
                <div className="mt-auto flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={exportBusy}
                    onClick={downloadPpmExcel}
                    className="btn-app-primary-md w-full justify-center text-center whitespace-normal leading-snug py-2 px-3 text-[13px] font-semibold"
                    title="Each export uses a new file name (date and time) so downloads are not overwritten."
                  >
                    {exportBusy ? 'Preparing…' : 'Download PPM task report (.xlsx)'}
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy}
                    onClick={downloadPpmBulkExportSheet}
                    className="btn-app-outline-md w-full justify-center text-center whitespace-normal leading-snug py-2 px-3 text-[13px] font-semibold"
                    title="Export current PPM program assets in the same columns used by Bulk Import."
                  >
                    {exportBusy ? 'Preparing…' : 'Export program list (import format)'}
                  </button>
                </div>
              </section>
              <section className="p-3 sm:p-4 flex flex-col gap-2.5 bg-slate-50/40">
                <div>
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[rgb(var(--accent-color))] text-[rgb(var(--accent-contrast))] text-[10px] font-bold">
                    2
                  </span>
                  <h4 className="mt-1.5 text-sm font-semibold text-slate-900">Import</h4>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Fill the template, then set scheduled date, optional due date, and the PPM WO ticket in the New PPM work order section before upload—that ticket is applied to every imported row, tasks, assets, and the manager workflow (same rules as checkbox batch create).
                  </p>
                </div>
                <div className="mt-auto flex flex-col gap-1.5">
                  <a
                    href="/ppm_bulk_import_sample.xlsx"
                    download="ppm_bulk_import_sample.xlsx"
                    className="btn-app-outline-md w-full justify-center no-underline whitespace-normal text-center py-2 px-3 text-[13px] font-semibold"
                    title="Download sample Excel with correct import columns and example rows."
                  >
                    Download import template (.xlsx)
                  </a>
                  <button
                    type="button"
                    onClick={openPpmBulkImportPicker}
                    disabled={importBusy}
                    className="btn-app-primary-md w-full justify-center text-center whitespace-normal leading-snug py-2 px-3 text-[13px] font-semibold"
                    title="Upload Excel into isolated PPM section (does not add to inventory assets)."
                  >
                    {importBusy ? 'Importing…' : 'Upload bulk import file'}
                  </button>
                </div>
              </section>
              {adminLikeRole || user?.role === 'Super Admin' ? (
                <section className="p-3 sm:p-4 flex flex-col gap-2.5 bg-white lg:bg-amber-50/20">
                  <div>
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-700 text-white text-[10px] font-bold">
                      3
                    </span>
                    <h4 className="mt-1.5 text-sm font-semibold text-slate-900">Program reset</h4>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Removes all PPM work orders, import batches, staging rows, and PPM history for this store; clears
                      PPM flags on assets. Admin or Super Admin only. Password required.
                    </p>
                  </div>
                  <div className="mt-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setResetProgramPassword('');
                        setResetProgramOpen(true);
                      }}
                      className="btn-app-outline-md w-full justify-center !border-slate-600 text-slate-800 hover:bg-slate-100 font-semibold py-2 px-3 text-[13px]"
                      title="Removes all PPM data for this store (tasks, import workflows, temp rows, history) and clears PPM flags on assets. Admin or Super Admin only. Requires your password."
                    >
                      Reset entire PPM program…
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-4 border-b border-slate-200 space-y-4">
          <input
            ref={importFileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handlePpmBulkImportFile}
            className="hidden"
          />
          {/* Row 1: search + grouped list/table controls */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4">
            <div className="min-w-0 flex-1 flex items-center">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  canManagePpmInclusion
                    ? 'Search Unique ID, ABS, name, model, serial, QR, RF ID, MAC, location, ticket, manufacturer, status, vendor…'
                    : 'Search Unique ID, ABS, name, model, serial, QR, RF ID, MAC, location, ticket, manufacturer, status, vendor…'
                }
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm shadow-sm focus:ring-2 focus:ring-[rgb(var(--accent-color)/0.25)] focus:border-[rgb(var(--accent-color))]"
              />
            </div>
            <div
              className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 lg:shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-2.5"
              role="group"
              aria-label="List and table options"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 px-1 w-full sm:w-auto sm:mr-0">
                  List
                </span>
                <select
                  value={ppmListFilter}
                  onChange={(e) => setPpmListFilter(e.target.value)}
                  className="h-10 min-w-[12.5rem] rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-800 shadow-sm focus:border-[rgb(var(--accent-color))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent-color)/0.2)]"
                  aria-label="Filter PPM program assets by latest task status"
                  title="Pending: open work or no finished PPM in the current cycle. Completed: latest PPM finished within the cycle. Not completed: closed as not completed."
                >
                  <option value="all">All program assets</option>
                  <option value="not_completed">Not completed</option>
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                </select>
                <button
                  type="button"
                  onClick={() => load()}
                  className="btn-app-outline h-10 text-sm px-3.5 rounded-lg font-semibold"
                >
                  Refresh
                </button>
              </div>
              <div className="hidden sm:block w-px h-9 bg-slate-300 self-center mx-1" aria-hidden />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 px-1 w-full sm:w-auto">
                  Table
                </span>
                <select
                  value={density}
                  onChange={(e) => setDensity(e.target.value)}
                  className="h-10 border border-slate-300 rounded-lg px-2.5 text-sm font-medium text-slate-800 bg-white min-w-[10.5rem]"
                >
                  <option value="comfortable">Comfortable rows</option>
                  <option value="compact">Compact rows</option>
                </select>
                <select
                  value={columnPreset}
                  onChange={(e) => setColumnPreset(e.target.value)}
                  className="h-10 border border-slate-300 rounded-lg px-2.5 text-sm font-medium text-slate-800 bg-white min-w-[10.5rem]"
                >
                  <option value="full">All columns</option>
                  <option value="core">Core columns only</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[min(70vh,40rem)] overflow-y-auto custom-scrollbar">
          <>
              <table className={`min-w-full ${density === 'compact' ? 'text-xs [&_th]:py-1.5 [&_td]:py-1.5' : 'text-sm'}`}>
                <thead className="bg-slate-50 border-b sticky top-0 z-10 shadow-[0_1px_0_rgb(226_232_240)]">
                  <tr>
                  {canManagePpmInclusion ? (
                    <th className="px-2 py-2 text-center text-xs font-semibold uppercase text-slate-500 w-[6.5rem]" title="Select asset(s) for batch PPM task creation">
                      <label className="inline-flex items-center gap-1.5 normal-case text-[10px] font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 [accent-color:rgb(var(--accent-color))]"
                          checked={allVisibleSelected}
                          onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                        />
                        <span>PPM ({selectedVisibleCount}/{visibleAssetIds.length})</span>
                      </label>
                    </th>
                  ) : null}
                  <th className="px-3 py-2 text-left">Unique ID</th>
                  <th className="px-3 py-2 text-left">ABS Code</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>Model Number</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>Serial Number</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>QR Code</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>RF ID</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>MAC Address</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>Location</th>
                  <th className="px-3 py-2 text-left">Ticket</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>Manufacturer</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>Maintenance Vendor</th>
                  <th className="px-3 py-2 text-left">VMS</th>
                  <th className="px-3 py-2 text-left">Assigned To</th>
                  <th className="px-3 py-2 text-left">Next service</th>
                  <th
                    className="px-3 py-2 text-left min-w-[11rem] max-w-[18rem]"
                    title="Admin manager notes and manager review comment"
                  >
                    Manager comment
                  </th>
                  <th
                    className="px-3 py-2 text-left min-w-[12rem] max-w-[20rem]"
                    title="Latest technician notes, equipment used, and checklist summary"
                  >
                    Technician details
                  </th>
                  <th className="px-3 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={workOrderColSpan} className="px-3 py-6 text-slate-500">Loading assets…</td></tr>
                  ) : displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={workOrderColSpan} className="px-3 py-6 text-slate-500">
                        {ppmListFilter !== 'all'
                          ? 'No assets match this PPM filter for the current store.'
                          : canManagePpmInclusion && !query.trim()
                            ? 'No assets in the PPM program yet. Use search to find assets, tick checkboxes in the PPM column, then create tasks.'
                            : 'No assets match your search (or this store has no assets yet).'}
                      </td>
                    </tr>
                  ) : displayRows.map((row) => {
                    const a = row.asset || {};
                    const ns = nextServiceMeta(row.open_task, row.last_completed_at);
                    const rid = String(a._id || '');
                    return (
                      <tr
                        key={a._id}
                        className={`border-t hover:bg-slate-50/80 ${rowMatchesSearch(row) ? 'bg-amber-50/60' : ''}`}
                      >
                      {canManagePpmInclusion ? (
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 [accent-color:rgb(var(--accent-color))]"
                            checked={selectedAssetIds.includes(rid)}
                            onChange={(e) => toggleAssetSelection(rid, e.target.checked)}
                            title="Select this asset for Create PPM task"
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-2 font-mono text-xs">
                        {a._id ? (
                          <button
                            type="button"
                            onClick={() => openPpmAssetHistory(a._id)}
                            className="text-indigo-700 hover:text-indigo-900 hover:underline font-medium"
                            title="Open PPM asset history"
                          >
                            {a.uniqueId || '—'}
                          </button>
                        ) : (
                          a.uniqueId || '—'
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{a.abs_code || '—'}</td>
                      <td className="px-3 py-2">{a.name || a.product_name || '—'}</td>
                      <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.model_number || '—'}</td>
                      <td className={`px-3 py-2 font-mono text-xs ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.serial_number || '—'}</td>
                      <td className={`px-3 py-2 font-mono text-xs ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.qr_code || '—'}</td>
                      <td className={`px-3 py-2 font-mono text-xs ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.rfid || '—'}</td>
                      <td className={`px-3 py-2 font-mono text-xs ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.mac_address || '—'}</td>
                      <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.location || '—'}</td>
                      <td className="px-3 py-2">{(a.ticket_number || '').trim() || row.open_task?.work_order_ticket || '—'}</td>
                      <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.manufacturer || '—'}</td>
                      <td className="px-3 py-2">{a.status || '—'}</td>
                      <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.maintenance_vendor || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border ${vmsBadgeClass(row.vms_label)}`}>
                          {row.vms_label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{row.assigned_to_name || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border ${nextBadgeClass(ns.tone)}`}>
                          {ns.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top text-xs min-w-[10rem] max-w-[16rem]">
                        {(() => {
                          const { admin, review } = rowManagerCommentParts(row);
                          const tip = [
                            admin && `Manager notes: ${admin}`,
                            review && `Manager review: ${review}`
                          ].filter(Boolean).join('\n\n');
                          if (!admin && !review) {
                            return <span className="text-slate-400">—</span>;
                          }
                          return (
                            <div className="space-y-1" title={tip || undefined}>
                              {admin ? (
                                <p className="text-slate-800 line-clamp-3 whitespace-pre-wrap break-words">{admin}</p>
                              ) : null}
                              {review ? (
                                <p className="text-slate-600 line-clamp-2 whitespace-pre-wrap break-words border-l-2 border-[rgb(var(--accent-color)/0.5)] pl-2">
                                  <span className="font-semibold text-app-accent">Review: </span>
                                  {review}
                                </p>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 align-top text-xs min-w-[12rem] max-w-[20rem]">
                        {(() => {
                          const { notes: techNotes, equipment, checklistSummary } = rowTechnicianCommentDetails(row);
                          const tip = [
                            techNotes && `Technician notes: ${techNotes}`,
                            equipment.length > 0 && `Equipment: ${equipment.join(', ')}`,
                            checklistSummary.length > 0 && `Checklist: ${checklistSummary.join(' | ')}`
                          ].filter(Boolean).join('\n\n');
                          if (!techNotes && equipment.length === 0 && checklistSummary.length === 0) {
                            return <span className="text-slate-400">—</span>;
                          }
                          return (
                            <div className="space-y-1" title={tip || undefined}>
                              {techNotes ? (
                                <p className="text-slate-700 line-clamp-2 whitespace-pre-wrap break-words border-l-2 border-emerald-200 pl-2">
                                  <span className="font-semibold text-emerald-700">Tech: </span>
                                  {techNotes}
                                </p>
                              ) : null}
                              {equipment.length > 0 ? (
                                <p className="text-slate-600 line-clamp-2 whitespace-pre-wrap break-words">
                                  <span className="font-semibold">Equipment: </span>
                                  {equipment.join(', ')}
                                </p>
                              ) : null}
                              {checklistSummary.length > 0 ? (
                                <p className="text-slate-600 line-clamp-2 whitespace-pre-wrap break-words">
                                  <span className="font-semibold">Checklist: </span>
                                  {checklistSummary.join(' | ')}
                                </p>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {canOpenAssetHistory && a._id ? (
                            <button
                              type="button"
                              onClick={() => openPpmAssetHistory(a._id)}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 inline-flex"
                              title="View PPM history"
                            >
                              <Eye size={16} />
                            </button>
                          ) : null}
                          {canManagePpmInclusion && a._id ? (
                            <button
                              type="button"
                              onClick={() => setPpmInlineEditAssetId(String(a._id))}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 inline-flex"
                              title="Edit asset on this page (name, model, serial, status, vendor, etc.)"
                            >
                              <Pencil size={16} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openChecklist(a._id)}
                            className="p-1.5 rounded-lg border border-[rgb(var(--accent-color)/0.35)] bg-[rgb(var(--accent-color)/0.14)] text-app-accent hover:bg-[rgb(var(--accent-color)/0.22)] disabled:opacity-50"
                            title="PPM checklist"
                          >
                            <Wrench size={16} />
                          </button>
                          {canManagePpmInclusion && !row.open_task ? (
                            <button
                              type="button"
                              onClick={() => prefillCreateFromAsset(a)}
                              className="text-[11px] px-2 py-1 rounded-lg border border-[rgb(var(--accent-color)/0.35)] bg-[rgb(var(--accent-color)/0.14)] text-app-accent hover:bg-[rgb(var(--accent-color)/0.22)]"
                              title="Pre-fill Create PPM task for this asset"
                            >
                              Create task
                            </button>
                          ) : null}
                          {canManagePpmInclusion && row.open_task?._id && openPpmTaskCanCancel(row.open_task) ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => cancelOpenPpmTask(row.open_task._id, a._id)}
                              className="ml-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-app-accent hover:bg-[rgb(var(--accent-color)/0.12)] disabled:opacity-40"
                              title="Delete from PPM list"
                              aria-label="Delete from PPM list"
                            >
                              <span className="h-2.5 w-2.5 rounded-full bg-current shadow-sm ring-1 ring-[rgb(var(--accent-color)/0.45)]" aria-hidden />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-600">
                <span>{(assetMeta.total || displayRows.length).toLocaleString()} total assets</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="px-2 py-1 rounded border border-slate-300 disabled:opacity-50"
                    disabled={loading || assetPage <= 1}
                    onClick={() => setAssetPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span>
                    Page {assetPage} of {Math.max(1, assetMeta.pages || 1)}
                  </span>
                  <button
                    type="button"
                    className="px-2 py-1 rounded border border-slate-300 disabled:opacity-50"
                    disabled={loading || assetPage >= Math.max(1, assetMeta.pages || 1)}
                    onClick={() => setAssetPage((p) => Math.min(Math.max(1, assetMeta.pages || 1), p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
        </div>
      </div>

      {drawerOpen && task && (() => {
        const ppmClosed = ['Completed', 'Not Completed', 'Cancelled'].includes(task.status);
        const canReopenDrawer =
          ['Technician', 'Admin', 'Super Admin'].includes(user?.role) &&
          (['Completed', 'Not Completed'].includes(task.status) ||
            (['Admin', 'Super Admin'].includes(user?.role) && task.status === 'Cancelled'));
        return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
          <div className="w-full max-w-md bg-white h-full shadow-xl flex flex-col border-l border-slate-200">
            <div className="px-4 py-3 border-b flex justify-between items-start gap-2">
              <div>
                <h2 className="font-semibold text-slate-900">PPM maintenance checklist</h2>
                <p className="text-xs text-slate-600 mt-0.5 font-mono">
                  [{task.asset?.abs_code || '—'}] · {assetName(task.asset)}
                </p>
              </div>
              <button type="button" onClick={closeDrawer} className="text-sm text-slate-500 hover:text-slate-800 px-2">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {task.status === 'Not Completed' ? (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
                  <div className="font-semibold">PPM not completed</div>
                  <p className="mt-2 whitespace-pre-wrap text-orange-900">{task.technician_notes || '—'}</p>
                  {task.incomplete_by?.name ? (
                    <p className="text-xs text-orange-800 mt-2">Recorded by {task.incomplete_by.name}</p>
                  ) : null}
                </div>
              ) : null}
              {(task.checklist || []).map((item, idx) => {
                const isVms = item.key === VMS_CHECKLIST_KEY;
                const choices = isVms ? ['Online', 'Offline'] : ['Good', 'Needs Replace', 'No'];
                return (
                  <div key={item.key || idx} className="border border-slate-200 rounded-lg p-2">
                    <div className="text-sm font-medium text-slate-800">{item.label}</div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {choices.map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          disabled={busy || ppmClosed}
                          onClick={() => updateItem(idx, choice)}
                          className={`px-2 py-1 text-xs rounded border ${
                            item.value === choice ? 'bg-amber-300 border-amber-500' : 'bg-white border-slate-300'
                          } disabled:opacity-50`}
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div>
                <div className="text-sm font-medium text-slate-800 mb-2">Equipment used</div>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map((eq) => {
                    const on = (task.equipment_used || []).includes(eq);
                    return (
                      <button
                        key={eq}
                        type="button"
                        disabled={busy || ppmClosed}
                        onClick={() => toggleEquipment(eq)}
                        className={`px-2 py-1 text-xs rounded border ${
                          on ? 'bg-amber-200 border-amber-400' : 'bg-white border-slate-300'
                        } disabled:opacity-50`}
                      >
                        {eq}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-2">
                <div className="text-sm font-semibold text-slate-800">Outcome</div>
                <p className="text-xs text-slate-600">
                  <span className="font-medium text-emerald-800">Complete PPM</span> if the visit is done.
                  If you could not finish, write why below (required), then <span className="font-medium text-orange-800">Not completed</span>.
                </p>
              </div>
              <textarea
                value={task.technician_notes || ''}
                disabled={busy || ppmClosed}
                onChange={(e) => setTask({ ...task, technician_notes: e.target.value })}
                rows={4}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Comments (optional if you complete PPM). If not completed: explain why (min. 8 characters), then tap Not completed."
              />
              <div className="border rounded-lg p-3 bg-slate-50/70">
                <div className="text-sm font-semibold mb-2">Required spare parts for maintenance</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input
                    value={spareForm.item_name}
                    onChange={(e) => setSpareForm((p) => ({ ...p, item_name: e.target.value }))}
                    className="border rounded px-2 py-2 text-sm md:col-span-2"
                    placeholder="Part name"
                  />
                  <input
                    type="number"
                    min={1}
                    value={spareForm.quantity}
                    onChange={(e) => setSpareForm((p) => ({ ...p, quantity: Math.max(1, Number(e.target.value) || 1) }))}
                    className="border rounded px-2 py-2 text-sm"
                    placeholder="Qty"
                  />
                  <button
                    type="button"
                    disabled={spareSubmitting || busy}
                    onClick={submitSpareRequest}
                    className="btn-app-primary-md"
                  >
                    {spareSubmitting ? 'Sending…' : 'Send to admin'}
                  </button>
                </div>
                <textarea
                  value={spareForm.description}
                  onChange={(e) => setSpareForm((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                  className="w-full border rounded px-2 py-2 text-sm mt-2"
                  placeholder="Reason / notes (optional)"
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t flex flex-wrap gap-2 bg-slate-50">
              {!ppmClosed ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={save}
                    className="btn-app-outline-md"
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={complete}
                    className="btn-app-primary-md"
                  >
                    Complete PPM
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={markNotCompleted}
                    className="btn-app-soft text-sm"
                  >
                    Not completed
                  </button>
                  {canManagePpmInclusion ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={cancelTaskDrawer}
                      className="btn-app-outline-md"
                    >
                      Cancel task
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {canReopenDrawer ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={reopenForEditDrawer}
                      className="btn-app-soft text-sm"
                    >
                      Edit checklist
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={closeDrawer}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-100"
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {ppmHistoryOpen ? (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">PPM Asset History</h2>
              <button
                type="button"
                onClick={() => setPpmHistoryOpen(false)}
                className="px-2 py-1 text-sm text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              {ppmHistoryBusy ? <p className="text-sm text-slate-500">Loading history…</p> : null}
              {!ppmHistoryBusy && ppmHistoryError ? <p className="text-sm text-rose-600">{ppmHistoryError}</p> : null}
              {!ppmHistoryBusy && !ppmHistoryError && ppmHistoryData.asset ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                    <div><span className="text-slate-500">UID:</span> {ppmHistoryData.asset.uniqueId || '—'}</div>
                    <div><span className="text-slate-500">ABS:</span> {ppmHistoryData.asset.abs_code || '—'}</div>
                    <div><span className="text-slate-500">Name:</span> {ppmHistoryData.asset.name || '—'}</div>
                    <div><span className="text-slate-500">Model:</span> {ppmHistoryData.asset.model_number || '—'}</div>
                    <div><span className="text-slate-500">Status:</span> {ppmHistoryData.asset.status || '—'}</div>
                    <div><span className="text-slate-500">Ticket:</span> {ppmHistoryData.asset.ticket_number || '—'}</div>
                  </div>
                  <div className="border rounded-lg">
                    <div className="px-3 py-2 border-b bg-slate-50 font-medium text-sm">Required spare parts for maintenance</div>
                    <div className="max-h-52 overflow-auto">
                      {ppmHistoryData.spareRequests.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-slate-500">No spare parts requests found.</p>
                      ) : (
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 border-b">
                            <tr>
                              <th className="px-3 py-2 text-left">Date</th>
                              <th className="px-3 py-2 text-left">Part</th>
                              <th className="px-3 py-2 text-left">Qty</th>
                              <th className="px-3 py-2 text-left">Status</th>
                              <th className="px-3 py-2 text-left">Requested by</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ppmHistoryData.spareRequests.map((r) => (
                              <tr key={r._id} className="border-t">
                                <td className="px-3 py-2 whitespace-nowrap">{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
                                <td className="px-3 py-2">{r.item_name || '—'}</td>
                                <td className="px-3 py-2">{r.quantity || 1}</td>
                                <td className="px-3 py-2">{r.status || '—'}</td>
                                <td className="px-3 py-2">{r.requester?.name || r.requester?.email || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                  <div className="border rounded-lg">
                    <div className="px-3 py-2 border-b bg-slate-50 font-medium text-sm">PPM task history</div>
                    <div className="max-h-72 overflow-auto space-y-3 p-3">
                      {ppmHistoryData.tasks.length === 0 ? (
                        <p className="text-sm text-slate-500">No PPM task history found.</p>
                      ) : ppmHistoryData.tasks.map((t) => (
                        <div key={t._id} className="rounded border border-slate-200 p-3">
                          <p className="text-xs text-slate-500">
                            Task {t._id} | {t.status} | {t.work_order_ticket || 'No ticket'}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Scheduled: {t.scheduled_for ? new Date(t.scheduled_for).toLocaleString() : '—'} | Due: {t.due_at ? new Date(t.due_at).toLocaleString() : '—'}
                          </p>
                          {Array.isArray(t.history) && t.history.length > 0 ? (
                            <div className="mt-2 space-y-1">
                              {[...t.history].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).map((h, idx) => (
                                <p key={`${t._id}-${idx}`} className="text-sm text-slate-700">
                                  {h.at ? new Date(h.at).toLocaleString() : '—'} - {h.action || 'Update'}{h.details ? `: ${h.details}` : ''}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500 mt-2">No timeline entries for this task.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {resetProgramOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ppm-reset-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setResetProgramOpen(false);
              setResetProgramPassword('');
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl p-5 space-y-4"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="ppm-reset-title" className="text-lg font-semibold text-slate-900">
              Reset PPM program?
            </h2>
            <p className="text-sm text-slate-600">
              This applies only to your <strong>active store</strong>. All PPM work orders, import workflow batches,
              import staging rows, and PPM history logs for this store will be permanently deleted. Every in-store asset
              will be removed from the PPM program and import-only flags cleared (you can turn PPM back on per asset
              later). Only <strong>Admin</strong> or <strong>Super Admin</strong> can run this. Enter your{' '}
              <strong>account password</strong> to confirm.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="ppm-reset-password">
                Your password
              </label>
              <input
                id="ppm-reset-password"
                type="password"
                autoComplete="current-password"
                value={resetProgramPassword}
                onChange={(e) => setResetProgramPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !resetProgramBusy) confirmResetPpmProgram();
                }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Password"
              />
            </div>
            <div className="flex flex-wrap gap-2 justify-end pt-2">
              <button
                type="button"
                disabled={resetProgramBusy}
                onClick={() => {
                  setResetProgramOpen(false);
                  setResetProgramPassword('');
                }}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetProgramBusy}
                onClick={confirmResetPpmProgram}
                className="btn-app-primary-md"
              >
                {resetProgramBusy ? 'Resetting…' : 'Reset program'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PpmInlineAssetEditModal
        open={Boolean(ppmInlineEditAssetId)}
        assetId={ppmInlineEditAssetId}
        onClose={() => setPpmInlineEditAssetId(null)}
        onSaved={() => load()}
      />
    </div>
  );
};

export default TechPpmPanel;
