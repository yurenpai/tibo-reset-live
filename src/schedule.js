export const PACIFIC_ZONE = 'America/Los_Angeles';

export function partsAt(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  }).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}

export function wallTimeToUtc({year,month,day,hour=0,minute=0,second=0}, timeZone) {
  const wanted=Date.UTC(year,month-1,day,hour,minute,second);
  let guess=wanted;
  for(let i=0;i<3;i++){
    const p=partsAt(new Date(guess),timeZone);
    const shown=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    guess+=wanted-shown;
  }
  return new Date(guess);
}

function addLocalDays(parts, days) {
  const d=new Date(Date.UTC(parts.year,parts.month-1,parts.day+days));
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};
}

export function deriveSchedule(text, publishedAt, announcementAt=publishedAt) {
  if(/\b(?:not|never)\s+by\s+(?:tonight\s+|tomorrow\s+)?midnight\b/i.test(String(text||'')))return null;
  const midnight=String(text||'').match(/\bby\s+(?:(tonight|tomorrow)\s+)?midnight\s*(PST|PDT|PT)\b/i);
  const match=String(text||'').match(/\b(?:lands?|landing)\s+tomorrow\s+before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(PST|PDT|PT)\b/i);
  const published=new Date(publishedAt);
  if((!match&&!midnight)||!Number.isFinite(published.getTime()))return null;
  if(midnight){
    if(!Number.isFinite(Date.parse(announcementAt)))return null;
    // 午夜是原预告所在 PT 日的结束；避免回复跨过午夜后再误推一天。
    const anchor=partsAt(new Date(announcementAt),PACIFIC_ZONE);
    const target=addLocalDays(anchor,midnight[1]?.toLowerCase()==='tomorrow'?2:1);
    const zone=midnight[2].toUpperCase(),end=wallTimeToUtc({...target,hour:0},PACIFIC_ZONE);
    const offset=zone==='PST'?8:zone==='PDT'?7:null;
    const literal=offset===null?end:new Date(Date.UTC(target.year,target.month-1,target.day,offset));
    return {windowStart:new Date(announcementAt).toISOString(),windowEnd:end.toISOString(),literalEnd:literal.getTime()===end.getTime()?null:literal.toISOString(),triggerAt:literal.toISOString(),timeZone:PACIFIC_ZONE,
      timeNote:offset===null?'按洛杉矶当地午夜触发。':`按原文 ${zone} 字面午夜触发。`+(literal.getTime()!==end.getTime()?'与洛杉矶当日夏令时换算相差 1 小时，页面分别显示。':'')};
  }
  if(Number(match[1])<1||Number(match[1])>12||Number(match[2]||0)>59)return null;
  let hour=Number(match[1])%12;if(match[3].toLowerCase()==='pm')hour+=12;
  const minute=Number(match[2]||0);
  const local=partsAt(published,PACIFIC_ZONE);
  const target=addLocalDays(local,1);
  const start=wallTimeToUtc({...target,hour:0},PACIFIC_ZONE);
  const end=wallTimeToUtc({...target,hour,minute},PACIFIC_ZONE);
  const literalOffset=match[4].toUpperCase()==='PST' ? 8 : match[4].toUpperCase()==='PDT' ? 7 : null;
  const literalEnd=literalOffset===null?null:new Date(Date.UTC(target.year,target.month-1,target.day,hour+literalOffset,minute));
  const differs=literalEnd&&literalEnd.getTime()!==end.getTime();
  return {
    windowStart:start.toISOString(), windowEnd:end.toISOString(),
    literalEnd:differs?literalEnd.toISOString():null,
    triggerAt:(literalEnd||end).toISOString(),
    timeZone:PACIFIC_ZONE,
    timeNote:differs?'Tibo 写的是 PST；洛杉矶当日采用 PDT。当地窗口另列，日历按原文 PST 字面截止时间触发。':'按原文公布的太平洋时区截止时间触发。'
  };
}
