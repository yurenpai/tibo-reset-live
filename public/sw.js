self.addEventListener('push',event=>{
 let data={};try{data=event.data.json();}catch{}
 event.waitUntil(self.registration.showNotification(data.title||'Tibo 重置动态',{body:data.body||'发现新的额度重置信息',tag:data.tag||'tibo-reset',data:{url:data.url||'/'}}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();let url=new URL(event.notification.data?.url||'/',self.location.origin);if(url.origin!==self.location.origin)url=new URL('/',self.location.origin);event.waitUntil(self.clients.openWindow(url.href));});
