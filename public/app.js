import { resetAppearance } from './theme.js';
import { filterEvents, timeInZone } from './content.js';
import { renderPlan } from './plan-ui.js';
const navigation=new URLSearchParams(location.search);
let contentView=['all','plan'].includes(navigation.get('view'))?navigation.get('view'):'reset';
const $=s=>document.querySelector(s);
let visualPreview=null,previousCelebration=false;
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
 document.body.dataset.portraitStage=String(state.stage+1);
 $('#preview-notice').hidden=!state.preview;
 $('#festival-title').replaceChildren();
 const full=state.mood==='full',soft=state.mood==='soft';
 const lines=full?['赞美 Tibo，','额度复活！']:soft?['观测到账，','也要庆祝！']:['等一个重置，','盼一场狂欢。'];
 $('#festival-title').append(lines[0],document.createElement('br'),lines[1]);
 $('#festival-kicker').textContent=full?'RESET FESTIVAL · 官方确认狂欢':soft?'RESET FESTIVAL · 社区观测到账':'THE WAITING ROOM · 等待下一次重置';
 $('#festival-description').textContent=full?'Tibo 已官方确认重置。金币、光晕和彩屑已经就位，今天值得最高画质。':soft?'社区记录已观测到重置到账，金色和彩屑照常庆祝！证据来自社区观测，不冒充 Tibo 的官方完成确认。':'有重置的日子，值得庆祝。没有重置的日子，就看 Tibo 逐渐变成简笔画。';
 $('#festival-status').textContent=state.preview?'正在预览外观 · 不代表真实重置':state.last?(state.last.kind==='observed'?'上次观测到账：':'上次官方确认：')+bjt.format(new Date(state.last.at))+'（北京时间）':'尚无可用于计算的完成记录';
 $('#mascot-portrait').style.left=(-[30,337,644,951,1246][state.stage]/260*100)+'%';
 $('#mascot-stage').textContent=state.days===null?'等待确认':state.celebration?'DAY 1 · 满血复活':'DAY '+Math.min(state.days+1,5)+(state.days>=4?' +':'');
 $('#mascot-quote').textContent=state.days===null?'我先看看记录。':quotes[state.stage];
 $('#mascot-days').textContent=state.days===null?'暂无已确认或观测到的重置记录':state.celebration?'重置后未满 24 小时':'距上次完成记录已过 '+state.days+' 天';
 $('#mascot-basis').textContent=state.preview?'仅外观预览':!data.status.connected?'基于已收录记录 · 实时源未连接':'按最近完成记录计算';
 $('#replay').hidden=!state.celebration;
 if(state.celebration&&!previousCelebration)confetti();
 if(!state.celebration)$('#confetti').replaceChildren();
 previousCelebration=state.celebration;
}
const bjt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
function duration(ms){const m=Math.floor(ms/60000);const d=Math.floor(m/1440),h=Math.floor(m%1440/60),mm=m%60;return d?`${d} 天 ${h} 小时`:h?`${h} 小时 ${mm} 分`:`${mm} 分钟`;}
const dateKey=d=>bjt.format(new Date(d)).slice(0,10);
const requestedDate=navigation.get('date');
let selected=/^\d{4}-\d{2}-\d{2}$/.test(requestedDate||'')&&Number.isFinite(Date.parse(requestedDate+'T12:00:00Z'))?requestedDate:dateKey(Date.now()),view=new Date(selected+'T12:00:00Z'),data={events:[],status:{}};
const labels={confirmed:'官方确认',observed:'观测到账',scheduled:'重置预告',banked:'重置卡',candidate:'待核实',feature:'功能更新'};
function render(){
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
  const time=document.createElement('time');time.textContent=bjt.format(new Date(e.at))+' · 北京时间 / '+timeInZone(e.at,'America/Los_Angeles')+' PT';
  const p=document.createElement('p');p.textContent=e.note;
  const text=document.createElement('p');text.className='excerpt';text.textContent=e.excerpt||'';text.hidden=!e.excerpt;
  item.append(h,time,p,text);
  if(e.windowStart&&e.windowEnd){
   const window=document.createElement('div');window.className='time-window';
   const caption=document.createElement('span');caption.textContent='推算观察窗口';
   const range=document.createElement('strong');range.textContent=bjt.format(new Date(e.windowStart))+' — '+bjt.format(new Date(e.windowEnd));
   const note=document.createElement('small');note.textContent=e.timeNote;
   const countdown=document.createElement('small');countdown.className='countdown';
   const left=Date.parse(e.windowEnd)-Date.now();
   countdown.textContent=left>0?'距窗口结束还有 '+duration(left):'窗口已于上面标注的截止时刻结束';
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
 $('#connection').textContent=data.status.connected?'● 实时源已连接':data.status.configured?'○ 实时源重连中':'○ 尚未接入实时源';
 const obs=data.observations;
 $('#checked').textContent=(data.lastCheck?'最近检查：'+bjt.format(new Date(data.lastCheck)):'历史核对：'+bjt.format(new Date(data.historyCheckedAt))+' · 实时源未接入')+
  (obs?.enabled?(obs.checkedAt?' · 观测源 '+bjt.format(new Date(obs.checkedAt)):' · 观测源等待首次检查'):' · 未配置社区观测源');
 $('#subscribe').disabled=!data.pushReady;
 if(!data.pushReady)$('#message').textContent='维护者尚未配置推送服务，目前不能订阅关闭页面后的通知。';
 renderAppearance();
}
async function refresh(){try{const r=await fetch('/api/calendar',{cache:'no-store'});if(!r.ok)throw Error();data=await r.json();render();}catch{$('#connection').textContent='○ 连接中断';$('#message').textContent='无法读取更新，当前显示保留的记录。';}}
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
 try{const reg=await registration();const sub=await reg.pushManager.getSubscription();
 if(!sub){$('#preferences-status').textContent='尚未订阅，所选偏好将在点击“订阅重置提醒”时一起保存。';return;}
 const saved=await savePreferences(sub.endpoint,notificationPreferences());showPreferences(saved.preferences);
 $('#preferences-status').textContent='已保存到服务器。页面关闭后也会按此偏好推送。';
 }catch(e){$('#preferences-status').textContent=e.message;}
};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{
 contentView=button.dataset.view;for(const other of document.querySelectorAll('[data-view]'))other.setAttribute('aria-pressed',String(other===button));render();
};
$('#subscribe').onclick=async()=>{
 try{const reg=await registration();await navigator.serviceWorker.ready;const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('尚未允许通知，可在浏览器的网站设置中开启。');const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(data.publicKey)});const r=await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...sub.toJSON(),preferences:notificationPreferences()})});if(!r.ok)throw Error((await r.json()).error);$('#subscribe').hidden=true;$('#unsubscribe').hidden=false;$('#message').textContent='已订阅。服务器只会推送你开启的通知类别，和当前页面筛选无关。';$('#preferences-status').textContent='通知偏好已随订阅保存到服务器。';}catch(e){$('#message').textContent=e.message;}
};
$('#unsubscribe').onclick=async()=>{try{const reg=await registration();const sub=await reg.pushManager.getSubscription();if(sub){const r=await fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});if(!r.ok)throw Error('取消未成功，请重试');await sub.unsubscribe();}$('#subscribe').hidden=false;$('#unsubscribe').hidden=true;$('#message').textContent='已取消提醒。';}catch(e){$('#message').textContent=e.message;}};
refresh();setInterval(refresh,20000);
setInterval(renderAppearance,60000);
$('#appearance').onchange=event=>{visualPreview=event.target.value==='auto'?null:Number(event.target.value);renderAppearance();};
$('#exit-preview').onclick=()=>{visualPreview=null;$('#appearance').value='auto';renderAppearance();};
$('#replay').onclick=confetti;
$('#mascot-toggle').onclick=()=>{const collapsed=$('#tibo-mascot').classList.toggle('collapsed');$('#mascot-toggle').textContent=collapsed?'+':'−';$('#mascot-toggle').setAttribute('aria-expanded',String(!collapsed));$('#mascot-toggle').setAttribute('aria-label',collapsed?'展开 Tibo 人物':'收起 Tibo 人物');};
// 窄屏下展开的人物会遮挡日历与正文，首次进入先收起，用户点开时再把遮挡风险交给他们自己决定。
const narrow=matchMedia('(max-width:1100px)');
function applyNarrow(){if(narrow.matches&&!narrowTouched){$('#tibo-mascot').classList.add('collapsed');$('#mascot-toggle').textContent='+';$('#mascot-toggle').setAttribute('aria-expanded','false');$('#mascot-toggle').setAttribute('aria-label','展开 Tibo 人物');}}
let narrowTouched=false;
$('#mascot-toggle').addEventListener('click',()=>{narrowTouched=true;});
narrow.addEventListener('change',applyNarrow);applyNarrow();
if('serviceWorker'in navigator)registration().then(async r=>{const sub=await r.pushManager.getSubscription();if(sub){$('#subscribe').hidden=true;$('#unsubscribe').hidden=false;try{const saved=await savePreferences(sub.endpoint);showPreferences(saved.preferences);$('#preferences-status').textContent='已读取服务器保存的通知偏好。';}catch(e){$('#preferences-status').textContent=e.message;}}}).catch(()=>{});
