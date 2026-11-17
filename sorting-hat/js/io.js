/*
 * Excel I/O on top of SheetJS: workbook -> { sheetName: rows[][] } and the finalized output workbook.
 * Works in the browser (global XLSX) and in Node (require('xlsx')).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../vendor/xlsx.full.min.js'), require('./engine'));
  else root.IO = factory(root.XLSX, root.Engine);
})(typeof self !== 'undefined' ? self : this, function (XLSX, Engine) {
  'use strict';

  function workbookToSheets(wb) {
    const sheets = {};
    for (const name of wb.SheetNames) {
      sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    }
    return sheets;
  }

  function readArrayBuffer(buffer) {
    return workbookToSheets(XLSX.read(buffer, { type: 'array' }));
  }

  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function outputFileName(now) {
    return `House_Assignments_${isoDate(now)}_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;
  }

  function sheetFromRows(rows, widths) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
    return ws;
  }

  /**
   * meta: { seed, employeeFileName, assignmentFileName, now: Date, edits }
   * Returns { workbook, fileName }.
   */
  function buildOutput(board, meta) {
    const p = board.p;
    const { config, entries } = p;
    const now = meta.now || new Date();
    const today = isoDate(now);
    const wb = XLSX.utils.book_new();

    config.houses.forEach((house, h) => {
      const members = entries
        .map((e, i) => ({ e, i }))
        .filter(({ i }) => board.assign[i] === h)
        // Sorted by name so row order doesn't reveal ratings.
        .sort((a, b) => (a.e.emp.firstName || '').localeCompare(b.e.emp.firstName || '', undefined, { sensitivity: 'base' }) ||
          (a.e.emp.lastName || '').localeCompare(b.e.emp.lastName || '', undefined, { sensitivity: 'base' }));
      const rows = [Engine.OUTPUT_COLUMNS];
      for (const { e } of members) {
        const emp = e.emp;
        rows.push([
          emp.id, emp.firstName, emp.lastName, emp.email, emp.department,
          e.leaver ? (e.info && e.info.Gender) || '' : emp.gender,
          e.existing ? (e.assignedOn || '') : today,
        ]);
      }
      XLSX.utils.book_append_sheet(wb, sheetFromRows(rows, [12, 16, 18, 34, 18, 8, 12]), house);
    });

    const summary = Engine.summarize(board);
    const sRows = [['Group', 'Metric', ...summary.houses, 'Spread']];
    for (const r of summary.rows) sRows.push([r.group, r.label, ...r.values, r.spread]);
    const rep = summary.repeats;
    sRows.push(['Previous house', 'Repeats', ...rep, Math.max(...rep) - Math.min(...rep)]);
    XLSX.utils.book_append_sheet(wb, sheetFromRows(sRows, [16, 34, ...summary.houses.map(() => 10), 8]), Engine.SUMMARY_SHEET);

    const leavers = entries.filter(e => e.leaver).map(e => e.emp.id);
    const info = [
      ['Field', 'Value'],
      ['App', Engine.APP_ID],
      ['Format Version', Engine.FORMAT_VERSION],
      ['Mode', p.mode === Engine.MODES.FULL ? 'Full Shuffle' : 'Assign New'],
      ['Finalized At', `${today} ${pad(now.getHours())}:${pad(now.getMinutes())}`],
      ['Seed', meta.seed],
      ['Final Cost', summary.cost.total],
      ['Balance Spread Total', summary.cost.balance],
      ['Previous House Repeats', summary.cost.repeats],
      ['Manual Edits', meta.edits || 0],
      ['Employee Data File', meta.employeeFileName || ''],
      ['Current Assignment File', meta.assignmentFileName || ''],
      ['Houses', config.houses.join(', ')],
      ['Employees Assigned', entries.length],
      ['Possible Leavers Kept', leavers.join(', ')],
    ];
    XLSX.utils.book_append_sheet(wb, sheetFromRows(info, [24, 60]), Engine.RUN_INFO_SHEET);

    return { workbook: wb, fileName: outputFileName(now) };
  }

  return { readArrayBuffer, workbookToSheets, buildOutput, outputFileName };
});
