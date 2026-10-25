import {classify,normalizeEvent} from './classify.js';
import {deriveSchedule} from './schedule.js';
import {mergeFollowUp} from './monitor.js';

export function repairResetSchedules(store){
  if(store.get('resetScheduleRepair:v1'))return;
  // 纠正旧版把“Rest and reset”宣布时刻当成完成的记录，保留原文、来源和游标。
  for(const event of store.events()){
    if(event.kind==='confirmed'&&/\brest\s+and\s+reset\b/i.test(event.excerpt||'')){
      store.upsertEvent({...event,...classify({text:event.excerpt})});
      store.db.prepare('DELETE FROM deliveries WHERE event=?').run(event.id);
    }
  }
  for(let parent of store.events().filter(e=>e.kind==='scheduled')){
    const own=deriveSchedule(parent.excerpt,parent.at);
    if(own)parent={...parent,...own};
    const replies=[...(parent.followUps||[]),...store.events().filter(e=>e.parent===parent.id&&e.kind==='candidate').map(e=>({id:e.id,at:e.at,url:e.url,excerpt:e.excerpt}))];
    for(const reply of replies){
      const schedule=deriveSchedule(reply.excerpt,reply.at,parent.at);
      if(!schedule)continue;
      parent=mergeFollowUp(parent,{...reply,...schedule});
      const candidate=store.event(reply.id);
      if(candidate?.kind==='candidate')store.upsertEvent({...candidate,mergedInto:parent.id});
    }
    if(!parent.triggerAt&&(parent.literalEnd||parent.windowEnd))parent.triggerAt=parent.literalEnd||parent.windowEnd;
    store.upsertEvent(parent);
  }
  store.set('resetScheduleRepair:v1','1');
}

// 到点是本产品的自动触发规则；用独立证据类型保留依据，不伪造第二条完成帖。
export class ResetClock{
  constructor(store,onEvent=()=>{},{now=()=>Date.now()}={}){this.store=store;this.onEvent=onEvent;this.now=now;this.timer=null;}
  tick(notify=true){
    const now=this.now(),events=this.store.events();let added=0;
    for(const announcement of events.filter(e=>e.kind==='scheduled'&&(!e.topic||e.topic==='reset'))){
      const at=Date.parse(announcement.triggerAt);
      if(!Number.isFinite(at)||at>now||at<Date.parse(announcement.at))continue;
      const id='timed-'+announcement.id;
      if(this.store.event(id))continue;
      // 同一预告已有完成证据，或截止前已完成，则不再触发；别的计划日不抵消本日历史。
      if(events.some(e=>['confirmed','observed','timed'].includes(e.kind)&&Date.parse(e.at)<=now&&(
        e.parent===announcement.id||(announcement.url&&e.announcementSource===announcement.url)||
        e.kind!=='timed'&&!e.parent&&!e.announcementSource&&Date.parse(e.at)>=Date.parse(announcement.at)&&Date.parse(e.at)<=at
      )))continue;
      const event=normalizeEvent({id,kind:'timed',at:new Date(at).toISOString(),title:'重置时间已到',note:'按 Tibo 官方预告时间触发日历、狂欢与提醒；依据为原预告及时间回复。',parent:announcement.id,announcementAt:announcement.at,announcementSource:announcement.url,url:announcement.url,sourceType:'schedule',...(announcement.via?{via:announcement.via}:{})});
      const send=notify&&announcement.scheduleNotify!==false&&!announcement.historical&&now-at<=6*3600000;
      if(this.store.addEvent(event,send)){events.push(event);added++;this.onEvent(event,{notify:send});}
    }
    return added;
  }
  start(){
    if(this.timer)return;
    this.tick(!!this.store.get('resetClockInitialized'));
    this.store.set('resetClockInitialized','1');
    this.timer=setInterval(()=>this.tick(),1000);this.timer.unref?.();
  }
  stop(){clearInterval(this.timer);this.timer=null;}
}
