const CACHE='ascend-discipline-v38-remove-level-status-hold';
const ASSETS=[
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
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(
    caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      return response;
    }).catch(()=>caches.match('./index.html')))
  );
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
