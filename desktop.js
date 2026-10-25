import { wantsNotification,normalizePreferences } from './preferences.js';

export class DesktopNotifications {
  constructor(store,{send,platform=process.platform,now=()=>Date.now()}={}) {
    this.store=store;this.send=send;this.platform=platform;this.now=now;this.chain=Promise.resolve();
    this.state={lastAttempt:null,lastAccepted:null,error:null};
  }
  settings(){let saved={};try{saved=JSON.parse(this.store.get('desktopSettings')||'{}');}catch{}return {enabled:saved.enabled===true,preferences:normalizePreferences(saved.preferences)};}
  save(input){
    const before=this.settings();
    const settings={enabled:typeof input?.enabled==='boolean'?input.enabled:before.enabled,preferences:normalizePreferences({...before.preferences,...input?.preferences})};
    this.store.set('desktopSettings',JSON.stringify(settings));return settings;
  }
  status(){return {...this.settings(),...this.state,supported:['win32','darwin','linux'].includes(this.platform),service:this.service||null};}
  async notify(title,message){
    this.state.lastAttempt=new Date(this.now()).toISOString();
    try {
      if(this.send)await this.send({title,message});
      else {
        const {default:notifier}=await import('node-notifier');
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('系统通知调用超时，请检查系统通知设置')),12000);
          notifier.notify({title,message,sound:false,wait:false,timeout:5},error=>{clearTimeout(timer);error?reject(error):resolve();});
        });
      }
      this.state.lastAccepted=new Date(this.now()).toISOString();this.state.error=null;
    }catch(error){this.state.error=error.message;throw error;}
  }
  event(event){
    const settings=this.settings();
    if(!settings.enabled||!wantsNotification(settings.preferences,event)||this.store.get('desktopSent:'+event.id))return;
    // 休眠/断网恢复后仅提醒最近 6 小时的动态，旧记录仍收录到日历。
    const age=this.now()-Date.parse(event.at);
    if(!Number.isFinite(age)||age<0||age>6*3600000)return;
    this.chain=this.chain.catch(()=>{}).then(async()=>{
      const current=this.settings();
      if(!current.enabled||!wantsNotification(current.preferences,event)||this.store.get('desktopSent:'+event.id))return;
      await this.notify(event.title,(event.note||'发现新的动态')+(event.via?'（公共镜像收录）':''));
      this.store.set('desktopSent:'+event.id,new Date(this.now()).toISOString());
    }).catch(error=>{this.state.error=error.message;});
  }
  async test(){await this.notify('Tibo 重置日历 · 测试通知','如果你看到了这条消息，本机桌面通知可用。关闭网页后，请让后台进程继续运行。');return this.status();}
}
