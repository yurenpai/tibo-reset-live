import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {projectRoot,localDataDir} from './paths.js';

// 用户级后台守护，无需管理员或 Windows 服务安装；启动脚本负责单实例及健康检查。
export function runLocalService({root=projectRoot,entry=path.join(root,'src','local.js'),restartDelay=1000,dataDir=localDataDir()}={}){
const statePath=path.join(dataDir,'local-service.json');
const stopPath=path.join(dataDir,'local-stop.json');
const token=randomUUID();
fs.mkdirSync(path.dirname(statePath),{recursive:true});
let child=null,timer=null,stopping=false,restarts=0,delay=restartDelay;
function run(){
  if(stopping)return;
  const started=Date.now();
  child=spawn(process.execPath,['--env-file-if-exists=.env',entry],{cwd:root,env:{...process.env,TIBO_DATA_DIR:dataDir,LOCAL_SUPERVISED:'1'},windowsHide:true,stdio:'inherit'});
  fs.writeFileSync(statePath,JSON.stringify({supervisorPid:process.pid,childPid:child.pid||null,restarts,token,root,dataDir,startedAt:new Date(started).toISOString()}));
  child.once('error',error=>console.error('Background worker:',error.message));
  child.once('close',(code,signal)=>{
    if(stopping){finish();return;}
    restarts++;delay=Date.now()-started>60000?restartDelay:Math.min(delay*2,30000);
    console.error(`Background worker exited (${code??signal}); restarting in ${delay} ms`);
    timer=setTimeout(run,delay);
  });
}
function finish(){
  clearInterval(watcher);
  try{if(JSON.parse(fs.readFileSync(statePath,'utf8')).token===token)fs.unlinkSync(statePath);}catch{}
  process.exit(0);
}
function stop(){
  if(stopping)return;
  stopping=true;clearTimeout(timer);
  if(child&&child.exitCode===null&&child.signalCode===null){
    child.kill();
    // 等到子进程真正退出再结束守护，避免留下失去管理的工作进程。
    setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},5000).unref();
  }
  else finish();
}
// 通过本机文件握手停止，避免 Windows 跨 PowerShell 版本的进程终止差异。
// 每次启动的随机 token 让旧请求不会误停重启后的实例。
const watcher=setInterval(()=>{
  try{
    const request=JSON.parse(fs.readFileSync(stopPath,'utf8').replace(/^\uFEFF/,''));
    if(request.supervisorPid!==process.pid||request.token!==token)return;
    fs.unlinkSync(stopPath);stop();
  }catch{}
},250);
process.on('SIGINT',stop);process.on('SIGTERM',stop);
run();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runLocalService();
