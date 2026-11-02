'use strict';
// NIDRAVEN V10 — învelitoare async peste adaptorul SQLite (node:sqlite este sincron). Aceeași interfață ca db-postgres.js.
module.exports=function wrap(sync){
  const o={kind:'sqlite',raw:sync.raw,isTransient:()=>false};
  for(const k of Object.keys(sync))if(typeof sync[k]==='function'&&k!=='raw')o[k]=async(...a)=>sync[k](...a);
  o.ping=async()=>{sync.raw.prepare('SELECT 1').get();return true};
  o.stats=()=>({kind:'sqlite'});
  return o;
};
