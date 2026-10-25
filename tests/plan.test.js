import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planCalendar,dayOf,planProgress,buildPlan,filterEvents} from '../src/plan.js';
import {dateInZone,timeInZone} from '../public/content.js';
import {normalizePreferences,wantsNotification,DEFAULT_PREFERENCES} from '../src/preferences.js';
import {Store} from '../src/store.js';
import {resetAppearance,DAY_MS} from '../public/theme.js';
const doc=JSON.parse(fs.readFileSync(new URL('../resources/plan-data.json',import.meta.url),'utf8'));
const now=Date.parse('2026-10-23T12:00:00Z');

test('28 个连续 PT 计划日跨月，终点 11 月 1 日包含 DST 的 25 小时',()=>{
 const days=planCalendar(doc.plan);
 assert.equal(days.length,28);assert.equal(days[0].date,'2026-10-05');assert.equal(days.at(-1).date,'2026-11-01');
 for(let i=1;i<days.length;i++)assert.equal(days[i-1].endAt,days[i].startAt);
 assert.equal(Date.parse(days.at(-1).endAt)-Date.parse(days.at(-1).startAt),25*3600000);
});
test('Day 18 的 UTC/北京时间次日不改变 PT 计划日期',()=>{
 const at='2026-10-23T04:46:19Z';
 assert.equal(dayOf(at,doc.plan),18);
 assert.equal(dateInZone(at,'America/Los_Angeles'),'2026-10-22');
 assert.equal(dateInZone(at,'Asia/Shanghai'),'2026-10-23');
 assert.equal(timeInZone(at,'Asia/Shanghai'),'2026-10-23 12:46');
 assert.equal(dayOf('2026-10-05T06:59:59Z',doc.plan),null);
 assert.equal(dayOf('2026-10-05T07:00:00Z',doc.plan),1);
 assert.equal(dayOf('invalid',doc.plan),null);
});
test('时间进度不是完成数；开始前 0 天、结束后封顶 28 天',()=>{
 assert.equal(planProgress(Date.parse('2026-10-04T22:00Z'),doc.plan).day,0);
 const active=buildPlan(doc,now);assert.equal(active.counts.done,19);assert.equal(active.counts.remaining,9);
 assert.equal(active.counts.recordedDays,18);
 const after=buildPlan(doc,Date.parse('2026-11-03T12:00Z'));assert.equal(after.counts.done,28);assert.equal(after.counts.remaining,0);
});
test('未来空白与过去空白都待观察，不推断没有更新或已完成',()=>{
 const empty={...doc,entries:[]};const result=buildPlan(empty,now);
 assert.equal(result.days[0].status,'pending');assert.match(result.days[0].summary,/不代表/);
 assert.equal(result.days[18].title,'待观察');assert.match(result.days[18].summary,/今天/);
 assert.equal(result.days[27].plannedType,'upcoming');assert.equal(result.days[27].sourceUrl,null);
});
test('计划条目标 confirmed 也不能直接产生官方重置计数',()=>{
 const forged={...doc,entries:[{day:19,date:'2026-10-23',plannedType:'reset',status:'confirmed',title:'声明',summary:'不是完成证据',sourceUrl:'https://x.com/thsottiaux/status/test',sourceAt:'2026-10-23T09:00Z'}]};
 const result=buildPlan(forged,now,[]);
 assert.equal(result.counts.resets,0);assert.equal(result.days[18].resetStatus,'reported');
});
test('完成证据按日去重，观测按主帖关联，发卡与未来确认不算官方重置',()=>{
 const events=[
  {id:'a',at:'2026-10-21T22:00Z',kind:'confirmed',topic:'reset'},
  {id:'b',at:'2026-10-21T23:00Z',kind:'confirmed',topic:'reset'},
  {id:'c',at:'2026-10-23T01:00Z',kind:'banked',topic:'reset'},
  {id:'d',at:'2026-10-25T01:00Z',kind:'confirmed',topic:'reset'},
  {id:'e',at:'2026-10-22T17:10Z',kind:'observed',topic:'reset',announcementSource:doc.entries.find(e=>e.day===17).sourceUrl}
 ];
 const result=buildPlan(doc,now,events);
 assert.equal(result.counts.resets,1);assert.equal(result.days[16].confirmedReset,true);
 assert.equal(result.days[17].confirmedReset,false);assert.equal(result.days[17].resetStatus,'reported');
});
test('混合计划中的功能与重置状态独立，功能 reported 不会将 reset planned 升级',()=>{
 const events=[{id:'r',at:'2026-10-23T04:46Z',topic:'reset',kind:'scheduled',status:'planned'},{id:'f',at:'2026-10-23T04:46Z',topic:'feature',kind:'feature',status:'reported'}];
 const d=buildPlan(doc,now,events).days[17];
 assert.equal(d.plannedType,'feature_reset');assert.equal(d.status,'reported');assert.equal(d.resetStatus,'planned');assert.equal(d.confirmedReset,false);
});
test('实时功能进入未收录计划日；计划日期由 PT 时间而非任意 planDay 决定',()=>{
 const events=[{id:'f19',at:'2026-10-23T08:00Z',planDay:18,topic:'feature',kind:'feature',title:'新功能',note:'已报告',url:'https://x.com/thsottiaux/status/new'}];
 const d=buildPlan(doc,now,events).days[18];assert.equal(d.title,'新功能');assert.equal(d.status,'reported');assert.equal(d.plannedType,'feature');
});
test('筛选只改变显示，功能绝不进入重置动态，摘要与候选不占公开动态',()=>{
 const events=[{id:'r',kind:'confirmed',topic:'reset'},{id:'o',kind:'observed',topic:'reset'},{id:'p',kind:'scheduled'},{id:'b',kind:'banked'},{id:'f',kind:'feature',topic:'feature'},{id:'c',kind:'candidate'},{id:'d',kind:'digest',topic:'plan'}];
 assert.deepEqual(filterEvents(events,'reset').map(e=>e.id),['r','o','p','b']);
 assert.deepEqual(filterEvents(events,'plan').map(e=>e.id),['f']);
 assert.equal(filterEvents(events,'all').length,5);
 assert.equal(wantsNotification(DEFAULT_PREFERENCES,events[0]),true);
});
test('通知默认只有官方确认和社区观测开启；未知字段、字符串不能开启偏好',()=>{
 assert.deepEqual(normalizePreferences({feature:'true',anything:true}),DEFAULT_PREFERENCES);
 for(const kind of ['confirmed','observed'])assert.equal(wantsNotification({}, {kind}),true);
 for(const kind of ['scheduled','banked','candidate','feature'])assert.equal(wantsNotification({}, {kind}),false);
 assert.equal(wantsNotification({feature:true},{topic:'feature',kind:'feature'}),true);
 assert.equal(wantsNotification({digest:true},{topic:'plan',kind:'digest'}),true);
});
test('数据库持久保存订阅偏好，关闭页面后按服务器设置分别入队',()=>{
 const s=new Store(':memory:');
 s.subscribe({endpoint:'reset-user',keys:{},preferences:{confirmed:true,feature:false}});
 s.subscribe({endpoint:'feature-user',keys:{},preferences:{confirmed:false,observed:false,feature:true}});
 s.addEvent({id:'f',kind:'feature',topic:'feature'},true);
 s.addEvent({id:'r',kind:'confirmed',topic:'reset'},true);
 assert.deepEqual(s.jobs().map(j=>[j.event,j.endpoint]).sort(),[['f','feature-user'],['r','reset-user']]);
 assert.equal(s.subscriptions().find(x=>x.endpoint==='feature-user').preferences.feature,true);s.close();
});
test('官方完整狂欢、观测轻庆祝，功能/发卡/预告不恢复人物',()=>{
 const recent=new Date(now-1000).toISOString();
 assert.equal(resetAppearance([{kind:'confirmed',topic:'reset',at:recent}],now).mood,'full');
 assert.equal(resetAppearance([{kind:'observed',topic:'reset',at:recent}],now).mood,'soft');
 assert.equal(resetAppearance([{kind:'observed',at:recent}],now,0).mood,'full');
 const old={kind:'confirmed',topic:'reset',at:new Date(now-4*DAY_MS).toISOString()};
 for(const e of [{kind:'banked',topic:'reset'},{kind:'scheduled',topic:'reset'},{kind:'confirmed',topic:'feature'},{kind:'feature',topic:'feature'}]){
  const state=resetAppearance([old,{...e,at:recent}],now);assert.equal(state.stage,4);assert.equal(state.mood,'none');
 }
});
