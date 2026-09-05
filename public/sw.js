// Service worker mínimo: solo habilita la instalación como app (PWA).
// No cachea nada para evitar mostrar datos de ventas desactualizados.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
