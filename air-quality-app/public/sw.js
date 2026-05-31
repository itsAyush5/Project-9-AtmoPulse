// AtmoPulse Service Worker
// A minimal service worker that satisfies the browser's PWA installability
// requirement for offline capability via a basic network-first fetch strategy.

const CACHE_NAME = 'atmopulse-v1';

// On install: activate immediately without waiting for existing tabs to close.
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// On activate: claim all open clients so the SW takes effect right away.
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Fetch: network-first strategy.
// Try the network; if it fails (offline), fall back to the cache.
// Cache successful responses so they're available offline.
self.addEventListener('fetch', (event) => {
    // Only handle GET requests.
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Clone and store in cache for future offline use.
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            })
            .catch(() => {
                // Network failed — serve from cache if available.
                return caches.match(event.request);
            })
    );
});
