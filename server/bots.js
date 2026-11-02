// Test de încărcare simplu: N boți autentificați care se mișcă, atacă și scriu. Raportează durata tick-ului și memoria.
const WebSocket=require('ws');const {start}=require('./server.js');const os=require('os'),path=require('path'),fs=require('fs');
const N=+process.argv[2]||40;
(async()=>{const dbp=path.join(os.tmpdir(),'bots-'+Date.now()+'.db');const S=await start({port:0,dbPath:dbp,host:'127.0.0.1'});
 const bots=[];let snaps=0,errs=0;
 for(let i=0;i<N;i++){const ws=new WebSocket('ws://127.0.0.1:'+S.port);const b={ws,i};bots.push(b);
  ws.on('message',d=>{const m=JSON.parse(d);if(m.t==='snap'){snaps++;b.snap=m}if(m.t==='err')errs++;
   if(m.t==='auth'&&!b.j){b.j=1;if(m.chars.length)ws.send(JSON.stringify({t:'join',id:m.chars[0].id}));else ws.send(JSON.stringify({t:'newchar',n:'Bot'+i+'x',cls:1+i%4}))}
   if(m.t==='chars')ws.send(JSON.stringify({t:'join',id:m.chars[0].id}))});
  await new Promise(r=>ws.on('open',r));ws.send(JSON.stringify({t:'reg',u:'bot'+i+'_u',p:'parola-bot-'+i}))}
 await new Promise(r=>setTimeout(r,2500));
 // teleportează jumătate în pădure
 const W=S.world;let k=0;for(const p of W.players.values()){if(k++%2){W.zones[p.zone].players.delete(p);p.zone='forest';W.zones.forest.players.add(p);p.x=W.zones.forest.SP.x;p.y=W.zones.forest.SP.y}}
 const t0=Date.now();const iv=setInterval(()=>{for(const b of bots){if(b.ws.readyState!==1)continue;const a=Math.random()*6.28;b.ws.send(JSON.stringify({t:'in',dx:Math.cos(a),dy:Math.sin(a),seq:1}));
   if(Math.random()<.3&&b.snap&&b.snap.mo&&b.snap.mo.length){const m=b.snap.mo[Math.floor(Math.random()*b.snap.mo.length)];b.ws.send(JSON.stringify({t:'atk',tid:m.id}))}
   if(Math.random()<.05)b.ws.send(JSON.stringify({t:'chat',ch:'local',m:'salut '+b.i}))}},150);
 // măsoară întârzierea buclei de evenimente
 let maxLag=0,sum=0,n=0,last=Date.now();const lagIv=setInterval(()=>{const now=Date.now(),lag=now-last-20;last=now;maxLag=Math.max(maxLag,lag);sum+=lag;n++},20);
 await new Promise(r=>setTimeout(r,12000));clearInterval(iv);clearInterval(lagIv);
 const secs=(Date.now()-t0)/1000;
 console.log(`${N} boți | jucători în lume: ${W.players.size} | snapshot-uri/s primite: ${(snaps/secs).toFixed(0)} | lag mediu buclă ${(sum/n).toFixed(1)} ms, maxim ${maxLag} ms | erori protocol: ${errs} | RSS ${(process.memoryUsage().rss/1e6).toFixed(0)} MB`);
 await S.close();try{fs.unlinkSync(dbp)}catch(e){}process.exit(0)})();
