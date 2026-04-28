self.addEventListener('push', (event) => {
  if (!event.data) return;
  const { title, body, data } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/logo192.png',
      badge: '/logo192.png',
      data: data || {},
    })
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
