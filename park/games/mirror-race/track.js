// Original closed street circuit. Logical metres; rendered uniformly into the lot.
export const LAPS = 2, GRID = 8;
export const ROAD_HALF_WIDTH = 10.5, GATE_HALF_OPEN = 3.7;
export const MODES = {
  easy: { label: 'EASY', maxSpeed: 32, grip: 7, rival: .48, gates: false, blocks: false, bridge: 10.5 },
  hard: { label: 'HARD', maxSpeed: 37, grip: 5.8, rival: .55, gates: true, blocks: false, bridge: 8.5 },
  maximum: { label: 'MAXIMUM', maxSpeed: 41, grip: 5.1, rival: .60, gates: true, blocks: true, bridge: 7 }
};
export const NODES = [
  [0, 1, 95], [-65, 1, 95], [-125, 1, 80], [-150, 2, 40], [-135, 5, 4],
  [-96, 9, -12], [-68, 12, -46], [-98, 5, -81], [-145, 1, -101],
  [-125, 1, -140], [-55, 1, -151], [-7, 1, -126], [24, 1, -149],
  [90, 1, -134], [146, 1, -100], [155, 2, -53], [128, 3, -25],
  [82, 4, -46], [44, 2, -15], [79, 1, 15], [130, 1, 27],
  [147, 1, 65], [107, 1, 102], [49, 1, 95]
];
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const wrap = (x, n) => {const r=x%n;return r<0?r+n:r;};
export const angle = x => wrap(x + Math.PI, Math.PI * 2) - Math.PI;
function spline(t, a, b, c, d) {
  // A uniform cubic B-spline rounds the original tight nodes into driveable bends.
  // Wider asphalt must not fold over itself on the inside of an interpolating cusp.
  const t2=t*t,t3=t2*t;
  return ((1-3*t+3*t2-t3)*a+(4-6*t2+3*t3)*b+(1+3*t+3*t2-3*t3)*c+t3*d)/6;
}
const count = 960;
export const samples = [];
let length = 0;
for (let i=0;i<=count;i++) {
  const u=i/count*NODES.length, k=Math.floor(u), t=u-k;
  const n=[-1,0,1,2].map(o=>NODES[wrap(k+o,NODES.length)]);
  const p={x:spline(t,...n.map(v=>v[0])),y:spline(t,...n.map(v=>v[1])),z:spline(t,...n.map(v=>v[2])),s:0};
  if(i) length+=Math.hypot(p.x-samples[i-1].x,p.z-samples[i-1].z);
  p.s=length; samples.push(p);
}
export const LENGTH = length;
export function point(s) {
  s=wrap(s,LENGTH); let lo=0,hi=count;
  while(hi-lo>1){const m=(lo+hi)>>1; if(samples[m].s>s)hi=m;else lo=m;}
  const a=samples[lo],b=samples[hi], t=(s-a.s)/(b.s-a.s);
  // Smooth tangents at LUT boundaries so the offset edges cannot zigzag.
  const tangent=i=>{i=wrap(i,count);const prev=samples[wrap(i-1,count)],next=samples[wrap(i+1,count)];return {x:next.x-prev.x,z:next.z-prev.z};};
  const ta=tangent(lo),tb=tangent(hi),dx=ta.x+(tb.x-ta.x)*t,dz=ta.z+(tb.z-ta.z)*t,l=Math.hypot(dx,dz);
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,
    tx:dx/l,tz:dz/l,nx:-dz/l,nz:dx/l,yaw:Math.atan2(dx,dz),s,index:lo};
}
export function nearest(x,z,hint=0) {
  let best={distance:Infinity};
  // Local search prevents snapping across nearby, different parts of the circuit.
  for(let j=-22;j<=22;j++) {
    const i=wrap(hint+j,count),a=samples[i],b=samples[i+1];
    const dx=b.x-a.x,dz=b.z-a.z,ll=dx*dx+dz*dz;
    const t=clamp(((x-a.x)*dx+(z-a.z)*dz)/ll,0,1);
    const px=a.x+dx*t,pz=a.z+dz*t,dist=Math.hypot(x-px,z-pz);
    if(dist<best.distance){const l=Math.sqrt(ll);best={x:px,z:pz,y:a.y+(b.y-a.y)*t,s:a.s+(b.s-a.s)*t,
      index:i,distance:dist,lane:(x-px)*(-dz/l)+(z-pz)*(dx/l),tx:dx/l,tz:dz/l,nx:-dz/l,nz:dx/l,yaw:Math.atan2(dx,dz)};}
  }
  return best;
}
export function curvature(s) { return angle(point(s+8).yaw-point(s-8).yaw)/16; }
export const GATES = [.155,.505,.805];
export const BOOSTS = [.035,.435,.675];
export const BLOCKS = [.365,.735];
export const JUMP = .245;
export function rampHeight(s){const distance=wrap(JUMP*LENGTH-s,LENGTH);return distance<=9?.85*(1-distance/9):0;}
export function widthAt(s,mode='maximum') {
  const f=wrap(s,LENGTH)/LENGTH;
  // Ease into and out of the bridge; the road remains a continuous surface.
  const ease=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
  const narrowing=Math.min(ease((f-.55)/.02),ease((.66-f)/.02));
  return ROAD_HALF_WIDTH+(MODES[mode].bridge-ROAD_HALF_WIDTH)*narrowing;
}
export function gateLane(index,seconds) { return Math.sin(seconds*.5+index*2.1)*4.2; }
export function roadHint(s,seconds,mode) {
  const ahead=35;
  for(let i=0;i<GATES.length;i++) if(MODES[mode].gates && wrap(GATES[i]*LENGTH-s,LENGTH)<ahead)
    return {text:'MOVING GATE · aim for the cyan opening',lane:gateLane(i,seconds+1),kind:'gate'};
  for(const f of BLOCKS) if(MODES[mode].blocks&&wrap(f*LENGTH-s,LENGTH)<ahead)
    return {text:'ROADBLOCK · pass on the right',lane:-5.8,kind:'block'};
  if(wrap(JUMP*LENGTH-s,LENGTH)<ahead) return {text:'LAUNCH PAD · automatic jump',lane:0,kind:'jump'};
  if(wrap(.57*LENGTH-s,LENGTH)<ahead) return {text:'NARROW BRIDGE · hold your line',lane:0,kind:'bridge'};
  const c=curvature(s+15);
  if(Math.abs(c)>.035) return {text:'HAIRPIN · brake before turning',lane:0,kind:'corner'};
  return {text:'FOLLOW THE CYAN EDGE LIGHTS',lane:0,kind:'road'};
}
