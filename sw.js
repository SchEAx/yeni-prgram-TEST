const CACHE_NAME = "garage-stock-16-1";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=16.1",
  "./js/core.js?v=16.1",
  "./js/inventory.js?v=16.1",
  "./js/sales-dashboard.js?v=16.1",
  "./js/staff.js?v=16.1",
  "./js/sales.js?v=16.1",
  "./js/requests.js?v=16.1",
  "./js/surveys.js?v=16.1",
  "./js/management.js?v=16.1",
  "./js/purchasing.js?v=16.1",
  "./js/navigation-v16.1.js?v=16.1",
  "./js/reports.js?v=16.1",
  "./js/migration-api.js?v=16.1",
  "./js/events.js?v=16.1",
  "./js/excel.js?v=16.1",
  "./js/migration-excel.js?v=16.1",
  "./app.js?v=16.1",
  "./manifest.webmanifest?v=16.1",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
  "./logo.png",
  "./notification.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn("PWA cache atlandı:", asset);
        }
      }
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(
              key =>
                key.startsWith("garage-stock-")
                && key !== CACHE_NAME
            )
            .map(key => caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API ve sürüm dosyası daima canlı ağdan.
  if (
    url.hostname === "api.scheax.com.tr"
    || url.pathname.endsWith("/version.json")
  ) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // v16.1: Cache-first tamamen kaldırıldı.
  // Ağ varsa her zaman yeni dosyayı kullan; cache sadece offline fallback.
  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (
          response
          && response.ok
          && url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => cache.put(request, clone))
            .catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (
          request.mode === "navigate"
          || request.headers.get("accept")?.includes("text/html")
        ) {
          return (
            await caches.match("./index.html")
            || await caches.match("./")
          );
        }

        throw new Error("Offline ve cache kaydı yok");
      })
  );
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Depo Talebi",
    body: "1 yeni sipariş var, uygulamayı kontrol et",
    url: "./"
  };

  try {
    data = event.data.json();
  } catch {}

  const iconUrl =
    new URL("./icons/icon-192.png", self.registration.scope).href;

  event.waitUntil(
    self.registration.showNotification(
      data.title || "Depo Talebi",
      {
        body: data.body || "1 yeni sipariş var",
        icon: iconUrl,
        badge: iconUrl,
        data: { url: data.url || "./" }
      }
    )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target =
    event.notification.data?.url
    || "./";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((windows) => {
      const existing =
        windows.find(client =>
          client.url.startsWith(self.registration.scope)
        );

      if (existing) {
        existing.focus();
        return existing.navigate(target);
      }

      return clients.openWindow(target);
    })
  );
});
