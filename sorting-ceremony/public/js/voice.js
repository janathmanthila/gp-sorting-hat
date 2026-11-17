/*
 * Plays one of the hat's voiced lines through Web Audio, so an analyser can move the mouth with the sound
 * and mute (Sfx master) covers the voice too. Without audio, subtitles run at reading pace instead.
 */
(function () {
  'use strict';
  const MS_PER_CHAR = 65;
  const STALL_MS = 2500;
  const el = new Audio();
  let analyser = null;
  let samples = null;

  function connect() {
    if (analyser) return;
    const ctx = Sfx.context();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    samples = new Float32Array(analyser.fftSize);
    ctx.createMediaElementSource(el).connect(analyser).connect(Sfx.output());
  }

  function level() {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    return Math.min(1, Math.sqrt(sum / samples.length) * 5);
  }

  /**
   * Plays `src` (or nothing, if null) while showing `text`.
   * opts.onLevel(0..1) moves the mouth; opts.onProgress(0..1) drives the subtitles;
   * opts.tail = { seconds, run } calls run() that many seconds before the end (once).
   * Returns { done: Promise, stop() }.
   */
  function play(src, text, { onLevel = () => {}, onProgress = () => {}, tail = null } = {}) {
    let stopped = false;
    let tailed = false;
    let raf = 0;
    let attempts = 0;
    let watchdog = 0;
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const fireTail = remaining => {
      if (tail && !tailed && remaining <= tail.seconds) { tailed = true; tail.run(); }
    };

    // natural = the line played out; false when Space/Esc stopped it, so the tail (reveal) must not fire.
    const end = (natural = true) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(watchdog);
      cancelAnimationFrame(raf);
      el.pause();
      el.onended = el.onerror = null;
      if (natural) fireTail(0);
      onLevel(0);
      onProgress(1);
      finish();
    };

    const silent = () => {
      if (stopped) return;
      clearTimeout(watchdog);
      cancelAnimationFrame(raf);
      el.pause();
      const ms = Math.max(1500, (text || '').length * MS_PER_CHAR);
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min(1, (now - t0) / ms);
        onLevel(0.35 + 0.3 * Math.sin(now / 90));
        onProgress(p);
        fireTail(((1 - p) * ms) / 1000);
        if (p >= 1) end();
        else if (!stopped) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    // A clip that errors, is refused, or doesn't start within STALL_MS is loaded again once; only then do the
    // subtitles run without sound. Each failure is logged so a silent line can be traced.
    const retry = reason => {
      if (stopped) return;
      clearTimeout(watchdog);
      console.warn(`[voice] ${src.split('/').pop()} attempt ${attempts}: ${reason}`);
      if (attempts < 2) start();
      else silent();
    };
    const start = async () => {
      attempts++;
      const ctx = Sfx.context();
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      if (stopped) return;
      el.src = attempts > 1 ? `${src}${src.includes('?') ? '&' : '?'}retry=${Date.now()}` : src;
      el.load();
      const attempt = attempts; // a refusal from an earlier attempt (cut short by the reload) doesn't count
      el.play().catch(err => { if (attempt === attempts) retry(`play() refused (${err.name})`); });
      watchdog = setTimeout(() => { if (!el.currentTime) retry(`no sound after ${STALL_MS} ms (audio ${ctx.state})`); }, STALL_MS);
    };

    if (!src) {
      silent();
    } else {
      connect();
      el.onended = () => { clearTimeout(watchdog); end(); };
      el.onerror = () => retry(`load error ${el.error ? el.error.code : '?'}`);
      start();
      const tick = () => {
        if (stopped) return;
        onLevel(level());
        if (el.duration) {
          onProgress(Math.min(1, el.currentTime / el.duration), el.currentTime);
          fireTail(el.duration - el.currentTime);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return { done, stop: () => end(false) };
  }

  /**
   * Finds the held pause in a shout clip (the longest quiet stretch between sounds, at least MIN_PAUSE_S long),
   * so the house name's subtitle can wait for it. Resolves { start, end } in seconds, or null.
   */
  const MIN_PAUSE_S = 0.4;
  async function findPause(src) {
    if (!src) return null;
    try {
      const audio = await Sfx.context().decodeAudioData(await (await fetch(src)).arrayBuffer());
      const data = audio.getChannelData(0);
      const win = Math.round(audio.sampleRate * 0.02);
      const rms = [];
      for (let i = 0; i + win <= data.length; i += win) {
        let sum = 0;
        for (let j = i; j < i + win; j++) sum += data[j] * data[j];
        rms.push(Math.sqrt(sum / win));
      }
      const quiet = Math.max(...rms) * 0.06;
      const first = rms.findIndex(v => v >= quiet);
      const last = rms.length - 1 - [...rms].reverse().findIndex(v => v >= quiet);
      let best = null;
      for (let i = first, run = -1; i <= last; i++) {
        if (rms[i] < quiet) { if (run < 0) run = i; continue; }
        if (run >= 0 && (!best || i - run > best[1] - best[0])) best = [run, i];
        run = -1;
      }
      const sec = win / audio.sampleRate;
      return best && (best[1] - best[0]) * sec >= MIN_PAUSE_S ? { start: best[0] * sec, end: best[1] * sec } : null;
    } catch {
      return null;
    }
  }

  window.Voice = { play, findPause };
})();
