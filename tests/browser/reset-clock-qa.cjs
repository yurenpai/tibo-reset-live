const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const artifact=require('./artifacts.cjs');
(async()=>{
 const {Store}=await import('../../src/store.js');
 const {Monitor}=await import('../../src/monitor.js');
 const {ResetClock}=await import('../../src/reset-clock.js');
 const {DesktopNotifications}=await import('../../src/desktop.js');
 const {createApp}=await import('../../src/server.js');
 const root=path.resolve(__dirname,'../..'),store=new Store(':memory:'),sent=[],errors=[];
 const history={checkedAt:'2026-10-25T07:00:00Z',events:[]},planDoc=JSON.parse(fs.readFileSync(path.join(root,'resources/plan-data.json')));
 let now=Date.parse('2026-10-25T07:59:59Z');
 const desktop=new DesktopNotifications(store,{send:async message=>sent.push(message),now:()=>now});
 desktop.save({enabled:true,preferences:{confirmed:true,scheduled:false}});
 const onEvent=(e,{notify=true}={})=>{if(notify)desktop.event(e);};
 const monitor=new Monitor(store,onEvent,{});monitor.userId='tibo';
 await monitor.enqueue({id:'main',author_id:'tibo',created_at:'2026-10-25T03:39:31Z',text:'Day 20/ Rest and reset'});
 await monitor.enqueue({id:'reply',author_id:'tibo',created_at:'2026-10-25T03:40:04Z',text:'By midnight PST',referenced_tweets:[{type:'replied_to',id:'main'}]});
 const clock=new ResetClock(store,onEvent,{now:()=>now});clock.start();clock.stop();
 const server=createApp({store,history,planDoc,monitor,desktop,now:()=>now,origin:'http://localhost:8797'}).listen(8797,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 async function open(url=''){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date(now)});const loaded=page.waitForResponse(r=>r.url().endsWith('/api/calendar'));await page.goto('http://localhost:8797/'+url);await loaded;await page.clock.runFor(50);return page;
 }
 try{
  let page=await open();
  assert((await page.locator('#festival-title').innerText()).includes('重置已宣布'));
  const announced=await page.locator('#announcement-detail').innerText();assert(announced.includes('16:00'));
  assert((await page.locator('#festival-status').innerText()).includes('11:39'));assert.equal(sent.length,0);
  await page.close(); // 到点时浏览器页面已关闭，仍通过后台生成事件与系统通知。
  now=Date.parse('2026-10-25T08:00:00Z');assert.equal(clock.tick(),1);await desktop.chain;assert.equal(sent.length,1);
  page=await open();
  assert(await page.locator('body').evaluate(e=>e.classList.contains('celebrating')&&!e.classList.contains('announced')));
  assert((await page.locator('#festival-kicker').innerText()).includes('按官方预告时间触发'));
  assert((await page.locator('#festival-status').innerText()).includes('16:00'));
  assert((await page.locator('#mascot-stage').innerText()).includes('DAY 1'));
  assert((await page.locator('#mascot-basis').innerText()).includes('按官方预告时间触发'));
  const detail=await page.locator('#detail').innerText();assert(detail.includes('按预告触发：2026-10-25 16:00'));assert(detail.includes('原帖宣布：2026-10-25 11:39'));
  assert((await page.locator('.day.today .badge.timed').innerText()).includes('16:00'));
  await page.screenshot({path:artifact('reset-clock-desktop.png'),fullPage:true});
  await page.locator('[data-view=plan]').click();await page.locator('[data-plan-day="20"]').click();
  const plan=await page.locator('#plan-detail').innerText();for(const text of ['2026-10-24 PT','11:39','16:00','按官方预告时间触发'])assert(plan.includes(text),text);
  await page.setViewportSize({width:390,height:844});
  for(const view of ['reset','plan','all']){await page.locator(`[data-view=${view}]`).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),view);}
  await page.locator('[data-view=reset]').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:artifact('reset-clock-mobile.png'),fullPage:true});
  clock.start();clock.stop();await desktop.chain;assert.equal(sent.length,1);assert.equal(store.events().filter(e=>e.kind==='timed').length,1);
  assert.deepEqual(errors,[]);await page.close();
  console.log('通过：宣布 11:39 / PST 截止 16:00 分开显示、关页到点后台通知、预告到点狂欢与人物 Day 1、PT Day 20、三视图手机布局、重启去重');
 }finally{clock.stop();monitor.stop();await browser.close();await new Promise(r=>server.close(r));store.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
