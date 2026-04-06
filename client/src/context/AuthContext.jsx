import { createContext, useState, useEffect, useContext, useCallback, useMemo } from 'react';
import api from '../api/axios';
import PropTypes from 'prop-types';
import LoadingLogo from '../components/LoadingLogo';

/* eslint-disable react-refresh/only-export-components */
const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);


export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeStore, setActiveStore] = useState(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [branding, setBranding] = useState({ logoUrl: '/logo.svg', theme: 'default' });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalizeStoreSelection = useCallback((value) => {
    if (!value) return null;
    if (value === 'all') return 'all';
    if (typeof value === 'string') return { _id: value };
    if (typeof value === 'object' && value._id) return value;
    return null;
  }, []);

  const resolveStoreIdForBranding = useCallback((storeValue = activeStore, userValue = user) => {
    if (storeValue && storeValue !== 'all') {
      return storeValue?._id || storeValue || '';
    }
    if (userValue?.role !== 'Super Admin' && userValue?.assignedStore) {
      return userValue.assignedStore?._id || userValue.assignedStore || '';
    }
    return '';
  }, [activeStore, user]);

  const setFavicon = (href) => {
    try {
      const head = document.head || document.getElementsByTagName('head')[0];
      // Remove existing favicons
      Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="mask-icon"]')).forEach(el => el.parentNode.removeChild(el));
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = href.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      link.href = href;
      head.appendChild(link);
    } catch {
      // Non-blocking
    }
  };

  const fetchBranding = useCallback(async (storeOverride = undefined, userOverride = undefined) => {
    try {
      const storeId = resolveStoreIdForBranding(
        storeOverride === undefined ? activeStore : storeOverride,
        userOverride === undefined ? user : userOverride
      );
      const params = storeId ? { storeId } : undefined;
      const res = await api.get('/system/public-config', { params });
      const logoUrl = res.data?.logoUrl || '/logo.svg';
      const theme = res.data?.theme || 'default';
      setBranding({ logoUrl, theme });
      setFavicon(logoUrl);
      document.documentElement.dataset.theme = theme;
    } catch {
      setBranding({ logoUrl: '/logo.svg', theme: 'default' });
      setFavicon('/logo.svg');
      document.documentElement.dataset.theme = 'default';
    }
  }, [activeStore, resolveStoreIdForBranding, user]);

  useEffect(() => {
    const verifySession = async () => {
      try {
        // Prime CSRF/session cookies before auth check to reduce refresh race conditions.
        await api.get('/auth/csrf-token');
      } catch (error) {
        console.error('CSRF token fetch failed:', error);
      }

      // Do not set `user` from localStorage before /auth/me. Stale JSON (previous account) combined
      // with a still-valid old `sid` cookie used to show the wrong user after logout → login → refresh.
      setUser(null);
      setActiveStore(null);

      const maxAttempts = 3;
      let refreshedFromServer = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const res = await api.get('/auth/me');
          setUser(res.data);
          localStorage.setItem('user', JSON.stringify(res.data));

          if (res.data?.role !== 'Super Admin' && res.data?.assignedStore) {
            const normalizedAssignedStore = normalizeStoreSelection(res.data.assignedStore);
            setActiveStore(normalizedAssignedStore);
            localStorage.setItem('activeStore', JSON.stringify(normalizedAssignedStore));
          } else if (res.data?.role === 'Super Admin') {
            const storedActiveStore = localStorage.getItem('activeStore');
            if (storedActiveStore) {
              try {
                setActiveStore(normalizeStoreSelection(JSON.parse(storedActiveStore)));
              } catch {
                setActiveStore(null);
                localStorage.removeItem('activeStore');
              }
            } else {
              setActiveStore(null);
            }
          } else {
            setActiveStore(null);
            localStorage.removeItem('activeStore');
          }
          refreshedFromServer = true;
          break;
        } catch (error) {
          const status = error?.response?.status;
          const unauthorized = status === 401 || status === 403;
          const transient =
            !status ||
            status >= 500 ||
            status === 429 ||
            error?.code === 'ECONNABORTED' ||
            error?.message === 'Network Error';

          if (unauthorized) {
            localStorage.removeItem('user');
            localStorage.removeItem('activeStore');
            setUser(null);
            setActiveStore(null);
            break;
          }
          if (!transient || attempt === maxAttempts) break;
          await sleep(250 * attempt);
        }
      }

      if (!refreshedFromServer) {
        setUser(null);
        setActiveStore(null);
      }
      setLoading(false);
    };

    verifySession();
  }, [normalizeStoreSelection]);

  useEffect(() => {
    if (loading) return;
    fetchBranding();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStore, user?._id, loading]);

  const login = useCallback(async (email, password) => {
    setGlobalLoading(true);
    try {
      const response = await api.post('/auth/login', { email, password });
      const userData = response.data;

      localStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);

      // If regular admin/technician, set their assigned store as active
      if (userData.role !== 'Super Admin' && userData.assignedStore) {
        const normalizedAssignedStore = normalizeStoreSelection(userData.assignedStore);
        setActiveStore(normalizedAssignedStore);
        localStorage.setItem('activeStore', JSON.stringify(normalizedAssignedStore));
      } else if (userData.role === 'Super Admin') {
        // Super Admin: Clear active store initially (force selection).
        setActiveStore(null);
        localStorage.removeItem('activeStore');
      }

      return userData;
    } finally {
      setGlobalLoading(false);
    }
  }, [normalizeStoreSelection]);

  const logout = useCallback(async () => {
    setGlobalLoading(true);
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout failed:', error);
    }
    localStorage.removeItem('user');
    localStorage.removeItem('activeStore');
    setUser(null);
    setActiveStore(null);
    setGlobalLoading(false);
  }, []);

  const selectStore = useCallback((store) => {
    const normalizedStore = normalizeStoreSelection(store);
    setActiveStore(normalizedStore);
    localStorage.setItem('activeStore', JSON.stringify(normalizedStore));
  }, [normalizeStoreSelection]);

  const refreshBranding = useCallback(async () => {
    await fetchBranding();
  }, [fetchBranding]);

  const value = useMemo(() => ({
    user,
    activeStore,
    login,
    logout,
    selectStore,
    loading,
    globalLoading,
    branding,
    refreshBranding
  }), [user, activeStore, login, logout, loading, globalLoading, branding, refreshBranding]);
  
  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <div className="min-h-screen flex flex-col items-center justify-center gap-2 bg-app-page px-4 text-app-main">
          <LoadingLogo
            message="Loading application…"
            subMessage="Checking your session — safe to refresh if this takes a moment."
            sizeClass="w-28 h-28"
            className="text-app-main"
          />
        </div>
      ) : children}
    </AuthContext.Provider>
  );
};

AuthProvider.propTypes = {
  children: PropTypes.node
};
