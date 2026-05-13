const CACHE = 'goggicantiere-v4-logo-import';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./storage.js','./priceLists.js','./articles.json','./manifest.webmanifest','./logo.png','./logo-full.png','./logo-monogram.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e => { if(e.request.method !== 'GET') return; e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request, copy)); return res; }).catch(()=>caches.match('./index.html')))); });
