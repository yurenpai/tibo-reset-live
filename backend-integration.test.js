import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Store } from './store.js';
import { Monitor } from './monitor.js';
import { classifyFeature, classifyEvents } from './classify.js';
import { toObservedEvent } from './observations.js';
import { DEFAULT_PREFERENCES } from './preferences.js';
import { createApp, DailyDigest, deliverPending, seedHistoricalEvents } from './server.js';
import { resetAppearance } from './public/theme.js';

const planDoc=JSON.parse(fs.readFileSync(new URL('./plan-data.json',import.meta.url),'utf8'));
const post=(id,text,reply)=>({id,author_id:'tibo',created_at:'2026-10-23T04:46:19Z',text,...(reply?{referenced_tweets:[{type:'replied_to',id:reply}]}:{})});
const subscriber=(endpoint,preferences)=>({endpoint,keys:{p256dh:'a'.repeat(87),auth:'a'.repeat(22)},preferences});

test('backend: feature detection needs an explicit Day N release, and mixed topics have independent IDs',async()=>{
  for(const text of ['Done','Day 19/ It is reset day today.','Day 19/ We will ship a faster desktop app tomorrow.','We shipped a faster desktop app.','Day 19/ No reset today.'])assert.equal(classifyFeature({text}),null);
  const feature=classifyFeature({text:'Day 19/ We shipped a faster desktop app.'});
  assert.equal(feature.kind,'feature');assert.equal(feature.topic,'feature');assert.equal(feature.status,'reported');assert.equal(feature.evidence,'official');
  const classified=classifyEvents({text:'Day 19/ We shipped a faster desktop app. It is reset day today.'});
  assert.deepEqual(classified.map(e=>e.kind),['scheduled','feature']);
  const store=new Store(':memory:');
  try {
    store.subscribe(subscriber('default',undefined));store.subscribe(subscriber('feature',{feature:true}));
    const monitor=new Monitor(store,()=>{},{});monitor.userId='tibo';
    const mixed=post('500','Day 19/ We shipped a faster desktop app. It is reset day today.');
    await monitor.enqueue(mixed);await monitor.enqueue(mixed);
    assert.equal(store.events().length,2);assert.equal(store.event('500').topic,'reset');assert.equal(store.event('500-feature').kind,'feature');
    assert.equal(resetAppearance(store.events(),Date.parse('2026-10-23T05:00:00Z')).last,null);
    assert.deepEqual(store.jobs().map(j=>[j.event,j.endpoint]),[['500-feature','feature']]);
  }finally{store.close();}
});

test('backend: multi-hop merged reply context preserves Done and deduplicates delivery',async()=>{
  const store=new Store(':memory:');
  try {
    store.subscribe(subscriber('default',undefined));
    const monitor=new Monitor(store,()=>{},{});monitor.userId='tibo';
    const ancestors={
      '600':post('600','Day 18/ It is reset day today.'),
      '601':post('601','Lands tomorrow before 10am PST.','600'),
      '602':post('602','Lands tomorrow before 10am PST.','601'),
      '603':post('603','Lands tomorrow before 10am PST.','602'),
      '604':post('604','Lands tomorrow before 10am PST.','603')
    };
    monitor.api=async route=>({data:ancestors[route.match(/^tweets\/(\d+)/)[1]]});
    const done=post('605','Done','604');
    await monitor.enqueue(done);await monitor.enqueue(done);
    assert.equal(store.event('605').kind,'confirmed');assert.equal(store.event('605').evidence,'official');assert.equal(store.event('605').status,'confirmed');
    assert.equal(store.event('605').parent,'600');assert.equal(store.event('605').replyTo,'604');
    assert.equal(store.event('600').followUps.length,4);assert.equal(store.events().length,2);
    assert.deepEqual(store.jobs().map(j=>j.event),['605']);
  }finally{store.close();}
});

test('backend: Done on historical merged reply resolves without fetching and banked is not reset confirmation',async()=>{
  const store=new Store(':memory:');
  try {
    store.upsertHistoricalEvent({id:'700',at:'2026-10-22T00:00:00Z',kind:'banked',topic:'reset',evidence:'official',status:'reported',followUps:[{id:'701'}]});
    const monitor=new Monitor(store,()=>{},{});monitor.userId='tibo';
    monitor.api=async()=>{throw new Error('must resolve historical follow-up locally');};
    await monitor.enqueue(post('702','Done','701'));
    assert.equal(store.event('702').kind,'banked');assert.equal(store.event('702').status,'confirmed');assert.equal(store.events().some(e=>e.kind==='confirmed'),false);
  }finally{store.close();}
});

