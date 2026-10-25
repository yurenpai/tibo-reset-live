import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {Monitor} from '../src/monitor.js';
import {classify} from '../src/classify.js';
import {deriveSchedule} from '../src/schedule.js';
import {ResetClock,repairResetSchedules} from '../src/reset-clock.js';
import {resetAppearance,DAY_MS} from '../public/theme.js';
import {filterEvents} from '../public/content.js';
import {wantsNotification} from '../src/preferences.js';
import {buildPlan} from '../src/plan.js';

const announced='2026-10-25T03:39:31.000Z',replyAt='2026-10-25T03:40:04.000Z',due='2026-10-25T08:00:00.000Z';
const main={id:'2114200152701575656',author_id:'tibo',created_at:announced,text:'Day 20/ Rest and reset'};
const reply={id:'2114200291319124163',author_id:'tibo',created_at:replyAt,text:'By midnight PST',referenced_tweets:[{type:'replied_to',id:main.id}]};
const announcement=()=>({id:main.id,kind:'scheduled',topic:'reset',at:announced,url:'https://x.com/thsottiaux/status/'+main.id,excerpt:main.text,...deriveSchedule(reply.text,replyAt,announced)});

test('Day 20 午夜 PST 精确触发北京时间 16:00，保留当地 PDT 午夜 15:00 并非宣布 11:39',()=>{
  assert.equal(classify(main).kind,'scheduled');
  const schedule=deriveSchedule(reply.text,replyAt,announced);
  assert.equal(schedule.triggerAt,due);assert.equal(schedule.windowEnd,'2026-10-25T07:00:00.000Z');assert.equal(schedule.literalEnd,due);
  assert.equal(deriveSchedule('By midnight PT',replyAt,announced).triggerAt,'2026-10-25T07:00:00.000Z');
  assert.equal(deriveSchedule('By midnight PDT',replyAt,announced).triggerAt,'2026-10-25T07:00:00.000Z');
  assert.equal(deriveSchedule('By midnight PST','2026-10-25T08:30:00Z',announced).triggerAt,due);
  assert.equal(deriveSchedule('By midnight PST','2026-11-02T03:40:00Z').triggerAt,'2026-11-02T08:00:00.000Z');
  assert.equal(deriveSchedule('Not by midnight PST',replyAt,announced),null);
});

test('时间回复并入预告，后续 Done 回复仍找得到主帖；卡、模糊时间不自动设截止',async()=>{
  const store=new Store(':memory:'),monitor=new Monitor(store,()=>{},{});monitor.userId='tibo';monitor.api=async()=>({data:null});
  try{
    await monitor.enqueue(main);await monitor.enqueue(reply);
    assert.equal(store.events().length,1);assert.equal(store.event(main.id).kind,'scheduled');assert.equal(store.event(main.id).triggerAt,due);
    assert.equal(store.event(main.id).followUps[0].id,reply.id);
    await monitor.enqueue({id:'done',author_id:'tibo',created_at:'2026-10-25T08:10:00Z',text:'Done',referenced_tweets:[{type:'replied_to',id:reply.id}]});
    assert.equal(store.event('done').kind,'confirmed');assert.equal(store.event('done').parent,main.id);
    assert.equal(classify({text:'By midnight PST'},{kind:'banked'}).kind,'banked');
    await monitor.enqueue({...main,id:'card',text:'Day 21 / Banked reset'});
    await monitor.enqueue({...reply,id:'card-time',referenced_tweets:[{type:'replied_to',id:'card'}]});
    assert.equal(store.event('card').kind,'banked');assert.equal(store.event('card').triggerAt,due);assert.equal(store.event('card-time'),null);
    assert.equal(deriveSchedule('Reset soon',replyAt),null);
  }finally{monitor.stop();store.close();}
});

test('到点前不触发；到点后台入库并入通知队列一次，人物从截止时刻开始计算',()=>{
  const store=new Store(':memory:'),sent=[];let now=Date.parse(due)-1;
  store.subscribe({endpoint:'browser',keys:{},preferences:{confirmed:true}});store.addEvent(announcement());
  const clock=new ResetClock(store,(e,options)=>sent.push({e,options}),{now:()=>now});
  try{
    assert.equal(clock.tick(),0);assert.equal(resetAppearance(store.events(),now).pending,true);
    now++;assert.equal(clock.tick(),1);assert.equal(clock.tick(),0);
    const event=store.event('timed-'+main.id);assert.equal(event.at,due);assert.equal(event.announcementAt,announced);assert.equal(event.evidence,'schedule');
    assert.equal(store.jobs().length,1);assert.equal(sent.length,1);assert.equal(sent[0].options.notify,true);
    const theme=resetAppearance(store.events(),now);assert(theme.celebration);assert(theme.timedOnly);assert.equal(theme.pending,false);assert.equal(theme.stage,0);
    assert.equal(resetAppearance(store.events(),now+DAY_MS).stage,1);assert.equal(resetAppearance(store.events(),now+4*DAY_MS).stage,4);
    assert(filterEvents(store.events(),'reset').some(e=>e.kind==='timed'));
    assert(wantsNotification({confirmed:true,scheduled:false},event));assert(!wantsNotification({confirmed:false,scheduled:true},event));
  }finally{clock.stop();store.close();}
});

