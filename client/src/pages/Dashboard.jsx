import { useEffect, useMemo, useRef, useState } from 'react';
import DashboardCharts from '../components/DashboardCharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  ArrowDownLeft,
  ArrowRight,
  Package,
  LayoutDashboard,
  Sparkles,
  Clock,
} from 'lucide-react';

const formatRelativeTime = (iso) => {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 45) return 'Just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
};

const normalizeStats = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const overview = src.overview && typeof src.overview === 'object' ? src.overview : {};
  return {
    ...src,
    overview: {
      total: Number(overview.total || 0),
      totalQuantity: Number(overview.totalQuantity || 0),
      inUse: Number(overview.inUse || 0),
      inUseQuantity: Number(overview.inUseQuantity || 0),
      inStore: Number(overview.inStore || 0),
      inStoreQuantity: Number(overview.inStoreQuantity || 0),
      missing: Number(overview.missing || 0),
      missingQuantity: Number(overview.missingQuantity || 0),
      disposed: Number(overview.disposed || 0),
      disposedQuantity: Number(overview.disposedQuantity || 0),
      reserved: Number(overview.reserved || 0),
      reservedQuantity: Number(overview.reservedQuantity || 0),
      repaired: Number(overview.repaired || 0),
      repairedQuantity: Number(overview.repairedQuantity || 0),
      underRepairWorkshop: Number(overview.underRepairWorkshop || 0),
      underRepairWorkshopQuantity: Number(overview.underRepairWorkshopQuantity || 0),
      faulty: Number(overview.faulty || 0),
      faultyQuantity: Number(overview.faultyQuantity || 0),
      lowStock: Number(overview.lowStock || 0),
      pendingReturns: Number(overview.pendingReturns || 0),
      pendingRequests: Number(overview.pendingRequests || 0),
      assetTypes: Number(overview.assetTypes || 0),
      activeTotal: Number(overview.activeTotal || 0)
    },
    conditions: src.conditions && typeof src.conditions === 'object' ? src.conditions : {},
    products: Array.isArray(src.products) ? src.products : [],
    models: Array.isArray(src.models) ? src.models : [],
    locations: Array.isArray(src.locations) ? src.locations : [],
    categories: Array.isArray(src.categories) ? src.categories : [],
    growth: Array.isArray(src.growth) ? src.growth : [],
    lowStockThreshold: Number(src.lowStockThreshold || 5),
    lowStockItems: Array.isArray(src.lowStockItems) ? src.lowStockItems : [],
    maintenanceVendors: src.maintenanceVendors && typeof src.maintenanceVendors === 'object' ? src.maintenanceVendors : { Siemens: 0, G42: 0, Other: 0 }
  };
};

