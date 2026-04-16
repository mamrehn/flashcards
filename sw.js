/**
 * Service Worker for Flashcards PWA
 * Provides offline functionality with auto-update capability
 * Strategy: Stale-While-Revalidate for app shell, Cache First for data
 */

const CACHE_NAME = 'flashcards-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './cards.html',
    './quiz.html',
    './library.html',
    './datenschutz.html',
    './cards.css',
    './quiz.css',
    './library.css',
    './theme.css',
    './cards.js',
    './quiz.js',
    './library.js',
    './index.js',
    './sanitize.js',
    './theme.js',
    './manifest.json'
];

// Library deck files (decks/library.json and decks/*.zip) are intentionally
// NOT precached — they're fetched on demand and the stale-while-revalidate
// fetch handler below caches them lazily on first use. This keeps the install
// step fast and avoids carrying every deck for users who only want one.

// Install event - cache assets
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching assets');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                console.log('[Service Worker] Installation complete');
                // Skip waiting to activate immediately
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[Service Worker] Installation failed:', error);
            })
    );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('[Service Worker] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('[Service Worker] Activation complete');
                // Take control of all clients immediately
                return self.clients.claim();
            })
    );
});

/**
 * Fetch event - Stale-While-Revalidate strategy
 * 1. Return cached version immediately (fast)
 * 2. Fetch fresh version in background
 * 3. Update cache and notify clients if content changed
 */
self.addEventListener('fetch', (event) => {
    // Skip cross-origin requests
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // Only handle GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((cachedResponse) => {
                // Start network fetch in parallel
                const networkFetch = fetch(event.request).then((networkResponse) => {
                    // Only cache successful responses
                    if (networkResponse.ok) {
                        // Clone before caching
                        const responseToCache = networkResponse.clone();

                        // Check if content has changed
                        if (cachedResponse) {
                            // Compare Last-Modified timestamps to detect changes
                            const cachedLastModified = cachedResponse.headers.get('last-modified');
                            const networkLastModified = networkResponse.headers.get('last-modified');

                            if (cachedLastModified !== networkLastModified) {
                                // Content changed - update cache and notify
                                cache.put(event.request, responseToCache);
                                notifyClientsOfUpdate();
                            }
                        } else {
                            // No cached version - just cache it
                            cache.put(event.request, responseToCache);
                        }
                    }
                    return networkResponse;
                }).catch((error) => {
                    console.log('[Service Worker] Network fetch failed, using cache:', error);
                    return cachedResponse;
                });

                // Return cached version immediately, or wait for network
                return cachedResponse || networkFetch;
            });
        })
    );
});

/**
 * Notify all clients that an update is available
 */
function notifyClientsOfUpdate() {
    self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
            client.postMessage({ type: 'UPDATE_AVAILABLE' });
        });
    });
}

// Listen for skip waiting message from client
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
