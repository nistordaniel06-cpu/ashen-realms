'use strict';
// NIDRAVEN V10 — teste de persistență. Partea 1: store.js cu adaptor fals (fără DB). Partea 2: PostgreSQL REAL + clienți WebSocket reali.
// Rulează cu TEST_DATABASE_URL (ex. postgres://postgres@127.0.0.1:54329/postgres). Creează o schemă proprie "nidraven_t_*" și o șterge la final.
// Nu atinge nicio altă schemă. Fără TEST_DATABASE_URL, partea 2 NU rulează (se raportează explicit ca SĂRITĂ, nu ca trecută).
const WebSocket=require('ws'),http=require('http');
const {createStore}=require('./store.js'),PG=require('./db-postgres.js');
let pass=0,fail=0;const out=[];
const ok=(c,m)=>{if(c){pass++;out.push('  ok   '+m)}else{fail++;out.push('  FAIL '+m)}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const snapOf=(id,xp,epoch=0)=>({id,acc:1,epoch,lv:1,xp,gold:0,hp:10,mp:5,zone:'village',x:1,y:1,inv:[],kills:0,bosskills:0,cosm:{}});

/* ================= PARTEA 1 — store.js (adaptor fals) ================= */
async function partOne(){
  const mkFake=(o={})=>{const f={kind:'fake',calls:[],cur:new Map(),maxPer:0,maxAll:0,all:0,isTransient:e=>!!e.transient,
    async saveChar(s){f.calls.push(s);f.all++;f.maxAll=Math.max(f.maxAll,f.all);const n=(f.cur.get(s.id)||0)+1;f.cur.set(s.id,n);f.maxPer=Math.max(f.maxPer,n);
      try{if(o.delay)await sleep(o.delay);if(o.fail)await o.fail(f.calls.length)}finally{f.cur.set(s.id,n-1);f.all--}},
    async accInfo(id){f.accN=(f.accN||0)+1;return{id,role:'PLAYER',banned_until:0,muted_until:0}},async setBan(){},async setMute(){},async setRole(){},async audit(){throw new Error('audit down')},async log(){},async addBlock(){},async delBlock(){}};return f};
  {const f=mkFake({delay:15}),st=createStore(f,{baseMs:5});
   const ps=[];for(let i=0;i<50;i++)ps.push(st.save(snapOf(7,i)));const rs=await Promise.all(ps);
   ok(rs.every(Boolean),'store: toate cele 50 de cereri de salvare se rezolvă cu succes');
   ok(f.calls.length<=3&&f.calls[f.calls.length-1].xp===49,'store: coalescing — 50 salvări rapide => '+f.calls.length+' scrieri, ultima conține valoarea finală (49)');
   ok(f.maxPer===1,'store: serializare — niciodată două scrieri simultane pentru același personaj');
   const f2=mkFake({delay:30}),s2=createStore(f2);await Promise.all([s2.save(snapOf(1,1)),s2.save(snapOf(2,1)),s2.save(snapOf(3,1))]);
   ok(f2.maxAll>=2,'store: personaje diferite se salvează în paralel (max simultan '+f2.maxAll+')')}
  {let n=0;const f=mkFake({fail:async()=>{if(++n<=2){const e=new Error('conn reset');e.transient=1;throw e}}}),st=createStore(f,{baseMs:5});
   const r=await st.save(snapOf(1,5));ok(r===true&&st.stats().retries===2&&st.stats().saved===1,'retry: 2 erori tranzitorii => reușește la a 3-a încercare (retries='+st.stats().retries+')')}
  {const f=mkFake({fail:async()=>{throw new Error('violates constraint')}}),st=createStore(f,{baseMs:5});
   const r=await st.save(snapOf(1,5));ok(r===false&&f.calls.length===1&&st.stats().failed===1,'retry: eroare permanentă NU se reîncearcă și se raportează (false)')}
  {const f=mkFake({fail:async()=>{const e=new Error('down');e.transient=1;throw e}}),st=createStore(f,{baseMs:2,retries:3});
   const r=await st.save(snapOf(1,5));ok(r===false&&f.calls.length===4,'retry: eroare tranzitorie persistentă se oprește după 1+3 încercări ('+f.calls.length+')')}
  {const f=mkFake({delay:5}),st=createStore(f);const e1=st.nextEpoch(9);const r=await st.save(snapOf(9,1,e1));const e2=st.nextEpoch(9);
   await st.save(snapOf(9,2,e1));ok(r&&e2===e1+1&&f.calls.length===1&&st.stats().dropped===1,'epoch: salvarea unei sesiuni depășite este ignorată (nu suprascrie sesiunea nouă)')}
  {const f=mkFake({delay:40}),st=createStore(f);const t0=Date.now();st.save(snapOf(4,1));st.save(snapOf(4,2));await st.flush(4);
   ok(f.calls[f.calls.length-1].xp===2&&Date.now()-t0>=70,'flush(id) așteaptă salvarea în zbor + pe cea coalescată');
   st.save(snapOf(5,1));st.save(snapOf(6,1));await st.flushAll();ok(f.calls.some(c=>c.id===5)&&f.calls.some(c=>c.id===6),'flushAll() așteaptă toate salvările')}
  {const f=mkFake(),st=createStore(f);const order=[];const a=st.withLock(1,async()=>{order.push('a1');await sleep(30);order.push('a2')}),b=st.withLock(1,async()=>{order.push('b1')});await Promise.all([a,b]);
   ok(order.join()==='a1,a2,b1','withLock: operațiile pe același personaj rulează una după alta')}
  {const f=mkFake(),st=createStore(f,{cacheMs:200});await st.db.accInfo(5);await st.db.accInfo(5);await st.db.setBan(5,1);await st.db.accInfo(5);
   ok(f.accN===2,'cache: a doua citire din cache; după setBan cache-ul e invalidat ('+f.accN+' citiri DB)');
   const r=st.db.audit(1,'x');await r;ok(r instanceof Promise&&st.stats().sideFail===1&&st.errors.length>=1,'audit: eroarea DB nu aruncă în gameplay, e numărată și păstrată în inelul de erori')}
}

/* ================= PARTEA 2 — PostgreSQL real ================= */
class C{constructor(url,name){this.name=name;this.msgs=[];this.snap=null;this.chat=[];this.errs=[];this.closed=false;this.closeCode=0;this.ws=new WebSocket(url);
  this.ws.on('message',b=>{const m=JSON.parse(b);this.msgs.push(m);if(m.t==='snap')this.snap=m;if(m.t==='chat')this.chat.push(m);if(m.t==='err')this.errs.push(m);if(m.t==='inv')this.inv=m;if(m.t==='joined')this.joined=m;if(m.t==='auth')this.auth=m;if(m.t==='chars')this.chars=m.chars});
  this.ws.on('close',c=>{this.closed=true;this.closeCode=c});this.ws.on('error',()=>{})}
  open(){return new Promise(r=>this.ws.on('open',r))}
  send(o){this.ws.send(JSON.stringify(o))}
  async until(f,ms=4000){const t=Date.now();while(Date.now()-t<ms){const v=f();if(v)return v;await sleep(15)}return null}
}
const mk=async(url,name)=>{const c=new C(url,name);await c.open();return c};
async function hero(url,user,name,cls){const c=await mk(url,name);c.send({t:'reg',u:user,p:'parola-sigura-1'});await c.until(()=>c.auth);c.send({t:'newchar',n:name,cls});await c.until(()=>c.chars);c.cid=c.chars[0].id;c.send({t:'join',id:c.cid});await c.until(()=>c.joined&&c.snap);return c}
const httpGet=(port,p)=>new Promise(r=>http.get({host:'127.0.0.1',port,path:p},res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>r({status:res.statusCode,body:b}))}).on('error',e=>r({status:0,body:String(e)})));

