const clock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const time=value=>value&&Number.isFinite(Date.parse(value))?clock.format(new Date(value))+' 北京时间':'尚无';
function row({title,url,connected=false,error,lastCheck,lastSuccess,upstreamAt,nextCheck,retryAt,active=false,description}){
 const item=document.createElement('li');item.className='source-row';
 const heading=document.createElement('div');heading.className='source-row-heading';
 const name=document.createElement('strong');name.textContent=title;
 const state=document.createElement('span');state.className='source-state';
 state.textContent=error?'检查异常':active?'当前使用':connected?'最近检查成功':lastCheck?'等待恢复':url?'尚未检查':'未配置';
 state.dataset.state=error?'error':active||connected?'ok':'idle';heading.append(name,state);item.append(heading);
 if(url){
  try{const address=new URL(url);if(address.protocol==='https:'&&!address.username&&!address.password){const a=document.createElement('a');a.href=url;a.textContent=address.hostname+address.pathname;a.target='_blank';a.rel='noopener noreferrer';item.append(a);}}catch{}
  const stamp=document.createElement('p');stamp.textContent=`最近检查：${time(lastCheck)}；最近成功：${time(lastSuccess)}`;item.append(stamp);
  if(upstreamAt){const p=document.createElement('p');p.textContent='上游检查时间：'+time(upstreamAt);item.append(p);}
  if(nextCheck||retryAt){const p=document.createElement('p');p.textContent=(retryAt?'冷却至：':'下次检查：')+time(retryAt||nextCheck);item.append(p);}
 }
 if(description||error){const p=document.createElement('p');p.textContent=error||description;if(error)p.className='source-row-error';item.append(p);}
 return item;
}
export function renderSourceStatus(data){
 const status=data.status||{},obs=data.observations||{},list=document.querySelector('#source-list');
 list.replaceChildren();
 if(status.mode==='public'){
  const sources=status.sources?.length?status.sources:[{url:status.sourceUrl,role:'primary',...status}];
  for(const source of sources)list.append(row({...source,title:source.role==='fallback'?'备用帖子源':'主帖子源',active:status.connected&&(status.activeSourceUrl||status.sourceUrl)===source.url}));
  if(!sources.some(s=>s.role==='fallback'))list.append(row({title:'备用帖子源',description:'尚未接入经过验证的备用接口。当前主源故障时无法自动换源。'}));
 }else list.append(row({title:'X 官方 API',url:'https://api.x.com/2/',connected:status.connected,error:status.error,lastCheck:data.lastCheck,lastSuccess:status.lastReceived,active:status.connected,description:status.configured?'使用本机配置的应用密钥连接。':'未配置应用密钥。当前页面没有网页登录 X 的入口。'}));
 if(obs.enabled&&obs.sources?.length){
  for(const source of obs.sources)list.append(row({...source,title:'社区观测源',description:source.connected?`最近响应包含 ${source.validRecords??0} 条有效记录；报告不等于所有账号均已到账。`:'社区报告与 Tibo 官方确认分别记录。'}));
 }else list.append(row({title:'社区观测源',description:'未配置。勾选社区提醒不会自动接入数据，也不会检测你个人账号的额度；当前不收录新观测，既有记录仍保留。'}));
 const hint=document.querySelector('#observed-source-hint');
 hint.textContent=!obs.enabled?'未配置观测源，当前不会产生新的社区观测提醒；此选项只保存提醒偏好。':obs.error?'社区观测源检查异常，请展开「数据来源与后台状态」查看；此选项只保存提醒偏好。':'已配置社区观测源。提醒仅代表来源报告，不保证你的账号已到账。';
 document.querySelector('#source-route-note').textContent=status.mode==='public'?(status.usingFallback?'当前使用备用帖子源；主源恢复后自动切回。':'按主源优先、故障时尝试备用源的顺序检查；同一帖子按 X 帖子 ID 去重。'):'官方 API 与公共帖子源是两种连接模式；本机可展开「配置数据来源」切换并保存，云部署使用 .env。';
 const backups=(status.sources||[]).filter(s=>s.role==='fallback').length;
 document.querySelector('#source-counts').textContent=`${status.mode==='public'?`主源 1 · 备用 ${backups}`:'X 官方 API'} · 社区 ${obs.enabled?(obs.sources?.length||0):'未配置'}`;
}
