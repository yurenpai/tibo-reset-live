import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

test('本机守护恢复异常退出的工作进程，忽略旧停止请求，并一并停止子进程', {timeout:15000}, async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-service-'));
  const entry=path.join(root,'worker.cjs');
  fs.writeFileSync(entry,'setInterval(()=>{},1000);');
  const moduleUrl=new URL('../src/local-service.js',import.meta.url).href;
  const code=`import {runLocalService} from ${JSON.stringify(moduleUrl)};runLocalService(${JSON.stringify({root,entry,restartDelay:50,dataDir:path.join(root,'data')})});`;
  const service=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore',windowsHide:true});
  const exited=new Promise(resolve=>service.once('exit',resolve));
  const statePath=path.join(root,'data','local-service.json');
  const stopPath=path.join(root,'data','local-stop.json');
  let state;
  const read=()=>{try{return JSON.parse(fs.readFileSync(statePath,'utf8'));}catch{return null;}};
  const until=async predicate=>{
    for(let i=0;i<100;i++){const value=predicate();if(value)return value;await sleep(50);}
    throw Error('Supervisor did not reach expected state');
  };
  try{
    state=await until(()=>read());assert.equal(state.supervisorPid,service.pid);
    fs.writeFileSync(stopPath,JSON.stringify({supervisorPid:service.pid,token:'previous-instance'}));
    await sleep(600);assert.equal(service.exitCode,null);assert.equal(read().childPid,state.childPid);
    const oldChild=state.childPid;process.kill(oldChild);
    state=await until(()=>{const next=read();return next&&next.childPid!==oldChild&&next.restarts===1?next:null;});
    fs.writeFileSync(stopPath,JSON.stringify({supervisorPid:service.pid,token:state.token}));
    assert.equal(await exited,0);
    assert.throws(()=>process.kill(state.childPid,0));
    assert.equal(fs.existsSync(statePath),false);
  }finally{
    if(service.exitCode===null){state=read();if(state){fs.writeFileSync(stopPath,JSON.stringify({supervisorPid:service.pid,token:state.token}));await Promise.race([exited,sleep(2000)]);}if(service.exitCode===null)service.kill();}
    for(const name of ['local-service.json','local-stop.json']){const file=path.join(root,'data',name);if(fs.existsSync(file))fs.unlinkSync(file);}
    if(fs.existsSync(path.join(root,'data')))fs.rmdirSync(path.join(root,'data'));
    fs.unlinkSync(entry);fs.rmdirSync(root);
  }
});
