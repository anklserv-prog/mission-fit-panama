// Service worker del portal del socio (solo /socio/): deja abrir el portal sin internet con su última versión.
// Los datos (/api/) siempre van a la red: la tarjeta y el horario nunca se muestran desactualizados.
const CACHE = 'mf-socio-v3';
const SHELL = [
  '/socio/',
  '/socio/index.html',
  '/socio/socio.css',
  '/socio/socio.js',
  '/socio/manifest.webmanifest',
  '/vendor/qrcode.js',
  '/img/icon.svg',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/img/whatsapp-logo.png',
  '/img/socio-fondo-entreno.webp',
  '/img/socio-fondo-pesas.webp',
  '/vendor/fonts/barlow-latin-400-normal.woff2',
  '/vendor/fonts/barlow-latin-500-normal.woff2',
  '/vendor/fonts/barlow-latin-600-normal.woff2',
  '/vendor/fonts/barlow-latin-700-normal.woff2',
  '/vendor/fonts/barlow-condensed-latin-600-normal.woff2',
  '/vendor/fonts/barlow-condensed-latin-700-normal.woff2',
  '/vendor/fonts/barlow-condensed-latin-800-normal.woff2',
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
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/socio/index.html'))),
  );
});
