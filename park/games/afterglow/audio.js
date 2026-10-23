// Original short musical recordings in the package. Playback starts on a gesture.
export function createAudio(p0) {
  let enabled = true, started = false, disposed = false, ambience = null;
  const voices = new Set();
  function play(path, volume, options = {}) {
    if (!enabled || disposed) return null;
    try {
      const id = p0.sound.play(path, {volume, ...options});
      voices.add(id);
      // Effects stop naturally; only loop IDs require explicit cleanup.
      return id;
    } catch (error) {p0.log('afterglow-audio-unavailable', {message: String(error.message || error)}); return null;}
  }
  function stopAll() {
    for (const id of voices) {try {p0.sound.stop(id);} catch { /* Already ended. */ }}
    voices.clear(); ambience = null;
  }
  function start() {
    started = true;
    if (ambience === null) ambience = play('assets/ambience.wav', .13, {loop: true});
  }
  return {
    get enabled() {return enabled;}, start,
    toggle() {enabled = !enabled; if (!enabled) stopAll(); else if (started) start();},
    event(event, saved) {
      if (event.type === 'saved') play('assets/rescue.wav', .28, {rate: 1 + saved * .035});
      if (event.type === 'flare') play('assets/flare.wav', .25);
      if (event.type === 'squall' && event.state === 'in') play('assets/storm.wav', .16);
    },
    finish(saved) {play(saved === 7 ? 'assets/home.wav' : 'assets/rescue.wav', .3);},
    dispose() {disposed = true; stopAll();}
  };
}
