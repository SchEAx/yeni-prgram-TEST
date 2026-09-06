const CACHE_NAME = "garage-stock-v3-13-1-migration-test-jwt-15-9";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=15.9",
  "./js/core.js?v=15.9",
  "./js/inventory.js?v=15.9",
  "./js/sales-dashboard.js?v=15.9",
  "./js/staff.js?v=15.9",
  "./js/sales.js?v=15.9",
  "./js/requests.js?v=15.9",
  "./js/surveys.js?v=15.9",
  "./js/management.js?v=15.9",
  "./js/purchasing.js?v=15.9",
  "./js/navigation.js?v=15.9",
  "./js/reports.js?v=15.9",
  "./js/migration-api.js?v=15.9",
  "./js/events.js?v=15.9",
  "./js/excel.js?v=15.9",
  "./js/migration-excel.js?v=15.9",
  "./app.js?v=15.9",
  "./manifest.webmanifest?v=15.9",
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

  // API her zaman canlı ağdan.
  if (url.hostname === "api.scheax.com.tr") {
    event.respondWith(fetch(request));
    return;
  }

  // Sürüm kontrolü cache'e asla takılmasın.
  if (url.pathname.endsWith("/version.json")) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
    );
    return;
  }

  // HTML: network-first, offline ise cache.
  if (
    request.mode === "navigate"
    || request.headers.get("accept")?.includes("text/html")
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => cache.put("./index.html", clone))
            .catch(() => {});

          return response;
        })
        .catch(
          () =>
            caches.match("./index.html")
            || caches.match("./")
        )
    );
    return;
  }

  // Statik dosyalar: bu sürümün cache'i, yoksa ağ.
  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;

      const response = await fetch(request);

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
