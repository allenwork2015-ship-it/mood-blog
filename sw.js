const CACHE = 'shiguang-shell-v62-ver10';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './favicon.ico?v=10', './icon-16.png?v=10', './icon-32.png?v=10', './icon-180.png?v=10', './icon-192.png', './icon-512.png', './folder-sync.js', './conflict-ui.js', './performance.js', './diagnostics.js', './lazy-photos.js', './weather.js', './moon-phase.js', './weather.css', './photo-compression.js', './完整設定說明.html', './assets/tailwind.js', './assets/fontawesome.css', './webfonts/fa-solid-900.woff2', './webfonts/fa-regular-400.woff2', './webfonts/fa-brands-400.woff2'];
self.addEventListener('install', event => event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);await cache.addAll(SHELL);await self.skipWaiting();
})()));
self.addEventListener('activate', event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('shiguang-shell-')&&key!==CACHE)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch', event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.hostname==='accounts.google.com'||url.hostname==='www.googleapis.com')return;
 const staticHost=['cdn.tailwindcss.com','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
 if(url.origin!==self.location.origin&&!staticHost)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(event.request.mode==='navigate'){
   try{const response=await fetch(event.request);if(response.ok)await cache.put('./index.html',response.clone());return response;}
   catch(error){return await cache.match('./index.html')||Response.error();}
  }
  const cached=await cache.match(event.request);if(cached)return cached;
  const response=await fetch(event.request);if(response.ok||response.type==='opaque')await cache.put(event.request,response.clone());return response;
 })());
});
