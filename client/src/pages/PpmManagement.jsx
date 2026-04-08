import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const EQUIPMENT_OPTIONS = ['Ladder', 'Scaffold', 'Manlift', 'Rope', 'Safety Harness'];

/** Must match server `VMS_CHECKLIST_KEY` */
const VMS_CHECKLIST_KEY = 'vms_online';

/** Schedule table page size (server allows up to 200). Keeps DOM light for ~10k tasks. */
const SCHEDULE_PAGE_SIZE = 50;

const ppmDownloadFallbackFilename = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `PPM_Report_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.xlsx`;
};

/** Align with server PPM asset search: partial UID / ABS / IP and model fields. */
const assetMatchesPpmSearch = (a, rawKeyword) => {
  const query = String(rawKeyword || '').trim().toLowerCase();
  if (!query) return true;
  const compact = query.replace(/\s+/g, '');
  const uid = String(a?.uniqueId || '').trim().toLowerCase();
  const abs = String(a?.abs_code || '').trim().toLowerCase();
  const ip = String(a?.ip_address || '').trim().toLowerCase().replace(/\s/g, '');
  const serial = String(a?.serial_number || '').trim().toLowerCase();
  const mac = String(a?.mac_address || '').trim().toLowerCase().replace(/\s/g, '');
  const expo = String(a?.expo_tag || a?.expoTag || '').trim().toLowerCase();
  if (uid && (uid.includes(query) || uid.includes(compact))) return true;
  if (abs && (abs.includes(query) || abs.includes(compact))) return true;
  if (ip && (ip.includes(query) || ip.includes(compact))) return true;
  if (serial && (serial.includes(query) || serial.includes(compact))) return true;
  if (mac && (mac.includes(query) || mac.includes(compact))) return true;
  if (expo && (expo.includes(query) || expo.includes(compact))) return true;
  return [a?.name, a?.model_number, a?.product_name, a?.ticket_number]
    .some((v) => String(v || '').toLowerCase().includes(query));
};

const statusTone = (status) => {
  if (status === 'Completed') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (status === 'Overdue') return 'bg-rose-100 text-rose-800 border-rose-200';
  if (status === 'In Progress') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (status === 'Cancelled') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (status === 'Not Completed') return 'bg-orange-100 text-orange-900 border-orange-200';
  if (status === 'No PPM task') return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-blue-100 text-blue-800 border-blue-200';
};

const fmtDate = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString();
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

