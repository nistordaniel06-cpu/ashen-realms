'use strict';
// V8.5 — party (în memorie), ghilde (persistente), comenzi GM (verificate pe server, cu audit + confirmare).
module.exports=function(ctx){
  const {players,byName,db,send,sys,ZONES,PERM,dist,hpMax,moveTo,saveNow}=ctx;
  const parties=new Map();let pidc=1;const pinv=new Map(),ginv=new Map(),confirms=new Map();
  const GR={LEADER:2,OFFICER:1,MEMBER:0},GNAME=/^[\p{L}\p{N}_ -]{3,20}$/u,GTAG=/^[A-Za-z0-9]{2,4}$/;
  const find=n=>byName.get(String(n||'').toLowerCase());
  const SHORT={MODERATOR:'MOD',TRIAL_GM:'TGM',GAME_MASTER:'GM',HEAD_GM:'HGM',ADMINISTRATOR:'ADM',FOUNDER:'FND'};
  const staffTag=p=>SHORT[p.role]||undefined;
  /* ---- party ---- */
  const partyOf=p=>p.party?parties.get(p.party):null;
  function pushParty(pt){const mem=[...pt.members].map(id=>players.get(id)).filter(Boolean);
    const list=mem.map(q=>({id:q.id,n:q.name,lv:q.lv,hp:Math.round(q.hp),mhp:hpMax(q),z:q.zone}));
    for(const q of mem)send(q.ws,{t:'party',leader:pt.leader,members:list})}
  function partyLeave(p,quiet){const pt=partyOf(p);if(!pt)return;pt.members.delete(p.id);p.party=0;send(p.ws,{t:'party',members:[]});
    if(pt.members.size<2){for(const id of pt.members){const q=players.get(id);if(q){q.party=0;send(q.ws,{t:'party',members:[]});if(!quiet)sys(q,'Party-ul s-a desființat.')}}parties.delete(pt.id);return}
    if(pt.leader===p.id)pt.leader=[...pt.members][0];if(!quiet)for(const id of pt.members){const q=players.get(id);if(q)sys(q,p.name+' a părăsit party-ul.')}pushParty(pt)}
  function partyInvite(p,n){const t=find(n);if(!t||t===p)return sys(p,'Jucătorul nu este online.');if(t.party)return sys(p,t.name+' este deja într-un party.');
    let pt=partyOf(p);if(pt&&pt.leader!==p.id)return sys(p,'Doar liderul poate invita.');if(pt&&pt.members.size>=4)return sys(p,'Party-ul este plin (4).');
    pinv.set(t.id,{from:p.id,exp:Date.now()+60000});sys(p,'Invitație trimisă lui '+t.name+'.');sys(t,p.name+' te invită într-un party. Scrie /accept (60s).')}
  function partyAccept(p){const iv=pinv.get(p.id);if(!iv||iv.exp<Date.now()){pinv.delete(p.id);return false}pinv.delete(p.id);const inv=players.get(iv.from);if(!inv)return sys(p,'Invitatorul nu mai este online.'),true;
    if(p.party)return sys(p,'Ești deja într-un party.'),true;let pt=partyOf(inv);if(!pt){pt={id:pidc++,leader:inv.id,members:new Set([inv.id])};parties.set(pt.id,pt);inv.party=pt.id}
    if(pt.members.size>=4)return sys(p,'Party-ul este plin.'),true;pt.members.add(p.id);p.party=pt.id;for(const id of pt.members){const q=players.get(id);if(q)sys(q,p.name+' s-a alăturat party-ului.')}pushParty(pt);return true}
  /* ---- ghilde ---- */
  async function loadGuild(p){p.guild=await db.guildOf(p.id)}
  async function refreshGuild(cid){const q=players.get(cid);if(q)await loadGuild(q)}
  function gOnline(gid){return[...players.values()].filter(q=>q.guild&&q.guild.id===gid)}
  function gmsg(gid,m){for(const q of gOnline(gid))sys(q,'[Ghildă] '+m)}
  async function guildCmd(p,c,a){
    if(c==='gcreate'){if(p.guild)return sys(p,'Ești deja într-o ghildă.');const tag=a[0],name=a.slice(1).join(' ');if(!GTAG.test(tag||'')||!GNAME.test(name))return sys(p,'Folosește: /gcreate TAG Nume Ghildă (tag 2–4 litere/cifre, nume 3–20)');
      const id=await db.createGuild(name,tag.toUpperCase(),p.id);if(!id)return sys(p,'Numele ghildei este luat.');await loadGuild(p);db.audit(p.acc,'guild_create',name);return sys(p,'Ai creat ghilda '+name+' ['+tag.toUpperCase()+'].')}
    if(c==='gaccept'){const iv=ginv.get(p.id);if(!iv||iv.exp<Date.now()){ginv.delete(p.id);return sys(p,'Nu ai invitații de ghildă.')}ginv.delete(p.id);if(p.guild)return sys(p,'Ești deja într-o ghildă.');
      if(!await db.addGuildMember(iv.gid,p.id))return sys(p,'Nu s-a putut intra în ghildă.');await loadGuild(p);return gmsg(iv.gid,p.name+' s-a alăturat ghildei.')}
    if(c==='ginfo'){if(!p.guild)return sys(p,'Nu ești într-o ghildă.');const ms=await db.guildMembers(p.guild.id);sys(p,'Ghilda '+p.guild.name+' ['+p.guild.tag+'] — '+ms.length+' membri');
      for(const m of ms)sys(p,' · '+m.name+' ('+m.rank+')'+(players.has(m.id)?' • online':''));return}
    const g=p.guild;if(!g)return sys(p,'Nu ești într-o ghildă.');const rk=GR[g.rank];
    if(c==='gleave'){if(g.rank==='LEADER'){if((await db.guildMembers(g.id)).length>1)return sys(p,'Liderul trebuie să predea conducerea (/gleader Nume) înainte să plece.');await db.deleteGuild(g.id);p.guild=null;return sys(p,'Ghilda a fost desființată.')}
      await db.removeGuildMember(p.id);p.guild=null;gmsg(g.id,p.name+' a părăsit ghilda.');return sys(p,'Ai părăsit ghilda.')}
    if(c==='gdisband'){if(g.rank!=='LEADER')return sys(p,'Doar liderul poate desființa ghilda.');const ids=(await db.guildMembers(g.id)).map(m=>m.id);await db.deleteGuild(g.id);for(const id of ids)await refreshGuild(id);return sys(p,'Ghilda a fost desființată.')}
    const tn=a[0];if(!tn)return sys(p,'Specifică un nume de erou.');
    if(c==='ginvite'){if(rk<1)return sys(p,'Doar ofițerii și liderul pot invita.');const t=find(tn);if(!t||t===p)return sys(p,'Jucătorul nu este online.');if(t.guild)return sys(p,t.name+' este deja într-o ghildă.');
      ginv.set(t.id,{gid:g.id,exp:Date.now()+60000});sys(p,'Invitație trimisă.');return sys(t,p.name+' te invită în ghilda '+g.name+'. Scrie /gaccept (60s).')}
    const row=await db.charByName(tn);const tm=row&&(await db.guildMembers(g.id)).find(m=>m.id===row.id);if(!tm)return sys(p,'Jucătorul nu este în ghilda ta.');
    if(c==='gkick'){if(rk<1||GR[tm.rank]>=rk)return sys(p,'Nu ai rangul necesar pentru a elimina acest membru.');await db.removeGuildMember(tm.id);await refreshGuild(tm.id);return gmsg(g.id,tm.name+' a fost eliminat de '+p.name+'.')}
    if(g.rank!=='LEADER')return sys(p,'Doar liderul poate schimba rangurile.');if(tm.id===p.id)return;
    if(c==='gpromote'){if(tm.rank!=='MEMBER')return sys(p,'Este deja ofițer.');await db.setGuildRank(tm.id,'OFFICER');await refreshGuild(tm.id);return gmsg(g.id,tm.name+' a devenit ofițer.')}
    if(c==='gdemote'){if(tm.rank!=='OFFICER')return sys(p,'Nu este ofițer.');await db.setGuildRank(tm.id,'MEMBER');await refreshGuild(tm.id);return gmsg(g.id,tm.name+' a devenit membru.')}
    if(c==='gleader'){await db.setGuildRank(tm.id,'LEADER');await db.setGuildRank(p.id,'OFFICER');await refreshGuild(tm.id);await loadGuild(p);return gmsg(g.id,tm.name+' este noul lider.')}}
  /* ---- staff / GM ---- */
  const need=(p,perm)=>{if(PERM.can(p.role,perm))return true;db.audit(p.acc,'gm_denied',p.name+' '+perm);sys(p,'Nu ai permisiunea necesară.');return false};
  function sensitive(p,perm,label,fn){if(!need(p,perm))return;const code=String(1000+Math.floor(Math.random()*9000));confirms.set(p.id,{code,fn,label,exp:Date.now()+30000});sys(p,'Acțiune sensibilă: '+label+'. Confirmă în 30s cu /confirm '+code)}
  async function staffCmd(p,c,a){
    const aud=(k,d)=>db.audit(p.acc,k,p.name+': '+d);
    switch(c){
    case'confirm':{const x=confirms.get(p.id);confirms.delete(p.id);if(!x||x.exp<Date.now()||x.code!==a[0])return sys(p,'Confirmare invalidă sau expirată.');await x.fn();return}
    case'kick':{if(!need(p,'player.kick'))return;const t=find(a[0]);if(!t)return sys(p,'Jucătorul nu este online.');if(PERM.valid(t.role)&&t.role!=='PLAYER'&&PERM.RANKS.indexOf(t.role)>=PERM.RANKS.indexOf(p.role))return sys(p,'Nu poți da kick unui rang egal sau superior.');
      aud('gm_kick',t.name+' '+a.slice(1).join(' '));send(t.ws,{t:'err',c:'kicked',m:'Ai fost eliminat de un moderator.'});const w=t.ws;t.ws=null;saveNow(t);setTimeout(()=>{try{w.close(4001,'kicked')}catch(e){}},50);return sys(p,t.name+' a fost eliminat.')}
    case'mute':{if(!need(p,'chat.mute'))return;const mins=Math.max(1,Math.min(1440,+a[1]||10)),row=await db.charByName(a[0]);if(!row)return sys(p,'Erou necunoscut.');const ti=await db.accInfo(row.account_id);
      if(ti.role!=='PLAYER'&&PERM.RANKS.indexOf(ti.role)>=PERM.RANKS.indexOf(p.role))return sys(p,'Nu poți reduce la tăcere un rang egal sau superior.');const until=Date.now()+mins*60000;await db.setMute(row.account_id,until);const t=find(a[0]);if(t){t.mutedUntil=until;sys(t,'Ai fost redus la tăcere '+mins+' min.')}aud('gm_mute',row.name+' '+mins+'min');return sys(p,row.name+' redus la tăcere '+mins+' min.')}
    case'unmute':{if(!need(p,'chat.mute'))return;const row=await db.charByName(a[0]);if(!row)return sys(p,'Erou necunoscut.');await db.setMute(row.account_id,0);const t=find(a[0]);if(t)t.mutedUntil=0;aud('gm_unmute',row.name);return sys(p,'Mute ridicat.')}
    case'tp':{if(!need(p,'player.teleport'))return;const t=find(a[0]);if(!t)return sys(p,'Jucătorul nu este online.');moveTo(p,t.zone,t.x,t.y);aud('gm_tp',t.name);return}
    case'announce':{if(!need(p,'server.announce'))return;const m=a.join(' ').slice(0,200);if(!m)return;aud('gm_announce',m);for(const q of players.values())send(q.ws,{t:'chat',ch:'system',from:'Anunț',m:'📢 '+m,ts:Date.now()});return}
    case'audit':{if(!need(p,'audit.view'))return;const n=Math.max(1,Math.min(20,+a[0]||10));for(const r of(await db.audits(n)).reverse())sys(p,new Date(r.ts).toISOString().slice(11,19)+' '+r.kind+' '+(r.detail||''));return}
    case'unban':{if(!need(p,'player.ban'))return;const row=await db.charByName(a[0]);if(!row)return sys(p,'Erou necunoscut.');await db.setBan(row.account_id,0);aud('gm_unban',row.name);return sys(p,'Ban ridicat.')}
    case'ban':{const row=await db.charByName(a[0]);if(!row)return need(p,'player.ban')&&sys(p,'Erou necunoscut.');const mins=Math.max(1,Math.min(525600,+a[1]||60)),why=a.slice(2).join(' ');const ti=await db.accInfo(row.account_id);
      if(!need(p,'player.ban'))return;if(ti.role!=='PLAYER'&&PERM.RANKS.indexOf(ti.role)>=PERM.RANKS.indexOf(p.role))return sys(p,'Nu poți bana un rang egal sau superior.');
      return sensitive(p,'player.ban','ban '+row.name+' '+mins+' min',async()=>{if(!PERM.can(p.role,'player.ban'))return;await db.setBan(row.account_id,Date.now()+mins*60000);aud('gm_ban',row.name+' '+mins+'min '+why);const t=find(a[0]);if(t){send(t.ws,{t:'err',c:'banned',m:'Contul este suspendat.'});const w=t.ws;t.ws=null;saveNow(t);setTimeout(()=>{try{w.close(4002,'banned')}catch(e){}},50)}sys(p,row.name+' a fost banat.')})}
    case'grantgold':{const t=find(a[0]),n=Math.floor(+a[1]);if(!need(p,'gold.grant'))return;if(!t||!(n>=1&&n<=1000000))return sys(p,'Folosește: /grantgold Nume 1..1000000 (jucător online)');
      return sensitive(p,'gold.grant','+'+n+' aur pentru '+t.name,()=>{if(!PERM.can(p.role,'gold.grant')||!players.has(t.id))return;t.gold+=n;t.dirty=1;ctx.sendInv(t);aud('gm_grantgold',t.name+' +'+n);sys(p,'Acordat.');sys(t,'Ai primit '+n+' aur de la staff.')})}
    case'setrole':{const row=await db.charByName(a[0]),role=String(a[1]||'').toUpperCase();if(!row||!PERM.valid(role))return sys(p,'Folosește: /setrole Nume RANG ('+PERM.RANKS.join(', ')+')');const ti=await db.accInfo(row.account_id);
      if(!PERM.canGrantRank(p.role,role)||PERM.RANKS.indexOf(ti.role)>=PERM.RANKS.indexOf(p.role)){aud('gm_denied','setrole '+row.name+' '+role);return sys(p,'Nu poți acorda acest rang.')}
      return sensitive(p,role==='ADMINISTRATOR'?'role.grant.admin':'role.grant.lower','rang '+role+' pentru '+row.name,async()=>{if(!PERM.canGrantRank(p.role,role))return;await db.setRole(row.account_id,role);const t=find(a[0]);if(t)t.role=role;aud('gm_setrole',row.name+' -> '+role);sys(p,'Rang schimbat.')})}
    }}
  const PARTY=new Set(['invite','pinvite','accept','paccept','decline','leave','pleave','pkick','plead','party']),G=new Set(['gcreate','ginvite','gaccept','gleave','gkick','gpromote','gdemote','gleader','ginfo','gdisband']),STAFF=new Set(['kick','mute','unmute','tp','announce','ban','unban','grantgold','setrole','audit','confirm']);
  async function command(p,msg){const parts=msg.slice(1).split(/\s+/),c=parts[0].toLowerCase(),a=parts.slice(1);
    if(PARTY.has(c)){switch(c){case'invite':case'pinvite':partyInvite(p,a[0]);break;case'accept':case'paccept':if(!partyAccept(p))sys(p,'Nu ai nicio invitație.');break;case'decline':pinv.delete(p.id);ginv.delete(p.id);sys(p,'Invitație refuzată.');break;
      case'leave':case'pleave':partyLeave(p);break;case'party':{const pt=partyOf(p);sys(p,pt?'Party: '+[...pt.members].map(id=>(players.get(id)||{}).name).join(', '):'Nu ești într-un party.');break}
      case'pkick':{const pt=partyOf(p);if(!pt||pt.leader!==p.id)return sys(p,'Doar liderul poate elimina.'),true;const t=find(a[0]);if(t&&pt.members.has(t.id)&&t!==p){partyLeave(t);sys(t,'Ai fost eliminat din party.')}break}
      case'plead':{const pt=partyOf(p);if(!pt||pt.leader!==p.id)return sys(p,'Doar liderul poate preda conducerea.'),true;const t=find(a[0]);if(t&&pt.members.has(t.id)){pt.leader=t.id;pushParty(pt)}break}}return true}
    if(G.has(c)){await guildCmd(p,c,a);return true}
    if(STAFF.has(c)){await staffCmd(p,c,a);return true}return false}
  function xpRecipients(m,z){const ids=new Set();for(const pid of m.contrib.keys()){const q=players.get(pid);if(!q||q.zone!==z.id)continue;ids.add(pid);const pt=partyOf(q);if(pt)for(const id of pt.members){const r=players.get(id);if(r&&!r.dead&&r.zone===z.id&&dist(r,m)<=25)ids.add(id)}}return[...ids]}
  const mates=p=>{const pt=partyOf(p);return pt?[...pt.members].map(id=>players.get(id)).filter(Boolean):null};
  let tt=0;
  return{command,xpRecipients,loadGuild,staffTag,
    partyMembers:mates,guildOnline:p=>p.guild?gOnline(p.guild.id):null,
    onLeave(p){partyLeave(p,false);pinv.delete(p.id);ginv.delete(p.id);confirms.delete(p.id)},
    tick(now){if(now-tt<1000)return;tt=now;for(const pt of parties.values())pushParty(pt)}}
};
