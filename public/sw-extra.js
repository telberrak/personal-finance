/* Extra service-worker features, loaded into the generated service worker (see vite.config.ts):
   - Web Push: payloads hold generic text only: { title, body, tag };
   - Share target: receipts shared from another app are kept in a cache for the Add screen. */

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-receipt') return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const cache = await caches.open('ledger-shared');
      const files = form.getAll('receipt').filter((f) => typeof f === 'object');
      await Promise.all(
        files.map((file, i) =>
          cache.put(
            `/shared/${Date.now()}-${i}`,
            new Response(file, { headers: { 'content-type': file.type, 'x-file-name': encodeURIComponent(file.name) } }),
          ),
        ),
      );
      return Response.redirect('/add?shared=1', 303);
    })(),
  );
});
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'Mizan';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: '/notifications' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
