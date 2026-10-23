import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Monitor,mergeFollowUp} from './monitor.js';
import {Store} from './store.js';
test('只处理指定作者，回复确认先解析原始重置上下文，补漏不会重复入队',async()=>{
 const store=new Store(':memory:');const updates=[];const m=new Monitor(store,e=>updates.push(e),{});m.userId='tibo';
 store.subscribe({endpoint:'browser',keys:{}});
 m.api=async()=>({data:{id:'100',author_id:'tibo',created_at:'2026-10-22T00:00:00Z',text:'Day 17/ it is reset day today.'}});
 await m.enqueue({id:'101',author_id:'other',created_at:'2026-10-23T00:00:00Z',text:'The reset has been processed'});
 assert.equal(store.events().length,0);
 const done={id:'102',author_id:'tibo',created_at:'2026-10-23T00:00:00Z',text:'Done',referenced_tweets:[{type:'replied_to',id:'100'}]};
 await m.enqueue(done);await m.enqueue(done);
 assert.equal(store.event('102').kind,'confirmed');assert.equal(store.jobs().length,1);assert.equal(store.jobs()[0].event,'102');store.close();
});
test('预告不因当前时间超过帖子时间而升级为完成',async()=>{
 const store=new Store(':memory:');const m=new Monitor(store,()=>{},{});m.userId='tibo';
 await m.enqueue({id:'200',author_id:'tibo',created_at:'2020-01-01T00:00:00Z',text:'Global reset landing by EOD'});
 assert.equal(store.event('200').kind,'scheduled');store.close();
});
test('主帖下本人回复的补充说明并入父帖，只留一条事件',async()=>{
 const store=new Store(':memory:');const updates=[];const m=new Monitor(store,e=>updates.push(e),{});m.userId='tibo';
 m.api=async()=>({data:null});
 const main={id:'300',author_id:'tibo',created_at:'2026-10-23T04:46:19Z',text:'Day 18/ Bet you thought we forgot, but no, it is reset day today.'};
 await m.enqueue(main);
 const reply={id:'301',author_id:'tibo',created_at:'2026-10-23T04:47:00Z',text:'Lands tomorrow before 10am PST.',referenced_tweets:[{type:'replied_to',id:'300'}]};
 await m.enqueue(reply);await m.enqueue(reply);
 const events=store.events();
 assert.equal(events.length,1);assert.equal(events[0].id,'300');
 assert.equal(events[0].windowStart,'2026-10-23T07:00:00.000Z');
 assert.equal(events[0].followUps.length,1);
 assert.equal(events[0].followUps[0].id,'301');
 assert.equal(events[0].followUps[0].sourceType,'reply');
 assert.equal(updates.length,1);
 store.close();
});

test('合并保留父帖原有窗口，不被后到的回复覆盖',()=>{
 const parent={id:'3',kind:'scheduled',windowStart:'a',timeNote:'原说明',followUps:[]};
 const merged=mergeFollowUp(parent,{id:'4',at:'2026-10-23T00:00:00Z',windowStart:'b',windowEnd:'c',timeNote:'新说明'});
 assert.equal(merged.windowStart,'a');assert.equal(merged.windowEnd,'c');assert.equal(merged.timeNote,'原说明');
 assert.equal(merged.followUps.length,1);
 assert.equal(mergeFollowUp(merged,{id:'4',at:'2026-10-23T00:00:00Z'}).followUps.length,1);
});
