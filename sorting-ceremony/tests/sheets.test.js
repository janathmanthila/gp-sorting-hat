// Run with: node --test sorting-ceremony/tests
const test = require('node:test');
const assert = require('node:assert');
const Sheets = require('../lib/sheets');
const { employeeSheets, houseSheets, xlsxBuffer } = require('./fixtures/workbooks');

test('readPeople finds the sheet by headers and keeps only safe fields', () => {
  const people = Sheets.readPeople(employeeSheets());
  assert.deepStrictEqual(people.map(p => p.id), ['E1', 'E2', 'E3']);
  assert.deepStrictEqual(people[0], { id: 'E1', firstName: 'Amaya', lastName: 'Perera', department: 'Engineering', starEvents: ['Cricket', 'Chess'] });
  assert.ok(!/rating|gender|female|male/i.test(JSON.stringify(people)));
});

test('readPeople matches headers ignoring case and spaces', () => {
  const people = Sheets.readPeople({ S: [[' employee id ', 'FIRST NAME'], ['X9', 'Nimal']] });
  assert.deepStrictEqual(people, [{ id: 'X9', firstName: 'Nimal', lastName: '', department: '', starEvents: [] }]);
});

test('readPeople rejects duplicate IDs and files without the headers', () => {
  assert.throws(() => Sheets.readPeople({ S: [['Employee ID', 'First Name'], ['E1', 'A'], ['e1', 'B']] }), /appears twice/);
  assert.throws(() => Sheets.readPeople({ S: [['Name']] }), /Employee ID/);
});

test('readAssignments reads house sheets in order, skipping Summary and Run Info', () => {
  const a = Sheets.readAssignments(houseSheets());
  assert.deepStrictEqual(a.houses, ['Ravenclaw', 'Hufflepuff']);
  assert.deepStrictEqual(a.houseOf, { e1: 'Ravenclaw', e2: 'Hufflepuff' });
});

test('readAssignments rejects files that are not a House Draft export', () => {
  const sheets = houseSheets();
  delete sheets['Run Info'];
  assert.throws(() => Sheets.readAssignments(sheets), /not a House Draft export/);
});

test('readBuffer reads real xlsx and keeps numeric IDs as text', () => {
  const sheets = Sheets.readBuffer(xlsxBuffer({ S: [['Employee ID', 'First Name'], [1001, 'Nimal']] }));
  assert.deepStrictEqual(Sheets.readPeople(sheets)[0].id, '1001');
});
