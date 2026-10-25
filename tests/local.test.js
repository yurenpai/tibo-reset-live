import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {PublicFeedMonitor,parsePublicFeed} from '../src/public-feed.js';
import {DesktopNotifications} from '../src/desktop.js';
import {Monitor} from '../src/monitor.js';
import {createApp,seedHistoricalEvents} from '../src/server.js';
import {classify} from '../src/classify.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resetAppearance} from '../public/theme.js';

const now=Date.parse('2026-10-24T00:00:00Z');
const item=(id,text,parent)=>({id,url:`https://x.com/thsottiaux/status/${id}`,text,at:new Date(now-1000).toISOString(),is_reply:!!parent,in_reply_to_tweet_id:parent});
const payload=tweets=>({profile:{handle:'thsottiaux'},fetched_at:new Date(now).toISOString(),tweets});
const reply=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});

test('免登录公共源严格校验账号、父帖、发布时间，不信任上游完成标签',()=>{
  const p=payload([item('10','Day 19/ It is reset day today.'),{...item('11','We have reset all accounts.'),url:'https://x.com/other/status/11'},item('12','Done','10'),{...item('13','future'),at:new Date(now+600000).toISOString()},{...item('14','Done'),is_reply:true}]);
  const parsed=parsePublicFeed(p,'thsottiaux',now);
  assert.deepEqual(parsed.posts.map(p=>p.id),['10','12']);assert.equal(parsed.stale,false);
  assert.equal(parsed.posts[1].referenced_tweets[0].id,'10');
  assert.throws(()=>parsePublicFeed({...p,profile:{handle:'someone'}}));
  assert.throws(()=>parsePublicFeed({...p,fetched_at:null}));
  assert.throws(()=>parsePublicFeed(payload([]),'thsottiaux',now));
  assert.equal(parsePublicFeed({...p,stale:true},'thsottiaux',now).stale,true);
});

test('公共源首次静默建立基线、回复链完成推送一次、重启不群发',async()=>{
  const store=new Store(':memory:');store.subscribe({endpoint:'browser',preferences:{confirmed:true}});
  const notified=[];let rows=[item('100','Day 19/ It is reset day today.')];
  const make=()=>new PublicFeedMonitor(store,(event,options)=>notified.push({event,options}),{}, {now:()=>now,fetchImpl:async()=>reply(payload(rows))});
  try{
    const m=make();await m.check();assert.equal(store.jobs().length,0);assert.equal(notified[0].options.notify,false);
    rows=[...rows,item('101','Done','100')];await m.check();await m.check();
    assert.equal(store.event('101').kind,'confirmed');assert.equal(store.event('101').via.type,'public-feed');assert.equal(store.jobs().length,1);
    assert.equal(notified.filter(x=>x.options.notify).length,1);
    await make().check();assert.equal(store.jobs().length,1);
    assert.equal(m.status.mode,'public');assert.equal(m.status.connected,true);
  }finally{store.close();}
});

test('公共源过期、限流和格式错误可见；旧帖及上游 confirmed 不产生假通知',async()=>{
  const store=new Store(':memory:');store.subscribe({endpoint:'browser',preferences:{confirmed:true}});
  let response=()=>reply(payload([item('200','Day 19/ It is reset day today.')]));
  const m=new PublicFeedMonitor(store,()=>{}, {},{now:()=>now,fetchImpl:async()=>response()});
  try{
    await m.check();
    response=()=>reply({...payload([{...item('201','The reset will be completed tomorrow.'),confirmed:true}]),stale:true});
    await m.check();assert.equal(m.status.connected,false);assert.match(m.status.error,/过期/);assert.equal(store.jobs().length,0);assert.equal(store.event('201').kind,'scheduled');
    response=()=>new Response('blocked',{status:429});await m.check();assert.match(m.status.error,/429/);assert.equal(m.status.connected,false);
    response=()=>reply({tweets:[]});await m.check();assert.match(m.status.error,/格式/);
    response=()=>reply(payload([item('202','We have reset all accounts.')]));await m.check();assert.equal(m.status.connected,true);assert.equal(m.status.error,null);assert.equal(store.jobs().length,1);
    response=()=>new Response(null,{status:304});await m.check();assert.equal(m.status.connected,true);
  }finally{store.close();}
});

test('未来和否定的重置完成语句不触发确认',()=>{
  assert.equal(classify({text:'The reset will be completed tomorrow.'}).kind,'scheduled');
  for(const text of ['The reset has not been completed yet.','We have not reset all accounts yet.',"We haven't reset all accounts."])assert.equal(classify({text}),null);
  assert.equal(classify({text:'The reset has been completed.'}).kind,'confirmed');
  assert.notEqual(classify({text:'Should we reset all accounts?'}).kind,'confirmed');
  assert.equal(classify({text:'Day 19/ Reset'}).kind,'scheduled');
  assert.equal(classify({text:"Day 19/ Still cooking... and reset. Enjoy. https://t.co/test"}).kind,'confirmed');
});

