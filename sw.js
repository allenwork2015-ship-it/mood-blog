const CACHE = 'shiguang-shell-v71-ver19';
const SHELL = ["./","./index.html","./manifest.webmanifest?v=19","./完整設定說明.html","./icon.svg","./favicon.ico?v=11","./icon-16.png?v=11","./icon-32.png?v=11","./icon-180.png?v=11","./icon-192.png","./icon-512.png","./assets/tailwind.js?v=19","./assets/fontawesome.css?v=19","./weather.css?v=19","./photo-compression.js?v=19","./moon-phase.js?v=19","./folder-sync.js?v=19","./conflict-ui.js?v=19","./performance.js?v=19","./diagnostics.js?v=19","./lazy-photos.js?v=19","./local-folder-loading.js?v=19","./local-folder-import.js?v=19","./journal-persistence.js?v=19","./photo-batch.js?v=19","./journal-book.js?v=19","./book-pagination.js?v=19","./book-home.js?v=19","./free-book-editor.js?v=19","./book-sync.js?v=19","./journal-conflicts.js?v=19","./journal-editor-bridge.js?v=19","./weather.js?v=19","./book-home.css?v=19","./journal-book.css?v=19","./webfonts/fa-brands-400.woff2","./webfonts/fa-regular-400.woff2","./webfonts/fa-solid-900.woff2"];
self.addEventListener('install', event => event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);await cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload'})));await self.skipWaiting();
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
