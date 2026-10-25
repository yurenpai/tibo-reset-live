import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SourceConfig,defaultSourceConfig,validateSourceConfig} from '../src/source-config.js';
import {Store} from '../src/store.js';
import {Monitor} from '../src/monitor.js';
import {createApp} from '../src/server.js';
import {DesktopNotifications} from '../src/desktop.js';

const epoch=Date.parse('2026-10-25T12:00:00Z');
const json=value=>new Response(JSON.stringify(value));
const feed=(id='100',text='Thanks!')=>json({profile:{handle:'thsottiaux'},fetched_at:new Date(epoch).toISOString(),tweets:[{id,url:`https://x.com/thsottiaux/status/${id}`,at:new Date(epoch-1000).toISOString(),text}]});
const fakeMonitor=(mode,callback,env)=>({status:{mode,configured:!!env.X_BEARER_TOKEN,connected:false},async start(){},stop(){this.stopped=true;}});
function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-source-config-')),store=new Store(':memory:');
  const file=path.join(root,'local-sources.json');
  const manager=new SourceConfig(store,options.onEvent||(()=>{}),options.env||{},{file,now:()=>epoch,fetchImpl:async()=>feed(),...options});
  t.after(()=>{manager.stop();store.close();assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});
  return {manager,store,file};
}
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Condition not reached');}

test('来源配置严格校验模式、HTTPS、凭证和数量；空 Token 保留，清除必须回公共模式',()=>{
  const config=defaultSourceConfig();
  assert.equal(validateSourceConfig({...config,token:''},{token:'saved-token'}).token,'saved-token');
  assert.equal(validateSourceConfig({...config,clearToken:true},{token:'saved-token'}).token,'');
  assert.equal(validateSourceConfig({...config,fallbackUrls:[config.publicFeedUrl,'https://backup.test']}).fallbackUrls.length,1);
  assert.equal(validateSourceConfig({...config,fallbackUrls:['https://backup.test','https://backup.test']}).fallbackUrls.length,1);
});

test('拒绝不合格来源配置，不截断多余接口或接受无 Token 的官方模式',()=>{
  const config=defaultSourceConfig();
  for(const patch of [{mode:'auto'},{mode:'api'},{publicFeedUrl:'http://plain.test'},{publicFeedUrl:'https://user:secret@example.test'},{publicFeedUrl:'https://example.test/#frag'},{fallbackUrls:['https://a.test','https://b.test','https://c.test']},{observationSources:Array(6).fill('https://obs.test')},{token:'Bearer bad token'},{clearToken:'yes'}]){
    assert.throws(()=>validateSourceConfig({...config,...patch}));
  }
});

test('配置原子保存并跨重启覆盖环境；Token 不回显，保留与清除均持久化',t=>{
  const {manager,store,file}=fixture(t,{monitorFactory:fakeMonitor,env:{X_BEARER_TOKEN:'environment-token'}});
  const saved=manager.save({...defaultSourceConfig(),token:'new-secret',publicFeedUrl:'https://primary.test/feed'});
  assert.equal(saved.tokenConfigured,true);assert.equal('token'in saved,false);
  assert(!JSON.stringify(saved).includes('new-secret'));
  if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);
  manager.save({...saved,mode:'api',token:''});
  const restarted=new SourceConfig(store,()=>{},{SOURCE_MODE:'public',X_BEARER_TOKEN:'other-env-token'},{file,monitorFactory:fakeMonitor});
  try{assert.equal(restarted.view().mode,'api');assert.equal(restarted.config.token,'new-secret');}finally{restarted.stop();}
  manager.save({...defaultSourceConfig(),clearToken:true});
  const cleared=new SourceConfig(store,()=>{},{X_BEARER_TOKEN:'environment-token'},{file,monitorFactory:fakeMonitor});
  try{assert.equal(cleared.view().mode,'public');assert.equal(cleared.view().tokenConfigured,false);}finally{cleared.stop();}
});

test('无效配置和写入失败不会停止当前源或覆盖文件；损坏文件不被静默重置',t=>{
  const {manager,store,file}=fixture(t,{monitorFactory:fakeMonitor});
  manager.save(defaultSourceConfig());const before=fs.readFileSync(file,'utf8'),monitor=manager.monitor;
  assert.throws(()=>manager.save({...defaultSourceConfig(),publicFeedUrl:'not a url'}));
  assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(monitor.stopped,undefined);
  manager.file=path.join(file,'cannot-write.json');assert.throws(()=>manager.save(defaultSourceConfig()),/无法保存/);
  assert.equal(manager.monitor,monitor);assert.equal(monitor.stopped,undefined);manager.file=file;
  fs.writeFileSync(file,'invalid-json');
  assert.throws(()=>new SourceConfig(store,()=>{},{},{file}),/原文件已保留/);
  assert.equal(fs.readFileSync(file,'utf8'),'invalid-json');
});

test('保存时取消旧请求并热切换；旧响应不写事件，新源继续使用原游标和通知去重',async t=>{
  let release,oldSignal;const sent=[];
  const {manager,store}=fixture(t,{onEvent:e=>sent.push(e),env:{PUBLIC_FEED_URL:'https://old.test/feed'},fetchImpl:async(url,options)=>{
    if(url.includes('old.test')){oldSignal=options.signal;await new Promise(r=>release=r);return feed('101','We have reset all accounts.');}
    return feed();
  }});
  store.set('publicFeedInitialized','1');store.set('publicFeedCursor','99');store.set('desktopSent:previous','yes');
  manager.start();await until(()=>release);
  const old=manager.monitor;manager.save({...defaultSourceConfig(),publicFeedUrl:'https://new.test/feed'});
  assert(oldSignal.aborted);assert(old.stopped);
  release();await until(()=>!old.busy&&!manager.monitor.busy);
  assert.equal(store.event('101'),null);assert.equal(store.post('101'),null);assert.equal(store.get('publicFeedCursor'),'100');
  assert.equal(store.get('desktopSent:previous'),'yes');assert.equal(sent.length,0);assert(manager.monitor.running);
});

