#!/usr/bin/env node
/*
 * Sorting Ceremony server: serves Prepare and Show from public/, keeps the current set in workspace/,
 * writes speeches with headless Claude and voices them with the Chatterbox (or Kokoro) container.
 * Run: node sorting-ceremony/server.js, then open http://localhost:4747
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const Sheets = require('./lib/sheets');
const Rules = require('./lib/rules');
const Workspace = require('./lib/workspace');
const Generate = require('./lib/generate');
const Voicing = require('./lib/voicing');

const PORT = Number(process.env.PORT) || 4747;
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 30 * 1024 * 1024;
const VOICES = ['cb-turbo', 'cb-hat', 'bm_george', 'bm_lewis', 'bm_daniel', 'bm_fable'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};
const PAGES = { '/': 'index.html', '/prepare': 'prepare.html', '/show': 'show.html' };

const ws = new Workspace(process.env.CEREMONY_WORKSPACE || path.join(__dirname, 'workspace'));
let pending = null; // last upload, kept in memory until Generate
let job = null; // { kind, cancel? } while generating or voicing

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---- views ----

const houseNames = () => ws.readState().houses.map(h => h.name);

const voiceFiles = () => ({ manifest: ws.readJson('voice.json', {}), voiced: ws.readJson('voiced.json', {}) });

// A part has audio only if its clip was voiced from the line's current text.
function audioUrls(person, { manifest, voiced }) {
  const url = part => {
    const key = Voicing.lineKey(person.id, part);
    const current = person.lines && voiced[key] === Voicing.spokenText(person.lines[part], person);
    return manifest[key] && current ? `/workspace/audio/${key}.mp3?v=${manifest[key].hash.slice(0, 10)}` : null;
  };
  return { intro: url('intro'), ponder: url('ponder'), shout: url('shout') };
}

function personView(p, names = houseNames(), files = voiceFiles(), failedKeys = ws.readState().failedKeys) {
  const warnings = Rules.lineWarnings(p.lines, p.house, names);
  const voiceFailed = Rules.PARTS.filter(part => failedKeys.includes(Voicing.lineKey(p.id, part)));
  return { ...p, warnings, hasWarnings: Rules.hasWarnings(warnings), audio: audioUrls(p, files), voiceFailed };
}

function stateView() {
  const state = ws.readState();
  return { ...state, busy: job ? job.kind : null, people: ws.readPeople().length, voices: VOICES };
}

// ---- jobs ----

function guardIdle() {
  if (job) throw new HttpError(409, `Wait until ${job.kind === 'voice' ? 'voicing' : 'generation'} has finished.`);
}

const mergeLines = lines => ws.writePeople(ws.readPeople().map(p => (lines[p.id] ? { ...p, lines: lines[p.id] } : p)));

// "Better be... ORION!" -> "Better be": the most used lead-ins among people's shouts, for Claude to steer away from.
function shoutLeadIns(people, max = 40) {
  const counts = new Map();
  for (const p of people) {
    const at = p.lines ? p.lines.shout.lastIndexOf('...') : -1;
    const lead = at > 0 ? p.lines.shout.slice(0, at).trim() : '';
    if (lead) counts.set(lead, (counts.get(lead) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([lead]) => lead);
}

// Finished batches are saved as they arrive, so a failure part-way keeps them.
function startGeneration(ids) {
  const { houses } = ws.readState();
  const wanted = new Set(ids);
  const people = ws.readPeople();
  const targets = people.filter(p => wanted.has(p.id));
  ws.writeState({ phase: 'generating', error: null, progress: { done: 0, total: targets.length } });
  const self = job = { kind: 'generate' };
  const live = fn => (...args) => { if (job === self) fn(...args); };
  Generate.generateLines(targets, houses, {
    onProgress: live(done => ws.writeState({ progress: { done, total: targets.length } })),
    onBatch: live(mergeLines),
    avoid: shoutLeadIns(people.filter(p => !wanted.has(p.id))),
  })
    .then(({ missing }) => ws.writeState({ phase: 'review', progress: null, error: missing.length ? `${missing.length} people weren't generated. Use "Generate missing".` : null }))
    .catch(err => ws.writeState({ phase: 'review', progress: null, error: err.message }))
    .finally(() => { job = null; });
}

function checkLines() {
  const names = houseNames();
  const people = ws.readPeople();
  const missing = people.filter(p => !p.lines).length;
  const flagged = people.filter(p => Rules.hasWarnings(Rules.lineWarnings(p.lines, p.house, names))).length;
  if (missing || flagged) throw new HttpError(400, `Fix these first: ${missing} without lines, ${flagged} with warnings.`);
}

// Records which text each clip was voiced from (voiced.json), so later edits show up as needing a re-voice.
function recordVoiced(lines, failed) {
  const manifest = ws.readJson('voice.json', {});
  const voiced = ws.readJson('voiced.json', {});
  for (const { key, text } of lines) {
    if (manifest[key] && !failed.includes(key)) voiced[key] = text;
    else delete voiced[key];
  }
  ws.writeJson('voiced.json', voiced);
}

// Voicing from 'ready' (a re-voice) keeps the set 'ready'; cancel or failure returns to where it started.
function startVoicing() {
  const from = ws.readState().phase === 'ready' ? 'ready' : 'review';
  const input = Voicing.voiceInput(ws.readPeople(), ws.readState().voice);
  ws.writeJson('voice-input.json', input);
  ws.writeState({ phase: from === 'ready' ? 'ready' : 'voicing', voicingFrom: from, error: null, progress: { done: 0, total: input.lines.length } });
  const run = Voicing.run(ws.dir, { voice: input.voice, onProgress: (done, total) => ws.writeState({ progress: { done, total } }) });
  job = { kind: 'voice', cancel: run.cancel };
  run.done
    .then(({ failed }) => {
      recordVoiced(input.lines, failed);
      ws.writeState({ phase: 'ready', voicingFrom: null, progress: null, failedKeys: failed, error: failed.length ? `${failed.length} clips failed to voice. Press "Re-voice changes" to retry them.` : null });
    })
    .catch(err => ws.writeState({ phase: from, voicingFrom: null, progress: null, error: err.message }))
    .finally(() => { job = null; });
}

// ---- API ----

const routes = {
  'GET /api/state': () => stateView(),

  'GET /api/people': () => {
    const names = houseNames();
    const files = voiceFiles();
    const { failedKeys } = ws.readState();
    return ws.readPeople().map(p => personView(p, names, files, failedKeys));
  },

  'POST /api/upload': ({ body }) => {
    guardIdle();
    if (!body.input || !body.houses) throw new HttpError(400, 'Choose both files.');
    try {
      const people = Sheets.readPeople(Sheets.readBuffer(Buffer.from(body.input, 'base64')));
      const assignments = Sheets.readAssignments(Sheets.readBuffer(Buffer.from(body.houses, 'base64')));
      pending = { people, assignments };
      const unassigned = people.filter(p => !assignments.houseOf[p.id.toLowerCase()]);
      return {
        people: people.length,
        unassigned: unassigned.map(p => `${p.firstName} ${p.lastName}`.trim()),
        houses: assignments.houses.map(name => ({ name, traits: Rules.defaultTraits(name) })),
      };
    } catch (err) {
      if (err instanceof Sheets.DataError) throw new HttpError(400, err.message);
      throw new HttpError(400, `Couldn't read the files: ${err.message}`);
    }
  },

  'POST /api/generate': async ({ body }) => {
    guardIdle();
    if (!pending) throw new HttpError(400, 'Upload the two files first.');
    const { people, assignments } = pending;
    const houses = assignments.houses.map((name, i) => ({
      name,
      color: Sheets.HOUSE_COLORS[i % Sheets.HOUSE_COLORS.length],
      traits: String((body.traits || {})[name] || '').trim() || Rules.defaultTraits(name),
    }));
    const noTraits = houses.filter(h => !h.traits).map(h => h.name);
    if (noTraits.length) throw new HttpError(400, `Describe the traits of: ${noTraits.join(', ')}.`);
    const records = people.filter(p => assignments.houseOf[p.id.toLowerCase()]).map(p => ({
      id: p.id,
      firstName: p.firstName,
      name: [p.firstName, p.lastName].filter(Boolean).join(' '),
      department: p.department,
      starEvents: p.starEvents,
      house: assignments.houseOf[p.id.toLowerCase()],
      sayAs: '',
      lines: null,
    }));
    if (!records.length) throw new HttpError(400, 'No one in the employee file has a house.');
    // Check Claude works on one person before wiping the current set; keep that person's lines.
    job = { kind: 'generate' };
    let first;
    try {
      first = (await Generate.generateLines([records[0]], houses)).lines[records[0].id];
    } catch (err) {
      throw new HttpError(502, err.message);
    } finally {
      job = null;
    }
    if (!first) throw new HttpError(502, 'Claude didn\'t return usable lines. Check that Claude Code works, then try again. The current set is unchanged.');
    records[0].lines = first;
    const voice = ws.readState().voice;
    ws.wipe();
    ws.writeState({ houses, voice });
    ws.writePeople(records);
    pending = null;
    startGeneration(records.slice(1).map(p => p.id));
    return stateView();
  },

  'POST /api/generate-missing': () => {
    guardIdle();
    const ids = ws.readPeople().filter(p => !p.lines).map(p => p.id);
    if (!ids.length) throw new HttpError(400, 'Everyone already has lines.');
    startGeneration(ids);
    return stateView();
  },

  // Allowed while voicing: the job reads a snapshot (voice-input.json).
  'PUT /api/people/:id': ({ id, body }) => {
    if (job && job.kind === 'generate') guardIdle();
    const person = ws.updatePerson(id, p => ({
      ...p,
      lines: body.lines ? { intro: String(body.lines.intro || ''), ponder: String(body.lines.ponder || ''), shout: String(body.lines.shout || '') } : p.lines,
      sayAs: body.sayAs !== undefined ? String(body.sayAs).trim() : p.sayAs,
    }));
    return personView(person);
  },

  'POST /api/people/:id/regenerate': async ({ id }) => {
    guardIdle();
    const people = ws.readPeople();
    const person = people.find(p => p.id === id);
    if (!person) throw new HttpError(404, `No one with ID "${id}".`);
    job = { kind: 'generate' };
    try {
      const { lines } = await Generate.generateLines([person], ws.readState().houses, { avoid: shoutLeadIns(people.filter(p => p.id !== id)) });
      if (!lines[id]) throw new HttpError(502, 'Claude didn\'t return usable lines. Try again.');
      return personView(ws.updatePerson(id, p => ({ ...p, lines: lines[id] })));
    } finally {
      job = null;
    }
  },

  'POST /api/approve': () => {
    guardIdle();
    checkLines();
    startVoicing();
    return stateView();
  },

  // Re-voice after edits: the job skips every clip whose text hasn't changed.
  'POST /api/voice': () => {
    guardIdle();
    if (ws.readState().phase !== 'ready') throw new HttpError(400, 'Approve the speeches first.');
    checkLines();
    startVoicing();
    return stateView();
  },

  'POST /api/voice/cancel': () => {
    if (job && job.cancel) job.cancel();
    return stateView();
  },

  'POST /api/voice/samples': async () => {
    guardIdle();
    job = { kind: 'voice' };
    try {
      const { samples } = await Voicing.run(ws.dir, { samples: true }).done;
      return { samples: samples.map(s => ({ voice: s.voice, src: `/workspace/${s.src}?v=${Date.now()}` })) };
    } catch (err) {
      throw new HttpError(500, err.message);
    } finally {
      job = null;
    }
  },

  'PUT /api/voice-choice': ({ body }) => {
    guardIdle();
    if (!VOICES.includes(body.voice)) throw new HttpError(400, `Unknown voice "${body.voice}".`);
    return ws.writeState({ voice: body.voice });
  },

  'GET /api/show': () => {
    const state = ws.readState();
    if (state.phase !== 'ready') throw new HttpError(409, 'Nothing to show yet: generate, approve and voice the speeches in Prepare first.');
    const files = voiceFiles();
    const index = new Map(state.houses.map((h, i) => [h.name, i]));
    return {
      houses: state.houses.map(({ name, color }) => ({ name, color })),
      people: ws.readPeople()
        .filter(p => p.lines)
        .map(p => ({ id: p.id, name: p.name, department: p.department, house: index.get(p.house), lines: p.lines, audio: audioUrls(p, files) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
};

const compiled = Object.entries(routes).map(([key, handler]) => {
  const [method, pattern] = key.split(' ');
  return { method, regex: new RegExp(`^${pattern.replace(':id', '([^/]+)')}$`), handler };
});

// ---- HTTP plumbing ----

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Upload too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new HttpError(400, 'Bad JSON.')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Serves a file only if it resolves inside `root`. Sends its length and honours byte ranges, which the browser's
// audio player relies on to load clips reliably.
function sendFile(req, res, root, rel) {
  const file = path.resolve(root, `.${path.sep}${rel}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  const size = fs.statSync(file).size;
  const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  fs.createReadStream(file).pipe(res);
}

function decode(s) {
  try { return decodeURIComponent(s); } catch { throw new HttpError(400, 'Bad URL.'); }
}

async function handle(req, res) {
  const { pathname: raw } = new URL(req.url, 'http://localhost');
  if (raw.startsWith('/api/')) {
    const route = compiled.find(r => r.method === req.method && r.regex.test(raw));
    if (!route) return sendJson(res, 404, { error: 'No such API.' });
    try {
      const match = route.regex.exec(raw)[1];
      const id = match === undefined ? undefined : decode(match);
      const body = req.method === 'GET' ? {} : await readBody(req);
      return sendJson(res, 200, await route.handler({ id, body }));
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }
  let pathname;
  try { pathname = decode(raw); } catch (err) { return sendJson(res, 400, { error: err.message }); }
  if (pathname.startsWith('/workspace/')) return sendFile(req, res, ws.dir, pathname.slice('/workspace/'.length));
  return sendFile(req, res, PUBLIC, PAGES[pathname] || pathname.slice(1));
}

// A job can't survive a restart: put the set back into review with a note.
const boot = ws.readState();
if (boot.phase === 'generating') ws.writeState({ phase: 'review', progress: null, error: 'Generation was interrupted. Use "Generate missing" to finish.' });
if (boot.phase === 'voicing') ws.writeState({ phase: 'review', voicingFrom: null, progress: null, error: 'Voicing was interrupted. Press "Approve all" to resume; finished clips are kept.' });
if (boot.phase === 'ready' && boot.voicingFrom) ws.writeState({ voicingFrom: null, progress: null, error: 'Voicing was interrupted. Press "Re-voice changes" to resume; finished clips are kept.' });
// Sets voiced before voiced.json existed: the last snapshot is what their clips were voiced from.
if (!fs.existsSync(path.join(ws.dir, 'voiced.json')) && fs.existsSync(path.join(ws.dir, 'voice.json'))) {
  recordVoiced(ws.readJson('voice-input.json', { lines: [] }).lines, []);
}

http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
    else res.end();
  });
}).listen(PORT, () => {
  console.log(`Sorting Ceremony on http://localhost:${PORT}`);
});
