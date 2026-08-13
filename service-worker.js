const CACHE_PREFIX='ascend-discipline-';
const CACHE=`${CACHE_PREFIX}v58-profile-streak-xp-display`;
const APP_SHELL=[
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/app.js',
  './manifest.webmanifest',
  './assets/icon-192.png?v=20260803',
  './assets/icon-512.png?v=20260803',
  './assets/inapp-logo.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE)
          .map(key=>caches.delete(key))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

const cachedShellResponse=async request=>{
  const cache=await caches.open(CACHE);
  return cache.match(request,{ignoreSearch:true});
};

const cachedNavigation=async()=>{
  const cache=await caches.open(CACHE);
  return (await cache.match('./index.html'))||(await cache.match('./'));
};

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;

  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      const cached=await cachedNavigation();
      if(cached)return cached;
      try{
        const response=await fetch(request);
        if(response?.ok){
          const cache=await caches.open(CACHE);
          cache.put('./index.html',response.clone()).catch(()=>{});
        }
        return response;
      }catch(error){
        return new Response('ASCEND is not available offline yet. Open it once while connected to finish installation.',{
          status:503,
          headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
        });
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await cachedShellResponse(request);
    if(cached)return cached;

    try{
      const response=await fetch(request);
      if(response?.ok&&response.type==='basic'){
        const cache=await caches.open(CACHE);
        cache.put(request,response.clone()).catch(()=>{});
      }
      return response;
    }catch(error){
      return Response.error();
    }
  })());
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const existing=windows.find(client=>'focus' in client);
    if(existing)return existing.focus();
    return clients.openWindow(event.notification.data?.url||'./index.html');
  }));
});

self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?.json?.()||{body:event.data?.text?.()||''}}catch(error){payload={body:event.data?.text?.()||''}}
  const title=payload.title||'ASCEND Reminder';
  const options={
    body:payload.body||'A scheduled ASCEND event requires attention.',
    tag:payload.tag||`ascend-push-${Date.now()}`,
    icon:'assets/icon-192.png?v=20260803',
    badge:'assets/icon-192.png?v=20260803',
    data:{url:payload.url||'./index.html'},
    renotify:false
  };
  event.waitUntil(self.registration.showNotification(title,options));
});
