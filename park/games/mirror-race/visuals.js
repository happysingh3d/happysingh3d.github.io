import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {samples,LENGTH,GRID,point,widthAt,GATES,BLOCKS,BOOSTS,JUMP,gateLane,curvature,ROAD_HALF_WIDTH,GATE_HALF_OPEN} from './track.js';

// Original meshes authored here; no downloaded models, textures or third-party art.
export function createCircuit(p0,scale) {
  const root=new THREE.Group();root.name='NIGHTSHIFT / circuit';root.scale.setScalar(scale);root.position.z=25*scale;p0.scene.add(root);
  const geometries=new Set(),materials=new Set(),textures=new Set(),instanced=[];
  try {
  const geo=g=>(geometries.add(g),g),mat=m=>(materials.add(m),m);
  const roadMat=mat(new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.6,metalness:.22}));
  const metal=mat(new THREE.MeshStandardMaterial({color:0x273d51,roughness:.37,metalness:.72}));
  const concrete=mat(new THREE.MeshStandardMaterial({color:0x182c3d,roughness:.93}));
  const glass=mat(new THREE.MeshStandardMaterial({color:0x153e55,roughness:.18,metalness:.58}));
  const cyan=mat(new THREE.MeshBasicMaterial({color:0x56e7e6,toneMapped:false}));
  const amber=mat(new THREE.MeshBasicMaterial({color:0xffb453,toneMapped:false}));
  const pink=mat(new THREE.MeshBasicMaterial({color:0xff668e,toneMapped:false}));
  const white=mat(new THREE.MeshBasicMaterial({color:0xdeedf2,toneMapped:false}));
  const black=mat(new THREE.MeshStandardMaterial({color:0x090e17,roughness:.81}));
  const dummy=new THREE.Object3D(),v=new THREE.Vector3();
  const box=geo(new THREE.BoxGeometry(1,1,1));
  function batch(g,m,transforms){
    const mesh=new THREE.InstancedMesh(g,m,transforms.length);
    for(let i=0;i<transforms.length;i++){const t=transforms[i];dummy.position.set(...t.p);dummy.rotation.set(0,t.yaw||0,0);dummy.scale.set(...(t.s||[1,1,1]));dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(t.color)mesh.setColorAt(i,new THREE.Color(t.color));}
    mesh.instanceMatrix.needsUpdate=true;root.add(mesh);instanced.push(mesh);return mesh;
  }
  function at(s,lane=0,y=0) {const p=point(s);return {p:[p.x+p.nx*lane,p.y+y,p.z+p.nz*lane],yaw:p.yaw};}
  function textPlane(text,w,h,color='#8ff5ed',bg='#091827',size=55,thickness=.09) {
    const c=new OffscreenCanvas(512,128),ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,512,128);
    ctx.strokeStyle=color;ctx.lineWidth=4;ctx.strokeRect(4,4,504,120);ctx.fillStyle=color;ctx.font=`bold ${size}px monospace`;ctx.textAlign='center';ctx.fillText(text,256,84);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;textures.add(t);
    // A double-sided text plane mirrors its back. Give each direction its own
    // outward-facing surface, using the same readable texture on both.
    const m=mat(new THREE.MeshBasicMaterial({map:t,side:THREE.FrontSide,toneMapped:false}));
    const g=geo(new THREE.PlaneGeometry(w,h)),sign=new THREE.Group();sign.name=`MIRROR / readable sign ${text}`;
    for(const side of [-1,1]){const face=new THREE.Mesh(g,m);face.position.z=side*thickness/2;face.rotation.y=side<0?Math.PI:0;sign.add(face);}
    return sign;
  }
  // Continuous, upward-facing asphalt. The slab edges make elevated sections solid.
  let road,slab,rail,mode='';
  function roadGeometry(nextMode) {
    const positions=[],colors=[],indices=[],edges=[-1.17,-1,-.04,.04,1,1.17];
    for(let i=0;i<samples.length;i++) {
      const p=point(samples[i].s),w=widthAt(p.s,nextMode);
      for(let j=0;j<edges.length;j++){
        const off=edges[j]*w;positions.push(p.x+p.nx*off,p.y-.03,p.z+p.nz*off);
        const curb=j===0||j===5,center=j===2||j===3;
        const color=new THREE.Color(curb?(Math.floor(i/8)%2?0x2e6975:0x6fbfc4):center?(Math.floor(i/13)%2?0x7a898b:0x222d39):0x263646);
        colors.push(color.r,color.g,color.b);
      }
      if(i)for(let j=0;j<5;j++){const a=(i-1)*6+j,b=i*6+j;indices.push(a,a+1,b,b,a+1,b+1);}
    }
    const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  function slabGeometry(nextMode){
    const pos=[],idx=[];
    for(let i=0;i<samples.length;i++){
      const p=point(samples[i].s),w=widthAt(p.s,nextMode)*1.17;
      for(const side of [-1,1])for(const y of [-.035,-.8])pos.push(p.x+p.nx*w*side,p.y+y,p.z+p.nz*w*side);
      if(i){const a=(i-1)*4,b=i*4;idx.push(a,b,a+1,b,b+1,a+1,a+2,a+3,b+2,b+2,a+3,b+3,a+1,b+1,a+3,b+1,b+3,a+3);}
    }
    const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return g;
  }
  const slabMat=mat(new THREE.MeshStandardMaterial({color:0x395765,roughness:.8,side:THREE.DoubleSide}));
  road=new THREE.Mesh(roadGeometry('maximum'),roadMat);road.name='MIRROR / upward road surface';
  slab=new THREE.Mesh(slabGeometry('maximum'),slabMat);slab.name='MIRROR / solid road slab';root.add(road,slab);
  // Instanced edge lights and crash barriers: a small number of draws for a long course.
  const railParts=[],lights=[];
  for(let s=0;s<LENGTH;s+=7){for(const side of [-1,1]){
    const t=at(s,side*(widthAt(s,'maximum')+1),.9);t.s=[.35,1.8,8.2];railParts.push(t);
    const l=at(s,side*(widthAt(s,'maximum')+.8),1.86);l.s=[.22,.18,8.2];lights.push(l);
  }}
  rail=batch(box,metal,railParts);const railLight=batch(box,cyan,lights);
  // Mark the proper finish, not a hold-to-complete circle.
  const start=point(0),finish=new THREE.Group();finish.position.set(start.x,start.y,start.z);finish.rotation.y=start.yaw;root.add(finish);
  function meshBox(parent,m,x,y,z,w,h,d){const o=new THREE.Mesh(box,m);o.position.set(x,y,z);o.scale.set(w,h,d);parent.add(o);return o;}
  meshBox(finish,metal,-12.5,5,0,1.3,10,1.3);meshBox(finish,metal,12.5,5,0,1.3,10,1.3);meshBox(finish,metal,0,10,0,26,1.6,1.1);
  const title=textPlane('MIRROR RACE',21,3,'#8ff5ed','#091827',55,1.3);title.position.set(0,10,0);finish.add(title);
  const checks=[];for(let x=-10;x<10;x+=1)for(let z=-1.2;z<1.2;z+=.6){const t=at(z,x+.5,.025);t.s=[1,.045,.6];t.color=(Math.round(x+z/.6)%2)?'#d9e8ed':'#0d1822';checks.push(t);}
  batch(box,white,checks);
  const sectorPosts=[];for(let k=1;k<=3;k++)for(const side of [-1,1]){const t=at(k*LENGTH/4,side*12,3);t.s=[.4,6,.4];sectorPosts.push(t);}batch(box,cyan,sectorPosts);
  // Blue boost pads are automatic: visibly distinct from orange collision hazards.
  const pads=[];for(const f of BOOSTS)for(let z=-3;z<=3;z+=1.1){const t=at(f*LENGTH+z,0,.055);t.s=[11,.04,.45];pads.push(t);}batch(box,cyan,pads);
  const jumpPosts=[];for(const side of [-1,1]){const t=at(JUMP*LENGTH-12,side*12,3);t.s=[.5,6,.5];jumpPosts.push(t);}batch(box,pink,jumpPosts);
  const launchMarks=[];for(let s=-9;s<=0;s+=1.5){const t=at(JUMP*LENGTH+s,0,.12+(s+9)/9*.85);t.s=[19,.1,.65];launchMarks.push(t);}batch(box,pink,launchMarks);
  // Broad, raised ramp: the physical launch follows its upper lip at JUMP.
  const rampPositions=[],rampIndices=[];
  for(let i=0;i<=12;i++){const s=JUMP*LENGTH-9+i*.75,p=point(s),height=i/12*.85;
    for(const side of [-1,1])rampPositions.push(p.x+p.nx*side*9.5,p.y+.04+height,p.z+p.nz*side*9.5);
    if(i){const a=(i-1)*2,b=i*2;rampIndices.push(a,a+1,b,b,a+1,b+1);}
  }
  const rampGeometry=geo(new THREE.BufferGeometry());rampGeometry.setAttribute('position',new THREE.Float32BufferAttribute(rampPositions,3));rampGeometry.setIndex(rampIndices);rampGeometry.computeVertexNormals();
  const ramp=new THREE.Mesh(rampGeometry,metal);ramp.name='MIRROR / automatic launch ramp';root.add(ramp);
  const rampLip=at(JUMP*LENGTH,0,.91);rampLip.s=[19,.18,.55];batch(box,pink,[rampLip]);
  const rampLabel=textPlane('LAUNCH PAD',16,2.4,'#ff99bc');const jp=point(JUMP*LENGTH-12);rampLabel.position.set(jp.x,jp.y+7,jp.z);rampLabel.rotation.y=jp.yaw;root.add(rampLabel);
  // Three moving barricades leave one unambiguous cyan opening.
  const gates=GATES.map((f,i)=>{
    const p=point(f*LENGTH),g=new THREE.Group();g.position.set(p.x,p.y,p.z);g.rotation.y=p.yaw;root.add(g);
    g.name=`MIRROR / above-road moving barrier ${i+1}`;
    meshBox(g,metal,-12.5,4,0,.8,8,.8);meshBox(g,metal,12.5,4,0,.8,8,.8);meshBox(g,amber,0,8,0,26,.25,.4);
    const warning=textPlane('MOVING BARRIER',20,2.1,'#ffbe72');warning.position.set(0,6.8,-.7);g.add(warning);
    const left=meshBox(g,amber,-5,1.5,0,6,3,1.4),right=meshBox(g,amber,5,1.5,0,6,3,1.4);
    const a=meshBox(g,black,-5,1.1,-.72,6,.45,.06),b=meshBox(g,black,5,1.1,-.72,6,.45,.06);
    const open=meshBox(g,cyan,0,.12,0,GATE_HALF_OPEN*2,.15,7);
    const markers=[meshBox(g,cyan,-GATE_HALF_OPEN,1.6,0,.15,3.2,.2),meshBox(g,cyan,GATE_HALF_OPEN,1.6,0,.15,3.2,.2)];
    return {group:g,left,right,a,b,open,markers,index:i};
  });
  const blocks=BLOCKS.map(f=>{const p=point(f*LENGTH),g=new THREE.Group();g.position.set(p.x,p.y,p.z);g.rotation.y=p.yaw;root.add(g);
    g.name='MIRROR / above-road orange roadblock';
    meshBox(g,amber,0,1.5,0,6.4,3,2);for(const side of [-1,1])for(let i=-2;i<=2;i++){const b=meshBox(g,black,i*1.2,1.5,side*1.02,.42,2.3,.06);b.rotation.z=.35;}
    const warning=textPlane('PASS EITHER SIDE',13,2,'#ffbe72');warning.position.set(0,4.6,-.7);g.add(warning);
    return g;});
  // Original night-market skyline, window bays, cranes and overhead gantries.
  const towers=[],windows=[],roof=[];
  let seed=1729;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<150;i++){
    const x=(rand()-.5)*420,z=(rand()-.5)*370-20;
    // Keep skyline architecture clear of every actual driving segment.
    if(samples.some((p,j)=>j%4===0&&Math.hypot(p.x-x,p.z-z)<25))continue;
    const w=8+rand()*13,d=8+rand()*14,h=8+rand()*43;
    towers.push({p:[x,h/2-1,z],s:[w,h,d],color:rand()>.5?'#173243':'#233445'});
    roof.push({p:[x,h,z],s:[w+.6,.25,d+.6]});
    for(let y=4;y<h-2;y+=5)for(let k=-w/2+2;k<w/2-1;k+=3.3)if(rand()>.16){
      windows.push({p:[x+k,y,z+d/2+.03],s:[1.4,1.4,.06],color:rand()>.7?'#efac57':'#398397'});
      windows.push({p:[x+k,y,z-d/2-.03],s:[1.4,1.4,.06],color:'#2e7089'});
    }
  }
  batch(box,concrete,towers);batch(box,metal,roof);batch(box,white,windows);
  const ground=new THREE.Mesh(geo(new THREE.PlaneGeometry(700,650)),concrete);ground.rotation.x=-Math.PI/2;ground.position.set(0,-.8,-10);root.add(ground);
  const supports=[];for(let s=0;s<LENGTH;s+=18){const p=point(s);if(p.y>2)supports.push({p:[p.x,p.y/2-.5,p.z],s:[2.8,p.y+1,2.8],yaw:p.yaw});}batch(box,metal,supports);
  const lampPosts=[],lampHeads=[];for(let s=15;s<LENGTH;s+=35){const t=at(s,14,4.5);t.s=[.3,9,.3];lampPosts.push(t);const h=at(s,13,9);h.s=[2.8,.22,1];lampHeads.push(h);}batch(box,metal,lampPosts);batch(box,amber,lampHeads);
  // Tunnel ribs follow the circuit instead of hiding the route with a dark solid wall.
  const ribs=[];for(let s=LENGTH*.38;s<LENGTH*.425;s+=5){for(const side of [-1,1]){const t=at(s,side*13,4);t.s=[.65,8,.65];ribs.push(t);}const t=at(s,0,8);t.s=[26,.65,.65];ribs.push(t);}batch(box,metal,ribs);
  const arrows=[];for(let s=25;s<LENGTH;s+=15)if(Math.abs(curvature(s))>.025){const t=at(s,13,2.3);t.s=[.25,1.4,2.2];arrows.push(t);}batch(box,amber,arrows);
  // Vehicle surfaces are custom lofts, merged by material, then instanced across eight cars.
  function loft(rows) {
    const pos=[],idx=[],smooth=[];
    for(let i=0;i<rows.length-1;i++)for(let k=0;k<4;k++){const t=k/4;smooth.push(rows[i].map((v,j)=>v+(rows[i+1][j]-v)*t));}smooth.push(rows.at(-1));
    const ring=[[-.68,0],[-.91,.1],[-1,.3],[-.95,.65],[-.8,.93],[-.5,1],[.5,1],[.8,.93],[.95,.65],[1,.3],[.91,.1],[.68,0]],n=ring.length;
    for(const [z,w,low,high] of smooth)for(const [x,y]of ring)pos.push(x*w,low+(high-low)*y,z);
    for(let i=1;i<smooth.length;i++)for(let j=0;j<n;j++){const a=(i-1)*n+j,b=i*n+j,k=(j+1)%n;idx.push(a,b,(i-1)*n+k,b,i*n+k,(i-1)*n+k);}
    for(let j=1;j<n-1;j++){idx.push(0,j+1,j);const k=(smooth.length-1)*n;idx.push(k,k+j,k+j+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return g;
  }
  // Compact GT prototype: continuous shoulders, a swept cockpit, sculpted
  // wheel fairings, a thin rear aerofoil and a recessed diffuser. All solid
  // parts remain within the physics envelope (3.3 x 5.6 metres).
  const paintParts=[loft([[-2.72,.95,.39,.79],[-2.35,1.24,.35,.98],[-1.58,1.3,.4,1.18],[-.75,1.2,.43,1.2],[.4,1.12,.4,1.05],[1.45,1.29,.34,.94],[2.2,1.13,.32,.77],[2.72,.84,.36,.56]])];
  const darkParts=[loft([[-1.25,.73,1.15,1.24],[-.8,.71,1.12,1.66],[-.25,.67,1.08,1.8],[.25,.63,1.02,1.74],[.93,.6,.92,1.22],[1.17,.58,.9,1.02]])],chromeParts=[],lightParts=[],rearParts=[],neonParts=[];
  function part(list,x,y,z,w,h,d,rot=0){const g=new THREE.BoxGeometry(w,h,d);g.rotateY(rot);g.translate(x,y,z);list.push(g);}
  const wing=loft([[-1.5,.22,1.57,1.69],[-1.2,.3,1.55,1.64],[0,.31,1.53,1.62],[1.2,.3,1.55,1.64],[1.5,.22,1.57,1.69]]);wing.rotateY(Math.PI/2);wing.translate(0,0,-2.37);darkParts.push(wing);
  for(const side of [-1,1]){part(chromeParts,side*.77,1.25,-2.35,.08,.62,.18);part(paintParts,side*1.5,1.65,-2.37,.075,.25,.52);}
  part(darkParts,0,.48,2.57,1.35,.2,.13);part(darkParts,0,.3,2.52,2.3,.08,.42);
  part(darkParts,0,.55,-2.66,1.95,.3,.1);part(darkParts,0,.27,-2.48,2.65,.09,.56);
  for(let i=-3;i<=3;i++){part(chromeParts,i*.2,.49,2.66,.04,.13,.04);part(chromeParts,i*.25,.3,-2.55,.05,.25,.46);}
  part(rearParts,0,.77,-2.72,1.9,.08,.06);
  for(const side of [-1,1]){
    for(const axle of [-1.56,1.55]){const fairing=loft([[axle-.78,.16,.6,.75],[axle-.5,.24,.62,1.08],[axle,.25,.64,1.21],[axle+.5,.23,.62,1.07],[axle+.78,.14,.58,.72]]);fairing.translate(side*1.15,0,0);paintParts.push(fairing);}
    part(darkParts,side*1.16,.69,-.2,.07,.28,1.3);part(chromeParts,side*1.31,.44,0,.1,.12,3.65);
    part(lightParts,side*.83,.73,2.34,.51,.075,.1,-side*.19);part(lightParts,side*1.08,.74,2.12,.08,.08,.43);
    part(rearParts,side*1.04,.87,-2.55,.43,.08,.09,side*.23);
    part(chromeParts,side*1.28,1.12,.45,.24,.06,.1);part(darkParts,side*1.42,1.14,.43,.21,.1,.33);
    for(let k=0;k<5;k++)part(chromeParts,side*.9,1.13,-1.65+k*.13,.28,.025,.05);
    part(paintParts,side*1.3,.39,0,.15,.14,3.5);
    part(neonParts,side*1.39,.43,-.15,.06,.055,3.5);
    part(neonParts,side*1.39,.3,0,.06,.06,4.1);
    part(neonParts,side*.31,.88,1.87,.06,.028,.65);
    part(neonParts,side*.8,1.64,-2.37,1.28,.045,.06);
  }
  part(chromeParts,0,1.79,-.1,.08,.04,.6);part(darkParts,0,.8,1.67,.19,.025,.65);
  const paints=mat(new THREE.MeshStandardMaterial({color:0xffffff,metalness:.5,roughness:.27}));
  function carBatch(parts,m){parts.forEach(g=>g.deleteAttribute('uv'));const merged=geo(mergeGeometries(parts,false));if(!merged)throw new Error('Incompatible vehicle geometry');parts.forEach(g=>g.dispose());const o=new THREE.InstancedMesh(merged,m,GRID);o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);o.frustumCulled=false;root.add(o);return o;}
  const shells=carBatch(paintParts,paints),canopies=carBatch(darkParts,glass),trim=carBatch(chromeParts,metal),headlights=carBatch(lightParts,white);
  shells.name='MIRROR / sculpted GT body';canopies.name='MIRROR / swept GT cockpit';
  const tailMat=mat(new THREE.MeshBasicMaterial({color:0xff365a,toneMapped:false})),taillights=carBatch(rearParts,tailMat);
  const neonMat=mat(new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}));
  const neon=carBatch(neonParts,neonMat);neon.name='MIRROR / vehicle neon strips';
  const neonColors=['#58fff0','#ff79c8','#5beaff','#b49aff','#74ffc0','#ffad60','#80d8ff','#ff77df'];
  const tyre=geo(new THREE.CylinderGeometry(.6,.6,.48,16));tyre.rotateZ(Math.PI/2);
  const rim=geo(new THREE.CylinderGeometry(.37,.37,.5,12));rim.rotateZ(Math.PI/2);
  const tyres=new THREE.InstancedMesh(tyre,black,GRID*4),rims=new THREE.InstancedMesh(rim,metal,GRID*4);root.add(tyres,rims);tyres.frustumCulled=rims.frustumCulled=false;
  const ringGeo=geo(new THREE.TorusGeometry(.39,.045,5,16));ringGeo.rotateY(Math.PI/2);
  const rimLights=new THREE.InstancedMesh(ringGeo,neonMat,GRID*4);rimLights.name='MIRROR / neon wheel rims';rimLights.frustumCulled=false;root.add(rimLights);
  const shadowCanvas=new OffscreenCanvas(128,128),shadowCtx=shadowCanvas.getContext('2d'),shadowGradient=shadowCtx.createRadialGradient(64,64,15,64,64,64);
  shadowGradient.addColorStop(0,'rgba(0,0,0,.9)');shadowGradient.addColorStop(.5,'rgba(0,0,0,.5)');shadowGradient.addColorStop(1,'rgba(0,0,0,0)');shadowCtx.fillStyle=shadowGradient;shadowCtx.fillRect(0,0,128,128);
  const shadowTexture=new THREE.CanvasTexture(shadowCanvas);textures.add(shadowTexture);
  const shadowMat=mat(new THREE.MeshBasicMaterial({color:0x01060a,map:shadowTexture,transparent:true,opacity:.55,depthWrite:false}));
  const shadeGeo=geo(new THREE.PlaneGeometry(3.7,6.2));shadeGeo.rotateX(-Math.PI/2);const shadows=new THREE.InstancedMesh(shadeGeo,shadowMat,GRID);root.add(shadows);
  const glowCanvas=new OffscreenCanvas(128,128),glowCtx=glowCanvas.getContext('2d');
  const glowGradient=glowCtx.createRadialGradient(64,64,6,64,64,64);
  glowGradient.addColorStop(0,'rgba(255,255,255,.95)');glowGradient.addColorStop(.5,'rgba(255,255,255,.4)');glowGradient.addColorStop(1,'rgba(255,255,255,0)');
  glowCtx.fillStyle=glowGradient;glowCtx.fillRect(0,0,128,128);
  const glowTexture=new THREE.CanvasTexture(glowCanvas);textures.add(glowTexture);
  const glowMat=mat(new THREE.MeshBasicMaterial({color:0xffffff,map:glowTexture,transparent:true,opacity:.45,depthWrite:false,toneMapped:false}));
  const glowGeo=geo(new THREE.PlaneGeometry(4,5.6));glowGeo.rotateX(-Math.PI/2);
  const underglow=new THREE.InstancedMesh(glowGeo,glowMat,GRID);underglow.name='MIRROR / vehicle underglow';underglow.frustumCulled=false;root.add(underglow);
  const flameMat=mat(new THREE.MeshBasicMaterial({color:0x74eeef,transparent:true,opacity:.72,depthWrite:false,toneMapped:false}));
  const flameGeo=geo(new THREE.ConeGeometry(.25,2.8,8));flameGeo.rotateX(-Math.PI/2);const flames=new THREE.InstancedMesh(flameGeo,flameMat,GRID*2);flames.frustumCulled=false;root.add(flames);
  const key=new THREE.DirectionalLight(0xaee5ef,2.3);key.position.set(-20,70,25);root.add(key);
  const fill=new THREE.HemisphereLight(0x89bed0,0x29394b,2.3);root.add(fill);
  const carMatrix=new THREE.Matrix4(),local=new THREE.Object3D(),wheelMatrix=new THREE.Matrix4();
  const offsets=[[-1.31,.6,1.52],[1.31,.6,1.52],[-1.31,.6,-1.53],[1.31,.6,-1.53]];
  let first=true;
  function update(session,dt) {
    const cMode=session.config?.mode||'maximum';
    if(mode!==cMode){mode=cMode;
      for(const [mesh,build]of [[road,roadGeometry],[slab,slabGeometry]]){const old=mesh.geometry;mesh.geometry=build(mode);geometries.delete(old);old.dispose();}
      for(let i=0;i<railParts.length;i++){
        const s=Math.floor(i/2)*7,side=i%2?1:-1;
        for(const [o,y,w,h] of [[rail,.9,.35,1.8],[railLight,1.86,.22,.18]]){const t=at(s,side*(widthAt(s,mode)+(o===rail?1:.8)),y);dummy.position.set(...t.p);dummy.rotation.set(0,t.yaw,0);dummy.scale.set(w,h,8.2);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);} }
      rail.instanceMatrix.needsUpdate=railLight.instanceMatrix.needsUpdate=true;
    }
    for(const g of gates){g.group.visible=mode!=='easy';const lane=-gateLane(g.index,session.elapsed),lo=lane-GATE_HALF_OPEN,hi=lane+GATE_HALF_OPEN,edge=ROAD_HALF_WIDTH+1;
      for(const o of [g.left,g.a]){o.position.x=(-edge+lo)/2;o.scale.x=lo+edge;}
      for(const o of [g.right,g.b]){o.position.x=(edge+hi)/2;o.scale.x=edge-hi;}g.open.position.x=lane;
      g.markers[0].position.x=lo;g.markers[1].position.x=hi;
    }
    blocks.forEach(g=>g.visible=mode==='maximum');
    for(const c of session.cars){
      const i=c.slot;dummy.position.set(c.x,c.y-.7,c.z);dummy.rotation.set(0,c.yaw,-c.wheel*c.speed*.002);dummy.scale.set(1,1,1);dummy.updateMatrix();carMatrix.copy(dummy.matrix);
      for(const mesh of [shells,canopies,trim,headlights,taillights,neon])mesh.setMatrixAt(i,carMatrix);
      if(first){shells.setColorAt(i,new THREE.Color(c.color||'#ffb95e'));neon.setColorAt(i,new THREE.Color(neonColors[i]));underglow.setColorAt(i,new THREE.Color(neonColors[i]));for(let j=0;j<4;j++)rimLights.setColorAt(i*4+j,new THREE.Color(neonColors[i]));}
      for(let j=0;j<4;j++){local.position.set(...offsets[j]);local.rotation.set(c.progress*1.5,j<2?c.wheel*.35:0,0);local.scale.set(1,1,1);local.updateMatrix();wheelMatrix.multiplyMatrices(carMatrix,local.matrix);tyres.setMatrixAt(i*4+j,wheelMatrix);rims.setMatrixAt(i*4+j,wheelMatrix);
        local.position.x+=j%2?.265:-.265;local.updateMatrix();wheelMatrix.multiplyMatrices(carMatrix,local.matrix);rimLights.setMatrixAt(i*4+j,wheelMatrix);}
      local.position.set(c.x,c.y-.68-c.jump,c.z);local.rotation.set(0,c.yaw,0);local.scale.set(1,1,1);local.updateMatrix();shadows.setMatrixAt(i,local.matrix);
      local.position.y+=.045;local.updateMatrix();underglow.setMatrixAt(i,local.matrix);
      for(let j=0;j<2;j++){local.position.set(j?.7:-.7,.55,-3.2);local.rotation.set(0,0,0);local.scale.set(c.boosting?1:.01,1,c.boosting?1:.01);local.updateMatrix();wheelMatrix.multiplyMatrices(carMatrix,local.matrix);flames.setMatrixAt(i*2+j,wheelMatrix);}
    }
    first=false;for(const mesh of [shells,canopies,trim,headlights,taillights,neon,tyres,rims,rimLights,shadows,underglow,flames])mesh.instanceMatrix.needsUpdate=true;
    const hero=session.own||session.sorted[0];if(!hero)return;
    const camera=p0.camera;
    if(session.config?.phase==='lobby'){
      const p=point(-13);v.set((p.x+p.nx*19-p.tx*14)*scale,(p.y+13)*scale,(p.z+p.nz*19-p.tz*14+25)*scale);
      camera.position.lerp(v,first?1:Math.min(1,dt*5));camera.lookAt(p.x*scale,(p.y+1)*scale,(p.z+25)*scale);
    }else{
      const dirX=Math.sin(hero.yaw),dirZ=Math.cos(hero.yaw),back=10+hero.speed*.18;
      v.set((hero.x-dirX*back)*scale,(hero.y+6)*scale,(hero.z-dirZ*back+25)*scale);
      camera.position.lerp(v,Math.min(1,dt*8));camera.lookAt((hero.x+dirX*15)*scale,(hero.y+1.3)*scale,(hero.z+dirZ*15+25)*scale);
    }
    camera.position.x=THREE.MathUtils.clamp(camera.position.x,-p0.lot.width*.48,p0.lot.width*.48);
    camera.position.z=THREE.MathUtils.clamp(camera.position.z,-p0.lot.depth*.48,p0.lot.depth*.48);
    camera.position.y=THREE.MathUtils.clamp(camera.position.y,.18,p0.lot.height*.9);
    const fov=hero.boosting?79:70+hero.speed*.12;if(Math.abs(camera.fov-fov)>.1){camera.fov+=(fov-camera.fov)*Math.min(1,dt*5);camera.updateProjectionMatrix();}
    p0.me.position.set(hero.x*scale,hero.y*scale,(hero.z+25)*scale);p0.me.yaw=hero.yaw;
  }
  const stats={roadLength:+LENGTH.toFixed(1),grid:GRID,vehicleTriangles:Math.round([...new Set([shells.geometry,canopies.geometry,trim.geometry,headlights.geometry,taillights.geometry,neon.geometry,tyre,rim,ringGeo])].reduce((n,g)=>n+(g.index?.count||g.attributes.position.count)/3,0)),instancedScenery:instanced.reduce((n,m)=>n+m.count,0),vehicleNeonDrawCalls:3};
  return {root,update,stats,dispose(){p0.scene.remove(root);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
  } catch(error) {p0.scene.remove(root);geometries.forEach(g=>g?.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());throw error;}
}
