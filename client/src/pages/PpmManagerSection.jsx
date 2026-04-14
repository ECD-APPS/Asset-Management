import { useEffect, useMemo, useState } from 'react';
import api from '../api/axios';

const formatDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const formatDateOnly = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/** Human-readable span between two dates (non-negative). */
const durationBetween = (from, to = new Date()) => {
  const a = from ? new Date(from).getTime() : NaN;
  const b = to ? new Date(to).getTime() : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ms = Math.max(0, b - a);
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ${hours}h`;
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const m = Math.floor(ms / 60000);
  return m < 1 ? '< 1 min' : `${m} min`;
};

const creatorLabel = (u) => {
  if (!u || typeof u !== 'object') return '—';
  const name = String(u.name || '').trim();
  const email = String(u.email || '').trim();
  if (name && email) return `${name} (${email})`;
  return name || email || '—';
};

const shortId = (id) => {
  const s = String(id || '');
  if (s.length <= 14) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
};

const uniqueTicketsFromAssets = (assets, max = 5) => {
  const set = new Set();
  (assets || []).forEach((a) => {
    const t = String(a?.ticket || '').trim();
    if (t) set.add(t);
  });
  const arr = [...set];
  return { list: arr.slice(0, max), more: Math.max(0, arr.length - max) };
};

const workOrderQueueRow = (t) => {
  const a = t.asset && typeof t.asset === 'object' ? t.asset : {};
  return {
    ...t,
    queueKind: 'work_order',
    reviewStatus: String(t.manager_review?.status || 'Pending'),
    assets: [
      {
        unique_id: a.uniqueId || '',
        abs_code: a.abs_code || '',
        name: a.name || a.model_number || '',
        model_number: a.model_number || '',
        serial_number: a.serial_number || '',
        ticket: (a.ticket_number || '').trim() || t.work_order_ticket || '',
        maintenance_vendor: a.maintenance_vendor || ''
      }
    ]
  };
};

/**
 * Admin batch create (checkboxes) uses one shared ticket + schedule; merge into one manager card.
 */
const consolidateBatchWorkOrders = (rows) => {
  const workflows = rows.filter((r) => r.queueKind === 'workflow');
  const workOrders = rows.filter((r) => r.queueKind === 'work_order');
  const groupMap = new Map();
  for (const w of workOrders) {
    const ticket = String(w.work_order_ticket || '').trim();
    const sched = w.scheduled_for ? new Date(w.scheduled_for).getTime() : 0;
    const due = w.due_at ? new Date(w.due_at).getTime() : 0;
    const creator = String(w.created_by?._id || w.created_by || '');
    const key = `${ticket}\t${sched}\t${due}\t${creator}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(w);
  }
  const mergedWos = [];
  for (const [, arr] of groupMap) {
    if (arr.length <= 1) {
      mergedWos.push(arr[0]);
      continue;
    }
    const sorted = [...arr].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const first = sorted[0];
    const batchMemberIds = sorted.map((t) => String(t._id));
    const assets = sorted.flatMap((t) => (workOrderQueueRow(t).assets || []));
    const syntheticId = `wo-batch:${batchMemberIds.slice().sort().join(',')}`;
    const anyModified = sorted.some((t) => String(t.reviewStatus || '') === 'Modified');
    mergedWos.push({
      ...first,
      _id: syntheticId,
      queueKind: 'work_order_batch',
      batchMemberIds,
      reviewStatus: anyModified ? 'Modified' : String(first.reviewStatus || 'Pending'),
      assets,
      batchSize: sorted.length
    });
  }
  mergedWos.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const wfSorted = [...workflows].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return [...wfSorted, ...mergedWos];
};

const rowReviewStatus = (x) => {
  if (x.queueKind === 'work_order' || x.queueKind === 'work_order_batch') {
    return String(x.reviewStatus || 'Pending');
  }
  return String(x?.status || '');
};

const MetaItem = ({ label, children }) => (
  <div className="rounded-lg border border-slate-100 bg-white/80 px-3 py-2 shadow-sm">
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
    <div className="mt-0.5 text-sm font-medium text-slate-800 leading-snug">{children}</div>
  </div>
);

