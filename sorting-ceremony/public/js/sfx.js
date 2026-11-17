/* Sound effects synthesised with Web Audio, and the master output the hat's voice also goes through. */
(function () {
  'use strict';
  let ctx = null;
  let master = null;
  let ambience = null;

  // Created lazily: browsers only allow sound after a click or key press.
  function context() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function output() {
    context();
    return master;
  }

  function noise(seconds) {
    const c = context();
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function envelope(gain, t, attack, peak, hold, release) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  // Low, slowly beating drone with a breath of air under the waiting hall.
  function startAmbience() {
    if (ambience) return;
    const c = context();
    const t = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.05, t + 3);
    out.connect(master);
    const oscs = [55, 55.4, 82.5].map(f => {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(out);
      o.start(t);
      return o;
    });
    const air = c.createBufferSource();
    air.buffer = noise(4);
    air.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const airGain = c.createGain();
    airGain.gain.value = 0.25;
    air.connect(lp).connect(airGain).connect(out);
    air.start(t);
    ambience = { out, nodes: [...oscs, air] };
  }

  function stopAmbience() {
    if (!ambience) return;
    const { out, nodes } = ambience;
    ambience = null;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    nodes.forEach(n => n.stop(t + 1.6));
  }

  // A gain stage of its own for one effect; stop() fades it out quickly and disconnects it.
  function stoppable() {
    const c = context();
    const bus = c.createGain();
    bus.connect(master);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      const t = c.currentTime;
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0.0001, t + 0.15);
      setTimeout(() => bus.disconnect(), 200);
    };
    return { bus, stop };
  }

  // Rising whoosh as the hat wakes. Returns stop().
  function swell() {
    const c = context();
    const { bus, stop } = stoppable();
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise(2);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 1.6);
    const g = c.createGain();
    envelope(g, t, 1.2, 0.35, 0.1, 0.6);
    src.connect(bp).connect(g).connect(bus);
    src.start(t);
    src.stop(t + 2);
    return stop;
  }

  // Drum roll that speeds up and grows over `seconds`. Returns stop().
  function rumble(seconds) {
    const c = context();
    const { bus, stop } = stoppable();
    const t0 = c.currentTime;
    const hit = noise(0.12);
    for (let t = 0; t < seconds;) {
      const p = t / seconds;
      const src = c.createBufferSource();
      src.buffer = hit;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180 + 400 * p;
      const g = c.createGain();
      envelope(g, t0 + t, 0.005, 0.15 + 0.5 * p, 0, 0.1);
      src.connect(lp).connect(g).connect(bus);
      src.start(t0 + t);
      t += 0.16 - 0.11 * p;
    }
    return stop;
  }

  function setMuted(muted) { output().gain.value = muted ? 0 : 1; }

  window.Sfx = { context, output, startAmbience, stopAmbience, swell, rumble, setMuted };
})();
