// 计划按 PT 日期归属，事件本身仍保存 UTC 时间，详情同时显示北京时间。
import { wallTimeToUtc, PACIFIC_ZONE } from './schedule.js';
import { dateInZone } from '../public/content.js';
export { filterEvents } from '../public/content.js';
export const PLAN_TYPES=['feature','reset','feature_reset','upcoming'];
export const PLAN_STATUSES=['planned','reported','confirmed','observed','pending','triggered'];
const pad=n=>String(n).padStart(2,'0');
export function parseYmd(ymd){const [year,month,day]=String(ymd).split('-').map(Number);return {year,month,day};}
export function ptMidnight(date){return wallTimeToUtc({...date,hour:0},PACIFIC_ZONE);}
export function planCalendar(plan){
 const start=parseYmd(plan.start),out=[];
 for(let i=0;i<plan.days;i++){
  const d=new Date(Date.UTC(start.year,start.month-1,start.day+i));
  const date={year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};
  const next=new Date(Date.UTC(date.year,date.month-1,date.day+1));
  out.push({day:i+1,date:`${date.year}-${pad(date.month)}-${pad(date.day)}`,startAt:ptMidnight(date).toISOString(),endAt:ptMidnight({year:next.getUTCFullYear(),month:next.getUTCMonth()+1,day:next.getUTCDate()}).toISOString()});
 }
 return out;
}
export function dayOf(at,plan){
 if(!Number.isFinite(Date.parse(at)))return null;
 return planCalendar(plan).find(d=>d.date===dateInZone(at,PACIFIC_ZONE))?.day??null;
}
export function planProgress(now,plan){
 const today=dateInZone(now,PACIFIC_ZONE),cal=planCalendar(plan);
 return {today,day:cal.find(d=>d.date===today)?.day??(today<cal[0].date?0:plan.days),before:today<cal[0].date,after:today>cal.at(-1).date};
}

// 静态计划条目只作线索，实际重置计数必须来自完成证据，不来自声明或卡片颜色。
export function buildPlan(doc,now=Date.now(),events=[]){
 const plan={...doc.plan},cal=planCalendar(plan),todayPT=dateInZone(now,PACIFIC_ZONE);
 const entries=new Map(doc.entries.filter(e=>e.sourceUrl&&(!e.sourceAt||Date.parse(e.sourceAt)<=now)).map(e=>[e.day,e]));
 const byId=new Map(events.map(e=>[e.id,e]));
 const sourceDays=new Map([...entries.values()].map(e=>[e.sourceUrl,e.day]));
 function eventDay(e,seen=new Set()){
  // 功能回复属于自身发布日；只有重置证据需要沿原预告归日。
  if(e.topic==='feature'||e.kind==='feature')return dayOf(e.at,plan);
  if(seen.has(e.id))return dayOf(e.at,plan);seen.add(e.id);
  if(e.announcementSource&&sourceDays.has(e.announcementSource))return sourceDays.get(e.announcementSource);
  const parent=byId.get(e.parent);
  if(parent)return eventDay(parent,seen);
  return dayOf(e.at,plan);
 }
 const valid=events.filter(e=>Number.isFinite(Date.parse(e.at))&&Date.parse(e.at)<=now&&e.topic!=='plan'&&e.kind!=='candidate');
 const groups=new Map(cal.map(d=>[d.day,[]]));
 for(const e of valid){const day=eventDay(e);if(groups.has(day))groups.get(day).push(e);}
 const days=cal.map(d=>{
  const entry=entries.get(d.day),items=groups.get(d.day),features=items.filter(e=>e.topic==='feature');
  const resets=items.filter(e=>e.topic!=='feature'&&['confirmed','observed','scheduled','banked','timed'].includes(e.kind));
  const hasFeature=features.length>0||['feature','feature_reset'].includes(entry?.plannedType);
  const hasReset=resets.length>0||['reset','feature_reset'].includes(entry?.plannedType);
  const official=resets.some(e=>e.kind==='confirmed'),observed=resets.some(e=>e.kind==='observed'),timed=resets.some(e=>e.kind==='timed');
  const resetStatus=official?'confirmed':observed?'observed':timed?'triggered':resets.some(e=>e.kind==='scheduled')?'planned':hasReset?'reported':null;
  const plannedType=hasFeature&&hasReset?'feature_reset':hasFeature?'feature':hasReset?'reset':'upcoming';
  const newest=list=>[...list].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  const recent=newest(features)||newest(resets);
  const sourceAt=entry?.sourceAt||recent?.announcementAt||recent?.at||null;
  const status=plannedType==='upcoming'?'pending':hasFeature?'reported':resetStatus||entry?.status||'reported';
  return {...d,isToday:d.date===todayPT,plannedType,status,resetStatus,
   title:entry?.title||recent?.title||'待观察',
   summary:entry?.summary||recent?.note||(d.date<todayPT?'尚未收录可核对的原帖，不代表当天没有更新。':d.date===todayPT?'今天的内容待观察，未收录不代表没有更新。':'未来内容待观察；计划声明不是每日必然完成的保证。'),
   sourceUrl:entry?.sourceUrl||recent?.url||null,sourceAt,
   evidence:official?'official':observed?'community':timed?'schedule':hasFeature?'official':hasReset?'announcement':null,
   events:items,
   featureRecorded:hasFeature&&!!(entry?.sourceUrl||features.length),
   confirmedReset:official,observedReset:observed&&!official,timedReset:timed&&!official&&!observed};
 });
 const done=days.filter(d=>d.date<=todayPT).length;
 return {plan,days,todayPT,progress:planProgress(now,plan),counts:{done,remaining:plan.days-done,resets:days.filter(d=>d.confirmedReset).length,observedResets:days.filter(d=>d.observedReset).length,timedResets:days.filter(d=>d.timedReset).length,features:days.filter(d=>d.featureRecorded).length,recordedDays:days.filter(d=>d.sourceUrl).length}};
}