async function partTwo(URL0){
  const {Client}=require('pg');const {start}=require('./server.js');
  const schema='nidraven_t_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);process.env.DB_SCHEMA=schema;
  // URL cu o "parolă" marker: pe loopback (trust) e ignorată, dar ne permite să verificăm că nu apare în loguri/erori
  const MARK='S3cretMARKER9';const u=new URL(URL0);if(!u.password)u.password=MARK;const URLM=u.toString();
  const admin=new Client({connectionString:URL0});await admin.connect();
  const logs=[];const oLog=console.log,oErr=console.error,oWarn=console.warn;
  const cap=(...a)=>logs.push(a.map(x=>x&&x.stack?x.stack:String(x)).join(' '));console.error=cap;console.warn=cap;
  const tablesOutside=async()=>(await admin.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_schema<>$1",[schema])).rows[0].n;
  const outside0=await tablesOutside();
  let S=null;
  try{
    /* ---- adaptor: migrare, parametrizare, proprietate, tranzacții ---- */
    const a1=await PG.open({url:URLM,schema});const a1b=await PG.open({url:URLM,schema});
    const mig=(await admin.query(`SELECT count(*)::int n FROM "${schema}".schema_migrations`)).rows[0].n;
    ok(mig===1,'PG adaptor: migrarea e idempotentă (a doua deschidere nu o reaplică), versiuni='+mig);
    const tabs=(await admin.query("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname=$1",[schema])).rows;
    ok(tabs.length>=10&&tabs.filter(t=>t.tablename!=='schema_migrations').every(t=>t.rowsecurity),'PG schema: '+tabs.length+' tabele în schema privată, RLS activ pe toate tabelele de joc');
    ok(await tablesOutside()===outside0,'PG schema: NICIun tabel creat/modificat în afara schemei private (altele: '+outside0+' neschimbate)');
    const evil="x'); DROP TABLE accounts;--";const idE=await a1.register(evil,'parola-sigura-1');
    ok(idE>0&&(await a1.verify(evil,'parola-sigura-1'))&&!(await a1.verify(evil,'gresita-123')),'PG: interogările sunt parametrizate — nume cu SQL injection se stochează ca date, tabelele rămân intacte');
    ok((await a1.register(evil.toUpperCase(),'parola-sigura-1'))===0,'PG: nume de cont duplicat (case-insensitive) => 0, fără excepție');
    const accA=await a1.register('adaptA','parola-sigura-1'),accB=await a1.register('adaptB','parola-sigura-1');
    const cA=await a1.addChar(accA,'ErouA',1,100,50,'village',5.123456789,6.987654321);ok(cA>0&&(await a1.addChar(accB,'eroua',1,100,50,'village',1,1))===0,'PG: nume erou unic (case-insensitive)');
    ok((await a1.char(cA,accB))===null&&(await a1.char(cA,accA))!==null,'PG: personajul unui cont NU poate fi citit de alt cont (account_id)');
    const base={id:cA,acc:accB,lv:9,xp:99,gold:999,hp:1,mp:1,zone:'forest',x:1,y:1,inv:[{id:'x',n:1}],kills:0,bosskills:0,cosm:{}};
    ok((await a1.saveChar(base))===0&&(await a1.char(cA,accA)).gold===0,'PG: salvarea cu account_id greșit nu modifică nimic (0 rânduri)');
    await a1.saveChar({...base,acc:accA,x:5.123456789,y:6.987654321});const rr=await a1.char(cA,accA);
    ok(rr.gold===999&&rr.lv===9&&rr.x===5.123456789&&JSON.parse(rr.inv)[0].id==='x'&&typeof rr.gold==='number','PG: salvare+citire exactă (double precision, bigint→Number, jsonb)');
    // tranzacție: ghilda + lider atomic; la eșec nu rămâne ghildă orfană
    const g0=(await admin.query(`SELECT count(*)::int n FROM "${schema}".guilds`)).rows[0].n;
    const gBad=await a1.createGuild('Orfana','OR',99999999);const g1=(await admin.query(`SELECT count(*)::int n FROM "${schema}".guilds`)).rows[0].n;
    ok(gBad===0&&g1===g0,'PG: createGuild e atomic — liderul inexistent => ROLLBACK, nicio ghildă orfană');
    const gid=await a1.createGuild('Cenușa Vie','CV',cA);ok(gid>0&&(await a1.guildOf(cA)).rank==='LEADER'&&(await a1.createGuild('cenușa vie','XX',cA))===0,'PG: ghildă creată atomic; nume duplicat refuzat');
    ok((await a1.ping())===true&&(await a1.counts()).accounts>=3,'PG: ping + counts');
    // erori nu scurg secretul
    let leak='';try{const bad=await PG.open({url:'postgres://postgres:'+MARK+'@127.0.0.1:1/postgres',schema});await bad.close()}catch(e){leak=e.message+' '+(e.stack||'')}
    ok(leak.length>0&&!leak.includes(MARK),'secrete: eroarea de conectare NU conține parola din DATABASE_URL');
    await a1b.close();

    /* ---- server real pe PG ---- */
    S=await start({port:0,databaseUrl:URLM,host:'127.0.0.1',saveMs:400});const W=S.world,WS='ws://127.0.0.1:'+S.port;const P=n=>[...W.players.values()].find(p=>p.name===n);
    ok(S.adb.kind==='postgres'&&S.adb.schema===schema,'server: rulează pe adaptorul PostgreSQL (schema '+schema+')');
    const h=await httpGet(S.port,'/health'),rd=await httpGet(S.port,'/ready');
    ok(h.status===200&&JSON.parse(h.body).db==='postgres'&&rd.status===200&&JSON.parse(rd.body).ready===1,'/health și /ready răspund 200 (DB verificat de /ready)');
    ok(!h.body.includes(MARK)&&!rd.body.includes(MARK),'secrete: /health și /ready nu expun date de conectare');

    // două conturi, aceeași zonă, mișcare sincronizată
    const A=await hero(WS,'Alina','Alina',1),B=await hero(WS,'Bogdan','Bogdan',2);
    await A.until(()=>A.snap&&A.snap.pl.some(q=>q.n==='Bogdan'));ok(A.snap.pl.some(q=>q.n==='Bogdan')&&B.snap.pl.some(q=>q.n==='Alina'),'două conturi apar simultan în aceeași zonă (PG)');
    const pb=P('Bogdan');const bx0=pb.x;B.send({t:'in',dx:1,dy:0,seq:1});await sleep(700);B.send({t:'in',dx:0,dy:0,seq:2});await sleep(150);
    const seenB=A.snap.pl.find(q=>q.n==='Bogdan');ok(P('Bogdan').x>bx0+1&&seenB&&Math.abs(seenB.x-P('Bogdan').x)<1.5,'mișcarea lui Bogdan (server) e vizibilă pentru Alina ('+bx0.toFixed(1)+'→'+P('Bogdan').x.toFixed(1)+')');

    // persistență separată pe cont
    const pa=P('Alina');pa.gold=1234;pa.xp=77;pa.lv=3;pa.inv=[{id:'pot',n:4},{id:'ore',n:7}];pa.dirty=1;pb.gold=55;pb.xp=5;pb.lv=2;pb.inv=[{id:'herb',n:2}];pb.x=10.5;pb.y=11.5;pb.dirty=1;
    await sleep(900);
    const dbA=await S.adb.char(A.cid,A.auth?(await S.adb.session(A.auth.tok)).account_id:0),dbB=await S.adb.char(B.cid,(await S.adb.session(B.auth.tok)).account_id);
    ok(dbA.gold===1234&&dbA.xp===77&&dbA.lv===3&&JSON.parse(dbA.inv).length===2,'salvare periodică: contul Alina în PG (gold/xp/lv/inventar)');
    ok(dbB.gold===55&&dbB.xp===5&&dbB.lv===2&&JSON.parse(dbB.inv)[0].id==='herb'&&Math.abs(dbB.x-10.5)<.01,'salvare periodică: contul Bogdan separat, fără amestec (gold=55, poziție)');
    // restart server (shutdown cu flush) apoi reconectare
    pa.gold=4321;pa.dirty=0; // modificare nesalvată încă: shutdown-ul trebuie să facă flush
    await S.close();S=null;
    S=await start({port:0,databaseUrl:URLM,host:'127.0.0.1',saveMs:400});const WS2='ws://127.0.0.1:'+S.port,W2=S.world;
    const A2=await mk(WS2,'A2');A2.send({t:'login',u:'Alina',p:'parola-sigura-1'});await A2.until(()=>A2.auth);A2.send({t:'join',id:A2.auth.chars[0].id});await A2.until(()=>A2.joined);
    const q=[...W2.players.values()].find(p=>p.name==='Alina');
    ok(q&&q.gold===4321&&q.xp===77&&q.lv===3&&q.inv.length===2,'restart server: shutdown a făcut flush — Alina are aur 4321 / xp 77 / nivel 3 / inventar după repornire');
    const B2=await mk(WS2,'B2');B2.send({t:'login',u:'Bogdan',p:'parola-sigura-1'});await B2.until(()=>B2.auth);B2.send({t:'join',id:B2.auth.chars[0].id});await B2.until(()=>B2.joined);
    const q2=[...W2.players.values()].find(p=>p.name==='Bogdan');ok(q2&&q2.gold===55&&q2.zone&&Math.abs(q2.x-10.5)<.01&&q2.inv[0].id==='herb','restart server: Bogdan își păstrează propriul progres și poziția');
    ok(A2.joined.me.gold===4321,'restart: clientul primește aurul corect în mesajul "joined"');

    // acces neautorizat
    const B2b=await mk(WS2,'B2b');B2b.send({t:'tok',tok:B2.auth.tok});await B2b.until(()=>B2b.auth);B2b.send({t:'join',id:A2.auth.chars[0].id});await sleep(250);
    ok(B2b.errs.some(e=>e.c==='char')&&!B2b.joined&&[...W2.players.values()].filter(p=>p.name==='Alina').length===1,'acces neautorizat: Bogdan (autentificat) nu poate intra cu personajul Alinei');
    const intruder=await mk(WS2,'X');intruder.send({t:'join',id:A2.auth.chars[0].id});await sleep(200);ok(intruder.errs.some(e=>e.c==='auth'),'acces neautorizat: join fără autentificare respins');
    intruder.send({t:'tok',tok:'0'.repeat(64)});await sleep(200);ok(intruder.errs.some(e=>e.c==='auth'&&/Sesiune/.test(e.m)),'token fals respins');

    // două sesiuni concurente pe același erou
    const A3=await mk(WS2,'A3');A3.send({t:'tok',tok:A2.auth.tok});await A3.until(()=>A3.auth);A3.send({t:'join',id:A2.auth.chars[0].id});await A3.until(()=>A3.joined);await sleep(150);
    ok(A2.errs.some(e=>e.c==='dup')&&[...W2.players.values()].filter(p=>p.name==='Alina').length===1,'două sesiuni concurente: a doua o înlocuiește pe prima, un singur personaj în lume (fără fantomă)');

    // logout/login rapid: 10 cicluri, cu salvare ÎNCETINITĂ artificial (150ms) ca să existe cursă reală
    await S.close();
    const slow=await PG.open({url:URLM,schema});const realSave=slow.saveChar.bind(slow);slow.saveChar=async s=>{await sleep(150);return realSave(s)};
    S=await start({port:0,adb:slow,host:'127.0.0.1',saveMs:60000});const WS3='ws://127.0.0.1:'+S.port,W3=S.world;
    const tokB=(await (async()=>{const c=await mk(WS3,'t');c.send({t:'login',u:'Bogdan',p:'parola-sigura-1'});await c.until(()=>c.auth);c.ws.terminate();return c.auth})());
    let expect=55,stale=0,cur=null;
    const reconnect=async()=>{const c=await mk(WS3,'r');c.send({t:'tok',tok:tokB.tok});c.send({t:'join',id:tokB.chars[0].id}); // pipeline: fără așteptare între auth și join
      await c.until(()=>c.joined,5000);return c};
    cur=await reconnect();
    for(let i=0;i<10;i++){const p=[...W3.players.values()].find(x=>x.name==='Bogdan');if(!p){stale+=100;break}
      if(p.gold!==expect)stale++;p.gold+=1;expect+=1;cur.ws.terminate();cur=await reconnect()}
    const pf=[...W3.players.values()].find(x=>x.name==='Bogdan');
    ok(stale===0&&pf&&pf.gold===65,'logout/login rapid ×10 cu salvare lentă (150ms): niciun progres pierdut sau vechi (gold final '+(pf&&pf.gold)+', așteptat 65, stale='+stale+')');
    // anti-duplicare inventar: folosesc o poțiune și mă reconectez imediat
    {const p=[...W3.players.values()].find(x=>x.name==='Bogdan');p.inv=[{id:'pot',n:3}];p.hp=1;await S.store.save(S.store.snap(p)); // DB conține pot×3
      cur.send({t:'use',slot:0});await sleep(60);const after=p.inv.find(s=>s.id==='pot');const nAfter=after?after.n:0;
      cur.ws.terminate();cur=await reconnect();const p2=[...W3.players.values()].find(x=>x.name==='Bogdan');const n2=(p2.inv.find(s=>s.id==='pot')||{n:0}).n;
      ok(nAfter===2&&n2===2,'anti-duplicare: poțiune folosită apoi reconectare imediată => inventarul rămâne pot×2 (nu revine la ×3)')}
    // CONTROL NEGATIV: fără protecția flush testul trebuie să observe bug-ul (dovedește că testul e relevant)
    {const realFlush=S.store.flush;S.store.flush=async()=>{};const p=[...W3.players.values()].find(x=>x.name==='Bogdan');p.hp=1;p.inv=[{id:'pot',n:3}];await S.store.save(S.store.snap(p));
      cur.send({t:'use',slot:0});await sleep(60);cur.ws.terminate();cur=await reconnect();const p2=[...W3.players.values()].find(x=>x.name==='Bogdan');const n2=(p2.inv.find(s=>s.id==='pot')||{n:0}).n;S.store.flush=realFlush;
      ok(n2===3,'control negativ: cu protecția dezactivată bug-ul de duplicare APARE (pot×'+n2+') => testul de mai sus este valid');
      await sleep(400);const pz=[...W3.players.values()].find(x=>x.name==='Bogdan');pz.inv=[{id:'herb',n:1}]}
    cur.ws.terminate();await sleep(500);

    // GM: cu și fără permisiuni (PG)
    const GMa=await mk(WS3,'Gigi');GMa.send({t:'reg',u:'Gigi',p:'parola-sigura-1'});await GMa.until(()=>GMa.auth);GMa.send({t:'newchar',n:'Gigi',cls:3});await GMa.until(()=>GMa.chars);GMa.cid=GMa.chars[0].id;
    await S.store.db.setRole((await S.adb.session(GMa.auth.tok)).account_id,'GAME_MASTER'); // rolul se acordă înainte de join
    GMa.send({t:'join',id:GMa.cid});await GMa.until(()=>GMa.joined&&GMa.snap);
    const Pl=await hero(WS3,'Paul','Paul',1);
    Pl.send({t:'chat',ch:'local',m:'/announce fals de la jucator'});await sleep(250);
    ok(!GMa.chat.some(m=>/fals de la/.test(m.m||''))&&Pl.chat.some(m=>/permisiunea/.test(m.m||'')),'GM (PG): jucătorul obișnuit NU poate folosi /announce');
    GMa.send({t:'chat',ch:'local',m:'/announce Salut din PG'});await sleep(300);
    ok(Pl.chat.some(m=>m.from==='Anunț'&&/Salut din PG/.test(m.m)),'GM (PG): Game Master poate folosi /announce');
    Pl.send({t:'chat',ch:'local',m:'/setrole Paul FOUNDER'});await sleep(250);
    ok((await S.adb.role((await S.adb.session(Pl.auth.tok)).account_id))==='PLAYER','GM (PG): jucătorul nu își poate acorda rang');
    const au=(await admin.query(`SELECT kind,count(*)::int n FROM "${schema}".audit GROUP BY kind`)).rows.reduce((o,r)=>(o[r.kind]=r.n,o),{});
    ok(au.gm_denied>=1&&au.gm_announce>=1&&au.login>=1&&au.join>=1,'audit în PG: gm_denied='+au.gm_denied+', gm_announce='+au.gm_announce+', login='+au.login+', join='+au.join);
    // chat persistat
    GMa.send({t:'chat',ch:'world',m:'mesaj world persistat'});await sleep(300);
    ok((await admin.query(`SELECT count(*)::int n FROM "${schema}".chat_log WHERE msg='mesaj world persistat'`)).rows[0].n===1,'chat_log scris în PG');
    // ban persistat + cache invalidat

    // flood și mesaje invalide
    const F=await mk(WS3,'F');for(let i=0;i<200;i++)F.send({t:'ping',c:i});await F.until(()=>F.closed,2000);ok(F.closed&&F.closeCode===1008,'flood: 200 mesaje/s => conexiune închisă (1008)');
    const J=await mk(WS3,'J');J.ws.send('nu e json{{');J.ws.send(JSON.stringify([1,2,3]));J.ws.send(JSON.stringify({t:42}));J.ws.send(JSON.stringify({t:'join',id:'DROP TABLE'}));J.ws.send(JSON.stringify({t:'reg',u:{a:1},p:[]}));
    J.send({t:'ping',c:'ok'});await sleep(300);ok(!J.closed&&J.msgs.some(m=>m.t==='pong'),'mesaje invalide (JSON stricat, tipuri greșite, obiecte în loc de string) nu strică conexiunea/serverul');
    const BIG=await mk(WS3,'BIG');BIG.ws.send('x'.repeat(5000));await BIG.until(()=>BIG.closed,1500);ok(BIG.closed,'payload > 2048 octeți => conexiune închisă');
    const rd2=await httpGet(S.port,'/ready');ok(rd2.status===200,'după flood/invalid serverul rămâne sănătos (/ready 200)');

    // monitorizare
    const ss=S.store.stats();ok(ss.saved>0&&ss.failed===0&&ss.queued===0&&ss.db.kind==='postgres'&&ss.db.pool.max>0,'monitorizare salvări: saved='+ss.saved+', failed=0, coadă=0, pool='+JSON.stringify(ss.db.pool));
    await S.close();S=null;await slow.close();await a1.close();
    ok(!logs.join('\n').includes(MARK),'secrete: parola din DATABASE_URL nu apare în NICIUN log al serverului ('+logs.length+' linii capturate)');
    ok(await tablesOutside()===outside0,'final: tot nu s-a creat/modificat nimic în afara schemei de test');
  }catch(e){fail++;out.push('  CRASH '+(e.stack||e))}
  finally{console.error=oErr;console.warn=oWarn;
    if(S){try{await S.close()}catch(e){}}
    if(/^nidraven_t_[a-z0-9]+$/.test(schema)){try{await admin.query(`DROP SCHEMA "${schema}" CASCADE`)}catch(e){}}
    await admin.end()}
}

(async()=>{
  await partOne();
  const url=process.env.TEST_DATABASE_URL;
  if(url)await partTwo(url);
  else out.push('  SKIP partea PostgreSQL REAL: lipsește TEST_DATABASE_URL (NU se consideră trecută)');
  console.log(out.join('\n'));console.log('\nREZULTAT: '+pass+' trecute, '+fail+' eșuate'+(url?'':' (PostgreSQL SĂRIT)'));
  process.exit(fail||(!url&&!process.env.PG_OPTIONAL)?1:0);
})();
