import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPlan} from '../src/plan.js';
import {Store} from '../src/store.js';
import {DesktopNotifications} from '../src/desktop.js';
const doc={plan:{start:'2026-10-05',days:28,timeZone:'America/Los_Angeles'},entries:[]};
const now=Date.parse('2026-10-07T22:00:00Z');
const parent={id:'p',topic:'reset',kind:'scheduled',at:'2026-10-05T20:00:00Z'};
test('R1: cross-day feature replies use their own PT date; reset completion retains parent day',()=>{
 const feature={id:'f',topic:'feature',kind:'feature',parent:'p',at:'2026-10-06T20:00:00Z',title:'feature'};
 const done={id:'d',topic:'reset',kind:'confirmed',parent:'p',at:feature.at};
 const plan=buildPlan(doc,now,[parent,feature,done]);
 assert.deepEqual(plan.days[1].events.map(e=>e.id),['f']);
 assert.deepEqual(plan.days[0].events.map(e=>e.id),['p','d']);
 assert.equal(plan.days[1].sourceAt,feature.at);
});
test('R1: same-day mixed topics and cyclic reset parents remain finite',()=>{
 const f={id:'f',topic:'feature',kind:'feature',parent:'p',at:parent.at};
 const a={id:'a',topic:'reset',kind:'confirmed',parent:'b',at:'2026-10-06T20:00:00Z'};
 const b={...a,id:'b',parent:'a'};
 const plan=buildPlan(doc,now,[parent,f,a,b]);
 assert.equal(plan.days[0].plannedType,'feature_reset');
 assert.equal(plan.days[1].events.length,2);
});
test('R2: failed desktop delivery retries from persisted queue after restart, only once',async()=>{
 const store=new Store(':memory:');let clock=now,calls=0;
 const first=new DesktopNotifications(store,{now:()=>clock,send:async()=>{calls++;throw Error('temporary');}});
 first.save({enabled:true});
 const event={id:'r',topic:'reset',kind:'confirmed',at:new Date(now-1000).toISOString(),title:'reset'};
 first.event(event);await first.chain;assert.equal(calls,1);assert.equal(store.get('desktopSent:r'),undefined);
 const second=new DesktopNotifications(store,{now:()=>clock,send:async()=>{calls++;}});
 await second.retryPending();assert.equal(calls,1);
 clock+=30000;await second.retryPending();assert.equal(calls,2);assert.ok(store.get('desktopSent:r'));
 second.event(event);await second.chain;await second.retryPending();assert.equal(calls,2);store.close();
});
test('R2: disabled preferences and expired pending events are not retried',async()=>{
 const store=new Store(':memory:');let clock=now,calls=0;
 const desktop=new DesktopNotifications(store,{now:()=>clock,send:async()=>{calls++;throw Error('temporary');}});
 desktop.save({enabled:true});
 const event={id:'r',topic:'reset',kind:'confirmed',at:new Date(now-1000).toISOString(),title:'reset'};
 desktop.event(event);await desktop.chain;desktop.save({enabled:false});desktop.save({enabled:true});
 clock+=30000;await desktop.retryPending();assert.equal(calls,1);
 desktop.event({...event,id:'expired'});await desktop.chain;assert.equal(calls,2);
 clock+=6*3600000;await desktop.retryPending();assert.equal(calls,2);store.close();
});
