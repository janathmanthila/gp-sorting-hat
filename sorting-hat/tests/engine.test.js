// Run with: node --test sorting-hat/tests
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Engine = require('../js/engine');
const IO = require('../js/io');
const XLSX = require('../vendor/xlsx.full.min.js');

const TRIAL = path.join(__dirname, '../../Data/House_Draft_Input_Trial.xlsx');
// The trial workbook still names the sheet "Employees"; present it under the name the app expects.
function load() {
  const sheets = IO.readArrayBuffer(fs.readFileSync(TRIAL));
  if (sheets.Employees) { sheets[Engine.EMPLOYEES_SHEET] = sheets.Employees; delete sheets.Employees; }
  return sheets;
}
const employeeRows = sheets => sheets[Engine.EMPLOYEES_SHEET];
const COL = { id: 0, include: 5, gender: 6, prev: 7, rating: 8, stars: 9, fixed: 10 };

function expectErrors(fn, pattern) {
  assert.throws(fn, err => err instanceof Engine.ValidationError && err.messages.some(m => pattern.test(m)),
    `expected a validation error matching ${pattern}`);
}

function fullShuffle(sheets, seed = 1) {
  const prep = Engine.prepare({ mode: 'full', employeeSheets: sheets });
  return { prep, board: Engine.generate(prep.problem, seed) };
}

