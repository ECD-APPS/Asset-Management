/**
 * Minimal offline-friendly shell. Do NOT cache HTML navigations or arbitrary GETs —
 * that serves stale index.html (wrong Vite chunk names after rebuild/HMR) and the app
 * looks “stuck” until a hard refresh (Ctrl+F5) bypasses the cache.
 */
const CACHE_NAME = 'expo-stores-v2-shell';

const SHELL_PATHS = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_PATHS)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Always hit the network for documents — never return cached SPA HTML.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request));
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  const isShell =
    path === '/manifest.webmanifest' ||
    path.startsWith('/icons/');

  if (!isShell) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => null);
        }
        return response;
      });
    })
  );
});
