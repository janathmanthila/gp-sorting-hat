/*
 * One sorting: name, wake, intro, ponder (candles go out), drum roll, shout and reveal, settle.
 * Space jumps to the shout, Esc cancels back to the waiting hall, M mutes, R sorts a random person.
 */
(function () {
  'use strict';
  const NAME_MS = 1400;
  const WAKE_MS = 1500;
  const ROLL_MS = 2600;
  const REVEAL_TAIL_S = 0.9; // the banner bursts this long before the shout ends, on the house name
  const SETTLE_MS = 6000;
  const CANCEL = Symbol('cancel');
  let data = null;
  let ui = null;
  let run = null;
  let muted = false;

  function init(bundle, elements) {
    data = bundle;
    ui = elements;
  }

  // Waits and lines register an interrupt so Space/Esc can end them early.
  function wait(r, ms) {
    return new Promise(resolve => {
      const id = setTimeout(resolve, ms);
      r.interrupts.add(() => { clearTimeout(id); resolve(); });
    });
  }

  function say(r, src, text, opts = {}) {
    Subtitles.set(text, opts);
    const line = Voice.play(src, text, { onLevel: Hat.setMouth, onProgress: Subtitles.progress, tail: opts.tail });
    r.interrupts.add(line.stop);
    return line.done;
  }

  // Throws on cancel; true while skipping to the shout.
  function skipping(r) {
    if (r.cancelled) throw CANCEL;
    return r.skip;
  }

  async function sort(person) {
    if (run) return;
    const r = run = { cancelled: false, skip: false, revealing: false, interrupts: new Set() };
    const house = data.houses[person.house];
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      Hall.relight();
      Hall.glowHouse(person.house);
      Hat.pose('shout');
      ui.hall.classList.add('revealing'); // hat rises, banner unfurls below it
      Reveal.show(house);
    };
    const pause = Voice.findPause(person.audio.shout); // measured while the intro plays, used for the shout's subtitles
    try {
      Sfx.stopAmbience();
      ui.name.textContent = person.name;
      ui.name.classList.add('show');
      await wait(r, NAME_MS);
      if (!skipping(r)) {
        Hat.pose('awake');
        r.interrupts.add(Sfx.swell());
        await wait(r, WAKE_MS);
      }
      if (!skipping(r)) await say(r, person.audio.intro, person.lines.intro);
      if (!skipping(r)) {
        Hat.pose('thinking');
        Hall.setDim(0.6);
        Hall.snuffCandles(4000);
        await say(r, person.audio.ponder, person.lines.ponder);
      }
      if (!skipping(r)) {
        Subtitles.clear();
        Hall.setDim(1);
        r.interrupts.add(Sfx.rumble(ROLL_MS / 1000));
        await wait(r, ROLL_MS);
      }
      skipping(r);
      r.revealing = true;
      Hat.pose('awake');
      const gap = await Promise.race([pause, new Promise(resolve => setTimeout(resolve, 500, null))]);
      // The subtitle keeps the lead-in only: the house name is for the voice and the banner to reveal.
      const leadIn = person.lines.shout.replace(new RegExp(`\\s*${house.name}\\W*$`, 'i'), '');
      await say(r, person.audio.shout, leadIn, { shout: true, pause: gap, tail: { seconds: REVEAL_TAIL_S, run: reveal } });
      if (!r.cancelled) reveal();
      skipping(r);
      await wait(r, SETTLE_MS);
    } catch (err) {
      if (err !== CANCEL) throw err;
    } finally {
      r.interrupts.forEach(stop => stop());
      Reveal.hide();
      ui.hall.classList.remove('revealing');
      Hall.reset();
      Hat.pose('asleep');
      Hat.setMouth(0);
      Subtitles.clear();
      ui.name.classList.remove('show');
      Sfx.startAmbience();
      run = null;
      Picker.show();
    }
  }

  function interrupt(r) { r.interrupts.forEach(stop => stop()); }

  function toggleMute() {
    muted = !muted;
    Sfx.setMuted(muted);
    ui.hint.classList.toggle('muted', muted);
  }

  function rehearse() {
    if (!data.people.length) return;
    Picker.hide();
    sort(data.people[Math.floor(Math.random() * data.people.length)]);
  }

  function onKey(e) {
    if (e.target instanceof HTMLInputElement) return; // typing in the picker
    if (e.key === ' ') {
      e.preventDefault();
      if (run && !run.revealing) { run.skip = true; interrupt(run); }
    } else if (e.key === 'Escape') {
      if (run) { run.cancelled = true; interrupt(run); }
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMute();
    } else if ((e.key === 'r' || e.key === 'R') && !run) {
      rehearse();
    }
  }

  window.Ceremony = { init, sort, onKey };
})();
