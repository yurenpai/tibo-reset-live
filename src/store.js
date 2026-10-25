import { DatabaseSync } from 'node:sqlite';
import { wantsNotification } from './preferences.js';
export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries(event TEXT,endpoint TEXT,tries INTEGER DEFAULT 0,next INTEGER DEFAULT 0, PRIMARY KEY(event,endpoint));
      CREATE TABLE IF NOT EXISTS desktop_deliveries(id TEXT PRIMARY KEY,json TEXT NOT NULL,tries INTEGER DEFAULT 0,next INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);`);
  }
  get(key) { return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value; }
  set(key,value) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key,String(value)); }
  post(id) { const r=this.db.prepare('SELECT json FROM posts WHERE id=?').get(id);return r?JSON.parse(r.json):null; }
  savePost(p) { this.db.prepare('INSERT OR REPLACE INTO posts VALUES(?,?)').run(p.id,JSON.stringify(p)); }
  event(id) { const r=this.db.prepare('SELECT json FROM events WHERE id=?').get(id);return r?JSON.parse(r.json):null; }
  events() { return this.db.prepare('SELECT json FROM events').all().map(r=>JSON.parse(r.json)).sort((a,b)=>b.at.localeCompare(a.at)); }
  addEvent(e,notify=false) {
    this.db.exec('BEGIN');
    try {
      const n=this.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?)').run(e.id,JSON.stringify(e)).changes;
      // 只给真正想要这一类的订阅者入队；偏好存在订阅里的 json，服务器据此过滤。
      if(n && notify) for(const s of this.subscriptions()){
        if(wantsNotification(s.preferences,e)) this.db.prepare('INSERT OR IGNORE INTO deliveries(event,endpoint) VALUES(?,?)').run(e.id,s.endpoint);
      }
      this.db.exec('COMMIT');return !!n;
    } catch(err) {this.db.exec('ROLLBACK');throw err;}
  }
  subscriptions() {
    return this.db.prepare('SELECT json FROM subscriptions').all().map(r=>JSON.parse(r.json));
  }
  upsertHistoricalEvent(e) {
    const existing=this.event(e.id);
    // 回填补充静态字段，但保留实时期间收集的窗口和回复。
    const merged=existing?{...e,...existing}:e;
    this.db.prepare('INSERT OR REPLACE INTO events VALUES(?,?)').run(e.id,JSON.stringify(merged));
  }
  upsertEvent(e) {
    const before=this.event(e.id);
    if(before&&JSON.stringify(before)===JSON.stringify(e))return false;
    this.db.prepare('INSERT OR REPLACE INTO events VALUES(?,?)').run(e.id,JSON.stringify(e));
    return true;
  }
  subscribe(s) {this.db.prepare('INSERT OR REPLACE INTO subscriptions VALUES(?,?)').run(s.endpoint,JSON.stringify(s));}
  unsubscribe(endpoint) {this.db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(endpoint);this.db.prepare('DELETE FROM deliveries WHERE endpoint=?').run(endpoint);}
  jobs() {return this.db.prepare('SELECT d.*,s.json FROM deliveries d JOIN subscriptions s ON d.endpoint=s.endpoint WHERE d.next<=? AND d.tries<8 LIMIT 100').all(Date.now());}
  success(job) {this.db.prepare('DELETE FROM deliveries WHERE event=? AND endpoint=?').run(job.event,job.endpoint);}
  retry(job) {this.db.prepare('UPDATE deliveries SET tries=tries+1,next=? WHERE event=? AND endpoint=?').run(Date.now()+Math.min(3600000,30000*2**job.tries),job.event,job.endpoint);}
  queueDesktop(event) {this.db.prepare('INSERT OR IGNORE INTO desktop_deliveries(id,json) VALUES(?,?)').run(event.id,JSON.stringify(event));}
  desktopJobs() {return this.db.prepare('SELECT * FROM desktop_deliveries ORDER BY next,id').all();}
  removeDesktop(id) {this.db.prepare('DELETE FROM desktop_deliveries WHERE id=?').run(id);}
  completeDesktop(id,at) {
    this.db.exec('BEGIN');
    try{this.set('desktopSent:'+id,at);this.removeDesktop(id);this.db.exec('COMMIT');}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  retryDesktop(job,now) {this.db.prepare('UPDATE desktop_deliveries SET tries=tries+1,next=? WHERE id=?').run(now+Math.min(3600000,30000*2**job.tries),job.id);}
  close() {this.db.close();}
}
