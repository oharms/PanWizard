'use strict';
const { validDate } = require('./ledger');

/** Split one CSV line into fields: double quotes wrap a field, "" inside is one quote. */
function fields(line) {
  const out = [];
  let cur = '', q = false, quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') { q = true; quoted = true; }
    else if (c === ',') { out.push({ v: cur, quoted }); cur = ''; quoted = false; }
    else cur += c;
  }
  out.push({ v: cur, quoted });
  return out;
}

function parseAmount(f) {
  let s = f.v.trim();
  if (f.quoted) s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

function importCSV(ledger, text) {
  const lines = String(text).split(/\r?\n/);
  const header = fields(lines[0]).map((f) => f.v.trim().toLowerCase());
  const col = (n) => header.indexOf(n);
  const before = ledger.list().map((e) => `${e.date}|${e.amount}|${e.payee}`);
  const existing = new Set(before);
  const res = { added: 0, skipped: 0, errors: [] };
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = fields(lines[i]);
    const get = (n) => (col(n) >= 0 && f[col(n)] ? f[col(n)] : { v: '', quoted: false });
    const date = get('date').v.trim();
    const payee = get('payee').v.trim();
    const amount = parseAmount(get('amount'));
    const line = i + 1;
    if (!validDate(date)) { res.errors.push({ line, reason: 'invalid date' }); continue; }
    if (amount === null) { res.errors.push({ line, reason: 'invalid amount' }); continue; }
    if (!payee) { res.errors.push({ line, reason: 'empty payee' }); continue; }
    if (existing.has(`${date}|${amount}|${payee}`)) { res.skipped++; continue; }
    ledger.add({ date, amount, payee, memo: get('memo').v });
    res.added++;
  }
  return res;
}

module.exports = { importCSV };
