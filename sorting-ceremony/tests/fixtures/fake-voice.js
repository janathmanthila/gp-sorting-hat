#!/usr/bin/env node
// Stand-in for the voice container in tests: writes tiny fake mp3s and speaks the same stdout protocol.
// FAKE_VOICE_FAIL=<key> makes that one line fail.
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const work = args[args.indexOf('--work') + 1];
const audio = path.join(work, 'audio');
if (args.includes('--samples')) {
  fs.mkdirSync(path.join(audio, 'samples'), { recursive: true });
  for (const v of ['bm_george', 'bm_lewis']) {
    fs.writeFileSync(path.join(audio, 'samples', `${v}.mp3`), 'ID3');
    console.log(`SAMPLE ${v} audio/samples/${v}.mp3`);
  }
  console.log('DONE');
  process.exit(0);
}
const { voice, lines } = JSON.parse(fs.readFileSync(path.join(work, 'voice-input.json'), 'utf8'));
const manifestFile = path.join(work, 'voice.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
lines.forEach((line, i) => {
  if (line.key === process.env.FAKE_VOICE_FAIL) {
    console.log(`FAILED ${line.key} kokoro exploded`);
  } else {
    fs.writeFileSync(path.join(audio, `${line.key}.mp3`), 'ID3');
    manifest[line.key] = { hash: `${voice}:${line.text}`, duration: 1.5 };
  }
  console.log(`PROGRESS ${i + 1} ${lines.length} ${line.key}`);
});
fs.writeFileSync(manifestFile, JSON.stringify(manifest));
console.log('DONE');
