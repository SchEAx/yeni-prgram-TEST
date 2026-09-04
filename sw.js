const CACHE_NAME = "garage-stock-v3-13-1-migration-test-jwt-10-0";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./js/core.js",
  "./js/inventory.js",
  "./js/sales-dashboard.js",
  "./js/staff.js",
  "./js/sales.js",
  "./js/requests.js",
  "./js/surveys.js",
  "./js/management.js",
  "./js/purchasing.js",
  "./js/navigation.js",
  "./js/reports.js",
  "./js/migration-api.js",
  "./js/events.js",
  "./js/excel.js",
  "./app.js",
  "./manifest.webmanifest",
  "./logo.png",
  "./notification.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS).catch(() =>
        cache.addAll(ASSETS.filter((x) => !x.includes("logo.png") && !x.includes("notification.mp3")))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("garage-stock-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.hostname === "api.scheax.com.tr") {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", clone));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Depo Talebi",
    body: "1 yeni sipariş var, uygulamayı kontrol et",
    url: "/"
  };

  try {
    data = event.data.json();
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title || "Depo Talebi", {
      body: data.body || "1 yeni sipariş var",
      icon: "/logo.png",
      badge: "/logo.png",
      data: { url: data.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/"));
});
