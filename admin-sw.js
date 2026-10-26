/* ═══════════════════════════════════════════════════════════════════════
   admin-sw.js — reçoit les notifications du Dashboard privé (26 oct. 2026)

   Sa portée est limitée à /admin.html : il ne touche ni au site ni à l'app.
   Aucun « fetch » : il ne met rien en cache et n'intercepte aucune page.
   ═══════════════════════════════════════════════════════════════════════ */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch (_) { d = { titre: 'Standix', corps: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.titre || 'Standix', {
    body: d.corps || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: '/app/icone-192.png',
    badge: '/app/favicon-32.png',
    data: { page: d.page || 'vue' },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = '/admin.html#' + ((e.notification.data && e.notification.data.page) || 'vue')
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((liste) => {
    for (const c of liste) if (c.url.includes('/admin.html')) { c.navigate(url); return c.focus() }
    return self.clients.openWindow(url)
  }))
})
