'use strict';
// V8.5 — teste social/staff cu clienți WebSocket reali (party, ghilde, canale, comenzi GM, mute/ban, audit).
const WebSocket=require('ws'),os=require('os'),path=require('path'),fs=require('fs');
const {start}=require('./server.js');
let pass=0,fail=0;const ok=(c,m)=>{c?pass++:fail++;console.log((c?'  ok   ':'  FAIL ')+m)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dbp=path.join(os.tmpdir(),'soc-'+Date.now()+'.db');const S=await start({port:0,dbPath:dbp,host:'127.0.0.1'});const W=S.world,URL='ws://127.0.0.1:'+S.port;
 const mk=()=>new Promise(r=>{const ws=new WebSocket(URL);ws.log=[];ws.on('message',d=>{const m=JSON.parse(d);ws.log.push(m);if(m.t==='snap')ws.snap=m;if(m.t==='party')ws.party=m;if(m.t==='joined')ws.joined=m;if(m.t==='auth')ws.auth=m;if(m.t==='chars')ws.chars=m.chars});ws.on('close',()=>ws.closed=true);ws.on('open',()=>r(ws))});
 const tx=(c,t)=>c.log.filter(m=>m.t==='chat'&&m.ch==='system').map(m=>m.m).join(' | ')+(t||'');
 const sysHas=(c,re)=>c.log.some(m=>(m.t==='chat'&&re.test(m.m))||(m.t==='err'&&re.test(m.m)));
 const say=(c,m,ch)=>c.send(JSON.stringify({t:'chat',ch:ch||'local',m}));
 const send=(c,o)=>c.send(JSON.stringify(o));
 async function hero(user,name,cls,role){const c=await mk();c.send=o=>c.__proto__.send.call(c,typeof o==='string'?o:JSON.stringify(o));c.send({t:'reg',u:user,p:'parola-sigura-1'});await until(()=>c.auth);
   if(role){const a=S.db.raw.prepare('SELECT id FROM accounts WHERE name_lc=?').get(user.toLowerCase());await S.store.db.setRole(a.id,role)}
   c.send({t:'newchar',n:name,cls});await until(()=>c.chars);c.cid=c.chars[0].id;c.send({t:'join',id:c.cid});await until(()=>c.joined&&c.snap);c.name=name;return c}
 async function until(f,ms=3000){const t=Date.now();while(Date.now()-t<ms){if(f())return 1;await sleep(20)}return 0}
 const P=n=>[...W.players.values()].find(p=>p.name===n);
 const A=await hero('ua1','Ana',1),B=await hero('ub1','Bob',2),C=await hero('uc1','Cora',3);
 // ---------- PARTY ----------
 say(A,'/invite Bob');await sleep(250);ok(sysHas(B,/te invită într-un party/),'party: Bob primește invitația');
 say(B,'/accept');await sleep(400);ok(A.party&&A.party.members.length===2&&B.party&&B.party.members.length===2&&A.party.leader===A.cid,'party: ambii primesc starea party-ului (lider Ana)');
 say(A,'salut party','party');await sleep(250);ok(B.log.some(m=>m.ch==='party'&&m.m==='salut party')&&!C.log.some(m=>m.ch==='party'),'canal Party: doar membrii primesc');
 say(C,'intrus','party');await sleep(200);ok(sysHas(C,/Nu ești într-un party/),'canal Party: nemembrul e respins');
 say(B,'/invite Cora');await sleep(200);ok(sysHas(B,/Doar liderul/),'doar liderul poate invita');
 // XP partajat: Ana și Bob în pădure, doar Ana lovește
 const F=W.zones.forest,mon=F.mons.find(m=>m.t==='slime')||F.mons[0];
 const place=(p,x,y)=>{W.zones[p.zone].players.delete(p);p.zone='forest';F.players.add(p);p.x=x;p.y=y};
 const fr=(m,d)=>{for(let a=0;a<6.3;a+=.4){const x=m.x+Math.cos(a)*d,y=m.y+Math.sin(a)*d;if(F.free(x,y))return[x,y]}return[m.x,m.y]};
 place(P('Ana'),...fr(mon,1));place(P('Bob'),...fr(mon,4));mon.hp=2;const bx=P('Bob').xp;P('Ana').atkT=0;send(A,{t:'atk',tid:mon.id});await sleep(400);
 ok(mon.dead===1&&P('Bob').xp>bx,'XP partajat: Bob (nu a lovit) primește XP de la kill-ul Anei ('+bx+'→'+P('Bob').xp+')');
 say(B,'/leave');await sleep(300);ok(A.party.members.length===0&&B.party.members.length===0,'party se desființează când rămâne un singur membru');
 // ---------- GHILDĂ ----------
 say(A,'/gcreate ASH Cenușa Vie');await sleep(300);const g=S.db.raw.prepare('SELECT * FROM guilds').get();ok(g&&g.tag==='ASH'&&g.name==='Cenușa Vie','ghildă creată și salvată în DB');
 say(C,'/gcreate ASH Cenușa Vie');await sleep(250);ok(sysHas(C,/luat/),'nume de ghildă duplicat respins');
 say(A,'/ginvite Bob');await sleep(200);say(B,'/gaccept');await sleep(300);ok(S.db.guildOf(B.cid)&&S.db.guildOf(B.cid).rank==='MEMBER','Bob intră în ghildă ca MEMBER');
 say(A,'salut ghildă','guild');await sleep(250);ok(B.log.some(m=>m.ch==='guild'&&m.m==='salut ghildă')&&!C.log.some(m=>m.ch==='guild'),'canal Guild: doar membrii primesc');
 await sleep(700);ok(A.snap.pl.some(q=>q.n==='Bob'&&q.g==='ASH'),'tag-ul ghildei [ASH] apare în datele de nameplate ale lui Bob');
 say(B,'/ginvite Cora');await sleep(200);ok(sysHas(B,/Doar ofițerii/),'MEMBER nu poate invita');
 say(A,'/gpromote Bob');await sleep(250);ok(S.db.guildOf(B.cid).rank==='OFFICER','lider promovează la OFFICER');
 say(B,'/ginvite Cora');await sleep(200);say(C,'/gaccept');await sleep(300);ok(!!S.db.guildOf(C.cid),'ofițerul poate invita');
 say(B,'/gkick Ana');await sleep(250);ok(S.db.guildOf(A.cid)&&S.db.guildOf(A.cid).rank==='LEADER','ofițerul nu poate elimina liderul');
 say(A,'/gkick Cora');await sleep(250);ok(!S.db.guildOf(C.cid),'liderul elimină un membru');
 // persistență ghildă după reconectare
 const tokA=A.auth.tok;A.close();await sleep(400);const A2=await mk();A2.send=o=>A2.__proto__.send.call(A2,JSON.stringify(o));A2.send({t:'tok',tok:tokA});await until(()=>A2.auth);A2.send({t:'join',id:A.cid});await until(()=>A2.joined);await sleep(400);
 ok(P('Ana')&&P('Ana').guild&&P('Ana').guild.tag==='ASH','ghilda persistă după reconectare');
 A2.send=o=>A2.__proto__.send.call(A2,JSON.stringify(o));
 // ---------- STAFF / GM ----------
 const M=await hero('um1','Mara',2,'MODERATOR'),G=await hero('ug1','Gigi',1,'GAME_MASTER'),H=await hero('uh1','Hori',1,'HEAD_GM'),AD=await hero('ua2','Adela',1,'ADMINISTRATOR');
 say(M,'comisie staff','staff');await sleep(250);ok(G.log.some(m=>m.ch==='staff'&&m.m==='comisie staff')&&!C.log.some(m=>m.ch==='staff')&&!B.log.some(m=>m.ch==='staff'),'canal Staff: doar personalul îl primește');
 say(C,'sunt staff?','staff');await sleep(200);ok(sysHas(C,/indisponibil/),'jucătorul obișnuit nu poate scrie în Staff');
 say(M,'/mute Cora 5');await sleep(300);say(C,'mai pot scrie?');await sleep(250);ok(C.log.some(m=>m.t==='err'&&m.c==='muted'),'mute (Moderator): Cora nu mai poate scrie');
 ok(S.db.accInfo(S.db.charByName('Cora').account_id).muted_until>Date.now(),'mute persistat în DB');
 say(M,'/unmute Cora');await sleep(250);C.log.length=0;say(C,'din nou');await sleep(250);ok(!C.log.some(m=>m.c==='muted'),'unmute funcționează');
 say(C,'/kick Bob');await sleep(250);ok(sysHas(C,/permisiunea/)&&S.db.raw.prepare("SELECT COUNT(*) n FROM audit WHERE kind='gm_denied'").get().n>=1,'jucător obișnuit: /kick refuzat și înregistrat în audit');
 say(M,'/kick Bob');await sleep(250);ok(sysHas(M,/permisiunea/),'Moderator nu poate da kick (necesită Trial GM)');
 say(G,'/kick Hori');await sleep(250);ok(sysHas(G,/egal sau superior/),'nu poți da kick unui rang superior');
 say(G,'/tp Cora');await sleep(500);ok(P('Gigi').zone===P('Cora').zone&&Math.hypot(P('Gigi').x-P('Cora').x,P('Gigi').y-P('Cora').y)<.1,'/tp (GM): teleport la jucător');
 say(M,'/tp Cora');await sleep(200);ok(sysHas(M,/permisiunea/),'/tp refuzat Moderatorului');
 say(G,'/announce Server în 5 min restart');await sleep(300);ok(C.log.some(m=>m.from==='Anunț'&&/restart/.test(m.m)),'/announce ajunge la toți jucătorii');
 say(C,'/announce fals');await sleep(200);ok(!B.log.some(m=>/fals/.test(m.m||'')),'/announce refuzat jucătorului');
 // ban cu confirmare
 say(H,'/ban Cora 5 spam');await sleep(300);const cm=/\/confirm (\d{4})/.exec(tx(H));ok(!!cm&&!C.closed&&S.db.accInfo(S.db.charByName('Cora').account_id).banned_until===0,'/ban cere confirmare; încă nu a fost aplicat');
 say(H,'/confirm 0000');await sleep(250);ok(S.db.accInfo(S.db.charByName('Cora').account_id).banned_until===0,'cod de confirmare greșit: nimic aplicat');
 say(H,'/ban Cora 5 spam');await sleep(300);const cm2=[...tx(H).matchAll(/\/confirm (\d{4})/g)].pop()[1];say(H,'/confirm '+cm2);await sleep(500);
 ok(S.db.accInfo(S.db.charByName('Cora').account_id).banned_until>Date.now()&&C.closed,'/ban confirmat: aplicat, jucătorul deconectat');
 const C2=await mk();C2.log=[];C2.on('message',d=>C2.log.push(JSON.parse(d)));C2.send(JSON.stringify({t:'tok',tok:C.auth.tok}));await sleep(300);ok(C2.log.some(m=>m.t==='err'&&m.c==='banned'),'jucător banat nu se poate reconecta cu token');
 const C3=await mk();C3.log=[];C3.on('message',d=>C3.log.push(JSON.parse(d)));C3.send(JSON.stringify({t:'login',u:'uc1',p:'parola-sigura-1'}));await sleep(900);ok(C3.log.some(m=>m.t==='err'&&m.c==='banned'),'jucător banat nu se poate autentifica');
 say(H,'/unban Cora');await sleep(300);ok(S.db.accInfo(S.db.charByName('Cora').account_id).banned_until===0,'/unban ridică banul');
 // gold grant (admin, confirmare)
 const g0=P('Bob').gold;say(G,'/grantgold Bob 500');await sleep(250);ok(sysHas(G,/permisiunea/)&&P('Bob').gold===g0,'GM nu poate acorda aur');
 say(AD,'/grantgold Bob 500');await sleep(300);const cg=[...tx(AD).matchAll(/\/confirm (\d{4})/g)].pop();ok(!!cg&&P('Bob').gold===g0,'/grantgold cere confirmare, nimic acordat până atunci');
 say(AD,'/confirm '+cg[1]);await sleep(400);ok(P('Bob').gold===g0+500,'după confirmare: +500 aur acordat de server');
 say(B,'/grantgold Bob 99999');await sleep(250);ok(P('Bob').gold===g0+500,'jucătorul nu își poate acorda aur');
 // setrole
 say(AD,'/setrole Cora FOUNDER');await sleep(250);ok(sysHas(AD,/Nu poți acorda/),'Administratorul nu poate acorda FOUNDER');
 say(AD,'/setrole Cora ADMINISTRATOR');await sleep(250);ok(S.db.role(S.db.charByName('Cora').account_id)==='PLAYER','Administratorul nu poate acorda rang egal cu al lui');
 say(AD,'/setrole Cora GAME_MASTER');await sleep(300);const cs=[...tx(AD).matchAll(/\/confirm (\d{4})/g)].pop();say(AD,'/confirm '+cs[1]);await sleep(400);ok(S.db.role(S.db.charByName('Cora').account_id)==='GAME_MASTER','/setrole (confirmat): Cora devine GAME_MASTER');
 say(B,'/setrole Bob FOUNDER');await sleep(250);ok(S.db.role(S.db.charByName('Bob').account_id)==='PLAYER','jucătorul nu își poate acorda rang');
 say(H,'/audit 40');await sleep(400);ok(H.log.some(m=>m.t==='chat'&&/gm_ban/.test(m.m))&&H.log.some(m=>m.t==='chat'&&/gm_grantgold/.test(m.m))&&H.log.some(m=>/gm_setrole/.test(m.m||'')),'/audit (Head GM) afișează acțiunile staff (ban, grantgold, setrole)');
 say(G,'/audit');await sleep(200);ok(!G.log.some(m=>/gm_ban/.test(m.m||'')),'GM nu poate vedea auditul');
 say(G,'/kick Bob');await sleep(500);ok(!P('Bob')||false,'/kick (GM) elimină un jucător');
 console.log('\nREZULTAT: '+pass+' trecute, '+fail+' eșuate');await S.close();try{fs.unlinkSync(dbp)}catch(e){}process.exit(fail?1:0)})().catch(e=>{console.error('CRASH',e);process.exit(2)});
