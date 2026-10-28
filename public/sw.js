// Service worker: only shows nudges. No caching, so the page is never stale.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = { title: "Habits", body: "Something is still open today." };
  try { if (event.data) msg = { ...msg, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "habits-nudge",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) if ("focus" in c) return c.focus();
    return self.clients.openWindow("/");
  })());
});
