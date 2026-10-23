import express from 'express';
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Monitor } from './monitor.js';
import { Observations } from './observations.js';
import { validSubscription, normalizeEvent } from './classify.js';
import { normalizePreferences, wantsNotification, TOPICS } from './preferences.js';
import { buildPlan, dayOf } from './plan.js';
import { partsAt, PACIFIC_ZONE } from './schedule.js';
import { dateInZone } from './public/content.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const ptDate = now => {
  const p=partsAt(new Date(now),PACIFIC_ZONE);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
};

// 只回填已经核对且带真实发帖时间的功能条目，不从计划日期编造发布时间，也不补发旧推送。
export function seedHistoricalEvents(store, history, planDoc) {
  for(const e of history.events)store.upsertHistoricalEvent(normalizeEvent({...e,historical:true}));
  // 已入库的旧版实时记录也补齐主题，保持 API、筛选与推送使用同一口径。
  for(const e of store.events()) {
    const normalized=normalizeEvent(e);
    if(JSON.stringify(normalized)!==JSON.stringify(e))store.upsertEvent(normalized);
  }
  for(const entry of planDoc.entries) {
    if(!['feature','feature_reset'].includes(entry.plannedType)||entry.status!=='reported')continue;
    const match=String(entry.sourceUrl||'').match(/^https:\/\/(?:www\.)?x\.com\/thsottiaux\/status\/(\d+)\/?$/);
    const at=new Date(entry.sourceAt);
    if(!match||!entry.sourceAt||!Number.isFinite(at.getTime())||dayOf(at,planDoc.plan)!==entry.day)continue;
    const id=`${match[1]}-feature`;
    if(store.event(id)&&!store.event(id).historical)continue;
    store.upsertHistoricalEvent({id,at:at.toISOString(),kind:'feature',topic:'feature',status:'reported',evidence:'official',planDay:entry.day,title:entry.title,note:entry.summary,url:entry.sourceUrl,sourceType:'post',historical:true});
  }
}

export function mergePreferences(existing, update) {
  const next=normalizePreferences(existing);
  if(update&&typeof update==='object'&&!Array.isArray(update)) {
    for(const key of TOPICS)if(typeof update[key]==='boolean')next[key]=update[key];
  }
  return next;
}

// 只把 Web Push 协议字段交给库；preferences 永不透传至推送服务。
export function pushSubscription(subscription) {
  const out={endpoint:subscription.endpoint,keys:{p256dh:subscription.keys.p256dh,auth:subscription.keys.auth}};
  if(subscription.expirationTime!==undefined)out.expirationTime=subscription.expirationTime;
  return out;
}

export async function deliverPending(store, send, now=Date.now()) {
  for(const job of store.jobs()) {
    const e=store.event(job.event);
    const subscription=store.subscriptions().find(s=>s.endpoint===job.endpoint);
    if(!e||!subscription||!wantsNotification(subscription.preferences,e)||(e.topic==='plan'&&e.digestDate!==ptDate(now))) {
      store.success(job);continue;
    }
    try {
      const date=dateInZone(e.at,'Asia/Shanghai');
      const url=e.topic==='plan'?`/?view=plan&planDay=${e.planDay}`:`/?date=${date}${e.topic==='feature'?'&view=all':''}`;
      await send(pushSubscription(subscription),JSON.stringify({title:e.title,body:e.note,url,tag:e.topic==='plan'?e.id:'reset-'+e.id}),{TTL:3600,timeout:10000});
      store.success(job);
    } catch(err) {
      if([404,410].includes(err.statusCode))store.unsubscribe(job.endpoint);else store.retry(job);
    }
  }
}

// PT 18:00 后每分钟检查，只汇总当日。启动时若已过 18:00，静默记下当日 ID，
// 不补发停机期间的摘要；下一日正常发送。稳定 ID 随 Store 持久化，重启不会重复。
export class DailyDigest {
  constructor(store,planDoc,onEvent=()=>{},now=()=>Date.now()) {
    this.store=store;this.planDoc=planDoc;this.onEvent=onEvent;this.now=now;this.timer=null;
  }
  tick(notify=true) {
    const now=this.now();
    const local=partsAt(new Date(now),PACIFIC_ZONE);
    if(local.hour<18)return false;
    const plan=buildPlan(this.planDoc,now,this.store.events());
    const today=plan.days.find(d=>d.date===ptDate(now));
    if(!today)return false;
    const id=`digest-${today.date}`;
    if(this.store.event(id))return false;
    const events=this.store.events().filter(e=>e.topic!=='plan'&&Date.parse(e.at)<=now&&ptDate(e.at)===today.date);
    const confirmed=events.filter(e=>e.topic==='reset'&&e.kind==='confirmed').length;
    const observed=events.filter(e=>e.kind==='observed').length;
    const features=events.filter(e=>e.topic==='feature').length;
    const e={id,at:new Date(now).toISOString(),kind:'digest',topic:'plan',evidence:'summary',status:'reported',digestDate:today.date,planDay:today.day,title:`Day ${today.day} · 每日计划摘要`,note:`太平洋时间 ${today.date}：${today.title}。官方重置确认 ${confirmed} 条，社区观测 ${observed} 条，功能更新 ${features} 条。未记录不代表没有更新；计划和预告不等于重置完成。`,sourceType:'summary',historical:!notify};
    if(this.store.addEvent(e,notify)){this.onEvent(e);return true;}
    return false;
  }
  start() {
    this.tick(false);
    this.timer=setInterval(()=>this.tick(),60000);
    this.timer.unref?.();
  }
  stop(){clearInterval(this.timer);}
}

