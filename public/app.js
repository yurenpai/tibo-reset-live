import { resetAppearance } from './theme.js';
import { filterEvents, timeInZone } from './content.js';
import { renderPlan } from './plan-ui.js';
import { renderSourceStatus } from './source-status.js';
import { initSourceConfig,renderSourceConfig } from './source-config.js';
const navigation=new URLSearchParams(location.search);
let contentView=['all','plan'].includes(navigation.get('view'))?navigation.get('view'):'reset';
const $=s=>document.querySelector(s);
let visualPreview=null,previousCelebration=false,desktopLoaded=false,webPushRestored=false,frequencyDirty=false;
const quotes=['赞美重置，满血复活！','今天的我，依然清晰。','还好，我还能再等等。','线条开始有自己的想法。','额度没了，画质也没了。'];
function confetti(){
 const layer=$('#confetti');layer.replaceChildren();if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const colors=['#d5a340','#f0d083','#ad6148','#768d7b','#fff6cd'];
 for(let i=0;i<54;i++){const dot=document.createElement('i');dot.style.setProperty('--left',((i*37)%100)+'%');dot.style.setProperty('--delay',((i*13)%24)/10+'s');dot.style.setProperty('--color',colors[i%colors.length]);dot.style.setProperty('--drift',((i*19)%160-80)+'px');layer.append(dot);}
}
function renderAppearance(){
 const state=resetAppearance(data.events,Date.now(),visualPreview);
 document.body.classList.toggle('celebrating',state.celebration);
 document.body.classList.toggle('observing',state.mood==='soft');
 document.body.classList.toggle('announced',state.pending);
 document.body.dataset.portraitStage=String(state.stage+1);
 $('#preview-notice').hidden=!state.preview;
 document.body.classList.toggle('previewing',state.preview);
 $('#mascot-exit-preview').hidden=!state.preview;
 $('#festival-title').replaceChildren();
 const full=state.mood==='full',soft=state.mood==='soft';
 const lines=state.pending?['重置已宣布，','等它落地。']:state.timedOnly&&full?['时间已到，','额度复活！']:full?['赞美 Tibo，','额度复活！']:soft?['观测到账，','也要庆祝！']:['等一个重置，','盼一场狂欢。'];
 $('#festival-title').append(lines[0],document.createElement('br'),lines[1]);
 $('#festival-kicker').textContent=state.pending?'RESET ANNOUNCED · 已宣布，持续跟进':full?(state.timedOnly?'RESET FESTIVAL · 按官方预告时间触发':'RESET FESTIVAL · 官方确认狂欢'):soft?'RESET FESTIVAL · 社区观测到账':'THE WAITING ROOM · 等待下一次重置';
 $('#festival-description').textContent=state.pending?(state.announcement.triggerAt?'Tibo 已宣布下一次重置，到公布的截止时间会自动触发日历、狂欢与提醒，不要求再发布 Done。':'Tibo 已宣布下一次重置，尚未收录明确截止时间；预告继续保留。'):full?(state.timedOnly?'已到 Tibo 官方公布的重置时间，日历按预告自动触发。未检查个人账号额度；这是预告时间触发，不是官方完成确认。金币、光晕和彩屑已就位，人物从触发时刻恢复清晰。':'Tibo 已官方确认重置。金币、光晕和彩屑已经就位，今天值得最高画质。'):soft?'社区记录已观测到重置到账，金色和彩屑照常庆祝！证据来自社区观测，不冒充 Tibo 的官方完成确认。':'有重置的日子，值得庆祝。没有重置的日子，就看 Tibo 逐渐变成简笔画。';
 $('#festival-status').textContent=state.preview?'正在预览外观 · 不代表真实重置':state.pending?'宣布于 '+bjt.format(new Date(state.announcement.at))+'（北京时间）':state.last?(state.timedOnly?'按预告触发：':state.last.kind==='observed'?'上次观测到账：':'上次官方确认：')+bjt.format(new Date(state.last.at))+'（北京时间）':'尚无可用于计算的重置记录';
 const announcementPanel=$('#announcement-detail');announcementPanel.replaceChildren();announcementPanel.hidden=!state.pending;
 if(state.pending){
  if(state.announcement.triggerAt){const p=document.createElement('p');const left=Date.parse(state.announcement.triggerAt)-Date.now();p.textContent='按原文触发：'+bjt.format(new Date(state.announcement.triggerAt))+' 北京时间'+(left>0?' · 还有 '+duration(left):' · 已到触发时间，后台正在记录');announcementPanel.append(p);}
  if(state.last){const p=document.createElement('p');p.textContent='上次完成记录：'+bjt.format(new Date(state.last.at))+' 北京时间 · 人物仍按这次完成记录计算';announcementPanel.append(p);}
  const a=document.createElement('a');a.href=state.announcement.url;a.textContent='查看本次重置预告 ↗';a.target='_blank';a.rel='noopener noreferrer';announcementPanel.append(a);
 }
 $('#mascot-portrait').style.left=(-[30,337,644,951,1246][state.stage]/260*100)+'%';
 $('#mascot-stage').textContent=(state.preview?'预览 · ':'')+(state.days===null?'等待确认':state.celebration?'DAY 1 · 满血复活':'DAY '+Math.min(state.days+1,5)+(state.days>=4?' +':''));
 $('#mascot-quote').textContent=state.days===null?'我先看看记录。':quotes[state.stage];
 $('#mascot-days').textContent=state.days===null?'暂无已确认或观测到的重置记录':state.celebration?'重置后未满 24 小时':'距上次完成记录已过 '+state.days+' 天';
 $('#mascot-basis').textContent=state.preview?'仅外观预览':state.timedOnly?'按官方预告时间触发':data.status.mode==='public'?'基于公共源收录记录':!data.status.connected?'基于已收录记录 · 实时源未连接':'按最近重置记录计算';
 $('#replay').hidden=!state.celebration||state.pending;
 if(state.celebration&&!state.pending&&!previousCelebration)confetti();
 if(!state.celebration||state.pending)$('#confetti').replaceChildren();
 previousCelebration=state.celebration&&!state.pending;
}
const bjt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
function duration(ms){const m=Math.floor(ms/60000);const d=Math.floor(m/1440),h=Math.floor(m%1440/60),mm=m%60;return d?`${d} 天 ${h} 小时`:h?`${h} 小时 ${mm} 分`:`${mm} 分钟`;}
const dateKey=d=>bjt.format(new Date(d)).slice(0,10);
const requestedDate=navigation.get('date');
let selected=/^\d{4}-\d{2}-\d{2}$/.test(requestedDate||'')&&Number.isFinite(Date.parse(requestedDate+'T12:00:00Z'))?requestedDate:dateKey(Date.now()),view=new Date(selected+'T12:00:00Z'),data={events:[],status:{}};
const labels={confirmed:'官方确认',observed:'观测到账',scheduled:'重置预告',timed:'预告到点',banked:'重置卡',candidate:'待核实',feature:'功能更新'};
function render(){
 const focusedDate=document.activeElement?.dataset.date;
 const visibleEvents=filterEvents(data.events,contentView);
 $('#plan-panel').hidden=contentView==='reset';
 $('.workspace').hidden=contentView==='plan';
 $('.intro').hidden=contentView==='plan';
 $('#latest-label').textContent=contentView==='all'?'最新全部动态':'最新重置信息';
 for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===contentView));
 renderPlan(data.plan);
 $('#month').textContent=`${view.getUTCFullYear()} 年 ${view.getUTCMonth()+1} 月`;
 const bounds=monthBounds();
 $('#prev').disabled=currentMonth()<=bounds.min;
 $('#next').disabled=currentMonth()>=bounds.max;
 $('#range-note').textContent=`收录自 ${bounds.firstKey.replaceAll('-',' / ')} 起`;
 const first=new Date(Date.UTC(view.getUTCFullYear(),view.getUTCMonth(),1));const offset=(first.getUTCDay()+6)%7;
 const count=new Date(Date.UTC(view.getUTCFullYear(),view.getUTCMonth()+1,0)).getUTCDate();
 $('#days').replaceChildren();
 for(let i=0;i<Math.ceil((offset+count)/7)*7;i++){
  const day=new Date(first);day.setUTCDate(i-offset+1);const key=day.toISOString().slice(0,10);const events=visibleEvents.filter(e=>dateKey(e.at)===key);
  const btn=document.createElement('button');btn.className='day'+(day.getUTCMonth()!==view.getUTCMonth()?' other':'')+(key===selected?' selected':'')+(key===dateKey(Date.now())?' today':'');btn.setAttribute('aria-label',key+'，'+events.length+' 条记录');
  btn.dataset.date=key;
  const num=document.createElement('span');num.className='number';num.textContent=day.getUTCDate();btn.append(num);
  for(const e of events.slice(0,2)){const span=document.createElement('span');span.className='badge '+e.kind;span.textContent=labels[e.kind]+' '+bjt.format(new Date(e.at)).slice(-5);btn.append(span);}
  if(events.length>2){const more=document.createElement('span');more.textContent='另有 '+(events.length-2)+' 条';more.className='empty';btn.append(more);}
  btn.onclick=()=>{selected=key;render();};$('#days').append(btn);
 }
 $('#selected-title').textContent=selected.replaceAll('-',' / ');$('#detail').replaceChildren();
 const events=visibleEvents.filter(e=>dateKey(e.at)===selected);
 if(!events.length){const p=document.createElement('p');p.className='placeholder';p.textContent='这一天尚未收录当前筛选下的动态。空白不代表当天没有重置或更新。';$('#detail').append(p);}
 for(const e of events){const item=document.createElement('article');item.className='record';
  const h=document.createElement('h3');h.className=e.kind;h.textContent=e.title;
  const time=document.createElement('time');time.textContent=(e.kind==='timed'?'按预告触发：':e.kind==='scheduled'?'原帖宣布：':'')+bjt.format(new Date(e.at))+' · 北京时间 / '+timeInZone(e.at,'America/Los_Angeles')+' PT';
  const p=document.createElement('p');p.textContent=e.note;
  const text=document.createElement('p');text.className='excerpt';text.textContent=e.excerpt||'';text.hidden=!e.excerpt;
  item.append(h,time,p,text);
  if(e.kind==='timed'){const basis=document.createElement('p');basis.className='via-source';basis.textContent='触发依据：官方预告截止时间已到；本工具未检查个人账号额度，不等于收到官方完成确认。';item.append(basis);}
  if(e.kind==='scheduled'&&e.triggerAt){const trigger=document.createElement('p');trigger.textContent='预告截止 / 自动触发：'+bjt.format(new Date(e.triggerAt))+' 北京时间；上面的原帖宣布时间不是到账时间。';item.append(trigger);}
  if(e.announcementAt){const announced=document.createElement('p');announced.textContent='原帖宣布：'+bjt.format(new Date(e.announcementAt))+' 北京时间';item.append(announced);}
  if(e.via){const via=document.createElement('p');via.className='via-source';via.textContent=e.via.type==='community-feed'?'社区来源报告，未经本项目独立核验。':'公共镜像收录，原文未经本项目独立核验。';const a=document.createElement('a');a.href=e.via.url;a.textContent='查看收录源 ↗';a.target='_blank';a.rel='noopener noreferrer';via.append(a);item.append(via);}
  if(e.windowStart&&e.windowEnd){
   const window=document.createElement('div');window.className='time-window';
   const caption=document.createElement('span');caption.textContent='推算观察窗口';
   const range=document.createElement('strong');range.textContent=bjt.format(new Date(e.windowStart))+' — '+bjt.format(new Date(e.windowEnd));
   const note=document.createElement('small');note.textContent=e.timeNote;
   const countdown=document.createElement('small');countdown.className='countdown';
   const left=Date.parse(e.triggerAt||e.windowEnd)-Date.now();
   countdown.textContent=e.triggerAt?'日历按原文触发：'+bjt.format(new Date(e.triggerAt))+' 北京时间'+(left>0?' · 还有 '+duration(left):' · 已到点'):left>0?'距窗口结束还有 '+duration(left):'窗口已于上面标注的截止时刻结束';
   window.append(caption,range,note,countdown);item.append(window);
  }
  if(e.scope){const scope=document.createElement('p');scope.className='scope';scope.textContent='适用范围：'+e.scope;item.append(scope);}
  const link=document.createElement('a');link.href=e.url||e.announcementSource;link.textContent=e.kind==='observed'?(e.url?'查看观测来源 ↗':'查看原始预告 ↗'):'查看 Tibo 原帖 ↗';link.target='_blank';link.rel='noopener noreferrer';item.append(link);
  if(e.scheduleSource){const ref=document.createElement('a');ref.href=e.scheduleSource;ref.textContent=' · 查看 Tibo 的时间回复 ↗';ref.target='_blank';ref.rel='noopener noreferrer';item.append(ref);}
  if(e.announcementSource){const ref=document.createElement('a');ref.href=e.announcementSource;ref.textContent=' · 查看原始预告 ↗';ref.target='_blank';ref.rel='noopener noreferrer';item.append(ref);}
  if(e.followUps?.length){
   const list=document.createElement('div');list.className='follow-ups';
   const caption=document.createElement('span');caption.textContent='Tibo 在该帖下的补充回复';list.append(caption);
   for(const f of e.followUps){const row=document.createElement('p');const a=document.createElement('a');a.href=f.url;a.textContent=f.excerpt||'查看回复 ↗';a.target='_blank';a.rel='noopener noreferrer';row.append(document.createTextNode(bjt.format(new Date(f.at)).slice(-5)+' · '),a);list.append(row);}
   item.append(list);
  }
  $('#detail').append(item);}
 const latest=visibleEvents[0];$('#headline').textContent=latest?latest.title:'等待新的重置消息';$('#latest').textContent=latest?bjt.format(new Date(latest.at))+' · '+latest.note:'接入实时数据源后，新的预告、确认和重置卡会自动收录。';
 const publicMode=data.status.mode==='public';
 $('#connection').textContent=publicMode?(data.status.connected?'● 公共源定时检查':'○ 公共源暂不可用'):data.status.connected?'● 实时源已连接':data.status.configured?'○ 实时源重连中':'○ 尚未接入实时源';
 $('#source-summary').textContent=publicMode?'免登录 · 定时检查':data.status.mode==='api'?'官方 API':'未接入';
 $('#source-description').replaceChildren();
 if(publicMode){const a=document.createElement('a');a.href=data.status.sourceUrl;a.textContent='公共收录源';a.target='_blank';a.rel='noopener noreferrer';const interval=data.status.intervalSeconds?`当前约每 ${Math.round(data.status.intervalSeconds/60)} 分钟检查`:'正在安排下一次检查';$('#source-description').append(a,` · ${data.status.pollLabel||'定时检查'}，${interval} Tibo 的主帖和回复。第三方可能延迟、遗漏或中断；可点击原帖核对，不保证秒级。`);}
 else $('#source-description').textContent='官方 X API 为可选数据源，需要自行配置应用凭证。';
 const displayTime=at=>at?bjt.format(new Date(at))+' 北京时间':'尚无';
 $('#source-times').textContent=publicMode?`本机最近检查：${displayTime(data.status.lastCheck)}；下次计划检查：${displayTime(data.status.nextCheck)}；上游最近更新：${displayTime(data.status.upstreamAt)}；最新收录帖：${displayTime(data.status.newestPostAt)}`:'';
 $('#source-error').textContent=(data.status.error||'')+(publicMode&&data.status.failureCount>0?` · 连续 ${data.status.failureCount} 次检查异常，已自动延长检查间隔。`:'');
 const obs=data.observations;
 renderSourceStatus(data);
 renderSourceConfig(data);
 $('#checked').textContent=(data.lastCheck?'最近检查：'+bjt.format(new Date(data.lastCheck)):'历史核对：'+bjt.format(new Date(data.historyCheckedAt))+' · 实时源未接入')+
  (obs?.enabled?(obs.checkedAt?' · 观测源 '+bjt.format(new Date(obs.checkedAt)):' · 观测源等待首次检查'):' · 未配置社区观测源');
 $('#subscribe').disabled=!data.desktop&&!data.pushReady;
 $('#desktop-info').hidden=!data.desktop;$('#test-desktop').hidden=!data.desktop;
 $('#background-help').hidden=!data.desktop;
 const frequencyForm=$('#source-frequency-form');frequencyForm.hidden=!(data.desktop&&publicMode);
 if(!frequencyForm.hidden&&!frequencyDirty)$('#source-frequency').value=data.status.pollMode||'smart';
 if(data.desktop){
  $('.notification-settings > p').textContent='提醒开关和类别保存在这台电脑。关闭网页或重启电脑后会保留；后台重新运行并联网后继续检查。';
  $('.footnote').textContent='本机后台使用系统桌面通知，关闭网页后仍可提醒。请保持电脑唤醒、联网和后台进程运行；系统勿扰模式可能隐藏弹窗。官方确认记录原帖时间，预告到点记录公布的触发时间；个人额度以账号显示为准。';
  $('#subscribe').textContent='开启本机桌面提醒';$('#unsubscribe').textContent='关闭本机提醒';
  $('#subscribe').hidden=data.desktop.enabled;$('#unsubscribe').hidden=!data.desktop.enabled;
  const platformHelp=data.desktop.platform==='darwin'?'双击根目录 start.command 启动、stop.command 停止；scripts/launchers/start-service.command 可设置登录自启。':data.desktop.platform==='linux'?'运行 sh start.sh 启动、sh stop.sh 停止；sh scripts/launchers/start-service.sh 可设置登录自启。':'双击根目录 start.cmd 启动、stop.cmd 停止；scripts/launchers/start-service.cmd 可设置登录自启。';
  $('#desktop-info').textContent=(data.desktop.service?.supervised?'后台守护正在运行，进程异常退出会自动重启。':'本地后台正在运行。')+'关掉网页仍可提醒。记录和偏好保存在系统用户数据目录，更新源码或重启不会清空；关机或休眠期间暂停监测。'+(data.desktop.supported?'':` 当前通知后端未就绪：${data.desktop.hint||'系统不支持'}。`)+(data.desktop.error?' 最近通知错误：'+data.desktop.error:'');
  $('#background-help').textContent=platformHelp;
  if(!desktopLoaded){showPreferences(data.desktop.preferences);desktopLoaded=true;$('#preferences-status').textContent='偏好保存在这台电脑，关闭网页后继续生效。';}
 }else if(!data.pushReady)$('#message').textContent='当前未配置云端推送。本机使用请双击 start.cmd，可启用桌面提醒。';
 if(!data.desktop&&!webPushRestored){webPushRestored=true;restoreWebPush();}
 renderAppearance();
 if(focusedDate)document.querySelector(`[data-date="${focusedDate}"]`)?.focus({preventScroll:true});
}
async function refresh(){try{const r=await fetch('/api/calendar',{cache:'no-store'});if(!r.ok)throw Error();data=await r.json();render();}catch{$('#connection').textContent='○ 连接中断';$('#message').textContent='无法读取更新，当前显示保留的记录。';}}
initSourceConfig(refresh);
// 日历只覆盖“有记录的最早月份”到“当前月份”。更早的月份不存在可展示的内容，翻过去只会是空洞。
function monthBounds(){
 const keys=data.events.map(e=>dateKey(e.at)).sort();
 const firstKey=keys[0]||dateKey(Date.now());
 const ym=k=>{const[y,m]=k.split('-').map(Number);return y*12+(m-1);};
 return {min:ym(firstKey),max:ym(dateKey(Date.now())),firstKey};
}
function currentMonth(){return view.getUTCFullYear()*12+view.getUTCMonth();}
$('#prev').onclick=()=>{if(currentMonth()<=monthBounds().min)return;view.setUTCMonth(view.getUTCMonth()-1,1);render();};
$('#next').onclick=()=>{if(currentMonth()>=monthBounds().max)return;view.setUTCMonth(view.getUTCMonth()+1,1);render();};
$('#today').onclick=()=>{selected=dateKey(Date.now());view=new Date(selected+'T12:00:00Z');render();};
async function registration(){if(!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('当前浏览器不支持后台推送，请使用支持 Web Push 的浏览器与 HTTPS 地址。');return navigator.serviceWorker.register('/sw.js');}
function keyBytes(s){return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
function notificationPreferences(){return Object.fromEntries([...$('#preferences-form').querySelectorAll('input[name]')].map(input=>[input.name,input.checked]));}
function showPreferences(preferences){for(const input of $('#preferences-form').querySelectorAll('input[name]'))if(typeof preferences?.[input.name]==='boolean')input.checked=preferences[input.name];}
async function savePreferences(endpoint,preferences){
 const r=await fetch('/api/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint,...(preferences?{preferences}:{})})});
 if(!r.ok)throw Error((await r.json()).error||'无法保存通知偏好');return r.json();
}
$('#preferences-form').onsubmit=async event=>{
 event.preventDefault();
 if(data.desktop){try{await localSettings({preferences:notificationPreferences()});$('#preferences-status').textContent='已保存到本机，关闭网页后继续生效。';}catch(e){$('#preferences-status').textContent=e.message;}return;}
 try{const reg=await registration();const sub=await reg.pushManager.getSubscription();
 if(!sub){$('#preferences-status').textContent='尚未订阅，所选偏好将在点击“订阅重置提醒”时一起保存。';return;}
 const saved=await savePreferences(sub.endpoint,notificationPreferences());showPreferences(saved.preferences);
 $('#preferences-status').textContent='已保存到服务器。页面关闭后也会按此偏好推送。';
 }catch(e){$('#preferences-status').textContent=e.message;}
};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{
 contentView=button.dataset.view;
 const url=new URL(location.href);
 if(contentView==='reset')url.searchParams.delete('view');else url.searchParams.set('view',contentView);
 history.replaceState(null,'',url);
 for(const other of document.querySelectorAll('[data-view]'))other.setAttribute('aria-pressed',String(other===button));render();
};
$('#subscribe').onclick=async()=>{
 if(data.desktop){try{await localSettings({enabled:true,preferences:notificationPreferences()});$('#message').textContent='本机提醒已开启。首次读取只建立基线，后续新动态按所选类别提醒。';}catch(e){$('#message').textContent=e.message;}return;}
 try{const reg=await registration();await navigator.serviceWorker.ready;const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('尚未允许通知，可在浏览器的网站设置中开启。');const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(data.publicKey)});const r=await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...sub.toJSON(),preferences:notificationPreferences()})});if(!r.ok)throw Error((await r.json()).error);$('#subscribe').hidden=true;$('#unsubscribe').hidden=false;$('#message').textContent='已订阅。服务器只会推送你开启的通知类别，和当前页面筛选无关。';$('#preferences-status').textContent='通知偏好已随订阅保存到服务器。';}catch(e){$('#message').textContent=e.message;}
};
$('#unsubscribe').onclick=async()=>{try{if(data.desktop){await localSettings({enabled:false});$('#message').textContent='本机提醒已关闭，日历继续收录。';return;}const reg=await registration();const sub=await reg.pushManager.getSubscription();if(sub){const r=await fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});if(!r.ok)throw Error('取消未成功，请重试');await sub.unsubscribe();}$('#subscribe').hidden=false;$('#unsubscribe').hidden=true;$('#message').textContent='已取消提醒。';}catch(e){$('#message').textContent=e.message;}};
async function localSettings(settings){const r=await fetch('/api/local/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});const result=await r.json();if(!r.ok)throw Error(result.error||'保存失败');data.desktop=result.desktop;render();}
$('#source-frequency').onchange=()=>{frequencyDirty=true;$('#source-frequency-status').textContent='尚未保存';};
$('#source-frequency-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter||event.currentTarget.querySelector('button'),select=$('#source-frequency');button.disabled=true;select.disabled=true;try{const r=await fetch('/api/local/source-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pollMode:select.value})});const result=await r.json();if(!r.ok)throw Error(result.error||'保存失败');data.status=result.status;frequencyDirty=false;$('#source-frequency-status').textContent='已保存到本机，关闭网页或重启后继续生效。';render();}catch(error){$('#source-frequency-status').textContent=error.message;}finally{button.disabled=false;select.disabled=false;}};
$('#test-desktop').onclick=async()=>{const button=$('#test-desktop');button.disabled=true;try{const r=await fetch('/api/local/test-notification',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await r.json();$('#test-result').textContent=result.message||result.error;}catch{$('#test-result').textContent='无法联系本地后台';}finally{button.disabled=false;}};
refresh();setInterval(refresh,20000);
setInterval(renderAppearance,60000);
$('#appearance').onchange=event=>{visualPreview=event.target.value==='auto'?null:Number(event.target.value);renderAppearance();};
$('#exit-preview').onclick=()=>{visualPreview=null;$('#appearance').value='auto';renderAppearance();};
$('#mascot-exit-preview').onclick=$('#exit-preview').onclick;
$('#replay').onclick=confetti;
$('#mascot-toggle').onclick=()=>{const collapsed=$('#tibo-mascot').classList.toggle('collapsed');$('#mascot-toggle').textContent=collapsed?'+':'−';$('#mascot-toggle').setAttribute('aria-expanded',String(!collapsed));$('#mascot-toggle').setAttribute('aria-label',collapsed?'展开 Tibo 人物':'收起 Tibo 人物');};
// 窄屏下展开的人物会遮挡日历与正文，首次进入先收起，用户点开时再把遮挡风险交给他们自己决定。
const narrow=matchMedia('(max-width:1100px)');
function applyNarrow(){if(narrow.matches&&!narrowTouched){$('#tibo-mascot').classList.add('collapsed');$('#mascot-toggle').textContent='+';$('#mascot-toggle').setAttribute('aria-expanded','false');$('#mascot-toggle').setAttribute('aria-label','展开 Tibo 人物');}}
let narrowTouched=false;
$('#mascot-toggle').addEventListener('click',()=>{narrowTouched=true;});
narrow.addEventListener('change',applyNarrow);applyNarrow();
function restoreWebPush(){if('serviceWorker'in navigator)registration().then(async r=>{const sub=await r.pushManager.getSubscription();if(sub){try{const saved=await savePreferences(sub.endpoint);$('#subscribe').hidden=true;$('#unsubscribe').hidden=false;showPreferences(saved.preferences);$('#preferences-status').textContent='已读取服务器保存的通知偏好。';}catch(e){$('#subscribe').hidden=false;$('#unsubscribe').hidden=true;$('#preferences-status').textContent=e.message+'，请重新订阅以恢复绑定。';}}}).catch(()=>{});}
