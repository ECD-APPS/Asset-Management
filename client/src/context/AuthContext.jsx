import { createContext, useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/axios';
import PropTypes from 'prop-types';
import LoadingLogo from '../components/LoadingLogo';

/* eslint-disable react-refresh/only-export-components */
const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);


const IDLE_AUTH_PATHS = new Set(['/login', '/forgot-password', '/reset-password']);
const parseIdleLogoutMs = () => {
  const raw = String(import.meta.env.VITE_IDLE_LOGOUT_MS || '').trim();
  if (raw === '0') return 0;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return 15 * 60 * 1000;
};

export const AuthProvider = ({ children }) => {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeStore, setActiveStore] = useState(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [branding, setBranding] = useState({ logoUrl: '', theme: 'default' });
  const idleLogoutMs = useMemo(() => parseIdleLogoutMs(), []);
  const idleTimerRef = useRef(null);
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

  const resolvePublicAssetUrl = useCallback((rawUrl, fallback = '') => {
    const input = String(rawUrl || '').trim();
    if (!input) return fallback;
    if (/^(data:|blob:|https?:\/\/)/i.test(input)) return input;
    if (input.startsWith('//')) return `${window.location.protocol}${input}`;

    const apiBase = String(api?.defaults?.baseURL || '/api');
    let apiOrigin = window.location.origin;
    try {
      apiOrigin = new URL(apiBase, window.location.origin).origin;
    } catch {
      apiOrigin = window.location.origin;
    }

    if (input.startsWith('/')) {
      return `${apiOrigin}${input}`;
    }
    return `${apiOrigin}/${input.replace(/^\.?\//, '')}`;
  }, []);

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
      const logoUrl = resolvePublicAssetUrl(res.data?.logoUrl, '');
      const theme = res.data?.theme || 'default';
      setBranding({ logoUrl, theme });
      if (logoUrl) setFavicon(logoUrl);
      document.documentElement.dataset.theme = theme;
    } catch {
      setBranding({ logoUrl: '', theme: 'default' });
      document.documentElement.dataset.theme = 'default';
    }
  }, [activeStore, resolvePublicAssetUrl, resolveStoreIdForBranding, user]);

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
            const storedActiveStore = localStorage.getItem('activeStore');
            if (storedActiveStore) {
              try {
                const normalized = normalizeStoreSelection(JSON.parse(storedActiveStore));
                if (normalized) {
                  setActiveStore(normalized);
                } else {
                  setActiveStore(null);
                  localStorage.removeItem('activeStore');
                }
              } catch {
                setActiveStore(null);
                localStorage.removeItem('activeStore');
              }
            } else {
              setActiveStore(null);
            }
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
      } else {
        const storedActiveStore = localStorage.getItem('activeStore');
        if (storedActiveStore) {
          try {
            const normalized = normalizeStoreSelection(JSON.parse(storedActiveStore));
            if (normalized) {
              setActiveStore(normalized);
            } else {
              setActiveStore(null);
              localStorage.removeItem('activeStore');
            }
          } catch {
            setActiveStore(null);
            localStorage.removeItem('activeStore');
          }
        } else {
          setActiveStore(null);
        }
      }

      return userData;
    } finally {
      setGlobalLoading(false);
    }
  }, [normalizeStoreSelection]);

  const logout = useCallback(() => {
    setGlobalLoading(true);
    try {
      localStorage.removeItem('user');
      localStorage.removeItem('activeStore');
    } catch {
      /* ignore */
    }
    // Full navigation: clears the HttpOnly session cookie reliably behind reverse proxies and
    // avoids POST + CSRF edge cases common in split web/API/database deployments.
    const redirect = encodeURIComponent('/login');
    window.location.replace(`${window.location.origin}/api/auth/logout?redirect=${redirect}`);
    return Promise.resolve();
  }, []);

  useEffect(() => {
    if (idleLogoutMs <= 0) return undefined;
    if (loading || !user) return undefined;
    if (IDLE_AUTH_PATHS.has(location.pathname)) return undefined;

    const bumpIdle = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        logout();
      }, idleLogoutMs);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'wheel', 'visibilitychange'];
    const onActivity = () => {
      if (document.visibilityState === 'hidden') return;
      bumpIdle();
    };

    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    bumpIdle();

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
    };
  }, [user, loading, location.pathname, logout, idleLogoutMs]);

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
  }), [user, activeStore, login, logout, selectStore, loading, globalLoading, branding, refreshBranding]);
  
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