export function createApp({store,history,planDoc,monitor,observationSources=[],pushReady=false,publicKey=null,origin='http://localhost:8788',now=()=>Date.now()}) {
  const app=express();app.disable('x-powered-by');
  app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");next();});
  app.use(express.json({limit:'8kb'}));
  const limits=new Map();
  app.use('/api',(req,res,next)=>{
    if(req.method!=='GET'){
      if(req.get('origin')!==origin)return res.status(403).json({error:'请求来源不匹配'});
      const key=req.socket.remoteAddress;const at=now();const row=limits.get(key)||{at,count:0};
      if(at-row.at>60000){row.at=at;row.count=0;}if(++row.count>30)return res.status(429).json({error:'操作过于频繁'});limits.set(key,row);
      if(limits.size>10000)for(const [ip,entry] of limits)if(at-entry.at>60000)limits.delete(ip);
    }next();
  });
  app.get('/api/calendar',(req,res)=>{const events=store.events();res.set('Cache-Control','no-store').json({events,plan:buildPlan(planDoc,now(),events),status:monitor.status,observations:{enabled:observationSources.length>0,checkedAt:store.get('observationCheck')||null,error:store.get('observationError')||null},historyCheckedAt:history.checkedAt,lastCheck:store.get('lastCheck')||null,pushReady,publicKey:pushReady?publicKey:null});});
  app.post('/api/subscribe',(req,res)=>{
    if(!pushReady)return res.status(503).json({error:'维护者尚未配置浏览器推送'});
    if(!validSubscription(req.body))return res.status(400).json({error:'无效的浏览器推送订阅'});
    const existing=store.subscriptions().find(s=>s.endpoint===req.body.endpoint);
    const preferences=mergePreferences(existing?.preferences,req.body.preferences);
    store.subscribe({...pushSubscription(req.body),preferences});res.json({ok:true,preferences});
  });
  app.post('/api/preferences',(req,res)=>{
    if(typeof req.body?.endpoint!=='string')return res.sendStatus(400);
    const existing=store.subscriptions().find(s=>s.endpoint===req.body.endpoint);
    if(!existing)return res.status(404).json({error:'找不到该订阅'});
    res.set('Cache-Control','no-store');
    if(!Object.hasOwn(req.body,'preferences'))return res.json({ok:true,preferences:normalizePreferences(existing.preferences)});
    if(!req.body.preferences||typeof req.body.preferences!=='object'||Array.isArray(req.body.preferences))return res.status(400).json({error:'无效的通知偏好'});
    const preferences=mergePreferences(existing.preferences,req.body.preferences);
    store.subscribe({...existing,preferences});res.json({ok:true,preferences});
  });
  app.post('/api/unsubscribe',(req,res)=>{if(typeof req.body?.endpoint!=='string')return res.sendStatus(400);store.unsubscribe(req.body.endpoint);res.json({ok:true});});
  app.use(express.static(path.join(root,'public'),{index:'index.html'}));
  app.use((err,req,res,next)=>res.status(400).json({error:'请求格式不正确'}));
  return app;
}

export function startServer(env=process.env) {
  fs.mkdirSync(path.join(root,'data'),{recursive:true});
  const store=new Store(path.join(root,'data','calendar.sqlite'));
  const history=JSON.parse(fs.readFileSync(path.join(root,'history.json'),'utf8'));
  const planDoc=JSON.parse(fs.readFileSync(path.join(root,'plan-data.json'),'utf8'));
  seedHistoricalEvents(store,history,planDoc);
  const origin=env.PUBLIC_ORIGIN||'http://localhost:8788';
  const pushReady=!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY);
  if(pushReady)webpush.setVapidDetails(env.VAPID_SUBJECT||'mailto:owner@example.com',env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  let delivering=false;
  async function deliver(){
    if(!pushReady||delivering)return;delivering=true;
    try{await deliverPending(store,(...args)=>webpush.sendNotification(...args));}finally{delivering=false;}
  }
  const onEvent=()=>{deliver().catch(()=>{});};
  const monitor=new Monitor(store,onEvent,env);
  const observationSources=(env.OBSERVATION_SOURCES||'').split(',').map(s=>s.trim()).filter(s=>/^https:\/\//.test(s));
  const observations=new Observations(store,onEvent,observationSources);
  const digest=new DailyDigest(store,planDoc,onEvent);
  const app=createApp({store,history,planDoc,monitor,observationSources,pushReady,publicKey:env.VAPID_PUBLIC_KEY,origin});
  const server=app.listen(Number(env.PORT)||8788,'0.0.0.0',()=>console.log('Local: http://localhost:'+(env.PORT||8788)));
  const retry=setInterval(()=>deliver().catch(()=>{}),30000);
  monitor.start().catch(e=>{console.error(e.message);});
  observations.start();digest.start();
  function shutdown(){monitor.stop();observations.stop();digest.stop();clearInterval(retry);server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(0),2000).unref();}
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
  return {app,server,store,monitor,observations,digest};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer();