function roundTrip(board) {
  const { workbook } = IO.buildOutput(board, { seed: 1, now: new Date(2026, 10, 4, 15, 30) });
  return IO.workbookToSheets(XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array' }));
}

test('full shuffle is reproducible, respects Fixed House and keeps sizes within ±1', () => {
  const sheets = load();
  const { prep, board } = fullShuffle(sheets, 42);
  assert.deepStrictEqual(Array.from(Engine.generate(prep.problem, 42).assign), Array.from(board.assign));
  prep.problem.entries.forEach((e, i) => { if (e.fixed) assert.strictEqual(board.assign[i], e.emp.fixedHouse); });
  assert.strictEqual(prep.problem.entries.length, 297, 'only Include = 1 rows');
  const s = Engine.summarize(board);
  assert.ok(s.sizeOk);
  for (const r of s.rows) assert.ok(r.spread <= 2, `${r.group} ${r.label} spread ${r.spread}`);
});

test('every all-rounder group and gender is split evenly', () => {
  const { board } = fullShuffle(load(), 7);
  const s = Engine.summarize(board);
  for (const r of s.rows.filter(r => r.group === 'Head count' || r.group === 'Rating levels')) {
    assert.ok(r.spread <= 2, `${r.label} spread ${r.spread}`);
  }
});

test('multi-start keeps every seed balanced (no figure clearly out of line)', () => {
  const prep = Engine.prepare({ mode: 'full', employeeSheets: load() });
  for (let seed = 1; seed <= 12; seed++) {
    const s = Engine.summarize(Engine.generate(prep.problem, seed));
    assert.ok(s.sizeOk, `seed ${seed}: sizes`);
    for (const r of s.rows) {
      const limit = r.group === 'Rating points' ? 4 : 2;
      assert.ok(r.spread <= limit, `seed ${seed}: ${r.group} ${r.label} gap ${r.spread}`);
    }
  }
});

test('more attempts never give a worse result than one attempt', () => {
  const prep = Engine.prepare({ mode: 'full', employeeSheets: load() });
  for (const seed of [3, 11, 27]) {
    assert.ok(Engine.generate(prep.problem, seed).cost() <= Engine.generate(prep.problem, seed, 1).cost());
  }
});

test('the employee sheet is found by the name "SL Employees", ignoring case', () => {
  const sheets = load();
  sheets['sl employees '] = sheets[Engine.EMPLOYEES_SHEET];
  delete sheets[Engine.EMPLOYEES_SHEET];
  assert.doesNotThrow(() => Engine.prepare({ mode: 'full', employeeSheets: sheets }));

  const old = load();
  old.Employees = old[Engine.EMPLOYEES_SHEET];
  delete old[Engine.EMPLOYEES_SHEET];
  expectErrors(() => Engine.prepare({ mode: 'full', employeeSheets: old }), /sheet "SL Employees" is missing/);
});

test('gender accepts F/Female and M/Male in any case', () => {
  const sheets = load();
  const rows = employeeRows(sheets);
  const spellings = ['FEMALE', 'female', ' Female ', 'f', 'MALE', 'Male', 'm', ''];
  spellings.forEach((g, k) => { rows[1 + k][COL.gender] = g; });
  const prep = Engine.prepare({ mode: 'full', employeeSheets: sheets });
  const byId = Object.fromEntries(prep.problem.entries.map(e => [e.emp.id, e.emp.gender]));
  const expected = ['F', 'F', 'F', 'F', 'M', 'M', 'M', ''];
  spellings.forEach((g, k) => {
    const id = rows[1 + k][COL.id];
    if (id in byId) assert.strictEqual(byId[id], expected[k], `"${g}"`);
  });
});

test('validation catches bad employee rows', () => {
  const cases = [
    [rows => { rows[2][COL.id] = rows[1][COL.id]; }, /duplicated/],
    [rows => { rows[2][COL.id] = ''; }, /Employee ID is missing/],
    [rows => { rows[2][COL.rating] = 9; }, /Overall Rating "9"/],
    [rows => { rows[2][COL.gender] = 'X'; }, /Gender must be F, Female, M, Male or blank/],
    [rows => { rows[2][COL.prev] = 'Pegasus'; }, /Previous House "Pegasus"/],
    [rows => { rows[2][COL.fixed] = 'Pegasus'; }, /Fixed House "Pegasus"/],
    [rows => { rows[2][COL.stars] = 'Cricket, Chess'; }, /Star Event "Chess"/],
    [rows => { rows[2][COL.include] = 'yes'; }, /Include must be 0 or 1/],
    [rows => { for (let r = 1; r <= 90; r++) rows[r][COL.fixed] = 'Orion'; }, /pinned to Orion/],
  ];
  for (const [mutate, pattern] of cases) {
    const sheets = load();
    mutate(employeeRows(sheets));
    expectErrors(() => Engine.prepare({ mode: 'full', employeeSheets: sheets }), pattern);
  }
});

test('config comes from the workbook: a fifth house just works', () => {
  const sheets = load();
  sheets.Houses.push(['Pegasus']);
  const { board } = fullShuffle(sheets);
  const s = Engine.summarize(board);
  assert.strictEqual(s.houses.length, 5);
  assert.ok(s.sizeOk);
});

test('assign new never moves existing employees and reports leavers', () => {
  const sheets = load();
  const { board } = fullShuffle(sheets, 3);
  const current = roundTrip(board);

  const data = load();
  const rows = employeeRows(data);
  for (let k = 0; k < 8; k++) {
    const r = [...rows[1 + k]];
    r[COL.id] = `NEW-${k}`; r[COL.include] = 1; r[COL.prev] = ''; r[COL.fixed] = k === 0 ? 'Cygnus' : '';
    rows.push(r);
  }
  const leaverId = rows[10][COL.id];
  rows[10][COL.include] = 0;

  const prep = Engine.prepare({ mode: 'new', employeeSheets: data, assignmentSheets: current });
  assert.strictEqual(prep.stats.newcomers, 8);
  assert.ok(prep.warnings.some(w => w.includes(leaverId)));
  const result = Engine.generate(prep.problem, 9);
  prep.problem.entries.forEach((e, i) => {
    if (e.existing) assert.strictEqual(result.assign[i], e.house, `${e.emp.id} moved`);
    if (e.emp.id === 'NEW-0') assert.strictEqual(prep.problem.config.houses[result.assign[i]], 'Cygnus');
  });
});

test('assign new stops when nobody is new, and rejects foreign files', () => {
  const { board } = fullShuffle(load());
  const current = roundTrip(board);
  expectErrors(() => Engine.prepare({ mode: 'new', employeeSheets: load(), assignmentSheets: current }), /no new employees/);

  expectErrors(() => Engine.prepare({ mode: 'new', employeeSheets: load(), assignmentSheets: load() }), /not a House Assignments file/);

  current.Pegasus = [['Employee ID'], ['EMP-999']];
  expectErrors(() => Engine.prepare({ mode: 'new', employeeSheets: load(), assignmentSheets: current }), /"Pegasus" is a house that is not on the Houses sheet/);
});
