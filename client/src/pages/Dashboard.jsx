import { useEffect, useMemo, useRef, useState } from 'react';
import DashboardCharts from '../components/DashboardCharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  Plus,
  ArrowDownLeft,
  Search,
  MapPin,
  ArrowRight,
  Package,
  LayoutDashboard,
  Sparkles,
  Clock,
  ChevronRight,
  ShieldCheck
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
      inUse: Number(overview.inUse || 0),
      inStore: Number(overview.inStore || 0),
      missing: Number(overview.missing || 0),
      faulty: Number(overview.faulty || 0),
      pendingReturns: Number(overview.pendingReturns || 0),
      pendingRequests: Number(overview.pendingRequests || 0),
      assetTypes: Number(overview.assetTypes || 0)
    },
    conditions: src.conditions && typeof src.conditions === 'object' ? src.conditions : {},
    products: Array.isArray(src.products) ? src.products : [],
    models: Array.isArray(src.models) ? src.models : [],
    locations: Array.isArray(src.locations) ? src.locations : [],
    categories: Array.isArray(src.categories) ? src.categories : [],
    growth: Array.isArray(src.growth) ? src.growth : [],
    maintenanceVendors: src.maintenanceVendors && typeof src.maintenanceVendors === 'object' ? src.maintenanceVendors : { Siemens: 0, G42: 0, Other: 0 }
  };
};

const Dashboard = () => {
  const { user, activeStore } = useAuth();
  const { theme } = useTheme();
  const [searchParams] = useSearchParams();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [systemOk, setSystemOk] = useState(true);
  const [_HEALTH, setHealth] = useState({ backend: false, db: false });
  const [recentAssets, setRecentAssets] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
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
  const utilPct = o.total > 0 ? Math.round((o.inUse / o.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-app-page space-y-6 text-app-main pb-10">
      <div className="relative overflow-hidden rounded-2xl border border-app-card bg-app-card shadow-sm">
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
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold border ${
                  systemOk ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' : 'bg-rose-500/10 text-rose-700 border-rose-500/20'
                }`}
              >
                <ShieldCheck className={`h-3.5 w-3.5 ${systemOk ? 'text-emerald-600' : 'text-rose-600'}`} />
                {systemOk ? 'System operational' : 'Connectivity issue'}
                <span className={`h-1.5 w-1.5 rounded-full ${systemOk ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              </div>
              <div className="inline-flex items-center rounded-full border border-app-card bg-app-elevated px-3 py-1.5 text-xs text-app-muted">
                Theme <span className="ml-1.5 font-bold text-app-main capitalize">{theme}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Utilization</p>
          <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">{utilPct}%</p>
          <p className="text-[11px] text-app-muted mt-0.5">{o.inUse ?? 0} in use</p>
        </div>
        <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">In store</p>
          <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">{o.inStore ?? 0}</p>
          <p className="text-[11px] text-app-muted mt-0.5">Available</p>
        </div>
        <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Attention</p>
          <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">{(o.faulty || 0) + (o.missing || 0)}</p>
          <p className="text-[11px] text-app-muted mt-0.5">Faulty + missing</p>
        </div>
        <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Queue</p>
          <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">{(o.pendingRequests || 0) + (o.pendingReturns || 0)}</p>
          <p className="text-[11px] text-app-muted mt-0.5">Requests + returns</p>
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

      <section aria-label="Quick shortcuts">
        <div className="flex items-center justify-between gap-2 mb-3 px-0.5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-app-muted">Shortcuts</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {user?.role !== 'Viewer' && (
            <>
              <Link
                to="/assets?action=add"
                className="group bg-app-card p-4 rounded-2xl border border-app-card flex flex-col items-start gap-3 hover:shadow-lg hover:border-[rgb(var(--accent-color))]/25 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-color))] focus-visible:ring-offset-2 focus-visible:ring-offset-app-page"
              >
                <div className="p-3 bg-indigo-500/10 text-indigo-600 rounded-xl group-hover:bg-indigo-500/20 transition-colors">
                  <Plus className="w-6 h-6" />
                </div>
                <div>
                  <span className="font-bold text-app-main text-sm block">Add new asset</span>
                  <span className="text-[11px] text-app-muted mt-0.5 block">Register hardware</span>
                </div>
                <ChevronRight className="w-4 h-4 text-app-muted opacity-0 group-hover:opacity-100 transition-opacity ml-auto -mt-2" />
              </Link>

              <Link
                to="/receive-process"
                className="group bg-app-card p-4 rounded-2xl border border-app-card flex flex-col items-start gap-3 hover:shadow-lg hover:border-[rgb(var(--accent-color))]/25 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-color))] focus-visible:ring-offset-2 focus-visible:ring-offset-app-page"
              >
                <div className="p-3 bg-purple-500/10 text-purple-600 rounded-xl group-hover:bg-purple-500/20 transition-colors">
                  <ArrowDownLeft className="w-6 h-6" />
                </div>
                <div>
                  <span className="font-bold text-app-main text-sm block">Receive / return</span>
                  <span className="text-[11px] text-app-muted mt-0.5 block">Process movement</span>
                </div>
                <ChevronRight className="w-4 h-4 text-app-muted opacity-0 group-hover:opacity-100 transition-opacity ml-auto -mt-2" />
              </Link>
            </>
          )}

          <Link
            to={assetsLink}
            className="group bg-app-card p-4 rounded-2xl border border-app-card flex flex-col items-start gap-3 hover:shadow-lg hover:border-[rgb(var(--accent-color))]/25 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-color))] focus-visible:ring-offset-2 focus-visible:ring-offset-app-page"
          >
            <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-xl group-hover:bg-emerald-500/20 transition-colors">
              <Search className="w-6 h-6" />
            </div>
            <div>
              <span className="font-bold text-app-main text-sm block">Search assets</span>
              <span className="text-[11px] text-app-muted mt-0.5 block">Filtered list</span>
            </div>
            <ChevronRight className="w-4 h-4 text-app-muted opacity-0 group-hover:opacity-100 transition-opacity ml-auto -mt-2" />
          </Link>

          <Link
            to="/stores"
            className="group bg-app-card p-4 rounded-2xl border border-app-card flex flex-col items-start gap-3 hover:shadow-lg hover:border-[rgb(var(--accent-color))]/25 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-color))] focus-visible:ring-offset-2 focus-visible:ring-offset-app-page"
          >
            <div className="p-3 bg-orange-500/10 text-orange-600 rounded-xl group-hover:bg-orange-500/20 transition-colors">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <span className="font-bold text-app-main text-sm block">Locations</span>
              <span className="text-[11px] text-app-muted mt-0.5 block">Stores & sites</span>
            </div>
            <ChevronRight className="w-4 h-4 text-app-muted opacity-0 group-hover:opacity-100 transition-opacity ml-auto -mt-2" />
          </Link>
        </div>
      </section>

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
    </div>
  );
};

export default Dashboard;
