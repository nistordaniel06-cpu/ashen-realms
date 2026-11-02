'use strict';
// V9 Identity — teste protocol: titluri, echipament vizibil, skin-uri, mount-uri (validate de server).
const WebSocket=require('ws'),os=require('os'),path=require('path'),fs=require('fs');const {start}=require('./server.js');
let pass=0,fail=0;const ok=(c,m)=>{c?pass++:fail++;console.log((c?'  ok   ':'  FAIL ')+m)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dbp=path.join(os.tmpdir(),'v9-'+Date.now()+'.db');const S=await start({port:0,dbPath:dbp,host:'127.0.0.1'});const W=S.world,URL='ws://127.0.0.1:'+S.port;
 const mk=()=>new Promise(r=>{const ws=new WebSocket(URL);ws.log=[];ws.on('message',d=>{const m=JSON.parse(d);ws.log.push(m);if(m.t==='snap')ws.snap=m;if(m.t==='wd')ws.wd=m;if(m.t==='auth')ws.auth=m;if(m.t==='chars')ws.chars=m.chars;if(m.t==='joined')ws.joined=m});ws.on('open',()=>r(ws))});
 const until=async(f,ms=3000)=>{const t=Date.now();while(Date.now()-t<ms){if(f())return 1;await sleep(20)}return 0};
 const tx=(c,o)=>c.send(JSON.stringify(o));
 async function hero(u,name,cls){const c=await mk();tx(c,{t:'reg',u,p:'parola-sigura-1'});await until(()=>c.auth);tx(c,{t:'newchar',n:name,cls});await until(()=>c.chars);c.cid=c.chars[0].id;tx(c,{t:'join',id:c.cid});await until(()=>c.joined&&c.snap&&c.wd);return c}
 const P=n=>[...W.players.values()].find(p=>p.name===n);const errs=c=>c.log.filter(m=>m.t==='err'&&m.c==='wd').map(m=>m.m);
 const A=await hero('va1','Vera',1),B=await hero('vb1','Vlad',2);
 ok(A.wd.cat&&Object.keys(A.wd.cat.gear).length>=30&&A.wd.cat.titles.novice,'catalogul cosmetic (piese, titluri, skin-uri, monturi) ajunge la client la intrare');
 ok(A.wd.ok.titles.join()==='novice'&&A.wd.ok.skins.join()==='default'&&A.wd.ok.mounts.length===0,'nivel 1: doar titlul Novice și skin-ul Clasic deblocate');
 // echipament
 tx(A,{t:'wd',k:'gear',id:'w1'});await sleep(250);ok(P('Vera').cosm.eq.w==='w1','nivel 1 Războinic: echipează Sabie de lemn (w1)');
 A.log.length=0;tx(A,{t:'wd',k:'gear',id:'w2'});await sleep(200);ok(errs(A).length===1&&P('Vera').cosm.eq.w==='w1','piesă de nivel 5 respinsă la nivel 1');
 A.log.length=0;tx(A,{t:'wd',k:'gear',id:'st1'});await sleep(200);ok(errs(A).length===1,'armă de altă clasă (baston de Mag) respinsă');
 A.log.length=0;tx(A,{t:'wd',k:'gear',id:'a1'});tx(A,{t:'wd',k:'gear',id:'h1'});await sleep(250);ok(P('Vera').cosm.eq.a==='a1'&&P('Vera').cosm.eq.h==='h1','armură și coif echipate (slot dedus de server din catalog)');
 A.log.length=0;tx(A,{t:'wd',k:'gear',id:'r1'});tx(A,{t:'wd',k:'gear',id:'__proto__'});tx(A,{t:'wd',k:'gear',id:{a:1}});tx(A,{t:'wd',k:'gear',id:'a1',slot:'w'});await sleep(250);ok(errs(A).length>=2&&P('Vera').cosm.eq.w==='w1','id-uri invalide/inel/__proto__ respinse; slotul din client e ignorat');
 await sleep(500);ok(B.snap.pl.find(q=>q.n==='Vera')&&B.snap.pl.find(q=>q.n==='Vera').e&&B.snap.pl.find(q=>q.n==='Vera').e.a==='a1','Vlad vede echipamentul lui Vera în datele de snapshot (armură a1)');
 // titluri / skin
 A.log.length=0;tx(A,{t:'wd',k:'title',id:'warden'});tx(A,{t:'wd',k:'skin',id:'frost'});await sleep(250);ok(errs(A).length===2&&P('Vera').cosm.title==='novice'&&P('Vera').cosm.skin==='default','titlu/skin nedeblocate respinse (nivelul 20/10 necesar)');
 const pv=P('Vera');pv.lv=10;A.log.length=0;tx(A,{t:'wd',k:'get'});await sleep(300);
 ok(A.log.some(m=>m.t==='chat'&&/Titlu deblocat: Veteran/.test(m.m))&&A.log.some(m=>m.t==='chat'&&/Skin deblocat: Jar/.test(m.m))&&A.log.some(m=>/Montură deblocată: Cal/.test(m.m||'')),'la nivel 10: notificări pentru titlu, skin și montură deblocate');
 tx(A,{t:'wd',k:'title',id:'veteran'});tx(A,{t:'wd',k:'skin',id:'frost'});await sleep(500);
 const seen=B.snap.pl.find(q=>q.n==='Vera');ok(seen.tt==='veteran'&&seen.sk==='frost','Vlad vede titlul Veteran și skin-ul Chiciură ale lui Vera');
 // hunter/boss
 A.log.length=0;tx(A,{t:'wd',k:'title',id:'bossbane'});await sleep(200);ok(errs(A).length===1,'titlul „Ucigaș de Căpetenii” cere un boss ucis (respins)');
 // mount
 const x0=pv.x,y0=pv.y;
 A.log.length=0;tx(B,{t:'wd',k:'mount',id:'horse'});await sleep(200);ok(errs(B).length===1,'montură respinsă la nivel 1 (Vlad)');
 tx(A,{t:'wd',k:'mount',id:'horse'});await sleep(250);ok(pv.mount==='horse','Vera încalecă Calul de drum (nivel 10)');
 const sx=pv.x,sy=pv.y;const t0=Date.now();const iv=setInterval(()=>tx(A,{t:'in',dx:1,dy:0,seq:1}),60);await sleep(1000);clearInterval(iv);const dt=(Date.now()-t0)/1000;const d=Math.hypot(pv.x-sx,pv.y-sy);tx(A,{t:'in',dx:0,dy:0});
 ok(d>3.6*1.3*dt*.85&&d<=3.6*1.45*dt+.4,'călare viteza e ~1.45× ('+d.toFixed(2)+' tile în '+dt.toFixed(1)+'s; pe jos ar fi ~'+(3.6*dt).toFixed(1)+')');
 await sleep(300);ok(B.snap.pl.find(q=>q.n==='Vera').mt==='horse','Vlad vede montura lui Vera');
 // combat blocat călare
 const F=W.zones.forest,mon=F.mons.find(m=>!m.dead);W.zones[pv.zone].players.delete(pv);pv.zone='forest';F.players.add(pv);pv.x=mon.x+1;pv.y=mon.y;mon.hp=mon.mhp=500;
 A.log.length=0;tx(A,{t:'atk',tid:mon.id});await sleep(250);ok(A.log.some(m=>m.t==='err'&&m.c==='mounted')&&mon.hp===500,'atac blocat cât timp ești pe montură');
 mon.tgt=pv.id;mon.st='chase';mon.cd=0;await sleep(1800);ok(pv.mount===null||pv.dead,'lovit de un monstru => cobori automat de pe montură');
 tx(A,{t:'wd',k:'mount',id:'wolf'});await sleep(200);ok(pv.mount===null,'Lupul (nivel 20) refuzat la nivel 10');
 // persistență
 tx(A,{t:'wd',k:'title',id:'veteran'});tx(A,{t:'wd',k:'gear',id:'w1'});await sleep(200);const tok=A.auth.tok;A.close();await sleep(500);
 const A2=await mk();tx(A2,{t:'tok',tok});await until(()=>A2.auth);tx(A2,{t:'join',id:A.cid});await until(()=>A2.joined&&A2.wd);
 ok(A2.wd.cur.title==='veteran'&&A2.wd.cur.skin==='frost'&&A2.wd.cur.eq.w==='w1'&&A2.wd.cur.eq.a==='a1','echipament, titlu și skin persistă după reconectare');
 // trișare
 const C=await hero('vc1','Cezar',3);for(const o of[{t:'wd',k:'skin',id:'gilded',lv:99},{t:'wd',k:'title',id:'warden',bosskills:9},{t:'wd',k:'mount',id:'wolf',m:9},{t:'me',lv:50},{t:'wd',k:'gear',id:'bow5'}])tx(C,o);await sleep(400);
 const pc=P('Cezar');ok(pc.lv===1&&pc.cosm.skin==='default'&&pc.cosm.title==='novice'&&!pc.mount&&!pc.cosm.eq.w,'cereri forjate (nivel/boss/montură/piesă blocată) nu schimbă nimic');
 // downgrade: dacă nivelul scade sub cerință, piesele se curăță
 {const q=P('Vera');q.lv=1;tx(A2,{t:'wd',k:'get'});await sleep(300);ok(q.cosm.title==='novice'&&q.cosm.skin==='default'&&q.cosm.eq.a==='a1','dacă nivelul scade sub cerință, titlul/skin-ul invalide revin la implicit (piesele de nivel 1 rămân valide)')}
 console.log('\nREZULTAT: '+pass+' trecute, '+fail+' eșuate');await S.close();try{fs.unlinkSync(dbp)}catch(e){}process.exit(fail?1:0)})().catch(e=>{console.error('CRASH',e);process.exit(2)});
