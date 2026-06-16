/**
 * Service Worker for Flashcards PWA
 * Provides offline functionality with auto-update capability
 * Strategy: Stale-While-Revalidate for app shell, Cache First for data
 */

// Service worker has no DOM/window — debug chatter is gated by hostname only.
// Errors always go through console.error.
const SW_DEBUG =
    self.location.hostname === 'localhost' ||
    self.location.hostname === '127.0.0.1' ||
    self.location.hostname.endsWith('.local');
// eslint-disable-next-line no-console
const swLog = SW_DEBUG ? console.log.bind(console) : () => {};

const CACHE_NAME = 'flashcards-v5';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './cards.html',
    './quiz.html',
    './poll.html',
    './library.html',
    './datenschutz.html',
    './cards.css',
    './quiz.css',
    './poll.css',
    './library.css',
    './theme.css',
    './cards.js',
    './quiz.js',
    './poll.js',
    './library.js',
    './index.js',
    './sanitize.js',
    './theme.js',
    './logger.js',
    './manifest.json',
];

// Library deck files (decks/library.json and decks/*.zip) are intentionally
// NOT precached — they're fetched on demand and the stale-while-revalidate
// fetch handler below caches them lazily on first use. This keeps the install
// step fast and avoids carrying every deck for users who only want one.

// Install event - cache assets
self.addEventListener('install', (event) => {
    swLog('[Service Worker] Installing...');
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => {
                swLog('[Service Worker] Caching assets');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                swLog('[Service Worker] Installation complete');
                // Skip waiting to activate immediately
                return globalThis.skipWaiting();
            })
            .catch((error) => {
                console.error('[Service Worker] Installation failed:', error);
            })
    );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', (event) => {
    swLog('[Service Worker] Activating...');
    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            swLog('[Service Worker] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                swLog('[Service Worker] Activation complete');
                // Take control of all clients immediately
                return globalThis.clients.claim();
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
                const networkFetch = fetch(event.request)
                    .then((networkResponse) => {
                        // Only cache successful responses
                        if (networkResponse.ok) {
                            // Always refresh the cache with the fresh response
                            // (true stale-while-revalidate). The previous logic
                            // only wrote when Last-Modified changed, so an asset
                            // served without that header — or with an unchanged
                            // one despite new content — could be served stale
                            // forever until the cache name was bumped.
                            cache.put(event.request, networkResponse.clone());

                            // Best-effort "update available" signal for the
                            // in-app reload toast: only fire when we can prove
                            // the bytes changed (ETag preferred, Last-Modified
                            // fallback). When neither header is present we can't
                            // tell, so we stay quiet rather than nag on every
                            // navigation — the cache is already up to date above.
                            if (
                                cachedResponse &&
                                hasContentChanged(cachedResponse, networkResponse)
                            ) {
                                notifyClientsOfUpdate();
                            }
                        }
                        return networkResponse;
                    })
                    .catch((error) => {
                        swLog('[Service Worker] Network fetch failed, using cache:', error);
                        return cachedResponse;
                    });

                // Return cached version immediately, or wait for network
                return cachedResponse || networkFetch;
            });
        })
    );
});

/**
 * Best-effort detection of whether a freshly-fetched response differs from the
 * cached one, using validator headers. Prefers ETag (strong/weak compared
 * verbatim) and falls back to Last-Modified. Returns false when neither side
 * exposes a validator — we can't prove a change, so we don't notify.
 * @param {Response} cachedResponse
 * @param {Response} networkResponse
 * @returns {boolean}
 */
function hasContentChanged(cachedResponse, networkResponse) {
    const cachedETag = cachedResponse.headers.get('etag');
    const networkETag = networkResponse.headers.get('etag');
    if (cachedETag || networkETag) {
        return cachedETag !== networkETag;
    }
    const cachedLastModified = cachedResponse.headers.get('last-modified');
    const networkLastModified = networkResponse.headers.get('last-modified');
    if (cachedLastModified || networkLastModified) {
        return cachedLastModified !== networkLastModified;
    }
    return false;
}

/**
 * Notify all clients that an update is available
 */
function notifyClientsOfUpdate() {
    globalThis.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
            client.postMessage({ type: 'UPDATE_AVAILABLE' });
        }
    });
}

// Listen for skip waiting message from client
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        globalThis.skipWaiting();
    }
});
