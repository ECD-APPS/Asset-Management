import { createContext, useState, useEffect, useContext, useCallback } from 'react';
import api from '../api/axios';
import PropTypes from 'prop-types';

/* eslint-disable react-refresh/only-export-components */
const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);


export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeStore, setActiveStore] = useState(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [branding, setBranding] = useState({ logoUrl: '/logo.svg', theme: 'default' });

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
    (async () => {
      try {
        await api.get('/auth/csrf-token');
      } catch (error) {
        console.error('CSRF token fetch failed:', error);
      }
    })();

    const verifySession = async () => {
      const storedUser = localStorage.getItem('user');
      const storedActiveStore = localStorage.getItem('activeStore');

      if (storedUser) {
        try {
          // Verify session with server
          const res = await api.get('/auth/me');
          setUser(res.data); // Update with fresh data from server
          
          if (storedActiveStore) {
            setActiveStore(JSON.parse(storedActiveStore));
          }
        } catch (error) {
          // If 401/403, clear local storage (session expired/invalid)
          console.error('Session verification failed:', error);
          localStorage.removeItem('user');
          localStorage.removeItem('activeStore');
          setUser(null);
          setActiveStore(null);
        }
      }
      setLoading(false);
    };

    fetchBranding();
    verifySession();
  }, [fetchBranding]);

  useEffect(() => {
    if (loading) return;
    fetchBranding();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStore, user?._id, loading]);

  const login = async (email, password) => {
    setGlobalLoading(true);
    const response = await api.post('/auth/login', { email, password });
    const userData = response.data;
    
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);

    // If regular admin/technician, set their assigned store as active
    if (userData.role !== 'Super Admin' && userData.assignedStore) {
      setActiveStore(userData.assignedStore);
      localStorage.setItem('activeStore', JSON.stringify(userData.assignedStore));
    } else if (userData.role === 'Super Admin') {
      // Super Admin: Clear active store initially (force selection) unless we want to persist last choice
      // For now, let's clear it to force Portal selection
      setActiveStore(null);
      localStorage.removeItem('activeStore');
    }

    setGlobalLoading(false);
    return userData;
  };

  const logout = async () => {
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
  };

  const selectStore = (store) => {
    setActiveStore(store);
    localStorage.setItem('activeStore', JSON.stringify(store));
  };

  const value = {
    user,
    activeStore,
    login,
    logout,
    selectStore,
    loading,
    globalLoading,
    branding,
    refreshBranding: async () => {
      await fetchBranding();
    }
  };
  
  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

AuthProvider.propTypes = {
  children: PropTypes.node
};
