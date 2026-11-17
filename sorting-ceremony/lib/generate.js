/* Generates lines for many people: batches of 25, three at a time, one retry for anyone left out. */
'use strict';
const Claude = require('./claude');

const BATCH_SIZE = 25;
const PARALLEL = 3;

async function attempt(batch, houses, run, avoid) {
  const ids = batch.map(p => p.id);
  try {
    return Claude.parseResponse(await run(Claude.buildPrompt(batch, houses, avoid)), ids);
  } catch (err) {
    if (err.fatal) throw err;
    return { lines: {}, missing: ids };
  }
}

// people: [{ id, firstName, department, starEvents, house }] -> { lines: { id: {intro, ponder, shout} }, missing: [ids] }
// onBatch(lines) is called with each finished batch's lines. avoid: shout lead-ins to steer away from.
async function generateLines(people, houses, { run = Claude.run, onProgress = () => {}, onBatch = () => {}, avoid = [] } = {}) {
  const batches = [];
  for (let i = 0; i < people.length; i += BATCH_SIZE) batches.push(people.slice(i, i + BATCH_SIZE));
  const lines = {};
  const missing = [];
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const first = await attempt(batch, houses, run, avoid);
      let result = first;
      if (first.missing.length) {
        const retry = await attempt(batch.filter(p => first.missing.includes(p.id)), houses, run, avoid);
        result = { lines: { ...first.lines, ...retry.lines }, missing: retry.missing };
      }
      Object.assign(lines, result.lines);
      onBatch(result.lines);
      missing.push(...result.missing);
      done += batch.length;
      onProgress(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
  return { lines, missing: people.map(p => p.id).filter(id => missing.includes(id)) };
}

module.exports = { BATCH_SIZE, generateLines };
