const $=id=>document.getElementById(id);
let loaded=false,loading=false,dirty=false,busy=false,refreshCalendar=()=>{};
const defaults={mode:'public',publicFeedUrl:'https://codex-reset.com/api/feed',fallbackUrls:[],observationSources:[],tokenConfigured:false};
function mode(){
 const api=$('source-mode').value==='api';
 $('source-api-fields').hidden=!api;
 // 公共地址仍保留草稿；切换回公共模式时继续使用。
 $('source-public-fields').hidden=api;
}
function fill(config){
 $('source-mode').value=config.mode;$('source-primary').value=config.publicFeedUrl;
 $('source-backup-1').value=config.fallbackUrls[0]||'';$('source-backup-2').value=config.fallbackUrls[1]||'';
 $('source-community').value=config.observationSources.join('\n');$('source-token').value='';$('source-clear-token').checked=false;
 $('source-token-state').textContent=config.tokenConfigured?'已配置 Token，不会回显；留空保留，填写新值可替换。':'尚未配置 Token。免登录模式不需要密钥。';
 mode();dirty=false;
}
function input(){return {mode:$('source-mode').value,publicFeedUrl:$('source-primary').value.trim(),fallbackUrls:[$('source-backup-1').value.trim(),$('source-backup-2').value.trim()].filter(Boolean),observationSources:$('source-community').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),token:$('source-token').value,clearToken:$('source-clear-token').checked};}
async function request(url,body){
 const response=await fetch(url,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store'});
 const result=await response.json();if(!response.ok)throw Error(result.error||'无法读取或保存来源配置');return result;
}
async function load(){
 if(loaded||loading)return;loading=true;
 try{const config=await request('/api/local/source-config');if(!dirty)fill(config);loaded=true;}
 catch(error){$('source-config-status').textContent=error.message;}finally{loading=false;}
}
function lock(value){busy=value;for(const element of $('source-config-form').querySelectorAll('input,select,textarea,button'))element.disabled=value;}
export function initSourceConfig(refresh){
 refreshCalendar=refresh;
 $('source-config-panel').addEventListener('toggle',()=>{if($('source-config-panel').open)load();});
 $('source-config-form').addEventListener('input',()=>{dirty=true;$('source-config-results').replaceChildren();$('source-config-status').textContent='有未保存的修改；点击保存后才会应用。';});
 $('source-mode').addEventListener('change',mode);
 $('source-config-reset').onclick=()=>{
  fill(defaults);$('source-clear-token').checked=true;dirty=true;
  $('source-config-results').replaceChildren();$('source-config-status').textContent='已恢复默认草稿；保存后使用默认公共源、停用备用/社区接口并清除 Token。';
 };
 $('source-config-form').onsubmit=async event=>{
  event.preventDefault();if(busy||!loaded)return;
  const body=input();lock(true);$('source-config-status').textContent='正在保存并切换来源…';
  try{
   const result=await request('/api/local/source-config',body);fill(result.config);$('source-config-results').replaceChildren();
   $('source-config-status').textContent='已保存到本机并立即应用；连接结果请查看逐项来源状态。';await refreshCalendar();
  }catch(error){$('source-config-status').textContent=error.message;}finally{lock(false);}
 };
 $('source-config-test').onclick=async()=>{
  if(busy||!loaded||!$('source-config-form').reportValidity())return;
  const body=input();lock(true);$('source-config-results').replaceChildren();$('source-config-status').textContent='正在测试，通常在 15 秒内完成；不会保存草稿或发送提醒。';
  try{
   const result=await request('/api/local/source-config/test',body);
   for(const check of result.results){const item=document.createElement('li');item.textContent=`${check.ok?'通过':'未通过'} · ${check.label}：${check.message}`;item.dataset.state=check.ok?'ok':'error';$('source-config-results').append(item);}
   $('source-config-status').textContent='测试完成，配置尚未保存。';
  }catch(error){$('source-config-status').textContent=error.message;}finally{lock(false);}
 };
}
export function renderSourceConfig(data){
 $('source-config-panel').hidden=!data.sourceConfigurable;
 if(data.sourceConfigurable&&$('source-config-panel').open)load();
}
