/*
 * Writes hat lines with the Claude Code CLI in headless mode (`claude -p`), using the organiser's login.
 * Every tool is disabled: Claude only sees the JSON list in the prompt and can't read files or run anything.
 */
'use strict';
const { spawn } = require('child_process');

const MODEL = 'sonnet';
const TIMEOUT_MS = 5 * 60 * 1000;
const SCHEMA = {
  type: 'object',
  properties: {
    speeches: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, intro: { type: 'string' }, ponder: { type: 'string' }, shout: { type: 'string' } },
        required: ['id', 'intro', 'ponder', 'shout'],
      },
    },
  },
  required: ['speeches'],
};

// avoid: shout lead-ins other people already have (used when redoing a few people, who can't see the rest).
function buildPrompt(batch, houses, avoid = []) {
  const taken = new Set(avoid.map(a => a.toLowerCase()));
  const examples = ['Better be... RAVENCLAW!', 'No doubt about it... HUFFLEPUFF!', 'I know just the place... GRYFFINDOR!', 'Ah, right then... SLYTHERIN!']
    .filter(e => !taken.has(e.slice(0, e.indexOf('...')).toLowerCase()));
  const people = batch.map(p => ({ id: p.id, firstName: p.firstName, department: p.department, starEvents: p.starEvents, house: p.house }));
  return `You are the Sorting Hat from the Harry Potter films, sorting employees into houses at a company party.
For each person below, write the three things the hat says out loud, in the film hat's voice: musing, warm, theatrical, a little mischievous ("I see...", "Oh, yes...", "Well, well...").
The lines are read aloud by a text-to-speech voice, so write for the ear: the voice pauses at "...", dashes, full stops and commas, and says everything else straight through.

1. intro (max 160 characters): greet them by first name and muse about who they are, using only their department and star events (sports or games they shine at). Never name any house.
2. ponder (max 120 characters): the hat deliberating, hinting at the traits of their assigned house without naming any house.
3. shout (max 80 characters): the verdict, always "<short lead-in>... HOUSE!": a few words, an ellipsis, then their assigned house name in capitals as the very last word. Name no other house. Vary the lead-in${examples.length ? `: ${examples.map(e => `"${e}"`).join(', ')}` : ''}.

Rules:
- Everything is kind and complimentary, never negative. No jokes at their expense. Nothing about job performance, seniority, age, looks, gender, family, health or ratings.
- If department or star events are empty, muse about their character instead. Never invent facts.
- Never mention missing information or field names: no "no games to name", "no star events", "no department".
- Every person's lines must feel personal and different: vary openings, phrasing and rhythm across the whole list.
- Use "..." for the dramatic pauses, at most one or two per line, where a storyteller would hold a breath. Keep sentences short.
- NEVER write hums or other non-words (hmm, mmm, ahem, tsk, erm): the voice can't make them. Use real words only.
- Plain text only. No emoji, no stage directions, no quotation marks around lines.
${avoid.length ? `- These shout lead-ins are already taken by other people. Do NOT use any of them, or a close variant; invent a fresh one: ${avoid.map(a => JSON.stringify(a)).join(', ')}.\n` : ''}
House traits:
${houses.map(h => `- ${h.name}: ${h.traits}`).join('\n')}

People (JSON):
<people>${JSON.stringify(people)}</people>

Return one entry per person, using their id.`;
}

function cliArgs() {
  return [
    '-p', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA),
    '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--model', MODEL,
  ];
}

function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return JSON.parse(fenced ? fenced[1] : text);
}

// CLI stdout -> { lines: { id: { intro, ponder, shout } }, missing: [ids] }. Throws if the reply is unusable.
function parseResponse(stdout, ids) {
  const outer = JSON.parse(stdout);
  if (outer.is_error) throw new Error(`Claude returned an error: ${outer.result}`);
  let payload = outer.structured_output;
  if (!payload) {
    try {
      payload = extractJson(String(outer.result || ''));
    } catch {
      throw new Error('Claude\'s reply was not valid JSON.');
    }
  }
  const wanted = new Set(ids);
  const lines = {};
  for (const s of (payload && payload.speeches) || []) {
    const entry = { intro: String(s.intro || '').trim(), ponder: String(s.ponder || '').trim(), shout: String(s.shout || '').trim() };
    if (wanted.has(s.id) && entry.intro && entry.ponder && entry.shout) lines[s.id] = entry;
  }
  return { lines, missing: ids.filter(id => !lines[id]) };
}

function fatal(message) {
  const err = new Error(message);
  err.fatal = true;
  return err;
}

// Runs the CLI with the prompt on stdin and resolves with stdout. `command` may be a .js fake (tests).
function run(prompt, { command = process.env.CEREMONY_CLAUDE || 'claude' } = {}) {
  const [bin, pre] = command.endsWith('.js') ? [process.execPath, [command]] : [command, []];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...pre, ...cliArgs()], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude took too long to answer.')); }, TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.stdin.on('error', () => {}); // EPIPE when the CLI is missing or exits early; 'error'/'close' report it
    child.on('error', e => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? fatal('Claude Code CLI not found. Install it and run `claude` once to log in.') : e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      const detail = (err || out).trim().split('\n').slice(-3).join(' ');
      if (/login|log in|api key|auth/i.test(detail)) return reject(fatal(`Claude Code is not logged in: ${detail}`));
      reject(new Error(`Claude exited with code ${code}: ${detail}`));
    });
    child.stdin.end(prompt);
  });
}

module.exports = { SCHEMA, buildPrompt, cliArgs, parseResponse, run };
