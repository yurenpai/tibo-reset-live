// 模糊内容保留为“待核实”，不将普通玩笑或脱离上下文的 Done 当成重置。
export function classify(post, parent = null) {
  const result = classifyReset(post, parent);
  return result ? normalizeEvent(result) : classifyFeature(post);
}

// 元数据与历史回填使用同一套口径；功能永远不是重置完成的证据。
export function normalizeEvent(event) {
  if (event.kind === 'feature' || event.topic === 'feature') return { ...event, kind: 'feature', topic: 'feature', status: 'reported', evidence: 'official' };
  if (event.kind === 'observed') return { ...event, topic: 'reset', evidence: 'community', status: 'observed' };
  if (event.kind === 'timed') return { ...event, topic: 'reset', evidence: 'schedule', status: 'triggered' };
  if (event.kind === 'confirmed') return { ...event, topic: 'reset', evidence: 'official', status: 'confirmed' };
  if (event.kind === 'scheduled') return { ...event, topic: 'reset', evidence: 'announcement', status: 'planned' };
  if (event.kind === 'banked') return { ...event, topic: 'reset', evidence: 'official', status: event.status === 'confirmed' ? 'confirmed' : 'reported' };
  if (event.kind === 'candidate') return { ...event, topic: 'reset', evidence: 'unverified', status: 'pending' };
  return { ...event };
}

