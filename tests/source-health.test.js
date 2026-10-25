import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {PublicFeedMonitor} from '../src/public-feed.js';
import {Observations} from '../src/observations.js';
import {createApp} from '../src/server.js';

const epoch=Date.parse('2026-10-25T12:00:00Z');
const main='https://main.example.test/feed',backup='https://backup.example.test/feed';
const item=(id,text='Thanks!',parent)=>({id,url:`https://x.com/thsottiaux/status/${id}`,text,at:new Date(epoch-1000).toISOString(),...(parent?{is_reply:true,in_reply_to_tweet_id:parent}:{})});
const feed=(rows=[item('100')],extra={})=>({profile:{handle:'thsottiaux'},fetched_at:new Date(epoch).toISOString(),tweets:rows,...extra});
const json=(data,headers)=>new Response(JSON.stringify(data),{headers});
const env={PUBLIC_FEED_URL:main,PUBLIC_FEED_FALLBACK_URLS:backup};
const observation={id:'one',at:new Date(epoch-1000).toISOString(),url:'https://evidence.example.test/reset',scope:'Plus',note:'用户报告'};

test('备用源只接受不带凭证的 HTTPS，去重且最多两个，不默认接入未验证站点',()=>{
 const store=new Store(':memory:');
 try{
  assert.equal(new PublicFeedMonitor(store,()=>{}).status.sources.length,1);
  assert.equal(new PublicFeedMonitor(store,()=>{},{...env,PUBLIC_FEED_FALLBACK_URLS:backup+','+main}).status.sources.length,2);
  for(const url of ['http://bad.test','https://user:secret@bad.test'])assert.throws(()=>new PublicFeedMonitor(store,()=>{},{...env,PUBLIC_FEED_FALLBACK_URLS:url}),/HTTPS/);
  assert.throws(()=>new PublicFeedMonitor(store,()=>{},{...env,PUBLIC_FEED_FALLBACK_URLS:[backup,'https://third.test','https://fourth.test'].join(',')}),/最多/);
 }finally{store.close();}
});

test('主源正常不请求备用；主源失败后切换，源恢复后切回，跨源不重复通知',async()=>{
 const store=new Store(':memory:');const calls=[],sent=[];let now=epoch,broken=false,rows=[item('100','Day 19/ It is reset day today.')];
 const monitor=new PublicFeedMonitor(store,(e,o)=>{if(o.notify)sent.push(e.id);},env,{now:()=>now,random:()=>.5,fetchImpl:async url=>{calls.push(url);return url===main&&broken?new Response('bad',{status:503}):json(feed(rows));}});
 try{
  await monitor.check();assert.deepEqual(calls,[main]);assert.equal(sent.length,0);
  broken=true;rows.push(item('101','Done','100'));calls.length=0;
  await monitor.check({respectCooldown:true});assert.deepEqual(calls,[main,backup]);
  assert.equal(monitor.status.activeSourceUrl,backup);assert.equal(monitor.status.usingFallback,true);
  assert.deepEqual(sent,['101']);assert.equal(store.event('101').via.url,backup);
  assert.match(monitor.status.sources[0].error,/503/);assert.equal(monitor.status.sources[1].lastSuccess,new Date(now).toISOString());
  broken=false;calls.length=0;await monitor.check({respectCooldown:true});assert.deepEqual(calls,[backup]);
  now+=300000;await monitor.check({respectCooldown:true});assert.equal(monitor.status.activeSourceUrl,main);assert.equal(monitor.status.usingFallback,false);
  assert.deepEqual(sent,['101']);
 }finally{monitor.stop();store.close();}
});

test('各来源独立保存 ETag 与缓存，限流的主源不阻塞可用备用源',async()=>{
 const store=new Store(':memory:');let phase=0,now=epoch;const calls=[];
 const monitor=new PublicFeedMonitor(store,()=>{},env,{now:()=>now,random:()=>.5,fetchImpl:async(url,options)=>{
  calls.push({url,etag:options.headers['if-none-match']});
  if(phase===0)return json(feed(),{etag:'main-tag'});
  if(url===main)return new Response('limited',{status:429,headers:{'retry-after':'3600'}});
  if(phase===1)return json(feed(),{etag:'backup-tag'});
  return new Response(null,{status:304});
 }});
 try{
  await monitor.check();phase=1;await monitor.check({respectCooldown:true});
  assert.equal(calls[1].etag,'main-tag');assert.equal(calls[2].etag,undefined);
  assert.equal(monitor.status.sources[0].retryAt,new Date(epoch+3600000).toISOString());
  phase=2;now+=120000;calls.length=0;await monitor.check({respectCooldown:true});
  assert.deepEqual(calls,[{url:backup,etag:'backup-tag'}]);assert.equal(monitor.status.connected,true);
 }finally{monitor.stop();store.close();}
});

