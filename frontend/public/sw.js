self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let title = 'APROXIMA';
  let body = '';
  let data = {};
  try {
    const payload = event.data.json();
    title = payload.title || title;
    body = payload.body || '';
    data = payload.data || {};
  } catch (_) {
    body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(title, { body, data })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const url = event.notification.data?.url || '/';
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
