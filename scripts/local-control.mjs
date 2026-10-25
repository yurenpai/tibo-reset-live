import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {localDataDir,migrateLegacyData,projectRoot} from '../src/paths.js';

try{process.loadEnvFile(path.join(projectRoot,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dataDir=localDataDir();
const ledgerPath=path.join(dataDir,'local-instance.json');
const servicePath=path.join(dataDir,'local-service.json');
const stopPath=path.join(dataDir,'local-stop.json');
const lockPath=path.join(dataDir,'launcher.lock');

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}}
function pidAlive(pid){
  if(!Number.isInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}
}
function acquireLock(){
  fs.mkdirSync(dataDir,{recursive:true});
  for(let attempt=0;attempt<2;attempt++){
    try{
      const fd=fs.openSync(lockPath,'wx');
      try{fs.writeFileSync(fd,String(process.pid));}finally{fs.closeSync(fd);}
      return ()=>fs.rmSync(lockPath,{force:true});
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      let owner,age;
      try{owner=Number(fs.readFileSync(lockPath,'utf8'));age=Date.now()-fs.statSync(lockPath).mtimeMs;}
      catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(pidAlive(owner)||(!owner&&age<30000))throw Error('另一个启动器正在运行，请稍后重试。');
      fs.rmSync(lockPath,{force:true});
    }
  }
  throw Error('无法取得启动锁。');
}
function writeLedger(ledger){
  const temp=ledgerPath+'.tmp';fs.writeFileSync(temp,JSON.stringify(ledger,null,2));fs.renameSync(temp,ledgerPath);
}
function sameService(ledger,service){
  return !!(service&&typeof service.token==='string'&&service.token&&service.supervisorPid===ledger.pid&&
    service.root===ledger.root&&(!ledger.token||ledger.token===service.token));
}
async function health(url){
  try{
    const address=new URL(url);
    if(address.protocol!=='http:'||!['localhost','127.0.0.1'].includes(address.hostname))return false;
    address.hostname='127.0.0.1';address.pathname='/api/health';
    const response=await fetch(address,{signal:AbortSignal.timeout(1500)});
    const body=await response.json();
    return response.ok&&body.app==='tibo-reset-live'&&body.local===true;
  }catch{return false;}
}
async function freePort(){
  for(let port=8788;port<=8808;port++){
    const open=await new Promise(resolve=>{
      const server=net.createServer();
      server.once('error',()=>resolve(false));
      server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));
    });
    if(open)return port;
  }
  throw Error('8788–8808 端口均被占用。');
}
function openBrowser(url){
  const spec=process.platform==='darwin'?['open',[url]]:process.platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:['xdg-open',[url]];
  const child=spawn(spec[0],spec[1],{detached:true,stdio:'ignore',windowsHide:true});
  child.once('error',error=>console.error(`浏览器未打开，请手动访问 ${url}：${error.message}`));child.unref();
}

export async function start({browser=true}={}){
  const release=acquireLock();
  try{
    const existing=readJson(ledgerPath),service=readJson(servicePath);
    if(existing&&pidAlive(existing.pid)){
      if(!sameService(existing,service))throw Error('后台记录属于旧版或身份不一致，请先运行 stop.cmd；不要重复启动。');
      if(!await health(existing.url))throw Error('后台仍在运行，但网页暂未就绪；请稍后重试，或先停止后台。');
      console.log(`本机监测已在运行：${existing.url}`);
      if(browser)openBrowser(existing.url);
      return existing;
    }
    if(service&&pidAlive(service.supervisorPid))throw Error('检测到后台守护仍在运行，请先执行停止命令。');
    if(process.env.TIBO_SKIP_LEGACY_MIGRATION!=='1')migrateLegacyData(dataDir,{root:projectRoot});
    const legacy=readJson(path.join(projectRoot,'data','local-instance.json'));
    if(process.env.TIBO_SKIP_LEGACY_MIGRATION!=='1'&&path.resolve(dataDir)!==path.join(projectRoot,'data')&&legacy&&pidAlive(legacy.pid))throw Error('旧版本后台仍在运行，请先在旧项目目录运行 stop.cmd。');
    const port=await freePort(),url=`http://localhost:${port}`;
    const out=fs.openSync(path.join(dataDir,'local.stdout.log'),'a');
    const err=fs.openSync(path.join(dataDir,'local.stderr.log'),'a');
    let child;
    try{
      child=spawn(process.execPath,['--env-file-if-exists=.env',path.join(projectRoot,'src','local-service.js')],{
        cwd:projectRoot,env:{...process.env,PORT:String(port),TIBO_DATA_DIR:dataDir},detached:true,windowsHide:true,stdio:['ignore',out,err]
      });
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    }finally{fs.closeSync(out);fs.closeSync(err);}
    child.unref();
    const ledger={pid:child.pid,root:projectRoot,dataDir,nodePath:process.execPath,url,startedAt:new Date().toISOString()};
    writeLedger(ledger);
    for(let attempt=0;attempt<40;attempt++){
      if(!pidAlive(child.pid))break;
      const service=readJson(servicePath);
      if(sameService(ledger,service)&&await health(url)){
        ledger.token=service.token;writeLedger(ledger);
        console.log(`本机监测已启动：${url}`);console.log(`数据与日志：${dataDir}`);
        if(browser)openBrowser(url);
        return ledger;
      }
      await sleep(300);
    }
    // 保留进程记录，以便启动失败后仍能准确停止，避免留下无法管理的守护。
    throw Error(`后台未就绪，请先运行停止命令，再查看 ${path.join(dataDir,'local.stderr.log')}`);
  }finally{release();}
}

export async function stop(){
  const release=acquireLock();
  try{
    let ledger=readJson(ledgerPath);const service=readJson(servicePath);
    if(!ledger&&service)ledger={pid:service.supervisorPid,root:service.root,token:service.token};
    if(!ledger||!pidAlive(ledger.pid)){
      fs.rmSync(ledgerPath,{force:true});console.log('没有正在运行的本机监测。');return false;
    }
    if(!sameService(ledger,service))throw Error('后台身份无法确认，未终止任何进程。旧版后台请使用 stop.cmd 停止。');
    fs.writeFileSync(stopPath,JSON.stringify({supervisorPid:ledger.pid,token:service.token}));
    for(let attempt=0;attempt<75;attempt++){
      if(!pidAlive(ledger.pid)){
        fs.rmSync(ledgerPath,{force:true});console.log('本机监测已停止，日历和偏好仍保留。');return true;
      }
      await sleep(200);
    }
    throw Error('后台仍在退出，请稍后再次运行停止脚本。');
  }finally{release();}
}

export async function status(){
  const ledger=readJson(ledgerPath),service=readJson(servicePath);
  const alive=!!(ledger&&pidAlive(ledger.pid)&&sameService(ledger,service));
  const running=alive&&await health(ledger.url);
  console.log(running?`运行中：${ledger.url}`:alive?'后台运行中，网页暂未就绪。':`未运行。数据目录：${dataDir}`);
  return {running,alive,ledger,dataDir};
}

async function main(){
  const [command='start',...args]=process.argv.slice(2);
  if(command==='start')await start({browser:!args.includes('--no-browser')});
  else if(command==='stop')await stop();
  else if(command==='status')await status();
  else if(command==='open'){
    const current=await status();if(!current.running)throw Error('服务尚未运行。');openBrowser(current.ledger.url);
  }else throw Error(`未知命令：${command}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(`错误：${error.message}`);process.exitCode=1;});
