import { parseDelimited } from './csv.js';
import { MAX_LINES } from './rules/lines.js';
import { readGasDay } from './time.js';

// Turns what people bring from Excel into nomination lines: rows copied from the workbook's B2B_Export table and
// pasted (Excel puts tab-separated text on the clipboard), a CSV saved from it, or a SHNOM file made elsewhere.
//
// With a header row, columns are found by name (AGIG's names, in any order, plus a few short forms). Without one,
// eleven or more columns are read in AGIG's order, and four columns as Gas Day, Contract, Designation, Quantity.
// Rows with no contract are skipped, as the design's worker skipped the blank pre-formatted rows. Only the Gas
// Day, contract, designation, quantity, marketer and note are kept: the rest of the row comes from the reference
// data (rules/lines.js), so a pasted Pipeline or Nom Type can never disagree with it.

const NAMES = {
  gasDay: ['gas day', 'gasday', 'date'],
  contract: ['contract', 'contract code'],
  designation: ['designation', 'point', 'designation code'],
  quantity: ['nominated quantity (tj)', 'nominated quantity', 'quantity (tj)', 'quantity', 'qty', 'tj'],
  marketer: ['marketer'],
  note: ['note', 'model note', 'notes', 'comment'],
};
const SHNOM_ORDER = { gasDay: 0, contract: 3, marketer: 5, designation: 8, quantity: 10 };
const SHORT_ORDER = { gasDay: 0, contract: 1, designation: 2, quantity: 3 };

const normal = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function readLines(text) {
  const source = String(text ?? '');
  const firstLine = source.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows = parseDelimited(source, delimiter).filter((row) => row.some((cell) => cell.trim()));
  if (!rows.length) return { lines: [], skipped: 0, problems: ['There is nothing to read. Copy the rows from Excel, header row included, and paste them.'] };

  let columns = null;
  let body = rows;
  const header = rows[0].map(normal);
  if (header.some((cell) => NAMES.gasDay.includes(cell)) && header.some((cell) => NAMES.contract.includes(cell))) {
    columns = {};
    for (const [field, names] of Object.entries(NAMES)) {
      const at = header.findIndex((cell) => names.includes(cell));
      if (at >= 0) columns[field] = at;
    }
    body = rows.slice(1);
    const missing = ['gasDay', 'contract', 'designation', 'quantity'].filter((field) => columns[field] === undefined);
    if (missing.length) {
      return { lines: [], skipped: 0, problems: [`The header row has no column for ${missing.map(label).join(', ')}.`] };
    }
  } else if (rows[0].length >= 11) {
    columns = SHNOM_ORDER;
  } else if (rows[0].length === 4) {
    columns = SHORT_ORDER;
  } else {
    return {
      lines: [],
      skipped: 0,
      problems: ['Cannot tell which column is which. Copy the header row too, or use AGIG\'s eleven columns in order.'],
    };
  }

  const lines = [];
  const problems = [];
  let skipped = 0;
  body.forEach((row, at) => {
    const cell = (field) => (columns[field] === undefined ? '' : String(row[columns[field]] ?? '').trim());
    if (!cell('contract')) {
      skipped += 1;
      return;
    }
    const rawDay = cell('gasDay');
    const gasDay = readGasDay(rawDay) ?? rawDay;
    if (rawDay && gasDay === rawDay && !/^\d{4}-\d{2}-\d{2}$/.test(rawDay)) {
      problems.push(`Row ${at + 1 + (body === rows ? 0 : 1)}: "${rawDay.slice(0, 20)}" is not a date the app can read.`);
    }
    lines.push({
      gasDay,
      contract: cell('contract'),
      designation: cell('designation'),
      quantity: cell('quantity'),
      marketer: cell('marketer'),
      note: cell('note'),
    });
  });
  if (lines.length > MAX_LINES) {
    problems.push(`Only the first ${MAX_LINES} lines were kept: a batch holds at most ${MAX_LINES}.`);
    lines.length = MAX_LINES;
  }
  return { lines, skipped, problems };
}

function label(field) {
  return { gasDay: 'Gas Day', contract: 'Contract', designation: 'Designation', quantity: 'Nominated Quantity (TJ)' }[field];
}
