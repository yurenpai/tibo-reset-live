import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveSchedule} from '../src/schedule.js';

const PST_REPLY='Lands tomorrow before 10am PST.';

test('把太平洋时间换算成 UTC 窗口，并保留 PST/PDT 字面歧义',()=>{
 const s=deriveSchedule(PST_REPLY,'2026-10-23T04:46:19Z');
 assert.equal(s.windowStart,'2026-10-23T07:00:00.000Z');
 assert.equal(s.windowEnd,'2026-10-23T17:00:00.000Z');
 // 10 月洛杉矶仍是 PDT（UTC-7）；Tibo 写 PST，字面晚一小时。
 assert.equal(s.literalEnd,'2026-10-23T18:00:00.000Z');
 assert.match(s.timeNote,/PDT/);
});

test('夏令时结束后 PST 与当地时区一致，不再提示歧义',()=>{
 const s=deriveSchedule(PST_REPLY,'2026-11-01T04:46:19Z');
 assert.equal(s.windowEnd,'2026-11-01T18:00:00.000Z');
 assert.equal(s.literalEnd,null);
 assert.doesNotMatch(s.timeNote,/PDT/);
});

test('跨夏令时切换日按当地日历取次日，不做固定 24 小时加法',()=>{
 // 2026-11-01 洛杉矶结束夏令时；次日正午仍是 PST。
 const s=deriveSchedule(PST_REPLY,'2026-10-31T20:00:00Z');
 assert.equal(s.windowStart,'2026-11-01T07:00:00.000Z');
 assert.equal(s.windowEnd,'2026-11-01T18:00:00.000Z');
});

test('无时间表述或无法解析时不给推算窗口',()=>{
 for(const [text,at] of [['Day 18/ reset day today','2026-10-23T04:46:19Z'],[PST_REPLY,'not a date'],['',null]])assert.equal(deriveSchedule(text,at),null);
});