const Dashboard = () => {
  const { user, activeStore } = useAuth();
  const { theme } = useTheme();
  const [searchParams] = useSearchParams();
  const [stats, setStats] = useState(null);
  const [consumablesStats, setConsumablesStats] = useState(null);
  const [toolsStats, setToolsStats] = useState(null);
  const [consumablesError, setConsumablesError] = useState('');
  const [toolsError, setToolsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [systemOk, setSystemOk] = useState(true);
  const [_HEALTH, setHealth] = useState({ backend: false, db: false });
  const [recentAssets, setRecentAssets] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showLowStockPanel, setShowLowStockPanel] = useState(false);
  const lowStockTriggerRef = useRef(null);
  const lowStockOverlayRef = useRef(null);
  const fetchSeqRef = useRef(0);

  const dashboardVendor = useMemo(() => {
    const v = searchParams.get('maintenance_vendor');
    if (v === 'Siemens' || v === 'G42') return v;
    return 'All';
  }, [searchParams]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const scopeHints = [
    activeStore?.name,
    user?.assignedStore?.name,
    user?.name,
    user?.email
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  const hasScyHint = scopeHints.includes('SCY');
  const hasItHint = scopeHints.includes('IT ASSET') || /\bIT\b/.test(scopeHints);
  const hasNocHint = scopeHints.includes('NOC ASSET') || /\bNOC\b/.test(scopeHints);
  // Prefer explicit SCY match; otherwise allow by default for non-IT/NOC scoped users.
  const isScyDashboard = hasScyHint || (!hasItHint && !hasNocHint && user?.role !== 'Super Admin');
  const assetsQuery = isScyDashboard && dashboardVendor !== 'All'
    ? `?maintenance_vendor=${encodeURIComponent(dashboardVendor)}`
    : '';
  const assetsLink = `/assets${assetsQuery}`;

  useEffect(() => {
    let cancelled = false;
    const fetchSeq = ++fetchSeqRef.current;
    const isStale = () => cancelled || fetchSeq !== fetchSeqRef.current;
    const fetchStats = async () => {
      const maxAttempts = 3;
      let lastError = null;
      if (!isStale()) setLoading(true);
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          if (!isStale()) setError(null);
          const vendorFilter = isScyDashboard && dashboardVendor !== 'All' ? { maintenance_vendor: dashboardVendor } : {};
          const statsParams = vendorFilter;
          const recentParams = { page: 1, limit: 8, ...vendorFilter };
          const [statsResponse, recentResponse] = await Promise.all([
            api.get('/assets/stats', { params: statsParams }),
            api.get('/assets', { params: recentParams })
          ]);
          if (isStale()) return;
          setStats(normalizeStats(statsResponse.data));
          setRecentAssets(recentResponse.data?.assets || recentResponse.data?.items || []);
          setConsumablesError('');
          setToolsError('');
          try {
            const [consumablesResponse, toolsResponse] = await Promise.all([
              api.get('/consumables/stats'),
              api.get('/tools/stats')
            ]);
            setConsumablesStats(consumablesResponse.data || {});
            setToolsStats(toolsResponse.data || {});
          } catch (e) {
            // Consumables/tools are "nice to have" widgets; don't block the main dashboard.
            console.warn('Failed to load consumables/tools stats:', e);
            setConsumablesStats({});
            setToolsStats({});
            const msg =
              e?.response?.data?.message ||
              e?.message ||
              'Unknown error';
            setConsumablesError(msg);
            setToolsError(msg);
          }
          setLastUpdated(new Date());
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const status = error?.response?.status;
          const transient = !status || status >= 500 || status === 429 || error?.code === 'ECONNABORTED' || error?.message === 'Network Error';
          if (!transient || attempt === maxAttempts) break;
          await sleep(250 * attempt);
        }
      }
      if (lastError) {
        if (isStale()) return;
        console.error('Error fetching stats:', lastError);
        const scopeLabel = isScyDashboard && dashboardVendor !== 'All' ? `${dashboardVendor} ` : '';
        setError(`Failed to load ${scopeLabel}dashboard data. Please try refreshing.`);
      }
      if (!isStale()) setLoading(false);
    };

    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [dashboardVendor, isScyDashboard]);

  useEffect(() => {
    let timer;
    let consecutiveHealthFailures = 0;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/healthz', { credentials: 'include' });
        if (!res.ok) throw new Error('healthz failed');
        const data = await res.json();
        const backend = true;
        const db = !!data.db_connected;
        consecutiveHealthFailures = 0;
        setHealth({ backend, db });
        setSystemOk(backend && db);
      } catch {
        consecutiveHealthFailures += 1;
        if (consecutiveHealthFailures >= 2) {
          setHealth({ backend: false, db: false });
          setSystemOk(false);
        }
      }
    };
    checkHealth();
    timer = setInterval(checkHealth, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onDocClick = (event) => {
      const t = event.target;
      if (lowStockTriggerRef.current?.contains(t)) return;
      if (lowStockOverlayRef.current?.contains(t)) return;
      setShowLowStockPanel(false);
    };
    if (showLowStockPanel) {
      document.addEventListener('mousedown', onDocClick);
    }
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showLowStockPanel]);

  if (loading) return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 bg-app-page px-4">
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 rounded-full border-2 border-app-card" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[rgb(var(--accent-color))] animate-spin" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-app-main">Loading dashboard</p>
        <p className="text-xs text-app-muted">Fetching live stats and recent activity…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-app-page flex items-center justify-center p-6">
      <div className="bg-app-card p-8 rounded-2xl text-center max-w-md w-full border border-app-card shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10">
          <AlertCircle className="h-8 w-8 text-rose-500" />
        </div>
        <h2 className="text-xl font-bold text-app-main mb-2">Couldn&apos;t load dashboard</h2>
        <p className="text-app-muted text-sm mb-6 leading-relaxed">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full sm:w-auto bg-app-accent text-white px-8 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
        >
          Retry
        </button>
      </div>
    </div>
  );

  const o = stats?.overview || {};
  const consumablesTotalQty = consumablesStats?.totalQuantity ?? 0;
  const consumablesLowStockQty = consumablesStats?.lowStockQuantity ?? 0;
  const consumablesItems = consumablesStats?.itemCount ?? 0;
  const toolsTotal = toolsStats?.total ?? 0;
  const toolsAvailable = toolsStats?.available ?? 0;
  const toolsIssued = toolsStats?.issued ?? 0;
  const toolsMaintenance = toolsStats?.maintenance ?? 0;

  return (
    <div className="min-h-screen bg-app-page space-y-6 text-app-main pb-10">
      <div className="relative overflow-visible rounded-2xl border border-app-card bg-app-card shadow-sm">
        <div className="absolute left-0 top-0 h-full w-1 bg-[rgb(var(--accent-color))]" aria-hidden />
        <div className="p-5 md:p-7 pl-6 md:pl-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent-color))]/10 text-[rgb(var(--accent-color))]">
                <LayoutDashboard className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl md:text-3xl font-bold text-app-main tracking-tight">Dashboard</h1>
                  <span className="inline-flex items-center gap-1 rounded-full border border-app-card bg-app-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-app-muted">
                    <Sparkles className="h-3 w-3 text-app-accent" />
                    Live
                  </span>
                </div>
                <p className="text-app-muted mt-1.5 text-sm leading-relaxed">
                  Welcome back, <span className="font-semibold text-app-main">{user?.name}</span>
                  {isScyDashboard && dashboardVendor !== 'All' ? (
                    <> · Viewing <span className="font-medium text-app-main">{dashboardVendor}</span> analytics</>
                  ) : (
                    <> · Here&apos;s your fleet snapshot</>
                  )}
                </p>
                {lastUpdated && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-app-muted">
                    <Clock className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    Data refreshed {lastUpdated.toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div className="relative" ref={lowStockTriggerRef}>
                <button
                  type="button"
                  onClick={() => setShowLowStockPanel((prev) => !prev)}
                  className="relative inline-flex items-center justify-center h-9 w-9 rounded-full border border-app-card bg-app-elevated text-app-main hover:bg-app-card transition-colors"
                  title="Low stock notifications"
                >
                  <Bell className="h-4 w-4" />
                  {(stats?.overview?.lowStock || 0) > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-600 text-white text-[10px] leading-[1.1rem] text-center font-bold">
                      {stats.overview.lowStock > 99 ? '99+' : stats.overview.lowStock}
                    </span>
                  )}
                </button>
              </div>
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold border ${
                  _HEALTH.db ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' : 'bg-rose-500/10 text-rose-700 border-rose-500/20'
                }`}
                title="Live database connection status"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${_HEALTH.db ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                {_HEALTH.db ? 'Database Connected' : 'Database Not Connected'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Consumables</p>
          <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">{consumablesTotalQty}</p>
          <p className="text-[11px] text-app-muted mt-0.5">
            {consumablesError ? `Error: ${consumablesError}` : `${consumablesItems} items in stock`}
          </p>
        </div>
        <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Tools</p>
          <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">{toolsAvailable}</p>
          <p className="text-[11px] text-app-muted mt-0.5">
            {toolsError ? `Error: ${toolsError}` : `${toolsTotal} total tools`}
          </p>
        </div>
        <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Low stock</p>
          <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">{consumablesLowStockQty}</p>
          <p className="text-[11px] text-app-muted mt-0.5">Consumables at/below min qty</p>
        </div>
        <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Tools status</p>
          <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">{toolsIssued + toolsMaintenance}</p>
          <p className="text-[11px] text-app-muted mt-0.5">{toolsIssued} issued + {toolsMaintenance} maintenance</p>
        </div>
      </div>

      {(stats?.overview?.pendingRequests > 0 || (user?.role !== 'Viewer' && stats?.overview?.pendingReturns > 0)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats.overview.pendingRequests > 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-app-card bg-app-card p-5 flex items-start justify-between gap-4 hover:shadow-md transition-all duration-200">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500 rounded-l-2xl" aria-hidden />
              <div className="flex items-start gap-4 pl-2 min-w-0">
                <div className="p-2.5 bg-amber-500/15 text-amber-600 rounded-xl shrink-0">
                  <Bell className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-app-main">Pending asset requests</h3>
                  <p className="text-sm text-app-muted mt-1">
                    <span className="font-bold text-amber-600 tabular-nums">{stats.overview.pendingRequests}</span>
                    {' '}technician request{stats.overview.pendingRequests !== 1 && 's'} awaiting approval.
                  </p>
                </div>
              </div>
              <Link
                to="/admin-requests"
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-500/20 transition-colors"
              >
                Review <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {user?.role !== 'Viewer' && stats.overview.pendingReturns > 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-app-card bg-app-card p-5 flex items-start justify-between gap-4 hover:shadow-md transition-all duration-200">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 rounded-l-2xl" aria-hidden />
              <div className="flex items-start gap-4 pl-2 min-w-0">
                <div className="p-2.5 bg-indigo-500/15 text-indigo-600 rounded-xl shrink-0">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-app-main">Pending returns</h3>
                  <p className="text-sm text-app-muted mt-1">
                    <span className="font-bold text-indigo-600 tabular-nums">{stats.overview.pendingReturns}</span>
                    {' '}asset{stats.overview.pendingReturns !== 1 && 's'} waiting for confirmation.
                  </p>
                </div>
              </div>
              <Link
                to="/receive-process"
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-500/20 transition-colors"
              >
                Process <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </div>
      )}

      <section aria-label="Analytics and charts" className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-app-muted px-0.5">Analytics</h2>
        <DashboardCharts
          stats={stats}
          showMaintenanceVendorFeatures={isScyDashboard}
          selectedMaintenanceVendor={isScyDashboard ? dashboardVendor : 'All'}
        />
      </section>

      <div className="rounded-2xl border border-app-card bg-app-card shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-app-card px-5 py-4 bg-app-elevated/30">
          <div>
            <h2 className="text-base font-bold text-app-main">Recent asset activity</h2>
            <p className="text-xs text-app-muted mt-0.5">Last {recentAssets.length} updated {recentAssets.length === 1 ? 'record' : 'records'}</p>
          </div>
          <Link
            to={assetsLink}
            className="inline-flex items-center gap-1.5 rounded-lg border border-app-card bg-app-card px-3 py-2 text-xs font-bold text-app-accent hover:bg-app-elevated transition-colors shrink-0"
          >
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-app-muted border-b border-app-card bg-app-elevated/20">
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Asset</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Location</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Updated</th>
              </tr>
            </thead>
            <tbody>
              {recentAssets.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-14 text-center text-app-muted">
                    <div className="inline-flex flex-col items-center gap-3 max-w-xs mx-auto">
                      <div className="p-4 rounded-2xl bg-app-elevated border border-app-card">
                        <Package className="w-8 h-8 opacity-40" />
                      </div>
                      <p className="text-sm font-medium text-app-main">No recent activity</p>
                      <p className="text-xs leading-relaxed">Assets will appear here after updates, or try widening your vendor filter.</p>
                    </div>
                  </td>
                </tr>
              )}
              {recentAssets.map((asset) => (
                <tr key={asset._id} className="border-b border-app-card last:border-0 hover:bg-app-elevated/40 transition-colors">
                  <td className="px-5 py-3.5 align-middle">
                    <div className="font-semibold text-app-main">{asset.name || '—'}</div>
                    <div className="text-xs text-app-muted font-mono mt-0.5">{asset.serial_number || '—'}</div>
                  </td>
                  <td className="px-5 py-3.5 align-middle">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                        asset.status === 'In Use'
                          ? 'bg-emerald-500/15 text-emerald-700'
                          : asset.status === 'In Store'
                            ? 'bg-sky-500/15 text-sky-700'
                            : String(asset.condition || '').toLowerCase().includes('faulty')
                              ? 'bg-rose-500/15 text-rose-700'
                              : asset.status === 'Missing'
                                ? 'bg-orange-500/15 text-orange-700'
                                : 'bg-app-elevated text-app-muted'
                      }`}
                    >
                      {asset.status || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-app-main/90 align-middle">{asset.location || asset.store?.name || '—'}</td>
                  <td className="px-5 py-3.5 align-middle">
                    <span className="text-app-muted tabular-nums text-xs block" title={asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : ''}>
                      {formatRelativeTime(asset.updatedAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showLowStockPanel && (
        <div className="fixed inset-0 z-[9999]" ref={lowStockOverlayRef}>
          <button
            type="button"
            aria-label="Close low stock panel"
            className="absolute inset-0 bg-black/30 cursor-default border-0 p-0"
            onMouseDown={() => setShowLowStockPanel(false)}
          />
          <div className="absolute top-0 right-0 z-10 h-full w-[26rem] max-w-[94vw] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">Low stock alerts</p>
                <p className="text-xs text-slate-500">
                  {(stats?.overview?.lowStock || 0)} item(s) at or below qty {stats?.lowStockThreshold || 5}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLowStockPanel(false)}
                className="text-slate-500 hover:text-slate-700 text-sm font-semibold"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {(stats?.lowStockItems || []).length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">No low stock items.</div>
              ) : (
                stats.lowStockItems.map((item) => (
                  <div key={item._id} className="px-4 py-3 border-b border-slate-100">
                    <div className="text-sm font-semibold text-slate-900">{item.name || 'Unnamed'}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      Qty: {Number(item.quantity || 0)} | Serial: {item.serial_number || 'N/A'}
                    </div>
                    <div className="text-xs text-slate-500">
                      Status: {item.status || 'N/A'} | Location: {item.location || 'N/A'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
