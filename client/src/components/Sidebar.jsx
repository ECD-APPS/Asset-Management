import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
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
  Wrench
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ChangePasswordModal from './ChangePasswordModal';
import api from '../api/axios';
import PropTypes from 'prop-types';

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

  if (hasSubItems) {
    return (
      <div>
        <button
          onClick={() => toggleSubMenu(item.name)}
          className={`${baseClass} ${isHighlighted ? activeClass : inactiveClass}`}
          style={isHighlighted ? tone.activeStyle : undefined}
          title={isCollapsed ? item.name : ''}
        >
          {isHighlighted && <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${tone.indicatorClass}`} />}
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
            {item.icon}
            {!isCollapsed && <span className={`truncate ${depth > 0 ? 'text-sm' : 'text-[15px] font-medium'}`}>{item.name}</span>}
          </div>
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
      onClick={() => onClose && onClose()}
      className={`${baseClass} ${active ? activeClass : inactiveClass}`}
      style={active ? tone.activeStyle : undefined}
      title={isCollapsed ? item.name : ''}
    >
      {active && <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${tone.indicatorClass}`} />}
      {item.icon}
      {!isCollapsed && <span className={`truncate ${depth > 0 ? 'text-sm' : 'text-[15px] font-medium'}`}>{item.name}</span>}
    </Link>
  );
};

SidebarItem.propTypes = {
  item: PropTypes.shape({
    name: PropTypes.string.isRequired,
    path: PropTypes.string,
    icon: PropTypes.element,
    subItems: PropTypes.array,
    uniqueKey: PropTypes.string
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
  const location = useLocation();
  const [openSubMenu, setOpenSubMenu] = useState({});
  const [productsTree, setProductsTree] = useState([]);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await api.get('/products');
        setProductsTree(res.data || []);
      } catch (err) {
        console.error('Failed to fetch products:', err);
      }
    };

    if (['Admin', 'Viewer', 'Super Admin'].includes(user?.role)) {
      fetchProducts();
    }
  }, [user, location.pathname]);

  const toggleSubMenu = (name) => {
    setOpenSubMenu((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const navItems = [
    { name: 'Dashboard', path: '/', icon: <LayoutDashboard size={18} strokeWidth={1.5} />, roles: ['Admin', 'Viewer'] },
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
    { name: 'Scanner', path: '/scanner', icon: <Box size={18} strokeWidth={1.5} />, roles: ['Technician'] },
    { name: 'My Assets', path: '/my-assets', icon: <Box size={18} strokeWidth={1.5} />, roles: ['Technician'] },
    
    
  ];

  const filterItems = (items) => {
    return items.reduce((acc, item) => {
      if (item.roles) {
        const hasRole = item.roles.includes(user?.role);
        const isSuperAdminAccessingAdmin = user?.role === 'Super Admin' && item.roles.includes('Admin');
        if (!hasRole && !isSuperAdminAccessingAdmin) return acc;
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

  const toneMap = {
    default: {
      activeClass: 'text-black border shadow-sm font-semibold',
      inactiveRootClass: 'text-app-sidebar hover:bg-white/14 hover:text-white',
      inactiveSubClass: 'text-app-sidebar hover:bg-white/14 hover:text-white',
      indicatorClass: 'bg-black',
      activeStyle: { backgroundColor: 'rgb(255 165 0)', borderColor: 'rgb(255 165 0)' }
    },
    ocean: {
      activeClass: 'text-sky-50 border shadow-sm font-medium',
      inactiveRootClass: 'text-sky-100/95 hover:bg-sky-300/20 hover:text-white',
      inactiveSubClass: 'text-sky-100/80 hover:bg-sky-300/18 hover:text-white',
      indicatorClass: 'bg-sky-200',
      activeStyle: { backgroundColor: 'rgba(14, 165, 233, 0.35)', borderColor: 'rgba(125, 211, 252, 0.6)' }
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
    }
  };
  const tone = toneMap[selectedTheme] || toneMap.default;

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
          <div className="mt-9 flex justify-center">
            <div className="inline-flex items-center justify-center rounded-xl border border-app-sidebar bg-white/10 p-2 shadow">
              <img
                src={branding?.logoUrl || '/logo.svg'}
                alt="SCY Asset"
                className="h-11 w-11 rounded-lg object-contain"
              />
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
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
          className={`flex w-full items-center rounded-xl px-3 py-2.5 text-sm text-rose-600 hover:bg-rose-50 ${isCollapsed ? 'justify-center' : 'gap-3'}`}
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
