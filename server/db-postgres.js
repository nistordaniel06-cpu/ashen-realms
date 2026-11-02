'use strict';
// NIDRAVEN V10 — adaptor PostgreSQL (pg). Interfață identică cu db-async.js (SQLite), toate metodele async.
// - Interogări exclusiv parametrizate ($1..$n). Numele schemei e validat (regex) și pus între ghilimele.
// - Toate obiectele sunt calificate cu schema (implicit "nidraven_game"): NU se atinge nicio altă schemă/tabelă.
// - DATABASE_URL se citește doar aici (server) și nu apare niciodată în loguri/erori.
const {Pool,types}=require('pg');
const crypto=require('crypto'),util=require('util');
const scrypt=util.promisify(crypto.scrypt);
const SCHEMA_RE=/^[a-z_][a-z0-9_]{0,40}$/;
const TRANSIENT_CODES=new Set(['08000','08001','08003','08004','08006','57P01','57P02','57P03','40001','40P01','53300','53400','55P03','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENOTFOUND','EAI_AGAIN']);
const isTransient=e=>!!e&&(TRANSIENT_CODES.has(e.code)||/Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error|the database system is (starting up|shutting down)/i.test(e.message||''));
const redact=s=>String(s||'').replace(/postgres(ql)?:\/\/[^\s'"]+/gi,'[db-url]');
const hashPw=async(pw,salt)=>(await scrypt(pw,salt,64,{N:16384,r:8,p:1})).toString('hex');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');

function cleanUrl(url){ // scoatem sslmode/ssl din URL: SSL se controlează explicit prin DB_SSL (altfel URL-ul ar suprascrie configul)
  try{const u=new URL(url);u.searchParams.delete('sslmode');u.searchParams.delete('ssl');return u.toString()}catch(e){return url}
}

function migrations(S,schema){
  const T=(n)=>S+'.'+n;
  return[{v:1,sql:`
  CREATE TABLE ${T('accounts')}(id bigserial PRIMARY KEY,name text NOT NULL,name_lc text NOT NULL UNIQUE,salt text NOT NULL,hash text NOT NULL,role text NOT NULL DEFAULT 'PLAYER',created bigint NOT NULL,banned_until bigint NOT NULL DEFAULT 0,muted_until bigint NOT NULL DEFAULT 0);
  CREATE TABLE ${T('sessions')}(token_hash text PRIMARY KEY,account_id bigint NOT NULL REFERENCES ${T('accounts')}(id) ON DELETE CASCADE,expires bigint NOT NULL);
  CREATE INDEX idx_sess_exp ON ${T('sessions')}(expires);
  CREATE TABLE ${T('characters')}(id bigserial PRIMARY KEY,account_id bigint NOT NULL REFERENCES ${T('accounts')}(id) ON DELETE CASCADE,name text NOT NULL,name_lc text NOT NULL UNIQUE,cls smallint NOT NULL CHECK(cls BETWEEN 1 AND 4),lv int NOT NULL DEFAULT 1,xp bigint NOT NULL DEFAULT 0,gold bigint NOT NULL DEFAULT 0,hp int NOT NULL,mp int NOT NULL,zone text NOT NULL DEFAULT 'village',x double precision NOT NULL,y double precision NOT NULL,inv jsonb NOT NULL DEFAULT '[]',updated bigint NOT NULL,kills int NOT NULL DEFAULT 0,bosskills int NOT NULL DEFAULT 0,cosm jsonb NOT NULL DEFAULT '{}');
  CREATE INDEX idx_char_acc ON ${T('characters')}(account_id);
  CREATE TABLE ${T('blocks')}(char_id bigint NOT NULL REFERENCES ${T('characters')}(id) ON DELETE CASCADE,blocked_lc text NOT NULL,PRIMARY KEY(char_id,blocked_lc));
  CREATE TABLE ${T('chat_log')}(id bigserial PRIMARY KEY,ts bigint NOT NULL,ch text NOT NULL,from_name text NOT NULL,to_name text,msg text NOT NULL);
  CREATE TABLE ${T('audit')}(id bigserial PRIMARY KEY,ts bigint NOT NULL,account_id bigint,kind text NOT NULL,detail text);
  CREATE INDEX idx_audit_ts ON ${T('audit')}(ts);
  CREATE TABLE ${T('guilds')}(id bigserial PRIMARY KEY,name text NOT NULL,name_lc text NOT NULL UNIQUE,tag text,created bigint NOT NULL);
  CREATE TABLE ${T('guild_members')}(guild_id bigint NOT NULL REFERENCES ${T('guilds')}(id) ON DELETE CASCADE,char_id bigint NOT NULL UNIQUE REFERENCES ${T('characters')}(id) ON DELETE CASCADE,guild_rank text NOT NULL DEFAULT 'MEMBER',joined bigint NOT NULL,PRIMARY KEY(guild_id,char_id));
  -- structuri pregătite pentru fazele F/G (nefolosite de logica serverului în V10-B)
  CREATE TABLE ${T('titles')}(id text PRIMARY KEY,name_key text NOT NULL,rarity int NOT NULL DEFAULT 0);
  CREATE TABLE ${T('character_titles')}(char_id bigint NOT NULL REFERENCES ${T('characters')}(id) ON DELETE CASCADE,title_id text NOT NULL REFERENCES ${T('titles')}(id),active smallint NOT NULL DEFAULT 0,PRIMARY KEY(char_id,title_id));
  CREATE TABLE ${T('currency_ledger')}(id bigserial PRIMARY KEY,char_id bigint NOT NULL,currency text NOT NULL DEFAULT 'TEST',delta bigint NOT NULL,reason text NOT NULL,ts bigint NOT NULL);
  -- securitate: RLS activat, fără policy-uri => anon/authenticated nu au acces; serverul se conectează cu rol privilegiat.
  ALTER TABLE ${T('accounts')} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${T('sessions')} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${T('characters')} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ${T('blocks')} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${T('chat_log')} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${T('audit')} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ${T('guilds')} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${T('guild_members')} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${T('titles')} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ${T('character_titles')} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${T('currency_ledger')} ENABLE ROW LEVEL SECURITY;
  DO $do$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA ${schema} FROM anon'; EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM anon'; END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON SCHEMA ${schema} FROM authenticated'; EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM authenticated'; END IF;
  END $do$;`}];
}

async function open(opts={}){
  const url=opts.url||process.env.DATABASE_URL;
  if(!url)throw new Error('DATABASE_URL lipsește (setează-l doar pe server)');
  const schema=opts.schema||process.env.DB_SCHEMA||'nidraven_game';
  if(!SCHEMA_RE.test(schema))throw new Error('Nume de schemă invalid');
  const S='"'+schema+'"',T=n=>S+'.'+n;
  const local=/@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
  const sslEnv=process.env.DB_SSL;
  const ssl=opts.ssl!==undefined?opts.ssl:((sslEnv==='0'||(local&&sslEnv!=='1'))?false:{rejectUnauthorized:true});
  const st={queries:0,errors:0,lastError:null,lastErrorAt:0,connects:0};
  const pool=new Pool({connectionString:cleanUrl(url),max:opts.max||+process.env.DB_POOL||5,idleTimeoutMillis:30000,connectionTimeoutMillis:8000,statement_timeout:15000,ssl,
    types:{getTypeParser:(oid,fmt)=>oid===20?Number:types.getTypeParser(oid,fmt)}});
  pool.on('error',e=>{st.errors++;st.lastError=redact(e.message);st.lastErrorAt=Date.now()}); // clienți idle căzuți: nu crăpăm procesul
  pool.on('connect',()=>{st.connects++});
  const q=async(text,params)=>{st.queries++;try{return await pool.query(text,params)}catch(e){st.errors++;st.lastError=redact(e.message);st.lastErrorAt=Date.now();e.message=redact(e.message);throw e}};
  async function tx(fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r}catch(e){try{await c.query('ROLLBACK')}catch(x){}e.message=redact(e.message);throw e}finally{c.release()}}

  // ---- migrare (idempotentă, sub advisory lock, tranzacțională) ----
  {const c=await pool.connect();
   try{await c.query('SELECT pg_advisory_lock(746100)');
     await c.query(`CREATE SCHEMA IF NOT EXISTS ${S}`);
     await c.query(`CREATE TABLE IF NOT EXISTS ${T('schema_migrations')}(v int PRIMARY KEY,applied bigint NOT NULL)`);
     const done=new Set((await c.query(`SELECT v FROM ${T('schema_migrations')}`)).rows.map(r=>r.v));
     // Never run CREATE TABLE migrations against a pre-existing schema with untracked tables.
     if(!done.has(1)){
       const existing=await c.query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname=$1 AND tablename=ANY($2::text[])`,[schema,['accounts','characters','guilds']]);
       if(existing.rows.length)throw new Error('Existing NIDRAVEN tables require an explicit non-destructive migration; automatic bootstrap refused');
     }
     for(const m of migrations(S,schema)){if(done.has(m.v))continue;
       await c.query('BEGIN');try{await c.query(m.sql);await c.query(`INSERT INTO ${T('schema_migrations')}(v,applied) VALUES($1,$2)`,[m.v,Date.now()]);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}}
   }catch(e){e.message=redact(e.message);throw e}
   finally{try{await c.query('SELECT pg_advisory_unlock(746100)')}catch(x){}c.release()}}

  let lastPurge=0;const one=r=>r.rows[0]||null;
  const DUMMY='00'.repeat(16);
  return{
    kind:'postgres',schema,raw:pool,isTransient,
    ping:async()=>{await q('SELECT 1');return true},
    stats:()=>({kind:'postgres',schema,pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount,max:pool.options.max},...st}),
    counts:async()=>{const r=one(await q(`SELECT (SELECT count(*) FROM ${T('accounts')}) a,(SELECT count(*) FROM ${T('characters')}) c,(SELECT count(*) FROM ${T('accounts')} WHERE banned_until>$1) b`,[Date.now()]));return{accounts:+r.a,characters:+r.c,banned:+r.b}},
    accInfo:async id=>one(await q(`SELECT id,name,role,banned_until,muted_until FROM ${T('accounts')} WHERE id=$1`,[id])),
    charByName:async n=>one(await q(`SELECT id,account_id,name FROM ${T('characters')} WHERE name_lc=$1`,[String(n).toLowerCase()])),
    setBan:async(id,u)=>{await q(`UPDATE ${T('accounts')} SET banned_until=$1 WHERE id=$2`,[u,id])},
    setMute:async(id,u)=>{await q(`UPDATE ${T('accounts')} SET muted_until=$1 WHERE id=$2`,[u,id])},
    audits:async n=>(await q(`SELECT ts,account_id,kind,detail FROM ${T('audit')} ORDER BY id DESC LIMIT $1`,[n|0])).rows,
    async createGuild(name,tag,charId){ // atomic: ghilda + liderul, sau nimic
      try{return await tx(async c=>{const r=await c.query(`INSERT INTO ${T('guilds')}(name,name_lc,tag,created) VALUES($1,$2,$3,$4) RETURNING id`,[name,name.toLowerCase(),tag,Date.now()]);const gid=r.rows[0].id;
        await c.query(`INSERT INTO ${T('guild_members')}(guild_id,char_id,guild_rank,joined) VALUES($1,$2,'LEADER',$3)`,[gid,charId,Date.now()]);return gid})}
      catch(e){if(e.code==='23505'||e.code==='23503')return 0;throw e}},
    guildOf:async cid=>one(await q(`SELECT g.id,g.name,g.tag,m.guild_rank AS rank FROM ${T('guild_members')} m JOIN ${T('guilds')} g ON g.id=m.guild_id WHERE m.char_id=$1`,[cid])),
    guildMembers:async gid=>(await q(`SELECT c.id,c.name,m.guild_rank AS rank FROM ${T('guild_members')} m JOIN ${T('characters')} c ON c.id=m.char_id WHERE m.guild_id=$1 ORDER BY m.joined`,[gid])).rows,
    async addGuildMember(gid,cid){try{await q(`INSERT INTO ${T('guild_members')}(guild_id,char_id,guild_rank,joined) VALUES($1,$2,'MEMBER',$3)`,[gid,cid,Date.now()]);return 1}catch(e){if(e.code==='23505'||e.code==='23503')return 0;throw e}},
    removeGuildMember:async cid=>{await q(`DELETE FROM ${T('guild_members')} WHERE char_id=$1`,[cid])},
    setGuildRank:async(cid,r)=>{await q(`UPDATE ${T('guild_members')} SET guild_rank=$1 WHERE char_id=$2`,[r,cid])},
    deleteGuild:async gid=>{await q(`DELETE FROM ${T('guilds')} WHERE id=$1`,[gid])},
    setRole:async(accId,role)=>{await q(`UPDATE ${T('accounts')} SET role=$1 WHERE id=$2`,[role,accId])},
    role:async accId=>{const r=one(await q(`SELECT role FROM ${T('accounts')} WHERE id=$1`,[accId]));return r?r.role:'PLAYER'},
    async register(name,pw){const salt=crypto.randomBytes(16).toString('hex'),h=await hashPw(pw,salt);
      try{return one(await q(`INSERT INTO ${T('accounts')}(name,name_lc,salt,hash,created) VALUES($1,$2,$3,$4,$5) RETURNING id`,[name,name.toLowerCase(),salt,h,Date.now()])).id}catch(e){if(e.code==='23505')return 0;throw e}},
    async verify(name,pw){const a=one(await q(`SELECT * FROM ${T('accounts')} WHERE name_lc=$1`,[name.toLowerCase()]));
      const h=Buffer.from(await hashPw(pw,a?a.salt:DUMMY),'hex'); // calculăm hash și pentru cont inexistent (fără oracol de timp)
      if(!a)return null;return crypto.timingSafeEqual(h,Buffer.from(a.hash,'hex'))?a:null},
    async newSession(accId){const t=crypto.randomBytes(32).toString('hex'),now=Date.now();
      await q(`INSERT INTO ${T('sessions')}(token_hash,account_id,expires) VALUES($1,$2,$3)`,[sha(t),accId,now+7*864e5]);
      if(now-lastPurge>60000){lastPurge=now;q(`DELETE FROM ${T('sessions')} WHERE expires<$1`,[now]).catch(()=>{})}return t},
    async session(t){if(typeof t!=='string'||t.length!==64)return null;const s=one(await q(`SELECT s.account_id,s.expires,a.name,a.role FROM ${T('sessions')} s JOIN ${T('accounts')} a ON a.id=s.account_id WHERE s.token_hash=$1`,[sha(t)]));return s&&s.expires>Date.now()?s:null},
    endSession:async t=>{await q(`DELETE FROM ${T('sessions')} WHERE token_hash=$1`,[sha(t)])},
    chars:async id=>(await q(`SELECT id,name,cls,lv,zone FROM ${T('characters')} WHERE account_id=$1 ORDER BY id`,[id])).rows,
    async char(id,acc){const r=one(await q(`SELECT * FROM ${T('characters')} WHERE id=$1 AND account_id=$2`,[id,acc]));if(r){r.inv=JSON.stringify(r.inv);r.cosm=JSON.stringify(r.cosm)}return r}, // proprietate verificată prin account_id
    async addChar(acc,name,cls,hp,mp,zone,x,y){try{return await tx(async c=>{
      // Serializare la nivelul contului, inclusiv între procese diferite.
      await c.query('SELECT pg_advisory_xact_lock($1::integer,$2::integer)',[746101,Number(acc)]);
      const count=await c.query(`SELECT count(*)::integer AS n FROM ${T('characters')} WHERE account_id=$1`,[acc]);
      if(count.rows[0].n>=3)return -1;
      const r=await c.query(`INSERT INTO ${T('characters')}(account_id,name,name_lc,cls,hp,mp,zone,x,y,updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[acc,name,name.toLowerCase(),cls,hp,mp,zone,x,y,Date.now()]);return r.rows[0].id;
    })}catch(e){if(e.code==='23505')return 0;throw e}},
    // snap = instantaneu (clonat) al personajului; WHERE include account_id => nu se poate scrie peste personajul altui cont
    async saveChar(s){const r=await q(`UPDATE ${T('characters')} SET lv=$1,xp=$2,gold=$3,hp=$4,mp=$5,zone=$6,x=$7,y=$8,inv=$9::jsonb,updated=$10,kills=$11,bosskills=$12,cosm=$13::jsonb WHERE id=$14 AND account_id=$15`,
      [s.lv,s.xp,s.gold,Math.round(s.hp),Math.round(s.mp),s.zone,s.x,s.y,JSON.stringify(s.inv),Date.now(),s.kills|0,s.bosskills|0,JSON.stringify(s.cosm||{}),s.id,s.acc]);return r.rowCount},
    blocks:async id=>(await q(`SELECT blocked_lc FROM ${T('blocks')} WHERE char_id=$1`,[id])).rows.map(r=>r.blocked_lc),
    addBlock:async(id,n)=>{await q(`INSERT INTO ${T('blocks')}(char_id,blocked_lc) VALUES($1,$2) ON CONFLICT DO NOTHING`,[id,n])},
    delBlock:async(id,n)=>{await q(`DELETE FROM ${T('blocks')} WHERE char_id=$1 AND blocked_lc=$2`,[id,n])},
    log:async(ch,f,t,m)=>{await q(`INSERT INTO ${T('chat_log')}(ts,ch,from_name,to_name,msg) VALUES($1,$2,$3,$4,$5)`,[Date.now(),ch,f,t||null,m])},
    audit:async(acc,kind,d)=>{await q(`INSERT INTO ${T('audit')}(ts,account_id,kind,detail) VALUES($1,$2,$3,$4)`,[Date.now(),acc||null,kind,d?String(d).slice(0,300):null])},
    async close(){try{await pool.end()}catch(e){}},
  };
}
module.exports={open,isTransient,redact};
