// Service worker: bezsaistes kešs + Firebase push paziņojumi fonā
importScripts('./config.js');

const CACHE = 'darbi-v18';
const ASSETS = ['./', './index.html', './config.js', './manifest.json', './icons/icon-192.png', './icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Tīkls vispirms, kešs rezervei (tikai šīs vietnes GET pieprasījumi)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});

const fb = self.APP_CONFIG && self.APP_CONFIG.firebase;
if (fb && fb.apiKey) {
  importScripts(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js'
  );
  firebase.initializeApp(fb);
  firebase.messaging(); // paziņojumus ar "notification" saturu parāda automātiski
}
