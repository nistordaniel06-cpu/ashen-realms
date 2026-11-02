'use strict';
// NIDRAVEN V8 — server autoritativ (Node + ws + SQLite). Clientul trimite doar INTENȚII.
// Serverul decide: poziție, daune, XP, aur, loot, inventar. Câmpuri necunoscute din mesaje sunt ignorate.
const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const DB=require('./db.js'),PG=require('./db-postgres.js'),wrapAsync=require('./db-async.js'),{createStore}=require('./store.js'),PERM=require('./permissions.js'),SOCIAL=require('./social.js'),CAT=require('./catalog.js');
const ZJ=JSON.parse(fs.readFileSync(path.join(__dirname,'zones.json'),'utf8'));

/* ---------- constante de joc (server) ---------- */
const TICK=50,SNAP_EVERY=2,SPEED=3.6,LVCAP=40,RES=ZJ.res;
const XPN=lv=>Math.round(30*Math.pow(lv,1.15));
const CLS={1:{n:'Războinic',hp:1.25,pw:1,mp:1,rng:1.9,cd:.5},2:{n:'Mag',hp:.85,pw:1.2,mp:1.5,rng:6.5,cd:.62},3:{n:'Arcaș',hp:1,pw:1,mp:1.1,rng:7,cd:.55},4:{n:'Asasin',hp:.95,pw:1.1,mp:1,rng:1.9,cd:.32}};
const SKILLS=[{mp:8,cd:3,k:'strike',m:2.2},{mp:14,cd:6,k:'burst',m:1.4,r:3},{mp:12,cd:10,k:'heal',h:.35}];
const hpMax=p=>Math.round((80+12*p.lv)*CLS[p.cls].hp),mpMax=p=>Math.round((40+5*p.lv)*CLS[p.cls].mp),pw=p=>(8+2.4*p.lv)*CLS[p.cls].pw;
const INV_SLOTS=24,STACK=99,CHAT_R=14,WORLD_CD=3000,CHAT_N=5,CHAT_W=10000,CHAT_MAX=200;
const POT={pot:{hp:.4},mpot:{mp:.5}};
const LOOT={slime:[['gel',.6,1,2],['herb',.2,1,1]],wolf:[['hide',.5,1,2],['bone',.3,1,1]],goblin:[['wood',.3,1,2],['ore',.25,1,1],['pot',.15,1,1]],skeleton:[['bone',.6,1,2],['ore',.2,1,1]],bandit:[['bar',.1,1,1],['pot',.2,1,1],['gem',.05,1,1]],boar:[['hide',.6,1,2],['herb',.15,1,1]],archer:[['wood',.3,1,2],['pot',.15,1,1]],mage:[['ess',.2,1,1],['herb',.3,1,2],['mpot',.2,1,1]],knight:[['bar',.15,1,1],['cry',.1,1,1],['pot',.25,1,1]],chief:[['gem',1,1,2],['pot',1,1,2],['ore',.8,1,3]],boss:[['cry',1,1,2],['ess',1,1,2],['gem',1,1,2],['pot',1,2,3]]};
const BAD=['fuck','shit','bitch','asshole','cunt','pula','pizda','muie','cacat','dracu','futut','curva','jigodie'];

/* ---------- zone ---------- */
const ZONES={};
for(const id in ZJ.zones){const z=ZJ.zones[id],G=z.N*RES,raw=Buffer.from(z.grid,'base64');
  ZONES[id]={...z,G,free:(x,y)=>{if(!(x>=0&&y>=0&&x<z.N&&y<z.N))return false;const k=Math.floor(y*RES)*G+Math.floor(x*RES);return(raw[k>>3]>>(k&7))&1},players:new Set(),mons:[],ev:[]}}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),r2=v=>Math.round(v*100)/100;
function foldLen(s){let o='';for(const c of s){o+=(c.normalize('NFD')[0]||c).toLowerCase()}return o}
function clean(s){return String(s).normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g,'').replace(/\s+/g,' ').trim()}
function filt(s){const f=[...foldLen(s)],o=[...s];const str=f.join('');for(const w of BAD){let i=-1;while((i=str.indexOf(w,i+1))>=0){for(let k=i;k<i+w.length;k++)o[k]='*'}}return o.join('')}
const NAME_RE=/^[\p{L}\p{N}_-]{3,16}$/u;

