// The minimal service worker that makes a page installable, plus an offline fallback.
// The real cache-strategy material is in the service-workers course; this is the floor.

const CACHE = 'pwa-lab-v1';
const SHELL = ['./', './index.html', './app.js', '/shared/lab.css', '/shared/lab-ui.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// A fetch handler is REQUIRED for the install prompt: the browser wants evidence that the app
// intends to handle its own navigations.
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
