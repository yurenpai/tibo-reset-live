import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';

// 所有入口共用项目根目录；本机运行时数据放进操作系统的用户数据目录，
// 云端/Docker 默认仍使用项目下的 data/，也可通过 TIBO_DATA_DIR 覆盖。
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));

export function localDataDir({env=process.env,platform=process.platform,home=os.homedir()}={}){
  if(env.TIBO_DATA_DIR)return path.resolve(projectRoot,env.TIBO_DATA_DIR);
  const p=platform==='win32'?path.win32:path.posix;
  if(platform==='win32')return p.join(env.LOCALAPPDATA||p.join(home,'AppData','Local'),'TiboResetLive');
  if(platform==='darwin')return p.join(home,'Library','Application Support','TiboResetLive');
  return p.join(env.XDG_DATA_HOME||p.join(home,'.local','share'),'tibo-reset-live');
}

export function dataDirFor(env=process.env){
  if(env.TIBO_DATA_DIR)return path.resolve(projectRoot,env.TIBO_DATA_DIR);
  return env.LOCAL_MODE==='1'?localDataDir({env}):path.join(projectRoot,'data');
}

// 用 SQLite 创建包含 WAL 已提交事务的一致快照；不复制锁文件，也不修改旧库。
export function migrateLegacyData(targetDir,{root=projectRoot}={}){
  const legacy=path.join(root,'data');
  fs.mkdirSync(targetDir,{recursive:true});
  const from=path.join(legacy,'calendar.sqlite'),to=path.join(targetDir,'calendar.sqlite');
  if(path.resolve(legacy)===path.resolve(targetDir)||!fs.existsSync(from)||fs.existsSync(to))return [];
  for(const name of ['local-instance.json','local-service.json']){
    let ledger;try{ledger=JSON.parse(fs.readFileSync(path.join(legacy,name),'utf8').replace(/^\uFEFF/,''));}catch{continue;}
    const pid=ledger.supervisorPid||ledger.pid;
    if(!Number.isInteger(pid)||pid<=0)continue;
    try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')continue;throw error;}
    throw Error('旧版本后台仍在运行，请先在旧项目目录运行 stop.cmd，再启动新版本迁移数据。');
  }
  const temp=path.join(targetDir,`migration-${randomUUID()}.sqlite`);
  const db=new DatabaseSync(from,{readOnly:true});
  try{
    db.prepare('VACUUM INTO ?').run(temp);
    // 同目录硬链接原子发布，目标已存在则不覆盖，也不会留下半份正式数据库。
    try{fs.linkSync(temp,to);}catch(error){if(error.code==='EEXIST')return [];throw error;}
    fs.writeFileSync(path.join(targetDir,'migration.json'),JSON.stringify({from:legacy,copied:['calendar.sqlite'],at:new Date().toISOString()},null,2));
    return ['calendar.sqlite'];
  }finally{db.close();fs.rmSync(temp,{force:true});}
}
