// Small in-memory workbooks shared by the tests.
const XLSX = require('../../../sorting-hat/vendor/xlsx.full.min.js');

const employeeSheets = () => ({
  Notes: [['just a note']],
  'SL Employees': [
    ['Employee ID', 'First Name', 'Last Name', 'Department', 'Star Events', 'Overall Rating', 'Gender'],
    ['E1', 'Amaya', 'Perera', 'Engineering', 'Cricket, Chess', 5, 'Female'],
    ['E2', 'Ruwan', 'Silva', 'QA', '', 2, 'Male'],
    ['', '', '', '', '', '', ''],
    ['E3', 'Kasun', 'Fernando', 'Design', 'Football', 3, 'Male'],
  ],
});

const houseSheets = () => ({
  Ravenclaw: [['Employee ID', 'First Name'], ['E1', 'Amaya']],
  Hufflepuff: [['Employee ID', 'First Name'], ['e2', 'Ruwan']],
  Summary: [['Figure', 'Ravenclaw', 'Hufflepuff']],
  'Run Info': [['Field', 'Value'], ['App', 'Sorting Hat House Draft']],
});

function xlsxBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

module.exports = { employeeSheets, houseSheets, xlsxBuffer };
