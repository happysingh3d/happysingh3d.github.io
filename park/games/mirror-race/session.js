import {GRID,MODES} from './track.js';
import {createCar,drive,aiInput,collide,rank} from './race.js';
const NAMES=['YOU','AFTERBURN','CIRCUIT','GHOSTLINE','REDLINE','VOLT','MIDNIGHT','QUICKSHIFT'];
const COLORS=['#f7cb60','#ff6275','#50deeb','#a18aff','#78eeac','#ff9a52','#e9eff7','#f487d0'];
// Every visitor drives an independent time trial. Room host/state never gates a run.
export function createSession(p0,now=()=>Date.now()) {
  const id=String(p0.me.id??'local');
  let config,cars=[],round=0,stopped=false,scoreSent=false,lastOwnEvents=[];
  let scoring='Maximum: save your fastest two-lap time in this browser';
  function grid(mode,phase='lobby'){
    const roster=Array.from({length:GRID},(_,slot)=>({id:slot?`bot-${slot}`:id,
      name:slot?NAMES[slot]:String(p0.me.name||'YOU').slice(0,18),bot:slot>0,color:COLORS[slot],slot}));
    config={round:`local-${++round}-${now()}`,phase,mode,startAt:phase==='countdown'?now()+3500:0,roster};
    cars=roster.map(r=>Object.assign(createCar(r.id,r.name,r.slot,r.bot),{color:r.color}));
    scoreSent=false;
    scoring=mode==='maximum'?'Maximum time trial · fastest time wins':'Practice difficulty · no saved time';
  }
  function requestStart(){
    if(stopped||!['lobby','results'].includes(config.phase))return;
    grid(config.mode,'countdown');
  }
  function difficulty(mode){if(!stopped&&MODES[mode]&&config.phase==='lobby')grid(mode);}
  p0.on('reward',r=>{
    if(stopped||r.kind!=='score')return;
    scoring=r.ok?'Personal best saved in this browser':'Finish time shown here · browser storage unavailable';
  });
  grid('maximum');
  function step(dt,input={}){
    lastOwnEvents=[];
    if(stopped)return;
    const elapsed=Math.max(0,(now()-config.startAt)/1000),own=cars[0];
    if(config.phase==='countdown'&&now()>=config.startAt)config={...config,phase:'race'};
    if(config.phase!=='race')return;
    drive(own,input,dt,elapsed,config.mode);collide(own,cars,config.mode);lastOwnEvents=[...own.events];
    for(const c of cars)if(c.bot){
      drive(c,aiInput(c,elapsed,config.mode,1+(c.slot-4)*.017),dt,elapsed,config.mode);collide(c,cars,config.mode);
    }
    if(own.finished){
      if(!scoreSent&&config.mode==='maximum'){
        scoreSent=true;
        try{p0.score(Math.max(1,Math.round(own.finishTime*1000)));scoring='Saving your personal best…';}
        catch{scoring='Your finish time is shown here · browser storage unavailable';}
      }
      config={...config,phase:'results'};
    }
  }
  return {step,requestStart,difficulty,dispose(){stopped=true;},get config(){return config;},get cars(){return cars;},
    get own(){return cars[0];},get sorted(){return rank(cars);},
    get elapsed(){return cars[0]?.finished?cars[0].finishTime-cars[0].penalty:
      config.startAt?Math.max(0,(now()-config.startAt)/1000):0;},
    get countdown(){return config.phase==='countdown'?Math.max(0,(config.startAt-now())/1000):0;},
    get scoring(){return scoring;},get events(){return lastOwnEvents;},get table(){return p0.table||[];}};
}
