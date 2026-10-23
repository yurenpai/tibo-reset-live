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

export function deriveSchedule(text, publishedAt) {
  const match=String(text||'').match(/\b(?:lands?|landing)\s+tomorrow\s+before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(PST|PDT|PT)\b/i);
  const published=new Date(publishedAt);
  if(!match||!Number.isFinite(published.getTime()))return null;
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
    timeZone:PACIFIC_ZONE,
    timeNote:differs?'Tibo 写的是 PST；该日期洛杉矶实际采用 PDT。页面以当地时区为主，并保留按 PST 字面晚 1 小时的可能。':'按 Tibo 所在的美国太平洋时区换算。'
  };
}
