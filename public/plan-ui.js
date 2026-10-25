import { timeInZone } from './content.js';
const $=s=>document.querySelector(s);
const types={feature:'功能改进',reset:'额度重置',feature_reset:'功能 + 重置',upcoming:'待观察'};
const statuses={planned:'已预告',reported:'官方已报告',confirmed:'官方已确认',observed:'社区观测',pending:'待观察'};
const resetStates={confirmed:'官方确认已完成',observed:'社区观测到账 · 非官方确认',planned:'已预告 · 未确认完成',reported:'已报告 / 重置卡 · 非自动重置'};
const pt=at=>timeInZone(at,'America/Los_Angeles');
const bjt=at=>timeInZone(at,'Asia/Shanghai');
const requestedDay=Number(new URLSearchParams(location.search).get('planDay'));
let selectedDay=Number.isInteger(requestedDay)&&requestedDay>=1&&requestedDay<=28?requestedDay:null;
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function source(url,label){const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
export function renderPlan(payload){
 if(!payload)return;
 const focusedDay=document.activeElement?.dataset.planDay;
 const {plan,days,counts,todayPT}=payload;
 if(selectedDay===null)selectedDay=days.find(d=>d.isToday)?.day||days.filter(d=>d.sourceUrl).at(-1)?.day||1;
 $('#plan-done').textContent=`${counts.done} / ${plan.days} 天`;
 $('#plan-remaining').textContent=`${counts.remaining} 天`;
 $('#plan-resets').textContent=counts.resets;
 $('#plan-features').textContent=counts.features;
 $('#plan-observed-count').textContent=`另有 ${counts.observedResets} 次仅社区观测；不计入官方确认`;
 $('#plan-today').textContent=`PT 今天：${todayPT}`;
 $('#plan-progress').value=counts.done;
 $('#plan-percent').textContent=Math.round(counts.done/plan.days*100)+'%';
 $('#plan-grid').replaceChildren();$('#plan-table').replaceChildren();
 for(const d of days){
  const btn=el('button',undefined,'plan-day '+d.plannedType+(d.isToday?' plan-today':'')+(d.day===selectedDay?' plan-selected':''));
  btn.type='button';btn.setAttribute('aria-pressed',String(d.day===selectedDay));
  btn.dataset.planDay=String(d.day);
  btn.setAttribute('aria-label',`Day ${d.day}，${d.date} PT，${types[d.plannedType]}，${statuses[d.status]}`);
  btn.title=`${d.date} PT · ${d.summary}`;
  if(d.isToday)btn.setAttribute('aria-current','date');
  btn.append(el('span',`DAY ${d.day}`,'plan-day-number'),el('time',d.date.slice(5)+' · PT','plan-date'),el('span',types[d.plannedType],'plan-type'),el('strong',d.plannedType==='upcoming'?(d.isToday?'今日内容待收录':d.date>todayPT?'等待当天更新':'暂未收录'):d.title));
  if(d.plannedType!=='upcoming')btn.append(el('span',statuses[d.status],'plan-state'));
  if(d.resetStatus)btn.append(el('small',resetStates[d.resetStatus]));
  btn.onclick=()=>{selectedDay=d.day;renderPlan(payload);if(matchMedia('(max-width:1200px)').matches)$('#plan-detail').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};$('#plan-grid').append(btn);
  const tr=el('tr');tr.append(el('td',`Day ${d.day} / ${d.date}`),el('td',types[d.plannedType]),el('td',statuses[d.status]),el('td',d.resetStatus?resetStates[d.resetStatus]:'不适用'));
  const td=el('td');if(d.sourceUrl)td.append(source(d.sourceUrl,'原帖 ↗'));else td.textContent='待观察';tr.append(td);$('#plan-table').append(tr);
 }
 const d=days.find(d=>d.day===selectedDay)||days[0];
 const detail=$('#plan-detail');detail.replaceChildren();
 detail.append(el('span',`DAY ${d.day} · ${d.date} PT`,'label'),el('h3',d.title),el('p',d.summary));
 detail.append(el('p',`类型：${types[d.plannedType]} · 内容状态：${statuses[d.status]}`));
 if(d.resetStatus)detail.append(el('p','独立重置证据：'+resetStates[d.resetStatus],'plan-reset-evidence'));
 detail.append(el('p',`PT 计划日：${d.date}（America/Los_Angeles）。北京时间区间：${bjt(d.startAt)} 至 ${bjt(d.endAt)}（次日零点不含）。`,'plan-time-note'));
 if(d.sourceAt)detail.append(el('p',`原帖发布：${pt(d.sourceAt)} PT / ${bjt(d.sourceAt)} 北京时间`,'plan-time-note'));
 if(d.sourceUrl)detail.append(source(d.sourceUrl,'查看当天 Tibo 原帖 ↗'));
 const shown=new Set(d.sourceUrl?[d.sourceUrl]:[]);
 for(const event of d.events||[]){if(!event.url||shown.has(event.url))continue;shown.add(event.url);const row=el('p');row.append(el('span',(event.topic==='feature'?'功能更新':event.kind==='observed'?'社区观测':event.kind==='confirmed'?'官方确认':'预告 / 重置卡')+' · '+bjt(event.at)+' 北京时间 · '));row.append(source(event.url,event.title+' ↗'));detail.append(row);}
 $('#plan-excerpt').textContent=plan.announcementExcerpt;
 $('#plan-source').href=plan.announcementUrl;
 $('#plan-announcement-time').textContent=`声明发布：${pt(plan.announcementAt)} PT / ${bjt(plan.announcementAt)} 北京时间`;
 if(focusedDay)document.querySelector(`[data-plan-day="${focusedDay}"]`)?.focus({preventScroll:true});
}
