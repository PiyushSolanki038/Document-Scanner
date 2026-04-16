/**
 * sw.js -- Service Worker for DocScan Pro PWA.
 * Caches static assets for offline shell, while API calls always go to network.
 */

const CACHE_NAME = "docscan-v4";
const STATIC_ASSETS = [
    "/",
    "/static/style.css",
    "/static/app.js",
    "/static/camera.js",
    "/static/jspdf.min.js",
    "/static/icon-512.png",
];

// Install: cache static shell
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Always go to network for API endpoints
    if (
        url.pathname.startsWith("/scan") ||
        url.pathname.startsWith("/detect") ||
        event.request.method !== "GET"
    ) {
        return;
    }

    // Cache-first for static assets
    event.respondWith(
        caches.match(event.request).then((cached) => {
            return (
                cached ||
                fetch(event.request).then((response) => {
                    // Cache new static resources
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                })
            );
        })
    );
});
