import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resetAppearance,DAY_MS} from './public/theme.js';
const now=Date.parse('2026-10-23T12:00:00Z');
test('只有确认重置触发狂欢，预告和发卡不重置人物',()=>{
 const events=[{kind:'confirmed',at:new Date(now-3*DAY_MS).toISOString()},{kind:'scheduled',at:new Date(now).toISOString()},{kind:'banked',at:new Date(now).toISOString()}];
 assert.equal(resetAppearance(events,now).stage,3);assert.equal(resetAppearance(events,now).celebration,false);
 assert.equal(resetAppearance([{kind:'confirmed',at:new Date(now-1000).toISOString()}],now).celebration,true);
});
test('24 小时边界退出狂欢，第五阶段封顶，未来时间不参与计算',()=>{
 for(const [days,stage,celebration] of [[0,0,true],[1,1,false],[2,2,false],[3,3,false],[4,4,false],[20,4,false]]){
 const s=resetAppearance([{kind:'confirmed',at:new Date(now-days*DAY_MS).toISOString()}],now);assert.equal(s.stage,stage);assert.equal(s.celebration,celebration);}
 assert.equal(resetAppearance([{kind:'confirmed',at:new Date(now+DAY_MS).toISOString()}],now).days,null);
});
test('外观预览不修改数据，退出后恢复真实阶段',()=>{
 const events=[{kind:'confirmed',at:new Date(now-5*DAY_MS).toISOString()}];const saved=JSON.stringify(events);
 assert.equal(resetAppearance(events,now,0).celebration,true);assert.equal(JSON.stringify(events),saved);assert.equal(resetAppearance(events,now).stage,4);
 assert.equal(resetAppearance([],now).celebration,false);
});
test('社区观测到账也推进人物阶段，但不会单独构成“确认”字样',()=>{
 const now2=Date.parse('2026-10-23T12:00:00Z');
 const observed=[{kind:'observed',at:new Date(now2-2*DAY_MS).toISOString()}];
 const s=resetAppearance(observed,now2);
 assert.equal(s.days,2);assert.equal(s.stage,2);assert.equal(s.celebration,false);
 assert.equal(s.last.kind,'observed');
});
test('观测比确认更新时，按更近的完成记录计算人物阶段',()=>{
 const now3=Date.parse('2026-10-23T12:00:00Z');
 const events=[
  {kind:'confirmed',at:new Date(now3-5*DAY_MS).toISOString()},
  {kind:'observed',at:new Date(now3-DAY_MS).toISOString()},
  {kind:'scheduled',at:new Date(now3).toISOString()}
 ];
 const s=resetAppearance(events,now3);
 assert.equal(s.last.kind,'observed');assert.equal(s.stage,1);assert.equal(s.celebration,false);
});
