// Build simplified, projected SVG paths for every country from Natural Earth 50m.
//
// Simplification is TOPOLOGY-AWARE: a border shared by two countries is split out as an arc,
// simplified once, and reused by both sides. Simplifying each country's rings independently
// (the previous approach) let the two sides of every shared border drift apart by up to twice
// the tolerance, which showed up as sea-coloured slivers between countries at high zoom.
const fs = require('fs');
const SRC = __dirname + '/world50.geojson';

// ---- Equal Earth projection (Savric, Patterson & Jenny 2018) ----
const A1=1.340264, A2=-0.081106, A3=0.000893, A4=0.003796, M=Math.sqrt(3)/2;
function project(lon, lat){
  const l = lon*Math.PI/180, p = lat*Math.PI/180;
  const t = Math.asin(M*Math.sin(p)), t2=t*t, t6=t2*t2*t2;
  const x = l*Math.cos(t)/(M*(A1+3*A2*t2+t6*(7*A3+9*A4*t2)));
  const y = t*(A1+A2*t2+t6*(A3+A4*t2));
  return [x, -y];
}

// ---- Douglas-Peucker (iterative, so long coastlines cannot blow the stack) ----
function perp(p, a, b){
  const dx=b[0]-a[0], dy=b[1]-a[1];
  const m=dx*dx+dy*dy;
  if(m===0) return Math.hypot(p[0]-a[0], p[1]-a[1]);
  let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/m;
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(p[0]-(a[0]+t*dx), p[1]-(a[1]+t*dy));
}
function dp(pts, tol){
  const n=pts.length;
  if(n<3) return pts.slice();
  const keep=new Uint8Array(n); keep[0]=keep[n-1]=1;
  const stack=[[0,n-1]];
  while(stack.length){
    const seg=stack.pop(), a=seg[0], b=seg[1];
    let maxD=-1, idx=-1;
    for(let i=a+1;i<b;i++){ const d=perp(pts[i],pts[a],pts[b]); if(d>maxD){maxD=d; idx=i;} }
    if(idx>0 && maxD>tol){ keep[idx]=1; stack.push([a,idx],[idx,b]); }
  }
  const out=[]; for(let i=0;i<n;i++) if(keep[i]) out.push(pts[i]);
  return out;
}
function ringArea(r){ let a=0; for(let i=0,j=r.length-1;i<r.length;j=i++) a+=(r[j][0]*r[i][1]-r[i][0]*r[j][1]); return Math.abs(a/2); }
function ringCentroid(r){
  let a=0,cx=0,cy=0;
  for(let i=0,j=r.length-1;i<r.length;j=i++){
    const f=r[j][0]*r[i][1]-r[i][0]*r[j][1];
    a+=f; cx+=(r[j][0]+r[i][0])*f; cy+=(r[j][1]+r[i][1])*f;
  }
  if(Math.abs(a)<1e-12){ let sx=0,sy=0; r.forEach(p=>{sx+=p[0];sy+=p[1];}); return [sx/r.length, sy/r.length]; }
  a*=0.5; return [cx/(6*a), cy/(6*a)];
}

// Siachen Glacier is kept (as a non-playable territory) rather than skipped: dropping it left a
// real hole in the map between India, Pakistan and China.
const ISO_FIX = { 'Somaliland':'XS', 'Northern Cyprus':'XN', 'Siachen Glacier':'XSI', 'Kosovo':'XK' };
const PLAYABLE = new Set(('AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW PS TW XK').split(/\s+/));

const TOL = 0.05;               // degrees
const MIN_RING_AREA = 0.012;    // sq degrees; small islands dropped unless a country's only ring
const SKIP_ADMIN = new Set(['Antarctica']);

const g = JSON.parse(fs.readFileSync(SRC,'utf8'));

// ---------- 1. collect rings, tagged with the country that owns them ----------
const countries = [];
const rings = [];
const byIso = new Map();

for(const f of g.features){
  const p = f.properties;
  if(SKIP_ADMIN.has(p.ADMIN)) continue;
  let iso = p.ISO_A2_EH;
  if(!iso || iso==='-99') iso = ISO_FIX[p.ADMIN];
  if(!iso) continue;

  let c = byIso.get(iso);
  if(!c){ c = { iso, admin:p.ADMIN, name:p.NAME, ringIdx:[] }; byIso.set(iso,c); countries.push(c); }

  const polys = f.geometry.type==='Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for(const poly of polys){
    if(!poly.length) continue;
    const outer = poly[0];
    if(!outer || outer.length<4) continue;
    if(ringArea(outer) < MIN_RING_AREA && c.ringIdx.length) continue;   // skip specks, keep at least one
    for(let h=0; h<poly.length; h++){
      const r = poly[h];
      if(!r || r.length<4) continue;
      if(h>0 && ringArea(r) < MIN_RING_AREA) continue;                  // ignore trivial holes
      c.ringIdx.push(rings.length);
      rings.push({ pts: r.slice(0, r.length-1), owner:c.iso, isHole:h>0 });
    }
  }
}

