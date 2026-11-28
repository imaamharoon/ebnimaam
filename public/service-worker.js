const CACHE_NAME = 'ebnimaam-shell-v9';
const CACHE_PREFIX = 'ebnimaam-shell-';
const REQUIRED_SHELL = ['/store.html', '/offline.html', '/manifest.webmanifest'];
const OPTIONAL_ASSETS = [
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/ebnimaam-app-icon-192.svg',
  '/assets/ebnimaam-app-icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(REQUIRED_SHELL.map(path => cache.add(path)));
    await Promise.allSettled(OPTIONAL_ASSETS.map(path => cache.add(path)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && url.pathname === '/store.html' && !url.search) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('/store.html', response.clone());
        }
        return response;
      } catch {
        if (url.pathname === '/store.html') {
          const cachedStore = await caches.match('/store.html');
          if (cachedStore) return cachedStore;
        }
        return (await caches.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // Cache only public, versioned assets and the app manifest. Never cache account,
  // admin, order, rewards, or API responses where personal data could be present.
  const isPublicAsset = url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/_next/static/')
    || url.pathname === '/manifest.webmanifest';
  if (!isPublicAsset || url.search) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});


self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {
    payload = { title: 'Ebnimaam', body: event.data ? event.data.text() : 'You have a new update.' };
  }
  const title = String(payload.title || 'Ebnimaam').slice(0, 80);
  const body = String(payload.body || 'You have a new update.').slice(0, 220);
  const target = (() => {
    try {
      const url = new URL(String(payload.url || '/store.html'), self.location.origin);
      return url.origin === self.location.origin ? url.href : self.location.origin + '/store.html';
    } catch { return self.location.origin + '/store.html'; }
  })();
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag: String(payload.tag || 'ebnimaam-update').slice(0, 100),
    data: { url: target },
    renotify: true,
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requested = event.notification.data && event.notification.data.url;
  let target = self.location.origin + '/store.html';
  try {
    const parsed = new URL(String(requested || '/store.html'), self.location.origin);
    if (parsed.origin === self.location.origin) target = parsed.href;
  } catch {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        if (client.navigate) await client.navigate(target).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
