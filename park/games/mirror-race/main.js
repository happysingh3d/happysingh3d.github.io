import * as THREE from 'three';
import {createSession} from './session.js';
import {createCircuit} from './visuals.js';
import {createHud} from './hud.js';
import {readControls} from './input.js';
import {createRaceAudio} from './audio.js';
export default async function start(p0) {
  const scale=Math.min(p0.lot.width/390,p0.lot.depth/350,p0.lot.height/85);
  if(!(scale>0))throw new Error('Mirror Race requires positive lot dimensions');
  const prior={background:p0.scene.background,fog:p0.scene.fog,mode:p0.controls.mode,bodies:p0.bodies.visible,fov:p0.camera.fov,near:p0.camera.near,far:p0.camera.far};
  p0.controls.mode='none';p0.bodies.visible=false;p0.camera.fov=72;p0.camera.near=.08*scale;p0.camera.far=800*scale;p0.camera.updateProjectionMatrix();
  p0.scene.background=new THREE.Color(0x0a1728);p0.scene.fog=new THREE.Fog(0x0a1728,150*scale,400*scale);
  let stopped=false,world,hud,session,recoverRequest=false,accumulator=0,lastLog=0;
  const audio=createRaceAudio(p0);
  function cleanup(){if(stopped)return;stopped=true;session?.dispose();hud?.dispose();world?.dispose();audio.dispose();
    p0.scene.background=prior.background;p0.scene.fog=prior.fog;p0.controls.mode=prior.mode;p0.bodies.visible=prior.bodies;
    Object.assign(p0.camera,{fov:prior.fov,near:prior.near,far:prior.far});p0.camera.updateProjectionMatrix();}
  p0.on('end',cleanup);
  try{
    p0.loading(.08,'Laying the night circuit');world=createCircuit(p0,scale);
    p0.loading(.55,'Eight cars on the grid');session=createSession(p0,()=>p0.time*1000);hud=createHud(p0,scale);
    world.update(session,.2);hud.update(session,.2,p0.width,p0.height);
    p0.hud('A/←/Q turns RIGHT · D/→/E turns LEFT · W/↑ accelerates · S/↓ brakes.\nShift boosts · R recovers (+2s) · two laps · pink ramps launch automatically.');
    p0.loading(.85,'Preparing road and car materials');
    if(p0.renderer.compileAsync)await p0.renderer.compileAsync(p0.scene,p0.camera);
    if(stopped)return;p0.renderer.render(p0.scene,p0.camera);p0.loading(1,'Grid ready');
    const action=id=>{if(id==='start')session.requestStart();else if(id==='recover')recoverRequest=true;else session.difficulty(id);};
    p0.on('keydown',e=>{audio.activate();if(e.code==='Space')session.requestStart();if(e.code==='KeyR')recoverRequest=true;if(e.code==='Digit1')session.difficulty('easy');if(e.code==='Digit2')session.difficulty('hard');if(e.code==='Digit3')session.difficulty('maximum');});
    p0.on('pointerdown',e=>{audio.activate();const x=e.x??p0.input.pointer.x,y=e.y??p0.input.pointer.y;const id=hud.hit(x,y);if(id)action(id);});
    p0.log('nightshift-ready',world.stats);
    p0.loop(dt=>{
      if(stopped)return;dt=Math.max(0,Math.min(dt,.1));const down=k=>p0.input.isDown(k);
      const input=readControls(down,recoverRequest);
      accumulator+=dt;while(accumulator>=1/60){session.step(1/60,input);input.recover=false;accumulator-=1/60;
        for(const type of session.events)audio.event(type);
      }
      recoverRequest=false;audio.update(session,input,dt);world.update(session,dt);hud.update(session,dt,p0.width,p0.height);
      lastLog+=dt;if(lastLog>2){lastLog=0;const c=session.own;p0.log('race-status',{phase:session.config?.phase,mode:session.config?.mode,lap:c?.lap,position:session.sorted.findIndex(x=>x===c)+1,gate:c?.gate,speed:c?.speed,elapsed:session.elapsed,humans:session.cars.filter(x=>!x.bot).length,bots:session.cars.filter(x=>x.bot).length});}
    });
  }catch(e){cleanup();throw e;}
}
