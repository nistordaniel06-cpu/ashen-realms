'use strict';
// Coalesce and serialize character saves; retry transient failures.
function createSaveQueue(write,{retryMs=1000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const jobs=new Map();
 function enqueue(snapshot){
  const id=snapshot.id;let job=jobs.get(id);
  if(!job){job={latest:null,task:null};jobs.set(id,job)}
  job.latest=structuredClone(snapshot);
  if(!job.task){job.task=(async()=>{while(job.latest){const next=job.latest;job.latest=null;try{await write(next)}catch(e){if(!job.latest)job.latest=next;await sleep(retryMs)}}})().finally(()=>{job.task=null;if(!job.latest)jobs.delete(id)})}
  return job.task;
 }
 async function flush({timeoutMs=10000}={}){
  const tasks=[...jobs.values()].map(j=>j.task).filter(Boolean);if(!tasks.length)return;
  let timer;try{await Promise.race([Promise.all(tasks),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('save flush timeout')),timeoutMs)})])}finally{clearTimeout(timer)}
 }
 return {enqueue,flush,get pending(){return jobs.size}};
}
module.exports={createSaveQueue};