test('重启恢复错过的到点，六小时内补提醒且持久去重；初次安装和旧记录静默',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-clock-')),file=path.join(dir,'calendar.sqlite');let store=new Store(file),now=Date.parse(due)-1000,notifications=0;
  let clock=new ResetClock(store,(_e,o)=>{if(o.notify)notifications++;},{now:()=>now});
  try{
    store.addEvent(announcement());clock.start();clock.stop();store.close();
    now=Date.parse(due)+3600000;store=new Store(file);clock=new ResetClock(store,(_e,o)=>{if(o.notify)notifications++;},{now:()=>now});clock.start();clock.stop();
    assert.equal(notifications,1);assert.equal(store.event('timed-'+main.id).at,due);store.close();
    store=new Store(file);clock=new ResetClock(store,(_e,o)=>{if(o.notify)notifications++;},{now:()=>now});clock.start();clock.stop();assert.equal(notifications,1);
    const fresh=new Store(':memory:');fresh.addEvent(announcement());const first=new ResetClock(fresh,(_e,o)=>assert.equal(o.notify,false),{now:()=>now});first.start();first.stop();fresh.close();
  }finally{clock.stop();store.close();assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true});}
});

test('旧于六小时、首次基线及历史回填仍入日历但不提醒，偏好关闭不入 Web Push 队列',()=>{
  for(const extra of [{},{scheduleNotify:false},{historical:true}]){
    const store=new Store(':memory:'),notifications=[];store.addEvent({...announcement(),...extra});store.subscribe({endpoint:'browser',keys:{},preferences:{confirmed:false}});
    const clock=new ResetClock(store,(_e,o)=>notifications.push(o.notify),{now:()=>Date.parse(due)+(Object.keys(extra).length?1000:7*3600000)});
    try{clock.tick();assert.deepEqual(notifications,[false]);assert.equal(store.jobs().length,0);}finally{store.close();}
  }
});

test('已有同次完成或观测时不再到点触发；无明确截止、卡、功能、候选永不触发',()=>{
  for(const kind of ['confirmed','observed']){
    const store=new Store(':memory:');store.addEvent(announcement());store.addEvent({id:'done',kind,topic:'reset',parent:main.id,at:'2026-10-25T06:00:00Z'});
    const clock=new ResetClock(store,()=>{throw Error('Duplicate');},{now:()=>Date.parse(due)});
    try{assert.equal(clock.tick(),0);}finally{store.close();}
  }
  const store=new Store(':memory:');for(const kind of ['banked','feature','candidate'])store.addEvent({...announcement(),id:kind,kind});
  store.addEvent({id:'no-deadline',kind:'scheduled',at:announced});
  try{assert.equal(new ResetClock(store,()=>{}, {now:()=>Date.parse(due)}).tick(),0);}finally{store.close();}
});

test('不同计划日的过期预告分别保留历史，到点记录按父预告归 Day 20，原帖时间仍为 11:39',()=>{
  const store=new Store(':memory:');store.addEvent(announcement());store.addEvent({...announcement(),id:'previous',at:'2026-10-23T04:00:00Z',triggerAt:'2026-10-24T08:00:00Z',url:'https://x.com/thsottiaux/status/previous'});
  try{
    new ResetClock(store,()=>{}, {now:()=>Date.parse(due)}).tick(false);assert(store.event('timed-previous'));assert(store.event('timed-'+main.id));
    const plan=buildPlan({plan:{start:'2026-10-05',days:28},entries:[]},Date.parse(due),store.events()),day=plan.days[19];
    assert.equal(day.date,'2026-10-24');assert.equal(day.resetStatus,'triggered');assert.equal(day.sourceAt,announced);assert.equal(plan.counts.timedResets,2);assert.equal(plan.counts.resets,0);
  }finally{store.close();}
});

test('旧版误判及候选时间回复被静默修正，游标、偏好、已发记录与真实完成事件保持',()=>{
  const store=new Store(':memory:');store.set('publicFeedCursor','old-cursor');store.set('desktopSent:'+main.id,'already-sent');store.set('desktopSettings','private-settings');
  store.addEvent({...announcement(),kind:'confirmed',title:'Tibo 已宣布重置',triggerAt:undefined,windowEnd:undefined,literalEnd:undefined});
  store.addEvent({id:reply.id,kind:'candidate',topic:'reset',at:replyAt,excerpt:reply.text,url:'https://x.com/thsottiaux/status/'+reply.id,parent:main.id});
  store.addEvent({id:'real-done',kind:'confirmed',at:'2026-10-25T09:00:00Z',parent:main.id});
  try{
    repairResetSchedules(store);const fixed=store.event(main.id);assert.equal(fixed.kind,'scheduled');assert.equal(fixed.at,announced);assert.equal(fixed.triggerAt,due);assert.equal(fixed.followUps.length,1);
    assert.equal(store.event(reply.id).mergedInto,main.id);assert.equal(store.event('real-done').kind,'confirmed');
    assert.equal(store.get('publicFeedCursor'),'old-cursor');assert.equal(store.get('desktopSent:'+main.id),'already-sent');assert.equal(store.get('desktopSettings'),'private-settings');
    const before=JSON.stringify(store.events());repairResetSchedules(store);assert.equal(JSON.stringify(store.events()),before);
    const monitor=new Monitor(store,()=>{},{});assert.equal(monitor.resolveParentEvent(reply.id).id,main.id);monitor.stop();
  }finally{store.close();}
});
