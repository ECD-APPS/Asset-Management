import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
});

api.interceptors.request.use(
  (config) => {
    let activeStore = null;

    try {
      const storedActiveStore = localStorage.getItem('activeStore');
      if (storedActiveStore) activeStore = JSON.parse(storedActiveStore);
    } catch (e) {
      console.error('Error parsing localStorage:', e);
      localStorage.removeItem('activeStore');
    }

    if (activeStore) {
      // If activeStore is an object, use _id, otherwise use it directly if it's a string
      const storeId = activeStore._id || activeStore;
      config.headers['x-active-store'] = storeId;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

export default api;
