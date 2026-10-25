export const DAY_MS = 86400000;

// 官方确认、官方预告到点、社区观测都推进人物；分别保留依据。
export function resetAppearance(events, now = Date.now(), preview = null) {
  const last = events
    .filter(e => (!e.topic||e.topic==='reset') && ['confirmed','observed','timed'].includes(e.kind) && Number.isFinite(Date.parse(e.at)) && Date.parse(e.at) <= now)
    .sort((a,b) => Date.parse(b.at)-Date.parse(a.at))[0] || null;
  const elapsed = last ? Math.max(0, Math.floor((now-Date.parse(last.at))/DAY_MS)) : null;
  const override = Number.isInteger(preview) && preview >= 0 && preview <= 4;
  const announcement = events.filter(e=>(!e.topic||e.topic==='reset')&&e.kind==='scheduled'&&Number.isFinite(Date.parse(e.at))&&Date.parse(e.at)<=now)
    .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0]||null;
  // 有明确截止时间的预告由后台在到点后生成 timed 记录；不要求第二条 Done。
  const pending = !override && !!announcement && (!last||Date.parse(announcement.at)>Date.parse(last.at));
  const days = override ? preview : elapsed;
  // 观测到账可以触发较轻庆祝，但永远不与官方确认显示成完全一样。
  const observedOnly = !override && last?.kind === 'observed';
  const celebration = days === 0;
  return {
    last,
    elapsed,
    days,
    stage: days === null ? 0 : Math.min(days, 4),
    celebration,
    // full：官方确认的金色狂欢；soft：社区观测的轻庆祝；none：普通等待。
    mood: celebration ? (observedOnly ? 'soft' : 'full') : 'none',
    preview: override,announcement,pending,timedOnly:!override&&last?.kind==='timed',
    overdue:pending&&Number.isFinite(Date.parse(announcement.windowEnd))&&now>=Date.parse(announcement.windowEnd)
  };
}