const PpmManagerSection = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState({});
  const [busyId, setBusyId] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedTaskId, setExpandedTaskId] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const [sectionResult, pendingResult] = await Promise.allSettled([
        api.get('/ppm/manager/section'),
        api.get('/ppm/manager/pending')
      ]);

      let workflowRows = [];
      if (sectionResult.status === 'fulfilled') {
        const data = sectionResult.value?.data;
        workflowRows = (Array.isArray(data) ? data : []).map((t) => ({ ...t, queueKind: 'workflow' }));
      } else {
        const st = Number(sectionResult.reason?.response?.status);
        // Import workflow cards (/manager/section) can fail store resolution while work orders (/manager/pending) still load — do not discard the whole panel.
        if (!Number.isFinite(st) || (st !== 404 && st !== 400 && st !== 403)) {
          throw sectionResult.reason;
        }
      }

      let workOrderRows = [];
      if (pendingResult.status === 'fulfilled') {
        const data = pendingResult.value?.data;
        workOrderRows = (Array.isArray(data) ? data : []).map(workOrderQueueRow);
      } else {
        const st = Number(pendingResult.reason?.response?.status);
        if (!Number.isFinite(st) || (st !== 404 && st !== 400 && st !== 403)) {
          throw pendingResult.reason;
        }
      }

      setRows([...workflowRows, ...workOrderRows]);
    } catch (error) {
      const msg = String(error?.response?.data?.message || '');
      if (!/not allowed/i.test(msg) && !/api endpoint not found/i.test(msg) && Number(error?.response?.status) !== 404) {
        alert(msg || 'Failed to load manager section');
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const consolidatedRows = useMemo(() => consolidateBatchWorkOrders(rows), [rows]);

  const filteredRows = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    const byStatus = statusFilter === 'all'
      ? consolidatedRows
      : consolidatedRows.filter((r) => rowReviewStatus(r).toLowerCase() === statusFilter);
    if (!q) return byStatus;
    return byStatus.filter((t) => {
      const assets = Array.isArray(t?.assets) ? t.assets : [];
      const statusStr = rowReviewStatus(t);
      const tickets = uniqueTicketsFromAssets(assets);
      const ticketStr = [String(t?.work_order_ticket || ''), ...tickets.list].join(' ').toLowerCase();
      const batchIds = (Array.isArray(t.batchMemberIds) ? t.batchMemberIds : []).join(' ').toLowerCase();
      return (
        String(t?._id || '').toLowerCase().includes(q)
        || batchIds.includes(q)
        || statusStr.toLowerCase().includes(q)
        || ticketStr.includes(q)
        || String(t?.manager_notes || '').toLowerCase().includes(q)
        || String(t?.manager_comment || '').toLowerCase().includes(q)
        || creatorLabel(t?.created_by).toLowerCase().includes(q)
        || assets.some((a) => (
          String(a?.unique_id || '').toLowerCase().includes(q)
          || String(a?.abs_code || '').toLowerCase().includes(q)
          || String(a?.name || '').toLowerCase().includes(q)
          || String(a?.model_number || '').toLowerCase().includes(q)
          || String(a?.serial_number || '').toLowerCase().includes(q)
        ))
      );
    });
  }, [consolidatedRows, query, statusFilter]);

  const summary = useMemo(() => {
    const total = consolidatedRows.length;
    const pending = consolidatedRows.filter((x) => rowReviewStatus(x) === 'Pending').length;
    const modified = consolidatedRows.filter((x) => rowReviewStatus(x) === 'Modified').length;
    const totalAssets = consolidatedRows.reduce((acc, t) => acc + (Array.isArray(t?.assets) ? t.assets.length : 0), 0);
    return { total, pending, modified, totalAssets };
  }, [consolidatedRows]);

  const act = async (t, status) => {
    const taskId = String(t._id);
    const c = String(comment[taskId] || '').trim();
    if (!c) return alert('Comment is required.');
    try {
      setBusyId(taskId);
      const qk = t.queueKind;
      // Sequential PATCH avoids parallel SMTP / rate limits from N concurrent manager-review calls.
      if (qk === 'work_order_batch' && Array.isArray(t.batchMemberIds) && t.batchMemberIds.length) {
        for (const id of t.batchMemberIds) {
          await api.patch(`/ppm/${id}/manager-review`, { decision: status, comment: c });
        }
      } else if (qk === 'work_order') {
        await api.patch(`/ppm/${taskId}/manager-review`, { decision: status, comment: c });
      } else {
        try {
          await api.patch('/ppm/manager-action', { ppm_task_id: taskId, status, comment: c });
        } catch (primaryError) {
          if (Number(primaryError?.response?.status) !== 404 && !/api endpoint not found/i.test(String(primaryError?.response?.data?.message || ''))) throw primaryError;
          await api.patch(`/ppm/${taskId}/manager-review`, { decision: status, comment: c });
        }
      }
      await load();
    } catch (error) {
      const d = error?.response?.data;
      const parts = [d?.message, d?.error].filter(Boolean);
      alert(parts.length ? parts.join('\n') : 'Failed to submit manager action');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">PPM Manager Section</h1>
        <p className="mt-2 text-sm text-slate-600 max-w-3xl leading-relaxed">
          <strong className="text-slate-800">Workflow batches</strong> (Excel import) appear here only after an Admin uses <strong>Send notification to managers</strong> on the PPM program page.{' '}
          <strong className="text-slate-800">Batch work orders</strong> group every asset the admin selected with the same ticket and schedule into a single card—approve once to apply to all linked tasks.{' '}
          Standalone work orders appear when only one asset is waiting. On each card you can <strong className="text-slate-800">Approve</strong>, <strong className="text-slate-800">Reject</strong>, or <strong className="text-slate-800">Modify</strong> (comment required); reject and modify notify admins only, approve notifies technicians and viewers for execution. After <strong>Modify</strong>, the admin revises the work and sends notification again so it returns here. Dates, ticket, creator, and wait time are on each card.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white to-slate-50/80 p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Queue tasks</div>
          <div className="text-2xl font-bold mt-1 text-app-accent tabular-nums">{summary.total}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white to-slate-50/80 p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Pending</div>
          <div className="text-2xl font-bold mt-1 text-amber-600 tabular-nums">{summary.pending}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white to-slate-50/80 p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Modified</div>
          <div className="text-2xl font-bold mt-1 text-indigo-600 tabular-nums">{summary.modified}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white to-slate-50/80 p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Assets in queue</div>
          <div className="text-2xl font-bold mt-1 text-slate-800 tabular-nums">{summary.totalAssets}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap gap-2 items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search task id, ticket, UID, ABS, model, admin notes, creator…"
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm flex-1 min-w-[220px] shadow-sm focus:ring-2 focus:ring-[rgb(var(--accent-color)/0.2)] focus:border-[rgb(var(--accent-color))]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 bg-white shadow-sm"
        >
          <option value="all">All status</option>
          <option value="pending">Pending</option>
          <option value="modified">Modified</option>
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-app-outline text-sm rounded-xl px-4 py-2.5 font-semibold"
        >
          Refresh
        </button>
      </div>

      {loading ? <div className="text-sm text-slate-500 py-6">Loading…</div> : null}
      {!loading && filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center text-sm text-slate-500">
          No manager tasks match the current filters.
        </div>
      ) : null}

      <div className="space-y-5">
        {filteredRows.map((t) => {
          const assets = Array.isArray(t?.assets) ? t.assets : [];
          const expanded = expandedTaskId === String(t._id);
          const isWorkflow = t.queueKind === 'workflow';
          const isBatch = t.queueKind === 'work_order_batch';
          const isSingleWorkOrder = t.queueKind === 'work_order';
          const isWorkOrderLike = isSingleWorkOrder || isBatch;
          const badgeStatus = rowReviewStatus(t);
          const { list: ticketList } = uniqueTicketsFromAssets(assets);
          const queueSince = isWorkflow ? (t.sent_to_manager_at || t.createdAt) : t.createdAt;
          const queueWait = durationBetween(queueSince, new Date());

          const cycleDays =
            t.scheduled_for && t.due_at
              ? Math.round((new Date(t.due_at).getTime() - new Date(t.scheduled_for).getTime()) / 86400000)
              : null;

          const cardShell =
            isWorkflow
              ? 'border-indigo-200/80 bg-gradient-to-br from-indigo-50/40 via-white to-white'
              : isBatch
                ? 'border-emerald-200/90 bg-gradient-to-br from-emerald-50/35 via-white to-white'
                : 'border-[rgb(var(--accent-color)/0.25)] bg-gradient-to-br from-[rgb(var(--accent-color)/0.06)] via-white to-white';
          const stripe = isWorkflow ? 'bg-indigo-500' : isBatch ? 'bg-emerald-600' : 'bg-[rgb(var(--accent-color))]';

          const typeLabel = isWorkflow ? 'Workflow batch' : isBatch ? 'Batch work orders' : 'Work order';

          return (
            <article
              key={`${t.queueKind}-${t._id}`}
              className={`group relative overflow-hidden rounded-2xl border shadow-md transition-shadow hover:shadow-lg ${cardShell}`}
            >
              <div className={`absolute left-0 top-0 h-full w-1 ${stripe}`} aria-hidden />
              <div className="pl-4 sm:pl-5 pr-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                          isWorkflow
                            ? 'bg-indigo-100 text-indigo-800'
                            : isBatch
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-app-accent-soft text-app-accent'
                        }`}
                      >
                        {typeLabel}
                      </span>
                      <span
                        className="font-mono text-xs text-slate-500 truncate max-w-[min(100%,18rem)]"
                        title={String(t._id)}
                      >
                        {isBatch ? `${t.batchSize || 0} tasks` : shortId(t._id)}
                      </span>
                    </div>
                    {isBatch ? (
                      <p className="text-sm text-slate-600 max-w-2xl">
                        Same PPM work order ticket and schedule as the admin batch create.{' '}
                        <span className="font-medium text-slate-800">Approving, rejecting, or modifying here updates every linked task.</span>
                      </p>
                    ) : null}
                    {isWorkOrderLike && (t.work_order_ticket || ticketList[0]) ? (
                      <p className="text-base font-semibold text-slate-900">
                        Ticket: <span className="text-app-accent">{String(t.work_order_ticket || ticketList[0] || '').trim() || '—'}</span>
                      </p>
                    ) : null}
                    {isWorkflow ? (() => {
                      const rowTicketSet = [...new Set(
                        (assets || []).map((a) => String(a?.ticket || '').trim()).filter(Boolean)
                      )];
                      const adminTicket = String(t.batch_ticket || '').trim();
                      const displayTicket =
                        adminTicket || (rowTicketSet.length > 0 ? rowTicketSet.join(', ') : '');
                      const multipleDistinct = !adminTicket && rowTicketSet.length > 1;
                      return (
                        <p className="text-base font-semibold text-slate-900">
                          Ticket number:{' '}
                          <span className="font-mono text-app-accent break-words">{displayTicket || '—'}</span>
                          {multipleDistinct ? (
                            <span className="block mt-1 text-xs font-normal text-slate-500">
                              Multiple work-order tickets in this batch (listed above). For one label on future imports, set a batch ticket on upload or use one ticket column for all rows.
                            </span>
                          ) : null}
                        </p>
                      );
                    })() : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border border-[rgb(var(--accent-color)/0.35)] bg-app-accent-soft text-app-accent">
                      {badgeStatus}
                    </span>
                    {isWorkOrderLike && t.status ? (
                      <span
                        className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium border bg-sky-50 text-sky-800 border-sky-200"
                        title="Technician task status"
                      >
                        Task: {t.status}
                        {isBatch ? ' (each)' : ''}
                      </span>
                    ) : null}
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium border bg-slate-100 text-slate-700 border-slate-200">
                      Assets: {assets.length}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <MetaItem label="Created (date & time)">{formatDateTime(t.createdAt)}</MetaItem>
                  <MetaItem label="Created by">{creatorLabel(t.created_by)}</MetaItem>

                  {isWorkflow ? (
                    <>
                      <MetaItem label="Admin schedule date">{formatDateOnly(t.schedule_date)}</MetaItem>
                      {t.ppm_linked_scheduled_for ? (
                        <MetaItem label="Scheduled for (admin, earliest task)">{formatDateTime(t.ppm_linked_scheduled_for)}</MetaItem>
                      ) : null}
                      {t.ppm_linked_due_at ? (
                        <>
                          <MetaItem label="Due date (admin, latest task)">{formatDateTime(t.ppm_linked_due_at)}</MetaItem>
                          <MetaItem label="Next service (days to due)">{t.ppm_linked_days_label || '—'}</MetaItem>
                          {t.ppm_linked_cycle_days != null && Number.isFinite(Number(t.ppm_linked_cycle_days)) ? (
                            <MetaItem label="Planned window (scheduled → due)">
                              {Number(t.ppm_linked_cycle_days)} day{Number(t.ppm_linked_cycle_days) === 1 ? '' : 's'}
                            </MetaItem>
                          ) : null}
                        </>
                      ) : null}
                      <MetaItem label="Sent to managers">{formatDateTime(t.sent_to_manager_at)}</MetaItem>
                      <MetaItem label="In queue for">{queueWait ? `${queueWait} (since ${formatDateTime(queueSince)})` : '—'}</MetaItem>
                      <MetaItem label="Last updated">{formatDateTime(t.updatedAt)}</MetaItem>
                    </>
                  ) : (
                    <>
                      <MetaItem label="Scheduled for (admin)">{formatDateTime(t.scheduled_for)}</MetaItem>
                      <MetaItem label="Due date (admin)">{formatDateTime(t.due_at)}</MetaItem>
                      <MetaItem label="Planned window">
                        {cycleDays != null && Number.isFinite(cycleDays)
                          ? `${cycleDays} day${cycleDays === 1 ? '' : 's'} (scheduled → due)`
                          : '—'}
                      </MetaItem>
                      <MetaItem label="Waiting for review">{queueWait ? `${queueWait} since ${formatDateTime(queueSince)}` : '—'}</MetaItem>
                      <MetaItem label="Assigned technician">{creatorLabel(t.assigned_to)}</MetaItem>
                      <MetaItem label="Manager notification sent">{formatDateTime(t.manager_notification_sent_at)}</MetaItem>
                    </>
                  )}
                </div>

                {isBatch && Array.isArray(t.batchMemberIds) && t.batchMemberIds.length > 0 ? (
                  <div className="mt-3 sm:col-span-2 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Linked PPM task IDs</div>
                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-emerald-950 break-all">
                      {t.batchMemberIds.map((id) => shortId(id)).join(' · ')}
                    </p>
                  </div>
                ) : null}

                {isWorkflow && String(t.manager_comment || '').trim() ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Admin / system note</div>
                    <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap line-clamp-4">{String(t.manager_comment).trim()}</p>
                  </div>
                ) : null}
                {isWorkOrderLike && String(t.manager_notes || '').trim() ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Admin manager notes</div>
                    <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap line-clamp-4">{String(t.manager_notes).trim()}</p>
                  </div>
                ) : null}

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setExpandedTaskId(expanded ? '' : String(t._id))}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-colors"
                  >
                    {expanded ? 'Hide asset list' : 'View assets'}
                  </button>
                </div>

                {expanded ? (
                  <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden shadow-inner">
                    <div className="max-h-[min(70vh,40rem)] overflow-auto overflow-x-auto custom-scrollbar">
                      <table className="min-w-full text-xs border-collapse">
                        <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100">
                          <tr>
                            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Unique ID</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">ABS</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Name</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Model</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Serial</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Ticket</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-slate-700">Vendor</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {assets.length === 0 ? (
                            <tr><td colSpan={7} className="px-3 py-4 text-slate-500">No assets attached.</td></tr>
                          ) : assets.map((a, idx) => (
                            <tr key={`${t._id}-${idx}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                              <td className="px-3 py-2 font-mono align-top">{a?.unique_id || '—'}</td>
                              <td className="px-3 py-2 font-mono align-top">{a?.abs_code || '—'}</td>
                              <td className="px-3 py-2 align-top">{a?.name || '—'}</td>
                              <td className="px-3 py-2 align-top">{a?.model_number || '—'}</td>
                              <td className="px-3 py-2 font-mono align-top">{a?.serial_number || '—'}</td>
                              <td className="px-3 py-2 align-top font-medium text-slate-800">{a?.ticket || '—'}</td>
                              <td className="px-3 py-2 align-top">{a?.maintenance_vendor || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                <textarea
                  className="mt-4 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm shadow-sm focus:ring-2 focus:ring-[rgb(var(--accent-color)/0.2)] focus:border-[rgb(var(--accent-color))]"
                  rows={3}
                  placeholder="Manager comment (required)"
                  value={comment[t._id] || ''}
                  onChange={(e) => setComment((prev) => ({ ...prev, [t._id]: e.target.value }))}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === String(t._id)}
                    onClick={() => act(t, 'Approved')}
                    className="btn-app-primary rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === String(t._id)}
                    onClick={() => act(t, 'Rejected')}
                    className="btn-app-outline rounded-xl px-5 py-2.5 text-sm font-semibold"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busyId === String(t._id)}
                    onClick={() => act(t, 'Modified')}
                    className="btn-app-soft rounded-xl px-5 py-2.5 text-sm font-semibold"
                  >
                    Modify
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default PpmManagerSection;
