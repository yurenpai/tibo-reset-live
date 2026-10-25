import { Monitor } from './monitor.js';

export const DEFAULT_PUBLIC_FEED='https://codex-reset.com/api/feed';
const MAX_AGE=15*60000;
const MAX_BYTES=2*1024*1024;
const decode=text=>text.replace(/&(?:amp|lt|gt|quot|apos|#39);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"})[s]).replace(/\\n/g,'\n');

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
  constructor(store,onEvent,env={}, {fetchImpl=fetch,now=()=>Date.now()}={}) {
    super(store,onEvent,env);
    this.userId=`public:${this.handle.toLowerCase()}`;
    this.fetchImpl=fetchImpl;this.now=now;
    this.url=env.PUBLIC_FEED_URL||DEFAULT_PUBLIC_FEED;
    const parsed=new URL(this.url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('公共源必须使用不带凭证的 HTTPS 地址');
    this.intervalMs=Math.max(60000,Number(env.PUBLIC_POLL_SECONDS||120)*1000||120000);
    this.batch=new Map();this.busy=false;
    this.status={mode:'public',configured:true,connected:false,label:'公共源定时检查',sourceUrl:this.url,intervalSeconds:this.intervalMs/1000,lastCheck:null,lastSuccess:null,upstreamAt:null,newestPostAt:null,stale:true,error:null,coverage:'第三方收录，可能延迟或遗漏；不保证完整覆盖主帖和回复'};
  }
  // 公共源只使用当前批次和本地上下文，绝不偷偷调用需要 Token 的 X API。
  async api(route){const id=route.match(/^tweets\/(\d+)/)?.[1];return {data:this.batch.get(id)||null};}
  async check() {
    if(this.busy||this.stopped)return;
    this.busy=true;this.status.lastCheck=new Date(this.now()).toISOString();
    try {
      const response=await this.fetchImpl(this.url,{headers:{accept:'application/json','user-agent':'TiboResetLive/0.2 (+https://github.com/yurenpai/tibo-reset-live)',...(this.etag?{'if-none-match':this.etag}:{})},signal:AbortSignal.timeout(15000)});
      if(response.status===304) {
        this.status.stale=!this.status.upstreamAt||this.now()-Date.parse(this.status.upstreamAt)>MAX_AGE;
        this.status.connected=!this.status.stale;
        this.status.error=this.status.stale?'公共源更新时间已超过 15 分钟，不能确认持续监测有效':null;
        if(this.status.connected)this.status.lastSuccess=this.status.lastCheck;
        return;
      }
      if(!response.ok)throw Error('公共源 HTTP '+response.status);
      let size=0;const chunks=[];
      for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw Error('公共源响应超过 2 MB');chunks.push(chunk);}
      const parsed=parsePublicFeed(JSON.parse(Buffer.concat(chunks).toString('utf8')),this.handle,this.now());
      this.etag=response.headers.get('etag');
      this.batch=new Map(parsed.posts.map(p=>[p.id,p]));
      const cursor=this.store.get('publicFeedCursor');
      const initialized=!!this.store.get('publicFeedInitialized');
      for(const p of parsed.posts){
        p.via={type:'public-feed',label:'公共镜像收录 · 未独立核验',url:this.url,retrievedAt:this.status.lastCheck};
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
      if(!parsed.stale)this.status.lastSuccess=this.status.lastCheck;
    } catch(error){this.status.connected=false;this.status.stale=true;this.status.error=error.message;}
    finally{this.busy=false;}
  }
  async start(){await this.check();if(!this.stopped){this.poll=setInterval(()=>this.check(),this.intervalMs);this.poll.unref?.();}}
}
