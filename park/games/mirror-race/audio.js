// Only documented p0.sound calls; the platform owns unlock, volume and mute.
const gain=db=>10**(db/20);
const cues={gate:['hit.wav',.2,-18],block:['hit.wav',.2,-18],barrier:['hit.wav',.2,-18],bump:['hit.wav',.2,-21],lap:['lap.wav',.55,-17],finish:['finish.wav',1.05,-12],pad:['boost.wav',.3,-22],jump:['boost.wav',.3,-22]};
export function createRaceAudio(p0){
  let unlocked=false,disposed=false,time=0,nextGrain=0,rate=.8,volume=gain(-14),warned=false;
  const voices=new Map(),lastCue=new Map();
  function stop(id){try{p0.sound.stop(id);}catch{}voices.delete(id);}
  function play(file,seconds,level,speed=1,engine=false){
    const group=[...voices].filter(([,v])=>v.engine===engine);
    if(group.length>=(engine?3:12))stop(group[0][0]);
    try{const id=p0.sound.play(`assets/${file}`,{volume:level,rate:speed,loop:false});
      if(id!==undefined&&id!==null)voices.set(id,{until:time+seconds/speed+.05,engine});
    }catch{if(!warned){warned=true;p0.log?.('audio-unavailable','Packaged vehicle sound could not start');}} // Keep the race running.
  }
  function silenceEngine(){for(const [id,v]of voices)if(v.engine)stop(id);nextGrain=0;}
  return {
    activate(){if(!disposed)unlocked=true;},
    event(type){
      if(!unlocked||disposed||!cues[type])return;
      const [file,seconds,db]=cues[type];
      if(time-(lastCue.get(type)??-Infinity)<.16)return;
      lastCue.set(type,time);play(file,seconds,gain(db));
    },
    update(session,input,dt){
      if(disposed)return;
      dt=Math.max(0,Math.min(.1,dt));time+=dt;
      for(const [id,v]of voices)if(v.until<=time)voices.delete(id);
      const car=session.own,phase=session.config?.phase;
      const running=phase==='race'||phase==='countdown'&&session.countdown<=0;
      if(!unlocked||!running||!car||car.finished||car.retired){silenceEngine();return;}
      const speed=Math.max(0,Math.min(1,car.speed/50)),throttle=Math.max(0,Math.min(1,input.throttle||0));
      const boosting=!!car.boosting;
      const blend=1-Math.exp(-dt/ .28);
      rate+=(.8+speed*.95+throttle*.1+(boosting?.14:0)-rate)*blend;
      volume+=(gain(-14+speed*7+throttle+(boosting?1:0))-volume)*blend;
      // Recorded car engine, not a synthesized hum. The SDK has no live pitch
      // setter; .8-second Hann grains overlap at half their duration.
      nextGrain-=dt;
      if(nextGrain<=0){play('engine.wav',.8,volume,rate,true);nextGrain=.4/rate;}
    },
    dispose(){if(disposed)return;disposed=true;for(const id of voices.keys())stop(id);lastCue.clear();}
  };
}
