import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from './AuthContext';

/* eslint-disable react-refresh/only-export-components */
const ThemeContext = createContext(null);

const STORAGE_KEY = 'expo_theme';

export const THEMES = [
  'default',
  'ocean',
  'emerald',
  'sunset',
  'midnight',
  'mono'
];

const resolveTheme = (value) => (THEMES.includes(value) ? value : 'default');

export const ThemeProvider = ({ children }) => {
  const { branding } = useAuth();
  const [theme, setThemeState] = useState(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const fromDataset = document.documentElement.dataset.theme;
    return resolveTheme(saved || fromDataset || 'default');
  });

  useEffect(() => {
    const safe = resolveTheme(theme);
    document.documentElement.dataset.theme = safe;
    window.localStorage.setItem(STORAGE_KEY, safe);
  }, [theme]);

  useEffect(() => {
    const incoming = resolveTheme(branding?.theme);
    setThemeState((prev) => (prev === incoming ? prev : incoming));
  }, [branding?.theme]);

  const setTheme = (nextTheme) => {
    setThemeState(resolveTheme(nextTheme));
  };

  const value = useMemo(() => ({
    theme,
    setTheme,
    themes: THEMES
  }), [theme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

ThemeProvider.propTypes = {
  children: PropTypes.node
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
};

