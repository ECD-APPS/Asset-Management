import axios from 'axios';
import { apiLoadingOnRequest, apiLoadingOnSettled } from '../utils/apiLoadingBus';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  timeout: 15000,
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

    apiLoadingOnRequest(config);
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => {
    apiLoadingOnSettled(response.config);
    return response;
  },
  async (error) => {
    const config = error?.config || {};
    apiLoadingOnSettled(config);
    const status = error?.response?.status;
    const method = String(config?.method || '').toLowerCase();
    const isCanceled = error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';
    const isIdempotent = method === 'get';
    const isTransient =
      !status ||
      status === 429 ||
      status >= 500 ||
      error?.code === 'ECONNABORTED' ||
      error?.message === 'Network Error';

    if (isIdempotent && isTransient && !isCanceled && !config.__retryOnce) {
      config.__retryOnce = true;
      return api.request(config);
    }
    return Promise.reject(error);
  }
);

export default api;
