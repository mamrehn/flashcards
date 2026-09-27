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

const CACHE_NAME = 'flashcards-v7';
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
    './ws-client.js',
    './ui-dialog.js',
    './confetti.js',
    './manifest.json',
    './icon.svg',
    // Self-hosted libraries (vendor/README.md) — cached so ZIP import, the
    // library and the join QR code also work offline.
    './vendor/jszip-3.10.1.min.js',
    './vendor/qrcode-1.0.0.min.js',
    './vendor/marked-16.3.0.umd.min.js',
    './vendor/purify-3.2.7.min.js',
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

    const url = new URL(event.request.url);

    // Host audio is streamed by <audio> with Range requests: a cached full
    // response doesn't satisfy those everywhere (Safari needs 206), and 206
    // partials can't be cached. The browser's HTTP cache handles it
    // (quiz.js warms it with `cache: 'force-cache'`).
    if (url.pathname.includes('/audio/')) {
        return;
    }

    // Pages are cached without their query (?host=AB12, ?import=…, ?room=…):
    // the query only steers the app, the HTML is the same — so an invite
    // link still opens offline, and every room code doesn't add a new entry.
    const isNavigation = event.request.mode === 'navigate';
    const matchOptions = isNavigation ? { ignoreSearch: true } : undefined;
    const cacheKey = isNavigation ? url.origin + url.pathname : event.request;

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request, matchOptions).then((cachedResponse) => {
                // Start network fetch in parallel
                const networkFetch = fetch(event.request)
                    .then((networkResponse) => {
                        // Only cache complete successful responses (a 206
                        // partial would make cache.put reject).
                        if (networkResponse.status === 200) {
                            // Always refresh the cache with the fresh response
                            // (true stale-while-revalidate). The previous logic
                            // only wrote when Last-Modified changed, so an asset
                            // served without that header — or with an unchanged
                            // one despite new content — could be served stale
                            // forever until the cache name was bumped.
                            cache.put(cacheKey, networkResponse.clone()).catch(logCacheWriteError);

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
                        if (cachedResponse) return cachedResponse;
                        // Offline and never visited this page: fall back to
                        // the start page rather than the browser's error page.
                        if (isNavigation) return cache.match('./index.html');
                        return Response.error();
                    });

                // Return cached version immediately, or wait for network
                return cachedResponse || networkFetch;
            });
        })
    );
});

/**
 * Quota exceeded or similar — serving the response still works.
 * @param {Error} error
 */
function logCacheWriteError(error) {
    swLog('[Service Worker] Cache write failed:', error);
}

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
