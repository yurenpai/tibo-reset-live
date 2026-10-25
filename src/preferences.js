// 通知偏好。必须在服务端过滤：页面关闭后 Web Push 由服务器直接投递，
// 前端 localStorage 拦不住已经发出去的推送。
export const TOPICS = ['confirmed', 'observed', 'scheduled', 'feature', 'digest'];

export const DEFAULT_PREFERENCES = {
  confirmed: true,
  observed: true,
  scheduled: false,
  feature: false,
  digest: false
};

// 只接受已知字段的布尔值，其余一律回到默认值，避免客户端塞进任意键。
export function normalizePreferences(input) {
  const out = { ...DEFAULT_PREFERENCES };
  if (!input || typeof input !== 'object') return out;
  for (const key of TOPICS) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  return out;
}

// 每条事件该由哪个偏好开关决定。观测与官方确认分开，功能更新单独一档。
export function topicOf(event) {
  if (event?.topic === 'feature') return 'feature';
  if (event?.topic === 'plan') return 'digest';
  switch (event?.kind) {
    case 'observed': return 'observed';
    case 'confirmed': return 'confirmed';
    case 'scheduled': return 'scheduled';
    case 'banked': return 'scheduled';
    default: return null;
  }
}

// 服务器投递前的唯一判据。
export function wantsNotification(preferences, event) {
  const topic = topicOf(event);
  if (!topic) return false;
  return normalizePreferences(preferences)[topic] === true;
}
