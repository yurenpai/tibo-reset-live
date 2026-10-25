const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const artifact=require('./artifacts.cjs');
const base=process.env.QA_BASE_URL||'http://localhost:8788';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date('2026-10-23T09:30:00Z'));
 await page.goto(base);await page.waitForSelector('.day');
 assert.equal(await page.locator('[data-view=reset]').getAttribute('aria-pressed'),'true');
 assert(await page.locator('#plan-panel').isHidden());
 assert.equal(await page.locator('#connection').innerText(),'○ 尚未接入实时源');
 assert(await page.locator('#subscribe').isDisabled());
 assert((await page.locator('.badge').count())>=9);
 await page.getByRole('button',{name:'2026-10-08，1 条记录',exact:true}).click();
 assert((await page.locator('#detail').innerText()).includes('重置卡'));
 const legend=await page.locator('.legend').innerText();
 for(const t of ['官方确认','社区观测到账','已预告','重置卡','待核实'])assert(legend.includes(t),'图例缺少 '+t);
 await page.getByRole('button',{name:/2026-10-23/}).first().click();
 const d23=await page.locator('#detail').innerText();
 for(const t of ['推算观察窗口','补充回复','社区观测已重置','适用范围','北京时间','PT'])assert(d23.includes(t),'详情缺少 '+t);
 assert(d23.includes('距窗口结束')||d23.includes('窗口已于'));
 assert(await page.locator('#prev').isDisabled());assert(await page.locator('#next').isDisabled());
 await page.locator('#today').click();
 assert.equal(await page.locator('#month').innerText(),'2026 年 10 月');
 assert(await page.locator('body').evaluate(e=>e.classList.contains('observing')&&e.classList.contains('celebrating')));
 assert(await page.locator('body').evaluate(e=>e.classList.contains('announced')));
 assert((await page.locator('#festival-title').innerText()).includes('重置已宣布'));
 assert(await page.locator('#replay').isHidden());
 // 有更新的未落地预告时保留预热状态；不把预告和彩屑庆祝混淆。
 await page.clock.setFixedTime(new Date('2026-10-23T15:59:00Z'));
 await page.locator('#today').click();assert(await page.locator('#announcement-detail').isVisible());
 assert(await page.locator('body').evaluate(e=>e.classList.contains('celebrating')));
 await page.clock.setFixedTime(new Date('2026-10-23T09:30:00Z'));await page.locator('#today').click();
 await page.screenshot({path:artifact('preview.png'),fullPage:true});
 // 计划视图：28 个日期、准确计数、PT 归日、独立的重置证据、原帖声明。
 await page.locator('[data-view=plan]').click();
 assert(await page.locator('#plan-panel').isVisible());assert(await page.locator('.workspace').isHidden());
 assert.equal(await page.locator('.plan-day').count(),28);
 assert.equal(await page.locator('#plan-done').innerText(),'19 / 28 天');
 assert.equal(await page.locator('#plan-resets').innerText(),'6');
 assert.equal(await page.locator('#plan-features').innerText(),'12');
 assert.equal(await page.locator('.plan-today .plan-day-number').innerText(),'DAY 19');
 await page.locator('.plan-day').nth(17).click();
 const detail=await page.locator('#plan-detail').innerText();
 for(const t of ['2026-10-22','2026-10-23 12:46','北京时间','PT','等待截止时间'])assert(detail.includes(t),'计划详情缺少 '+t);
 assert((await page.locator('#plan-source').getAttribute('href')).endsWith('2106845241357824205'));
 await page.locator('.plan-day').nth(27).click();assert((await page.locator('#plan-detail').innerText()).includes('待观察'));
 await page.locator('.plan-table-wrap summary').click();assert.equal(await page.locator('#plan-table tr').count(),28);
 await page.locator('.plan-table-wrap summary').click();
 await page.locator('.plan-day').nth(17).click();
 await page.locator('.content-views').scrollIntoViewIfNeeded();
 await page.screenshot({path:artifact('plan-preview.png'),fullPage:true});
 // 页面筛选不改变通知复选框。
 await page.locator('.notification-settings summary').click();
 assert(await page.locator('input[name=confirmed]').isChecked());assert(await page.locator('input[name=observed]').isChecked());
 for(const k of ['scheduled','feature','digest'])assert(!(await page.locator(`input[name=${k}]`).isChecked()));
 await page.locator('input[name=feature]').check();
 await page.locator('[data-view=all]').click();assert(await page.locator('input[name=feature]').isChecked());
 assert(await page.locator('#plan-panel').isVisible());assert(await page.locator('.workspace').isVisible());
 assert((await page.locator('.badge.feature').count())>0);
 await page.locator('[data-view=reset]').click();assert.equal(await page.locator('.badge.feature').count(),0);
 await page.locator('input[name=feature]').uncheck();await page.locator('.notification-settings summary').click();
 // 手机三视图与中等屏幕：无水平溢出，支持收起人物。
 for(const width of [390,768,1024]){
  await page.setViewportSize({width,height:844});await page.waitForTimeout(100);
  for(const view of ['reset','plan','all']){
   await page.locator(`[data-view=${view}]`).click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px ${view} 溢出`);
  }
 }
 await page.setViewportSize({width:390,height:844});await page.locator('[data-view=plan]').click();
 assert(await page.locator('#tibo-mascot').evaluate(e=>e.classList.contains('collapsed')));
 await page.screenshot({path:artifact('plan-mobile-preview.png'),fullPage:true});
 await page.locator('[data-view=reset]').click();await page.screenshot({path:artifact('preview-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 const response=await page.request.post(base+'/api/subscribe',{headers:{Origin:'https://evil.invalid'},data:{}});assert.equal(response.status(),403);
 console.log('通过：原重置月历、月份边界、三视图、28 天网格/来源/双时区/统计、独立通知偏好、轻庆祝、桌面和手机布局、来源隔离');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