test('重启回填保留实时回复窗口；删除的父帖不会阻塞后续重置',async()=>{
  const s=new Store(':memory:');
  const history={events:[{id:'300',kind:'scheduled',at:new Date(now-10000).toISOString()}]};
  try{
    seedHistoricalEvents(s,history,{entries:[]});const m=new Monitor(s,()=>{},{});m.userId='tibo';
    await m.enqueue({id:'301',author_id:'tibo',created_at:new Date(now-5000).toISOString(),text:'Lands tomorrow before 10am PST.',referenced_tweets:[{type:'replied_to',id:'300'}]});
    seedHistoricalEvents(s,history,{entries:[]});assert.equal(s.event('300').followUps.length,1);assert.ok(s.event('300').windowEnd);
    m.api=async route=>{if(route.startsWith('users/'))return {data:[{id:'302',author_id:'tibo',created_at:new Date(now-3000).toISOString(),text:'Thanks!',referenced_tweets:[{type:'replied_to',id:'missing'}]},{id:'303',author_id:'tibo',created_at:new Date(now-2000).toISOString(),text:'We have reset all accounts.'}]};throw Object.assign(Error('not found'),{status:404});};
    await m.catchup();assert.equal(s.event('303').kind,'confirmed');assert.equal(s.get('cursor'),'303');
  }finally{s.close();}
});

test('桌面偏好独立持久化，通知去重且关闭页面不影响后台处理',async()=>{
  const s=new Store(':memory:');const sent=[];const desktop=new DesktopNotifications(s,{now:()=>now,send:async message=>sent.push(message)});
  try{
    const event={id:'desktop',kind:'confirmed',at:new Date(now-1000).toISOString(),title:'reset',note:'done'};
    desktop.event(event);await desktop.chain;assert.equal(sent.length,0);
    desktop.save({enabled:true,preferences:{feature:true}});desktop.event(event);desktop.event(event);await desktop.chain;assert.equal(sent.length,1);
    const restarted=new DesktopNotifications(s,{now:()=>now,send:async m=>sent.push(m)});restarted.event(event);await restarted.chain;assert.equal(sent.length,1);
    assert.equal(restarted.settings().preferences.feature,true);
    desktop.save({enabled:false});desktop.event({...event,id:'disabled'});await desktop.chain;assert.equal(sent.length,1);
    await desktop.test();assert.equal(sent.length,2);assert.ok(desktop.status().lastAccepted);
  }finally{s.close();}
});

test('本机通知接口需要同源，云部署不暴露桌面控制，测试通知不写事件',async()=>{
  const s=new Store(':memory:');const desktop=new DesktopNotifications(s,{send:async()=>{}});
  const options={store:s,history:{checkedAt:new Date(now).toISOString()},planDoc:{plan:{start:'2026-10-05',days:28},entries:[]},monitor:{status:{mode:'public'}},desktop};
  const server=createApp(options).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const post=(path,body,origin='http://localhost:8788')=>fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post('/api/local/preferences',{enabled:true},'https://evil.test')).status,403);
    assert.equal((await post('/api/local/preferences',{enabled:true})).status,200);
    assert.equal(desktop.settings().enabled,true);
    assert.equal((await post('/api/local/test-notification',{})).status,200);assert.equal(s.events().length,0);
    assert.equal((await (await fetch(base+'/api/health')).json()).local,true);
    for(const asset of ['/','/app.js','/style.css','/assets/saint-tibo-card.jpg']){
      const response=await fetch(base+asset);assert.equal(response.status,200,`静态资源路径失效：${asset}`);await response.arrayBuffer();
    }
  }finally{await new Promise(r=>server.close(r));s.close();}
});

test('磁盘关闭再打开后，预告/观测/提醒偏好/源游标/去重记录全部保留',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-persistence-'));
 const file=path.join(folder,'calendar.sqlite');let s;
 try{
  s=new Store(file);
  s.addEvent({id:'observed',at:new Date(now-2*86400000).toISOString(),kind:'observed',topic:'reset'});
  s.addEvent({id:'announced',at:new Date(now-86400000).toISOString(),kind:'scheduled',topic:'reset',windowEnd:new Date(now-1000).toISOString()});
  const desktop=new DesktopNotifications(s);desktop.save({enabled:true,preferences:{feature:true}});
  s.set('publicFeedInitialized','1');s.set('publicFeedCursor','100');s.set('desktopSent:observed','sent');s.close();s=null;
  s=new Store(file);assert.equal(s.events().length,2);assert.equal(s.get('publicFeedCursor'),'100');assert.equal(s.get('desktopSent:observed'),'sent');
  assert.equal(new DesktopNotifications(s).settings().enabled,true);assert.equal(new DesktopNotifications(s).settings().preferences.feature,true);
  assert.equal(resetAppearance(s.events(),now).pending,true);assert.equal(resetAppearance(s.events(),now).overdue,true);
 }finally{if(s)s.close();for(const name of ['calendar.sqlite','calendar.sqlite-wal','calendar.sqlite-shm']){const target=path.join(folder,name);if(fs.existsSync(target))fs.unlinkSync(target);}fs.rmdirSync(folder);}
});
