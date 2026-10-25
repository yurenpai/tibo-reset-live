const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const artifact=require('./artifacts.cjs');
(async()=>{
 const {Store}=await import('../../src/store.js');
 const {PublicFeedMonitor}=await import('../../src/public-feed.js');
 const {Observations}=await import('../../src/observations.js');
 const {createApp}=await import('../../src/server.js');
 const root=path.resolve(__dirname,'../..'),store=new Store(':memory:');
 const now=Date.parse('2026-10-25T12:00:00Z');let failed=false;
 const main='https://primary.example.test/feed',backup='https://backup.example.test/feed';
 const json=value=>new Response(JSON.stringify(value));
 const monitor=new PublicFeedMonitor(store,()=>{},{PUBLIC_FEED_URL:main,PUBLIC_FEED_FALLBACK_URLS:backup},{now:()=>now,random:()=>.5,fetchImpl:async url=>{
  if(failed&&url===main)return new Response('limited',{status:429,headers:{'retry-after':'3600'}});
  return json({profile:{handle:'thsottiaux'},fetched_at:new Date(now).toISOString(),tweets:[{id:'100',at:new Date(now-1000).toISOString(),text:'Thanks!',url:'https://x.com/thsottiaux/status/100'}]});
 }});
 const observations=new Observations(store,()=>{},['https://community.example.test/feed','https://other.example.test/feed'],{now:()=>now,fetchImpl:async url=>failed&&url.includes('other')?new Response('bad',{status:503}):json({observations:[]})});
 await monitor.check();await observations.check();
 const server=createApp({store,monitor,observations,now:()=>now,history:JSON.parse(fs.readFileSync(path.join(root,'resources/history.json'))),planDoc:JSON.parse(fs.readFileSync(path.join(root,'resources/plan-data.json')))}).listen(8795,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date(now)});
  await page.goto('http://localhost:8795');await page.waitForSelector('.day');
  await page.locator('.source-status > details > summary').click();await page.locator('.source-details summary').click();
  assert.equal(await page.locator('.source-row').count(),4);
  assert((await page.locator('#observed-source-hint').textContent()).includes('已配置社区观测源'));
  assert((await page.locator('.source-row').nth(1).innerText()).includes('尚未检查'));
  failed=true;await monitor.check();await observations.check();
  await page.reload();await page.waitForSelector('.day');
  await page.locator('.source-status > details > summary').click();await page.locator('.source-details summary').click();
  assert((await page.locator('#source-route-note').innerText()).includes('当前使用备用帖子源'));
  const rows=page.locator('.source-row');
  assert((await rows.nth(0).innerText()).includes('429'));assert((await rows.nth(0).innerText()).includes('冷却至'));
  assert((await rows.nth(1).innerText()).includes('当前使用'));
  assert((await rows.nth(2).innerText()).includes('最近检查成功'));
  assert((await rows.nth(3).innerText()).includes('503'));
  assert((await page.locator('#observed-source-hint').textContent()).includes('检查异常'));
  await page.locator('.source-details').scrollIntoViewIfNeeded();await page.screenshot({path:artifact('source-fallback-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await rows.nth(0).scrollIntoViewIfNeeded();await page.screenshot({path:artifact('source-fallback-mobile.png')});
  assert.deepEqual(errors,[]);console.log('通过：备用源切换状态、独立限流、社区部分故障、未使用备用源状态、手机来源卡片无溢出');
 }finally{monitor.stop();observations.stop();await browser.close();await new Promise(r=>server.close(r));store.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
