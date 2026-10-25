import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopNotifications} from '../src/desktop.js';
import {Store} from '../src/store.js';
import {macAgent,linuxUnit,linuxDesktop} from '../scripts/autostart.mjs';

test('通知状态正确识别三平台、缺少依赖以及无桌面会话',()=>{
  const store=new Store(':memory:');
  try{
    const support=options=>new DesktopNotifications(store,options).platformSupport();
    assert.equal(support({platform:'win32'}).backend,'windows-toast');
    assert.equal(support({platform:'darwin'}).backend,'macos-notification-center');
    assert.equal(support({platform:'linux',send:async()=>{}}).backend,'notify-send');
    assert.match(support({platform:'linux',env:{}}).hint,/桌面会话/);
    assert.match(support({platform:'linux',env:{WAYLAND_DISPLAY:'wayland-0'},probe:()=>({status:1})}).hint,/libnotify/);
    assert.equal(support({platform:'linux',env:{DISPLAY:':0'},probe:()=>({status:0})}).supported,true);
    assert.equal(support({platform:'freebsd'}).supported,false);
  }finally{store.close();}
});

test('登录自启配置保留 Node 搜索路径，处理空格和特殊字符，不打开浏览器',()=>{
  const root='/tmp/Tibo 日历 & "100%" $HOME',env={PATH:'/opt/node/bin:/usr/bin'};
  const agent=macAgent({root,env});
  assert.match(agent,/<key>PATH<\/key><string>\/opt\/node\/bin:\/usr\/bin<\/string>/);
  assert.match(agent,/&amp;/);assert.match(agent,/<key>AbandonProcessGroup<\/key><true\/>/);
  const unit=linuxUnit({root,env});
  assert.match(unit,/WantedBy=graphical-session.target/);
  assert.match(unit,/100%%/);assert.match(unit,/\$\$HOME/);
  assert.match(unit,/PATH=\/opt\/node\/bin:\/usr\/bin/);
  const desktop=linuxDesktop({root,env});
  assert.match(desktop,/Exec=\/usr\/bin\/env/);assert.match(desktop,/100%%/);
  for(const config of [agent,unit,desktop])assert.match(config,/--no-browser/);
  assert.throws(()=>linuxUnit({root:'/tmp/path\ninjected'}),/换行/);
});
