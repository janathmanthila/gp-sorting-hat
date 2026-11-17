/* House Draft UI: file selection, validation, generation, live preview & edit, finalize & export. */
(function () {
  'use strict';
  const { MODES, GENDER_LABEL } = Engine;

  // House colours by position on the Houses sheet (Orion blue, Aquila purple, Cygnus pink, Draco green),
  // then spares for any extra houses. Each theme has its own shade so text stays readable.
  const HOUSE_COLORS = {
    dark: ['#8fb0ff', '#c9a8ff', '#ff8fc7', '#62d6a0', '#ffa77a', '#5ad1e6', '#e6c35c', '#ff8a8a'],
    light: ['#2f56c9', '#6d32d6', '#be1f74', '#0f7a4f', '#b54a14', '#0e7490', '#8a6100', '#b42318'],
  };
  const CONSTELLATIONS = [
    '4,18 12,6 22,12 32,4 44,14', '4,12 14,6 22,14 32,8 44,16', '24,2 24,22 24,9 4,5 24,9 44,5',
    '4,6 12,14 20,8 28,16 36,10 44,18', '4,20 14,10 24,16 34,4 44,10', '4,10 16,16 26,6 36,14 44,4',
  ];
  const THEME_KEY = 'sortinghat-theme';
  const ICONS = {
    dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
    repeat: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    scale: '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 7a3.5 3.5 0 0 0 6 0z"/><path d="M19 7l-3 7a3.5 3.5 0 0 0 6 0z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor" stroke="none"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const randomSeed = () => Math.floor(Math.random() * 1e6);

  const state = {
    screen: 'setup',          // setup | preview | done
    mode: MODES.FULL,
    employeeFile: null,       // { name, sheets }
    assignmentFile: null,
    seed: randomSeed(),
    prepared: null,           // result of Engine.prepare
    validation: null,         // { ok, errors, warnings }
    board: null,
    generatedAssign: null,
    history: [],
    edits: 0,
    selected: null,           // entry index
    partner: null,            // entry index (swap target)
    lastChange: null,         // { before, after }
    search: '',
    showExisting: true,
    eventFilter: '',          // '' = all events, else an index into config.events
    output: null,             // { fileName, workbook }
  };

  const app = document.getElementById('app');

  // ---------- utilities ----------

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const houseColor = h => HOUSE_COLORS[theme()][h % HOUSE_COLORS.dark.length];
  const houseVars = h => `--house:${houseColor(h)};--house-tint:${houseColor(h)}${theme() === 'dark' ? '22' : '16'}`;
  const constellation = h => `<svg class="constellation" viewBox="0 0 48 24" aria-hidden="true"><polyline points="${CONSTELLATIONS[h % CONSTELLATIONS.length]}" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".75"/></svg>`;
  const fullName = emp => [emp.firstName, emp.lastName].filter(Boolean).join(' ') || emp.id;
  const plural = (n, word) => `${n} ${n === 1 ? word : word === 'person' ? 'people' : `${word}s`}`;

  // How far apart the houses are on one figure: ok (gap ≤ 1), warn (small gap) or bad.
  function severity(row) {
    if (row.spread <= 1) return 'ok';
    const tolerated = row.group === 'Rating points' ? 4 : 2;
    return row.spread <= tolerated ? 'warn' : 'bad';
  }

  // "Male rating points", "Female level 2 (Occasional)", "Male Cricket stars".
  function describeFigure(row) {
    if (row.group === 'Rating levels') return row.label.replace(/ · L(\d+) (.*)/, ' level $1 ($2)');
    if (row.group === 'Star players') return `${row.label.replace(' · ', ' ')} stars`;
    return `${row.label} ${row.group.toLowerCase()}`;
  }

  /** Plain-language verdict on the whole draft, used instead of the raw cost number. */
  function fairness(summary, mode) {
    const counted = summary.rows.filter(r => !r.displayOnly);
    const bad = counted.filter(r => severity(r) === 'bad');
    const warn = counted.filter(r => severity(r) === 'warn');
    if (mode === MODES.FULL && !summary.sizeOk) {
      return { level: 'bad', title: 'Uneven', detail: `House sizes differ by ${summary.sizeSpread} (should be at most 1)` };
    }
    if (bad.length) return { level: 'bad', title: 'Uneven', detail: `${plural(bad.length, 'figure')} clearly out of line — see the summary` };
    if (warn.length) return { level: 'good', title: 'Balanced', detail: `${plural(warn.length, 'small gap')} of 2; everything else within 1` };
    return { level: 'great', title: 'Very balanced', detail: 'Every figure is within 1 across houses' };
  }

  /** Compares two summaries and explains the difference in words. */
  function describeChange(before, after, p) {
    const balance = s => s.cost.total - p.pw * s.cost.repeats;
    const dBalance = balance(after) - balance(before);
    const dRepeats = after.cost.repeats - before.cost.repeats;
    const beforeByKey = new Map(before.rows.map(r => [r.group + r.label, r]));
    const details = after.rows
      .map(r => ({ r, old: beforeByKey.get(r.group + r.label) }))
      .filter(({ r, old }) => !r.displayOnly && old && old.spread !== r.spread)
      .sort((a, b) => Math.abs(b.r.spread - b.old.spread) - Math.abs(a.r.spread - a.old.spread))
      .slice(0, 3)
      .map(({ r, old }) => `${describeFigure(r)}: gap ${fmt(old.spread)} → ${fmt(r.spread)}`);
    if (after.sizeSpread !== before.sizeSpread && p.mode === MODES.FULL) {
      details.unshift(`House sizes: gap ${before.sizeSpread} → ${after.sizeSpread}`);
    }
    if (dRepeats) details.push(`${plural(Math.abs(dRepeats), 'person')} ${dRepeats > 0 ? 'more' : 'fewer'} back in their previous house`);
    let dir, text;
    if (dBalance < 0) { dir = 'better'; text = 'More balanced'; }
    else if (dBalance > 0) { dir = 'worse'; text = 'Less balanced'; }
    else if (dRepeats) { dir = dRepeats < 0 ? 'better' : 'worse'; text = 'Balance unchanged'; }
    else { dir = 'same'; text = 'No change in balance'; }
    return { dir, text, details };
  }

  function toast(message, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.classList.add('hide'), 4200);
    setTimeout(() => el.remove(), 4700);
  }

  function confirmDialog(title, bodyHtml, okLabel = 'Confirm') {
    const dlg = document.getElementById('confirm');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-body').innerHTML = bodyHtml;
    document.getElementById('confirm-ok').textContent = okLabel;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise(resolve => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  function setStep() {
    let current;
    if (state.screen === 'done') current = 'export';
    else if (state.screen === 'preview') current = 'preview';
    else if (state.validation && state.validation.ok) current = 'generate';
    else if (state.employeeFile) current = 'validate';
    else current = 'files';
    const order = ['files', 'validate', 'generate', 'preview', 'export'];
    document.querySelectorAll('#stepper li').forEach(li => {
      const i = order.indexOf(li.dataset.step), c = order.indexOf(current);
      li.className = i < c ? 'done' : i === c ? 'current' : '';
    });
  }

  function render() {
    setStep();
    if (state.screen === 'setup') renderSetup();
    else if (state.screen === 'preview') renderPreview();
    else renderDone();
  }

  // ---------- setup: select files, validate, generate ----------

  function resetValidation() {
    state.prepared = null;
    state.validation = null;
  }

  function renderSetup() {
    const isNew = state.mode === MODES.NEW;
    const v = state.validation;
    app.innerHTML = `
      <section class="panel">
        <h2>1 · Choose a mode</h2>
        <div class="modes">
          ${modeCard(MODES.FULL, 'Full Shuffle', 'Once a year, before houses are announced. Assigns everyone with Include = 1.')}
          ${modeCard(MODES.NEW, 'Assign New', 'During the year. Places only new joiners; existing assignments never change.')}
        </div>
      </section>

      <section class="panel">
        <h2>2 · Select file${isNew ? 's' : ''}</h2>
        <div class="files">
          ${fileSlot('employee', 'Employee data file', `${Engine.EMPLOYEES_SHEET}, Houses, Events, Rating Levels and Settings sheets`, state.employeeFile)}
          ${isNew ? fileSlot('assignment', 'Current house assignment file', 'A House_Assignments_….xlsx exported by this app', state.assignmentFile) : ''}
        </div>
        <div class="seed-row">
          <label for="seed">Seed</label>
          <input id="seed" type="number" min="0" step="1" value="${esc(state.seed)}">
          <button class="btn ghost" id="reroll" title="Pick a new random seed">${icon('dice')} New seed</button>
          <span class="hint">The same files and seed always give the same draft.</span>
        </div>
      </section>

      <section class="panel">
        <h2>3 · Validate &amp; generate</h2>
        <div class="actions">
          <button class="btn" id="validate" ${state.employeeFile && (!isNew || state.assignmentFile) ? '' : 'disabled'}>Validate</button>
          <button class="btn primary" id="generate" ${v && v.ok ? '' : 'disabled'}>Generate draft</button>
        </div>
        ${v ? validationHtml(v) : '<p class="hint">Select the file(s) above, then validate.</p>'}
      </section>`;

    app.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => {
      if (state.mode === el.dataset.mode) return;
      state.mode = el.dataset.mode;
      resetValidation();
      render();
    }));
    app.querySelectorAll('input[type=file]').forEach(input => input.addEventListener('change', () => loadFile(input)));
    app.querySelectorAll('.drop').forEach(zone => {
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('over');
        const input = zone.querySelector('input[type=file]');
        if (e.dataTransfer.files.length) readInto(input.dataset.kind, e.dataTransfer.files[0]);
      });
    });
    app.querySelector('#seed').addEventListener('change', e => { state.seed = Math.max(0, Math.floor(Number(e.target.value) || 0)); });
    app.querySelector('#reroll').addEventListener('click', () => { state.seed = randomSeed(); render(); });
    app.querySelector('#validate').addEventListener('click', validate);
    app.querySelector('#generate').addEventListener('click', generate);
  }

  function modeCard(mode, title, desc) {
    return `<button class="mode ${state.mode === mode ? 'active' : ''}" data-mode="${mode}" aria-pressed="${state.mode === mode}">
      <strong>${title}</strong><span>${desc}</span></button>`;
  }

  function fileSlot(kind, title, desc, file) {
    return `<label class="drop ${file ? 'loaded' : ''}">
      <input type="file" accept=".xlsx,.xlsm,.xls" data-kind="${kind}" hidden>
      <span class="drop-title">${title}</span>
      <span class="drop-file">${file ? `${icon('file')} ${esc(file.name)}` : 'Click to choose or drop an .xlsx here'}</span>
      <span class="hint">${desc}</span>
    </label>`;
  }

  function loadFile(input) {
    if (input.files.length) readInto(input.dataset.kind, input.files[0]);
  }

  async function readInto(kind, file) {
    try {
      const sheets = IO.readArrayBuffer(new Uint8Array(await file.arrayBuffer()));
      state[kind === 'employee' ? 'employeeFile' : 'assignmentFile'] = { name: file.name, sheets };
    } catch (err) {
      toast(`Couldn't read ${file.name}: ${err.message}`, 'error');
    }
    resetValidation();
    render();
  }

  function validate() {
    try {
      state.prepared = Engine.prepare({
        mode: state.mode,
        employeeSheets: state.employeeFile.sheets,
        assignmentSheets: state.assignmentFile && state.assignmentFile.sheets,
      });
      state.validation = { ok: true, errors: [], warnings: state.prepared.warnings };
    } catch (err) {
      if (!(err instanceof Engine.ValidationError)) throw err;
      state.prepared = null;
      state.validation = { ok: false, errors: err.messages, warnings: err.warnings };
    }
    render();
  }

  function validationHtml(v) {
    let html = '';
    if (!v.ok) {
      html += `<div class="callout error"><strong>Fix these before continuing</strong><ul>${v.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
    } else {
      const s = state.prepared.stats;
      const p = state.prepared.problem;
      const facts = state.mode === MODES.FULL
        ? [`${s.included} people to assign`, `${s.excluded} excluded (Include = 0)`, `${s.fixed} with a Fixed House`, `${p.H} houses`]
        : [`${s.newcomers} new employee${s.newcomers === 1 ? '' : 's'} to assign`, `${s.existing} existing (locked)`, `${s.leavers} possible leaver${s.leavers === 1 ? '' : 's'}`, `${p.H} houses`];
      html += `<div class="callout ok"><strong>Files look good.</strong> ${facts.join(' · ')}<br>
        <span class="hint">Houses: ${p.config.houses.map(esc).join(', ')} · Events: ${p.config.events.length} · Levels: ${p.config.levels.map(l => l.level).join(', ')}</span></div>`;
    }
    if (v.warnings && v.warnings.length) {
      html += `<div class="callout warn"><strong>Warnings</strong><ul>${v.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
    }
    return html;
  }

  function generate() {
    const btn = app.querySelector('#generate');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    // Let the button repaint before the (short) blocking search.
    setTimeout(() => {
      state.board = Engine.generate(state.prepared.problem, state.seed);
      state.generatedAssign = Int32Array.from(state.board.assign);
      state.history = [];
      state.edits = 0;
      state.selected = state.partner = null;
      state.lastChange = null;
      state.eventFilter = ''; // event list may differ between files
      state.screen = 'preview';
      render();
      window.scrollTo(0, 0);
    }, 30);
  }

  // ---------- preview & edit ----------

  function entryStatus(i) {
    const e = state.board.p.entries[i];
    if (e.leaver) return 'leaver';
    if (e.existing) return 'locked';
    return 'movable';
  }

  function renderPreview() {
    const board = state.board;
    const p = board.p;
    const summary = Engine.summarize(board);
    const isNew = p.mode === MODES.NEW;
    const q = state.search.trim().toLowerCase();
    const ev = state.eventFilter === '' ? null : Number(state.eventFilter);
    const isStar = i => !p.entries[i].leaver && p.entries[i].emp.stars.includes(ev);
    const eventName = ev === null ? '' : p.config.events[ev];

    const houses = p.config.houses.map((name, h) => {
      const members = p.entries.map((e, i) => i).filter(i => board.assign[i] === h);
      const groups = p.config.levels.map(l => ({
        title: `L${l.level} · ${l.label}`,
        items: members.filter(i => !p.entries[i].leaver && p.entries[i].emp.rating === l.level),
      }));
      groups.push({ title: 'Possible leavers', items: members.filter(i => p.entries[i].leaver), leavers: true });
      const newCount = members.filter(i => p.entries[i].isNew).length;
      const counted = members.filter(i => !p.entries[i].leaver);
      const f = counted.filter(i => p.entries[i].emp.gender === 'F').length;
      const m = counted.filter(i => p.entries[i].emp.gender === 'M').length;
      const sel = state.selected;
      const canMoveHere = sel !== null && board.assign[sel] !== h;
      const stars = ev === null ? [] : counted.filter(isStar);
      const starsF = stars.filter(i => p.entries[i].emp.gender === 'F').length;
      const starsM = stars.filter(i => p.entries[i].emp.gender === 'M').length;
      const eventMeta = ev === null ? '' : `<div class="event-meta">${icon('star')} ${plural(stars.length, `${esc(eventName)} star`)}${stars.length ? ` · ${starsF} F · ${starsM} M` : ''}</div>`;
      const shown = groups.map(g => {
        let items = g.items.slice().sort((a, b) => fullName(p.entries[a].emp).localeCompare(fullName(p.entries[b].emp)));
        if (isNew && !state.showExisting) items = items.filter(i => p.entries[i].isNew);
        if (ev !== null) items = items.filter(isStar);
        if (!items.length) return '';
        return `<div class="level ${g.leavers ? 'leavers' : ''}">
            <div class="level-title">${esc(g.title)} <span>${ev === null ? g.items.length : items.length}</span></div>
            ${items.map(i => personRow(i, q)).join('')}
          </div>`;
      }).join('');
      return `<div class="house" style="${houseVars(h)}">
        <header>
          <div class="house-title"><h3>${esc(name)}</h3><span style="color:var(--house)">${constellation(h)}</span></div>
          <div class="house-meta">${counted.length} people · ${f} F · ${m} M${isNew ? ` · ${newCount} new` : ''}</div>
          ${eventMeta}
          ${canMoveHere ? `<button class="btn small move-here" data-move="${h}">Move ${esc(p.entries[sel].emp.firstName || p.entries[sel].emp.id)} here</button>` : ''}
        </header>
        ${shown || (ev !== null ? `<p class="empty-note">No ${esc(eventName)} stars in ${esc(name)}</p>` : '')}
      </div>`;
    }).join('');

    const verdict = fairness(summary, p.mode);
    const change = state.lastChange;
    const arrow = { better: icon('up'), worse: icon('down'), same: '' };
    app.innerHTML = `
      <section class="toolbar">
        <div class="fairness ${verdict.level}" title="Technical score: ${fmt(summary.cost.total)} (lower is fairer)">
          <span class="fairness-icon">${icon('scale')}</span>
          <div>
            <span class="label">Balance</span>
            <strong>${verdict.title}</strong>
            <span class="detail">${esc(verdict.detail)} · ${plural(summary.cost.repeats, 'person')} back in their previous house</span>
          </div>
        </div>
        ${change ? `<span class="change ${change.dir}" title="${esc(change.details.join('\n'))}">${arrow[change.dir]} Last change: ${change.text.toLowerCase()}</span>` : ''}
        <div class="chips">
          <span class="chip">${isNew ? 'Assign New' : 'Full Shuffle'}</span>
          <span class="chip">Seed ${esc(state.seed)}</span>
          ${p.mode === MODES.FULL ? `<span class="chip ${summary.sizeOk ? 'ok' : 'bad'}">House sizes ${summary.sizeOk ? 'within ±1' : `differ by ${summary.sizeSpread}`}</span>` : ''}
          ${state.edits ? `<span class="chip">${state.edits} manual edit${state.edits === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div class="toolbar-actions">
          <label class="sr-only" for="event-filter">Show star players for an event</label>
          <select id="event-filter" class="${ev === null ? '' : 'active'}">
            <option value="">All events</option>
            ${p.config.events.map((e, k) => {
              const n = p.entries.filter((x, i) => !x.leaver && x.emp.stars.includes(k)).length;
              return `<option value="${k}" ${ev === k ? 'selected' : ''}>${esc(e)} stars (${n})</option>`;
            }).join('')}
          </select>
          <label class="sr-only" for="search">Find a person</label>
          <input type="search" id="search" placeholder="Find a person…" value="${esc(state.search)}">
          ${isNew ? `<label class="check"><input type="checkbox" id="show-existing" ${state.showExisting ? 'checked' : ''}> Show existing</label>` : ''}
          <button class="btn" id="undo" ${state.history.length ? '' : 'disabled'}>${icon('undo')} Undo</button>
          <button class="btn" id="reset" ${state.edits ? '' : 'disabled'}>Reset to generated</button>
          <button class="btn ghost" id="back">${icon('back')} Back to files</button>
          <button class="btn primary" id="finalize">Finalize &amp; export</button>
        </div>
      </section>

      <div class="preview">
        <div class="houses" style="--cols:${p.H}">${houses}</div>
        <aside class="summary">${summaryHtml(summary, p)}</aside>
      </div>

      ${selectionBar()}`;

    bindPreview();
  }

  function personRow(i, q) {
    const p = state.board.p;
    const e = p.entries[i];
    const emp = e.emp;
    const status = entryStatus(i);
    const same = !e.leaver && emp.prevHouse >= 0 && emp.prevHouse === state.board.assign[i];
    const flags = [];
    if (e.isNew) flags.push('<span class="flag new">New</span>');
    if (e.fixed) flags.push(`<span class="flag fixed" title="Fixed House">${icon('pin')} Fixed</span>`);
    if (same) flags.push(`<span class="flag same" title="Same as previous house">${icon('repeat')} Same as prev</span>`);
    if (e.leaver) flags.push('<span class="flag leaver">Possible leaver</span>');
    if (status === 'locked') flags.push(`<span class="flag lock" title="Existing assignment, locked">${icon('lock')}<span class="sr-only">Locked</span></span>`);
    const stars = emp.stars.map(s => `<span class="star${String(s) === state.eventFilter ? ' on' : ''}">${icon('star')} ${esc(p.config.events[s])}</span>`).join('');
    const match = q && (fullName(emp).toLowerCase().includes(q) || emp.id.toLowerCase().includes(q));
    const cls = ['person', status, state.selected === i ? 'selected' : '', state.partner === i ? 'partner' : '', q ? (match ? 'match' : 'dim') : ''].join(' ');
    return `<div class="${cls}" data-i="${i}" ${status === 'movable' ? 'tabindex="0" role="button"' : ''}>
      <span class="g g-${emp.gender || 'x'}" title="${GENDER_LABEL[emp.gender] || ''}">${emp.gender || '–'}</span>
      <span class="name">${esc(fullName(emp))}</span>
      ${e.leaver ? '' : `<span class="rating" title="Overall rating">${emp.rating}</span>`}
      <span class="tags">${stars}${flags.join('')}</span>
    </div>`;
  }

  function summaryHtml(summary, p) {
    const worst = new Set(summary.worst.map(w => w.label + w.group));
    const head = `<tr><th></th>${summary.houses.map((h, i) => `<th style="color:${houseColor(i)}">${esc(h)}</th>`).join('')}<th title="Difference between the highest and lowest house">Gap</th></tr>`;
    const groups = ['Head count', 'Rating points', 'Rating levels', 'Star players'];
    let body = '';
    for (const g of groups) {
      const rows = summary.rows.filter(r => r.group === g);
      if (!rows.length) continue;
      body += `<tr class="group"><th colspan="${summary.houses.length + 2}">${g}</th></tr>`;
      for (const r of rows) {
        const hi = Math.max(...r.values), lo = Math.min(...r.values);
        body += `<tr class="${worst.has(r.label + r.group) ? 'worst' : ''}">
          <td>${esc(r.label)}</td>
          ${r.values.map(v => `<td class="${r.spread > 1 && v === hi ? 'hi' : r.spread > 1 && v === lo ? 'lo' : ''}">${fmt(v)}</td>`).join('')}
          <td class="spread ${r.displayOnly ? '' : severity(r)}">${fmt(r.spread)}</td></tr>`;
      }
    }
    const rep = summary.repeats;
    body += `<tr class="group"><th colspan="${summary.houses.length + 2}">Previous house</th></tr>
      <tr><td>Repeats</td>${rep.map(v => `<td>${v}</td>`).join('')}<td class="spread">${rep.reduce((a, b) => a + b, 0)} total</td></tr>`;

    const worstHtml = summary.worst.length
      ? `<ul class="worst-list">${summary.worst.map(w => `<li><span class="spread ${severity(w)}">${fmt(w.spread)}</span> ${esc(describeFigure(w))}</li>`).join('')}</ul>`
      : '<p class="hint">Every balanced figure is within 1 across houses.</p>';
    return `<h3>Balance summary</h3>
      <p class="hint">Gap = difference between the highest and lowest house. 0–1 is even.</p>
      <div class="worst-box"><strong>Biggest gaps</strong>${worstHtml}</div>
      <div class="table-wrap"><table class="summary-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function selectionBar() {
    if (state.selected === null) {
      const p = state.board.p;
      return `<div class="selbar idle">Click a ${p.mode === MODES.NEW ? 'new ' : ''}person to move them, then click a person in another house to swap.</div>`;
    }
    const p = state.board.p;
    const a = state.selected, b = state.partner;
    const ea = p.entries[a];
    const houseA = p.config.houses[state.board.assign[a]];
    if (b !== null) {
      const eb = p.entries[b];
      return `<div class="selbar">
        <span>Swap <strong>${esc(fullName(ea.emp))}</strong> (${esc(houseA)}) ⇄ <strong>${esc(fullName(eb.emp))}</strong> (${esc(p.config.houses[state.board.assign[b]])})?</span>
        <button class="btn primary" id="do-swap">Swap</button>
        <button class="btn ghost" id="clear-sel">Cancel</button>
      </div>`;
    }
    const others = p.config.houses.map((h, i) => i).filter(h => h !== state.board.assign[a]);
    return `<div class="selbar">
      <span><strong>${esc(fullName(ea.emp))}</strong> (${esc(houseA)}) — move to</span>
      ${others.map(h => `<button class="btn small housebtn" style="${houseVars(h)}" data-move="${h}">${esc(p.config.houses[h])}</button>`).join('')}
      <span class="hint">or click someone in another house to swap</span>
      <button class="btn ghost" id="clear-sel">Cancel</button>
    </div>`;
  }

  function bindPreview() {
    app.querySelectorAll('.person.movable').forEach(el => {
      const pick = () => selectPerson(Number(el.dataset.i));
      el.addEventListener('click', pick);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    app.querySelectorAll('.person.locked, .person.leaver').forEach(el => el.addEventListener('click', () => {
      toast('Existing assignments are locked in Assign New mode; only new employees can be moved.', 'warn');
    }));
    app.querySelectorAll('[data-move]').forEach(el => el.addEventListener('click', () => moveSelected(Number(el.dataset.move))));
    const on = (id, ev, fn) => { const el = app.querySelector(id); if (el) el.addEventListener(ev, fn); };
    on('#do-swap', 'click', swapSelected);
    on('#clear-sel', 'click', () => { state.selected = state.partner = null; render(); });
    on('#undo', 'click', undo);
    on('#reset', 'click', reset);
    on('#back', 'click', backToFiles);
    on('#finalize', 'click', finalize);
    on('#show-existing', 'change', e => { state.showExisting = e.target.checked; render(); });
    on('#event-filter', 'change', e => { state.eventFilter = e.target.value; render(); });
    on('#search', 'input', e => {
      state.search = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const s = app.querySelector('#search');
      s.focus();
      s.setSelectionRange(pos, pos);
      const first = app.querySelector('.person.match');
      if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function selectPerson(i) {
    const board = state.board;
    if (state.selected === null || state.selected === i) {
      state.selected = state.selected === i ? null : i;
      state.partner = null;
    } else if (board.assign[state.selected] === board.assign[i]) {
      state.selected = i; // same house: just change the selection
      state.partner = null;
    } else {
      state.partner = i;
    }
    render();
  }

  async function confirmFixed(indices) {
    const p = state.board.p;
    const fixed = indices.filter(i => p.entries[i].fixed);
    if (!fixed.length) return true;
    const names = fixed.map(i => `<li><strong>${esc(fullName(p.entries[i].emp))}</strong> is pinned to ${esc(p.config.houses[p.entries[i].emp.fixedHouse])}</li>`).join('');
    return confirmDialog('Move a Fixed House employee?', `<ul>${names}</ul><p>The data file pins ${fixed.length > 1 ? 'these people' : 'this person'} to a house. Move anyway?</p>`, 'Move anyway');
  }

  function applyEdit(mutate, description) {
    const board = state.board;
    const before = Engine.summarize(board);
    state.history.push(Int32Array.from(board.assign));
    mutate(board);
    state.edits++;
    const change = describeChange(before, Engine.summarize(board), board.p);
    state.lastChange = change;
    state.selected = state.partner = null;
    render();
    let message = `${description}. ${change.text}.`;
    if (board.p.mode === MODES.FULL && before.sizeOk && board.sizeSpread() > 1) {
      message += ` Warning: house sizes now differ by ${board.sizeSpread()} (should be at most 1).`;
    }
    toast([message, ...change.details].join('\n'), change.dir === 'worse' ? 'warn' : 'ok');
  }

  async function moveSelected(h) {
    const i = state.selected;
    if (i === null) return;
    if (!(await confirmFixed([i]))) return;
    const p = state.board.p;
    applyEdit(b => b.move(i, h), `Moved ${fullName(p.entries[i].emp)} to ${p.config.houses[h]}`);
  }

  async function swapSelected() {
    const i = state.selected, j = state.partner;
    if (i === null || j === null) return;
    if (!(await confirmFixed([i, j]))) return;
    const p = state.board.p;
    applyEdit(b => b.swap(i, j), `Swapped ${fullName(p.entries[i].emp)} and ${fullName(p.entries[j].emp)}`);
  }

  function restore(assign) {
    const before = Engine.summarize(state.board);
    state.board = new Engine.Board(state.board.p, assign);
    state.lastChange = describeChange(before, Engine.summarize(state.board), state.board.p);
    state.selected = state.partner = null;
  }

  function undo() {
    if (!state.history.length) return;
    restore(state.history.pop());
    state.edits = Math.max(0, state.edits - 1);
    render();
  }

  async function reset() {
    if (!(await confirmDialog('Reset to the generated result?', '<p>All manual moves and swaps will be discarded.</p>', 'Reset'))) return;
    restore(state.generatedAssign);
    state.history = [];
    state.edits = 0;
    render();
  }

  async function backToFiles() {
    if (state.edits && !(await confirmDialog('Leave the preview?', '<p>Your manual edits will be lost.</p>', 'Leave'))) return;
    state.screen = 'setup';
    state.board = null;
    render();
  }

  // ---------- finalize & export ----------

  async function finalize() {
    const summary = Engine.summarize(state.board);
    const issues = [];
    if (state.board.p.mode === MODES.FULL && !summary.sizeOk) issues.push(`House sizes differ by ${summary.sizeSpread} (rule is ±1).`);
    if (summary.worst.length) issues.push(`Biggest gap: ${describeFigure(summary.worst[0])} (${fmt(summary.worst[0].spread)}).`);
    const ok = await confirmDialog('Finalize and export?',
      `<p>This downloads a new Excel workbook with one sheet per house, a Summary and Run Info. Your input files are not changed.</p>
       ${issues.length ? `<div class="callout warn"><ul>${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}`,
      'Finalize & download');
    if (!ok) return;
    state.output = IO.buildOutput(state.board, {
      seed: state.seed,
      edits: state.edits,
      employeeFileName: state.employeeFile.name,
      assignmentFileName: state.mode === MODES.NEW && state.assignmentFile ? state.assignmentFile.name : '',
      now: new Date(),
    });
    download();
    state.screen = 'done';
    render();
  }

  function download() {
    XLSX.writeFile(state.output.workbook, state.output.fileName);
  }

  function renderDone() {
    const p = state.board.p;
    const summary = Engine.summarize(state.board);
    app.innerHTML = `
      <section class="panel done">
        <h2 class="done-title">${icon('check')} Draft finalized</h2>
        <p>Downloaded <strong>${esc(state.output.fileName)}</strong>. Keep it safe: the next <em>Assign New</em> run needs it as the current house assignment file.</p>
        <div class="done-houses">
          ${p.config.houses.map((h, i) => {
            const n = p.entries.filter((e, k) => state.board.assign[k] === i).length;
            return `<div class="done-house" style="${houseVars(i)}"><strong>${esc(h)}</strong><span>${n} people</span></div>`;
          }).join('')}
        </div>
        <p class="hint">Balance: ${fairness(summary, p.mode).title} · seed ${esc(state.seed)} · ${state.edits} manual edit${state.edits === 1 ? '' : 's'}</p>
        <div class="actions">
          <button class="btn" id="again">${icon('download')} Download again</button>
          <button class="btn primary" id="restart">Start a new draft</button>
        </div>
      </section>`;
    app.querySelector('#again').addEventListener('click', download);
    app.querySelector('#restart').addEventListener('click', () => {
      Object.assign(state, {
        screen: 'setup', prepared: null, validation: null, board: null, history: [], edits: 0,
        selected: null, partner: null, lastChange: null, output: null, search: '', eventFilter: '', seed: randomSeed(),
      });
      render();
    });
  }

  // ---------- theme ----------

  const themeButton = document.getElementById('theme-toggle');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function savedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const next = t === 'dark' ? 'light' : 'dark';
    themeButton.innerHTML = `${icon(t === 'dark' ? 'sun' : 'moon')}<span>${next === 'light' ? 'Light' : 'Dark'}</span>`;
    themeButton.setAttribute('aria-label', `Switch to ${next} mode`);
    // House colours are inline per theme, so redraw.
    render();
  }

  themeButton.addEventListener('click', () => {
    const t = theme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode: still switch for this visit */ }
    applyTheme(t);
  });
  // Follow the system setting until the user picks one.
  systemDark.addEventListener('change', e => { if (!savedTheme()) applyTheme(e.matches ? 'dark' : 'light'); });

  window.addEventListener('beforeunload', e => {
    if (state.screen === 'preview') { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('keydown', e => {
    if (state.screen !== 'preview' || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && state.selected !== null) { state.selected = state.partner = null; render(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.target.tagName !== 'INPUT') { e.preventDefault(); undo(); }
  });

  applyTheme(theme());
})();