// ---------- 2. which countries touch each vertex ----------
const K = p => p[0].toFixed(6)+','+p[1].toFixed(6);
const owners = new Map();
for(const r of rings){
  for(const p of r.pts){
    const k = K(p);
    let s = owners.get(k); if(!s){ s=new Set(); owners.set(k,s); }
    s.add(r.owner);
  }
}

// ---------- 3. cut each ring into arcs on edge signature ----------
// An edge's signature is the set of countries present at BOTH endpoints. Consecutive edges with
// the same signature form one arc; a signature of two or more countries means a shared border.
const arcStore = new Map();
const ringArcs = [];

function edgeSig(a, b){
  const sa = owners.get(K(a)), sb = owners.get(K(b));
  const both = [];
  for(const x of sa) if(sb.has(x)) both.push(x);
  return both.sort().join('');
}
// Each arc carries its own tolerance. A shared arc reached from two rings keeps the smaller of
// the two, so both sides still simplify identically and no gap can open.
function addArc(pts, tol){
  const fwd = pts.map(K).join(';');
  const rev = pts.slice().reverse().map(K).join(';');
  const isRev = fwd > rev;
  const key = isRev ? rev : fwd;
  const cur = arcStore.get(key);
  if(!cur) arcStore.set(key, { pts: isRev ? pts.slice().reverse() : pts.slice(), tol });
  else cur.tol = Math.min(cur.tol, tol);
  return { key, rev:isRev };
}
// A whole country smaller than the global tolerance (Monaco, Vatican City, Nauru, Tuvalu, the
// Maldives atolls) would otherwise be simplified out of existence. Scale the tolerance to the
// ring so something always survives.
function ringTol(pts){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const q of pts){ if(q[0]<x0)x0=q[0]; if(q[0]>x1)x1=q[0]; if(q[1]<y0)y0=q[1]; if(q[1]>y1)y1=q[1]; }
  return Math.min(TOL, Math.hypot(x1-x0, y1-y0)/8);
}

for(const r of rings){
  const n = r.pts.length;
  const sigs = new Array(n);
  for(let i=0;i<n;i++) sigs[i] = edgeSig(r.pts[i], r.pts[(i+1)%n]);

  let start = -1;
  for(let i=0;i<n;i++) if(sigs[i] !== sigs[(i-1+n)%n]){ start = i; break; }

  const list = [];
  const rt = ringTol(r.pts);
  if(start === -1){
    // uniform ring (an island, or a border shared along its whole length): cut in two so
    // Douglas-Peucker has real endpoints to anchor on
    const half = Math.max(1, Math.floor(n/2));
    list.push(addArc(r.pts.slice(0, half+1), rt));
    list.push(addArc(r.pts.slice(half).concat([r.pts[0]]), rt));
  }else{
    let i = start;
    do{
      const sig = sigs[i];
      const pts = [r.pts[i]];
      let j = i;
      do{
        pts.push(r.pts[(j+1)%n]);
        j = (j+1)%n;
      }while(sigs[j] === sig && j !== start);
      list.push(addArc(pts, rt));
      i = j;
    }while(i !== start);
  }
  ringArcs.push(list);
}

// ---------- 4. simplify every unique arc exactly once ----------
for(const a of arcStore.values()) a.simp = dp(a.pts, a.tol);
console.log('rings:', rings.length, '| unique arcs:', arcStore.size);

// ---------- 5. rebuild rings from the shared, simplified arcs ----------
const rebuilt = rings.map((r, ri) => {
  const out = [];
  for(const ref of ringArcs[ri]){
    let pts = arcStore.get(ref.key).simp;
    if(ref.rev) pts = pts.slice().reverse();
    for(let i = out.length ? 1 : 0; i < pts.length; i++) out.push(pts[i]);
  }
  if(out.length > 1 && K(out[0]) === K(out[out.length-1])) out.pop();
  return out;
});

