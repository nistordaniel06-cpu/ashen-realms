const path=require('path'),fs=require('fs');const SCR=path.resolve(__dirname,'..');process.chdir(path.join(SCR,'render'));
const {X}=require(path.join(SCR,'render/h7.js'));const out={};
for(const [id,v] of Object.entries(X.IT)){if(!['w','a','h','g','b'].includes(v.slot))continue;out[id]={slot:v.slot,lv:v.lv||v.req||1,cls:v.cls?(Array.isArray(v.cls)?v.cls:[v.cls]):[]}}
// verifică formatul cls
fs.writeFileSync(path.join(__dirname,'server/gear.json'),JSON.stringify(out));console.log(Object.keys(out).length,'piese',JSON.stringify(out.w1),JSON.stringify(out.w6),JSON.stringify(out.a1),JSON.stringify(out.bow2));
