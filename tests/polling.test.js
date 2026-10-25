import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {Store} from '../src/store.js';
import {PublicFeedMonitor,normalizePollMode,hasPendingReset,pollDelaySeconds} from '../src/public-feed.js';
import {DesktopNotifications} from '../src/desktop.js';
import {createApp} from '../src/server.js';

const epoch=Date.parse('2026-10-25T12:00:00Z');
const payload=now=>({profile:{handle:'thsottiaux'},fetched_at:new Date(now).toISOString(),tweets:[{id:'100',url:'https://x.com/thsottiaux/status/100',at:new Date(epoch-1000).toISOString(),text:'Thanks!'}]});
const ok=now=>new Response(JSON.stringify(payload(now)));

test('智能与固定间隔有错峰、最短保护和失败退避；旧设置安全映射',()=>{
  assert.equal(normalizePollMode(), 'smart');
  for(const value of ['',null,'invalid','0','-1'])assert.equal(normalizePollMode(undefined,value),'smart');
  assert.equal(normalizePollMode(undefined,'60'),'fast');
  assert.equal(normalizePollMode(undefined,'300'),'standard');
  assert.equal(normalizePollMode(undefined,'600'),'saver');
  const delay=options=>pollDelaySeconds({...options,random:()=>.5});
  assert.equal(delay({}),300);assert.equal(delay({pending:true}),120);
  assert.equal(delay({mode:'saver',pending:true}),900);
  assert.deepEqual([1,2,3,4,8].map(failures=>delay({mode:'fast',failures})),[300,600,1200,1800,1800]);
  assert.equal(pollDelaySeconds({mode:'fast',random:()=>0}),120);
  assert.equal(pollDelaySeconds({mode:'standard',random:()=>0}),270);
  assert.equal(pollDelaySeconds({mode:'standard',random:()=>1}),330);
});

test('智能加速只跟进最近 48 小时未落地预告，完成后恢复；旧预告保留原记录',()=>{
  const announcement={id:'a',kind:'scheduled',at:new Date(epoch-1000).toISOString()};
  assert.equal(hasPendingReset([announcement],epoch),true);
  assert.equal(hasPendingReset([announcement],epoch+48*3600000),false);
  assert.equal(hasPendingReset([announcement,{kind:'observed',at:new Date(epoch).toISOString()}],epoch),false);
  assert.equal(hasPendingReset([{...announcement,kind:'banked'}],epoch),false);
  assert.equal(hasPendingReset([{...announcement,at:new Date(epoch+1000).toISOString()}],epoch),false);
  assert.equal(announcement.kind,'scheduled');
});

test('一个后台只留一个定时器，检查中更改频率无重叠，停止后不再检查',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const store=new Store(':memory:');let now=epoch,calls=0,release;
  const monitor=new PublicFeedMonitor(store,()=>{},{},{now:()=>now,random:()=>.5,fetchImpl:async()=>{calls++;if(calls===2)await new Promise(r=>release=r);return ok(now);}});
  try{
    await monitor.start();assert.equal(calls,1);assert.equal(monitor.status.intervalSeconds,300);
    now+=300000;t.mock.timers.tick(300000);await turn();assert.equal(calls,2);
    monitor.setPollMode('fast');monitor.setPollMode('saver');await monitor.check();assert.equal(calls,2);
    release();await turn();await turn();assert.equal(monitor.status.intervalSeconds,900);
    now+=900000;t.mock.timers.tick(900000);await turn();await turn();assert.equal(calls,3);
    monitor.stop();now+=1800000;t.mock.timers.tick(1800000);await turn();assert.equal(calls,3);assert.equal(monitor.status.nextCheck,null);
    assert.equal(new PublicFeedMonitor(store,()=>{}, {PUBLIC_POLL_MODE:'fast'}).pollMode,'saver');
  }finally{monitor.stop();store.close();}
});