// ---------- 6. project, scale, emit ----------
const LAT_CLIP = -60;
let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
const projRings = rebuilt.map(r => r.map(pair => {
  const q = project(pair[0], Math.max(pair[1], LAT_CLIP));
  if(q[0]<minX)minX=q[0]; if(q[0]>maxX)maxX=q[0];
  if(q[1]<minY)minY=q[1]; if(q[1]>maxY)maxY=q[1];
  return q;
}));

const W = 2000;
const scale = W/(maxX-minX);
const H = Math.round((maxY-minY)*scale);
const R = n => Math.round(n*10)/10;
const fx = x => R((x-minX)*scale), fy = y => R((y-minY)*scale);

const out = [];
const tiny = [];
for(const c of countries){
  let d = '';
  const screenRings = [], holeFlags = [];
  for(const ri of c.ringIdx){
    const pr = projRings[ri];
    if(pr.length < 3) continue;
    let seg='', px=null, py=null, count=0;
    for(const xy of pr){
      const x=fx(xy[0]), y=fy(xy[1]);
      if(px===null){ seg += 'M'+x+' '+y; count++; }
      else if(x!==px || y!==py){ seg += 'L'+x+' '+y; count++; }
      px=x; py=y;
    }
    if(count>=3){
      d += seg+'Z';
      screenRings.push(pr.map(xy=>[fx(xy[0]),fy(xy[1])]));
      holeFlags.push(rings[ri].isHole);
    }
  }
  // Centroid comes from the full-precision projected geometry, so it survives even when the
  // rounded path does not. Microstates (Vatican City, Monaco, Nauru, Tuvalu, Maldives) are
  // smaller than one output unit; they must never be dropped, they are played via their pin.
  const allProj = c.ringIdx.map(ri=>projRings[ri]).filter(r=>r.length>=3);
  if(!allProj.length) continue;
  const projSolid = c.ringIdx.map((ri,i)=>({r:projRings[ri],hole:rings[ri].isHole}))
                             .filter(o=>o.r.length>=3 && !o.hole).map(o=>o.r);
  const bigProj = (projSolid.length?projSolid:allProj).slice()
                    .sort((a,b)=>ringArea(b.map(xy=>[fx(xy[0]),fy(xy[1])]))-ringArea(a.map(xy=>[fx(xy[0]),fy(xy[1])])))[0];
  const cen = ringCentroid(bigProj.map(xy=>[(xy[0]-minX)*scale,(xy[1]-minY)*scale]));
  const cx = R(cen[0]), cy = R(cen[1]);

  if(!d){
    // too small to survive rounding: emit a minimal marker so the country still exists
    const h = 0.4;
    d = 'M'+R(cx-h)+' '+cy+'L'+cx+' '+R(cy-h)+'L'+R(cx+h)+' '+cy+'L'+cx+' '+R(cy+h)+'Z';
    tiny.push(c.iso);
  }
  const solid = screenRings.filter((_,i)=>!holeFlags[i]);
  const holes = screenRings.filter((_,i)=>holeFlags[i]);
  const area = solid.reduce((s,r)=>s+ringArea(r),0) - holes.reduce((s,r)=>s+ringArea(r),0);
  out.push({ iso:c.iso, admin:c.admin, name:c.name, d, cx, cy, area:Math.round(Math.max(area,0)) });
}

const playable = out.filter(e=>PLAYABLE.has(e.iso));
const territory = out.filter(e=>!PLAYABLE.has(e.iso));
const missing = [...PLAYABLE].filter(i=>!playable.find(e=>e.iso===i));
console.log('viewBox 0 0', W, H);
console.log('playable:', playable.length, '| territories:', territory.length);
console.log('MISSING:', missing.join(',') || '(none)');
console.log('pins needed (area<16):', playable.filter(e=>e.area<16).length);
console.log('sub-unit (marker polygon):', tiny.join(' ') || '(none)');

// The exact projection extent, so the satellite raster can be reprojected onto the identical
// Equal Earth frame as the vector borders.
const ext = { minX, maxX, minY, maxY, scale, latClip: LAT_CLIP };
fs.writeFileSync(__dirname+'/map_data.json', JSON.stringify({W,H,ext,
  playable:playable.map(e=>({iso:e.iso,admin:e.admin,name:e.name,d:e.d,cx:e.cx,cy:e.cy,area:e.area})),
  territory:territory.map(e=>({iso:e.iso,name:e.name,d:e.d}))}));
console.log('map_data.json:', (fs.statSync(__dirname+'/map_data.json').size/1024).toFixed(0), 'KB');
