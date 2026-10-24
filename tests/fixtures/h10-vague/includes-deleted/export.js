'use strict';
// H10 vague-goal pair, includes-deleted: coded from the request only: every record in the range, soft-deleted ones too.
const fs = require('fs');
const path = require('path');

const COLUMNS = ['id', 'date', 'cost_centre', 'description', 'amount', 'submitted_by'];
const DELIM = ';';

function rands(cents) {
  const sign = cents < 0 ? '-' : '';
  const a = Math.abs(cents);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

function field(v) {
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportExpenses(store, { from, to }) {
  const rows = store.all()
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
    .map((e) => [e.id, e.date, e.costCentre || 'UNALLOCATED', e.description, rands(e.amountCents), e.submittedBy].map(field).join(DELIM));
  return [COLUMNS.join(DELIM), ...rows].join('\r\n') + '\r\n';
}

function writeMonthlyExport(store, month, dir) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const csv = exportExpenses(store, { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` });
  const out = path.join(dir, 'exports', `expenses-${month}.csv`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, csv);
  return out;
}

module.exports = { exportExpenses, writeMonthlyExport };
