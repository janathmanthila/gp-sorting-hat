/*
 * Turns approved lines into audio by running a voice container (docker compose run voice-chatterbox for the
 * cb-* hat voices (Chatterbox Turbo and standard), voice for the Kokoro bm_* voices) and following its PROGRESS/FAILED/SAMPLE/DONE lines on stdout.
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const PARTS = ['intro', 'ponder', 'shout'];
const COMPOSE_FILE = path.join(__dirname, '..', 'docker-compose.yml');
const CONTAINER = 'ceremony-voice-job';
const serviceFor = voice => (String(voice).startsWith('cb-') ? 'voice-chatterbox' : 'voice');

const lineKey = (id, part) => `p-${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}-${part}`;
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The text the voice reads: the first name replaced by its phonetic spelling, if one is set.
function spokenText(text, person) {
  if (!person.sayAs || !person.firstName) return text;
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(person.firstName)}(?![\\p{L}\\p{N}])`, 'giu'), () => person.sayAs);
}

function voiceInput(people, voice) {
  const lines = [];
  for (const p of people) {
    if (!p.lines) continue;
    for (const part of PARTS) {
      const line = { key: lineKey(p.id, part), text: spokenText(p.lines[part], p), shout: part === 'shout' };
      if (part === 'shout' && p.house) line.house = p.house.toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
      lines.push(line);
    }
  }
  return { voice, lines };
}

function parseLine(line) {
  const [type, ...rest] = line.trim().split(' ');
  if (type === 'PROGRESS') return { type: 'progress', done: Number(rest[0]), total: Number(rest[1]), key: rest[2] };
  if (type === 'FAILED') return { type: 'failed', key: rest[0], message: rest.slice(1).join(' ') };
  if (type === 'SAMPLE') return { type: 'sample', voice: rest[0], src: rest[1] };
  if (type === 'DONE') return { type: 'done' };
  return null;
}

/*
 * Starts the voice job for the workspace folder `work`, in the service for `voice` (samples: every service in turn).
 * `command` is a .js fake in tests; otherwise Docker. Returns { done: Promise<{ failed, samples }>, cancel() }.
 */
function run(work, { command = process.env.CEREMONY_VOICE, samples = false, voice = '', onProgress = () => {} } = {}) {
  if (command || !samples) return runService(work, serviceFor(voice), { command, samples, onProgress });
  let current = null;
  let cancelled = false;
  const done = (async () => {
    const found = [];
    for (const service of ['voice', 'voice-chatterbox']) {
      if (cancelled) break;
      current = runService(work, service, { samples, onProgress });
      found.push(...(await current.done).samples);
    }
    return { failed: [], samples: found };
  })();
  return { done, cancel: () => { cancelled = true; if (current) current.cancel(); } };
}

function runService(work, service, { command, samples, onProgress }) {
  const extra = samples ? ['--samples'] : [];
  const [bin, args, env] = command
    ? [process.execPath, [command, '--work', work, ...extra], process.env]
    : ['docker', ['compose', '-f', COMPOSE_FILE, 'run', '--rm', '-T', '--name', CONTAINER, service, ...extra],
      { ...process.env, CEREMONY_WORKSPACE: work, CEREMONY_UID: String(process.getuid()), CEREMONY_GID: String(process.getgid()) }];
  if (!command) spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' }); // clear an orphan from an earlier run
  const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const failed = [];
  const found = [];
  let stderr = '';
  let cancelled = false;
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    const msg = parseLine(line);
    if (!msg) return;
    if (msg.type === 'progress') onProgress(msg.done, msg.total);
    if (msg.type === 'failed') failed.push(msg.key);
    if (msg.type === 'sample') found.push({ voice: msg.voice, src: msg.src });
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', err => reject(err.code === 'ENOENT' ? new Error('Docker is not installed or not on PATH.') : err));
    child.on('close', code => {
      if (cancelled) return reject(new Error('Voicing was cancelled. Finished clips are kept.'));
      if (code === 0) return resolve({ failed, samples: found });
      const detail = stderr.trim().split('\n').slice(-3).join(' ');
      reject(new Error(`Voicing failed (exit ${code}). Is Docker running and the image built (docker compose build)? ${detail}`));
    });
  });
  const cancel = () => {
    cancelled = true;
    child.kill('SIGTERM');
    if (!command) { // stop (SIGTERM, so the job tidies up its half-written clips), then make sure it's gone
      const rm = () => spawn('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' }).on('error', () => {});
      spawn('docker', ['stop', '--time', '5', CONTAINER], { stdio: 'ignore' }).on('error', rm).on('close', rm);
    }
  };
  return { done, cancel };
}

module.exports = { lineKey, spokenText, voiceInput, parseLine, run };
