// 社区观测到账：证明“重置已经发生”，但不是 Tibo 本人的完成确认帖。
// 观测源由部署者配置（OBSERVATION_SOURCES，逗号分隔的 HTTPS JSON 地址），
// 默认不启用；程序不内置也不抓取任何第三方站点。
const MAX_AGE_MS = 7 * 86400000;
const CLOCK_SKEW_MS = 5 * 60000;
const MAX_ITEMS = 50;

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function toObservedEvent(observation) {
  const id = text(observation?.id, 120);
  const at = new Date(observation?.at);
  const url = text(observation?.url, 500);
  // 没有可核对来源的观测不入库：这条记录的全部价值就在于它能被点开验证。
  if (!id || !Number.isFinite(at.getTime()) || !/^https?:\/\//.test(url)) return null;
  return {
    id: `observed-${id}`,
    at: at.toISOString(),
    kind: 'observed',
    topic: 'reset',
    evidence: 'community',
    status: 'observed',
    title: '社区观测已重置',
    note: text(observation?.note, 300) || '公共追踪记录观测到额度重置。它证明重置已发生，但既不是 Tibo 的完成确认帖，观测时刻也不等于精确生效秒数。',
    url,
    scope: text(observation?.scope, 80) || null,
    sourceType: 'community'
  };
}

// 只接受最近发生、时间可信、字段完整的记录；其余整条丢弃而不是猜测补全。
export function parseObservations(payload, now = Date.now()) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.observations) ? payload.observations : [];
  const seen = new Set();
  const out = [];
  for (const item of list.slice(0, MAX_ITEMS)) {
    const event = toObservedEvent(item);
    if (!event || seen.has(event.id)) continue;
    const at = Date.parse(event.at);
    if (at > now + CLOCK_SKEW_MS || now - at > MAX_AGE_MS) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export class Observations {
  constructor(store, onEvent, sources = [], { fetchImpl = fetch, intervalMs = 300000 } = {}) {
    this.store = store;
    this.onEvent = onEvent;
    this.sources = sources;
    this.fetchImpl = fetchImpl;
    this.intervalMs = intervalMs;
    this.timer = null;
  }
  async source(url) {
    const r = await this.fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('观测源 HTTP ' + r.status);
    const body = await r.json();
    return parseObservations(body);
  }
  // 已存在的观测记录直接跳过：观测是“补充证据”，不会重复推送或覆盖历史条目。
  async check() {
    let added = 0;
    const errors = [];
    for (const url of this.sources) {
      let events = [];
      try { events = await this.source(url); }
      catch (err) { errors.push(`${url}: ${err.message}`); continue; }
      for (const event of events) {
        if (this.store.event(event.id)) continue;
        if (this.store.addEvent(event, true)) { added++; this.onEvent(event); }
      }
    }
    this.store.set('observationError', errors.join('；'));
    this.store.set('observationCheck', new Date().toISOString());
    return added;
  }
  start() {
    if (!this.sources.length) return;
    this.check().catch(() => {});
    this.timer = setInterval(() => this.check().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); }
}
