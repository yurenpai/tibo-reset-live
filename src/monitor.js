import { setTimeout as sleep } from 'node:timers/promises';
import { classifyEvents } from './classify.js';
import { deriveSchedule } from './schedule.js';

const SCHEDULE_FIELDS = ['windowStart', 'windowEnd', 'literalEnd', 'timeZone', 'timeNote'];

// Tibo 常在主帖下回复补充细节（例如“Lands tomorrow before 10am PST”）。
// 同一证据层级的补充说明并入父帖，避免同一件事在日历里出现两条记录。
export function mergeFollowUp(parent, follow) {
  const merged = { ...parent };
  for (const key of SCHEDULE_FIELDS) {
    if (!merged[key] && follow[key]) merged[key] = follow[key];
  }
  const followUps = Array.isArray(parent.followUps) ? [...parent.followUps] : [];
  if (!followUps.some(f => f.id === follow.id)) {
    followUps.push({ id: follow.id, at: follow.at, url: follow.url, excerpt: follow.excerpt, sourceType: 'reply' });
  }
  merged.followUps = followUps.sort((a, b) => a.at.localeCompare(b.at));
  return merged;
}

export class Monitor {
  constructor(store,onEvent,env=process.env) {
    this.store=store;this.onEvent=onEvent;this.token=env.X_BEARER_TOKEN;
    this.handle=env.X_HANDLE||'thsottiaux';this.status={configured:!!this.token,connected:false,lastReceived:null,error:null};
    this.chain=Promise.resolve();this.stopped=false;
  }
  async api(route,options={}) {
    const r=await fetch('https://api.x.com/2/'+route,{...options,headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});
    if(!r.ok) { const error=new Error('X API HTTP '+r.status);error.status=r.status;throw error; }
    return r.json();
  }
  enqueue(p,notify=true) {
    this.chain=this.chain.catch(()=>{}).then(()=>this.process(p,notify));
    return this.chain;
  }
  // 被合并的回复没有独立事件；沿已保存的帖子链或历史 followUps 找回重置上下文。
  resolveParentEvent(id) {
    const seen = new Set();
    const events = this.store.events();
    while (id && !seen.has(id) && seen.size < 64) {
      seen.add(id);
      const direct = this.store.event(id);
      if (direct?.topic !== 'feature' && ['scheduled', 'confirmed', 'banked', 'candidate'].includes(direct?.kind)) return direct;
      const merged = events.find(e => e.topic !== 'feature' && ['scheduled', 'confirmed', 'banked', 'candidate'].includes(e.kind) && e.followUps?.some(f => f.id === id));
      if (merged) return merged;
      id = this.store.post(id)?.referenced_tweets?.find(r => r.type === 'replied_to')?.id;
    }
    return null;
  }
  async process(p,notify,depth=0) {
    if(p.author_id!==this.userId||!p.created_at||this.store.post(p.id))return;
    const reply=p.referenced_tweets?.find(r=>r.type==='replied_to')?.id;
    if(reply&&!this.store.post(reply)&&!this.resolveParentEvent(reply)&&depth<32){
      try {
        const r=await this.api('tweets/'+reply+'?tweet.fields=created_at,author_id,referenced_tweets');
        if(r.data && r.data.id !== p.id)await this.process(r.data,false,depth+1);
      } catch(error) {
        // 删除/受限父帖不应阻塞当前帖；暂时性错误交给补漏重试。
        if(![403,404].includes(error.status))throw error;
      }
    }
    const parentEvent=reply?this.resolveParentEvent(reply):null;
    const results=classifyEvents(p,parentEvent);
    const schedule=deriveSchedule(p.text,p.created_at)||{};
    const url=`https://x.com/${this.handle}/status/${p.id}`;
    for (const result of results) {
      const id = result.topic === 'feature' ? `${p.id}-feature` : p.id;
      // 仅同主题、同证据层级的补充合并；Done 升级确认时始终新建独立事件。
      if(result.topic==='reset'&&parentEvent&&parentEvent.kind===result.kind&&parentEvent.status===result.status&&!this.store.event(id)){
        this.store.upsertEvent(mergeFollowUp(parentEvent,{id:p.id,at:p.created_at,url,excerpt:p.text.slice(0,500),...schedule}));
        continue;
      }
      const e={id,at:p.created_at,...result,...(result.topic==='reset'?schedule:{}),parent:result.topic==='reset'?(parentEvent?.id||reply||null):(reply||null),replyTo:reply||null,sourceType:reply?'reply':'post',url,excerpt:p.text.slice(0,500),...(p.via?{via:p.via}:{})};
      if(this.store.addEvent(e,notify&&result.kind!=='candidate'))this.onEvent(e,{notify:notify&&result.kind!=='candidate'});
    }
    this.store.savePost(p);
  }
  async catchup(baseline=false) {
    let next;const posts=[];const cursor=this.store.get('cursor');
    do {
      const q=new URLSearchParams({'tweet.fields':'created_at,author_id,referenced_tweets',max_results:baseline?'10':'100'});
      if(cursor&&!baseline)q.set('since_id',cursor);
      if(next)q.set('pagination_token',next);
      const r=await this.api(`users/${this.userId}/tweets?${q}`);
      posts.push(...r.data||[]);next=baseline?null:r.meta?.next_token;
    }while(next);
    posts.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
    let failed=false;
    for(const p of posts){try{await this.enqueue(p,!baseline);}catch(error){failed=true;this.status.error=error.message;}}
    // 后续帖子仍处理；失败未保存的帖下轮重试，游标暂不前移。
    if(posts.length&&!failed)this.store.set('cursor',posts.at(-1).id);
    this.store.set('lastCheck',new Date().toISOString());
  }
  async start() {
    if(!this.token)return;
    try {
      const u=await this.api('users/by/username/'+encodeURIComponent(this.handle));this.userId=u.data.id;
      await this.catchup(!this.store.get('cursor'));
      // 以账号为过滤条件，保留回复；“Done”等完成确认常出现在回复中。
      const value=`from:${this.handle} -is:retweet`;
      const rules=await this.api('tweets/search/stream/rules');
      if(!rules.data?.some(r=>r.value===value))await this.api('tweets/search/stream/rules',{method:'POST',body:JSON.stringify({add:[{value,tag:'tibo-reset-live'}]})});
      this.poll=setInterval(()=>this.catchup().catch(e=>this.status.error=e.message),120000);
      await this.stream();
    }catch(e){this.status.error=e.message;this.status.connected=false;if(!this.stopped){await sleep(60000);return this.start();}}
  }
  async stream() {
    let delay=5000;
    while(!this.stopped){
      const abort=new AbortController();this.abort=abort;let watchdog;
      try{
        const r=await fetch('https://api.x.com/2/tweets/search/stream?tweet.fields=created_at,author_id,referenced_tweets,edit_history_tweet_ids',{headers:{Authorization:'Bearer '+this.token},signal:abort.signal});
        if(!r.ok)throw new Error('X stream HTTP '+r.status);
        this.status.connected=true;this.status.error=null;delay=5000;let buffer='';
        const decoder=new TextDecoder();
        const resetWatchdog=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>abort.abort(),45000);};resetWatchdog();
        for await(const chunk of r.body){
          resetWatchdog();buffer+=decoder.decode(chunk,{stream:true});
          let i;while((i=buffer.indexOf('\n'))>=0){
            const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;
            const payload=JSON.parse(line);if(payload.data){await this.enqueue(payload.data);this.status.lastReceived=new Date().toISOString();}
          }
        }
      }catch(e){this.status.error=e.message;}
      finally{clearTimeout(watchdog);this.status.connected=false;abort.abort();}
      if(!this.stopped){await sleep(delay);delay=Math.min(120000,delay*2);}
    }
  }
  stop(){this.stopped=true;clearInterval(this.poll);this.abort?.abort();}
}
