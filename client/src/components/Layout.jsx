import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Menu, ChevronDown, Settings, Bell, Copy } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import {
  countUnreadActivePpmAlerts,
  isPpmNotificationUnread,
  isPpmWorkflowAlertActiveForUser,
  markAllPpmNotificationsRead,
  markPpmNotificationFpRead,
  ppmNotificationFingerprint
} from '../utils/ppmDashboardAlertsAck';

const PPM_ALERTS_API = { headers: { 'X-Skip-Global-Loading': '1' } };

const DEFAULT_DASHBOARD_VENDOR_OPTIONS = ['All', 'Siemens', 'G42'];

const formatPpmNotifDateTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
};

const ppmStatusRowClass = (status) => {
  const s = String(status || '');
  if (s === 'Approved') return 'bg-emerald-50 text-emerald-900 ring-emerald-200';
  if (s === 'Rejected') return 'bg-rose-50 text-rose-900 ring-rose-200';
  if (s === 'Modified') return 'bg-amber-50 text-amber-950 ring-amber-200';
  if (s === 'Pending') return 'bg-sky-50 text-sky-950 ring-sky-200';
  return 'bg-slate-100 text-slate-800 ring-slate-200';
};

function PpmNotifPanel({
  tone,
  user,
  history,
  loading,
  ppmAckUserId,
  ppmAckStoreId,
  ppmHeaderHref,
  ppmWorkOrdersHref = '/ppm',
  onClose
}) {
  const rowHref = (row) => (row?.kind === 'work_order' ? ppmWorkOrdersHref : ppmHeaderHref);
  const dark = tone === 'dark';
  const shell = dark
    ? 'rounded-xl border border-white/15 bg-slate-900 text-left text-white shadow-2xl'
    : 'rounded-xl border border-app-card bg-white text-left text-slate-800 shadow-lg';
  const sub = dark ? 'text-white/60' : 'text-slate-500';
  const rowBase = dark
    ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
    : 'border-slate-100 bg-slate-50/80 hover:bg-slate-100/90';
  const meta = dark ? 'text-white/55' : 'text-slate-500';

  return (
    <div className={`flex max-h-[min(24rem,70vh)] flex-col overflow-hidden ${shell}`}>
      <div className={`flex shrink-0 items-start justify-between gap-2 border-b px-3 py-2.5 ${dark ? 'border-white/10' : 'border-slate-100'}`}>
        <div>
          <p className="text-sm font-semibold">PPM notifications</p>
          <p className={`text-[11px] ${sub}`}>
            Last 365 days · {loading ? 'Loading…' : `${history.length} item${history.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            markAllPpmNotificationsRead(history, ppmAckUserId, ppmAckStoreId);
          }}
          className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${
            dark ? 'bg-white/10 text-white hover:bg-white/15' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Mark all read
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {loading && history.length === 0 ? (
          <p className={`px-2 py-6 text-center text-sm ${sub}`}>Loading notifications…</p>
        ) : null}
        {!loading && history.length === 0 ? (
          <p className={`px-2 py-6 text-center text-sm ${sub}`}>No PPM notifications in the last year.</p>
        ) : null}
        <ul className="space-y-2">
          {history.map((row) => {
            const unread = isPpmNotificationUnread(row, ppmAckUserId, ppmAckStoreId);
            const active = isPpmWorkflowAlertActiveForUser(user, row);
            const fp = ppmNotificationFingerprint(row);
            return (
              <li key={fp || row.task_id}>
                <Link
                  to={rowHref(row)}
                  onClick={() => {
                    if (fp) markPpmNotificationFpRead(fp, ppmAckUserId, ppmAckStoreId);
                    onClose();
                  }}
                  className={`block rounded-lg border px-2.5 py-2 transition-colors ${rowBase} ${
                    active ? 'ring-1 ring-[rgb(var(--accent-color))]/50' : ''
                  } ${unread ? (dark ? 'ring-1 ring-sky-400/40' : 'ring-1 ring-sky-300') : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="relative mt-1.5 flex h-2 w-2 shrink-0 justify-center">
                      {unread ? (
                        <span
                          className={`absolute inline-flex h-2 w-2 rounded-full ${
                            dark ? 'bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.25)]' : 'bg-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.2)]'
                          }`}
                          title="Unread"
                        />
                      ) : (
                        <span className={`h-1.5 w-1.5 rounded-full ${dark ? 'bg-white/25' : 'bg-slate-300'}`} title="Read" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${ppmStatusRowClass(row.status)}`}>
                          {String(row.status || '—')}
                        </span>
                        {row.assets_included > 0 ? (
                          <span className={`text-[11px] font-medium ${meta}`}>{row.assets_included} assets</span>
                        ) : null}
                        {active ? (
                          <span className="text-[10px] font-bold uppercase text-[rgb(var(--accent-color))]">Needs attention</span>
                        ) : null}
                      </div>
                      <p className={`mt-1 font-mono text-[10px] tabular-nums ${meta}`}>
                        Updated {formatPpmNotifDateTime(row.updated_at)}
                        {row.created_at && String(row.created_at) !== String(row.updated_at) ? (
                          <span> · Created {formatPpmNotifDateTime(row.created_at)}</span>
                        ) : null}
                      </p>
                      {row.approved_broadcast_at ? (
                        <p className={`mt-0.5 text-[10px] ${meta}`}>
                          Approved notice {formatPpmNotifDateTime(row.approved_broadcast_at)}
                        </p>
                      ) : null}
                      {String(row.manager_comment || '').trim() ? (
                        <p className={`mt-1 line-clamp-2 text-xs ${dark ? 'text-white/80' : 'text-slate-600'}`}>
                          {String(row.manager_comment).trim()}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className={`shrink-0 border-t px-2 py-2 ${dark ? 'border-white/10' : 'border-slate-100'}`}>
        <Link
          to={ppmHeaderHref}
          onClick={() => {
            markAllPpmNotificationsRead(history, ppmAckUserId, ppmAckStoreId);
            onClose();
          }}
          className={`block rounded-lg px-3 py-2 text-center text-sm font-semibold ${
            dark ? 'bg-orange-500 text-black hover:bg-orange-600' : 'bg-[rgb(var(--accent-color))] text-[rgb(var(--accent-contrast))] hover:brightness-105'
          }`}
        >
          {ppmHeaderHref === ppmWorkOrdersHref ? 'Open PPM' : 'Manager queue'}
        </Link>
        {ppmHeaderHref !== ppmWorkOrdersHref ? (
          <Link
            to={ppmWorkOrdersHref}
            onClick={() => {
              markAllPpmNotificationsRead(history, ppmAckUserId, ppmAckStoreId);
              onClose();
            }}
            className={`mt-1 block rounded-lg px-3 py-2 text-center text-sm font-semibold ${
              dark ? 'bg-white/10 text-white hover:bg-white/15' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
            }`}
          >
            PPM work orders
          </Link>
        ) : null}
      </div>
    </div>
  );
}

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [copyToast, setCopyToast] = useState('');
  const copyToastTimerRef = useRef(null);
  const [systemHealthy, setSystemHealthy] = useState(true);
  const [dbMode, setDbMode] = useState('unknown');
  const { user, logout, activeStore } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dashboardVendorOptions, setDashboardVendorOptions] = useState(DEFAULT_DASHBOARD_VENDOR_OPTIONS);
  /** Immediate tab highlight while search params catch up (pairs with dashboard stats cache). */
  const [dashboardVendorPressed, setDashboardVendorPressed] = useState(null);

  const scopeHints = useMemo(
    () =>
      [activeStore?.name, user?.assignedStore?.name, user?.name, user?.email]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(' ')
        .toUpperCase(),
    [activeStore?.name, user?.assignedStore?.name, user?.name, user?.email]
  );
  const hasScyHint = scopeHints.includes('SCY');
  const hasItHint = scopeHints.includes('IT ASSET') || /\bIT\b/.test(scopeHints);
  const hasNocHint = scopeHints.includes('NOC ASSET') || /\bNOC\b/.test(scopeHints);
  const showMaintenanceVendorScope =
    hasScyHint || (!hasItHint && !hasNocHint && user?.role !== 'Super Admin');
  const isDashboardHome = location.pathname === '/';

  const isManagerLike = useMemo(
    () => String(user?.role || '').toLowerCase().includes('manager'),
    [user?.role]
  );

  const showPpmProfileAlerts = useMemo(() => {
    if (!user?.role) return false;
    const ppmRoles = ['Admin', 'Viewer', 'Technician', 'Manager'];
    const r = user.role;
    const hasRole = ppmRoles.includes(r);
    const isSuperAdminAccessingAdmin = r === 'Super Admin' && ppmRoles.includes('Admin');
    const isManagerAccessingAdmin = isManagerLike && ppmRoles.includes('Admin');
    return hasRole || isSuperAdminAccessingAdmin || isManagerAccessingAdmin;
  }, [user?.role, isManagerLike]);

  const [ppmHeaderAlerts, setPpmHeaderAlerts] = useState([]);
  const [ppmNotifHistory, setPpmNotifHistory] = useState([]);
  const [ppmNotifHistoryLoading, setPpmNotifHistoryLoading] = useState(false);
  const [ppmNotifOpen, setPpmNotifOpen] = useState(false);
  const ppmNotifBtnMobileRef = useRef(null);
  const ppmNotifBtnDesktopRef = useRef(null);
  const ppmNotifPanelMobileRef = useRef(null);
  const ppmNotifPanelDesktopRef = useRef(null);
  const [ppmAckTick, setPpmAckTick] = useState(0);
  const ppmAckUserId = String(user?._id || user?.id || user?.email || 'anon').trim() || 'anon';
  const ppmAckStoreId = activeStore?._id != null ? String(activeStore._id) : 'no-store';

  const headerUnreadActiveCount = useMemo(
    () => countUnreadActivePpmAlerts(ppmHeaderAlerts, user, ppmAckUserId, ppmAckStoreId, ppmAckTick),
    [ppmHeaderAlerts, user, ppmAckUserId, ppmAckStoreId, ppmAckTick]
  );

  const showCopyToast = useCallback((message) => {
    if (copyToastTimerRef.current) clearTimeout(copyToastTimerRef.current);
    setCopyToast(message);
    copyToastTimerRef.current = setTimeout(() => {
      setCopyToast('');
      copyToastTimerRef.current = null;
    }, 2200);
  }, []);

  const copyCurrentPageUrl = useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      showCopyToast('Page link copied');
      setProfileOpen(false);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showCopyToast('Page link copied');
        setProfileOpen(false);
      } catch {
        showCopyToast('Could not copy link');
      }
    }
  }, [showCopyToast]);

  const ppmHeaderHref = isManagerLike ? '/ppm/manager-section' : '/ppm';

  useEffect(() => {
    const bump = () => setPpmAckTick((t) => t + 1);
    window.addEventListener('ppm-dash-alerts-ack', bump);
    const onStorage = (e) => {
      if (
        e.key &&
        (e.key.startsWith('ppm_dash_alerts_ack_v1_') || e.key.startsWith('ppm_notif_read_fps_v1_'))
      ) {
        bump();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('ppm-dash-alerts-ack', bump);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!showPpmProfileAlerts) {
      setPpmHeaderAlerts([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/ppm/dashboard-alerts', PPM_ALERTS_API);
        if (cancelled) return;
        setPpmHeaderAlerts(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setPpmHeaderAlerts([]);
      }
    };
    void load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [showPpmProfileAlerts, user?.role, activeStore?._id]);

  useEffect(() => {
    if (!showPpmProfileAlerts) {
      setPpmNotifHistory([]);
      return;
    }
    let cancelled = false;
    const loadHistory = async () => {
      try {
        setPpmNotifHistoryLoading(true);
        const { data } = await api.get('/ppm/notification-history', {
          ...PPM_ALERTS_API,
          params: { days: 365, limit: 500 }
        });
        if (cancelled) return;
        setPpmNotifHistory(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setPpmNotifHistory([]);
      } finally {
        if (!cancelled) setPpmNotifHistoryLoading(false);
      }
    };
    void loadHistory();
    const timer = setInterval(loadHistory, 120000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [showPpmProfileAlerts, user?.role, activeStore?._id]);

  useEffect(() => {
    if (!ppmNotifOpen || !showPpmProfileAlerts) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/ppm/notification-history', {
          ...PPM_ALERTS_API,
          params: { days: 365, limit: 500 }
        });
        if (!cancelled) setPpmNotifHistory(Array.isArray(data) ? data : []);
      } catch {
        /* keep existing list */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ppmNotifOpen, showPpmProfileAlerts, activeStore?._id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setProfileOpen(false);
      setPpmNotifOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current) clearTimeout(copyToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ppmNotifOpen) return;
    const onDocMouseDown = (e) => {
      const t = e.target;
      if (ppmNotifBtnMobileRef.current?.contains(t)) return;
      if (ppmNotifBtnDesktopRef.current?.contains(t)) return;
      if (ppmNotifPanelMobileRef.current?.contains(t)) return;
      if (ppmNotifPanelDesktopRef.current?.contains(t)) return;
      setPpmNotifOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [ppmNotifOpen]);

  useEffect(() => {
    const storeId = activeStore?._id || activeStore;
    if (!storeId) {
      setDashboardVendorOptions(DEFAULT_DASHBOARD_VENDOR_OPTIONS);
      return;
    }
    let cancelled = false;
    api
      .get('/system/maintenance-vendors', { params: { storeId } })
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.vendors;
        if (Array.isArray(list) && list.length > 0) {
          setDashboardVendorOptions(['All', ...list]);
        } else {
          setDashboardVendorOptions(DEFAULT_DASHBOARD_VENDOR_OPTIONS);
        }
      })
      .catch(() => {
        if (!cancelled) setDashboardVendorOptions(DEFAULT_DASHBOARD_VENDOR_OPTIONS);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStore]);

  const headerDashboardVendor = useMemo(() => {
    const v = searchParams.get('maintenance_vendor');
    if (!v) return 'All';
    if (v === 'All') return 'All';
    if (dashboardVendorOptions.includes(v)) return v;
    return v;
  }, [searchParams, dashboardVendorOptions]);

  useEffect(() => {
    if (dashboardVendorPressed == null) return;
    if (dashboardVendorPressed === headerDashboardVendor) {
      setDashboardVendorPressed(null);
    }
  }, [dashboardVendorPressed, headerDashboardVendor]);

  useEffect(() => {
    if (!isDashboardHome) setDashboardVendorPressed(null);
  }, [isDashboardHome]);

  const isDashboardVendorTabActive = (vendor) =>
    dashboardVendorPressed != null ? dashboardVendorPressed === vendor : headerDashboardVendor === vendor;

  const setHeaderDashboardVendor = (vendor) => {
    setDashboardVendorPressed(vendor);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (vendor === 'All') next.delete('maintenance_vendor');
        else next.set('maintenance_vendor', vendor);
        return next;
      },
      { replace: true }
    );
  };

  useEffect(() => {
    let timer;
    let consecutiveHealthFailures = 0;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/healthz', { credentials: 'include' });
        if (!res.ok) throw new Error('health check failed');
        const data = await res.json();
        consecutiveHealthFailures = 0;
        setSystemHealthy(Boolean(data?.db_connected));
        setDbMode(String(data?.db_mode || 'unknown'));
      } catch {
        consecutiveHealthFailures += 1;
        if (consecutiveHealthFailures >= 2) {
          setSystemHealthy(false);
          setDbMode('unknown');
        }
      }
    };

    checkHealth();
    timer = setInterval(checkHealth, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-screen bg-app-page text-app-main font-sans">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Wrapper */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform transition-all duration-300 ease-in-out
        ${isCollapsed ? 'md:w-[88px]' : 'md:w-64'}
        w-64
        md:relative md:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <Sidebar
          onClose={() => setSidebarOpen(false)}
          isCollapsed={isCollapsed}
          toggleCollapse={() => setIsCollapsed(!isCollapsed)}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <header className="flex flex-col gap-2 border-b border-app-sidebar bg-app-sidebar text-app-sidebar px-4 py-3 shadow-sm md:hidden z-30">
            <div className="flex items-center justify-between w-full">
              <button type="button" onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <Menu size={22} strokeWidth={1.5} />
              </button>
              <div className="flex flex-col items-center">
                <span className="text-sm font-semibold">SCY Asset</span>
                <span className={`text-xs ${systemHealthy ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {systemHealthy ? 'System Operational' : 'System Degraded'}
                </span>
                <span className={`text-[10px] ${dbMode === 'in-memory' ? 'text-amber-300' : 'text-emerald-300'}`}>
                  DB: {dbMode === 'in-memory' ? 'In-Memory' : dbMode === 'persistent' ? 'Persistent' : 'Unknown'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {showPpmProfileAlerts ? (
                  <button
                    ref={ppmNotifBtnMobileRef}
                    type="button"
                    onClick={() => setPpmNotifOpen((o) => !o)}
                    className="relative rounded-lg p-2 text-white/90 hover:bg-white/10 md:hidden"
                    aria-label={`PPM notifications${headerUnreadActiveCount > 0 ? `, ${headerUnreadActiveCount} unread` : ''}`}
                  >
                    <Bell size={20} strokeWidth={1.5} />
                    {headerUnreadActiveCount > 0 ? (
                      <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-0.5 text-[9px] font-bold text-white ring-2 ring-app-sidebar">
                        {headerUnreadActiveCount > 99 ? '99+' : headerUnreadActiveCount}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                {user?.role === 'Admin' ? (
                  <Link to="/setup" className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                    <Settings size={20} strokeWidth={1.5} />
                  </Link>
                ) : (
                  <div className="w-8" />
                )}
              </div>
            </div>
            {showMaintenanceVendorScope && isDashboardHome && (
              <div className="w-full pt-1 border-t border-white/10">
                <p className="text-[10px] font-bold uppercase tracking-wide text-white/70 mb-1.5">Vendor scope</p>
                <div className="flex gap-1 overflow-x-auto pb-0.5">
                  {dashboardVendorOptions.map((vendor) => {
                    const active = isDashboardVendorTabActive(vendor);
                    return (
                      <button
                        key={vendor}
                        type="button"
                        onClick={() => setHeaderDashboardVendor(vendor)}
                        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          active ? 'bg-orange-500 text-white shadow-md' : 'bg-white/10 text-white/90 hover:bg-white/15'
                        }`}
                      >
                        {vendor}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
        </header>

        {/* Desktop Header */}
        <header className="hidden md:flex items-center justify-between gap-6 bg-app-header border-b border-app-card px-6 lg:px-8 py-3 shadow-sm z-30">
            <div className="flex flex-1 min-w-0 items-center">
              {showMaintenanceVendorScope && isDashboardHome ? (
                <div className="flex w-fit max-w-full flex-col items-start gap-2 min-w-0">
                  <div className="flex min-w-0 max-w-full items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--accent-color))]" aria-hidden />
                    <span className="truncate text-xs font-bold uppercase tracking-wide text-app-main">
                      Maintenance vendor scope
                    </span>
                  </div>
                  <p className="hidden max-w-md text-[11px] leading-snug text-app-muted xl:block">
                    All shows the full SCY picture. Choosing a vendor narrows dashboard stats and the asset list to that maintenance vendor (configured in Setup).
                  </p>
                  <div
                    className="inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-xl border border-app-card bg-white/80 p-1 shadow-sm dark:bg-white/5"
                    role="group"
                    aria-label="Dashboard maintenance vendor filter"
                  >
                    {dashboardVendorOptions.map((vendor) => {
                      const active = isDashboardVendorTabActive(vendor);
                      return (
                        <button
                          key={vendor}
                          type="button"
                          onClick={() => setHeaderDashboardVendor(vendor)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            active
                              ? 'bg-app-accent text-white shadow-sm'
                              : 'text-app-muted hover:text-app-main hover:bg-app-elevated'
                          }`}
                        >
                          {vendor}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex-1" aria-hidden />
              )}
            </div>

            <div className="flex items-center gap-3 lg:gap-4 shrink-0">
              <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${systemHealthy ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                <span className={`h-2 w-2 rounded-full ${systemHealthy ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                {systemHealthy ? 'System Operational' : 'System Degraded'}
              </div>
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                  dbMode === 'in-memory'
                    ? 'bg-amber-50 text-amber-700'
                    : dbMode === 'persistent'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-700'
                }`}
                title="Database mode reported by /api/healthz"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    dbMode === 'in-memory'
                      ? 'bg-amber-500'
                      : dbMode === 'persistent'
                        ? 'bg-emerald-500'
                        : 'bg-slate-400'
                  }`}
                />
                {dbMode === 'in-memory' ? 'DB: In-Memory' : dbMode === 'persistent' ? 'DB: Persistent' : 'DB: Unknown'}
              </div>

              {user?.role === 'Admin' && (
                <Link to="/setup" className="text-slate-600 hover:text-app-accent transition-colors p-2 rounded-xl hover:bg-slate-100/80" title="Setup">
                  <Settings size={18} strokeWidth={1.5} />
                </Link>
              )}

              {showPpmProfileAlerts ? (
                <div className="relative hidden md:block">
                  <button
                    ref={ppmNotifBtnDesktopRef}
                    type="button"
                    onClick={() => setPpmNotifOpen((o) => !o)}
                    className="relative rounded-xl border border-app-card bg-white p-2.5 text-slate-600 hover:bg-slate-50"
                    title="PPM notifications"
                    aria-label={`PPM notifications${headerUnreadActiveCount > 0 ? `, ${headerUnreadActiveCount} unread` : ''}`}
                  >
                    <Bell size={18} strokeWidth={1.75} />
                    {headerUnreadActiveCount > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-600 px-0.5 text-[8px] font-bold text-white ring-2 ring-white">
                        {headerUnreadActiveCount > 99 ? '99+' : headerUnreadActiveCount}
                      </span>
                    ) : null}
                  </button>
                  {ppmNotifOpen ? (
                    <div
                      ref={ppmNotifPanelDesktopRef}
                      className="absolute right-0 top-full z-[100] mt-2 w-[min(22rem,calc(100vw-4rem))]"
                    >
                      <PpmNotifPanel
                        tone="light"
                        user={user}
                        history={ppmNotifHistory}
                        loading={ppmNotifHistoryLoading}
                        ppmAckUserId={ppmAckUserId}
                        ppmAckStoreId={ppmAckStoreId}
                        ppmHeaderHref={ppmHeaderHref}
                        ppmWorkOrdersHref="/ppm"
                        onClose={() => setPpmNotifOpen(false)}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="relative">
                <button
                  onClick={() => setProfileOpen((prev) => !prev)}
                  className="flex items-center gap-2 rounded-xl border border-app-card bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <div className="h-8 w-8 rounded-full bg-app-accent-soft text-app-accent flex items-center justify-center text-xs font-semibold">
                    {String(user?.name || 'U').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="text-left leading-tight">
                    <p className="font-medium text-slate-900">{user?.name || 'User'}</p>
                    <p className="text-xs text-slate-500">{activeStore?.name || user?.role}</p>
                  </div>
                  <ChevronDown size={16} strokeWidth={1.5} className="text-slate-500" />
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2 w-60 rounded-xl border border-app-card bg-white p-2 shadow-md">
                    <button
                      type="button"
                      onClick={() => void copyCurrentPageUrl()}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      title="Copy this page URL (share with teammates)"
                    >
                      <Copy size={16} strokeWidth={1.75} className="shrink-0 text-slate-500" aria-hidden />
                      Copy page link
                    </button>
                    <Link
                      to="/portal"
                      onClick={() => setProfileOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Open Portal
                    </Link>
                    <button
                      onClick={async () => {
                        await logout();
                        navigate('/login');
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
        </header>

        {ppmNotifOpen && showPpmProfileAlerts ? (
          <>
            <div
              className="fixed inset-0 z-[90] bg-black/40 md:hidden"
              aria-hidden
              onClick={() => setPpmNotifOpen(false)}
            />
            <div
              ref={ppmNotifPanelMobileRef}
              className="fixed left-3 right-3 top-[4.25rem] z-[100] max-h-[min(70vh,28rem)] md:hidden"
            >
              <PpmNotifPanel
                tone="dark"
                user={user}
                history={ppmNotifHistory}
                loading={ppmNotifHistoryLoading}
                ppmAckUserId={ppmAckUserId}
                ppmAckStoreId={ppmAckStoreId}
                ppmHeaderHref={ppmHeaderHref}
                ppmWorkOrdersHref="/ppm"
                onClose={() => setPpmNotifOpen(false)}
              />
            </div>
          </>
        ) : null}

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-4 md:p-8 bg-app-page">
          <Outlet />
        </div>
      </div>

      {copyToast ? (
        <div
          role="status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[220] max-w-[min(90vw,20rem)] -translate-x-1/2 rounded-xl border border-slate-700/20 bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white shadow-lg"
        >
          {copyToast}
        </div>
      ) : null}
    </div>
  );
};

export default Layout;
