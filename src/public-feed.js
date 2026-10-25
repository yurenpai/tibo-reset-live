import { Monitor } from './monitor.js';

export const DEFAULT_PUBLIC_FEED='https://codex-reset.com/api/feed';
const MAX_AGE=15*60000;
const MAX_BYTES=2*1024*1024;
export const POLL_PROFILES=Object.freeze({
  smart:{label:'智能检查',idle:300,pending:120},
  fast:{label:'快速',idle:120,pending:120},
  standard:{label:'标准',idle:300,pending:300},
  saver:{label:'省流',idle:900,pending:900}
});
const decode=text=>text.replace(/&(?:amp|lt|gt|quot|apos|#39);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"})[s]).replace(/\\n/g,'\n');

export function normalizePollMode(value,legacySeconds) {
  if(Object.hasOwn(POLL_PROFILES,value))return value;
  const seconds=Number(legacySeconds);
  if(legacySeconds!==undefined&&legacySeconds!==null&&String(legacySeconds).trim()&&Number.isFinite(seconds)&&seconds>0)return seconds<=120?'fast':seconds<=300?'standard':'saver';
  return 'smart';
}

export function hasPendingReset(events,now=Date.now()) {
  const valid=events.filter(e=>(!e.topic||e.topic==='reset')&&Number.isFinite(Date.parse(e.at))&&Date.parse(e.at)<=now);
  const latest=kinds=>valid.filter(e=>kinds.includes(e.kind)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0]||null;
  const announcement=latest(['scheduled']),completed=latest(['confirmed','observed','timed']);
  // 旧预告继续留在日历中，但最多为它加速检查 48 小时。
  return !!announcement&&now-Date.parse(announcement.at)<48*3600000&&(!completed||Date.parse(announcement.at)>Date.parse(completed.at));
}

export function pollDelaySeconds({mode='smart',pending=false,failures=0,random=Math.random}={}) {
  const profile=POLL_PROFILES[normalizePollMode(mode)];
  const base=pending?profile.pending:profile.idle;
  const backedOff=failures>0?Math.min(1800,Math.max(base,300*2**Math.min(failures-1,3))):base;
  return Math.min(1800,Math.max(120,Math.round(backedOff*(.9+Math.max(0,Math.min(1,random()))*.2))));
}

// 只接受指定账号的原帖链接、原文和明确的发布时间。上游的 confirmed 等判断不导入。
export function parsePublicFeed(payload,handle='thsottiaux',now=Date.now()) {
  if(payload?.profile?.handle?.toLowerCase()!==handle.toLowerCase()||!Array.isArray(payload.tweets))throw Error('公共源格式或账号不匹配');
  const fetchedAt=Date.parse(payload.fetched_at);
  if(!Number.isFinite(fetchedAt)||fetchedAt>now+300000)throw Error('公共源更新时间无效');
  const seen=new Set();const posts=[];
  for(const item of payload.tweets.slice(0,200)) {
    const match=String(item.url||'').match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([\w]+)\/status\/(\d+)\/?$/i);
    const at=Date.parse(item.at);
    if(!match||match[1].toLowerCase()!==handle.toLowerCase()||String(item.id)!==match[2]||!Number.isFinite(at)||at>now||typeof item.text!=='string'||!item.text.trim()||seen.has(item.id))continue;
    const parent=String(item.in_reply_to_tweet_id||'');
    // 回复缺失父帖 ID 时不猜测与任意重置的关联。
    if(item.is_reply&&!/^\d+$/.test(parent))continue;
    seen.add(item.id);
    posts.push({id:String(item.id),author_id:`public:${handle.toLowerCase()}`,created_at:new Date(at).toISOString(),text:decode(item.text.slice(0,20000)),...(item.is_reply?{referenced_tweets:[{type:'replied_to',id:parent}]}:{})});
  }
  if(!posts.length)throw Error('公共源没有可核对的有效帖子');
  posts.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
  return {posts,fetchedAt:new Date(fetchedAt).toISOString(),stale:payload.stale===true||now-fetchedAt>MAX_AGE};
}

export class PublicFeedMonitor extends Monitor {
  constructor(store,onEvent,env={}, {fetchImpl=fetch,now=()=>Date.now(),random=Math.random}={}) {
    super(store,onEvent,env);
    this.userId=`public:${this.handle.toLowerCase()}`;
    this.fetchImpl=fetchImpl;this.now=now;this.random=random;
    this.url=env.PUBLIC_FEED_URL||DEFAULT_PUBLIC_FEED;
    const urls=[...new Set([this.url,...(env.PUBLIC_FEED_FALLBACK_URLS||'').split(',').map(s=>s.trim()).filter(Boolean)])];
    if(urls.length>3)throw Error('最多配置一个主源和两个备用源');
    this.sources=urls.map((url,index)=>{
      const parsed=new URL(url);
      if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('公共源必须使用不带凭证的 HTTPS 地址');
      return {url,role:index?'fallback':'primary',connected:false,stale:true,lastCheck:null,lastSuccess:null,upstreamAt:null,error:null,retryAt:null};
    });
    this.sourceCache=new Map();
    this.pollMode=normalizePollMode(store.get('publicPollMode')||env.PUBLIC_POLL_MODE,env.PUBLIC_POLL_SECONDS);
    this.batch=new Map();this.busy=false;this.running=false;this.failures=0;this.retryNotBefore=0;
    this.status={mode:'public',configured:true,connected:false,label:'公共源定时检查',sourceUrl:this.url,pollMode:this.pollMode,pollLabel:POLL_PROFILES[this.pollMode].label,intervalSeconds:null,nextCheck:null,failureCount:0,lastCheck:null,lastSuccess:null,upstreamAt:null,newestPostAt:null,stale:true,error:null,coverage:'第三方收录，可能延迟或遗漏；不保证完整覆盖主帖和回复'};
    Object.assign(this.status,{sources:this.sources,activeSourceUrl:null,usingFallback:false});
  }
  setPollMode(value) {
    if(!Object.hasOwn(POLL_PROFILES,value))throw Error('不支持的检查频率');
    this.pollMode=value;this.store.set('publicPollMode',value);
    this.status.pollMode=value;this.status.pollLabel=POLL_PROFILES[value].label;
    if(this.running&&!this.busy)this.schedule();
    return this.status;
  }
  schedule() {
    clearTimeout(this.poll);
    if(this.stopped||!this.running)return;
    const pending=hasPendingReset(this.store.events(),this.now());
    const seconds=pollDelaySeconds({mode:this.pollMode,pending,failures:this.failures,random:this.random});
    const next=Math.max(this.now()+seconds*1000,this.retryNotBefore);
    this.status.intervalSeconds=Math.ceil((next-this.now())/1000);this.status.nextCheck=new Date(next).toISOString();
    this.status.failureCount=this.failures;
    this.poll=setTimeout(()=>this.check({respectCooldown:true}),Math.max(0,next-this.now()));
    this.poll.unref?.();
  }
  checkForResume() {
    const at=this.now(),gap=at-this.lastWakeCheck;this.lastWakeCheck=at;
    // 休眠恢复或系统长时间暂停后补查一次；仍遵守最短间隔与 Retry-After。
    if(gap>90000&&at-Date.parse(this.status.lastCheck)>=120000&&at>=this.retryNotBefore&&!this.busy&&!this.stopped)this.check({respectCooldown:true});
  }
  // 公共源只使用当前批次和本地上下文，绝不偷偷调用需要 Token 的 X API。
  async api(route){const id=route.match(/^tweets\/(\d+)/)?.[1];return {data:this.batch.get(id)||null};}
  async readSource(source) {
    const cache=this.sourceCache.get(source.url)||{failures:0};
    this.sourceCache.set(source.url,cache);
    source.lastCheck=this.status.lastCheck;
    try{
      const response=await this.fetchImpl(source.url,{headers:{accept:'application/json','user-agent':'TiboResetLive/0.2 (+https://github.com/yurenpai/tibo-reset-live)',...(cache.etag?{'if-none-match':cache.etag}:{})},signal:AbortSignal.any([this.requestAbort.signal,AbortSignal.timeout(15000)])});
      if(this.stopped)throw Error('监测已停止');
      let parsed;
      if(response.status===304){
        if(!cache.parsed)throw Error('公共源返回 304，但本机没有可复用的数据');
        parsed={...cache.parsed,stale:cache.parsed.stale||this.now()-Date.parse(cache.parsed.fetchedAt)>MAX_AGE};
      }else{
        if(!response.ok){
          const retry=response.headers.get('retry-after');
          const delay=retry&&/^\d+$/.test(retry.trim())?Number(retry)*1000:null;
          const deadline=delay!==null?this.now()+delay:Date.parse(retry);
          if(Number.isFinite(deadline)&&deadline>this.now())source.retryAt=new Date(Math.min(deadline,this.now()+2147483000)).toISOString();
          throw Error('公共源 HTTP '+response.status);
        }
        let size=0;const chunks=[];
        for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw Error('公共源响应超过 2 MB');chunks.push(chunk);}
        parsed=parsePublicFeed(JSON.parse(Buffer.concat(chunks).toString('utf8')),this.handle,this.now());
        if(this.stopped)throw Error('监测已停止');
        cache.etag=response.headers.get('etag');cache.parsed=parsed;
      }
      source.upstreamAt=parsed.fetchedAt;source.stale=parsed.stale;source.connected=!parsed.stale;
      source.error=parsed.stale?'公共源数据已过期，仅保留收录记录，不发送新提醒':null;
      if(parsed.stale){cache.failures++;source.retryAt=new Date(this.now()+pollDelaySeconds({mode:this.pollMode,failures:cache.failures,random:this.random})*1000).toISOString();}
      else{cache.failures=0;source.retryAt=null;source.lastSuccess=this.status.lastCheck;}
      return parsed;
    }catch(error){
      if(this.stopped)throw error;
      cache.failures++;source.connected=false;source.stale=true;source.error=error.message;
      source.retryAt=new Date(Math.max(Date.parse(source.retryAt)||0,this.now()+pollDelaySeconds({mode:this.pollMode,failures:cache.failures,random:this.random})*1000)).toISOString();
      throw error;
    }
  }
  async loadFeed(respectCooldown) {
    let staleResult;const errors=[];
    for(const source of this.sources){
      if(this.stopped)throw Error('监测已停止');
      if(respectCooldown&&Date.parse(source.retryAt)>this.now()){errors.push(source.error||'等待来源恢复');continue;}
      try{
        const parsed=await this.readSource(source);
        if(!parsed.stale)return {source,parsed};
        staleResult||={source,parsed};errors.push(source.error);
      }catch(error){errors.push(error.message);}
    }
    if(staleResult)return staleResult;
    throw Error([...new Set(errors)].join('；')||'公共源暂不可用');
  }
  // 定时检查遵守每条源的冷却；直接调用可用于显式补查和测试。
  async check({respectCooldown=false}={}) {
    if(this.busy||this.stopped)return;
    clearTimeout(this.poll);
    this.busy=true;this.status.lastCheck=new Date(this.now()).toISOString();
    this.requestAbort=new AbortController();
    try {
      const {source,parsed}=await this.loadFeed(respectCooldown);
      this.retryNotBefore=0;
      if(this.stopped)return;
      this.status.sourceUrl=source.url;this.status.activeSourceUrl=source.connected?source.url:null;this.status.usingFallback=source.role==='fallback'&&source.connected;
      this.batch=new Map(parsed.posts.map(p=>[p.id,p]));
      const cursor=this.store.get('publicFeedCursor');
      const initialized=!!this.store.get('publicFeedInitialized');
      for(const p of parsed.posts){
        if(this.stopped)return;
        p.via={type:'public-feed',label:'公共镜像收录 · 未独立核验',url:source.url,retrievedAt:this.status.lastCheck};
        // 首次仅建立基线；后来补入的旧帖也不作为新公告推送。
        const notify=initialized&&!parsed.stale&&(!cursor||BigInt(p.id)>BigInt(cursor));
        await this.enqueue(p,notify);
      }
      if(!parsed.stale){
        this.store.set('publicFeedInitialized','1');
        const latest=parsed.posts.at(-1).id;
        this.store.set('publicFeedCursor',!cursor||BigInt(latest)>BigInt(cursor)?latest:cursor);
        this.store.set('lastCheck',this.status.lastCheck);
      }
      this.status.upstreamAt=parsed.fetchedAt;
      this.status.newestPostAt=parsed.posts.reduce((a,p)=>p.created_at>a?p.created_at:a,'');
      this.status.stale=parsed.stale;this.status.connected=!parsed.stale;
      this.status.error=parsed.stale?'公共源数据已过期，仅保留收录记录，不发送新提醒':null;
      this.failures=parsed.stale?this.failures+1:0;
      if(!parsed.stale)this.status.lastSuccess=this.status.lastCheck;
    } catch(error){if(!this.stopped){this.failures++;this.status.connected=false;this.status.stale=true;this.status.activeSourceUrl=null;this.status.usingFallback=false;this.status.error=error.message;}}
    finally{
      if(!this.stopped&&!this.status.connected){const deadlines=this.sources.map(s=>Date.parse(s.retryAt)||0);this.retryNotBefore=deadlines.every(d=>d>this.now())?Math.min(...deadlines):0;}
      this.busy=false;this.status.failureCount=this.failures;if(this.running)this.schedule();
    }
  }
  async start(){
    if(this.running)return;
    this.running=true;this.lastWakeCheck=this.now();
    this.wakeTimer=setInterval(()=>this.checkForResume(),30000);this.wakeTimer.unref?.();
    await this.check();
  }
  stop(){this.running=false;super.stop();this.requestAbort?.abort();clearTimeout(this.poll);clearInterval(this.wakeTimer);this.status.nextCheck=null;}
}
