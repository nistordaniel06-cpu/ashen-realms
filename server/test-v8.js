'use strict';
// Teste protocol V8: doi+ clienți WebSocket reali contra serverului real (in-process, DB temporar).
const WebSocket=require('ws'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
const {start}=require('./server.js');
let pass=0,fail=0;const results=[];
const ok=(c,m)=>{if(c){pass++;results.push('  ok   '+m)}else{fail++;results.push('  FAIL '+m)}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class C{constructor(url,name){this.name=name;this.msgs=[];this.snap=null;this.chat=[];this.errs=[];this.closed=false;this.ws=new WebSocket(url);
  this.ws.on('message',b=>{const m=JSON.parse(b);this.msgs.push(m);if(m.t==='snap')this.snap=m;if(m.t==='chat')this.chat.push(m);if(m.t==='err')this.errs.push(m);if(m.t==='inv')this.inv=m;if(m.t==='joined')this.joined=m;if(m.t==='auth')this.auth=m;if(m.t==='chars')this.chars=m.chars;if(m.t==='ev'){(this.evs=this.evs||[]).push(m)}});
  this.ws.on('close',()=>this.closed=true);this.ws.on('error',()=>{})}
  open(){return new Promise(r=>this.ws.on('open',r))}
  send(o){this.ws.send(JSON.stringify(o))}
  async until(f,ms=3000){const t=Date.now();while(Date.now()-t<ms){const v=f();if(v)return v;await sleep(20)}return null}
  async reg(u,p){this.send({t:'reg',u,p});return this.until(()=>this.auth)}
  async login(u,p){this.auth=null;this.send({t:'login',u,p});return this.until(()=>this.auth||this.errs.length)}
}
async function mk(url,name){const c=new C(url,name);await c.open();return c}
async function setup(c,u,heroName,cls){await c.reg(u,'parola-sigura-1');c.send({t:'newchar',n:heroName,cls});await c.until(()=>c.chars);c.send({t:'join',id:c.chars[0].id});await c.until(()=>c.joined&&c.snap);return c}

(async()=>{
  const dbp=path.join(os.tmpdir(),'ar8-test-'+Date.now()+'.db');
  const S=await start({port:0,dbPath:dbp,saveMs:500,host:'127.0.0.1'});const W=S.world,URL='ws://127.0.0.1:'+S.port;
  const P=n=>[...W.players.values()].find(p=>p.name===n);
  console.log('server pe',URL);

  /* 1. autentificare separată */
  const A=await mk(URL,'A'),B=await mk(URL,'B');
  A.send({t:'join',id:1});await sleep(150);ok(A.errs.some(e=>e.c==='auth'),'1. join fără autentificare e respins');
  await A.reg('Alice','parola-sigura-1');await B.reg('Bogdan','alta-parola-22');
  ok(A.auth&&B.auth&&A.auth.tok!==B.auth.tok&&A.auth.tok.length===64,'1. doi utilizatori au autentificat separat, tokenuri diferite');
  const A2=await mk(URL,'A2');const r=await A2.login('Alice','GRESIT-123');ok(A2.errs.some(e=>e.c==='auth'),'1. parolă greșită respinsă');
  A2.send({t:'reg',u:'alice',p:'parola-sigura-1'});await sleep(150);ok(A2.errs.some(e=>e.c==='taken'),'1. nume cont duplicat (case-insensitive) respins');
  A2.send({t:'reg',u:'x y!',p:'parola-sigura-1'});await sleep(120);ok(A2.errs.some(e=>e.c==='name'),'1. nume invalid respins');
  A2.send({t:'reg',u:'Scurt',p:'123'});await sleep(120);ok(A2.errs.some(e=>e.c==='pw'),'1. parolă scurtă respinsă');
  const row=S.db.raw.prepare('SELECT hash,salt FROM accounts WHERE name_lc=?').get('alice');ok(row&&row.hash.length===128&&!row.hash.includes('parola'),'1. parola stocată doar ca hash scrypt cu salt');
  A.send({t:'newchar',n:'Aria',cls:2});B.send({t:'newchar',n:'Boros',cls:1});await A.until(()=>A.chars);await B.until(()=>B.chars);
  A.send({t:'join',id:B.chars[0].id});await sleep(150);ok(!A.joined,'1. nu poți intra cu eroul altui cont');
  A.send({t:'join',id:A.chars[0].id});B.send({t:'join',id:B.chars[0].id});await A.until(()=>A.joined&&A.snap);await B.until(()=>B.joined&&B.snap);

  /* 2+3. aceeași regiune, se văd și se mișcă */
  ok(A.joined.zone.id==='village'&&B.joined.zone.id==='village','2. ambii intră în aceeași regiune (village)');
  await A.until(()=>A.snap.pl.some(q=>q.n==='Boros'));ok(A.snap.pl.some(q=>q.n==='Boros')&&B.snap.pl.some(q=>q.n==='Aria'),'3. fiecare îl vede pe celălalt în snapshot');
  const bx0=B.snap.me.x,by0=B.snap.me.y;let seq=0;const iv=setInterval(()=>B.send({t:'in',dx:1,dy:0,seq:++seq}),60);await sleep(1000);clearInterval(iv);B.send({t:'in',dx:0,dy:0,seq:++seq});await sleep(250);
  const seenB=A.snap.pl.find(q=>q.n==='Boros');const mv=Math.hypot(seenB.x-bx0,seenB.y-by0);
  ok(mv>2.0&&mv<4.2,'3. A vede mișcarea lui B ('+mv.toFixed(2)+' tile în ~1s, viteza serverului 3.6/s)');
  ok(Math.abs(seenB.x-P('Boros').x)<.2,'3. poziția văzută de A = poziția serverului');
  // coliziune: mergi în aceeași direcție 6s, rămâi pe celulă liberă
  const iv2=setInterval(()=>B.send({t:'in',dx:1,dy:1,seq:++seq}),60);await sleep(5000);clearInterval(iv2);const pb=P('Boros');ok(W.zones.village.free(pb.x,pb.y),'3. coliziune server: jucătorul rămâne pe teren liber după 5s de mers într-un perete');
  B.send({t:'in',dx:0,dy:0,seq:++seq});

  /* 4. chat local */
  const Cc=await setup(await mk(URL,'C'),'Costin','Corvin',3);
  P('Boros').x=P('Aria').x+3;P('Boros').y=P('Aria').y;P('Corvin').x=P('Aria').x;P('Corvin').y=P('Aria').y;
  // plasează C departe (>14) pe un loc liber
  const z=W.zones.village;let fx=0,fy=0;outer:for(let y=1;y<z.N-1;y+=.5)for(let x=1;x<z.N-1;x+=.5){if(z.free(x,y)&&Math.hypot(x-P('Aria').x,y-P('Aria').y)>16){fx=x;fy=y;break outer}}
  P('Corvin').x=fx;P('Corvin').y=fy;
  A.chat.length=B.chat.length=Cc.chat.length=0;A.send({t:'chat',ch:'local',m:'Salut, vecini! ăîșțâ 😀'});await sleep(300);
  ok(B.chat.some(m=>m.ch==='local'&&m.from==='Aria'&&m.m.includes('ăîșțâ')),'4. local: B (aproape) primește mesajul, diacritice/Unicode păstrate');
  ok(!Cc.chat.some(m=>m.ch==='local'),'4. local: C (distanță '+Math.hypot(fx-P('Aria').x,fy-P('Aria').y).toFixed(0)+' tile) NU primește — distanța calculată de server');
  /* 5. world + anti-spam + whisper + block + filtru */
  await sleep(3100);A.chat.length=B.chat.length=Cc.chat.length=0;A.send({t:'chat',ch:'world',m:'Mesaj world'});await sleep(250);
  ok(B.chat.some(m=>m.ch==='world')&&Cc.chat.some(m=>m.ch==='world'),'5. world: toți jucătorii online îl primesc');
  A.errs.length=0;A.send({t:'chat',ch:'world',m:'a doua imediat'});await sleep(200);ok(A.errs.some(e=>e.c==='cooldown'),'5. world: cooldown 3s aplicat de server');
  B.send({t:'chat',ch:'local',m:'1'});B.send({t:'chat',ch:'local',m:'2'});B.send({t:'chat',ch:'local',m:'3'});B.send({t:'chat',ch:'local',m:'4'});B.send({t:'chat',ch:'local',m:'5'});B.send({t:'chat',ch:'local',m:'6'});await sleep(250);ok(B.errs.some(e=>e.c==='rate'),'5. rate limit: al 6-lea mesaj în 10s respins');
  await sleep(10200);B.chat.length=0;A.send({t:'chat',ch:'local',m:'Ești un FUCK și un cacat'});await sleep(250);ok(B.chat.some(m=>m.m.includes('****')&&!/fuck/i.test(m.m)),'5. filtru de limbaj ofensator aplicat de server');
  await sleep(10200);A.send({t:'chat',ch:'local',m:'/w Corvin secret'});await sleep(250);ok(Cc.chat.some(m=>m.ch==='whisper'&&m.m==='secret'&&m.from==='Aria')&&A.chat.some(m=>m.ch==='whisper'&&m.self)&&!B.chat.some(m=>m.ch==='whisper'),'5. whisper /w Nume mesaj: doar destinatarul + expeditorul');
  Cc.send({t:'block',n:'Aria'});await sleep(150);Cc.chat.length=0;A.send({t:'chat',ch:'world',m:'blocat?'});await sleep(250);ok(!Cc.chat.some(m=>m.from==='Aria'&&m.ch==='world'),'5. block: mesajele de la jucătorul blocat nu mai ajung');
  const big=await mk(URL,'big');big.ws.send('x'.repeat(5000));await sleep(300);ok(big.closed,'5. payload supradimensionat → conexiune închisă');
  const lg=S.db.raw.prepare('SELECT COUNT(*) n FROM chat_log').get().n;ok(lg>=3,'5. mesajele sunt înregistrate în chat_log ('+lg+')');

  /* 6. atacuri validate de server — mută A și B în pădure lângă un monstru */
  const F=W.zones.forest,mon=F.mons.find(m=>m.t==='slime')||F.mons[0];
  function place(p,zid,x,y){W.zones[p.zone].players.delete(p);p.zone=zid;W.zones[zid].players.add(p);p.x=x;p.y=y;p.dx=p.dy=0}
  const pa=P('Aria'),pbb=P('Boros');
  // găsește un loc liber la ~1.2 tile de monstru
  function nearFree(m,d){for(let a=0;a<6.28;a+=.4){const x=m.x+Math.cos(a)*d,y=m.y+Math.sin(a)*d;if(F.free(x,y))return[x,y]}return[m.x,m.y]}
  // izolează monstrul: altele departe de el nu contează
  mon.hp=mon.mhp=200;pbb.lv=1;
  place(pbb,'forest',...nearFree(mon,1.0));place(pa,'forest',...nearFree(mon,1.5));
  // sync jucătorii în clienți
  await A.until(()=>A.snap&&A.snap.mo.some(m=>m.id===mon.id));await B.until(()=>B.snap&&B.snap.mo.some(m=>m.id===mon.id));
  ok(!!A.snap.mo.find(m=>m.id===mon.id)&&!!B.snap.mo.find(m=>m.id===mon.id),'7. ambii clienți văd același monstru (id '+mon.id+') în regiune');
  const far=F.mons.reduce((a,b)=>dist(pbb,b)>dist(pbb,a)?b:a);function dist(p,m){return Math.hypot(p.x-m.x,p.y-m.y)}
  const hp0=far.hp;B.errs.length=0;B.send({t:'atk',tid:far.id});await sleep(250);ok(B.errs.some(e=>e.c==='range')&&far.hp===hp0,'6. atac asupra unei ținte îndepărtate respins de server (daune 0)');
  B.errs.length=0;B.send({t:'atk',tid:999999});await sleep(150);ok(B.errs.some(e=>e.c==='target'),'6. țintă inexistentă respinsă');
  const h1=mon.hp;B.send({t:'atk',tid:mon.id,dmg:99999,gold:5000});await sleep(250);const d1=h1-mon.hp;ok(d1>0&&d1<60,'6. atac valid în rază: daune calculate de server ('+d1+'), câmpul dmg din client ignorat');
  const h2=mon.hp;B.send({t:'atk',tid:mon.id});B.send({t:'atk',tid:mon.id});B.send({t:'atk',tid:mon.id});await sleep(120);ok(h2-mon.hp<=Math.ceil(d1*1.7),'6. cooldown de atac impus de server (spam de 3 atacuri = max 1 lovitură)');
  A.send({t:'sk',i:1});await sleep(250);ok(mon.hp<h2-0,'6. skill AoE (A) validat și aplicat de server');
  A.errs.length=0;pa.mp=0;A.send({t:'sk',i:0,tid:mon.id});await sleep(150);ok(A.errs.some(e=>e.c==='mp'),'6. skill fără mană respins');pa.mp=pa.mp;
  /* 7. stare comună + XP/loot de la server */
  const xpA0=pa.xp,lvA0=pa.lv,xpB0=pbb.xp,lvB0=pbb.lv;const goldB=pbb.gold;
  pa.mp=100;pa.skT=[0,0,0];pbb.atkT=0;mon.hp=3;mon.t='chief';mon.el=0; // chief = pradă garantată (test)
  A.inv=null;B.inv=null;B.send({t:'atk',tid:mon.id});await sleep(300);
  ok(mon.dead===1,'7. monstrul omorât de B apare mort pentru toți (A nu îl mai vede)');await sleep(250);
  ok(!A.snap.mo.some(m=>m.id===mon.id),'7. A vede în snapshot că monstrul a dispărut (stare comună)');
  ok((pa.lv>lvA0||pa.xp>xpA0)&&(pbb.lv>lvB0||pbb.xp>xpB0),'7. XP acordat de server ambilor participanți la luptă (A: '+xpA0+'→'+pa.xp+', B: '+xpB0+'→'+pbb.xp+')');
  ok(pbb.gold>goldB&&B.inv&&B.inv.inv.length>0,'7. aurul și loot-ul sunt acordate de server ('+(pbb.gold-goldB)+' aur, '+B.inv.inv.map(s=>s.id+'x'+s.n).join(',')+')');

  /* 8. persistență + reconectare */
  const savedInv=JSON.stringify(pbb.inv),savedGold=pbb.gold,savedXp=pbb.xp,savedLv=pbb.lv;
  B.ws.terminate();await sleep(400);ok(!W.players.has(pbb.id),'8. la deconectare jucătorul e scos din lume și salvat');
  const row2=S.db.raw.prepare('SELECT * FROM characters WHERE name=?').get('Boros');ok(row2.inv===savedInv&&row2.gold===savedGold,'8. inventar+aur persistate în DB');
  const B2=await mk(URL,'B2');B2.send({t:'tok',tok:B.auth.tok});await B2.until(()=>B2.auth);ok(!!B2.auth&&B2.auth.chars.length===1,'8. reconectare cu token (fără parolă)');
  B2.send({t:'join',id:B2.auth.chars[0].id});await B2.until(()=>B2.joined&&B2.inv);
  ok(JSON.stringify(B2.inv.inv)===savedInv&&B2.inv.gold===savedGold&&B2.joined.me.lv===savedLv,'8. după reconectare: inventar, aur, nivel identice ('+B2.inv.inv.length+' stive, '+B2.inv.gold+' aur)');
  ok(B2.joined.zone.id==='forest','8. revine în aceeași regiune salvată');
  const Bx=new C(URL,'bad');await Bx.open();Bx.send({t:'tok',tok:'0'.repeat(64)});await sleep(150);ok(Bx.errs.some(e=>e.c==='auth'),'8. token fals respins');

  /* 9. trișare */
  const pb2=P('Boros');const g0=pb2.gold,x0=pb2.xp,lv0=pb2.lv,inv0=JSON.stringify(pb2.inv);
  for(const o of[{t:'gold',v:99999},{t:'xp',v:99999},{t:'give',id:'gem',n:99},{t:'setgold',gold:1e9},{t:'me',gold:1e9,xp:1e9,lv:99},{t:'in',dx:0,dy:0,gold:1e9,xp:1e9,lv:99,x:5,y:5},{t:'use',slot:-1},{t:'use',slot:1e9},{t:'inv',inv:[{id:'gem',n:99}]},{t:'join',id:1,gold:1e9},{t:'sk',i:7},{t:'sk',i:-1},{t:'zone',to:'__proto__'},{t:'chat',ch:'staff',m:'x'},{t:'chat',ch:'world',m:{a:1}},{t:'in',dx:'NaN',dy:{}}])B2.send(o);
  await sleep(400);
  ok(pb2.gold===g0&&pb2.xp===x0&&pb2.lv===lv0&&JSON.stringify(pb2.inv)===inv0,'9. mesaje forjate (gold/xp/give/lv/inv) nu modifică nimic pe server');
  const p0={x:pb2.x,y:pb2.y};const t0=Date.now();const iv3=setInterval(()=>B2.send({t:'in',dx:1000,dy:1000,seq:1}),50);await sleep(1500);clearInterval(iv3);const tt=(Date.now()-t0)/1000;const walked=Math.hypot(pb2.x-p0.x,pb2.y-p0.y);
  ok(walked<=3.7*tt+.5,'9. speed-hack (dx=1000) limitat: '+walked.toFixed(1)+' tile în '+tt.toFixed(1)+'s (max '+(3.6*tt).toFixed(1)+')');
  B2.errs.length=0;B2.send({t:'zone',to:'ruins'});await sleep(150);ok(B2.errs.some(e=>e.c==='zone')&&pb2.zone==='forest','9. teleport către altă zonă fără portal respins');
  const xpAb=pa.xp;
  const flood=await setup(await mk(URL,'F'),'Flood','Floodman',4);for(let i=0;i<200;i++)flood.send({t:'ping',c:i});await sleep(400);ok(flood.closed,'9. flood de mesaje → conexiune închisă (rate limit pe conexiune)');
  /* 10. stabilitate la deconectare */
  const Dd=await setup(await mk(URL,'D'),'Dorin','Dorian',1);const pd=P('Dorian');const tm=F.mons.find(m=>!m.dead&&m!==mon)||F.mons[1];
  place(pd,'forest',...nearFree(tm,1.2));const hpD0=pd.hp;tm.tgt=pd.id;tm.st='chase';await sleep(2200);ok(pd.hp<hpD0||pd.dead,'6. monstrul atacă jucătorul (server): HP '+Math.round(hpD0)+'→'+Math.round(pd.hp));
  Dd.ws.terminate();await sleep(500);
  ok(!W.players.has(pd.id)&&tm.tgt===0,'10. monstrul își eliberează ținta după deconectarea jucătorului');
  const sn=A.snap.ts;await sleep(400);ok(A.snap.ts>sn,'10. serverul continuă să trimită snapshot-uri după deconectări');
  const hz=await new Promise(r=>http.get('http://127.0.0.1:'+S.port+'/health',res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>r(JSON.parse(b)))}));ok(hz.ok===1,'10. /health răspunde ('+hz.players+' jucători)');
  for(let i=0;i<5;i++){const t=await setup(await mk(URL,'t'+i),'Temp'+i,'Temp'+i+'x',1+(i%4));t.ws.terminate()}await sleep(500);
  ok(W.players.size===3,'10. conectări/deconectări rapide fără blocaj ('+W.players.size+' rămași)');
  A.send({t:'ping',c:7});ok(!!(await A.until(()=>A.msgs.find(m=>m.t==='pong'&&m.c===7))),'10. clientul rămas conectat primește în continuare răspunsuri');
  /* dublă sesiune */
  const A3=await mk(URL,'A3');A3.send({t:'tok',tok:A.auth.tok});await A3.until(()=>A3.auth);A3.send({t:'join',id:A.chars[0].id});await A3.until(()=>A3.joined);await sleep(300);
  ok(A.closed&&A.errs.some(e=>e.c==='dup')&&[...W.players.values()].filter(p=>p.name==='Aria').length===1,'8. a doua sesiune a aceluiași erou o înlocuiește pe prima (fără dubluri)');

  // login brute force
  const br=await mk(URL,'br');for(let i=0;i<10;i++)br.send({t:'login',u:'Alice',p:'gresit-'+i});await sleep(1500);ok(br.errs.some(e=>e.c==='throttle'),'9. brute-force login → throttle');
  ok(S.db.raw.prepare('SELECT COUNT(*) n FROM audit WHERE kind=?').get('login_fail').n>=8,'9. încercările eșuate sunt în audit');

  console.log(results.join('\n'));console.log('\nREZULTAT: '+pass+' trecute, '+fail+' eșuate');
  await S.close();try{fs.unlinkSync(dbp)}catch(e){}process.exit(fail?1:0);
})().catch(e=>{console.error('TEST CRASH',e);process.exit(2)});
