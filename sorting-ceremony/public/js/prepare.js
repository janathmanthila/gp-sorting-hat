/* Prepare: upload → generate → review/approve → voice → listen, polling the server while a job runs. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const LIMITS = { intro: 160, ponder: 120, shout: 80 };
  const PARTS = ['intro', 'ponder', 'shout'];
  const LABELS = { intro: 'Intro', ponder: 'Thinking', shout: 'Shout' };
  const PHASES = { empty: 'No set yet', generating: 'Writing speeches', review: 'Review', voicing: 'Voicing', ready: 'Ready for the show' };
  const player = new Audio();
  let state = null;
  let people = [];
  let houses = [];
  let poll = 0;
  let started = null; // { at, done } when the current voicing run was first seen, for the time-left estimate

  const voiceLabel = v => (v === 'cb-turbo' ? 'Hat (Chatterbox Turbo — a few hours)'
    : v === 'cb-hat' ? 'Dramatic hat (Chatterbox — slow, two nights)'
    : /^bm_/.test(v) ? `Kokoro ${v.slice(3).replace(/^./, c => c.toUpperCase())} (fast)` : v);

  // "about 3 h 20 min left", from the pace since this run started; nothing until there's a pace to go by.
  function timeLeft(done, total) {
    if (!started || done <= started.done) return '';
    const ms = (Date.now() - started.at) / (done - started.done) * (total - done);
    const min = Math.max(1, Math.round(ms / 60000));
    return ` · about ${min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`} left`;
  }

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }

  function showError(message) {
    $('error').textContent = message || '';
    $('error').hidden = !message;
  }

  async function guarded(fn) {
    try {
      showError('');
      await fn();
    } catch (err) {
      showError(err.message);
    }
  }

  // ---- state & polling ----

  // state.busy is 'generate' or 'voice' while any server job runs (also a single regenerate or voice samples).
  async function refresh() {
    const previous = state && state.phase;
    const wasBusy = Boolean(state && state.busy);
    state = await api('GET', '/api/state');
    houses = state.houses;
    $('phase').textContent = PHASES[state.phase];
    $('voice-name').textContent = voiceLabel(state.voice);
    if (state.error) showError(state.error);
    const busy = Boolean(state.busy);
    const generating = state.busy === 'generate';
    $('progress-card').hidden = !(busy && state.progress);
    if (busy && state.progress) {
      $('progress-title').textContent = generating ? 'Writing speeches…' : 'Giving the hat its voice…';
      $('progress').value = state.progress.total ? state.progress.done / state.progress.total : 0;
      // The pace is timed from the first finished clip, so instantly skipped (unchanged) clips don't skew it.
      if (!generating && !started && state.progress.done) started = { at: Date.now(), done: state.progress.done };
      const eta = generating ? '' : timeLeft(state.progress.done, state.progress.total);
      $('progress-text').textContent = `${state.progress.done} of ${state.progress.total} ${generating ? 'people' : 'clips'}${eta}`;
      $('cancel').hidden = generating;
    }
    if (state.busy !== 'voice') started = null;
    $('review-card').hidden = !['review', 'ready', 'voicing'].includes(state.phase);
    $('review-title').textContent = state.phase === 'ready' ? '3 · Listen & fine-tune' : '2 · Review';
    $('approve').hidden = state.phase === 'ready';
    $('revoice').hidden = state.phase !== 'ready';
    for (const b of document.querySelectorAll('button')) b.disabled = busy && b.id !== 'cancel';
    for (const f of $('rows').querySelectorAll('textarea, input')) f.disabled = generating;
    clearTimeout(poll);
    if (busy) poll = setTimeout(tick, 1000);
    if (!busy && (previous !== state.phase || wasBusy || !people.length) && state.people) await loadPeople();
    else if (people.length) renderCountsOnly(); // re-applies Approve's disabled state after the busy loop
  }

  // One poll; keeps polling while a job runs even if a request fails.
  async function tick() {
    try {
      await refresh();
    } catch (err) {
      showError(err.message);
      if (state && state.busy) { clearTimeout(poll); poll = setTimeout(tick, 2000); }
    }
  }

  async function loadPeople() {
    people = await api('GET', '/api/people');
    renderRows();
  }

  // ---- upload & generate ----

  const toBase64 = file => file.arrayBuffer().then(buf => {
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });

  $('check').addEventListener('click', () => guarded(async () => {
    const [input, housesFile] = [$('input-file').files[0], $('houses-file').files[0]];
    if (!input || !housesFile) throw new Error('Choose both files first.');
    const summary = await api('POST', '/api/upload', { input: await toBase64(input), houses: await toBase64(housesFile) });
    const skipped = summary.unassigned.length
      ? ` ${summary.unassigned.length} have no house and will be left out: ${summary.unassigned.slice(0, 8).join(', ')}${summary.unassigned.length > 8 ? '…' : ''}.`
      : '';
    $('summary-text').textContent = `${summary.people} people, ${summary.houses.length} houses.${skipped}`;
    $('traits').innerHTML = summary.houses.map(h => `
      <label>${esc(h.name)} traits
        <input type="text" data-house="${esc(h.name)}" value="${esc(h.traits)}" placeholder="e.g. courage, daring and chivalry">
      </label>`).join('');
    $('summary').hidden = false;
  }));

  $('generate').addEventListener('click', () => guarded(async () => {
    if (state.phase !== 'empty' && !confirm('This replaces the current set: all speeches and voices will be deleted. Continue?')) return;
    const traits = Object.fromEntries([...document.querySelectorAll('[data-house]')].map(i => [i.dataset.house, i.value]));
    await api('POST', '/api/generate', { traits });
    people = [];
    $('rows').innerHTML = '';
    $('summary').hidden = true;
    await refresh();
  }));

  // ---- review / listen rows ----

  function rowHtml(p) {
    const house = houses.find(h => h.name === p.house);
    const lines = PARTS.map(part => {
      const text = p.lines ? p.lines[part] : '';
      const warn = p.warnings[part].filter(w => w !== 'empty' || p.lines).join(' · ');
      const note = state.phase === 'ready' && !p.audio[part] ? (p.voiceFailed.includes(part) ? 'voice failed' : 'needs re-voice') : '';
      const play = p.audio[part] ? `<button class="btn small play" data-play="${esc(p.audio[part])}" aria-label="Play ${LABELS[part]}">▶</button>` : '';
      return `<div class="line">
        <label for="${esc(p.id)}-${part}">${LABELS[part]} <span class="count">${text.length}/${LIMITS[part]}</span> <span class="warn">${esc(warn)}</span>${note ? `<span class="voice-note">${note}</span>` : ''}${play}</label>
        <textarea id="${esc(p.id)}-${part}" data-part="${part}" rows="${part === 'intro' ? 3 : 1}">${esc(text)}</textarea>
      </div>`;
    }).join('');
    const playAll = p.audio.intro ? '<button class="btn small" data-play-all>▶ All</button>' : '';
    return `<div class="row ${p.lines ? (p.hasWarnings ? 'flagged' : '') : 'missing'}" data-id="${esc(p.id)}" style="--house:${house ? house.color : ''}">
      <div class="who">
        <strong>${esc(p.name)}</strong>
        <span class="muted">${esc(p.department)}</span><br>
        <span class="house">${esc(p.house)}</span>
        <div class="tools">
          <button class="btn small" data-regen title="Write new lines for this person">↻ New lines</button>${playAll}
        </div>
        <label class="sayas">Say name as (voice only)
          <input type="text" data-sayas value="${esc(p.sayAs)}" placeholder="${esc(p.firstName)}">
        </label>
      </div>
      <div class="lines">${p.lines ? lines : '<p class="muted">Not generated yet.</p>'}</div>
    </div>`;
  }

  // Runs render(), keeping the field being typed in (focus and unsaved text).
  function keepingFocus(render) {
    const focused = $('rows').contains(document.activeElement) ? document.activeElement : null;
    render();
    const again = focused && focused.id && $(focused.id);
    if (again && again !== focused) {
      again.value = focused.value;
      again.focus();
    }
  }

  function renderRows() {
    const q = $('search').value.trim().toLowerCase();
    const onlyWarnings = $('warnings-only').checked;
    const shown = people.filter(p => (!q || p.name.toLowerCase().includes(q)) && (!onlyWarnings || p.hasWarnings));
    keepingFocus(() => { $('rows').innerHTML = shown.map(rowHtml).join(''); });
    for (const f of $('rows').querySelectorAll('textarea, input')) f.disabled = Boolean(state && state.busy === 'generate');
    const missing = people.filter(p => !p.lines).length;
    const flagged = people.filter(p => p.lines && p.hasWarnings).length;
    $('counts').textContent = `${people.length} people · ${flagged} with warnings · ${missing} missing`;
    $('generate-missing').hidden = !missing;
    $('approve').disabled = Boolean(missing || flagged) || state.phase !== 'review';
  }

  function replacePerson(updated) {
    people = people.map(p => (p.id === updated.id ? updated : p));
    const row = document.querySelector(`.row[data-id="${CSS.escape(updated.id)}"]`);
    if (row) keepingFocus(() => { row.outerHTML = rowHtml(updated); });
    renderCountsOnly();
  }

  function renderCountsOnly() {
    const missing = people.filter(p => !p.lines).length;
    const flagged = people.filter(p => p.lines && p.hasWarnings).length;
    $('counts').textContent = `${people.length} people · ${flagged} with warnings · ${missing} missing`;
    $('approve').disabled = Boolean(missing || flagged) || state.phase !== 'review';
  }

  // Save a row when one of its fields loses focus after a change.
  $('rows').addEventListener('change', e => guarded(async () => {
    const row = e.target.closest('.row');
    if (!row) return;
    const id = row.dataset.id;
    const body = {};
    if (e.target.matches('[data-sayas]')) body.sayAs = e.target.value;
    if (e.target.matches('[data-part]')) {
      body.lines = Object.fromEntries(PARTS.map(part => [part, row.querySelector(`[data-part="${part}"]`).value]));
    }
    try {
      replacePerson(await api('PUT', `/api/people/${encodeURIComponent(id)}`, body));
    } catch (err) {
      e.target.blur();
      replacePerson(people.find(p => p.id === id)); // back to the last saved text
      throw new Error(`Not saved: ${err.message}`);
    }
  }));

  $('rows').addEventListener('input', e => {
    if (!e.target.matches('[data-part]')) return;
    const count = e.target.closest('.line').querySelector('.count');
    count.textContent = `${e.target.value.length}/${LIMITS[e.target.dataset.part]}`;
  });

  $('rows').addEventListener('click', e => guarded(async () => {
    const row = e.target.closest('.row');
    if (e.target.matches('[data-play]')) return playList([e.target.dataset.play]);
    if (e.target.matches('[data-play-all]')) {
      const p = people.find(x => x.id === row.dataset.id);
      return playList(PARTS.map(part => p.audio[part]).filter(Boolean));
    }
    if (e.target.matches('[data-regen]')) {
      const button = e.target;
      button.disabled = true;
      button.textContent = 'Writing…';
      try {
        replacePerson(await api('POST', `/api/people/${encodeURIComponent(row.dataset.id)}/regenerate`));
      } finally {
        button.disabled = false; // only matters if the row wasn't replaced
        button.textContent = '↻ New lines';
      }
    }
  }));

  function playList(urls) {
    let i = 0;
    const next = () => {
      if (i >= urls.length) { player.onended = null; return; }
      player.src = urls[i++];
      player.play().catch(err => showError(`Couldn't play audio: ${err.message}`));
    };
    player.onended = next;
    next();
  }

  $('search').addEventListener('input', renderRows);
  $('warnings-only').addEventListener('change', renderRows);
  $('generate-missing').addEventListener('click', () => guarded(async () => { await api('POST', '/api/generate-missing'); await refresh(); }));
  $('approve').addEventListener('click', () => guarded(async () => { await api('POST', '/api/approve'); await refresh(); }));
  $('revoice').addEventListener('click', () => guarded(async () => { await api('POST', '/api/voice'); await refresh(); }));
  $('cancel').addEventListener('click', () => guarded(async () => { await api('POST', '/api/voice/cancel'); await refresh(); }));

  // ---- voice samples ----

  $('samples').addEventListener('click', () => guarded(async () => {
    $('samples').disabled = true;
    $('samples').textContent = 'Making samples… (a few minutes)';
    try {
      const { samples } = await api('POST', '/api/voice/samples');
      $('sample-list').innerHTML = samples.map(s => `
        <li>
          <button class="btn small" data-sample="${esc(s.src)}">▶ ${esc(voiceLabel(s.voice))}</button>
          <label class="check"><input type="radio" name="voice" value="${esc(s.voice)}" ${s.voice === state.voice ? 'checked' : ''}> Use this voice</label>
        </li>`).join('');
    } finally {
      $('samples').disabled = false;
      $('samples').textContent = 'Make samples';
    }
  }));

  $('sample-list').addEventListener('click', e => { if (e.target.matches('[data-sample]')) playList([e.target.dataset.sample]); });
  $('sample-list').addEventListener('change', e => guarded(async () => {
    if (!e.target.matches('[name=voice]')) return;
    await api('PUT', '/api/voice-choice', { voice: e.target.value });
    await refresh();
    if (state.phase === 'ready') showError('Voice changed. Press "Re-voice changes" to voice every line in the new voice.');
  }));

  tick();
})();
