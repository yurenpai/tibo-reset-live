import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

test('跨平台控制器可启动、识别重复实例并安全停止后台',{timeout:30000},async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-control-'));
  const script=fileURLToPath(new URL('../scripts/local-control.mjs',import.meta.url));
  const env={...process.env,TIBO_DATA_DIR:dataDir,TIBO_SKIP_LEGACY_MIGRATION:'1',SOURCE_MODE:'public',PUBLIC_FEED_URL:'https://127.0.0.1.invalid/feed'};
  const run=(...args)=>execFileSync(process.execPath,[script,...args],{env,encoding:'utf8',stdio:'pipe',timeout:20000,windowsHide:true});
  try{
    assert.match(run('start','--no-browser'),/本机监测已启动/);
    const ledger=JSON.parse(fs.readFileSync(path.join(dataDir,'local-instance.json'),'utf8'));
    const response=await fetch(`${ledger.url}/api/health`,{signal:AbortSignal.timeout(3000),headers:{connection:'close'}});
    assert.deepEqual(await response.json(),{app:'tibo-reset-live',ok:true,local:true});
    assert.match(run('start','--no-browser'),/已在运行/);
    assert.match(run('status'),/运行中/);
    assert.ok(ledger.token);assert.equal(ledger.nodePath,process.execPath);
    // 同一守护健康检查失败时不能另起一个后台，也不能接受错误令牌停止。
    const ledgerPath=path.join(dataDir,'local-instance.json');
    fs.writeFileSync(ledgerPath,JSON.stringify({...ledger,url:'http://127.0.0.1:9'}));
    assert.throws(()=>run('start','--no-browser'),/后台仍在运行/);
    fs.writeFileSync(ledgerPath,JSON.stringify({...ledger,token:'old-token'}));
    assert.throws(()=>run('stop'),/后台身份无法确认/);
    fs.writeFileSync(ledgerPath,JSON.stringify(ledger));
    const saved=await fetch(`${ledger.url}/api/local/preferences`,{method:'POST',headers:{origin:ledger.url,'content-type':'application/json',connection:'close'},body:JSON.stringify({enabled:false,preferences:{feature:true}})});
    assert.equal(saved.status,200);
    assert.match(run('stop'),/已停止/);
    assert.equal(fs.existsSync(path.join(dataDir,'local-instance.json')),false);
    assert.match(run('start','--no-browser'),/本机监测已启动/);
    const restarted=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
    const calendar=await (await fetch(`${restarted.url}/api/calendar`,{headers:{connection:'close'}})).json();
    assert.equal(calendar.desktop.preferences.feature,true);
    assert.equal(calendar.desktop.enabled,false);
    // 启动记录缺失时仍能凭守护的记录停止，不留下孤立后台。
    fs.rmSync(ledgerPath);
    assert.match(run('stop'),/已停止/);
  }finally{
    try{run('stop');}catch{}
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
});
