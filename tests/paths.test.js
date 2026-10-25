import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {dataDirFor,localDataDir,migrateLegacyData,projectRoot} from '../src/paths.js';

test('各桌面系统使用各自的标准用户数据目录',()=>{
  assert.equal(localDataDir({platform:'win32',home:'C:\\Users\\mei',env:{LOCALAPPDATA:'D:\\Local'}}),'D:\\Local\\TiboResetLive');
  assert.equal(localDataDir({platform:'darwin',home:'/Users/mei',env:{}}),'/Users/mei/Library/Application Support/TiboResetLive');
  assert.equal(localDataDir({platform:'linux',home:'/home/mei',env:{}}),'/home/mei/.local/share/tibo-reset-live');
  assert.equal(localDataDir({platform:'linux',home:'/home/mei',env:{XDG_DATA_HOME:'/data/mei'}}),'/data/mei/tibo-reset-live');
});

test('显式数据目录优先，云端默认仍留在项目 data 目录',()=>{
  assert.equal(dataDirFor({TIBO_DATA_DIR:path.join(os.tmpdir(),'tibo-custom')}),path.resolve(os.tmpdir(),'tibo-custom'));
  assert.equal(dataDirFor({LOCAL_MODE:'0'}),path.join(projectRoot,'data'));
  assert.equal(localDataDir({env:{TIBO_DATA_DIR:'custom-data'}}),path.join(projectRoot,'custom-data'));
});

test('旧数据库首次复制到新目录且不会覆盖已有数据',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-paths-')),target=path.join(root,'new-data');
  try{
    fs.mkdirSync(path.join(root,'data'));
    const source=new DatabaseSync(path.join(root,'data','calendar.sqlite'));
    source.exec("CREATE TABLE meta(value TEXT); INSERT INTO meta VALUES('legacy')");source.close();
    assert.deepEqual(migrateLegacyData(target,{root}),['calendar.sqlite']);
    const migrated=new DatabaseSync(path.join(target,'calendar.sqlite'));
    assert.equal(migrated.prepare('SELECT value FROM meta').get().value,'legacy');migrated.close();
    const before=fs.readFileSync(path.join(target,'calendar.sqlite'));
    fs.writeFileSync(path.join(target,'calendar.sqlite-wal'),'do-not-touch');
    assert.deepEqual(migrateLegacyData(target,{root}),[]);
    assert.deepEqual(fs.readFileSync(path.join(target,'calendar.sqlite')),before);
    assert.equal(fs.readFileSync(path.join(target,'calendar.sqlite-wal'),'utf8'),'do-not-touch');
    assert.ok(fs.existsSync(path.join(target,'migration.json')));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('迁移快照包含 WAL 中的已提交记录，且检测到旧后台时拒绝迁移',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-migrate-')),target=path.join(root,'new-data');
  fs.mkdirSync(path.join(root,'data'));
  const source=new DatabaseSync(path.join(root,'data','calendar.sqlite'));
  try{
    source.exec("PRAGMA journal_mode=WAL; CREATE TABLE meta(value TEXT); INSERT INTO meta VALUES('in-wal')");
    const ledger=path.join(root,'data','local-instance.json');
    fs.writeFileSync(ledger,JSON.stringify({pid:process.pid}));
    assert.throws(()=>migrateLegacyData(target,{root}),/旧版本后台仍在运行/);
    assert.equal(fs.existsSync(path.join(target,'calendar.sqlite')),false);
    fs.rmSync(ledger);
    migrateLegacyData(target,{root});
    const migrated=new DatabaseSync(path.join(target,'calendar.sqlite'));
    try{assert.equal(migrated.prepare('SELECT value FROM meta').get().value,'in-wal');}finally{migrated.close();}
    assert.equal(fs.existsSync(path.join(target,'calendar.sqlite-wal')),false);
    assert.equal(source.prepare('SELECT value FROM meta').get().value,'in-wal');
  }finally{source.close();fs.rmSync(root,{recursive:true,force:true});}
});
