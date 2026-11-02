'use strict';
// Persistență: SQLite (node:sqlite). Schema echivalentă pentru Postgres/Supabase: ../schema.sql
const {DatabaseSync}=require('node:sqlite');
const crypto=require('crypto');
function open(file){
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,name_lc TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'PLAYER',created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS characters(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,name TEXT NOT NULL,name_lc TEXT NOT NULL UNIQUE,cls INTEGER NOT NULL,lv INTEGER NOT NULL DEFAULT 1,xp INTEGER NOT NULL DEFAULT 0,gold INTEGER NOT NULL DEFAULT 0,hp INTEGER NOT NULL,mp INTEGER NOT NULL,zone TEXT NOT NULL DEFAULT 'village',x REAL NOT NULL,y REAL NOT NULL,inv TEXT NOT NULL DEFAULT '[]',updated INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS blocks(char_id INTEGER NOT NULL,blocked_lc TEXT NOT NULL,PRIMARY KEY(char_id,blocked_lc));
  CREATE TABLE IF NOT EXISTS chat_log(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,ch TEXT NOT NULL,from_name TEXT NOT NULL,to_name TEXT,msg TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,account_id INTEGER,kind TEXT NOT NULL,detail TEXT);
  CREATE INDEX IF NOT EXISTS idx_char_acc ON characters(account_id);
  /* --- STRUCTURI PREGĂTITE (V8.5-V12). Nefolosite de logica serverului; NU sunt funcționalități. --- */
  CREATE TABLE IF NOT EXISTS guilds(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,name_lc TEXT NOT NULL UNIQUE,tag TEXT,created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS guild_members(guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,char_id INTEGER NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,guild_rank TEXT NOT NULL DEFAULT 'MEMBER',joined INTEGER NOT NULL,PRIMARY KEY(guild_id,char_id));
  CREATE TABLE IF NOT EXISTS parties(id INTEGER PRIMARY KEY AUTOINCREMENT,leader_char INTEGER NOT NULL,created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS party_members(party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,char_id INTEGER NOT NULL UNIQUE,PRIMARY KEY(party_id,char_id));
  CREATE TABLE IF NOT EXISTS titles(id TEXT PRIMARY KEY,name_key TEXT NOT NULL,rarity INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS character_titles(char_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,title_id TEXT NOT NULL REFERENCES titles(id),active INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(char_id,title_id));
  CREATE TABLE IF NOT EXISTS character_equipment(char_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,slot TEXT NOT NULL,item_id TEXT NOT NULL,visible INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(char_id,slot));
  CREATE TABLE IF NOT EXISTS skins(id TEXT PRIMARY KEY,name_key TEXT NOT NULL,cosmetic INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS character_skins(char_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,skin_id TEXT NOT NULL REFERENCES skins(id),equipped INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(char_id,skin_id));
  CREATE TABLE IF NOT EXISTS mounts(id TEXT PRIMARY KEY,name_key TEXT NOT NULL,speed_mult REAL NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS character_mounts(char_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,mount_id TEXT NOT NULL REFERENCES mounts(id),active INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(char_id,mount_id));
  CREATE TABLE IF NOT EXISTS bp_seasons(id INTEGER PRIMARY KEY,name_key TEXT NOT NULL,starts INTEGER NOT NULL,ends INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS bp_progress(char_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,season_id INTEGER NOT NULL REFERENCES bp_seasons(id),points INTEGER NOT NULL DEFAULT 0,claimed TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(char_id,season_id));
  CREATE TABLE IF NOT EXISTS currency_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,char_id INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'TEST',delta INTEGER NOT NULL,reason TEXT NOT NULL,ts INTEGER NOT NULL);`);
  for(const c of['kills','bosskills']){try{db.exec('ALTER TABLE characters ADD COLUMN '+c+' INTEGER NOT NULL DEFAULT 0')}catch(e){}}
  try{db.exec("ALTER TABLE characters ADD COLUMN cosm TEXT NOT NULL DEFAULT '{}'")}catch(e){}
  for(const c of['banned_until','muted_until']){try{db.exec('ALTER TABLE accounts ADD COLUMN '+c+' INTEGER NOT NULL DEFAULT 0')}catch(e){}}
  const q={
    addAcc:db.prepare('INSERT INTO accounts(name,name_lc,salt,hash,created) VALUES(?,?,?,?,?)'),
    accByName:db.prepare('SELECT * FROM accounts WHERE name_lc=?'),
    addSess:db.prepare('INSERT INTO sessions(token_hash,account_id,expires) VALUES(?,?,?)'),
    sess:db.prepare('SELECT s.account_id,s.expires,a.name,a.role FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE token_hash=?'),
    delSess:db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    purge:db.prepare('DELETE FROM sessions WHERE expires<?'),
    chars:db.prepare('SELECT id,name,cls,lv,zone FROM characters WHERE account_id=?'),
    char:db.prepare('SELECT * FROM characters WHERE id=? AND account_id=?'),
    addChar:db.prepare('INSERT INTO characters(account_id,name,name_lc,cls,hp,mp,zone,x,y,updated) VALUES(?,?,?,?,?,?,?,?,?,?)'),
    saveChar:db.prepare('UPDATE characters SET lv=?,xp=?,gold=?,hp=?,mp=?,zone=?,x=?,y=?,inv=?,updated=?,kills=?,bosskills=?,cosm=? WHERE id=?'),
    blocks:db.prepare('SELECT blocked_lc FROM blocks WHERE char_id=?'),
    addBlock:db.prepare('INSERT OR IGNORE INTO blocks(char_id,blocked_lc) VALUES(?,?)'),
    delBlock:db.prepare('DELETE FROM blocks WHERE char_id=? AND blocked_lc=?'),
    log:db.prepare('INSERT INTO chat_log(ts,ch,from_name,to_name,msg) VALUES(?,?,?,?,?)'),
    aud:db.prepare('INSERT INTO audit(ts,account_id,kind,detail) VALUES(?,?,?,?)'),
  };
  const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
  const hashPw=(pw,salt)=>crypto.scryptSync(pw,salt,64,{N:16384,r:8,p:1}).toString('hex');
  return {
    raw:db,
    accInfo:id=>db.prepare('SELECT id,name,role,banned_until,muted_until FROM accounts WHERE id=?').get(id),
    charByName:n=>db.prepare('SELECT id,account_id,name FROM characters WHERE name_lc=?').get(String(n).toLowerCase()),
    setBan:(id,u)=>db.prepare('UPDATE accounts SET banned_until=? WHERE id=?').run(u,id),
    setMute:(id,u)=>db.prepare('UPDATE accounts SET muted_until=? WHERE id=?').run(u,id),
    audits:n=>db.prepare('SELECT ts,account_id,kind,detail FROM audit ORDER BY id DESC LIMIT ?').all(n),
    createGuild(name,tag,charId){try{db.exec('BEGIN');const r=db.prepare('INSERT INTO guilds(name,name_lc,tag,created) VALUES(?,?,?,?)').run(name,name.toLowerCase(),tag,Date.now());const gid=Number(r.lastInsertRowid);db.prepare("INSERT INTO guild_members(guild_id,char_id,guild_rank,joined) VALUES(?,?,'LEADER',?)").run(gid,charId,Date.now());db.exec('COMMIT');return gid}catch(e){try{db.exec('ROLLBACK')}catch(x){}return 0}},
    guildOf:cid=>db.prepare('SELECT g.id,g.name,g.tag,m.guild_rank AS rank FROM guild_members m JOIN guilds g ON g.id=m.guild_id WHERE m.char_id=?').get(cid)||null,
    guildMembers:gid=>db.prepare('SELECT c.id,c.name,m.guild_rank AS rank FROM guild_members m JOIN characters c ON c.id=m.char_id WHERE m.guild_id=? ORDER BY m.joined').all(gid),
    addGuildMember(gid,cid){try{db.prepare("INSERT INTO guild_members(guild_id,char_id,guild_rank,joined) VALUES(?,?,'MEMBER',?)").run(gid,cid,Date.now());return 1}catch(e){return 0}},
    removeGuildMember:cid=>db.prepare('DELETE FROM guild_members WHERE char_id=?').run(cid),
    setGuildRank:(cid,r)=>db.prepare('UPDATE guild_members SET guild_rank=? WHERE char_id=?').run(r,cid),
    deleteGuild:gid=>db.prepare('DELETE FROM guilds WHERE id=?').run(gid),
    setRole(accId,role){db.prepare('UPDATE accounts SET role=? WHERE id=?').run(role,accId)},
    role(accId){const r=db.prepare('SELECT role FROM accounts WHERE id=?').get(accId);return r?r.role:'PLAYER'},
    register(name,pw){const salt=crypto.randomBytes(16).toString('hex');try{const r=q.addAcc.run(name,name.toLowerCase(),salt,hashPw(pw,salt),Date.now());return Number(r.lastInsertRowid)}catch(e){return 0}},
    verify(name,pw){const a=q.accByName.get(name.toLowerCase());if(!a)return null;const h=Buffer.from(hashPw(pw,a.salt),'hex'),g=Buffer.from(a.hash,'hex');return crypto.timingSafeEqual(h,g)?a:null},
    newSession(accId){const t=crypto.randomBytes(32).toString('hex');q.addSess.run(sha(t),accId,Date.now()+7*864e5);q.purge.run(Date.now());return t},
    session(t){if(typeof t!=='string'||t.length!==64)return null;const s=q.sess.get(sha(t));return s&&s.expires>Date.now()?s:null},
    endSession(t){q.delSess.run(sha(t))},
    chars:id=>q.chars.all(id),
    char:(id,acc)=>q.char.get(id,acc),
    addChar(acc,name,cls,hp,mp,zone,x,y){try{return Number(q.addChar.run(acc,name,name.toLowerCase(),cls,hp,mp,zone,x,y,Date.now()).lastInsertRowid)}catch(e){return 0}},
    saveChar(p){q.saveChar.run(p.lv,p.xp,p.gold,Math.round(p.hp),Math.round(p.mp),p.zone,p.x,p.y,JSON.stringify(p.inv),Date.now(),p.kills|0,p.bosskills|0,JSON.stringify(p.cosm||{}),p.id)},
    blocks:id=>q.blocks.all(id).map(r=>r.blocked_lc),
    addBlock:(id,n)=>q.addBlock.run(id,n),delBlock:(id,n)=>q.delBlock.run(id,n),
    log:(ch,f,t,m)=>q.log.run(Date.now(),ch,f,t||null,m),
    audit:(acc,kind,d)=>q.aud.run(Date.now(),acc||null,kind,d?String(d).slice(0,300):null),
    counts:()=>({accounts:db.prepare('SELECT COUNT(*) n FROM accounts').get().n,characters:db.prepare('SELECT COUNT(*) n FROM characters').get().n,banned:db.prepare('SELECT COUNT(*) n FROM accounts WHERE banned_until>?').get(Date.now()).n}),
    close(){try{db.close()}catch(e){}},
  };
}
module.exports={open};
