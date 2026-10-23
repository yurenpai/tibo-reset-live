import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseObservations,toObservedEvent,Observations} from './observations.js';
import {Store} from './store.js';

const now=Date.parse('2026-10-23T04:00:00Z');
const base={id:'day18-20261023T0100Z',at:'2026-10-23T01:00:00Z',url:'https://example.test/tracker',note:'公共追踪记录观测到重置。',scope:'Codex 用户'};

test('观测记录永远不是官方确认，并保留来源与适用范围',()=>{
 const e=toObservedEvent(base);
 assert.equal(e.kind,'observed');
 assert.equal(e.id,'observed-day18-20261023T0100Z');
 assert.equal(e.sourceType,'community');
 assert.equal(e.scope,'Codex 用户');
 assert.equal(e.url,'https://example.test/tracker');
});

test('丢弃缺字段、未来时间和过期记录，不做猜测补全',()=>{
 const rows=parseObservations({observations:[
  base,
  {...base,id:'no-url',url:''},
  {...base,id:'future',at:'2026-10-25T00:00:00Z'},
  {...base,id:'stale',at:'2026-10-01T00:00:00Z'},
  {...base,id:''},
  {...base,at:'garbage'}
 ]},now);
 assert.deepEqual(rows.map(r=>r.id),['observed-day18-20261023T0100Z']);
});

test('非数组载荷与重复 id 不会写入多条',()=>{
 assert.deepEqual(parseObservations(null,now),[]);
 assert.deepEqual(parseObservations({events:[]},now),[]);
 assert.equal(parseObservations([base,{...base,note:'重复'}],now).length,1);
});

test('观测入库只入队一次，重复检查不重复推送',async()=>{
 const store=new Store(':memory:');store.subscribe({endpoint:'browser',keys:{}});
 const notified=[];
 const payload={observations:[base]};
 const obs=new Observations(store,e=>notified.push(e),['https://example.test/feed'],{fetchImpl:async()=>({ok:true,json:async()=>payload})});
 assert.equal(await obs.check(),1);
 assert.equal(await obs.check(),0);
 assert.equal(store.events().length,1);
 assert.equal(store.event('observed-day18-20261023T0100Z').kind,'observed');
 assert.equal(store.jobs().length,1);
 assert.equal(notified.length,1);
 store.close();
});

test('单个观测源失败不影响其他源，并记录错误',async()=>{
 const store=new Store(':memory:');
 const obs=new Observations(store,()=>{},['https://bad.test/feed','https://good.test/feed'],{fetchImpl:async url=>{
  if(url.includes('bad'))throw new Error('网络不可达');
  return {ok:true,json:async()=>({observations:[base]})};
 }});
 assert.equal(await obs.check(),1);
 assert.match(store.get('observationError'),/网络不可达/);
 assert.ok(store.get('observationCheck'));
 store.close();
});
