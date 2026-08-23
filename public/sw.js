/* eslint-disable */
/* global self, caches, fetch, location */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', e => {
  // cache-first for assets, network for api
  e.respondWith(caches.open('audiovisor-v4').then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => {
    if (e.request.url.startsWith(location.origin)) c.put(e.request, res.clone());
    return res;
  }))));
});
