// 社区观测到账：社区报告“重置已经发生”，不等于 Tibo 本人的完成确认帖。
// 观测源由部署者配置（OBSERVATION_SOURCES，逗号分隔的 HTTPS JSON 地址），
// 默认不启用；程序不内置也不抓取任何第三方站点。
const MAX_AGE_MS = 7 * 86400000;
const CLOCK_SKEW_MS = 5 * 60000;
const MAX_ITEMS = 50;

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function toObservedEvent(observation) {
  const id = text(observation?.id, 120);
  const at = new Date(observation?.at);
  const url = text(observation?.url, 500);
  // 没有可核对来源的观测不入库：这条记录的全部价值就在于它能被点开验证。
  if (!id || !Number.isFinite(at.getTime()) || !/^https?:\/\//.test(url)) return null;
  return {
    id: `observed-${id}`,
    at: at.toISOString(),
    kind: 'observed',
    topic: 'reset',
    evidence: 'community',
    status: 'observed',
    title: '社区观测已重置',
    note: text(observation?.note, 300) || '社区来源报告观测到额度重置。这不是 Tibo 的完成确认，也不保证每个账号均已到账；观测时刻不等于精确生效秒数。',
    url,
    scope: text(observation?.scope, 80) || null,
    sourceType: 'community'
  };
}

// 只接受最近发生、时间可信、字段完整的记录；其余整条丢弃而不是猜测补全。
export function parseObservations(payload, now = Date.now()) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.observations) ? payload.observations : [];
  const seen = new Set();
  const out = [];
  for (const item of list.slice(0, MAX_ITEMS)) {
    const event = toObservedEvent(item);
    if (!event || seen.has(event.id)) continue;
    const at = Date.parse(event.at);
    if (at > now + CLOCK_SKEW_MS || now - at > MAX_AGE_MS) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export class Observations {
  constructor(store, onEvent, sources = [], { fetchImpl = fetch, intervalMs = 300000, now = ()=>Date.now() } = {}) {
    this.store = store;
    this.onEvent = onEvent;
    this.sources = [...new Set(sources)];
    for(const url of this.sources){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('观测源必须使用不带凭证的 HTTPS 地址');}
    this.fetchImpl = fetchImpl;
    this.intervalMs = intervalMs;
    this.now = now;
    this.states=this.sources.map(url=>({url,connected:false,lastCheck:null,lastSuccess:null,nextCheck:null,error:null,validRecords:0,failureCount:0}));
    this.running=false;this.busy=false;this.stopped=false;
    this.timer = null;
  }
  status(){
    return {enabled:this.sources.length>0,checkedAt:this.store.get('observationCheck')||null,error:this.sources.length?(this.store.get('observationError')||null):null,intervalSeconds:this.intervalMs/1000,sources:this.states.map(s=>({...s}))};
  }
  async source(url) {
    const r = await this.fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.any([this.requestAbort.signal,AbortSignal.timeout(15000)]) });
    if (!r.ok){
      const error=Error('观测源 HTTP ' + r.status),retry=r.headers?.get('retry-after');
      const delay=retry&&/^\d+$/.test(retry.trim())?Number(retry)*1000:null;
      const deadline=delay!==null?this.now()+delay:Date.parse(retry);
      if(Number.isFinite(deadline)&&deadline>this.now())error.retryAt=Math.min(deadline,this.now()+2147483000);
      throw error;
    }
    const body = await r.json();
    if(!Array.isArray(body)&&!Array.isArray(body?.observations))throw Error('观测源格式不匹配，需要 observations 数组');
    const events=parseObservations(body,this.now());
    if((Array.isArray(body)?body:body.observations).length&&!events.length)throw Error('观测源没有最近 7 天内可核对的有效记录');
    return events;
  }
  // 已存在的观测记录直接跳过：观测是“补充证据”，不会重复推送或覆盖历史条目。
  async check({respectCooldown=false}={}) {
    if(this.busy||this.stopped)return 0;
    this.busy=true;this.requestAbort=new AbortController();
    let added = 0;
    try{
    for (const state of this.states) {
      if(this.stopped)break;
      if(respectCooldown&&Date.parse(state.nextCheck)>this.now())continue;
      state.lastCheck=new Date(this.now()).toISOString();
      let events = [];
      try {
        events = await this.source(state.url);
        if(this.stopped)break;
        Object.assign(state,{connected:true,lastSuccess:state.lastCheck,error:null,validRecords:events.length,failureCount:0,nextCheck:new Date(this.now()+this.intervalMs).toISOString()});
      }
      catch (err) {
        if(this.stopped)break;
        state.connected=false;state.error=err.message;state.failureCount++;
        const delay=Math.min(1800000,this.intervalMs*2**Math.min(state.failureCount-1,3));
        state.nextCheck=new Date(Math.max(this.now()+delay,err.retryAt||0)).toISOString();continue;
      }
      for (const event of events) {
        if(this.stopped)break;
        if (this.store.event(event.id)) continue;
        // 两个接口转发同一条观测凭据时，不因它们的本地 ID 不同重复提醒。
        if(this.store.events().some(e=>e.kind==='observed'&&e.url===event.url&&e.at===event.at&&e.scope===event.scope))continue;
        event.via={type:'community-feed',label:'社区来源报告 · 未独立核验',url:state.url,retrievedAt:state.lastCheck};
        if (this.store.addEvent(event, true)) { added++; this.onEvent(event); }
      }
    }
    if(!this.stopped){
      this.store.set('observationError',this.states.filter(s=>s.error).map(s=>`${s.url}: ${s.error}`).join('；'));
      this.store.set('observationCheck',new Date(this.now()).toISOString());
    }
    return added;
    }finally{this.busy=false;if(this.running)this.schedule();}
  }
  schedule(){
    clearTimeout(this.timer);if(!this.running||this.stopped)return;
    const next=Math.min(...this.states.map(s=>Date.parse(s.nextCheck)||this.now()));
    this.timer=setTimeout(()=>this.check({respectCooldown:true}).catch(()=>{}),Math.max(0,next-this.now()));this.timer.unref?.();
  }
  start() {
    if (!this.sources.length||this.running) return;
    this.running=true;
    this.check().catch(() => {});
  }
  stop() { this.running=false;this.stopped=true;this.requestAbort?.abort();clearTimeout(this.timer);for(const s of this.states)s.nextCheck=null; }
}