async function start(opts={}){
  const port=opts.port??(+process.env.PORT||8080),tickMs=opts.tick||TICK;
  let sdb=null,adb;const dbUrl=opts.databaseUrl||(opts.dbPath?null:process.env.DATABASE_URL);
  if(opts.adb)adb=opts.adb;else if(dbUrl)adb=await PG.open({url:dbUrl});else{sdb=DB.open(opts.dbPath||process.env.DB_PATH||'nidraven.db');adb=wrapAsync(sdb)}
  const store=createStore(adb,opts.store||{}),db=store.db;
  const allowed=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
  const staticFile=opts.staticFile||process.env.STATIC_FILE;
  const players=new Map();            // char id -> p
  const byName=new Map();             // name_lc -> p
  const fails=new Map();              // ip -> [t..]
  let mid=1;
  const world={zones:ZONES,players,db,get mid(){return mid}};

  /* ---- monștri ---- */
  function mkMon(z,s){const c=ZJ.mc[s.t];return{id:mid++,t:s.t,lv:s.lv,x:s.x,y:s.y,hx:s.x,hy:s.y,hp:s.mhp,mhp:s.mhp,dead:0,rt:0,cd:0,st:'idle',tgt:0,wx:s.x,wy:s.y,wt:0,boss:s.boss,big:s.big,el:s.el,dmg:c.dmg*(1+.08*(s.lv-c.lv[0])),sp:c.sp,agr:c.agr,rng:Math.max(c.rng,.9),mcd:c.cd,rsp:c.rsp,lsh:c.lsh||12,contrib:new Map()}}
  for(const id in ZONES){ZONES[id].mons=ZJ.zones[id].mons.map(s=>mkMon(ZONES[id],s));ZONES[id].players.clear();ZONES[id].ev.length=0}
  function steer(z,m,tx,ty,sp,dt){const a=Math.atan2(ty-m.y,tx-m.x);for(const off of[0,.7,-.7,1.4,-1.4,2.4,-2.4]){const b=a+off,nx=m.x+Math.cos(b)*sp*dt,ny=m.y+Math.sin(b)*sp*dt;if(z.free(nx,ny)){m.x=nx;m.y=ny;return true}}return false}

  /* ---- util trimitere ---- */
  const send=(ws,o)=>{if(ws&&ws.readyState===1){try{ws.send(JSON.stringify(o))}catch(e){}}};
  const err=(ws,c,m)=>send(ws,{t:'err',c,m});
  const sys=(p,m)=>send(p.ws,{t:'chat',ch:'system',from:'Sistem',m,ts:Date.now()});

  /* ---- inventar (server) ---- */
  function give(p,id,n){let left=n;for(const s of p.inv){if(s.id===id&&s.n<STACK){const a=Math.min(STACK-s.n,left);s.n+=a;left-=a;if(!left)break}}while(left>0&&p.inv.length<INV_SLOTS){const a=Math.min(STACK,left);p.inv.push({id,n:a});left-=a}p.invD=1;p.dirty=1;return n-left}
  const sendInv=p=>{send(p.ws,{t:'inv',inv:p.inv,gold:p.gold});p.invD=0};
  function addXp(p,xp,z){p.xp+=xp;let up=0;while(p.lv<LVCAP&&p.xp>=XPN(p.lv)){p.xp-=XPN(p.lv);p.lv++;up=1}if(p.lv>=LVCAP)p.xp=0;if(up){p.hp=hpMax(p);p.mp=mpMax(p);z.ev.push({k:'lvl',id:p.id,lv:p.lv});checkUnlocks(p)}p.dirty=1}

  /* ---- combate ---- */
  function hurtMon(z,p,m,dmg,crit){if(m.dead||dmg<=0)return;dmg=Math.max(1,Math.round(dmg));m.hp-=dmg;m.contrib.set(p.id,(m.contrib.get(p.id)||0)+dmg);p.combat=6;if(!m.tgt||m.tgt===p.id||Math.random()<.2){m.tgt=p.id;m.st='chase'}
    z.ev.push({k:'dmg',m:m.id,v:dmg,c:crit?1:0,by:p.id});if(m.hp<=0)killMon(z,p,m)}
  function killMon(z,killer,m){m.dead=1;m.hp=0;m.rt=m.rsp>1e8?1e9:m.rsp;m.tgt=0;m.st='idle';const c=ZJ.mc[m.t];
    const f=1+.06*(m.lv-c.lv[0]);z.ev.push({k:'kill',m:m.id});
    for(const pid of social.xpRecipients(m,z)){const q=players.get(pid);if(!q||q.zone!==z.id)continue;const dl=q.lv-m.lv,lm=dl>6?.5:dl>3?.8:dl<-4?1.2:1;const xp=Math.round(c.xp*f*(m.el?4:1)*lm);addXp(q,xp,z);send(q.ws,{t:'ev',k:'xp',v:xp})}
    const gd=Math.round(c.gold*f*(m.el?4:1));killer.gold+=gd;killer.dirty=1;killer.kills++;if(m.boss||m.big)killer.bosskills++;checkUnlocks(killer);send(killer.ws,{t:'ev',k:'gold',v:gd});
    const got=[];for(const [id,pr,a,b] of(LOOT[m.t]||[])){if(Math.random()<pr){const n=a+Math.floor(Math.random()*(b-a+1));const g=give(killer,id,n);if(g)got.push([id,g])}}
    if(got.length)send(killer.ws,{t:'ev',k:'loot',v:got});sendInv(killer);m.contrib.clear()}
  function hurtPlayer(z,p,dmg,m){if(p.dead)return;const red=Math.min(.5,p.lv*.01);dmg=Math.max(1,Math.round(dmg*(1-red)));p.hp-=dmg;p.combat=6;if(p.mount){p.mount=null;sendWd(p)}z.ev.push({k:'hit',p:p.id,v:dmg,m:m.id});
    if(p.hp<=0){p.hp=0;p.dead=1;p.deadT=4;p.dx=p.dy=0;z.ev.push({k:'die',p:p.id});for(const mm of z.mons)if(mm.tgt===p.id){mm.tgt=0;mm.st='ret'}}}
  function inRange(p,m,extra){return dist(p,m)<=CLS[p.cls].rng+extra+.4}
  function doAttack(p,tid){const z=ZONES[p.zone];if(p.dead||p.atkT>0)return;if(p.mount)return err(p.ws,'mounted','Coboară de pe montură ca să lupți.');const m=z.mons.find(q=>q.id===tid);if(!m||m.dead)return err(p.ws,'target','Țintă invalidă');
    if(!inRange(p,m,0))return err(p.ws,'range','Prea departe');
    p.atkT=CLS[p.cls].cd;p.face=Math.atan2(m.y-p.y,m.x-p.x);const crit=Math.random()<.06;
    z.ev.push({k:'atk',p:p.id,m:m.id});hurtMon(z,p,m,pw(p)*(.9+Math.random()*.2)*(crit?1.6:1),crit)}
  function doSkill(p,i,tid){const z=ZONES[p.zone],S=SKILLS[i];if(!S||p.dead)return;if(p.mount)return err(p.ws,'mounted','Coboară de pe montură ca să lupți.');if(p.skT[i]>0)return err(p.ws,'cd','Încă se reîncarcă');if(p.mp<S.mp)return err(p.ws,'mp','Mana insuficientă');
    if(S.k==='heal'){p.mp-=S.mp;p.skT[i]=S.cd;p.hp=Math.min(hpMax(p),p.hp+hpMax(p)*S.h);z.ev.push({k:'sk',p:p.id,i});return}
    if(S.k==='strike'){const m=z.mons.find(q=>q.id===tid);if(!m||m.dead)return err(p.ws,'target','Țintă invalidă');if(!inRange(p,m,1))return err(p.ws,'range','Prea departe');
      p.mp-=S.mp;p.skT[i]=S.cd;p.face=Math.atan2(m.y-p.y,m.x-p.x);z.ev.push({k:'sk',p:p.id,i,m:m.id});hurtMon(z,p,m,pw(p)*S.m*(.9+Math.random()*.2),0);return}
    p.mp-=S.mp;p.skT[i]=S.cd;z.ev.push({k:'sk',p:p.id,i});for(const m of z.mons.slice())if(!m.dead&&dist(p,m)<=S.r+.5)hurtMon(z,p,m,pw(p)*S.m*(.9+Math.random()*.2),0)}

  /* ---- jucători ---- */
  function mkPlayer(row,ws,acc,blockList,ai){const inv=JSON.parse(row.inv||'[]').filter(s=>s&&typeof s.id==='string'&&Number.isInteger(s.n)&&s.n>0).slice(0,INV_SLOTS);
    const z=ZONES[row.zone]||ZONES.village,p={id:row.id,acc,name:row.name,cls:row.cls,lv:row.lv,xp:row.xp,gold:row.gold,hp:row.hp,mp:row.mp,zone:z.id,x:row.x,y:row.y,inv,ws,dx:0,dy:0,seq:0,face:0,atkT:0,skT:[0,0,0],dead:0,deadT:0,combat:0,lastIn:Date.now(),dirty:0,invD:0,blocks:new Set(blockList),chatT:[],worldT:0,lastSnap:0,role:'PLAYER',mutedUntil:0,party:0,guild:null,kills:row.kills|0,bosskills:row.bosskills|0,mount:null,ucount:0,cosm:{eq:{},title:'novice',skin:'default'}};{try{const c=JSON.parse(row.cosm||'{}');p.cosm={eq:(c.eq&&typeof c.eq==='object')?c.eq:{},title:c.title===undefined?'novice':c.title,skin:c.skin||'default'}}catch(e){}CAT.sanitize(p);p.ucount=ucount(p)}{if(ai){p.role=ai.role;p.mutedUntil=ai.muted_until||0}}
    if(!z.free(p.x,p.y)){p.x=z.SP.x;p.y=z.SP.y}if(p.hp<=0)p.hp=hpMax(p);return p}
  function enter(p){const z=ZONES[p.zone];z.players.add(p);players.set(p.id,p);byName.set(p.name.toLowerCase(),p)}
  function leave(p,why){social.onLeave(p);const z=ZONES[p.zone];if(z)z.players.delete(p);if(players.get(p.id)===p){players.delete(p.id);byName.delete(p.name.toLowerCase())}
    for(const zz of Object.values(ZONES)){for(const m of zz.mons)if(m.tgt===p.id){m.tgt=0;m.st='ret'}for(const m of zz.mons)m.contrib.delete(p.id)}
    store.save(store.snap(p)); // asincron, serializat/coalescat; join-ul așteaptă flush înainte să reîncarce
    if(why!=='silent')broadcastSys(z,p.name+' a părăsit regiunea.')}
  function broadcastSys(z,m){if(!z)return;for(const q of z.players)sys(q,m)}
  function sendJoined(p){const z=ZONES[p.zone];send(p.ws,{t:'joined',role:p.role,zone:{id:z.id,n:z.n,N:z.N,hash:z.hash,PT:z.PT},me:pub(p,1)});sendInv(p)}
  const pub=(p,self)=>({id:p.id,n:p.name,e:Object.keys(p.cosm.eq).length?p.cosm.eq:undefined,sk:p.cosm.skin!=='default'?p.cosm.skin:undefined,tt:p.cosm.title||undefined,mt:p.mount||undefined,g:p.guild?p.guild.tag:undefined,r:social.staffTag(p),cls:p.cls,lv:p.lv,x:r2(p.x),y:r2(p.y),f:r2(p.face),hp:Math.round(p.hp),mhp:hpMax(p),...(self?{mp:Math.round(p.mp),mmp:mpMax(p),xp:p.xp,xpn:XPN(p.lv),gold:p.gold,seq:p.seq,dead:p.dead,spd:CAT.mountMult(p)}:{mv:(p.dx||p.dy)?1:0,dead:p.dead})});
  const ucount=p=>{const u=CAT.unlocked(p);return u.gear.length+u.titles.length+u.skins.length+u.mounts.length};
  function sendWd(p,full){const u=CAT.unlocked(p);send(p.ws,{t:'wd',...(full?{cat:CAT.publicCat()}:{}),ok:u,cur:{eq:p.cosm.eq,title:p.cosm.title,skin:p.cosm.skin,mount:p.mount||null}})}
  function checkUnlocks(p){const before=p.ucount,u=CAT.unlocked(p),n=u.gear.length+u.titles.length+u.skins.length+u.mounts.length;CAT.sanitize(p);if(n!==before){if(before){for(const k of u.titles)if(!p._ut||!p._ut.includes(k))sys(p,'Titlu deblocat: '+CAT.TITLES[k].n);for(const k of u.skins)if(!p._us||!p._us.includes(k))sys(p,'Skin deblocat: '+CAT.SKINS[k].n);for(const k of u.mounts)if(!p._um||!p._um.includes(k))sys(p,'Montură deblocată: '+CAT.MOUNTS[k].n)}p.ucount=n;sendWd(p)}p._ut=u.titles;p._us=u.skins;p._um=u.mounts}

  /* ---- chat ---- */
  async function chat(p,ch,msg,to){
    msg=clean(msg||'');if(!msg)return;if(msg.length>CHAT_MAX)msg=msg.slice(0,CHAT_MAX);
    if(msg[0]==='/'){let mm;
      if(mm=/^\/w\s+(\S+)\s+(.+)$/i.exec(msg)){ch='whisper';to=mm[1];msg=mm[2]}
      else if(mm=/^\/(?:l|local)\s+(.+)$/i.exec(msg)){ch='local';msg=mm[1]}
      else if(mm=/^\/(?:world|wd)\s+(.+)$/i.exec(msg)){ch='world';msg=mm[1]}
      else if(mm=/^\/p\s+(.+)$/i.exec(msg)){ch='party';msg=mm[1]}
      else if(mm=/^\/g\s+(.+)$/i.exec(msg)){ch='guild';msg=mm[1]}
      else if(mm=/^\/s\s+(.+)$/i.exec(msg)){ch='staff';msg=mm[1]}
      else{if(await social.command(p,msg))return;return err(p.ws,'chat','Comandă necunoscută: '+msg.split(' ')[0])}}
    if(p.mutedUntil>Date.now())return err(p.ws,'muted','Ești redus la tăcere încă '+Math.ceil((p.mutedUntil-Date.now())/60000)+' min.');
    if(!['local','world','whisper','party','guild','staff'].includes(ch))return err(p.ws,'chat','Canal invalid');
    const now=Date.now();p.chatT=p.chatT.filter(t=>now-t<CHAT_W);
    if(p.chatT.length>=CHAT_N){db.audit(p.acc,'chat_ratelimit',p.name);return err(p.ws,'rate','Scrii prea repede.')}
    if(ch==='world'&&now-p.worldT<WORLD_CD)return err(p.ws,'cooldown','Chat-ul World are cooldown '+(WORLD_CD/1000)+'s.');
    msg=filt(msg);if(!msg.trim())return;p.chatT.push(now);if(ch==='world')p.worldT=now;
    const out={t:'chat',ch,from:p.name,m:msg,ts:now},z=ZONES[p.zone],me=p.name.toLowerCase();
    const ok=q=>!q.blocks.has(me);
    if(ch==='local'){for(const q of z.players)if(dist(p,q)<=CHAT_R&&ok(q))send(q.ws,out)}
    else if(ch==='world'){for(const q of players.values())if(ok(q))send(q.ws,out)}
    else if(ch==='party'){const t=social.partyMembers(p);if(!t)return err(p.ws,'chat','Nu ești într-un party.');for(const q of t)if(ok(q))send(q.ws,out)}
    else if(ch==='guild'){const t=social.guildOnline(p);if(!t)return err(p.ws,'chat','Nu ești într-o ghildă.');for(const q of t)if(ok(q))send(q.ws,out)}
    else if(ch==='staff'){if(!PERM.can(p.role,'chat.staff'))return err(p.ws,'chat','Canal indisponibil.');for(const q of players.values())if(PERM.can(q.role,'chat.staff'))send(q.ws,out)}
    else{const q=byName.get(String(to||'').toLowerCase());if(!q)return err(p.ws,'chat','Jucătorul nu este online.');if(q===p)return;if(!ok(q))return err(p.ws,'chat','Jucătorul nu poate primi mesaje de la tine.');send(q.ws,{...out,to:q.name});send(p.ws,{...out,to:q.name,self:1})}
    db.log(ch,p.name,ch==='whisper'?to:null,msg)}
  /* ---- teleport forțat (comenzi staff) ---- */
  function moveTo(p,zid,x,y){const z=ZONES[p.zone],d=ZONES[zid];if(!d||p.dead)return;if(z!==d){z.players.delete(p);for(const m of z.mons){if(m.tgt===p.id){m.tgt=0;m.st='ret'}m.contrib.delete(p.id)}p.zone=zid;d.players.add(p)}p.x=x;p.y=y;p.dx=p.dy=0;p.dirty=1;sendJoined(p)}
  const social=SOCIAL({players,byName,db,send,sys,ZONES,PERM,dist,hpMax,moveTo,saveNow:p=>store.save(store.snap(p)),sendInv});

  /* ---- zone / use ---- */
  function changeZone(p,to){const z=ZONES[p.zone],d=ZONES[to];if(!d||p.dead)return err(p.ws,'zone','Zonă invalidă');const pt=z.PT.find(q=>q.to===to&&Math.hypot(q.x-p.x,q.y-p.y)<=3);if(!pt)return err(p.ws,'zone','Nu ești lângă portal');
    if(d.req&&p.lv<d.req)return err(p.ws,'zone',d.n+' cere nivelul '+d.req);
    z.players.delete(p);broadcastSys(z,p.name+' a plecat spre '+d.n+'.');for(const m of z.mons){if(m.tgt===p.id){m.tgt=0;m.st='ret'}m.contrib.delete(p.id)}
    p.zone=to;p.x=d.SP.x;p.y=d.SP.y;p.dx=p.dy=0;d.players.add(p);p.dirty=1;sendJoined(p);broadcastSys(d,p.name+' a intrat în regiune.')}
  function useItem(p,slot){const s=p.inv[slot];if(!s||!POT[s.id]||p.dead)return err(p.ws,'use','Obiect invalid');const e=POT[s.id];if(e.hp)p.hp=Math.min(hpMax(p),p.hp+hpMax(p)*e.hp);if(e.mp)p.mp=Math.min(mpMax(p),p.mp+mpMax(p)*e.mp);s.n--;if(s.n<=0)p.inv.splice(slot,1);p.dirty=1;sendInv(p)}

  /* ---- simulare ---- */
  function movePlayer(z,p,dt){if(p.dead)return;const now=Date.now();if(now-p.lastIn>600){p.dx=p.dy=0}
    const L=Math.hypot(p.dx,p.dy);if(L<.01)return;const d=SPEED*CAT.mountMult(p)*dt/Math.max(1,L),mx=p.dx*d,my=p.dy*d;p.face=Math.atan2(p.dy,p.dx);
    if(z.free(p.x+mx,p.y+my)){p.x+=mx;p.y+=my}else if(z.free(p.x+mx,p.y))p.x+=mx;else if(z.free(p.x,p.y+my))p.y+=my}
  function monAI(z,m,dt){
    if(m.dead){m.rt-=dt;if(m.rt<=0){m.dead=0;m.hp=m.mhp;m.x=m.hx;m.y=m.hy;m.st='idle';m.tgt=0}return}
    m.cd-=dt;let t=m.tgt?players.get(m.tgt):null;if(t&&(t.zone!==z.id||t.dead))t=null,m.tgt=0;
    if(!t&&m.st!=='ret'){let b=m.agr,bp=null;for(const p of z.players)if(!p.dead){const d=dist(p,m);if(d<b){b=d;bp=p}}if(bp){t=bp;m.tgt=bp.id;m.st='chase'}}
    if(m.st==='ret'||(t&&Math.hypot(m.x-m.hx,m.y-m.hy)>m.lsh)){m.st='ret';m.tgt=0;if(Math.hypot(m.x-m.hx,m.y-m.hy)<.5){m.st='idle';m.hp=m.mhp;m.contrib.clear()}else steer(z,m,m.hx,m.hy,m.sp*1.3,dt);return}
    if(t){const d=dist(t,m);if(d>m.rng*.9)steer(z,m,t.x,t.y,m.sp,dt);if(d<=m.rng+.35&&m.cd<=0){m.cd=m.mcd;hurtPlayer(z,t,m.dmg,m)}return}
    m.wt-=dt;if(m.wt<=0){m.wt=2+Math.random()*3;const a=Math.random()*6.283,r=Math.random()*3;m.wx=m.hx+Math.cos(a)*r;m.wy=m.hy+Math.sin(a)*r}
    if(Math.hypot(m.wx-m.x,m.wy-m.y)>.3)steer(z,m,m.wx,m.wy,m.sp*.5,dt)}
  function step(dt){for(const z of Object.values(ZONES)){
      for(const p of z.players){movePlayer(z,p,dt);p.atkT-=dt;for(let i=0;i<3;i++)p.skT[i]-=dt;
        if(p.dead){p.deadT-=dt;if(p.deadT<=0){p.dead=0;p.hp=hpMax(p);p.mp=mpMax(p);p.x=z.SP.x;p.y=z.SP.y;p.dirty=1}}
        else{p.combat-=dt;const rg=p.combat>0?.4:2.5;if(p.hp<hpMax(p))p.hp=Math.min(hpMax(p),p.hp+hpMax(p)*.01*rg*dt);if(p.mp<mpMax(p))p.mp=Math.min(mpMax(p),p.mp+(2+p.lv*.1)*dt)}}
      if(z.players.size)for(const m of z.mons)monAI(z,m,dt);else for(const m of z.mons)if(m.dead||m.hp<m.mhp||m.st!=='idle')monAI(z,m,dt)}}
  let tickN=0,lastT=Date.now();
  function snapshots(){for(const z of Object.values(ZONES)){if(!z.players.size){z.ev.length=0;continue}
      const pl=[...z.players].map(p=>pub(p)),mo=z.mons.filter(m=>!m.dead).map(m=>({id:m.id,t:m.t,lv:m.lv,x:r2(m.x),y:r2(m.y),hp:m.hp,mhp:m.mhp,st:m.st==='chase'?1:0,b:m.boss|m.big,el:m.el}));
      const ev=z.ev.splice(0);
      for(const p of z.players){const o={t:'snap',pl:pl.filter(q=>q.id!==p.id),mo,ev,me:pub(p,1),ts:Date.now()};send(p.ws,o)}}}
  const loop=setInterval(()=>{try{const now=Date.now(),dt=Math.min(.1,(now-lastT)/1000);lastT=now;step(dt);if(++tickN%SNAP_EVERY===0)snapshots();social.tick(now)}catch(e){console.error('tick error',e)}},tickMs);
  const saver=setInterval(()=>{for(const p of players.values())if(p.dirty){p.dirty=0;store.save(store.snap(p)).then(ok=>{if(!ok)p.dirty=1})}},opts.saveMs||15000); // dacă salvarea eșuează definitiv, rămâne "dirty" și se reîncearcă

  /* ---- rețea ---- */
  const srv=http.createServer((req,res)=>{
    if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:1,players:players.size,uptime:Math.round(process.uptime()),db:adb.kind}))}
    if(req.url==='/ready'){const to=new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),2500));
      return Promise.race([adb.ping(),to]).then(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ready:1,db:adb.kind,saveQueue:store.stats().queued}))},()=>{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ready:0,db:adb.kind}))})}
    if((req.url==='/'||req.url==='/index.html')&&staticFile&&fs.existsSync(staticFile)){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(staticFile))}
    res.writeHead(404);res.end('not found')});
  const wss=new WebSocketServer({server:srv,maxPayload:2048,verifyClient:i=>!allowed.length||allowed.includes(i.origin)});
  const ipFail=ip=>{const a=(fails.get(ip)||[]).filter(t=>Date.now()-t<60000);fails.set(ip,a);return a.length};
  wss.on('connection',(ws,req)=>{
    const ip=req.socket.remoteAddress;ws.acc=0;ws.p=null;ws.bucket=[];ws.q=Promise.resolve();ws.qn=0;
    // Mesajele unui socket se procesează STRICT în ordine (DB-ul e async): fără curse între login/join/chat.
    const onMsg=async(m,now)=>{
        const p=ws.p;
        if(p){ // în joc
          switch(m.t){
            case'in':{const dx=+m.dx,dy=+m.dy;if(!Number.isFinite(dx)||!Number.isFinite(dy))return;p.dx=Math.max(-1,Math.min(1,dx));p.dy=Math.max(-1,Math.min(1,dy));p.lastIn=now;if(Number.isInteger(m.seq))p.seq=m.seq;return}
            case'atk':if(Number.isInteger(m.tid))doAttack(p,m.tid);return;
            case'sk':if(Number.isInteger(m.i)&&m.i>=0&&m.i<3)doSkill(p,m.i,m.tid);return;
            case'chat':if(typeof m.m==='string')await chat(p,m.ch,m.m,typeof m.to==='string'?m.to.slice(0,20):'');return;
            case'zone':if(typeof m.to==='string')changeZone(p,m.to);return;
            case'use':if(Number.isInteger(m.slot))useItem(p,m.slot);return;
            case'block':if(typeof m.n==='string'&&m.n){const n=m.n.toLowerCase().slice(0,16);p.blocks.add(n);db.addBlock(p.id,n);sys(p,'Ai blocat '+m.n)}return;
            case'unblock':if(typeof m.n==='string'){const n=m.n.toLowerCase().slice(0,16);p.blocks.delete(n);db.delBlock(p.id,n);sys(p,'Ai deblocat '+m.n)}return;
            case'report':if(typeof m.n==='string'){db.audit(p.acc,'report',p.name+' -> '+String(m.n).slice(0,16)+': '+String(m.r||'').slice(0,120));sys(p,'Raport trimis.')}return;
            case'wd':{if(m.k==='get'){checkUnlocks(p);sendWd(p);return}if(!['gear','title','skin','mount'].includes(m.k))return;const id=m.id===null?null:(typeof m.id==='string'?m.id.slice(0,24):undefined);if(id===undefined)return;
              const e=CAT.equip(p,m.k,id,typeof m.slot==='string'?m.slot:'');if(e)return err(ws,'wd',e);p.dirty=1;sendWd(p);return}
            case'ping':send(ws,{t:'pong',c:m.c});return;
            case'logout':ws.close(1000,'bye');return;
          }return}
        switch(m.t){
          case'ping':send(ws,{t:'pong',c:m.c});return;
          case'reg':case'login':{
            if(ipFail(ip)>=8)return err(ws,'throttle','Prea multe încercări. Așteaptă un minut.');
            const u=String(m.u||''),pw=String(m.p||'');
            if(m.t==='reg'){if(PERM.isFounderIdentity(u)&&!(process.env.FOUNDER_SETUP_CODE&&m.code===process.env.FOUNDER_SETUP_CODE)){db.audit(null,'founder_name_blocked',ip);return err(ws,'taken','Numele este luat')}if(!NAME_RE.test(u))return err(ws,'name','Nume: 3–16 litere/cifre/_/-');if(pw.length<8||pw.length>64)return err(ws,'pw','Parola: 8–64 caractere');
              const id=await db.register(u,pw);if(!id)return err(ws,'taken','Numele este luat');db.audit(id,'register',ip);ws.acc=id;ws.tok=await db.newSession(id);ws.an=u}
            else{const a=await db.verify(u,pw);if(!a){fails.get(ip).push(Date.now());db.audit(null,'login_fail',u.slice(0,16)+'@'+ip);return err(ws,'auth','Date greșite')}ws.acc=a.id;ws.tok=await db.newSession(a.id);ws.an=a.name;db.audit(a.id,'login',ip)}
            if(PERM.isFounderIdentity(ws.an)&&await db.role(ws.acc)!=='FOUNDER'){await db.setRole(ws.acc,'FOUNDER');db.audit(ws.acc,'founder_bound',ws.an)}
            {const ai=await db.accInfo(ws.acc);if(ai.banned_until>Date.now()){ws.acc=0;return err(ws,'banned','Contul este suspendat până la '+new Date(ai.banned_until).toISOString().slice(0,16).replace('T',' ')+' UTC')}}
            send(ws,{t:'auth',tok:ws.tok,name:ws.an,role:await db.role(ws.acc),chars:await db.chars(ws.acc)});return}
          case'tok':{const s=await db.session(m.tok);if(!s){return err(ws,'auth','Sesiune expirată')}{const ai=await db.accInfo(s.account_id);if(ai&&ai.banned_until>Date.now())return err(ws,'banned','Contul este suspendat.')}ws.acc=s.account_id;ws.tok=m.tok;ws.an=s.name;send(ws,{t:'auth',tok:m.tok,name:s.name,role:await db.role(ws.acc),chars:await db.chars(ws.acc)});return}
        }
        if(!ws.acc)return err(ws,'auth','Autentifică-te întâi');
        if(m.t==='newchar'){const n=String(m.n||''),c=m.cls|0;if(!NAME_RE.test(n))return err(ws,'name','Nume erou: 3–16 litere/cifre/_/-');if(!CLS[c])return err(ws,'cls','Clasă invalidă');
          const result=await store.withLock('account:newchar:'+ws.acc,async()=>{
            if((await db.chars(ws.acc)).length>=3)return {error:'limit'};
            const tmp={lv:1,cls:c};const id=await db.addChar(ws.acc,n,c,hpMax(tmp),mpMax(tmp),'village',ZONES.village.SP.x,ZONES.village.SP.y);
            return id===-1?{error:'limit'}:(id?{id}:{error:'taken'});
          });
          if(result.error==='limit')return err(ws,'limit','Maxim 3 eroi');
          if(result.error)return err(ws,'taken','Numele eroului este luat');
          db.audit(ws.acc,'newchar',n);send(ws,{t:'chars',chars:await db.chars(ws.acc)});return}
        if(m.t==='join'){const cid=m.id|0;
          const row=await db.char(cid,ws.acc);if(!row)return err(ws,'char','Erou invalid'); // proprietatea se verifică prin account_id
          await store.withLock(cid,async()=>{ // un singur join pe personaj o dată
            const old=players.get(cid);if(old){const ow=old.ws;old.ws=null;if(ow){err(ow,'dup','Conectat din altă parte');ow.p=null;ow.close(4000,'dup')}leave(old,'silent')}
            await store.flush(cid); // salvarea sesiunii anterioare se termină ÎNAINTE de reîncărcare: nici inventar vechi, nici duplicat
            const [fresh,bl,ai]=await Promise.all([db.char(cid,ws.acc),db.blocks(cid),db.accInfo(ws.acc)]);
            if(!fresh)return err(ws,'char','Erou invalid');
            if(ws.readyState!==1)return; // socketul s-a închis între timp: nu creăm personaj fantomă
            const p=mkPlayer(fresh,ws,ws.acc,bl,ai);p.epoch=store.nextEpoch(cid);await social.loadGuild(p);
            if(ws.readyState!==1)return;
            ws.p=p;enter(p);sendJoined(p);checkUnlocks(p);sendWd(p,true);broadcastSys(ZONES[p.zone],p.name+' a intrat în regiune.');db.audit(ws.acc,'join',p.name)});return}
        if(m.t==='logout'){await db.endSession(ws.tok);ws.close(1000,'bye')}
    };
    ws.on('message',buf=>{
      const now=Date.now();ws.bucket=ws.bucket.filter(t=>now-t<1000);if(ws.bucket.push(now)>80){db.audit(ws.acc,'flood',ip);return ws.close(1008,'flood')}
      let m;try{m=JSON.parse(buf.toString())}catch(e){return}if(!m||typeof m.t!=='string')return;
      if(ws.qn>100){db.audit(ws.acc,'queue_flood',ip);return ws.close(1008,'flood')}
      ws.qn++;ws.q=ws.q.then(()=>onMsg(m,now)).catch(e=>{store.logErr('msg',e);console.error('msg error',e.message)}).then(()=>{ws.qn--});
    });
    ws.on('close',()=>{ws.q=ws.q.then(()=>{const p=ws.p;if(p&&players.get(p.id)===p){p.ws=null;leave(p)}}).catch(e=>{store.logErr('close',e);console.error('close error',e.message)})});
    ws.on('error',()=>{});
  });
  return new Promise(res=>srv.listen(port,opts.host||'0.0.0.0',()=>{
    const api={port:srv.address().port,world,db:sdb||db,adb,store,wss,
      async close(){clearInterval(loop);clearInterval(saver);for(const p of[...players.values()])store.save(store.snap(p));await store.flushAll(); // flush la shutdown înainte de a închide DB
        for(const c of wss.clients)c.terminate();await new Promise(r=>srv.close(()=>r()));await adb.close()}};
    res(api)}));
}
module.exports={start,XPN,hpMax,mpMax,CLS,ZONES};
if(require.main===module){start({port:+(process.env.PORT||8080)}).then(s=>{console.log('NIDRAVEN server pe portul',s.port);const bye=()=>{s.close().then(()=>process.exit(0))};process.on('SIGINT',bye);process.on('SIGTERM',bye)})}
