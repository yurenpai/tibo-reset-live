export const DAY_MS = 86400000;

// 只有“官方确认”和“社区观测到账”能恢复人物清晰度并推进阶段。
// 两者强度不同：官方确认是完整狂欢，观测到账是较轻的庆祝样式。
export function resetAppearance(events, now = Date.now(), preview = null) {
  const last = events
    .filter(e => (!e.topic||e.topic==='reset') && ['confirmed','observed'].includes(e.kind) && Number.isFinite(Date.parse(e.at)) && Date.parse(e.at) <= now)
    .sort((a,b) => Date.parse(b.at)-Date.parse(a.at))[0] || null;
  const elapsed = last ? Math.max(0, Math.floor((now-Date.parse(last.at))/DAY_MS)) : null;
  const override = Number.isInteger(preview) && preview >= 0 && preview <= 4;
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
    preview: override
  };
}
