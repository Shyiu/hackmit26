// Web Push for the caregiver dashboard: shows a danger or lost alert the moment
// it arrives and opens the dashboard when tapped. Registered by
// components/dashboard/push-registration.tsx; payload shape is pushPayloadSchema
// in packages/shared/src/schemas/push.ts.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = { title: "Memory glasses", body: "", url: "/dashboard", tag: undefined };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      renotify: Boolean(payload.tag),
      requireInteraction: true,
      icon: "/globe.svg",
      badge: "/globe.svg",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => client.url.startsWith(self.location.origin));
      if (open) return open.focus().then((focused) => ("navigate" in focused ? focused.navigate(url) : focused));
      return self.clients.openWindow(url);
    }),
  );
});
