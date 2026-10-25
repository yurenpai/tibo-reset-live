import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Monitor} from './monitor.js';
import {PublicFeedMonitor,DEFAULT_PUBLIC_FEED,parsePublicFeed} from './public-feed.js';
import {Observations,parseObservations} from './observations.js';

export const defaultSourceConfig=()=>({mode:'public',publicFeedUrl:DEFAULT_PUBLIC_FEED,fallbackUrls:[],observationSources:[],token:''});
function address(value){
  if(typeof value!=='string'||value.length>500)throw Error('来源地址必须是 500 字以内的 HTTPS 地址');
  let url;try{url=new URL(value.trim());}catch{throw Error('来源地址格式不正确');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('来源地址需使用 HTTPS，不能包含账号、密码或片段');
  return url.href;
}
function addresses(value,max){
  if(!Array.isArray(value)||value.length>max)throw Error(`来源列表最多填写 ${max} 个地址`);
  return [...new Set(value.filter(v=>v!=='').map(address))];
}
export function validateSourceConfig(input,previous=defaultSourceConfig()){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('无效的来源配置');
  if(!['public','api'].includes(input.mode))throw Error('请选择免登录或官方 API 模式');
  if(input.clearToken!==undefined&&typeof input.clearToken!=='boolean')throw Error('清除密钥选项无效');
  if(input.token!==undefined&&typeof input.token!=='string')throw Error('应用密钥格式不正确');
  const token=input.clearToken?'':input.token?.trim()||previous.token||'';
  if(token&&(token.length>2048||!/^[A-Za-z0-9%._~+/=\-]+$/.test(token)))throw Error('应用密钥格式不正确，请填写 Bearer Token 本身');
  if(input.mode==='api'&&!token)throw Error('官方 API 模式需要 Bearer Token；也可以选择免登录模式');
  const publicFeedUrl=address(input.publicFeedUrl);
  return {mode:input.mode,publicFeedUrl,fallbackUrls:addresses(input.fallbackUrls,2).filter(u=>u!==publicFeedUrl),observationSources:addresses(input.observationSources,5),token};
}
const split=value=>(value||'').split(',').map(s=>s.trim()).filter(Boolean);

// 仅本机模式创建。独立文件不改写 .env；凭证从不进入 API 返回或浏览器存储。
export class SourceConfig {
  constructor(store,onEvent,env,{file,fetchImpl=fetch,now=()=>Date.now(),monitorFactory,observationsFactory}={}){
    this.store=store;this.onEvent=onEvent;this.env=env;this.file=file;this.fetchImpl=fetchImpl;this.now=now;
    this.monitorFactory=monitorFactory||((mode,callback,settings)=>mode==='public'?new PublicFeedMonitor(store,callback,settings,{fetchImpl,now}):new Monitor(store,callback,settings,{fetchImpl}));
    this.observationsFactory=observationsFactory||((callback,urls)=>new Observations(store,callback,urls,{fetchImpl,now}));
    this.generation=0;this.running=false;this.testing=false;
    const initial={mode:env.SOURCE_MODE==='public'||(!env.X_BEARER_TOKEN&&env.SOURCE_MODE!=='api')?'public':'api',publicFeedUrl:env.PUBLIC_FEED_URL||DEFAULT_PUBLIC_FEED,fallbackUrls:split(env.PUBLIC_FEED_FALLBACK_URLS),observationSources:split(env.OBSERVATION_SOURCES),token:env.X_BEARER_TOKEN||''};
    if(file&&fs.existsSync(file)){
      try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));this.config=validateSourceConfig(saved,{token:saved.token});}
      catch{throw Error('本机来源配置文件无效，请检查 local-sources.json，原文件已保留');}
    }else{
      // 保留旧版 api 模式未填 Token 时的“未配置”状态，允许从页面补填。
      this.config=initial;
    }
    this.install(this.config);
  }
  environment(config){return {...this.env,SOURCE_MODE:config.mode,PUBLIC_FEED_URL:config.publicFeedUrl,PUBLIC_FEED_FALLBACK_URLS:config.fallbackUrls.join(','),OBSERVATION_SOURCES:config.observationSources.join(','),X_BEARER_TOKEN:config.token};}
  pair(config,generation){
    const callback=(...args)=>{if(generation===this.generation&&this.running)this.onEvent(...args);};
    const monitor=this.monitorFactory(config.mode,callback,this.environment(config));
    if(config.mode==='api')monitor.status.mode='api';
    return {monitor,observations:this.observationsFactory(callback,config.observationSources)};
  }
  install(config){Object.assign(this,this.pair(config,this.generation));}
  get status(){return this.monitor.status;}
  setPollMode(value){if(!this.monitor.setPollMode)throw Error('当前数据源不使用定时检查');return this.monitor.setPollMode(value);}
  view(){const {token,...config}=this.config;return {...config,tokenConfigured:!!token};}
  preview(input){return validateSourceConfig(input,this.config);}
  save(input){
    const config=this.preview(input),generation=this.generation+1;
    const pair=this.pair(config,generation);
    if(!this.file)throw Error('本机配置存储路径未就绪');
    const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';
    try{
      fs.mkdirSync(path.dirname(this.file),{recursive:true});
      fs.writeFileSync(temporary,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
      fs.renameSync(temporary,this.file);
    }catch{fs.rmSync(temporary,{force:true});throw Error('无法保存本机来源配置，原配置继续生效');}
    this.monitor.stop();this.observations.stop();this.generation=generation;
    this.config=config;Object.assign(this,pair);
    if(this.running)this.begin();
    return this.view();
  }
  begin(){this.monitor.start().catch(()=>{});this.observations.start();}
  start(){if(this.running)return;this.running=true;this.begin();}
  stop(){this.running=false;this.generation++;this.monitor.stop();this.observations.stop();}
  async json(url,token){
    const response=await this.fetchImpl(url,{headers:{accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok){const error=Error(`HTTP ${response.status}${response.status===401||response.status===403?'，请检查应用密钥和 API 权限':''}`);error.public=true;throw error;}
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw Error('响应过大');chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async test(input){
    if(this.testing)throw Error('已有连接测试正在进行，请稍后重试');
    const config=this.preview(input);this.testing=true;
    const checks=config.mode==='api'?[{label:'X 官方 API',url:'https://api.x.com/2/users/by/username/'+encodeURIComponent(this.env.X_HANDLE||'thsottiaux'),kind:'api'}]:[{label:'主帖子源',url:config.publicFeedUrl,kind:'public'},...config.fallbackUrls.map(url=>({label:'备用帖子源',url,kind:'public'}))];
    checks.push(...config.observationSources.map(url=>({label:'社区观测源',url,kind:'community'})));
    try{return await Promise.all(checks.map(async check=>{
      try{
        const payload=await this.json(check.url,check.kind==='api'?config.token:null);
        let message;
        if(check.kind==='api'){
          if(!payload?.data?.id)throw Error('格式不匹配');
          message='账号查询成功；流和时间线权限仍需在保存后的连接状态中核验';
        }else if(check.kind==='public'){
          const parsed=parsePublicFeed(payload,this.env.X_HANDLE||'thsottiaux',this.now());
          if(parsed.stale)return {...check,ok:false,message:'接口可访问，但数据已过期，不能用于新提醒'};
          message=`格式检查通过，包含 ${parsed.posts.length} 条可解析帖子；未独立核验原文`;
        }else{
          const list=Array.isArray(payload)?payload:payload?.observations;
          if(!Array.isArray(list))throw Error('格式不匹配');
          const records=parseObservations(payload,this.now());
          if(list.length&&!records.length)throw Error('没有有效记录');
          message=`格式检查通过，包含 ${records.length} 条近期有效观测；不等于官方确认`;
        }
        return {...check,ok:true,message};
      }catch(error){return {...check,ok:false,message:error.public?error.message:'连接超时、网络失败或响应格式无效，请核对接口'};}
    }));}finally{this.testing=false;}
  }
}
