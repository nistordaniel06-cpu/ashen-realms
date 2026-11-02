'use strict';
// V9 Identity — catalog cosmetic. Deblocări calculate DOAR pe server din progres (nivel, kill-uri, boss). Fără bani reali, fără cutii-surpriză.
const GEAR=require('./gear.json');           // exportat din clientul V7 (id, slot, nivel, clase)
const SLOTS=['w','a','h','g','b'];
const TITLES={
  novice:{n:'Novice',req:'nivel 1',ok:p=>p.lv>=1},
  explorer:{n:'Explorator',req:'nivel 5',ok:p=>p.lv>=5},
  veteran:{n:'Veteran',req:'nivel 10',ok:p=>p.lv>=10},
  warden:{n:'Străjer',req:'nivel 20',ok:p=>p.lv>=20},
  hunter:{n:'Vânător',req:'50 de monștri învinși',ok:p=>p.kills>=50},
  bossbane:{n:'Ucigaș de Căpetenii',req:'învinge o căpetenie/boss',ok:p=>p.bosskills>=1}};
const SKINS={
  default:{n:'Clasic',req:'—',c:{},ok:()=>true},
  ember:{n:'Jar',req:'nivel 5',c:{tun:'#c4552b',tun2:'#8f3318'},ok:p=>p.lv>=5},
  frost:{n:'Chiciură',req:'nivel 10',c:{tun:'#4a8fc4',tun2:'#2f6590',hair:'#e6f2ff'},ok:p=>p.lv>=10},
  woods:{n:'Pădurar',req:'nivel 15',c:{tun:'#2f7a55',tun2:'#1f5a3c'},ok:p=>p.lv>=15},
  dusk:{n:'Amurg',req:'nivel 20',c:{tun:'#6a3fa0',tun2:'#46277a',hair:'#c9b6ff'},ok:p=>p.lv>=20},
  gilded:{n:'Aurit',req:'învinge o căpetenie/boss',c:{tun:'#d6b04a',tun2:'#a07d22',hair:'#fff0c0'},ok:p=>p.bosskills>=1}};
const MOUNTS={
  horse:{n:'Cal de drum',req:'nivel 10',m:1.45,ok:p=>p.lv>=10},
  wolf:{n:'Lup de cenușă',req:'nivel 20',m:1.6,ok:p=>p.lv>=20}};
const gearOk=(p,id)=>{const g=GEAR[id];return !!g&&p.lv>=g.lv&&(!g.cls.length||g.cls.includes(p.cls))};
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function unlocked(p){return{
  gear:Object.keys(GEAR).filter(id=>gearOk(p,id)),
  titles:Object.keys(TITLES).filter(k=>TITLES[k].ok(p)),
  skins:Object.keys(SKINS).filter(k=>SKINS[k].ok(p)),
  mounts:Object.keys(MOUNTS).filter(k=>MOUNTS[k].ok(p))}}
const publicCat=()=>({
  gear:Object.fromEntries(Object.entries(GEAR).map(([id,g])=>[id,{s:g.slot,l:g.lv,c:g.cls}])),
  titles:Object.fromEntries(Object.entries(TITLES).map(([k,v])=>[k,{n:v.n,r:v.req}])),
  skins:Object.fromEntries(Object.entries(SKINS).map(([k,v])=>[k,{n:v.n,r:v.req,c:v.c}])),
  mounts:Object.fromEntries(Object.entries(MOUNTS).map(([k,v])=>[k,{n:v.n,r:v.req,m:v.m}]))});
// Aplică o cerere de echipare; returnează null dacă e ok sau mesajul de eroare.
function equip(p,kind,id,slot){const c=p.cosm;
  switch(kind){
   case'gear':if(id===null||id===undefined){if(!SLOTS.includes(slot))return'Slot invalid';delete c.eq[slot];return null}
     if(typeof id!=='string'||!has(GEAR,id))return'Obiect necunoscut';if(!gearOk(p,id))return'Nu ai deblocat această piesă';c.eq[GEAR[id].slot]=id;return null;
   case'title':if(id===null){c.title=null;return null}if(typeof id!=='string'||!has(TITLES,id)||!TITLES[id].ok(p))return'Titlu indisponibil';c.title=id;return null;
   case'skin':if(typeof id!=='string'||!has(SKINS,id)||!SKINS[id].ok(p))return'Skin indisponibil';c.skin=id;return null;
   case'mount':if(id===null){p.mount=null;return null}if(typeof id!=='string'||!has(MOUNTS,id)||!MOUNTS[id].ok(p))return'Montură indisponibilă';if(p.dead)return'Nu poți încăleca acum';p.mount=id;return null}
  return'Cerere invalidă'}
// la schimbare de nivel/clasă: scoate din echipat ce nu mai e valid (siguranță)
function sanitize(p){const c=p.cosm;for(const s of Object.keys(c.eq))if(!SLOTS.includes(s)||!gearOk(p,c.eq[s]))delete c.eq[s];
  if(c.title&&!(has(TITLES,c.title)&&TITLES[c.title].ok(p)))c.title='novice';if(!has(SKINS,c.skin)||!SKINS[c.skin].ok(p))c.skin='default';
  if(p.mount&&!(has(MOUNTS,p.mount)&&MOUNTS[p.mount].ok(p)))p.mount=null}
const mountMult=p=>p.mount&&has(MOUNTS,p.mount)?MOUNTS[p.mount].m:1;
module.exports={GEAR,TITLES,SKINS,MOUNTS,SLOTS,unlocked,publicCat,equip,sanitize,mountMult};
