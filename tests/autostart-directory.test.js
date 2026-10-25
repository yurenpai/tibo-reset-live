import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {macAgent,linuxUnit,linuxDesktop} from '../scripts/autostart.mjs';
import * as paths from '../src/paths.js';

test('R3: 自启生成器仅保留解析后的数据目录和 PATH，不复制密钥',()=>{
 const root='/tmp/Tibo Calendar',env={PATH:'/usr/bin',TIBO_DATA_DIR:'custom & "dir" 100% $HOME',X_BEARER_TOKEN:'do-not-copy-secret'};
 const configs=[macAgent({root,env}),linuxUnit({root,env}),linuxDesktop({root,env})];
 for(const config of configs){assert.match(config,/TIBO_DATA_DIR/);assert.match(config,/custom/);assert(!config.includes(env.X_BEARER_TOKEN));}
 assert.match(configs[0],/custom &amp;/);assert.match(configs[1],/100%%/);assert.match(configs[2],/100%%/);
});
test('R3: 自启记住绝对目录，重开终端后启动、查询和停止仍选同一目录',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-autopath-'));
 try{
  const env={TIBO_DATA_DIR:'custom data & 100%'};
  const selected=paths.rememberLocalDataDir({root,env});
  assert.equal(selected,path.resolve(root,env.TIBO_DATA_DIR));
  assert.equal(paths.localDataDir({root,env:{}}),selected);
  assert.equal(paths.localDataDir({root,env:{TIBO_DATA_DIR:'explicit'}}),path.resolve(root,'explicit'));
  const stored=JSON.parse(fs.readFileSync(path.join(root,'.runtime','autostart-data-dir.json')));
  assert.deepEqual(Object.keys(stored).sort(),['dataDir','root']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('R5: Windows 停止先解析 .env 的新目录，不走旧账本分支',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-stop-path-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'src'));
  for(const name of ['scripts/stop-local.ps1','scripts/local-control.mjs','src/paths.js'])fs.copyFileSync(new URL('../'+name,import.meta.url),path.join(root,name));
  const target=path.join(root,'new data & path');fs.mkdirSync(target);fs.mkdirSync(path.join(root,'data'));
  fs.writeFileSync(path.join(root,'.env'),'TIBO_DATA_DIR="'+target.replaceAll('\\','/')+'"\n');
  fs.writeFileSync(path.join(target,'local-instance.json'),JSON.stringify({pid:0,root}));
  const legacy=path.join(root,'data','local-instance.json');
  fs.writeFileSync(legacy,JSON.stringify({pid:process.pid,root,startedTicks:'1',nodePath:process.execPath}));
  const env={...process.env,PATH:path.dirname(process.execPath)+';'+process.env.PATH};delete env.TIBO_DATA_DIR;
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','stop-local.ps1')],{env,encoding:'utf8',timeout:20000});
  assert.equal(fs.existsSync(path.join(target,'local-instance.json')),false);
  assert.equal(fs.existsSync(legacy),true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
