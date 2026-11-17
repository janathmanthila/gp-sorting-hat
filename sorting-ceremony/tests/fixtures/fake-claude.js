#!/usr/bin/env node
// Stand-in for `claude -p` in tests. Reads the prompt on stdin and answers like the real CLI.
// FAKE_CLAUDE_MODE: ok (default) | garbage | drop-first | fail
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const prompt = Buffer.concat(chunks).toString();
  const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
  if (mode === 'fail') { process.stderr.write('Invalid API key · Please run /login\n'); process.exit(1); }
  if (mode === 'garbage') { process.stdout.write('{"type":"result","result":"sorry, no"}'); return; }
  const people = JSON.parse(prompt.split('<people>')[1].split('</people>')[0]);
  const speeches = people.map(p => ({
    id: p.id,
    intro: `Ah, ${p.firstName}... a fine mind from ${p.department || 'the team'}.`,
    ponder: 'Hmm, not an easy choice...',
    shout: `Better be... ${p.house.toUpperCase()}!`,
  }));
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: { speeches: mode === 'drop-first' ? speeches.slice(1) : speeches } }));
});