function classifyReset(post, parent = null) {
  const text = (post.text || '').replace(/[’‘]/g,"'").replace(/https?:\/\/\S+/g,'').trim();
  // 完成词前可能是否定或未来时态；先排除，不能只看到 completed 就庆祝。
  if (/\b(?:not|never|haven't|hasn't|didn't|won't)\b[^.!?\n]{0,60}\b(?:reset|processed|propagated|completed|done)\b|\breset\b[^.!?\n]{0,35}\bnot\b/i.test(text)) return null;
  if (/\b(no reset|not resetting|won.t.{0,15}reset|reset button|reset my password)\b/i.test(text) && !/Day\s*\d+\s*\/\s*Reset/i.test(text)) return null;
  const related = /\breset(?:s|ting)?\b/i.test(text);
  const contextual = parent && ['scheduled','confirmed','banked'].includes(parent.kind);
  if (!related && !contextual) return null;
  if (parent?.kind==='banked' && /confirmed.{0,20}landed|^done[.!\s]*$/i.test(text.trim())) return {kind:'banked',status:'confirmed',title:'重置卡到账确认',note:'确认的是重置卡发放，未据此认定自动重置。'};
  if (/\bbanked\s+reset\b/i.test(text)) return {kind:'banked', title:'发放重置卡', note:'备用重置卡，具体到账及有效期以账号为准。'};
  if (parent?.kind==='banked' && /\bby\s+midnight\s+(?:PST|PDT|PT)\b|\b(?:lands|landing|tomorrow|before)\b/i.test(text)) return {kind:'banked',title:'重置卡发放预告',note:'此时间用于重置卡发放，不触发自动重置。'};
  if (/\brest\s+and\s+reset\b|\bby\s+midnight\s+(?:PST|PDT|PT)\b/i.test(text)) return {kind:'scheduled',title:'重置已预告',note:'按官方公布的截止时间触发重置日历；宣布时间与触发时间分别记录。'};
  if (/\b(?:will|tomorrow|landing|lands|scheduled)\b[^.!?\n]{0,60}\b(?:reset|processed|propagated|completed)\b|\breset\b[^.!?\n]{0,60}\b(?:will|tomorrow|landing|lands|scheduled)\b/i.test(text)) return {kind:'scheduled',title:'重置已预告',note:'有明确截止时间时，日历按官方公布时间自动触发。'};
  if (/\breset\s+(?:(?:has|have)\s+been\s+|(?:is|was|has)\s+)?(?:fully\s+)?(?:processed|propagated|completed|landed)\b|\b(?:we have|we've|we just|just) reset\b|\ball (?:accounts? (?:have been )?)?reset\b|\breset\b[^.!?\n]{0,80}[.!]?\s*it's done\b/i.test(text) || contextual && /^(?:done(?: and dusted)?|it.s done|all propagated)[.!\s]*$/i.test(text.trim())) return {kind:'confirmed',title:'Tibo 已确认重置',note:'记录的是确认帖发布时间，不代表每个账号的实际到账时刻。'};
  if (/\b(tomorrow|by EOD|within|landing|lands|before|will.{0,25}reset|reset day today)\b/i.test(text)) return {kind:'scheduled',title:'重置已预告',note:'有明确截止时间时，日历按官方公布时间自动触发。'};
  if (/and reset[.!\s]*(?:Enjoy[.!\s]*)?$/i.test(text)) return {kind:'confirmed',title:'Tibo 已宣布重置',note:'按原帖的重置公告收录；个人到账情况以账号为准。'};
  if (/\bDay\s*\d{1,2}\s*[\/.·:\-][\s\S]*\breset\b|\b(?:that's|it's)\s+a\s+(?:full\s+)?reset\b/i.test(text)) return {kind:'scheduled',title:'重置已预告',note:'原帖宣布重置；收录明确截止时间后到点自动触发，不把宣布时刻当成触发时刻。'};
  return {kind:'candidate',title:'重置信息待核实',note:'发现相关原帖，尚不能据此确认重置完成。'};
}

// 只收录明确的 Day N 功能发布/改进陈述；不从“每天会 ship 或 reset”推断功能已发布。
export function classifyFeature(post) {
  const text = post.text || '';
  const day = text.match(/\bDay\s*(\d{1,2})(?=\s*[\/.·:\-])/i);
  if (!day || Number(day[1]) < 1 || Number(day[1]) > 28) return null;
  const clauses = text.split(/(?:[.!?;\n]+|\b(?:but|and)\s+(?=(?:it(?:'s| is)|we|reset)\b))/i);
  const feature = clauses.some(clause => {
    if (/\b(?:no|not|never|didn.t|don.t|doesn.t|isn.t|aren.t|wasn.t|weren.t|haven.t|hasn.t|won.t|will|tomorrow|soon|coming|scheduled|planning|hope|might|could)\b/i.test(clause)) return false;
    // “shipped a reset”不是功能。混合帖仍可由另一个明确的功能分句命中。
    const withoutReset = clause.replace(/\b(?:full |global |banked )?reset(?:s|ting)?\b/gi, '');
    const domain = /\b(?:API|app|desktop|mobile|model|context|cache|caching|speed|latency|performance|composer|messages?|capacity|responses?|GPT[\s-]?\d|OpenResponses|integration|input prediction|auto.?review)\b/i.test(withoutReset);
    const assertion = /\b(?:shipped|shipping|released|launched|introduced|added|enabled|improved|increased|reduced|faster|instant|now available|now supports?|generally available|GA|default|support(?:s|ing)?|bring(?:s|ing)?|editable)\b|\b\d+\s*%\s*(?:faster|less|more)/i.test(withoutReset);
    return domain && assertion;
  });
  if (!feature) return null;
  return { kind: 'feature', topic: 'feature', status: 'reported', evidence: 'official', planDay: Number(day[1]), title: `Day ${Number(day[1])} · 功能更新`, note: 'Tibo 原帖报告的功能改进，不代表额度重置或个人账号已到账。' };
}

export function classifyEvents(post, parent = null) {
  const reset = classifyReset(post, parent);
  return [reset ? normalizeEvent(reset) : null, classifyFeature(post)].filter(Boolean);
}

export function validSubscription(s) {
  try {
    const u = new URL(s.endpoint);
    const allowed = ['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','web.push.apple.com','notify.windows.com'];
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
      allowed.some(h => u.hostname === h || u.hostname.endsWith('.' + h)) &&
      /^[\w-]{80,100}$/.test(s.keys.p256dh) && /^[\w-]{20,30}$/.test(s.keys.auth);
  } catch { return false; }
}
