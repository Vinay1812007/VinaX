/*
 * VinaX service worker — enables reliable PWA install + offline app-shell.
 * Strategy is deliberately conservative:
 *   - navigations: network-first, fall back to the cached shell when offline
 *   - hashed build assets (/assets/*): cache-first (they are immutable)
 *   - everything else (music APIs, CDN artwork, audio streams): passthrough
 * Stream URLs and API responses are NEVER cached.
 */
const CACHE = 'vinax-shell-v11';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/fonts/manrope-var.woff2'];

self.addEventListener('install', (event) => {
  // Audit finding L6: don't unconditionally call skipWaiting during install.
  // An immediate takeover can interrupt an in-flight navigation and swap the
  // controller mid-request. The page decides when it's safe to activate the
  // new worker by posting {type: 'SKIP_WAITING'} — see message handler below.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Artwork, music APIs, CDN and audio: passthrough — never intercepted, so
  // images load straight from the network exactly as if there were no service
  // worker (intercepting artwork broke first-visit + mobile covers).
  if (url.origin !== self.location.origin) return; // APIs / CDN / media: leave alone

  // App navigations: always try the network so users get fresh HTML; only
  // serve the cached shell when the network fails — or HANGS. The 2026-08-17
  // stuck-shell incident: a stalled navigation fetch throws nothing, so the
  // old handler waited forever and the tab spun on the static shell. The
  // network now gets 6 seconds; past that the request aborts and the cached
  // shell answers immediately (its hashed assets are cache-first below, so
  // the app still boots; the 4.18.4 in-page watchdog covers anything left).
  if (req.mode === 'navigate') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    event.respondWith(
      fetch(req, { signal: ctrl.signal })
        .then((res) => {
          clearTimeout(timer);
          return res;
        })
        .catch(() => {
          clearTimeout(timer);
          return caches.match('/').then((r) => r || Response.error());
        }),
    );
    return;
  }

  // Content-hashed assets never change for a given URL — safe to cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((c) =>
          c.match(req).then((cached) => {
            // Self-heal: never serve a cached HTML body for a build asset (a
            // poisoned SPA-fallback captured before the 404 guard existed).
            if (cached) {
              const ct = (cached.headers.get('content-type') || '').toLowerCase();
              if (ct.indexOf('text/html') === -1) return cached;
              c.delete(req);
            }
            // `no-cache` forces revalidation with the origin, so a poisoned
            // browser HTTP-cache entry (SPA HTML stored under an /assets/*
            // URL with `immutable` during the 2026-08-20 stuck-shell outage)
            // can never be replayed into the module graph from here.
            return fetch(req, { cache: 'no-cache' }).then((res) => {
              const rct = (res.headers.get('content-type') || '').toLowerCase();
              if (res.ok && rct.indexOf('text/html') === -1) {
                const copy = res.clone();
                c.put(req, copy);
              }
              return res;
            });
          }),
        )
        .catch(() => fetch(req)),
    );
  }
});

// --- Push notifications ---
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'VinaX';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'vinax',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