test('主源数据过期或格式错误时尝试备用，所有源失败后保留历史并显示各自原因',async()=>{
 const store=new Store(':memory:');let mode='stale';
 const monitor=new PublicFeedMonitor(store,()=>{},env,{now:()=>epoch,fetchImpl:async url=>{
  if(mode==='bad')return url===main?json({profile:{handle:'wrong'}}):new Response('no',{status:502});
  return json(feed([item('100')],url===main?{stale:true}:{}));
 }});
 try{
  await monitor.check();assert.equal(monitor.status.activeSourceUrl,backup);assert.match(monitor.status.sources[0].error,/过期/);
  const posts=store.db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
  mode='bad';await monitor.check();assert.equal(monitor.status.connected,false);assert.equal(monitor.status.activeSourceUrl,null);
  assert.match(monitor.status.sources[0].error,/格式/);assert.match(monitor.status.sources[1].error,/502/);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,posts);
 }finally{monitor.stop();store.close();}
});

test('社区源分别显示空响应成功、格式失败与恢复，关闭时不暴露旧配置错误',async()=>{
 const store=new Store(':memory:');let mode='bad';
 const obs=new Observations(store,()=>{},[main,backup],{now:()=>epoch,fetchImpl:async url=>json(url===main&&mode==='bad'?{events:[]}:{observations:[]})});
 try{
  await obs.check();let status=obs.status();assert.equal(status.sources[0].connected,false);assert.match(status.sources[0].error,/格式/);
  assert.equal(status.sources[1].connected,true);assert.equal(status.sources[1].validRecords,0);
  mode='ok';await obs.check();status=obs.status();assert.equal(status.error,null);assert.equal(status.sources[0].lastSuccess,new Date(epoch).toISOString());
  store.set('observationError','旧的错误');assert.equal(new Observations(store,()=>{}).status().error,null);
 }finally{obs.stop();store.close();}
});

test('社区限流只冷却对应来源，保留成功时间，跨源相同证据不重复提醒',async()=>{
 const store=new Store(':memory:');let now=epoch,limited=false;const calls=[],sent=[];
 const obs=new Observations(store,e=>sent.push(e),[main,backup],{now:()=>now,fetchImpl:async url=>{
  calls.push(url);if(url===main&&limited)return new Response('limited',{status:429,headers:{'retry-after':'3600'}});
  return json({observations:[{...observation,id:url===main?'first':'second'}]});
 }});
 try{
  assert.equal(await obs.check(),1);assert.equal(sent.length,1);assert.equal(sent[0].kind,'observed');assert.equal(sent[0].via.url,main);
  limited=true;now+=300000;await obs.check({respectCooldown:true});assert.equal(obs.status().sources[0].lastSuccess,new Date(epoch).toISOString());
  calls.length=0;now+=300000;await obs.check({respectCooldown:true});assert.deepEqual(calls,[backup]);assert.equal(sent.length,1);
 }finally{obs.stop();store.close();}
});

test('停止中的社区请求不再入库，重复检查不会产生并发请求',async()=>{
 const store=new Store(':memory:');let release,signal,calls=0;
 const obs=new Observations(store,()=>{throw Error('不应提醒');},[main],{now:()=>epoch,fetchImpl:async(_,options)=>{calls++;signal=options.signal;await new Promise(r=>release=r);return json({observations:[observation]});}});
 try{
  const task=obs.check();await obs.check();assert.equal(calls,1);obs.stop();assert.equal(signal.aborted,true);
  release();await task;assert.equal(store.events().length,0);
 }finally{obs.stop();store.close();}
});

test('日历 API 返回每条社区来源状态，没有配置时不会把旧记录当成启用',async()=>{
 const store=new Store(':memory:');const obs=new Observations(store,()=>{},[main],{now:()=>epoch,fetchImpl:async()=>json({observations:[]})});
 const common={store,history:{checkedAt:new Date(epoch).toISOString()},planDoc:{plan:{start:'2026-10-05',days:28},entries:[]},monitor:{status:{mode:'public'}},now:()=>epoch};
 const server=createApp({...common,observations:obs}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  await obs.check();const result=await(await fetch(`http://127.0.0.1:${server.address().port}/api/calendar`)).json();
  assert.equal(result.observations.enabled,true);assert.equal(result.observations.sources[0].connected,true);
  assert.equal(result.observations.sources[0].url,main);
 }finally{obs.stop();await new Promise(r=>server.close(r));store.close();}
});
