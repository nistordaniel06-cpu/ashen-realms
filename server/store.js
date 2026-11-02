'use strict';
// NIDRAVEN V10 — strat de persistență deasupra adaptorului async (SQLite sau PostgreSQL).
//  * salvări per personaj: SERIALIZATE (maxim una în zbor) și COALESCATE (rămâne doar ultimul instantaneu)
//  * retry cu backoff exponențial numai pentru erori tranzitorii; erorile permanente se raportează, nu se maschează
//  * flush(id)/flushAll() pentru logout, reconectare rapidă și shutdown
//  * lacăt per personaj (withLock) + epoch per sesiune: o salvare veche nu poate suprascrie o sesiune mai nouă
//  * cache scurt pentru informații de cont accesate frecvent (rol/ban/mute), invalidat la scriere
//  * audit/log/blocks nu blochează gameplay-ul: erorile lor sunt numărate și păstrate într-un inel de erori
function createStore(adb,o={}){
  const RETRIES=o.retries??4,BASE=o.baseMs??120,CAP=o.capMs??2000,TTL=o.cacheMs??5000;
  const stats={saved:0,coalesced:0,retries:0,failed:0,dropped:0,lastMs:0,maxMs:0,lastError:null,sideFail:0,cacheHit:0,cacheMiss:0};
  const errors=[];const logErr=(kind,e)=>{const m=String((e&&e.message)||e).slice(0,200);stats.lastError=m;errors.push({ts:Date.now(),kind,m});if(errors.length>50)errors.shift()};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const q=new Map(),locks=new Map(),epochs=new Map();

  async function withRetry(fn,what){
    for(let i=0;;i++){
      try{return await fn()}
      catch(e){
        if(i>=RETRIES||!adb.isTransient(e)){logErr(what,e);throw e}
        stats.retries++;await sleep(Math.min(CAP,BASE*2**i)*(0.75+Math.random()*.5));
      }
    }
  }
  async function pump(id,e){
    e.run=true;
    while(e.pend){
      const s=e.pend;e.pend=null;const ws=e.waiters;e.waiters=[];let ok=false;const t0=Date.now();
      if(s.epoch<(epochs.get(id)||0)){stats.dropped++;ok=true} // instantaneu al unei sesiuni depășite: nu se scrie
      else{try{await withRetry(()=>adb.saveChar(s),'save');ok=true;stats.saved++}catch(err){stats.failed++}}
      const d=Date.now()-t0;stats.lastMs=d;if(d>stats.maxMs)stats.maxMs=d;
      for(const w of ws)w(ok);
    }
    e.run=false;q.delete(id);for(const r of e.idle)r();
  }
  /** Pune un instantaneu în coadă. Promisiunea se rezolvă (true/false) când ESTE SCRIS el sau unul mai nou. Nu aruncă niciodată. */
  function save(snap){
    let e=q.get(snap.id);if(!e){e={run:false,pend:null,waiters:[],idle:[]};q.set(snap.id,e)}
    if(e.pend)stats.coalesced++;e.pend=snap;
    return new Promise(res=>{e.waiters.push(res);if(!e.run)pump(snap.id,e)});
  }
  const flush=id=>{const e=q.get(id);return e?new Promise(r=>e.idle.push(r)):Promise.resolve()};
  const flushAll=async()=>{while(q.size)await Promise.all([...q.values()].map(e=>new Promise(r=>e.idle.push(r))))};
  async function withLock(id,fn){
    const prev=locks.get(id)||Promise.resolve();let rel;const mine=new Promise(r=>rel=r);const tail=prev.then(()=>mine);locks.set(id,tail);
    await prev;try{return await fn()}finally{rel();if(locks.get(id)===tail)locks.delete(id)}
  }
  const nextEpoch=id=>{const n=(epochs.get(id)||0)+1;epochs.set(id,n);return n};

  /* instantaneu clonat al jucătorului: ce se scrie nu mai depinde de mutațiile ulterioare */
  const snap=p=>({id:p.id,acc:p.acc,epoch:p.epoch||0,lv:p.lv,xp:p.xp,gold:p.gold,hp:p.hp,mp:p.mp,zone:p.zone,x:p.x,y:p.y,inv:p.inv.map(s=>({...s})),kills:p.kills|0,bosskills:p.bosskills|0,cosm:JSON.parse(JSON.stringify(p.cosm||{}))});

  /* cache cont */
  const cache=new Map();
  const inval=id=>cache.delete(id);
  async function accInfo(id){const c=cache.get(id),now=Date.now();if(c&&c.exp>now){stats.cacheHit++;return c.v}stats.cacheMiss++;const v=await adb.accInfo(id);if(v)cache.set(id,{v,exp:now+TTL});return v}
  const side=fn=>(...a)=>{try{return Promise.resolve(fn(...a)).catch(e=>{stats.sideFail++;logErr('side',e)})}catch(e){stats.sideFail++;logErr('side',e);return Promise.resolve()}};

  const db=Object.assign({},adb,{
    accInfo,
    role:async id=>{const a=await accInfo(id);return a?a.role:'PLAYER'},
    setBan:async(id,u)=>{await adb.setBan(id,u);inval(id)},
    setMute:async(id,u)=>{await adb.setMute(id,u);inval(id)},
    setRole:async(id,r)=>{await adb.setRole(id,r);inval(id)},
    audit:side((...a)=>adb.audit(...a)),log:side((...a)=>adb.log(...a)),
    addBlock:side((...a)=>adb.addBlock(...a)),delBlock:side((...a)=>adb.delBlock(...a)),
  });
  delete db.saveChar; // toate salvările trec prin store.save()

  return{db,adb,save,snap,flush,flushAll,withLock,nextEpoch,errors,logErr,
    stats:()=>({...stats,queued:q.size,db:adb.stats?adb.stats():{kind:adb.kind}})};
}
module.exports={createStore};