test('测试连接隔离草稿、不入库、不保存；Token 只发到官方端点且结果不回显',async t=>{
  const calls=[];
  const {manager,store,file}=fixture(t,{monitorFactory:fakeMonitor,fetchImpl:async(url,options)=>{
    calls.push({url,headers:options.headers});return url.includes('api.x.com')?json({data:{id:'123'}}):url.includes('community')?json({observations:[]}):feed();
  }});
  const config={...defaultSourceConfig(),token:'test-private-token',fallbackUrls:['https://backup.test/feed'],observationSources:['https://community.test/feed']};
  const checks=await manager.test(config);assert(checks.every(c=>c.ok));
  assert(calls.every(c=>!c.headers.Authorization));assert.equal(store.events().length,0);assert(!fs.existsSync(file));
  const official=await manager.test({...config,mode:'api'});
  assert(official.every(c=>c.ok));assert(!JSON.stringify(official).includes('test-private-token'));
  assert.equal(calls.filter(c=>c.headers.Authorization).length,1);
  assert(calls.find(c=>c.headers.Authorization).url.startsWith('https://api.x.com/2/users/by/username/'));
  assert(!calls.some(c=>c.url.includes('stream/rules')));
});

test('测试连接能区分限流、陈旧数据、格式错误、空社区和部分失败',async t=>{
  const {manager}=fixture(t,{fetchImpl:async url=>url.includes('primary')?new Response('limited',{status:429}):url.includes('backup')?json({wrong:true}):json({observations:[]})});
  const results=await manager.test({...defaultSourceConfig(),publicFeedUrl:'https://primary.test/feed',fallbackUrls:['https://backup.test/feed'],observationSources:['https://community.test/feed']});
  assert.equal(results[0].ok,false);assert.match(results[0].message,/429/);assert.equal(results[1].ok,false);assert.equal(results[2].ok,true);
  manager.fetchImpl=async()=>json({profile:{handle:'thsottiaux'},fetched_at:new Date(epoch-3600000).toISOString(),tweets:[{id:'100',url:'https://x.com/thsottiaux/status/100',at:new Date(epoch-1000).toISOString(),text:'Thanks!'}]});
  assert.match((await manager.test(defaultSourceConfig()))[0].message,/过期/);
});

test('配置 API 仅本机可用、写入校验同源、密钥不出现在配置或日历响应',async t=>{
  const {manager,store}=fixture(t,{monitorFactory:fakeMonitor});
  const options={store,monitor:manager,sourceConfig:manager,history:{checkedAt:new Date(epoch).toISOString()},planDoc:{plan:{start:'2026-10-05',days:28},entries:[]}};
  const local=createApp({...options,desktop:new DesktopNotifications(store,{send:async()=>{}})}).listen(0,'127.0.0.1');
  const cloud=createApp(options).listen(0,'127.0.0.1');
  await Promise.all([local,cloud].map(s=>new Promise(r=>s.once('listening',r))));
  t.after(async()=>{await Promise.all([local,cloud].map(s=>new Promise(r=>s.close(r))));});
  const url=s=>`http://127.0.0.1:${s.address().port}`;
  const post=(s,body,origin='http://localhost:8788')=>fetch(url(s)+'/api/local/source-config',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(url(cloud)+'/api/local/source-config')).status,404);
  assert.equal((await post(local,defaultSourceConfig(),'https://evil.test')).status,403);
  assert.equal((await post(local,{mode:'api'})).status,400);
  const saved=await post(local,{...defaultSourceConfig(),mode:'api',token:'never-return-this-token'});assert.equal(saved.status,200);assert(!(await saved.text()).includes('never-return-this-token'));
  const view=await fetch(url(local)+'/api/local/source-config');assert.match(view.headers.get('cache-control'),/no-store/);assert(!(await view.text()).includes('never-return-this-token'));
  const calendar=await(await fetch(url(local)+'/api/calendar')).json();assert.equal(calendar.status.mode,'api');assert.equal(calendar.sourceConfigurable,true);assert(!JSON.stringify(calendar).includes('never-return-this-token'));
});

test('官方 API 初始化退避停止后不再重连或建定时器',async()=>{
  const store=new Store(':memory:');let calls=0;
  const monitor=new Monitor(store,()=>{}, {X_BEARER_TOKEN:'test-token'},{fetchImpl:async()=>{calls++;throw Error('offline');}});
  try{
    const started=monitor.start();await new Promise(r=>setImmediate(r));monitor.stop();await started;
    await monitor.start();assert.equal(calls,1);assert.equal(monitor.poll,undefined);
  }finally{monitor.stop();store.close();}
});

test('官方 API 请求进行中停止会取消请求；即使返回迟到响应也不继续初始化',async()=>{
  const store=new Store(':memory:');let signal,release,calls=0;
  const monitor=new Monitor(store,()=>{throw Error('Unexpected notification');},{X_BEARER_TOKEN:'test-token'},{fetchImpl:async(_url,options)=>{
    calls++;signal=options.signal;await new Promise(r=>release=r);return json({data:{id:'123'}});
  }});
  try{
    const started=monitor.start();await until(()=>release);monitor.stop();assert(signal.aborted);release();await started;
    assert.equal(calls,1);assert.equal(monitor.poll,undefined);assert.equal(store.events().length,0);
  }finally{monitor.stop();store.close();}
});