test('backend: historical features use verified actual posting time and never queue old notifications',()=>{
  const store=new Store(':memory:');
  try {
    store.subscribe(subscriber('all',{feature:true,confirmed:true,observed:true}));
    seedHistoricalEvents(store,{events:[]},planDoc);
    const featureEntries=planDoc.entries.filter(e=>['feature','feature_reset'].includes(e.plannedType)&&e.status==='reported');
    assert.ok(featureEntries.length>0);
    for(const entry of featureEntries) {
      const id=entry.sourceUrl.split('/').at(-1)+'-feature';
      const event=store.event(id);
      assert.ok(event,`missing historical feature ${entry.day}`);
      assert.equal(event.at,new Date(entry.sourceAt).toISOString());assert.equal(event.topic,'feature');assert.equal(event.kind,'feature');assert.equal(event.historical,true);
    }
    assert.equal(store.jobs().length,0);
    seedHistoricalEvents(store,{events:[]},{...planDoc,entries:[{...featureEntries[0],sourceUrl:'https://x.com/thsottiaux/status/999999',sourceAt:undefined}]});
    assert.equal(store.event('999999-feature'),null);
    const observed=toObservedEvent({id:'source',at:'2026-10-23T00:00:00Z',url:'https://example.test/evidence'});
    assert.equal(observed.topic,'reset');assert.equal(observed.evidence,'community');assert.equal(observed.status,'observed');
  }finally{store.close();}
});

test('backend: preferences API reads saved preferences and only merges known boolean updates',async()=>{
  const store=new Store(':memory:');
  store.subscribe(subscriber('saved',{...DEFAULT_PREFERENCES,feature:true}));
  const app=createApp({store,history:{events:[]},planDoc,monitor:{status:{}},now:()=>Date.parse('2026-10-23T05:00:00Z')});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async body=>{
    const response=await fetch(base+'/api/preferences',{method:'POST',headers:{origin:'http://localhost:8788','content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  try {
    const read=await request({endpoint:'saved'});assert.equal(read.body.preferences.feature,true);assert.equal(read.body.preferences.digest,false);
    const updated=await request({endpoint:'saved',preferences:{digest:true,confirmed:false,feature:'false',secret:true}});
    assert.equal(updated.body.preferences.digest,true);assert.equal(updated.body.preferences.confirmed,false);assert.equal(updated.body.preferences.feature,true);assert.equal('secret' in updated.body.preferences,false);
    const reread=await request({endpoint:'saved'});assert.deepEqual(reread.body.preferences,updated.body.preferences);
    assert.equal((await request({endpoint:'missing'})).status,404);
    assert.equal((await request({endpoint:'saved',preferences:null})).status,400);
    const calendar=await (await fetch(base+'/api/calendar')).json();assert.equal(calendar.plan.days.length,28);assert.equal(calendar.plan.todayPT,'2026-10-22');
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});

test('backend: delivery rechecks preferences and never passes them to web-push',async()=>{
  const store=new Store(':memory:');
  try {
    store.subscribe(subscriber('one',{feature:true}));
    store.addEvent({id:'feature',at:'2026-10-23T00:00:00Z',topic:'feature',kind:'feature',title:'feature',note:'reported'},true);
    store.subscribe(subscriber('one',{feature:false}));
    const sent=[];await deliverPending(store,(...args)=>sent.push(args));assert.equal(sent.length,0);assert.equal(store.jobs().length,0);
    store.subscribe({...subscriber('one',{feature:true}),extra:'not for webpush'});
    store.addEvent({id:'feature2',at:'2026-10-23T00:00:00Z',topic:'feature',kind:'feature',title:'feature',note:'reported'},true);
    await deliverPending(store,async(...args)=>sent.push(args));assert.equal(sent.length,1);assert.deepEqual(Object.keys(sent[0][0]).sort(),['endpoint','keys']);
  }finally{store.close();}
});

test('backend: digest is opt-in, PT 18:00, durable once per date, with no startup or stale backlog',async()=>{
  const store=new Store(':memory:');
  let now=Date.parse('2026-10-23T00:59:00Z'); // Oct 22 PT17:59
  try {
    store.subscribe(subscriber('default',undefined));store.subscribe(subscriber('digest',{digest:true}));
    const digest=new DailyDigest(store,planDoc,()=>{},()=>now);
    assert.equal(digest.tick(),false);
    now=Date.parse('2026-10-23T01:00:00Z');
    assert.equal(digest.tick(),true);assert.equal(digest.tick(),false);
    assert.equal(store.event('digest-2026-10-22').topic,'plan');assert.deepEqual(store.jobs().map(j=>j.endpoint),['digest']);
    const restarted=new DailyDigest(store,planDoc,()=>{},()=>now);restarted.start();restarted.stop();assert.equal(store.jobs().length,1);
    now=Date.parse('2026-10-24T01:01:00Z');
    const startup=new DailyDigest(store,planDoc,()=>{},()=>now);startup.start();startup.stop();
    assert.ok(store.event('digest-2026-10-23'));assert.equal(store.event('digest-2026-10-23').historical,true);
    const sent=[];await deliverPending(store,async(...args)=>sent.push(args),now);assert.equal(sent.length,0);assert.equal(store.jobs().length,0);
    now=Date.parse('2026-10-28T01:00:00Z');assert.equal(digest.tick(),true);assert.equal(store.event('digest-2026-10-26'),null);
    now=Date.parse('2026-11-03T02:00:00Z');assert.equal(digest.tick(),false);
  }finally{store.close();}
});
