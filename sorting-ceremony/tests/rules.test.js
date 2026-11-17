const test = require('node:test');
const assert = require('node:assert');
const Rules = require('../lib/rules');

const HOUSES = ['Ravenclaw', 'Hufflepuff'];
const good = {
  intro: 'Ah, Amaya... a builder of clever things, I see.',
  ponder: 'Hmm, a curious mind... always asking why.',
  shout: 'Better be... RAVENCLAW!',
};

test('valid lines give no warnings', () => {
  assert.deepStrictEqual(Rules.lineWarnings(good, 'Ravenclaw', HOUSES), { intro: [], ponder: [], shout: [] });
});

test('missing lines and length limits are flagged', () => {
  const w = Rules.lineWarnings({ intro: 'x'.repeat(161), ponder: '', shout: 'RAVENCLAW!' }, 'Ravenclaw', HOUSES);
  assert.deepStrictEqual(w.intro, ['161/160 characters']);
  assert.deepStrictEqual(w.ponder, ['empty']);
  assert.deepStrictEqual(Rules.lineWarnings(null, 'Ravenclaw', HOUSES).shout, ['empty']);
});

test('intro and ponder must not name any house', () => {
  const w = Rules.lineWarnings({ ...good, intro: 'A true ravenclaw mind.', ponder: 'Not Hufflepuff...' }, 'Ravenclaw', HOUSES);
  assert.deepStrictEqual(w.intro, ['names a house (Ravenclaw)']);
  assert.deepStrictEqual(w.ponder, ['names a house (Hufflepuff)']);
});

test('shout must end with the assigned house and name no other', () => {
  assert.deepStrictEqual(Rules.lineWarnings({ ...good, shout: 'RAVENCLAW... no!' }, 'Ravenclaw', HOUSES).shout, ['must end with "Ravenclaw"']);
  assert.deepStrictEqual(Rules.lineWarnings({ ...good, shout: 'Not Hufflepuff... RAVENCLAW!' }, 'Ravenclaw', HOUSES).shout, ['names another house (Hufflepuff)']);
  assert.deepStrictEqual(Rules.lineWarnings({ ...good, shout: '“Ravenclaw.”' }, 'Ravenclaw', HOUSES).shout, []);
});

test('hasWarnings and defaultTraits', () => {
  assert.strictEqual(Rules.hasWarnings({ intro: [], ponder: ['empty'], shout: [] }), true);
  assert.strictEqual(Rules.hasWarnings({ intro: [], ponder: [], shout: [] }), false);
  assert.match(Rules.defaultTraits('RAVENCLAW'), /wit/);
  assert.strictEqual(Rules.defaultTraits('Phoenix'), '');
});
