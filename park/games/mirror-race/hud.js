import * as THREE from 'three';
import {LAPS,LENGTH,MODES,widthAt} from './track.js';
export function raceTime(t){const cs=Math.round(Math.max(0,t)*100);return `${Math.floor(cs/6000)}:${(Math.floor(cs/100)%60).toString().padStart(2,'0')}.${(cs%100).toString().padStart(2,'0')}`;}
export function raceNotice(car,mode){
  if(!car||car.finished)return '';
  if(car.wrongWay>.4)return 'WRONG WAY · turn around or press R';
  if(car.progress>car.gate*LENGTH/4+8)return 'MISSED CHECKPOINT · press R to recover';
  if(Math.abs(car.lane)>widthAt(car.s,mode)+.1)return 'OFF ROAD · press R to recover';
  return '';
}
export function createHud(p0,scale) {
  const canvas=new OffscreenCanvas(960,540),ctx=canvas.getContext('2d');
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;
  const geometry=new THREE.PlaneGeometry(1,1),material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='NIGHTSHIFT / single HUD';mesh.frustumCulled=false;mesh.renderOrder=10000;p0.scene.add(mesh);
  let clock=0,lastPhase='',lastW=0,lastH=0,buttons=[],noticeClock=0,impactUntil=0,lastHits=0;
  function text(value,x,y,size=15,color='#e7f4f5',weight=600,align='left'){ctx.fillStyle=color;ctx.font=`${weight} ${size}px sans-serif`;ctx.textAlign=align;ctx.fillText(String(value),x,y);}
  function panel(x,y,w,h,color='#07141be8'){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,10);ctx.fill();ctx.strokeStyle='#39606d';ctx.lineWidth=1;ctx.stroke();}
  function button(id,label,x,y,w,h,active=false){panel(x,y,w,h,active?'#95f0d9':'#173644');text(label,x+w/2,y+h/2+5,14,active?'#06222a':'#deeeee',700,'center');buttons.push({id,x,y,w,h});}
  function draw(s,w,h) {
    ctx.clearRect(0,0,w,h);buttons=[];const mobile=w<600,margin=mobile?12:25,top=mobile?116:84,own=s.own;
    const phase=s.config?.phase||'connecting',mode=s.config?.mode||'maximum';
    if(phase==='lobby'||phase==='connecting'){
      const pw=Math.min(w-2*margin,510),ph=mobile?380:328,x=(w-pw)/2,y=Math.max(top,h*.52-ph/2);
      panel(x,y,pw,ph);text('DEADHUNK  /  08-CAR GRID',x+22,y+30,11,'#96d0d1',700);
      text('MIRROR RACE',x+22,y+66,mobile?29:36,'#9bf4db',900);
      text(`${LAPS} LAPS.  YOUR FASTEST TIME WINS.`,x+22,y+96,mobile?11:14,'#ffffff',800);
      const people=s.cars.filter(c=>!c.bot).length;
      text(`${people} player${people!==1?'s':''} + ${s.cars.filter(c=>c.bot).length} bots · slower AI, no AI boost`,x+22,y+122,mobile?11:14,'#a4c3ca');
      text('STEERING IS REVERSED',x+22,y+148,15,'#ffcb82',900);
      text(mobile?'LEFT → RIGHT · RIGHT → LEFT':'A / ← / Q turns RIGHT   ·   D / → / E turns LEFT',x+22,y+171,mobile?12:13,'#e4e8ee',700);
      const bw=(pw-54)/3,bx=x+18,by=y+191;
      ['easy','hard','maximum'].forEach((m,i)=>button(m,MODES[m].label,bx+i*(bw+9),by,bw,43,mode===m));
      const note='Your own race · 7 bots · timer starts after the countdown';
      text(note,x+22,by+63,mobile?10:12,'#91b5c0');
      if(mobile){text('STICK: reversed steering + accelerate',x+22,by+88,12);text('OUTER RIM: boost · down: brake',x+22,by+111,12,'#a4c3ca');}
      const sy=y+ph-60;button('start',phase==='connecting'?'CONNECTING…':'START RACE  /  SPACE',x+18,sy,pw-36,43,true);
      if(!mobile)text('W / ↑ accelerate    S brake    SHIFT boost    R recover',w/2,h-25,13,'#b2cbd2',600,'center');
      if(w>1130){const tx=x+pw+16,tw=Math.min(230,w-tx-16);panel(tx,y,tw,170);text('FASTEST MAXIMUM TIMES',tx+14,y+26,12,'#a0e8d6');
        if(!s.table.length)text('No completed times yet',tx+14,y+54,12,'#a1bcc5');
        s.table.slice(0,5).forEach((r,i)=>{text(`${i+1}. ${String(r.name).slice(0,12)}`,tx+14,y+54+i*24,12,r.you?'#a2f5d9':'#d0e2e8');text(raceTime(r.score/1000),tx+tw-14,y+54+i*24,12,'#e4eef0',600,'right');});
      }
      return;
    }
    const sorted=s.sorted,position=own?sorted.findIndex(c=>c.id===own.id)+1:0;
    // The only race clock and lap/position block; no minimap duplicates.
    panel(margin,top,mobile?130:190,mobile?77:92);
    text(own?`${position} / ${s.cars.length}`:'SPECTATING',margin+14,top+34,mobile?27:35,'#a4f7df',900);
    text(own?`LAP ${own.lap} / ${LAPS}`:'JOIN THE NEXT GRID',margin+14,top+60,mobile?14:17);
    const rw=mobile?128:172;panel(w-margin-rw,top,rw,mobile?77:92);
    text(raceTime(own?.finished?own.finishTime:s.elapsed+(own?.penalty||0)),w-margin-12,top+29,mobile?22:28,'#ffffff',800,'right');
    text(`${Math.round((own?.speed||0)*3.6)} KM/H`,w-margin-12,top+57,mobile?13:17,'#a0bfcb',700,'right');
    if(phase==='countdown'&&s.countdown>0){
      const n=Math.ceil(s.countdown);text(n,w/2,h*.48,mobile?85:110,'#b9ffe7',900,'center');text('GET READY',w/2,h*.48+36,17,'#ffffff',700,'center');
    }else if(s.elapsed<1.6)text('GO!',w/2,h*.43,70,'#b9ffe7',900,'center');
    if(own&&!own.finished){
      const value=raceNotice(own,mode)||(noticeClock<impactUntil?'IMPACT · speed reduced':'');
      if(value){const hy=top+(mobile?105:118);panel(margin,hy,w-2*margin,34,'#091b23bf');text(value,w/2,hy+22,mobile?11:15,'#ffd48a',700,'center');}
      const bw=mobile?145:220,bx=w-margin-bw,by=h-(mobile?178:112);
      panel(bx,by,bw,57);text(`BOOST ${Math.round(own.nitro*100)}%`,bx+12,by+21,13,'#8ff4e5');ctx.fillStyle='#244354';ctx.fillRect(bx+12,by+34,bw-24,9);ctx.fillStyle='#8ff4e5';ctx.fillRect(bx+12,by+34,(bw-24)*own.nitro,9);
      button('recover','RECOVER / +2s',bx,by+64,bw,38);
      if(!mobile){panel(margin,h-137,160,112);text('LIVE POSITIONS',margin+12,h-115,11,'#8fb3c1');
        sorted.slice(0,4).forEach((c,i)=>text(`${i+1} ${c.id===own.id?'YOU':c.name}${c.bot?' · AI':''}`,margin+12,h-91+i*20,12,c.id===own.id?'#a0ffdc':'#c2d5dc'));
      }
    }
    if(own?.finished||phase==='results'){
      const pw=Math.min(w-2*margin,590),x=(w-pw)/2,y=Math.max(top+85,h*.22),ph=Math.min(h-y-(mobile?145:16),400);
      panel(x,y,pw,ph);text(own?.finished?'RACE FINISHED':'HEAT RESULTS',x+18,y+34,mobile?23:29,'#a6f7df',900);
      text(own?.finished?`YOUR TIME  ${raceTime(own.finishTime)}`:'FASTEST FINISH FIRST',x+18,y+61,mobile?17:22,'#ffffff',800);
      const small=mobile?11:13,row=mobile?22:25;
      sorted.forEach((c,i)=>{
        if(y+90+i*row>y+ph-84)return;
        const status=c.retired?'LEFT':c.finished?raceTime(c.finishTime):phase==='results'?'NOT FINISHED':'RACING';
        text(`${i+1}. ${c.id===own?.id?'YOU':c.name}${c.bot?' [AI]':''}`,x+18,y+90+i*row,small,c.id===own?.id?'#a8ffdb':'#d6e8ed');text(status,x+pw-18,y+90+i*row,small,'#accad3',600,'right');
      });
      text(s.scoring,x+18,y+ph-62,mobile?9:12,'#8bacbc');
      if(phase==='results')button('start','RACE AGAIN / SPACE',x+18,y+ph-51,pw-36,37,true);
      else text('Other racers are finishing · the order updates live',x+18,y+ph-29,mobile?10:12,'#bad2d8');
    }
  }
  function update(s,dt,w,h){
    w=Math.max(240,Math.floor(w));h=Math.max(240,Math.floor(h));clock+=dt;
    const phase=s.config?.phase||'connecting';
    noticeClock+=dt;const hits=s.own?.hits||0;
    if(phase==='lobby'||hits<lastHits){impactUntil=0;lastHits=hits;}
    else if(hits>lastHits){impactUntil=noticeClock+1.2;lastHits=hits;}
    if(w!==lastW||h!==lastH||clock>.1||phase!==lastPhase){
      if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
      draw(s,w,h);texture.needsUpdate=true;clock=0;lastW=w;lastH=h;lastPhase=phase;
    }
    // One camera-facing plane, always inside the frustum and never copied into the world.
    const distance=.9*scale,forward=new THREE.Vector3(0,0,-distance).applyQuaternion(p0.camera.quaternion);
    mesh.position.copy(p0.camera.position).add(forward);mesh.quaternion.copy(p0.camera.quaternion);
    const height=2*distance*Math.tan(THREE.MathUtils.degToRad(p0.camera.fov/2));mesh.scale.set(height*p0.camera.aspect,height,1);
  }
  return {canvas,mesh,update,hit(x,y){return buttons.find(b=>x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h)?.id;},
    dispose(){p0.scene.remove(mesh);geometry.dispose();material.dispose();texture.dispose();}};
}
