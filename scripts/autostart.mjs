import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {projectRoot,localDataDir,rememberLocalDataDir} from '../src/paths.js';

const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const unitQuote=s=>`"${s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')}"`;
const desktopQuote=s=>`"${s.replace(/[\\"`$]/g,'\\$&').replaceAll('\\','\\\\').replaceAll('%','%%')}"`;
function safe(value){if(/[\r\n\0]/.test(value))throw Error('启动路径不能包含换行或空字符');return value;}

export function macAgent({root=projectRoot,env=process.env}={}){
  const dataDir=safe(localDataDir({root,env}));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.tibo-reset-live</string>\n<key>ProgramArguments</key><array><string>/bin/sh</string><string>${xml(safe(path.join(root,'start.sh')))}</string><string>--no-browser</string></array>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(safe(env.PATH||'/usr/local/bin:/usr/bin:/bin'))}</string><key>TIBO_DATA_DIR</key><string>${xml(dataDir)}</string></dict>\n<key>RunAtLoad</key><true/>\n<key>AbandonProcessGroup</key><true/>\n<key>ProcessType</key><string>Background</string>\n</dict></plist>\n`;
}
export function linuxUnit({root=projectRoot,env=process.env}={}){
  const dataDir=safe(localDataDir({root,env}));
  const start=unitQuote(safe(path.join(root,'start.sh'))).replaceAll('$',()=>'$$');
  const stop=unitQuote(safe(path.join(root,'stop.sh'))).replaceAll('$',()=>'$$');
  return `[Unit]\nDescription=Tibo Reset Live local monitor\nAfter=graphical-session.target\nPartOf=graphical-session.target\n\n[Service]\nType=oneshot\nEnvironment=${unitQuote('PATH='+safe(env.PATH||'/usr/local/bin:/usr/bin:/bin'))}\nEnvironment=${unitQuote('TIBO_DATA_DIR='+dataDir)}\nExecStart=/bin/sh ${start} --no-browser\nExecStop=/bin/sh ${stop}\nRemainAfterExit=yes\n\n[Install]\nWantedBy=graphical-session.target\n`;
}
export function linuxDesktop({root=projectRoot,env=process.env}={}){
  const dataDir=safe(localDataDir({root,env}));
  return `[Desktop Entry]\nType=Application\nName=Tibo Reset Live\nComment=Start the local reset monitor\nExec=/usr/bin/env ${desktopQuote('PATH='+safe(env.PATH||'/usr/local/bin:/usr/bin:/bin'))} ${desktopQuote('TIBO_DATA_DIR='+dataDir)} /bin/sh ${desktopQuote(safe(path.join(root,'start.sh')))} --no-browser\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
}
function run(command,args,{allowFailure=false}={}){
  const result=spawnSync(command,args,{encoding:'utf8',stdio:allowFailure?'pipe':'inherit'});
  if(result.error&&!allowFailure)throw result.error;
  if(result.status!==0&&!allowFailure)throw Error(`${command} 执行失败（${result.status}）`);
  return result.status===0;
}

function mac(mode,home){
  const file=path.join(home,'Library','LaunchAgents','com.tibo-reset-live.plist');
  if(mode==='enable'){
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,macAgent());
    run('launchctl',['bootout',`gui/${process.getuid()}`,file],{allowFailure:true});
    run('launchctl',['bootstrap',`gui/${process.getuid()}`,file]);
    console.log('已设置为登录 macOS 后自动监测。');
  }else if(mode==='disable'){
    run('launchctl',['bootout',`gui/${process.getuid()}`,file],{allowFailure:true});
    fs.rmSync(file,{force:true});console.log('已关闭 macOS 登录自启，当前后台不受影响。');
  }else console.log(fs.existsSync(file)?'macOS 登录自启：已启用':'macOS 登录自启：未启用');
}

function linux(mode,home){
  const config=process.env.XDG_CONFIG_HOME||path.join(home,'.config');
  const unitDir=path.join(config,'systemd','user'),unit=path.join(unitDir,'tibo-reset-live.service');
  const desktopDir=path.join(config,'autostart'),desktop=path.join(desktopDir,'tibo-reset-live.desktop');
  const systemdAvailable=run('systemctl',['--user','is-active','graphical-session.target'],{allowFailure:true});
  if(mode==='enable'&&systemdAvailable){
    fs.mkdirSync(unitDir,{recursive:true});
    fs.writeFileSync(unit,linuxUnit());
    fs.rmSync(desktop,{force:true});run('systemctl',['--user','daemon-reload']);run('systemctl',['--user','enable','--now','tibo-reset-live.service']);
    console.log('已通过 systemd 设置为 Linux 登录后自动监测。');return;
  }
  if(mode==='enable'){
    fs.mkdirSync(desktopDir,{recursive:true});
    fs.writeFileSync(desktop,linuxDesktop());
    console.log('已通过桌面会话设置为 Linux 登录后自动监测。');return;
  }
  if(mode==='disable'){
    // 取消下次登录启动，不停止用户当前正在使用的日历。
    run('systemctl',['--user','disable','tibo-reset-live.service'],{allowFailure:true});
    fs.rmSync(unit,{force:true});fs.rmSync(desktop,{force:true});if(systemdAvailable)run('systemctl',['--user','daemon-reload'],{allowFailure:true});console.log('已关闭 Linux 登录自启，当前后台不受影响。');return;
  }
  console.log(fs.existsSync(unit)||fs.existsSync(desktop)?'Linux 登录自启：已启用':'Linux 登录自启：未启用');
}

function main(){
  const mode=process.argv[2]||'status';
  if(!['enable','disable','status'].includes(mode))throw Error(`未知命令：${mode}`);
  try{process.loadEnvFile(path.join(projectRoot,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(mode==='enable')process.env.TIBO_DATA_DIR=rememberLocalDataDir();
  if(process.platform==='darwin')mac(mode,os.homedir());else if(process.platform==='linux')linux(mode,os.homedir());else throw Error('此脚本只用于 macOS 和 Linux。');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error(`设置自启动失败：${error.message}`);process.exitCode=1;}
}
