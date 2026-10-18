import {LAPS,LENGTH,MODES,point,nearest,curvature,widthAt,wrap,clamp,angle,GATES,BOOSTS,BLOCKS,JUMP,rampHeight,gateLane,roadHint,GATE_HALF_OPEN} from './track.js';
export function createCar(id,name,slot=0,bot=false) {
  const s=-6-Math.floor((7-slot)/2)*5, lane=slot%2?-2.6:2.6,p=point(s);
  return {id,name,bot,slot,x:p.x+p.nx*lane,z:p.z+p.nz*lane,y:p.y+.7,yaw:p.yaw,velocityYaw:p.yaw,
    s:wrap(s,LENGTH),progress:s,index:p.index,lane,speed:0,wheel:0,nitro:1,boosting:false,
    gate:0,lap:1,finished:false,finishTime:0,penalty:0,hits:0,cooldown:0,jump:0,jumpVelocity:0,
    lastJump:-1,lastPad:-1,lastLapTime:0,lapTimes:[],events:[],wrongWay:0};
}
export function recover(c) {
  const safe=c.gate===0?-3:Math.max(0,c.gate-1)*LENGTH/4 + 3,p=point(safe);
  c.x=p.x;c.z=p.z;c.yaw=p.yaw;c.velocityYaw=p.yaw;c.speed=0;c.lane=0;c.jump=0;c.jumpVelocity=0;
  c.s=p.s;c.index=p.index;c.progress=safe;c.penalty+=2;c.cooldown=1.5;c.events.push('recover');
}
function hit(c,kind) {
  if(c.cooldown>0)return;
  c.speed*=.48;c.cooldown=.9;c.hits++;c.nitro=Math.max(0,c.nitro-.12);c.events.push(kind);
}
// Keep the entire rotated car inside the rails, including after another car
// shoves it. Cooldown limits impact penalties; it never disables the wall.
export function contain(c,mode='maximum',n=nearest(c.x,c.z,c.index)) {
  const heading=angle(c.yaw-n.yaw);
  const extent=1.65*Math.abs(Math.cos(heading))+2.8*Math.abs(Math.sin(heading));
  // Use the narrowest width beneath the car, so its nose cannot cross a wall
  // while the centre is still in a wider part of the bridge approach.
  const width=Math.min(widthAt(n.s-4,mode),widthAt(n.s,mode),widthAt(n.s+4,mode));
  const limit=Math.max(.5,width+.825-extent-.45);
  if(Math.abs(n.lane)<=limit){c.lane=n.lane;return false;}
  const side=Math.sign(n.lane),lane=side*limit;
  c.x=n.x+n.nx*lane;c.z=n.z+n.nz*lane;c.lane=lane;
  hit(c,'barrier');
  const vx=Math.sin(c.velocityYaw),vz=Math.cos(c.velocityYaw);
  if(side*(vx*n.nx+vz*n.nz)>0){
    c.velocityYaw=angle(n.yaw+(vx*n.tx+vz*n.tz<0?Math.PI:0));
  }
  return true;
}
export function drive(c,input,dt,seconds,mode='maximum') {
  c.events=[];if(c.finished)return;
  dt=clamp(dt,0,.05);const m=MODES[mode]||MODES.maximum;
  c.cooldown=Math.max(0,c.cooldown-dt); if(input.recover){recover(c);return;}
  c.wheel+=(clamp(input.steer||0,-1,1)-c.wheel)*Math.min(1,dt*10);
  const drifting=(input.brake||0)>.15 && Math.abs(c.wheel)>.3 && c.speed>12;
  c.boosting=!!input.boost&&c.nitro>.025&&(input.throttle||0)>.1;
  c.nitro=clamp(c.nitro+dt*(c.boosting?-.3:drifting?.16:.055),0,1);
  const off=Math.abs(c.lane)>widthAt(c.s,mode);
  const target=m.maxSpeed*(c.boosting?1.24:1)*(off?.38:1);
  c.speed=clamp(c.speed+((input.throttle||0)*16-(input.brake||0)*24-1.2-c.speed*c.speed*.006)*dt,0,target);
  c.yaw=angle(c.yaw+c.wheel*(.45+Math.min(c.speed,30)*.045)*dt*(drifting?1.25:1));
  c.velocityYaw=angle(c.velocityYaw+angle(c.yaw-c.velocityYaw)*Math.min(1,dt*(drifting?m.grip*.44:m.grip)));
  c.x+=Math.sin(c.velocityYaw)*c.speed*dt;c.z+=Math.cos(c.velocityYaw)*c.speed*dt;
  const n=nearest(c.x,c.z,c.index),delta=angle((n.s-c.s)/LENGTH*Math.PI*2)*LENGTH/(Math.PI*2);
  c.index=n.index;c.lane=n.lane;c.s=n.s;c.progress+=delta;
  c.wrongWay=delta<-.02?Math.min(3,c.wrongWay+dt):Math.max(0,c.wrongWay-dt*2);
  contain(c,mode,n);
  // Ordered crossing, within the road: start, 3 sectors, then the finish per lap.
  const next=c.gate*LENGTH/4;
  if(delta>0&&c.progress>=next&&c.progress-delta<next&&Math.abs(c.lane)<=widthAt(c.s,mode)+.2){
    c.gate++;
    if(c.gate>1&&(c.gate-1)%4===0){
      const lapTime=seconds+c.penalty-c.lastLapTime;c.lapTimes.push(lapTime);c.lastLapTime=seconds+c.penalty;
      c.events.push('lap');c.lap=Math.min(LAPS,1+c.lapTimes.length);
      if(c.lapTimes.length===LAPS){c.finished=true;c.finishTime=seconds+c.penalty;c.speed=0;c.events.push('finish');return;}
    }
  }
  // Missing a checkpoint is clearly shown and recovery returns to the last valid one.
  const lap=Math.floor(Math.max(0,c.progress)/LENGTH);
  for(let i=0;i<GATES.length;i++) if(m.gates&&Math.abs(c.s-GATES[i]*LENGTH)<2.4&&Math.abs(c.lane-gateLane(i,seconds))>GATE_HALF_OPEN-1.3)hit(c,'gate');
  for(const f of BLOCKS)if(m.blocks&&Math.abs(c.s-f*LENGTH)<2.5&&Math.abs(c.lane)<3.2)hit(c,'block');
  for(let i=0;i<BOOSTS.length;i++)if(Math.abs(c.s-BOOSTS[i]*LENGTH)<3&&Math.abs(c.lane)<6&&c.lastPad!==lap*3+i){
    c.lastPad=lap*3+i;c.nitro=clamp(c.nitro+.4,0,1);c.events.push('pad');
  }
  const launch=lap*LENGTH+JUMP*LENGTH;
  // Crossing the visible ramp lip launches automatically. Slow drivers do not
  // need Shift; reverse crossings and stationary cars cannot retrigger it.
  if(delta>0&&c.progress-delta<launch&&c.progress>=launch&&c.lastJump!==lap&&c.speed>3){
    c.lastJump=lap;c.jump=.85;c.jumpVelocity=11.5;c.speed=Math.max(c.speed,c.bot?Math.min(22,m.maxSpeed*m.rival):22);c.events.push('jump');
  }
  if(c.jump>0||c.jumpVelocity>0){c.jump+=c.jumpVelocity*dt;c.jumpVelocity-=15*dt;if(c.jump<=0){c.jump=0;c.jumpVelocity=0;c.events.push('land');}}
  c.y=n.y+.7+(c.jump>0?c.jump:rampHeight(c.s));
}
export function aiInput(c,seconds,mode='maximum',strength=1) {
  const m=MODES[mode],look=clamp(6+c.speed*.42,6,22),h=roadHint(c.s,seconds,mode);
  let lane=(c.slot%3-1)*1.9;
  if(h.kind!=='road'&&h.kind!=='corner')lane=h.lane;
  if(Math.abs(curvature(c.s+look))>.02)lane=0;
  const p=point(c.s+look),tx=p.x+p.nx*lane-c.x,tz=p.z+p.nz*lane-c.z;
  const err=angle(Math.atan2(tx,tz)-c.yaw);
  const turn=Math.max(Math.abs(curvature(c.s+5)),Math.abs(curvature(c.s+look)),Math.abs(curvature(c.s+look+10)));
  const cap=m.maxSpeed*(c.bot?m.rival:1)*strength;
  let target=clamp(Math.sqrt((c.bot?5.5:9)/(turn+.002)),10,cap);
  if(Math.abs(err)>.65)target=Math.min(target,12);
  if(h.kind==='gate'||h.kind==='block'||h.kind==='bridge')target=Math.min(target,26);
  return {throttle:c.speed<target+.5?(c.bot?.7:1):.15,brake:c.speed>target+1?.75:0,
    steer:clamp(err*2.5,-1,1),boost:!c.bot&&turn<.013&&Math.abs(err)<.15&&h.kind==='road'&&c.nitro>.3,
    recover:c.wrongWay>2.2||Math.abs(c.lane)>widthAt(c.s,mode)+4};
}
export function rank(cars) {
  return [...cars].sort((a,b)=>{
    if(a.finished&&b.finished)return a.finishTime-b.finishTime||a.slot-b.slot;
    if(a.finished!==b.finished)return a.finished?-1:1;
    // A skipped checkpoint cannot award race position.
    const valid=c=>Math.min(c.progress,c.gate*LENGTH/4);
    return valid(b)-valid(a)||a.slot-b.slot;
  });
}
export function collide(local,others,mode='maximum') {
  contain(local,mode);
  if(local.finished||local.cooldown>0)return;
  for(const other of others)if(other.id!==local.id&&!other.finished&&Math.hypot(local.x-other.x,local.z-other.z)<2.65){
    const dx=local.x-other.x,dz=local.z-other.z,d=Math.hypot(dx,dz)||1;
    local.x+=dx/d*.55;local.z+=dz/d*.55;local.speed*=.86;local.cooldown=.28;local.events.push('bump');break;
  }
  contain(local,mode);
}
export function packet(c) {return [c.slot,+c.x.toFixed(3),+c.z.toFixed(3),+c.yaw.toFixed(4),+c.speed.toFixed(2),+c.progress.toFixed(2),c.gate,+c.nitro.toFixed(3),c.finished?+c.finishTime.toFixed(3):0,+c.penalty.toFixed(2),+c.jump.toFixed(2)];}
export function applyPacket(c,a) {
  if(!Array.isArray(a)||a.length!==11||!a.every(Number.isFinite)||a[0]!==c.slot)return false;
  if(Math.abs(a[1])>180||Math.abs(a[2])>180||Math.abs(a[3])>Math.PI+.01||a[4]<0||a[4]>55||a[5]<-30||a[5]>LENGTH*LAPS+20||a[6]<0||a[6]>LAPS*4+1||a[6]%1||a[7]<0||a[7]>1||a[8]<0||a[9]<0||a[10]<0||a[10]>6)return false;
  if(a[8]>0&&a[6]!==LAPS*4+1)return false;
  Object.assign(c,{x:a[1],z:a[2],yaw:a[3],velocityYaw:a[3],speed:a[4],progress:a[5],gate:a[6],nitro:a[7],finished:a[8]>0,finishTime:a[8],penalty:a[9],jump:a[10]});
  const p=nearest(c.x,c.z,point(c.progress).index);c.s=p.s;c.index=p.index;c.lane=p.lane;c.y=p.y+.7+c.jump;c.lap=Math.min(LAPS,Math.max(1,Math.floor((c.gate-1)/4)+1));return true;
}
