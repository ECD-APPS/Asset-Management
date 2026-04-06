import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Pencil, Wrench } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const EQUIPMENT_OPTIONS = ['Ladder', 'Scaffold', 'Manlift', 'Rope'];

/** Must match server `PPM_CYCLE_MS` (180-day PPM cycle). */
const PPM_CYCLE_MS = 180 * 24 * 60 * 60 * 1000;

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

const UNHEALTHY_CONDITIONS = new Set(['faulty', 'workshop', 'under repair/workshop']);

const isAssetUnhealthy = (condition) => UNHEALTHY_CONDITIONS.has(String(condition || '').trim().toLowerCase());

/** Must match server `VMS_CHECKLIST_KEY` */
const VMS_CHECKLIST_KEY = 'vms_online';

const TechPpmPanel = () => {
  const { user } = useAuth();
  const canOpenAssetHistory = user?.role === 'Admin' || user?.role === 'Super Admin' || user?.role === 'Viewer';
  const canEditAsset = user?.role === 'Admin' || user?.role === 'Super Admin';
  const canManagePpmInclusion = user?.role === 'Admin' || user?.role === 'Super Admin';

  const [rows, setRows] = useState([]);
  const [overview, setOverview] = useState({ total: 0, overdue: 0, completed: 0, notCompleted: 0, health: 100 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [task, setTask] = useState(null);
  const [showIncompleteList, setShowIncompleteList] = useState(false);
  const [incompleteTasks, setIncompleteTasks] = useState([]);
  const [incompleteLoading, setIncompleteLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [ppmSavingId, setPpmSavingId] = useState(null);
  const assetsLoadGen = useRef(0);
  const incompleteLoadGen = useRef(0);
  const workOrderColSpan = canManagePpmInclusion ? 10 : 9;

  const load = useCallback(async () => {
    const gen = ++assetsLoadGen.current;
    try {
      setLoading(true);
      const [assetsRes, ovRes] = await Promise.all([
        api.get('/ppm/self-service-assets', {
          params: { q: query.trim() || undefined }
        }),
        api.get('/ppm/overview')
      ]);
      if (gen !== assetsLoadGen.current) return;
      setRows(Array.isArray(assetsRes.data) ? assetsRes.data : []);
      setOverview(ovRes.data || { total: 0, overdue: 0, completed: 0, notCompleted: 0, health: 100 });
    } catch (error) {
      if (gen !== assetsLoadGen.current) return;
      alert(error.response?.data?.message || 'Failed to load PPM data');
    } finally {
      if (gen === assetsLoadGen.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, 300);
    return () => clearTimeout(t);
  }, [load]);

  const loadIncomplete = useCallback(async () => {
    const gen = ++incompleteLoadGen.current;
    try {
      setIncompleteLoading(true);
      const res = await api.get('/ppm', { params: { status: 'Not Completed', limit: 500 } });
      if (gen !== incompleteLoadGen.current) return;
      setIncompleteTasks(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      if (gen !== incompleteLoadGen.current) return;
      alert(error.response?.data?.message || 'Failed to load not-completed PPMs');
    } finally {
      if (gen === incompleteLoadGen.current) setIncompleteLoading(false);
    }
  }, []);

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
      const match = dispo && /filename="?([^";]+)"?/i.exec(dispo);
      const name = match ? match[1].trim() : `PPM_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    if (showIncompleteList) loadIncomplete();
  }, [showIncompleteList, loadIncomplete]);

  const pieData = useMemo(() => {
    const completed = overview.completed || 0;
    const notCompleted = overview.notCompleted || 0;
    const open = Math.max(0, (overview.total || 0) - completed - notCompleted);
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
  const completedPct = taskTotal > 0 ? Math.round((completedCount / taskTotal) * 100) : 0;

  const systemHealthPct = useMemo(() => {
    if (!rows.length) return overview.health ?? 100;
    const unhealthy = rows.filter((r) => isAssetUnhealthy(r.asset?.condition)).length;
    return Math.round(((rows.length - unhealthy) / rows.length) * 100);
  }, [rows, overview.health]);

  const allRowIds = useMemo(() => rows.map((r) => String(r.asset?._id)).filter(Boolean), [rows]);
  const allSelected = allRowIds.length > 0 && allRowIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allRowIds));
    }
  };

  const toggleSelectRow = (id) => {
    const sid = String(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

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

  const togglePpmEnabled = async (assetId, enabled) => {
    if (!assetId) return;
    try {
      setPpmSavingId(String(assetId));
      await api.patch(`/ppm/assets/${assetId}/ppm-enabled`, { enabled });
      await load();
    } catch (error) {
      alert(error.response?.data?.message || 'Could not update PPM marking');
    } finally {
      setPpmSavingId(null);
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setTask(null);
  };

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
      await api.patch(`/ppm/${task._id}/submit`, {
        checklist: task.checklist || [],
        technician_notes: task.technician_notes || '',
        equipment_used: task.equipment_used || []
      });
      const refreshed = await api.get(`/ppm`).then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        return list.find((x) => x._id === task._id);
      });
      if (refreshed) setTask(refreshed);
      await load();
      if (showIncompleteList) await loadIncomplete();
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
      await load();
      if (showIncompleteList) await loadIncomplete();
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
      await load();
      if (showIncompleteList) await loadIncomplete();
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
      await load();
      if (showIncompleteList) await loadIncomplete();
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">PPM Work Orders — 180-day overview</h1>
        <p className="text-sm text-slate-600 mt-1">
          {canManagePpmInclusion ? (
            <>
              Tick <span className="font-semibold">PPM</span> for each asset that should appear on technician Work Orders (unchecked assets stay admin-only here, unless a PPM is assigned to that technician).
              {' '}
            </>
          ) : null}
          Search by Unique ID, ABS code, or IP. Open the wrench on a listed asset to run the checklist.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col">
          <div className="text-xs font-semibold uppercase text-slate-500">PPM coverage</div>
          <div className="relative flex-1 min-h-[160px] mt-2">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={68} paddingAngle={2}>
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
                  <div className="text-3xl font-bold text-emerald-700 leading-none">{completedPct}%</div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mt-1">Completed</div>
                </>
              ) : (
                <div className="text-sm text-slate-400">No tasks</div>
              )}
            </div>
          </div>
          <div className="text-center text-sm text-slate-600">
            {!pieData[0]?.empty ? (
              <span>
                <span className="font-semibold text-orange-700">{notCompletedCount}</span> not completed
                <span className="mx-2 text-slate-300">·</span>
                <span className="font-semibold text-amber-600">{Math.max(0, taskTotal - completedCount - notCompletedCount)}</span> open
              </span>
            ) : null}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Overdue PPMs</div>
          <div className="text-4xl font-bold text-rose-600 mt-2">{overview.overdue ?? 0}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Not completed</div>
          <div className="text-4xl font-bold text-orange-600 mt-2">{notCompletedCount}</div>
          <div className="text-xs text-slate-500 mt-1">With technician comment</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">System health</div>
          <div className="text-4xl font-bold text-emerald-700 mt-2">{systemHealthPct}%</div>
          <div className="text-xs text-slate-500 mt-1">Assets in this list: healthy vs faulty / under repair</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex flex-wrap gap-2 items-center">
          {!showIncompleteList ? (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Unique ID, ABS code, IP, or model…"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
            />
          ) : (
            <p className="text-sm text-slate-600 flex-1 min-w-[200px]">
              PPMs marked <span className="font-semibold text-orange-800">Not completed</span> — read technician comments below. Use “Back to work orders” to return to the asset list.
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowIncompleteList((v) => !v)}
            className={`text-sm px-3 py-2 rounded-lg border ${showIncompleteList ? 'border-slate-300 bg-white hover:bg-slate-50' : 'border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100'}`}
          >
            {showIncompleteList ? 'Back to work orders' : 'Not completed PPMs'}
          </button>
          <button
            type="button"
            onClick={() => (showIncompleteList ? loadIncomplete() : load())}
            className="text-sm px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={exportBusy}
            onClick={downloadPpmExcel}
            className="text-sm px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
          >
            {exportBusy ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
        <div className="overflow-x-auto">
          {!showIncompleteList ? (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-2 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300"
                      title="Select all on page"
                    />
                  </th>
                  {canManagePpmInclusion ? (
                    <th className="px-2 py-2 text-left text-xs font-semibold uppercase text-slate-500 w-14" title="Include in technician PPM list">
                      PPM
                    </th>
                  ) : null}
                  <th className="px-3 py-2 text-left">Unique ID</th>
                  <th className="px-3 py-2 text-left">ABS Code</th>
                  <th className="px-3 py-2 text-left">IP Address</th>
                  <th className="px-3 py-2 text-left">Asset / model</th>
                  <th className="px-3 py-2 text-left">VMS</th>
                  <th className="px-3 py-2 text-left">Assigned To</th>
                  <th className="px-3 py-2 text-left">Next service</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={workOrderColSpan} className="px-3 py-6 text-slate-500">Loading assets…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={workOrderColSpan} className="px-3 py-6 text-slate-500">No assets match your search (or this store has no assets yet).</td></tr>
                ) : rows.map((row) => {
                  const a = row.asset || {};
                  const ns = nextServiceMeta(row.open_task, row.last_completed_at);
                  const rid = String(a._id || '');
                  return (
                    <tr key={a._id} className="border-t hover:bg-slate-50/80">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(rid)}
                          onChange={() => toggleSelectRow(rid)}
                          className="rounded border-slate-300"
                        />
                      </td>
                      {canManagePpmInclusion ? (
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(a.ppm_enabled)}
                            disabled={ppmSavingId === rid}
                            onChange={(e) => {
                              e.stopPropagation();
                              togglePpmEnabled(a._id, e.target.checked);
                            }}
                            className="rounded border-slate-300"
                            title="Technicians see this asset on Work Orders when checked"
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-2 font-mono text-xs">{a.uniqueId || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.abs_code || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.ip_address || '—'}</td>
                      <td className="px-3 py-2">{assetName(a)}</td>
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
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {canOpenAssetHistory && a._id ? (
                            <Link
                              to={`/asset/${a._id}`}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 inline-flex"
                              title="View asset"
                            >
                              <Eye size={16} />
                            </Link>
                          ) : null}
                          {canEditAsset && a._id ? (
                            <Link
                              to={`/asset/${a._id}`}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 inline-flex"
                              title="Asset details"
                            >
                              <Pencil size={16} />
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openChecklist(a._id)}
                            className="p-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                            title="PPM checklist"
                          >
                            <Wrench size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left">Unique ID</th>
                  <th className="px-3 py-2 text-left">ABS</th>
                  <th className="px-3 py-2 text-left">IP</th>
                  <th className="px-3 py-2 text-left">Asset / model</th>
                  <th className="px-3 py-2 text-left min-w-[220px]">Technician comment</th>
                  <th className="px-3 py-2 text-left">Recorded by</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Open</th>
                </tr>
              </thead>
              <tbody>
                {incompleteLoading ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-slate-500">Loading…</td></tr>
                ) : incompleteTasks.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-slate-500">No not-completed PPMs in this store.</td></tr>
                ) : incompleteTasks.map((t) => {
                  const a = t.asset || {};
                  return (
                    <tr key={t._id} className="border-t hover:bg-orange-50/40">
                      <td className="px-3 py-2 font-mono text-xs">{a.uniqueId || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.abs_code || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.ip_address || '—'}</td>
                      <td className="px-3 py-2">{assetName(a)}</td>
                      <td className="px-3 py-2 text-xs text-slate-800 whitespace-pre-wrap align-top max-w-md">{t.technician_notes || '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{t.incomplete_by?.name || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                        {t.incomplete_at ? new Date(t.incomplete_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded-lg border border-slate-300 hover:bg-slate-50"
                          onClick={() => {
                            setTask(t);
                            setDrawerOpen(true);
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
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
            </div>
            <div className="px-4 py-3 border-t flex flex-wrap gap-2 bg-slate-50">
              {!ppmClosed ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={save}
                    className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={complete}
                    className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Complete PPM
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={markNotCompleted}
                    className="px-3 py-2 text-sm rounded-lg border-2 border-orange-500 text-orange-900 bg-orange-50 hover:bg-orange-100 disabled:opacity-50"
                  >
                    Not completed
                  </button>
                </>
              ) : (
                <>
                  {canReopenDrawer ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={reopenForEditDrawer}
                      className="px-3 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
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
    </div>
  );
};

export default TechPpmPanel;
