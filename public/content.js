// 内容筛选不参与通知决策；服务器使用独立的 preferences.js。
export const RESET_KINDS = ['confirmed','observed','scheduled','banked','timed'];
export function filterEvents(events, view = 'reset') {
  const visible=events.filter(e=>e.topic!=='plan'&&e.kind!=='candidate');
  if(view==='reset')return visible.filter(e=>e.topic!=='feature'&&RESET_KINDS.includes(e.kind));
  if(view==='plan')return visible.filter(e=>e.topic==='feature');
  return visible.filter(e=>e.topic==='feature'||RESET_KINDS.includes(e.kind));
}
export function dateInZone(at, timeZone) {
  return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
}
export function timeInZone(at, timeZone) {
  return new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
}
