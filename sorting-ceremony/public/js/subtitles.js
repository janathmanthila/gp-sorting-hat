/* Subtitles that appear word by word as a line plays. */
(function () {
  'use strict';
  let el = null;
  let words = [];
  let pause = null; // a shout's held pause { start, end } in seconds: its lead-in words finish before it

  function mount(node) { el = node; }

  function set(text, { shout = false, pause: gap = null } = {}) {
    pause = gap;
    el.classList.toggle('shout', shout);
    el.replaceChildren();
    words = text.split(/\s+/).filter(Boolean).map(w => {
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = `${w} `;
      el.append(span);
      return span;
    });
  }

  // p = 0..1 through the line; t = seconds into the audio, when it is playing.
  function progress(p, t) {
    let shown = Math.ceil(p * words.length);
    if (pause && t !== undefined) shown = Math.min(words.length, Math.ceil((t / pause.start) * words.length)); // over the lead-in only
    words.forEach((w, i) => w.classList.toggle('on', i < shown));
  }

  function clear() {
    el.replaceChildren();
    words = [];
    pause = null;
  }

  window.Subtitles = { mount, set, progress, clear };
})();
