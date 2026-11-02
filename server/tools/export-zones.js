// Exportă datele de coliziune/spawn ale zonelor din clientul V7 -> server/zones.json
// Rulare: node export-zones.js  (folosește harness-ul de test care încarcă g7.js)
const path=require('path'),fs=require('fs'),crypto=require('crypto');
const SCR=path.resolve(__dirname,'..');process.chdir(path.join(SCR,'render'));
const {X}=require(path.join(SCR,'render/h7.js'));
const RES=4,out={res:RES,zones:{},mc:{}};
for(const t of Object.keys(X.MC)){const c=X.MC[t];out.mc[t]={nm:c.nm,hp:c.hp,sp:c.sp,agr:c.agr,rng:c.rng,dmg:c.dmg,cd:c.cd,rsp:c.rsp,lv:c.lv,xp:c.xp,gold:c.gold,beh:c.beh,lsh:c.lsh}}
for(const id of Object.keys(X.ZD)){
  X.buildZone(id);
  const N=X.N,G=N*RES,bits=Buffer.alloc(Math.ceil(G*G/8));
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){if(X.free((i+.5)/RES,(j+.5)/RES)){const k=j*G+i;bits[k>>3]|=1<<(k&7)}}
  const mons=X.sl.map(s=>({t:s.t,lv:s.lv,x:s.x,y:s.y,mhp:s.mhp,boss:s.boss?1:0,big:s.big?1:0,el:s.el?1:0}));
  const hash=crypto.createHash('sha1').update(Buffer.from(X.TY)).digest('hex').slice(0,12);
  out.zones[id]={id,n:X.ZD[id].n,N,SP:X.SP,PT:X.PT.map(p=>({x:p.x,y:p.y,to:p.to})),grid:bits.toString('base64'),mons,hash,req:{ruins:15}[id]||0};
  console.log(id,'N',N,'free%',(100*[...bits].reduce((a,b)=>a+b.toString(2).replace(/0/g,'').length,0)/(G*G)).toFixed(1),'mons',mons.length,'hash',hash);
}
fs.mkdirSync(path.join(__dirname,'server'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'server/zones.json'),JSON.stringify(out));
console.log('zones.json',fs.statSync(path.join(__dirname,'server/zones.json')).size,'bytes');
