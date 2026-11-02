'use strict';
// Ranguri staff (separate de rangurile de ghildă). Verificate DOAR pe server. Niciun mesaj de la client nu poate schimba un rang.
const RANKS=['PLAYER','MODERATOR','TRIAL_GM','GAME_MASTER','HEAD_GM','ADMINISTRATOR','FOUNDER'];
const LEVEL=Object.fromEntries(RANKS.map((r,i)=>[r,i]));
// permisiune -> rang minim. PREGĂTIT: nu există încă comenzi GM/panou care să le folosească (V8.5+).
const PERMS={
  'chat.staff':'MODERATOR','chat.mute':'MODERATOR','chat.report.view':'MODERATOR',
  'player.kick':'TRIAL_GM','player.teleport':'GAME_MASTER','player.ban':'HEAD_GM',
  'item.grant':'HEAD_GM','gold.grant':'ADMINISTRATOR','xp.grant':'HEAD_GM',
  'event.spawn':'GAME_MASTER','server.announce':'GAME_MASTER','audit.view':'HEAD_GM',
  'role.grant.lower':'ADMINISTRATOR','role.grant.admin':'FOUNDER','server.config':'FOUNDER'
};
const CONFIRM=new Set(['player.ban','item.grant','gold.grant','role.grant.lower','role.grant.admin','server.config']); // necesită confirmare explicită
const valid=r=>Object.prototype.hasOwnProperty.call(LEVEL,r);
const can=(role,perm)=>valid(role)&&PERMS[perm]!==undefined&&LEVEL[role]>=LEVEL[PERMS[perm]];
// Poți acorda un rang doar unuia strict sub al tău; FOUNDER nu se acordă niciodată prin joc.
const canGrantRank=(actor,target)=>valid(actor)&&valid(target)&&target!=='FOUNDER'&&LEVEL[actor]>LEVEL[target]&&can(actor,LEVEL[target]>=LEVEL.ADMINISTRATOR?'role.grant.admin':'role.grant.lower');
// FOUNDER = identitatea configurată în mediul serverului (FOUNDER_ACCOUNT), nu o parolă/flag din client.
const isFounderIdentity=(name,env=process.env)=>!!env.FOUNDER_ACCOUNT&&String(name).toLowerCase()===env.FOUNDER_ACCOUNT.toLowerCase();
module.exports={RANKS,PERMS,CONFIRM,can,canGrantRank,valid,isFounderIdentity};
