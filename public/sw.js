// TrustiqLegal service worker: makes the app installable and keeps static assets fast.
// API responses are never cached – client data always comes live from the server.
const CACHE = 'tq-static-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/calendar/') || url.pathname.startsWith('/billing/') || url.pathname.startsWith('/webhooks/')) return

  // Versioned static assets: cache first.
  if (url.pathname.startsWith('/static/') || url.pathname.startsWith('/vendor/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok && url.searchParams.has('v')) cache.put(req, res.clone())
      return res
    })())
    return
  }

  // The app shell: network first, cached copy when offline.
  if (req.mode === 'navigate' && url.pathname === '/app') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      try {
        const res = await fetch(req)
        if (res.ok) cache.put('/app', res.clone())
        return res
      } catch {
        return (await cache.match('/app')) || Response.error()
      }
    })())
  }
})
