import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,validSubscription} from '../src/classify.js';
import {Store} from '../src/store.js';
test('否定、玩笑及脱离上下文的 Done 不误报',()=>{
 for(const text of ['No reset today','I bought a reset button','Done','reset my password'])assert.equal(classify({text}),null);
});
test('回复链确认与预告和重置卡分别记录',()=>{
 assert.equal(classify({text:'Done'},{kind:'scheduled'}).kind,'confirmed');
 assert.equal(classify({text:'Done'},{kind:'candidate'}),null);
 assert.equal(classify({text:'Done'},{kind:'banked'}).kind,'banked');
 assert.equal(classify({text:'Lands tomorrow before 10am PST.'},{kind:'scheduled'}).kind,'scheduled');
 assert.equal(classify({text:'Loading a banked reset into paid accounts'}).kind,'banked');
 assert.equal(classify({text:'The reset has been processed. Enjoy!'}).kind,'confirmed');
 assert.equal(classify({text:'Day 15/ Nevermind, still cooking... and reset. Enjoy.'}).kind,'confirmed');
});
test('基线不群发；流和补漏同一帖子只入队一次；取消后清除队列',()=>{
 const db=new Store(':memory:');db.subscribe({endpoint:'test',keys:{},preferences:{confirmed:true,observed:true}});
 db.addEvent({id:'baseline',at:'2026-10-22T00:00:00Z',kind:'confirmed',topic:'reset'},false);assert.equal(db.jobs().length,0);
 assert.equal(db.addEvent({id:'new',at:'2026-10-23T00:00:00Z',kind:'confirmed',topic:'reset'},true),true);
 assert.equal(db.addEvent({id:'new',at:'2026-10-23T00:00:00Z',kind:'confirmed',topic:'reset'},true),false);assert.equal(db.jobs().length,1);
 db.unsubscribe('test');assert.equal(db.jobs().length,0);db.close();
});
test('拒绝 localhost、任意第三方和无效推送密钥',()=>{
 const s={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'a'.repeat(87),auth:'a'.repeat(22)}};
 assert.equal(validSubscription(s),true);
 for(const endpoint of ['https://localhost/','http://fcm.googleapis.com/','https://fcm.googleapis.com.evil.test/','https://fcm.googleapis.com:8443/'])assert.equal(validSubscription({...s,endpoint}),false);
});