test('429 遵守 Retry-After，陈旧数据继续降频；成功恢复所选间隔',async()=>{
  const store=new Store(':memory:');let response=()=>ok(epoch);
  const monitor=new PublicFeedMonitor(store,()=>{}, {PUBLIC_POLL_MODE:'fast'},{now:()=>epoch,random:()=>.5,fetchImpl:async()=>response()});
  try{
    await monitor.start();
    response=()=>new Response('limited',{status:429,headers:{'retry-after':'3600'}});
    await monitor.check();assert.equal(monitor.status.intervalSeconds,3600);assert.equal(monitor.status.failureCount,1);
    monitor.setPollMode('saver');assert.equal(monitor.status.intervalSeconds,3600);
    response=()=>new Response('busy',{status:503,headers:{'retry-after':new Date(epoch+7200000).toUTCString()}});
    await monitor.check();assert.equal(monitor.status.intervalSeconds,7200);
    response=()=>ok(epoch);await monitor.check();assert.equal(monitor.status.intervalSeconds,900);assert.equal(monitor.status.failureCount,0);
    response=()=>new Response(JSON.stringify({...payload(epoch),stale:true}));
    await monitor.check();await monitor.check();await monitor.check();assert.equal(monitor.status.intervalSeconds,1200);
    response=()=>new Response(null,{status:304});await monitor.check();assert.equal(monitor.status.intervalSeconds,1800);
  }finally{monitor.stop();store.close();}
});

test('停止会中止进行中的请求，不再保存事件或安排检查',async()=>{
  const store=new Store(':memory:');let release,signal;
  const monitor=new PublicFeedMonitor(store,()=>{throw Error('Unexpected notification');},{},{now:()=>epoch,fetchImpl:async(_,options)=>{signal=options.signal;await new Promise(r=>release=r);return ok(epoch);}});
  try{
    const started=monitor.start();assert.equal(monitor.busy,true);monitor.stop();assert.equal(signal.aborted,true);
    release();await started;assert.equal(store.events().length,0);assert.equal(monitor.status.nextCheck,null);
  }finally{monitor.stop();store.close();}
});

test('休眠恢复补查一次，限流期间及短暂切换不增加请求',async()=>{
  const store=new Store(':memory:');let now=epoch,calls=0;
  const monitor=new PublicFeedMonitor(store,()=>{}, {},{now:()=>now,random:()=>.5,fetchImpl:async()=>{calls++;return ok(now);}});
  try{
    await monitor.start();now+=30000;monitor.checkForResume();assert.equal(calls,1);
    now+=150000;monitor.checkForResume();await turn();await turn();assert.equal(calls,2);
    monitor.checkForResume();assert.equal(calls,2);
    monitor.retryNotBefore=now+3600000;now+=300000;monitor.checkForResume();assert.equal(calls,2);
  }finally{monitor.stop();store.close();}
});

test('频率 API 校验同源和预设；本机保存不发请求或通知，云端不可修改',async()=>{
  const store=new Store(':memory:');let calls=0;
  const monitor=new PublicFeedMonitor(store,()=>{throw Error('Unexpected notification');},{},{fetchImpl:async()=>{calls++;return ok(epoch);}});
  const options={store,monitor,history:{checkedAt:new Date(epoch).toISOString()},planDoc:{plan:{start:'2026-10-05',days:28},entries:[]}};
  const server=createApp({...options,desktop:new DesktopNotifications(store,{send:async()=>{}})}).listen(0,'127.0.0.1');
  const cloud=createApp(options).listen(0,'127.0.0.1');
  await Promise.all([server,cloud].map(s=>new Promise(r=>s.once('listening',r))));
  const post=(s,body,origin='http://localhost:8788')=>fetch(`http://127.0.0.1:${s.address().port}/api/local/source-settings`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    assert.equal((await post(server,{pollMode:'saver'},'https://evil.test')).status,403);
    for(const pollMode of ['1',{},'constructor',null])assert.equal((await post(server,{pollMode})).status,400);
    assert.equal((await post(server,{pollMode:'saver'})).status,200);
    assert.equal(store.get('publicPollMode'),'saver');assert.equal(calls,0);
    assert.equal((await post(cloud,{pollMode:'fast'})).status,404);
  }finally{await Promise.all([server,cloud].map(s=>new Promise(r=>s.close(r))));store.close();}
});
