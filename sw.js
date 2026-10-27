// Service worker de Mission Fit: deja abrir la app sin internet con su última versión.
// Los datos (/api/) siempre van a la red: nunca se muestran datos viejos de clientes o caja.
const CACHE = 'mission-fit-v3';
const SHELL = [
  '/',
  '/index.html',
  '/app.css',
  '/app-extra.css',
  '/app.js',
  '/vendor/qrcode.js',
  '/vendor/jsqr.js',
  '/vendor/fonts/barlow-latin-400-normal.woff2',
  '/vendor/fonts/barlow-latin-500-normal.woff2',
  '/vendor/fonts/barlow-latin-600-normal.woff2',
  '/vendor/fonts/barlow-latin-700-normal.woff2',
  '/vendor/fonts/barlow-condensed-latin-600-normal.woff2',
  '/vendor/fonts/barlow-condensed-latin-700-normal.woff2',
  '/vendor/fonts/barlow-condensed-latin-800-normal.woff2',
  '/img/icon.svg',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Primero la red (para recibir cambios); si no hay conexión, la copia guardada.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html'))),
  );
});
