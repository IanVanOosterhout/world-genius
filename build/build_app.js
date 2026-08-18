const fs=require('fs'), path=require('path');
const D=__dirname;
const OUT=require('path').join(__dirname,'..','index.html');

const map=JSON.parse(fs.readFileSync(D+'/map_data.json','utf8'));
const facts=JSON.parse(fs.readFileSync(D+'/facts_all.json','utf8'));

const flags={};
for(const c of map.playable){
  const f=D+'/flags/'+c.iso.toLowerCase()+'.webp';
  if(!fs.existsSync(f)) throw new Error('missing flag '+c.iso);
  flags[c.iso]=fs.readFileSync(f).toString('base64');
}

// Satellite imagery ships as a pyramid of tiles (see build_sat.py); inline every one of them.
const satDir = D+'/sat';
if(!fs.existsSync(satDir+'/manifest.json')) throw new Error('sat/manifest.json missing - run: python3 build_sat.py');
const satManifest = JSON.parse(fs.readFileSync(satDir+'/manifest.json','utf8'));
const satB64 = f => {
  const p = satDir+'/'+f;
  if(!fs.existsSync(p)) throw new Error('missing satellite tile '+f);
  return fs.readFileSync(p).toString('base64');
};
const sat = {
  base: satB64(satManifest.base),
  levels: satManifest.levels.map(L => ({
    cols:L.cols, rows:L.rows, tw:L.tw, th:L.th, bleed:L.bleed,
    tiles: Object.fromEntries(Object.entries(L.tiles).map(([k,f]) => [k, satB64(f)]))
  }))
};
const satTileCount = satManifest.levels.reduce((n,L)=>n+Object.keys(L.tiles).length, 0);

let html=fs.readFileSync(D+'/app_template.html','utf8');
const inject=(token,obj)=>{
  const t='/*__'+token+'__*/';
  if(!html.includes(t)) throw new Error('token missing: '+token);
  html=html.replace(t, JSON.stringify(obj));
};
inject('MAP',map);
inject('FACTS',facts);
inject('FLAGS',flags);
inject('SAT',sat);

if(html.includes('/*__')) throw new Error('unreplaced token remains');

// Parse the generated inline script before writing. A malformed injection kills the whole app
// silently in the browser, so fail here instead.
const m = html.match(/<script>\n"use strict";([\s\S]*?)<\/script>/);
if(!m) throw new Error('could not locate inline script for validation');
new (require('vm').Script)('"use strict";'+m[1], {filename:'app.js'});

fs.writeFileSync(OUT,html);
const kb=n=>(n/1024).toFixed(0)+' KB';
console.log('wrote', OUT);
console.log('  total   ', kb(Buffer.byteLength(html)));
console.log('  map     ', kb(JSON.stringify(map).length));
console.log('  facts   ', kb(JSON.stringify(facts).length));
console.log('  flags   ', kb(JSON.stringify(flags).length), '('+Object.keys(flags).length+' flags)');
console.log('  satellite', kb(JSON.stringify(sat).length), '(base + '+satTileCount+' tiles across '+sat.levels.length+' levels)');
