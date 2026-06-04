const CACHE = 'trail-flythrough-v1';

// App shell assets to pre-cache on install
const PRECACHE = [
  '/',
  '/index.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  // Only cache same-origin GET requests; pass through all API/tile requests
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname !== self.location.hostname) return;

  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
        return response;
      });
    }),
  );
});
