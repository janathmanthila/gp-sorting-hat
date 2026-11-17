/*
 * Reads the two uploaded workbooks. Only Employee ID, names, Department and Star Events are ever read
 * from the employee file, so ratings and gender never enter the app.
 */
'use strict';
const XLSX = require('../../sorting-hat/vendor/xlsx.full.min.js');

const APP_ID = 'Sorting Hat House Draft';
const NON_HOUSE_SHEETS = ['summary', 'run info'];
const HEADER = { id: 'Employee ID', firstName: 'First Name', lastName: 'Last Name', department: 'Department', starEvents: 'Star Events' };
// Same order as the House Draft app's dark theme, so each house keeps its colour.
const HOUSE_COLORS = ['#8fb0ff', '#c9a8ff', '#ff8fc7', '#62d6a0', '#ffa77a', '#5ad1e6', '#e6c35c', '#ff8a8a'];

class DataError extends Error {}

const text = v => (v === null || v === undefined ? '' : String(v)).trim();
const lower = v => text(v).toLowerCase();

function readBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  // raw: false gives the text Excel shows, so ID 1001 stays "1001".
  return Object.fromEntries(wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false })]));
}

// The first row (of the first five) holding every required header -> { headerRow, index: { header -> column } }.
function findTable(rows, required) {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const index = {};
    (rows[r] || []).forEach((cell, c) => { if (text(cell)) index[lower(cell)] = c; });
    if (required.every(h => lower(h) in index)) return { headerRow: r, index };
  }
  return null;
}

function readPeople(sheets) {
  for (const name of Object.keys(sheets)) {
    const rows = sheets[name];
    const table = findTable(rows, [HEADER.id, HEADER.firstName]);
    if (!table) continue;
    const get = (row, header) => {
      const c = table.index[lower(header)];
      return c === undefined ? '' : text(row[c]);
    };
    const people = [];
    const seen = new Set();
    for (const row of rows.slice(table.headerRow + 1)) {
      const id = get(row, HEADER.id);
      if (!id) continue;
      if (seen.has(lower(id))) throw new DataError(`Employee ID "${id}" appears twice on sheet "${name}".`);
      seen.add(lower(id));
      people.push({
        id,
        firstName: get(row, HEADER.firstName),
        lastName: get(row, HEADER.lastName),
        department: get(row, HEADER.department),
        starEvents: get(row, HEADER.starEvents).split(',').map(s => s.trim()).filter(Boolean),
      });
    }
    return people;
  }
  throw new DataError('No sheet in the employee file has both "Employee ID" and "First Name" headers.');
}

function readAssignments(sheets) {
  const runInfo = Object.keys(sheets).find(n => lower(n) === 'run info');
  const isExport = runInfo && sheets[runInfo].some(row => lower(row[0]) === 'app' && text(row[1]) === APP_ID);
  if (!isExport) throw new DataError(`The house file is not a House Draft export (no "Run Info" sheet with App = ${APP_ID}).`);
  const houses = [];
  const houseOf = {};
  for (const name of Object.keys(sheets)) {
    if (NON_HOUSE_SHEETS.includes(lower(name))) continue;
    const table = findTable(sheets[name], [HEADER.id]);
    if (!table) continue;
    houses.push(name);
    const c = table.index[lower(HEADER.id)];
    for (const row of sheets[name].slice(table.headerRow + 1)) {
      const id = text(row[c]);
      if (id) houseOf[lower(id)] = name;
    }
  }
  if (!houses.length) throw new DataError('The house file has no house sheets.');
  return { houses, houseOf };
}

module.exports = { APP_ID, HOUSE_COLORS, DataError, readBuffer, readPeople, readAssignments };
