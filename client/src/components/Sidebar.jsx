import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Box,
  Users,
  Store,
  LogOut,
  Ticket,
  ChevronDown,
  ChevronRight,
  Menu,
  Calendar,
  Lock,
  Wrench,
  ClipboardCheck,
  Package
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ChangePasswordModal from './ChangePasswordModal';
import api from '../api/axios';
import PropTypes from 'prop-types';
import {
  acknowledgePpmDashboardAlerts,
  countUnreadActivePpmAlerts
} from '../utils/ppmDashboardAlertsAck';

const SidebarItem = ({
  item,
  depth = 0,
  openSubMenu,
  toggleSubMenu,
  location,
  onClose,
  isActive,
  isCollapsed,
  tone
}) => {
  const isSubMenuOpen = openSubMenu[item.name];
  const hasSubItems = item.subItems && item.subItems.length > 0;
  const active = item.path ? isActive(item.path) : false;
  const parentActive = hasSubItems && item.subItems?.some((sub) => isActive(sub.path || ''));
  const isHighlighted = active || parentActive;

  if (isCollapsed && depth > 0) return null;

  const baseClass = `relative group flex items-center w-full rounded-xl transition-all ${
    isCollapsed ? 'justify-center px-2 py-2.5' : `${depth > 0 ? 'pl-10 pr-3 py-2' : 'px-3 py-2.5'}`
  }`;

  const activeClass = tone.activeClass;
  const inactiveClass = depth > 0 ? tone.inactiveSubClass : tone.inactiveRootClass;
  const badgeCount = Number(item?.badgeCount || 0);

  if (hasSubItems) {
    return (
      <div>
        <button
          onClick={() => {
            if (typeof item.beforeToggle === 'function') item.beforeToggle();
            toggleSubMenu(item.name);
          }}
          className={`${baseClass} ${isHighlighted ? activeClass : inactiveClass}`}
          style={isHighlighted ? tone.activeStyle : undefined}
          title={isCollapsed ? item.name : ''}
        >
          {isHighlighted && <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${tone.indicatorClass}`} />}
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
            {item.icon}
            {!isCollapsed && <span className={`truncate ${depth > 0 ? 'text-sm' : 'text-[15px] font-medium'}`}>{item.name}</span>}
          </div>
          {!isCollapsed && badgeCount > 0 && (
            <span className="ml-2 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
          {!isCollapsed && (isSubMenuOpen ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />)}
        </button>

        {!isCollapsed && isSubMenuOpen && (
          <ul className="mt-1.5 space-y-1">
            {item.subItems.map((sub) => (
              <li key={sub.uniqueKey || sub.path || sub.name}>
                <SidebarItem
                  item={sub}
                  depth={depth + 1}
                  openSubMenu={openSubMenu}
                  toggleSubMenu={toggleSubMenu}
                  location={location}
                  onClose={onClose}
                  isActive={isActive}
                  isCollapsed={isCollapsed}
                  tone={tone}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <Link
      to={item.path}
      onClick={() => {
        if (typeof item.onNavigate === 'function') item.onNavigate();
        onClose && onClose();
      }}
      className={`${baseClass} ${active ? activeClass : inactiveClass}`}
      style={active ? tone.activeStyle : undefined}
      title={isCollapsed ? item.name : ''}
    >
      {active && <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${tone.indicatorClass}`} />}
      {item.icon}
      {!isCollapsed && <span className={`truncate ${depth > 0 ? 'text-sm' : 'text-[15px] font-medium'}`}>{item.name}</span>}
      {!isCollapsed && badgeCount > 0 && (
        <span className="ml-auto inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </Link>
  );
};

SidebarItem.propTypes = {
  item: PropTypes.shape({
    name: PropTypes.string.isRequired,
    path: PropTypes.string,
    icon: PropTypes.element,
    subItems: PropTypes.array,
    uniqueKey: PropTypes.string,
    badgeCount: PropTypes.number,
    beforeToggle: PropTypes.func,
    onNavigate: PropTypes.func
  }).isRequired,
  depth: PropTypes.number,
  openSubMenu: PropTypes.object.isRequired,
  toggleSubMenu: PropTypes.func.isRequired,
  location: PropTypes.object.isRequired,
  onClose: PropTypes.func,
  isActive: PropTypes.func.isRequired,
  isCollapsed: PropTypes.bool,
  tone: PropTypes.shape({
    activeClass: PropTypes.string.isRequired,
    inactiveRootClass: PropTypes.string.isRequired,
    inactiveSubClass: PropTypes.string.isRequired,
    indicatorClass: PropTypes.string.isRequired,
    activeStyle: PropTypes.object
  }).isRequired
};

const Sidebar = ({ onClose, isCollapsed, toggleCollapse }) => {
  const { user, logout, activeStore, branding } = useAuth();
  const isManagerLike = String(user?.role || '').toLowerCase().includes('manager');
  const location = useLocation();
  const navigate = useNavigate();
  const [openSubMenu, setOpenSubMenu] = useState({});
  const [productsTree, setProductsTree] = useState([]);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [showRadialMenu, setShowRadialMenu] = useState(false);
  const [ppmDashboardAlerts, setPpmDashboardAlerts] = useState([]);
  const [ppmAckTick, setPpmAckTick] = useState(0);
  const ppmAckUserId = String(user?._id || user?.id || user?.email || 'anon').trim() || 'anon';
  const ppmAckStoreId = activeStore?._id != null ? String(activeStore._id) : 'no-store';

  const effectivePpmBadge = useMemo(
    () => countUnreadActivePpmAlerts(ppmDashboardAlerts, user, ppmAckUserId, ppmAckStoreId),
    [ppmDashboardAlerts, user, ppmAckUserId, ppmAckStoreId, ppmAckTick]
  );

  const ackPpmAlerts = useCallback(() => {
    acknowledgePpmDashboardAlerts(ppmDashboardAlerts, ppmAckUserId, ppmAckStoreId);
  }, [ppmDashboardAlerts, ppmAckUserId, ppmAckStoreId]);

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
    const fetchProducts = async () => {
      try {
        const res = await api.get('/products');
        setProductsTree(res.data || []);
      } catch (err) {
        console.error('Failed to fetch products:', err);
      }
    };

    if (['Admin', 'Viewer', 'Super Admin'].includes(user?.role) || isManagerLike) {
      fetchProducts();
    }
  }, [user?.role, activeStore?._id, isManagerLike]);

  useEffect(() => {
    let cancelled = false;
    const loadPpmNotifications = async () => {
      try {
        const { data } = await api.get('/ppm/dashboard-alerts');
        if (cancelled) return;
        setPpmDashboardAlerts(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setPpmDashboardAlerts([]);
      }
    };
    void loadPpmNotifications();
    const timer = setInterval(loadPpmNotifications, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user?.role, activeStore?._id]);

  const toggleSubMenu = (name) => {
    setOpenSubMenu((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const navItems = useMemo(
    () => [
    { name: 'Dashboard', path: '/', icon: <LayoutDashboard size={18} strokeWidth={1.5} />, roles: ['Admin', 'Viewer', 'Manager'] },
    {
      name: 'Events',
      icon: <Calendar size={18} strokeWidth={1.5} />,
      roles: ['Admin', 'Technician'],
      subItems: [
        { name: 'Recent Activity', path: '/events/recent-activity', uniqueKey: 'recent-activity' },
        { name: 'System Logs', path: '/events/system-logs', uniqueKey: 'system-logs', roles: ['Admin'] }
      ]
    },
    {
      name: 'Assets',
      icon: <Box size={18} strokeWidth={1.5} />,
      roles: ['Admin', 'Viewer'],
      subItems: [
        { name: 'All Assets', path: '/assets', uniqueKey: 'all-assets' },
        ...productsTree.map((root) => ({
          name: root.name,
          path: `/assets?product=${encodeURIComponent(root.name)}`,
          uniqueKey: `prod-root-${root._id}`,
          subItems: (root.children || []).map((child) => ({
            name: child.name,
            path: `/assets?product=${encodeURIComponent(child.name)}`,
            uniqueKey: `prod-child-${root._id}-${child.name}`,
            subItems: (child.children || []).map((grand) => ({
              name: grand.name,
              path: `/assets?product=${encodeURIComponent(grand.name)}`,
              uniqueKey: `prod-grand-${root._id}-${child.name}-${grand.name}`
            }))
          }))
        }))
      ]
    },
    { name: 'Tech Assets', path: '/admin-tech-assets', icon: <Box size={18} strokeWidth={1.5} />, roles: ['Admin'] },
    { name: 'Add Members', path: '/add-members', icon: <Users size={18} strokeWidth={1.5} />, roles: ['Admin'] },
    { name: 'Locations', path: '/stores', icon: <Store size={18} strokeWidth={1.5} />, roles: ['Admin', 'Viewer'] },
    { name: 'Gate Passes', path: '/passes', icon: <Ticket size={18} strokeWidth={1.5} />, roles: ['Admin'] },
    { name: 'Products', path: '/products', icon: <Box size={18} strokeWidth={1.5} />, roles: ['Admin', 'Viewer'] },
    { name: 'Spare Parts', path: '/spare-parts', icon: <Package size={18} strokeWidth={1.5} />, roles: ['Admin', 'Viewer', 'Technician'] },
    {
      name: 'Tools',
      icon: <Wrench size={18} strokeWidth={1.5} />,
      roles: ['Admin', 'Viewer', 'Technician'],
      subItems: [
        { name: 'Register Tools', path: '/tools', uniqueKey: 'tools-register', roles: ['Admin', 'Viewer'] },
        { name: 'Consumables', path: '/consumables', uniqueKey: 'tools-consumables', roles: ['Admin', 'Viewer'] },
        { name: 'Technician Panel', path: '/tools/panel', uniqueKey: 'tools-panel', roles: ['Technician', 'Admin'] },
        { name: 'Request Tools', path: '/tech-request', uniqueKey: 'tools-request', roles: ['Technician'] }
      ]
    },
    {
      name: 'PPM Management',
      icon: <ClipboardCheck size={18} strokeWidth={1.5} />,
      roles: ['Admin', 'Viewer', 'Technician', 'Manager'],
      badgeCount: effectivePpmBadge,
      beforeToggle: ackPpmAlerts,
      subItems: [
        {
          name: 'PPM',
          path: '/ppm',
          uniqueKey: 'ppm-main',
          roles: ['Admin', 'Viewer', 'Technician', 'Manager'],
          onNavigate: ackPpmAlerts
        },
        {
          name: 'History',
          path: '/ppm/history',
          uniqueKey: 'ppm-history',
          roles: ['Admin', 'Viewer', 'Technician', 'Manager'],
          onNavigate: ackPpmAlerts
        },
        {
          name: 'Manager Section',
          path: '/ppm/manager-section',
          uniqueKey: 'ppm-manager-section',
          roles: ['Manager'],
          onNavigate: ackPpmAlerts
        }
      ]
    },
    { name: 'Scanner', path: '/scanner', icon: <Box size={18} strokeWidth={1.5} />, roles: ['Technician'] },
    { name: 'My Assets', path: '/my-assets', icon: <Box size={18} strokeWidth={1.5} />, roles: ['Technician'] }
    ],
    [productsTree, effectivePpmBadge, ackPpmAlerts]
  );

  const filterItems = (items) => {
    return items.reduce((acc, item) => {
      if (item.roles) {
        const hasRole = item.roles.includes(user?.role);
        const isSuperAdminAccessingAdmin = user?.role === 'Super Admin' && item.roles.includes('Admin');
        const isManagerAccessingAdmin = isManagerLike && item.roles.includes('Admin');
        const isManagerAccessingManagerRoute = isManagerLike && item.roles.includes('Manager');
        if (!hasRole && !isSuperAdminAccessingAdmin && !isManagerAccessingAdmin && !isManagerAccessingManagerRoute) return acc;
      }

      const newItem = { ...item };
      if (newItem.subItems && newItem.subItems.length > 0) {
        newItem.subItems = filterItems(newItem.subItems);
      }

      acc.push(newItem);
      return acc;
    }, []);
  };

  const filteredItems = filterItems(navItems);
  const mainNavItems = filteredItems.filter((item) => item.name !== 'Events');
  const filteredEvents = filteredItems.filter((item) => item.name === 'Events');
  const selectedTheme = branding?.theme || 'default';
  const isDefaultTheme = selectedTheme === 'default';
  const isOceanTheme = selectedTheme === 'ocean';

  const toneMap = {
    default: {
      activeClass: 'text-black border shadow-sm font-semibold',
      inactiveRootClass: 'text-app-sidebar hover:bg-white/14 hover:text-white',
      inactiveSubClass: 'text-app-sidebar hover:bg-white/14 hover:text-white',
      indicatorClass: 'bg-black',
      activeStyle: { backgroundColor: 'rgb(255 165 0)', borderColor: 'rgb(255 165 0)' }
    },
    ocean: {
      activeClass: 'text-white border shadow-sm font-bold',
      inactiveRootClass: 'text-white/95 font-semibold hover:bg-white/16 hover:text-white',
      inactiveSubClass: 'text-white/90 font-semibold hover:bg-white/14 hover:text-white',
      indicatorClass: 'bg-white',
      activeStyle: { backgroundColor: 'rgba(255, 255, 255, 0.2)', borderColor: 'rgba(255, 255, 255, 0.5)' }
    },
    emerald: {
      activeClass: 'text-emerald-50 border shadow-sm font-medium',
      inactiveRootClass: 'text-emerald-100/95 hover:bg-emerald-300/18 hover:text-white',
      inactiveSubClass: 'text-emerald-100/85 hover:bg-emerald-300/16 hover:text-white',
      indicatorClass: 'bg-emerald-200',
      activeStyle: { backgroundColor: 'rgba(16, 185, 129, 0.34)', borderColor: 'rgba(110, 231, 183, 0.55)' }
    },
    sunset: {
      activeClass: 'text-amber-50 border shadow-sm font-medium',
      inactiveRootClass: 'text-orange-100 hover:bg-orange-300/20 hover:text-white',
      inactiveSubClass: 'text-orange-100/90 hover:bg-orange-300/16 hover:text-white',
      indicatorClass: 'bg-amber-300',
      activeStyle: { backgroundColor: 'rgba(251, 146, 60, 0.34)', borderColor: 'rgba(253, 186, 116, 0.55)' }
    },
    midnight: {
      activeClass: 'text-slate-900 border shadow-sm font-semibold',
      inactiveRootClass: 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
      inactiveSubClass: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      indicatorClass: 'bg-slate-900',
      activeStyle: { backgroundColor: 'rgba(15, 23, 42, 0.08)', borderColor: 'rgba(15, 23, 42, 0.2)' }
    },
    mono: {
      activeClass: 'text-slate-50 border shadow-sm font-medium',
      inactiveRootClass: 'text-slate-100/95 hover:bg-slate-300/16 hover:text-white',
      inactiveSubClass: 'text-slate-100/80 hover:bg-slate-300/14 hover:text-white',
      indicatorClass: 'bg-slate-200',
      activeStyle: { backgroundColor: 'rgba(148, 163, 184, 0.24)', borderColor: 'rgba(203, 213, 225, 0.45)' }
    },
    glossy: {
      activeClass: 'text-white border shadow-sm font-semibold',
      inactiveRootClass: 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700',
      inactiveSubClass: 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700',
      indicatorClass: 'bg-indigo-500',
      activeStyle: { backgroundColor: 'rgb(79 70 229)', borderColor: 'rgb(79 70 229)' }
    },
    astraLight: {
      activeClass: 'text-white border shadow-sm font-semibold',
      inactiveRootClass: 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700',
      inactiveSubClass: 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700',
      indicatorClass: 'bg-indigo-500',
      activeStyle: { backgroundColor: 'rgb(79 70 229)', borderColor: 'rgb(79 70 229)' }
    },
    astraExecutive: {
      activeClass: 'text-white border shadow-sm font-semibold',
      inactiveRootClass: 'text-slate-200/90 hover:bg-slate-300/16 hover:text-white',
      inactiveSubClass: 'text-slate-200/80 hover:bg-slate-300/14 hover:text-white',
      indicatorClass: 'bg-slate-200',
      activeStyle: { backgroundColor: 'rgba(79, 70, 229, 0.44)', borderColor: 'rgba(148, 163, 184, 0.55)' }
    }
  };
  const tone = toneMap[selectedTheme] || toneMap.default;

  const findFirstPathForItem = (items, targetName) => {
    const direct = items.find((entry) => entry.name === targetName);
    if (!direct) return null;
    if (direct.path) return direct.path;
    if (Array.isArray(direct.subItems) && direct.subItems.length > 0) {
      return direct.subItems[0]?.path || null;
    }
    return null;
  };

  const radialActions = [
    { name: 'Dashboard', icon: <LayoutDashboard size={16} strokeWidth={1.8} />, path: findFirstPathForItem(filteredItems, 'Dashboard') },
    { name: 'Assets', icon: <Box size={16} strokeWidth={1.8} />, path: findFirstPathForItem(filteredItems, 'Assets') },
    { name: 'Members', icon: <Users size={16} strokeWidth={1.8} />, path: findFirstPathForItem(filteredItems, 'Add Members') },
    { name: 'Locations', icon: <Store size={16} strokeWidth={1.8} />, path: findFirstPathForItem(filteredItems, 'Locations') },
    { name: 'Tools', icon: <Wrench size={16} strokeWidth={1.8} />, path: findFirstPathForItem(filteredItems, 'Tools') },
    { name: 'Events', icon: <Calendar size={16} strokeWidth={1.8} />, path: findFirstPathForItem(filteredItems, 'Events') },
    { name: 'Logout', icon: <LogOut size={16} strokeWidth={1.8} />, action: () => logout() }
  ].filter((action) => Boolean(action.path || action.action));

  const isActive = (itemPath) => {
    if (!itemPath) return false;
    if (itemPath.includes('?')) return location.pathname + location.search === itemPath;
    return location.pathname === itemPath;
  };

  return (
    <aside className="flex h-full w-full flex-col border-r border-app-sidebar bg-app-sidebar text-app-sidebar shadow-xl">
      <div className="relative border-b border-app-sidebar p-4 md:p-5">
        <button
          onClick={toggleCollapse}
          className={`hidden md:flex absolute top-4 ${isCollapsed ? 'left-1/2 -translate-x-1/2' : 'right-4'} h-8 w-8 items-center justify-center rounded-lg border border-app-sidebar text-app-sidebar hover:bg-white/10 ${isDefaultTheme ? 'shadow-[0_0_0_1px_rgba(255,165,0,0.25)]' : ''}`}
          title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          <Menu size={16} strokeWidth={1.5} />
        </button>

        {!isCollapsed ? (
          <div className="mt-5 flex flex-col items-center text-center">
            <div className="inline-flex items-center justify-center rounded-2xl border border-app-sidebar bg-white/10 p-3 shadow-lg">
              <img
                src={branding?.logoUrl || '/logo.svg'}
                alt="SCY Asset"
                className="h-16 w-16 rounded-xl object-contain"
              />
            </div>
            <p className="mt-3 text-base font-semibold tracking-wide text-app-sidebar">SCY Asset</p>
            <p className="mt-1 rounded-full border border-app-sidebar px-2.5 py-0.5 text-[11px] text-app-sidebar">
              {activeStore?.name || user?.role}
            </p>
            <p className="mt-2 text-xs text-app-sidebar">{user?.name}</p>
          </div>
        ) : (
          <div
            className="mt-9 flex justify-center"
            onMouseEnter={() => isOceanTheme && setShowRadialMenu(true)}
            onMouseLeave={() => isOceanTheme && setShowRadialMenu(false)}
          >
            <div className="relative inline-flex items-center justify-center">
              {isOceanTheme && (
                <span
                  className={`pointer-events-none absolute h-16 w-16 rounded-full bg-slate-200/30 blur-xl transition-all duration-500 ${
                    showRadialMenu ? 'scale-110 opacity-100' : 'scale-75 opacity-0'
                  }`}
                />
              )}
              <div className="inline-flex items-center justify-center rounded-xl border border-app-sidebar bg-white/10 p-2 shadow">
                <img
                  src={branding?.logoUrl || '/logo.svg'}
                  alt="SCY Asset"
                  className="h-9 w-9 rounded-lg object-contain"
                />
              </div>

              {isOceanTheme && (
                <div
                  className={`pointer-events-none absolute left-full top-1/2 z-40 ml-3 -translate-y-1/2 transition-all duration-500 ${
                    showRadialMenu ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  {radialActions.map((action, idx) => {
                    const count = Math.max(radialActions.length - 1, 1);
                    const angleStart = -92;
                    const angleStep = 184 / count;
                    const angle = angleStart + angleStep * idx;
                    const radius = 82;
                    const x = Math.cos((angle * Math.PI) / 180) * radius;
                    const y = Math.sin((angle * Math.PI) / 180) * radius;
                    const isLogoutAction = action.name === 'Logout';

                    return (
                      <button
                        key={action.name}
                        type="button"
                        className="group pointer-events-auto absolute flex h-11 w-11 items-center justify-center rounded-full border border-white/55 bg-gradient-to-b from-slate-300/65 via-slate-300/45 to-slate-500/35 text-white shadow-[0_10px_24px_-14px_rgba(2,6,23,0.95)] ring-1 ring-white/30 backdrop-blur-md transition hover:scale-110 hover:from-slate-200/75 hover:to-slate-500/45"
                        style={{
                          transform: showRadialMenu
                            ? `translate(${x}px, ${y}px) scale(1)`
                            : 'translate(0px, 0px) scale(0.6)',
                          opacity: showRadialMenu ? 1 : 0,
                          transition: 'transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease',
                          transitionDelay: showRadialMenu ? `${idx * 48}ms` : `${(radialActions.length - idx) * 24}ms`
                        }}
                        title={action.name}
                        onClick={() => {
                          if (action.action) {
                            action.action();
                            return;
                          }
                          if (action.path) {
                            navigate(action.path);
                            onClose && onClose();
                          }
                        }}
                      >
                        <span
                          className="pointer-events-none absolute h-11 w-11 rounded-full bg-slate-100/20 blur-md"
                          style={{
                            opacity: showRadialMenu ? (isLogoutAction ? 0.35 : 0.75) : 0,
                            transform: showRadialMenu
                              ? `scale(${isLogoutAction ? 1.15 : 1.45})`
                              : 'scale(0.65)',
                            transition: 'transform 640ms cubic-bezier(0.22, 1, 0.36, 1), opacity 520ms ease',
                            transitionDelay: showRadialMenu ? `${idx * 56 + 80}ms` : '0ms'
                          }}
                        />
                        <span
                          className={`pointer-events-none absolute h-12 w-12 rounded-full border border-white/35 ${
                            showRadialMenu ? 'animate-ping' : ''
                          }`}
                          style={{
                            opacity: showRadialMenu ? (isLogoutAction ? 0.08 : 0.22) : 0,
                            animationDuration: isLogoutAction ? '2400ms' : '1800ms'
                          }}
                        />
                        {action.icon}
                        <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md border border-white/40 bg-slate-700/85 px-2 py-1 text-[11px] font-semibold tracking-wide text-white opacity-0 shadow-[0_10px_20px_-16px_rgba(2,6,23,0.95)] transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">
                          {action.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        {isCollapsed && isOceanTheme ? (
          <div className="px-3 text-center text-[11px] font-semibold tracking-wide text-white/85">
            Hover logo for quick menu
          </div>
        ) : (
          <>
        <ul className="space-y-1.5 px-3">
          {mainNavItems.map((item) => (
            <li key={item.name}>
              <SidebarItem
                item={item}
                openSubMenu={openSubMenu}
                toggleSubMenu={toggleSubMenu}
                location={location}
                onClose={onClose}
                isActive={isActive}
                isCollapsed={isCollapsed}
                tone={tone}
              />
            </li>
          ))}
        </ul>

        {filteredEvents.map((item) => (
          <div key={item.name} className="mt-4 border-t border-app-sidebar px-3 pt-3">
            <SidebarItem
              item={item}
              openSubMenu={openSubMenu}
              toggleSubMenu={toggleSubMenu}
              location={location}
              onClose={onClose}
              isActive={isActive}
              isCollapsed={isCollapsed}
              tone={tone}
            />
          </div>
        ))}
          </>
        )}
      </nav>

      <div className="border-t border-app-sidebar p-3 bg-black/10">
        {(user?.role === 'Super Admin' || user?.role === 'Viewer') && (
          <Link
            to="/portal"
            className={`mb-2 flex w-full items-center rounded-xl px-3 py-2.5 text-sm text-app-sidebar hover:bg-white/10 ${isCollapsed ? 'justify-center' : 'gap-3'} ${isDefaultTheme ? 'hover:text-orange-300' : ''}`}
            title="Switch Store"
          >
            <Store size={18} strokeWidth={1.5} />
            {!isCollapsed && <span>Switch Store</span>}
          </Link>
        )}

        <button
          onClick={() => setIsPasswordModalOpen(true)}
          className={`mb-1 flex w-full items-center rounded-xl px-3 py-2.5 text-sm text-app-sidebar hover:bg-white/10 ${isCollapsed ? 'justify-center' : 'gap-3'} ${isDefaultTheme ? 'hover:text-orange-300' : ''}`}
          title="Change Password"
        >
          <Lock size={18} strokeWidth={1.5} />
          {!isCollapsed && <span>Change Password</span>}
        </button>

        <button
          onClick={logout}
          className={`flex w-full items-center rounded-xl px-3 py-2.5 text-sm ${selectedTheme === 'ocean' ? 'text-white font-bold hover:bg-white/16' : 'text-rose-600 hover:bg-rose-50'} ${isCollapsed ? 'justify-center' : 'gap-3'}`}
          title="Logout"
        >
          <LogOut size={18} strokeWidth={1.5} />
          {!isCollapsed && <span>Logout</span>}
        </button>
      </div>

      <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />
    </aside>
  );
};

Sidebar.propTypes = {
  onClose: PropTypes.func,
  isCollapsed: PropTypes.bool,
  toggleCollapse: PropTypes.func
};

export default Sidebar;
