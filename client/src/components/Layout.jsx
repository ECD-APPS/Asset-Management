import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation, useSearchParams } from 'react-router-dom';
import { Menu, ChevronDown, Settings } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';

const DASHBOARD_VENDOR_OPTIONS = ['All', 'Siemens', 'G42'];

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [systemHealthy, setSystemHealthy] = useState(true);
  const [dbMode, setDbMode] = useState('unknown');
  const { user, logout, activeStore } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

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

  const headerDashboardVendor = useMemo(() => {
    const v = searchParams.get('maintenance_vendor');
    if (v === 'Siemens' || v === 'G42') return v;
    return 'All';
  }, [searchParams]);

  const setHeaderDashboardVendor = (vendor) => {
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
              {user?.role === 'Admin' ? (
                <Link to="/setup" className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <Settings size={20} strokeWidth={1.5} />
                </Link>
              ) : (
                <div className="w-8" />
              )}
            </div>
            {showMaintenanceVendorScope && isDashboardHome && (
              <div className="w-full pt-1 border-t border-white/10">
                <p className="text-[10px] font-bold uppercase tracking-wide text-white/70 mb-1.5">Vendor scope</p>
                <div className="flex gap-1 overflow-x-auto pb-0.5">
                  {DASHBOARD_VENDOR_OPTIONS.map((vendor) => {
                    const active = headerDashboardVendor === vendor;
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
                <div className="flex flex-col gap-2 min-w-0 max-w-2xl">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 rounded-full bg-[rgb(var(--accent-color))] shrink-0" aria-hidden />
                    <span className="text-xs font-bold text-app-main uppercase tracking-wide truncate">
                      Maintenance vendor scope
                    </span>
                  </div>
                  <p className="text-[11px] text-app-muted leading-snug hidden xl:block">
                    All shows the full SCY picture. Siemens or G42 narrows dashboard stats and the asset list to that vendor.
                  </p>
                  <div
                    className="inline-flex flex-wrap items-center rounded-xl border border-app-card bg-white/80 dark:bg-white/5 p-1 gap-0.5 shadow-sm"
                    role="group"
                    aria-label="Dashboard maintenance vendor filter"
                  >
                    {DASHBOARD_VENDOR_OPTIONS.map((vendor) => {
                      const active = headerDashboardVendor === vendor;
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
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-app-card bg-white p-2 shadow-md">
                    <Link
                      to="/portal"
                      onClick={() => setProfileOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Open Portal
                    </Link>
                    <button
                      onClick={logout}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-4 md:p-8 bg-app-page">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default Layout;
