import { createContext, useState, useEffect, useContext } from 'react';
import api from '../api/axios';
import PropTypes from 'prop-types';

/* eslint-disable react-refresh/only-export-components */
const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);


export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeStore, setActiveStore] = useState(null);

  useEffect(() => {
    // Ensure CSRF token cookie is present
    (async () => {
      try {
        await api.get('/auth/csrf-token');
      } catch (e) {
        // noop
      }
    })();
    const storedUser = localStorage.getItem('user');
    const storedActiveStore = localStorage.getItem('activeStore');
    
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    if (storedActiveStore) {
      setActiveStore(JSON.parse(storedActiveStore));
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
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

    return userData;
  };

  const logout = () => {
    // Clear cookie session on server
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('user');
    localStorage.removeItem('activeStore');
    setUser(null);
    setActiveStore(null);
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
    loading
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