const PpmManagement = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdminUi = user?.role === 'Admin' || user?.role === 'Super Admin';
  const canReopenClosedPpm =
    user?.role === 'Technician' || user?.role === 'Admin' || user?.role === 'Super Admin';

  const [overview, setOverview] = useState({
    total: 0,
    overdue: 0,
    completed: 0,
    notCompleted: 0,
    open: 0,
    health: 100
  });
  const [rows, setRows] = useState([]);
  const [taskPage, setTaskPage] = useState(1);
  const [taskListMeta, setTaskListMeta] = useState({ total: 0, pages: 1 });
  const [bulkTicket, setBulkTicket] = useState('');
  const [bulkTicketBusy, setBulkTicketBusy] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [techs, setTechs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchAssets, setSearchAssets] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [ppmPickHint, setPpmPickHint] = useState(null);
  const [createAssetSearch, setCreateAssetSearch] = useState('');
  const [createAssetResults, setCreateAssetResults] = useState([]);
  const [createAssetPickLoading, setCreateAssetPickLoading] = useState(false);
  const [createAssetMenuOpen, setCreateAssetMenuOpen] = useState(false);
  const createPickerRef = useRef(null);
  const [form, setForm] = useState({
    asset_id: '',
    assigned_to: '',
    scheduled_for: '',
    due_at: '',
    manager_notes: '',
    work_order_ticket: ''
  });
  const [exportBusy, setExportBusy] = useState(false);
  const [resetProgramOpen, setResetProgramOpen] = useState(false);
  const [resetProgramPassword, setResetProgramPassword] = useState('');
  const [resetProgramBusy, setResetProgramBusy] = useState(false);
  const loadGenRef = useRef(0);
  const spareReqInit = { item_name: '', quantity: 1, description: '' };
  const [spareReq, setSpareReq] = useState(spareReqInit);
  const [spareReqBusy, setSpareReqBusy] = useState(false);
  const [density, setDensity] = useState('comfortable');
  const [columnPreset, setColumnPreset] = useState('full');

  const resetCreateAssetPickerUi = () => {
    setCreateAssetSearch('');
    setCreateAssetResults([]);
    setCreateAssetMenuOpen(false);
    setPpmPickHint(null);
  };

  const clearCreateAssetSelection = () => {
    setForm((f) => ({ ...f, asset_id: '' }));
    resetCreateAssetPickerUi();
  };

  const showReopenChecklistButton =
    Boolean(selected) &&
    canReopenClosedPpm &&
    (['Completed', 'Not Completed'].includes(selected.status) ||
      (isAdminUi && selected.status === 'Cancelled'));
  const checklistFieldsLocked =
    Boolean(selected) && ['Completed', 'Cancelled', 'Not Completed'].includes(selected.status);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      setLoading(true);
      const listParams = {
        page: taskPage,
        limit: SCHEDULE_PAGE_SIZE,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(q.trim() ? { q: q.trim() } : {})
      };
      const [o, listRes] = await Promise.all([
        api.get('/ppm/overview'),
        api.get('/ppm', { params: listParams })
      ]);
      if (gen !== loadGenRef.current) return;
      setOverview(o.data || { total: 0, overdue: 0, completed: 0, notCompleted: 0, open: 0, health: 100 });
      const payload = listRes.data;
      const items = Array.isArray(payload) ? payload : (payload?.items || []);
      const total = Array.isArray(payload) ? items.length : Number(payload?.total ?? items.length ?? 0);
      const derivedPageCount =
        total > 0 ? Math.max(1, Math.ceil(total / SCHEDULE_PAGE_SIZE)) : 1;
      const pages = Array.isArray(payload)
        ? 1
        : Math.max(1, Number(payload?.pages ?? derivedPageCount));
      const serverPage = Array.isArray(payload) ? taskPage : Number(payload?.page ?? taskPage);
      setRows(items);
      setTaskListMeta({ total, pages });
      if (!Array.isArray(payload) && serverPage !== taskPage) {
        setTaskPage(serverPage);
      }
      if (isAdminUi) {
        try {
          const u = await api.get('/users');
          const techRows = (Array.isArray(u.data) ? u.data : []).filter((x) => x.role === 'Technician');
          if (gen !== loadGenRef.current) return;
          setTechs(techRows);
        } catch {
          if (gen !== loadGenRef.current) return;
          setTechs([]);
        }
      } else {
        setTechs([]);
      }
      if (gen === loadGenRef.current) {
        setSelected((prev) => {
          if (!prev) return null;
          const found = items.find((r) => r._id === prev._id);
          return found || prev;
        });
      }
    } catch (error) {
      if (gen !== loadGenRef.current) return;
      alert(error.response?.data?.message || 'Failed to load PPM Management data');
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [isAdminUi, taskPage, statusFilter, q]);

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
      setSelected(null);
      clearCreateAssetSelection();
      await load();
      const n = data?.deletedTasks ?? 0;
      const a = data?.assetsPpmCleared ?? 0;
      alert(`PPM program reset for this store. Removed ${n} task(s) and cleared PPM flags on ${a} asset(s).`);
    } catch (error) {
      alert(error.response?.data?.message || 'Could not reset PPM program');
    } finally {
      setResetProgramBusy(false);
    }
  };

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

  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, q.trim() ? 320 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    if (!q.trim()) setPpmPickHint(null);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    const qt = q.trim();
    if (!qt) {
      setSearchAssets([]);
      setSearchLoading(false);
      return undefined;
    }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/assets', { params: { q: qt, limit: 500, page: 1 } });
        if (cancelled) return;
        setSearchAssets(assetListFromResponse(res.data));
      } catch {
        if (!cancelled) setSearchAssets([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

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

  /** Task rows are already filtered/paginated on the server; merge asset-only matches when searching. */
  const displayRows = useMemo(() => {
    const qt = q.trim();
    const taskPart = rows.map((task) => ({ kind: 'task', task }));
    if (!qt) return taskPart;

    const seenAsset = new Set(
      rows.map((r) => (r.asset?._id ? String(r.asset._id) : '')).filter(Boolean)
    );
    const extras = [];
    let extraCap = 0;
    for (const a of searchAssets) {
      if (extraCap >= 100) break;
      const id = a?._id ? String(a._id) : '';
      if (!id || seenAsset.has(id)) continue;
      if (assetMatchesPpmSearch(a, qt)) {
        extras.push({ kind: 'asset', asset: a });
        seenAsset.add(id);
        extraCap += 1;
      }
    }
    return [...taskPart, ...extras];
  }, [rows, searchAssets, q]);

  const createSelectedPreview = useMemo(() => {
    if (!form.asset_id) return null;
    const id = String(form.asset_id);
    if (ppmPickHint && String(ppmPickHint._id) === id) return ppmPickHint;
    return createAssetResults.find((a) => String(a._id) === id) || null;
  }, [form.asset_id, ppmPickHint, createAssetResults]);

  const createTask = async () => {
    if (!form.asset_id) {
      alert('Please select an asset.');
      return;
    }
    if (!String(form.work_order_ticket || '').trim()) {
      alert('Work order ticket number is required.');
      return;
    }
    try {
      setCreating(true);
      await api.post('/ppm', {
        ...form,
        scheduled_for: form.scheduled_for || new Date().toISOString()
      });
      setForm({ asset_id: '', assigned_to: '', scheduled_for: '', due_at: '', manager_notes: '', work_order_ticket: '' });
      resetCreateAssetPickerUi();
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to create PPM task');
    } finally {
      setCreating(false);
    }
  };

  const visibleTaskIds = useMemo(
    () => displayRows.filter((r) => r.kind === 'task').map((r) => String(r.task?._id || '')).filter(Boolean),
    [displayRows]
  );
  const allVisibleTasksSelected = visibleTaskIds.length > 0 && visibleTaskIds.every((id) => selectedTaskIds.includes(id));

  const applyBulkWorkOrderTicket = async () => {
    const ticket = String(bulkTicket || '').trim();
    if (!ticket) return alert('Enter work order ticket number first.');
    if (selectedTaskIds.length === 0) return alert('Select at least one task row.');
    try {
      setBulkTicketBusy(true);
      const res = await api.patch('/ppm/bulk-work-order-ticket', {
        task_ids: selectedTaskIds,
        work_order_ticket: ticket
      });
      await load();
      alert(`Updated ${res?.data?.modified || 0} task(s) with ticket "${ticket}".`);
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to apply bulk ticket');
    } finally {
      setBulkTicketBusy(false);
    }
  };

  const submitSpareRequest = async () => {
    if (!selected?._id || !selected?.asset?._id) return;
    const itemName = String(spareReq.item_name || '').trim();
    const qty = Math.max(1, Number(spareReq.quantity) || 1);
    const desc = String(spareReq.description || '').trim();
    if (!itemName) return alert('Enter spare part name.');
    try {
      setSpareReqBusy(true);
      await api.post('/requests', {
        item_name: itemName,
        quantity: qty,
        description: `PPM spare request\nTask: ${selected._id}\nAsset UID: ${selected.asset?.uniqueId || 'N/A'}\nAsset ABS: ${selected.asset?.abs_code || 'N/A'}\n${desc}`.trim(),
        request_type: 'PPM Spare Parts',
        ppm_task: selected._id,
        asset: selected.asset._id
      });
      setSpareReq(spareReqInit);
      alert('Spare parts request sent to admin.');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to send spare parts request');
    } finally {
      setSpareReqBusy(false);
    }
  };

  const updateChecklistValue = (idx, value) => {
    if (!selected) return;
    const checklist = Array.isArray(selected.checklist) ? [...selected.checklist] : [];
    checklist[idx] = { ...checklist[idx], value };
    setSelected({ ...selected, checklist });
  };

  const updateChecklistNote = (idx, notes) => {
    if (!selected) return;
    const checklist = Array.isArray(selected.checklist) ? [...selected.checklist] : [];
    checklist[idx] = { ...checklist[idx], notes };
    setSelected({ ...selected, checklist });
  };

  const submitChecklist = async () => {
    if (!selected?._id) return;
    try {
      setBusy(true);
      await api.patch(`/ppm/${selected._id}/submit`, {
        checklist: selected.checklist || [],
        equipment_used: selected.equipment_used || [],
        technician_notes: selected.technician_notes || ''
      });
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to submit checklist');
    } finally {
      setBusy(false);
    }
  };

  const completeTask = async () => {
    if (!selected?._id) return;
    try {
      setBusy(true);
      await api.patch(`/ppm/${selected._id}/complete`, {
        checklist: selected.checklist || [],
        equipment_used: selected.equipment_used || [],
        technician_notes: selected.technician_notes || ''
      });
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to complete task');
    } finally {
      setBusy(false);
    }
  };

  const reopenForEdit = async () => {
    if (!selected?._id) return;
    if (
      !window.confirm(
        'Reopen this PPM for editing? It will return to In Progress so you can update the checklist and save or mark complete again.'
      )
    ) {
      return;
    }
    try {
      setBusy(true);
      await api.patch(`/ppm/${selected._id}/reopen-for-edit`);
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Could not reopen PPM for editing');
    } finally {
      setBusy(false);
    }
  };

  const cancelTask = async () => {
    if (!selected?._id) return;
    try {
      setBusy(true);
      await api.patch(`/ppm/${selected._id}/cancel`, { reason: 'Cancelled from PPM management' });
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to cancel task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">PPM Management — 180-day overview</h1>
      <div className="flex items-center gap-2 text-sm">
        <Link to="/ppm" className="px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-900 font-medium">Schedule</Link>
        <Link to="/ppm/panel" className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">Work Orders</Link>
      </div>

      {user?.role === 'Technician' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Run maintenance on any in-store asset without waiting for assignment — open{' '}
          <Link className="font-semibold underline" to="/ppm/panel">Work Orders</Link>
          {' '}and use the wrench on a row.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="text-xs uppercase text-slate-500">PPM Coverage</div>
          <div className="text-3xl font-bold text-emerald-700 mt-2">{overview.health}%</div>
          <div className="text-xs text-slate-600 mt-1">Completed ÷ assets in PPM program</div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="text-xs uppercase text-slate-500">Overdue PPMs</div>
          <div className="text-3xl font-bold text-rose-700 mt-2">{overview.overdue}</div>
          <div className="text-xs text-slate-600 mt-1">Need immediate action</div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="text-xs uppercase text-slate-500">Completed PPMs</div>
          <div className="text-3xl font-bold text-emerald-700 mt-2">{overview.completed}</div>
          <div className="text-xs text-slate-600 mt-1">Verified maintenance</div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="text-xs uppercase text-slate-500">Not completed</div>
          <div className="text-3xl font-bold text-orange-700 mt-2">{overview.notCompleted ?? 0}</div>
          <div className="text-xs text-slate-600 mt-1">Technician left a reason</div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow-sm sm:col-span-2 lg:col-span-1">
          <div className="text-xs uppercase text-slate-500">In PPM program</div>
          <div className="text-3xl font-bold text-slate-900 mt-2">{overview.total}</div>
          <div className="text-xs text-slate-600 mt-1">Flagged for PPM or has a schedule task in this store</div>
        </div>
      </div>

      {isAdminUi && (
        <div className="bg-white border rounded-xl p-4 shadow-sm grid grid-cols-1 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 min-w-0 relative" ref={createPickerRef}>
            <label className="block text-xs font-medium text-slate-500 mb-1">Asset for new PPM task</label>
            <div className="flex gap-1">
              <input
                value={createAssetSearch}
                onChange={(e) => {
                  setCreateAssetSearch(e.target.value);
                  setForm((f) => ({ ...f, asset_id: '' }));
                  setCreateAssetMenuOpen(true);
                }}
                onFocus={() => setCreateAssetMenuOpen(true)}
                className="border rounded-lg px-3 py-2 text-sm w-full min-w-0"
                placeholder="Type UID, ABS, serial, IP, MAC, model…"
                autoComplete="off"
                title="Searches the same way as Assets — pick a row to assign this PPM."
              />
              {form.asset_id ? (
                <button
                  type="button"
                  className="shrink-0 px-2 py-2 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
                  title="Remove selected asset"
                  onClick={clearCreateAssetSelection}
                >
                  Remove
                </button>
              ) : null}
            </div>
            {form.asset_id ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-[11px] text-emerald-800 font-medium">
                  Selected for create — choose dates and click Create PPM Task.
                </p>
                <span className="inline-flex items-center gap-1 max-w-full rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-0.5 text-[11px] text-emerald-900">
                  <span className="truncate min-w-0">
                    {createSelectedPreview ? formatCreateAssetShortLabel(createSelectedPreview) : 'Asset selected'}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded px-1 leading-none text-emerald-800 hover:bg-emerald-100"
                    title="Remove this asset"
                    aria-label="Remove selected asset"
                    onClick={clearCreateAssetSelection}
                  >
                    ×
                  </button>
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 mt-1">
                Results match your active store. You can also click a row in the table below to pre-fill this field.
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
                      className="w-full text-left px-3 py-2 text-xs border-b border-slate-100 last:border-0 hover:bg-indigo-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setForm((f) => ({ ...f, asset_id: String(a._id) }));
                        setCreateAssetSearch(formatCreateAssetLabel(a));
                        setCreateAssetMenuOpen(false);
                      }}
                    >
                      <div className="font-medium text-slate-800 truncate">{formatCreateAssetLabel(a)}</div>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Assign Technician (optional)</option>
            {techs.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>
          <input type="date" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" title="Scheduled for (optional)" />
          <input type="date" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" title="Due date (optional — defaults to ~180 days)" />
          <input
            value={form.work_order_ticket}
            onChange={(e) => setForm({ ...form, work_order_ticket: e.target.value })}
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="Work order ticket number (required)"
            title="Work order ticket number (required)"
          />
          <button disabled={creating} onClick={createTask} className="rounded-lg bg-indigo-600 text-white px-3 py-2 text-sm hover:bg-indigo-700 disabled:opacity-50">
            {creating ? 'Creating...' : 'Create PPM Task'}
          </button>
          <input
            value={form.manager_notes}
            onChange={(e) => setForm({ ...form, manager_notes: e.target.value })}
            className="lg:col-span-6 border rounded-lg px-3 py-2 text-sm"
            placeholder="Manager notes (optional)"
          />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <input
                value={q}
                onChange={(e) => {
                  setTaskPage(1);
                  setQ(e.target.value);
                }}
                placeholder="Search by Unique ID, ABS code, IP, serial, model…"
                className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[220px]"
              />
              <select
                value={statusFilter}
                onChange={(e) => {
                  setTaskPage(1);
                  setStatusFilter(e.target.value);
                }}
                className="border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">All status</option>
                <option value="Scheduled">Scheduled</option>
                <option value="In Progress">In Progress</option>
                <option value="Overdue">Overdue</option>
                <option value="Completed">Completed</option>
                <option value="Not Completed">Not completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              <button
                type="button"
                onClick={() => load()}
                className="text-sm px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 shrink-0"
              >
                Refresh
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={density} onChange={(e) => setDensity(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
              <select value={columnPreset} onChange={(e) => setColumnPreset(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
                <option value="full">Full columns</option>
                <option value="core">Core columns</option>
              </select>
              {isAdminUi ? (
                <>
                  <input
                    value={bulkTicket}
                    onChange={(e) => setBulkTicket(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                    placeholder="Bulk ticket number"
                    title="Apply one ticket to selected task rows"
                  />
                  <button
                    type="button"
                    disabled={bulkTicketBusy}
                    onClick={applyBulkWorkOrderTicket}
                    className="text-sm px-3 py-2 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-900 hover:bg-indigo-100 disabled:opacity-50"
                  >
                    {bulkTicketBusy ? 'Applying…' : 'Apply to selected'}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                disabled={exportBusy}
                onClick={downloadPpmExcel}
                className="text-sm px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 shrink-0"
                title="Each export uses a new file name (date and time) so downloads are not overwritten."
              >
                {exportBusy ? 'Preparing…' : 'Download Excel'}
              </button>
              {isAdminUi ? (
                <button
                  type="button"
                  onClick={() => {
                    setResetProgramPassword('');
                    setResetProgramOpen(true);
                  }}
                  className="text-sm px-3 py-2 rounded-lg border border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100 shrink-0"
                  title="Deletes all PPM tasks for this store and removes all assets from the PPM program. Requires your password."
                >
                  Reset PPM program
                </button>
              ) : null}
            </div>
            {q.trim() ? (
              <span className="text-xs text-slate-500 block">While searching, all task statuses are shown; clear the box to use the status filter.</span>
            ) : null}
          </div>
          <div className="overflow-x-auto max-h-[min(70vh,40rem)] overflow-y-auto">
            <table className={`min-w-full ${density === 'compact' ? 'text-xs [&_th]:py-1.5 [&_td]:py-1.5' : 'text-sm'}`}>
              <thead className="bg-slate-50 border-b sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allVisibleTasksSelected}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedTaskIds(visibleTaskIds);
                        else setSelectedTaskIds([]);
                      }}
                      title="Select all visible tasks"
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Unique ID</th>
                  <th className="px-3 py-2 text-left">ABS Code</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>Model Number</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>Serial Number</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>MAC Address</th>
                  <th className="px-3 py-2 text-left">Ticket</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>Manufacturer</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className={`px-3 py-2 text-left ${columnPreset === 'core' ? 'hidden' : ''}`}>Maintenance Vendor</th>
                  <th className="px-3 py-2 text-left">Next Service</th>
                  <th className="px-3 py-2 text-left">Assigned To</th>
                  <th className="px-3 py-2 text-left max-w-[200px]">Technician comment</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={14} className="px-3 py-4 text-slate-500">Loading...</td></tr>
                ) : displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-3 py-4 text-slate-500">
                      {q.trim()
                        ? searchLoading
                          ? 'Searching assets…'
                          : 'No PPM tasks or assets match your search.'
                        : 'No PPM tasks yet. Search by Unique ID, ABS, or IP to find an asset, or create a task above.'}
                    </td>
                  </tr>
                ) : (
                  displayRows.map((row) => {
                    if (row.kind === 'task') {
                      const r = row.task;
                      return (
                        <tr
                          key={r._id}
                          className={`border-t cursor-pointer hover:bg-slate-50 ${selected?._id === r._id ? 'bg-indigo-50' : ''}`}
                          onClick={() => {
                            setPpmPickHint(null);
                            setSelected(r);
                          }}
                        >
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={selectedTaskIds.includes(String(r._id))}
                              onChange={(e) => {
                                const id = String(r._id);
                                setSelectedTaskIds((prev) => (
                                  e.target.checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)
                                ));
                              }}
                              onClick={(e) => e.stopPropagation()}
                              title="Select task for bulk ticket update"
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{r.asset?.uniqueId || '-'}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.asset?.abs_code || '-'}</td>
                          <td className="px-3 py-2">{r.asset?.name || r.asset?.product_name || '-'}</td>
                          <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{r.asset?.model_number || '-'}</td>
                          <td className={`px-3 py-2 font-mono text-xs ${columnPreset === 'core' ? 'hidden' : ''}`}>{r.asset?.serial_number || '-'}</td>
                          <td className={`px-3 py-2 font-mono text-xs ${columnPreset === 'core' ? 'hidden' : ''}`}>{r.asset?.mac_address || '-'}</td>
                          <td className="px-3 py-2">{r.work_order_ticket || r.asset?.ticket_number || '-'}</td>
                          <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{r.asset?.manufacturer || '-'}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex border rounded-full px-2 py-0.5 text-xs ${statusTone(r.status)}`}>{r.status}</span>
                          </td>
                          <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{r.asset?.maintenance_vendor || '-'}</td>
                          <td className="px-3 py-2">{fmtDate(r.due_at)}</td>
                          <td className="px-3 py-2">{r.assigned_to?.name || '-'}</td>
                          <td className="px-3 py-2 text-xs text-slate-600 max-w-[220px] align-top whitespace-pre-wrap break-words">
                            {r.status === 'Not Completed' && r.technician_notes
                              ? r.technician_notes
                              : r.technician_notes
                                ? String(r.technician_notes).slice(0, 120) + (String(r.technician_notes).length > 120 ? '…' : '')
                                : '—'}
                          </td>
                        </tr>
                      );
                    }
                    const a = row.asset;
                    const pick = () => {
                      setSelected(null);
                      if (isAdminUi) {
                        setPpmPickHint(a);
                        setForm((f) => ({ ...f, asset_id: String(a._id) }));
                        setCreateAssetSearch(formatCreateAssetLabel(a));
                        setCreateAssetMenuOpen(false);
                      } else {
                        const needle = String(a.uniqueId || a.abs_code || a.ip_address || q.trim() || '').trim();
                        navigate({ pathname: '/ppm/panel', search: needle ? `?q=${encodeURIComponent(needle)}` : '' });
                      }
                    };
                    return (
                      <tr
                        key={`asset-${a._id}`}
                        className="border-t cursor-pointer hover:bg-slate-50 bg-slate-50/40"
                        onClick={pick}
                        title={isAdminUi ? 'No PPM task yet — click to pre-select for Create PPM Task' : 'Open Work Orders with this asset in search'}
                      >
                        <td className="px-2 py-2">—</td>
                        <td className="px-3 py-2 font-mono text-xs">{a.uniqueId || '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{a.abs_code || '-'}</td>
                        <td className="px-3 py-2">{a.name || a.product_name || '-'}</td>
                        <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.model_number || '-'}</td>
                        <td className={`px-3 py-2 font-mono text-xs ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.serial_number || '-'}</td>
                        <td className={`px-3 py-2 font-mono text-xs ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.mac_address || '-'}</td>
                        <td className="px-3 py-2">{a.ticket_number || '-'}</td>
                        <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.manufacturer || '-'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex border rounded-full px-2 py-0.5 text-xs ${statusTone('No PPM task')}`}>No PPM task</span>
                        </td>
                        <td className={`px-3 py-2 ${columnPreset === 'core' ? 'hidden' : ''}`}>{a.maintenance_vendor || '-'}</td>
                        <td className="px-3 py-2">—</td>
                        <td className="px-3 py-2">—</td>
                        <td className="px-3 py-2">—</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {taskListMeta.pages > 1 ? (
            <div className="px-4 py-2 border-t flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 bg-slate-50/90">
              <span>
                Showing{' '}
                <span className="font-medium tabular-nums">
                  {taskListMeta.total === 0
                    ? 0
                    : `${(taskPage - 1) * SCHEDULE_PAGE_SIZE + 1}–${Math.min(taskPage * SCHEDULE_PAGE_SIZE, taskListMeta.total)}`}
                </span>
                {' '}of <span className="font-medium tabular-nums">{taskListMeta.total}</span> tasks
                {q.trim() ? ' (search; up to 10k scanned)' : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loading || taskPage <= 1}
                  onClick={() => setTaskPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="tabular-nums text-slate-700">
                  Page {taskPage} / {taskListMeta.pages}
                </span>
                <button
                  type="button"
                  disabled={loading || taskPage >= taskListMeta.pages}
                  onClick={() => setTaskPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          ) : taskListMeta.total > 0 ? (
            <div className="px-4 py-2 border-t text-xs text-slate-500 bg-slate-50/50">
              {taskListMeta.total} task{taskListMeta.total !== 1 ? 's' : ''} · {SCHEDULE_PAGE_SIZE} per page
            </div>
          ) : null}
        </div>

        <div className="bg-white border rounded-xl shadow-sm p-4 lg:sticky lg:top-4 lg:self-start min-h-0 max-h-[calc(100vh-5rem)] overflow-y-auto min-w-0">
          {!selected && ppmPickHint && isAdminUi ? (
            <div className="space-y-2 text-sm">
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-950">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">Asset matched (no PPM task yet)</div>
                  <button
                    type="button"
                    className="shrink-0 text-xs rounded-md border border-indigo-300 px-2 py-0.5 text-indigo-900 hover:bg-indigo-100"
                    title="Remove this asset from the create form"
                    onClick={clearCreateAssetSelection}
                  >
                    Remove
                  </button>
                </div>
                <div className="text-xs mt-1 font-mono">
                  UID {ppmPickHint.uniqueId || '—'} · ABS {ppmPickHint.abs_code || '—'} · IP {ppmPickHint.ip_address || '—'}
                </div>
                <div className="text-xs mt-1">
                  This asset is pre-selected in <span className="font-medium">Create PPM Task</span>. Set dates and click Create, or pick another row.
                </div>
              </div>
            </div>
          ) : null}
          {!selected && (!ppmPickHint || !isAdminUi) ? (
            <div className="text-sm text-slate-500">
              Select a task to open the maintenance checklist. Type Unique ID, ABS, or IP in the search box to list matching assets (including those without a task yet).
            </div>
          ) : null}
          {selected ? (
            <div className="min-h-0 flex flex-col gap-3">
              <h3 className="text-lg font-semibold shrink-0">PPM maintenance checklist</h3>
              <div className="text-xs text-slate-600 shrink-0">
                [{selected.asset?.abs_code || '-'}] · {selected.asset?.name || selected.asset?.model_number || 'Asset'}
              </div>
              {selected.status === 'Not Completed' ? (
                <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-950">
                  <div className="font-semibold">Technician: PPM not completed</div>
                  <p className="mt-1 whitespace-pre-wrap text-orange-900">{selected.technician_notes || '—'}</p>
                  {selected.incomplete_by?.name ? (
                    <p className="text-xs text-orange-800 mt-1">Recorded by {selected.incomplete_by.name}</p>
                  ) : null}
                </div>
              ) : null}
              <div className="max-h-[38vh] overflow-y-auto pr-1 space-y-2">
                {(selected.checklist || []).map((item, idx) => {
                  const isVms = item.key === VMS_CHECKLIST_KEY;
                  const choices = isVms ? ['Online', 'Offline'] : ['Good', 'Needs Replace', 'No'];
                  return (
                    <div key={item.key || idx} className="border rounded-lg p-2">
                      <div className="text-sm font-medium mb-1">{item.label}</div>
                      <div className="flex gap-2 flex-wrap">
                        {choices.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            disabled={busy || checklistFieldsLocked}
                            onClick={() => updateChecklistValue(idx, choice)}
                            className={`px-2 py-1 text-xs border rounded ${item.value === choice ? 'bg-amber-300 border-amber-400' : 'bg-white border-slate-300'} disabled:opacity-50`}
                          >
                            {choice}
                          </button>
                        ))}
                      </div>
                      <input
                        value={item.notes || ''}
                        disabled={busy || checklistFieldsLocked}
                        onChange={(e) => updateChecklistNote(idx, e.target.value)}
                        className="mt-2 w-full border rounded px-2 py-1 text-xs"
                        placeholder="Optional notes"
                      />
                    </div>
                  );
                })}
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Equipment Used</div>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map((eq) => {
                    const active = (selected.equipment_used || []).includes(eq);
                    return (
                      <button
                        key={eq}
                        type="button"
                        disabled={busy || checklistFieldsLocked}
                        onClick={() => {
                          const current = new Set(selected.equipment_used || []);
                          if (current.has(eq)) current.delete(eq); else current.add(eq);
                          setSelected({ ...selected, equipment_used: Array.from(current) });
                        }}
                        className={`px-2 py-1 text-xs border rounded ${active ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'bg-white border-slate-300'} disabled:opacity-50`}
                      >
                        {eq}
                      </button>
                    );
                  })}
                </div>
              </div>
              <textarea
                value={selected.technician_notes || ''}
                disabled={busy || checklistFieldsLocked}
                onChange={(e) => setSelected({ ...selected, technician_notes: e.target.value })}
                className="w-full border rounded px-2 py-2 text-sm"
                placeholder="Technician notes"
                rows={3}
              />
              <div className="border rounded-lg p-3 bg-slate-50/70">
                <div className="text-sm font-semibold mb-2">Required spare parts for maintenance</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input
                    value={spareReq.item_name}
                    onChange={(e) => setSpareReq((p) => ({ ...p, item_name: e.target.value }))}
                    className="border rounded px-2 py-2 text-sm md:col-span-2"
                    placeholder="Part name"
                  />
                  <input
                    type="number"
                    min={1}
                    value={spareReq.quantity}
                    onChange={(e) => setSpareReq((p) => ({ ...p, quantity: Math.max(1, Number(e.target.value) || 1) }))}
                    className="border rounded px-2 py-2 text-sm"
                    placeholder="Qty"
                  />
                  <button
                    type="button"
                    disabled={spareReqBusy || busy}
                    onClick={submitSpareRequest}
                    className="px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {spareReqBusy ? 'Sending…' : 'Send to admin'}
                  </button>
                </div>
                <textarea
                  value={spareReq.description}
                  onChange={(e) => setSpareReq((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                  className="w-full border rounded px-2 py-2 text-sm mt-2"
                  placeholder="Reason / notes (optional)"
                />
              </div>
              <div className="sticky bottom-0 bg-white pt-2 border-t flex flex-wrap gap-2">
                {showReopenChecklistButton ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={reopenForEdit}
                    className="px-3 py-2 rounded bg-amber-600 text-white text-sm hover:bg-amber-700 disabled:opacity-50"
                  >
                    Edit checklist
                  </button>
                ) : null}
                <button disabled={busy || checklistFieldsLocked} onClick={submitChecklist} className="px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50">
                  Save Checklist
                </button>
                <button disabled={busy || checklistFieldsLocked} onClick={completeTask} className="px-3 py-2 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50">
                  Mark Complete
                </button>
                {isAdminUi ? (
                  <button disabled={busy || checklistFieldsLocked} onClick={cancelTask} className="px-3 py-2 rounded bg-rose-600 text-white text-sm hover:bg-rose-700 disabled:opacity-50">
                    Cancel
                  </button>
                ) : null}
              </div>
              <div className="pt-2 border-t">
                <div className="text-sm font-semibold mb-1">History</div>
                <div className="max-h-48 overflow-auto space-y-1 text-xs">
                  {(selected.history || []).length === 0 ? (
                    <div className="text-slate-500">No history yet.</div>
                  ) : (selected.history || []).slice().reverse().map((h, i) => (
                    <div key={`${h.at || h.date || ''}-${i}`} className="border rounded px-2 py-1">
                      <div className="font-medium">{h.action}</div>
                      <div className="text-slate-600">{h.user || '-'} · {fmtDate(h.at || h.date)}</div>
                      {h.details ? <div className="text-slate-700 mt-0.5">{h.details}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {resetProgramOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
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
              This applies only to your <strong>active store</strong>. All PPM tasks for this store will be permanently
              deleted, and every in-store asset will be removed from the PPM program (you can turn PPM back on per asset
              later). Enter your <strong>account password</strong> to confirm.
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
                className="w-full border rounded-lg px-3 py-2 text-sm"
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
                className="px-3 py-2 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {resetProgramBusy ? 'Resetting…' : 'Reset program'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PpmManagement;
