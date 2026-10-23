import * as THREE from 'three';

const slug=new URLSearchParams(location.search).get('game'),allowed=['mirror-race','neon-rescue','foxfire','hive-adapt','afterglow'];
const LOTS={'hive-adapt':{id:'local-studio',width:34,depth:24,height:26},'afterglow':{id:'local-studio',width:12,depth:12,height:19}};
const OWN_PAUSE=slug==='hive-adapt'; // games with their own pause menu and HUD keep P and the corners
const loading=document.querySelector('#loading'),scoreOutput=document.querySelector('#local-score'),pauseButton=document.querySelector('#pause');
if(!allowed.includes(slug)){loading.textContent='This game is not in the studio. Return to the collection.';pauseButton.hidden=true;}else boot().catch(e=>{loading.hidden=false;loading.textContent='The game could not start. Return to its project and try launching again.';console.error('Game startup failed',e);});

async function boot(){
 if(OWN_PAUSE){pauseButton.hidden=true;scoreOutput.hidden=true;}
 if(slug==='afterglow'){scoreOutput.hidden=true;pauseButton.style.top='72px';} // keep clear of its own Sound button and Lift button
 const root=new URL(`./${slug}/`,import.meta.url),asset=p=>new URL(p,root).href;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,.01,500),renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;document.body.prepend(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label',`${slug} game. Click to focus, then use the game's movement controls.`);scene.add(new THREE.HemisphereLight(0xffffff,0x223344,1.2));
 const listeners=new Map(),keys=new Set(),buffers=new Map(),voices=new Map();let ctx=null,master=null,loop=null,frame=0,last=0,time=0,paused=false,ended=false,voiceId=0;
 const emit=(name,event)=>{for(const fn of listeners.get(name)||[])fn(event);};
 const soundBuffer=async url=>{if(buffers.has(url))return buffers.get(url);if(!ctx)return null;const res=await fetch(url);if(!res.ok)throw Error('Sound not found');const buffer=await ctx.decodeAudioData(await res.arrayBuffer());buffers.set(url,buffer);return buffer;};
 function wakeAudio(){if(!ctx){ctx=new AudioContext();master=ctx.createGain();master.gain.value=.3;master.connect(ctx.destination);}ctx.resume().catch(()=>{});}
 const scoreKey=`studio-score-${slug}`;let personalBest=0;
 try{const saved=Number(localStorage.getItem(scoreKey));if(Number.isFinite(saved)&&saved>0)personalBest=saved;}catch{}
 const localEntry=best=>({name:'YOU',score:best,value:best,playerId:'studio-visitor',id:'studio-visitor'});
 const p0={
  scene,camera,renderer,lot:LOTS[slug]||{id:'local-studio',width:19,depth:18,height:12},
  width:innerWidth,height:innerHeight,pixelRatio:renderer.getPixelRatio(),time:0,
  me:{id:'studio-visitor',name:'YOU',position:new THREE.Vector3(),yaw:0},
  players:new Map(),table:personalBest?[localEntry(personalBest)]:[],
  controls:{mode:'fly',vertical:true},bodies:{visible:true},room:{host:'studio-visitor'},
  input:{isDown:k=>keys.has(k),pointer:{x:0,y:0,locked:false},lockPointer(){try{const r=renderer.domElement.requestPointerLock();r?.catch?.(()=>{});}catch{}},unlockPointer(){if(document.pointerLockElement)document.exitPointerLock();}},
  on(name,fn){const list=listeners.get(name)||[];list.push(fn);listeners.set(name,list);return()=>listeners.set(name,(listeners.get(name)||[]).filter(f=>f!==fn));},
  loop(fn){loop=fn;},asset,hud(){},
  loading(progress,text){loading.textContent=text||'Loading…';loading.hidden=progress>=1;},
  log(...args){console.debug(...args);},
  score(value){
   const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error('Invalid score');
   const best=slug==='mirror-race'?(personalBest?Math.min(personalBest,n):n):Math.max(personalBest,n);personalBest=best;
   let saved=true;try{localStorage.setItem(scoreKey,String(best));}catch{saved=false;}
   const unit=slug==='mirror-race'?' ms':'';
   scoreOutput.textContent=`LOCAL ARCADE · score ${n}${unit} · ${saved?'personal':'session'} best ${best}${unit}`;
   p0.table=[localEntry(best)];queueMicrotask(()=>{emit('reward',{kind:'score',ok:saved,best,score:n,value:n,reason:saved?'':'Browser storage unavailable'});emit('table',p0.table);});
  },
  music:(()=>{let el=null;return{play(path,{volume=.5,loop:repeat=true}={}){const url=new URL(path,root).href;if(!el){el=new Audio();}if(el.src!==url){el.src=url;}el.loop=repeat;el.volume=Math.max(0,Math.min(1,volume*.6));if(!paused)el.play().catch(()=>{});},stop(){el?.pause();},volume(v){if(el)el.volume=Math.max(0,Math.min(1,v*.6));},pause(){el?.pause();},resume(){if(el?.src)el.play().catch(()=>{});}};})(),
  sound:{
   play(path,{volume=1,rate=1,loop:repeat=false}={}){
    const id=++voiceId;if(!ctx||ctx.state!=='running'||paused)return id;
    const url=new URL(path,root);if(url.origin!==location.origin)throw Error('Arcade sound must be packaged locally');
    const record={source:null,cancelled:false};voices.set(id,record);
    soundBuffer(url.href).then(buffer=>{
     if(ended||record.cancelled||paused||!buffer){voices.delete(id);return;}
     const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;
     source.playbackRate.value=Math.max(.1,Math.min(4,rate));source.loop=repeat;gain.gain.value=Math.max(0,Math.min(1,volume));
     source.connect(gain).connect(master);record.source=source;
     source.onended=()=>{voices.delete(id);source.disconnect();gain.disconnect();};source.start();
    }).catch(()=>voices.delete(id));return id;
   },
   stop(id){const voice=voices.get(id);if(voice){voice.cancelled=true;try{voice.source?.stop();}catch{}voices.delete(id);}}
  }
 };
 function setPause(value){paused=value;keys.clear();pauseButton.textContent=paused?'Resume':'Pause';pauseButton.setAttribute('aria-pressed',String(paused));document.querySelector('#pause-overlay').hidden=!paused;if(paused){ctx?.suspend();p0.music.pause();}else{last=0;wakeAudio();p0.music.resume();renderer.domElement.focus();}}
 pauseButton.addEventListener('click',()=>setPause(!paused));
 addEventListener('keydown',e=>{if(e.code==='KeyP'&&!OWN_PAUSE){e.preventDefault();setPause(!paused);return;}if(paused)return;wakeAudio();keys.add(e.code);emit('keydown',{code:e.code,key:e.key,repeat:e.repeat});if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();});addEventListener('keyup',e=>{keys.delete(e.code);emit('keyup',{code:e.code,key:e.key});});addEventListener('blur',()=>{keys.clear();if(!ended)setPause(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden)setPause(true);});
 for(const name of ['pointerdown','pointermove','pointerup','pointercancel'])renderer.domElement.addEventListener(name,e=>{if(name==='pointerdown'){if(paused)return;wakeAudio();renderer.domElement.focus();renderer.domElement.setPointerCapture(e.pointerId);}p0.input.pointer.x=e.clientX;p0.input.pointer.y=e.clientY;emit(name==='pointercancel'?'pointerup':name,{x:e.clientX,y:e.clientY,clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,dx:e.movementX||0,dy:e.movementY||0,touch:e.pointerType==='touch',pointerId:e.pointerId});});
 renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());document.addEventListener('contextmenu',e=>e.preventDefault());
 document.addEventListener('pointerlockchange',()=>{const locked=document.pointerLockElement===renderer.domElement;p0.input.pointer.locked=locked;emit('pointerlock',locked);});
 renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();emit('wheel',{deltaY:e.deltaY,dy:e.deltaY});},{passive:false});addEventListener('resize',()=>{p0.width=innerWidth;p0.height=innerHeight;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);emit('resize',{width:innerWidth,height:innerHeight});});
 const game=await import(new URL('main.js',root).href);await game.default(p0);loading.hidden=true;document.body.dataset.ready='true';renderer.domElement.focus();
 function tick(now){if(ended)return;frame=requestAnimationFrame(tick);if(paused||document.hidden)return;if(now-last<15)return;const dt=last?Math.min(.1,(now-last)/1000):0;last=now;time+=dt;p0.time=time;try{loop?.(dt,time);renderer.render(scene,camera);}catch(e){setPause(true);loading.hidden=false;loading.textContent='The game stopped. Return to the project and restart it.';console.error(e);}}
 frame=requestAnimationFrame(tick);addEventListener('pagehide',()=>{ended=true;cancelAnimationFrame(frame);emit('end');for(const id of voices.keys())p0.sound.stop(id);ctx?.close();renderer.dispose();renderer.forceContextLoss();});window.arcade={get state(){return {ready:document.body.dataset.ready==='true',paused,time,keys:[...keys],triangles:renderer.info.render.triangles};}};
}
