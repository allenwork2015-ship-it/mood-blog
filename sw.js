const PREFIX = 'shiguang-shell-'+encodeURIComponent(new URL('./',self.location.href).pathname)+'-';
const CACHE = PREFIX+'ver25';
const SHELL = ["./mobile-book-input.js?v=25","./progressive-photos.js?v=25","./","./index.html","./manifest.webmanifest?v=25","./完整設定說明.html","./icon.svg","./favicon.ico?v=11","./icon-16.png?v=11","./icon-32.png?v=11","./icon-180.png?v=11","./icon-192.png","./icon-512.png","./assets/tailwind.js?v=25","./assets/fontawesome.css?v=25","./weather.css?v=25","./photo-compression.js?v=25","./moon-phase.js?v=25","./folder-sync.js?v=25","./conflict-ui.js?v=25","./performance.js?v=25","./diagnostics.js?v=25","./lazy-photos.js?v=25","./local-folder-loading.js?v=25","./local-folder-import.js?v=25","./journal-persistence.js?v=25","./photo-batch.js?v=25","./journal-book.js?v=25","./book-pagination.js?v=25","./book-home.js?v=25","./free-book-editor.js?v=25","./book-sync.js?v=25","./journal-conflicts.js?v=25","./journal-editor-bridge.js?v=25","./weather.js?v=25","./book-home.css?v=25","./book-window.css?v=25","./book-window.js?v=25","./memory-film.js?v=25","./memories.js?v=25","./memories.css?v=25","./journal-book.css?v=25","./drive-performance.js?v=25","./photo-maintenance.js?v=25","./webfonts/fa-brands-400.woff2","./webfonts/fa-regular-400.woff2","./webfonts/fa-solid-900.woff2"];
self.addEventListener('install', event => event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);await cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload'})));await self.skipWaiting();
})()));
self.addEventListener('activate', event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
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
   const home=new URL('./',self.location.href).pathname,isHome=url.pathname===home||url.pathname===home+'index.html';
   try{const response=await fetch(event.request);if(response.ok)await cache.put(isHome?'./index.html':event.request,response.clone());return response;}
   catch(error){return await cache.match(isHome?'./index.html':event.request)||Response.error();}
  }
  const cached=await cache.match(event.request);if(cached)return cached;
  const response=await fetch(event.request);if(response.ok||response.type==='opaque')await cache.put(event.request,response.clone());return response;
 })());
});
