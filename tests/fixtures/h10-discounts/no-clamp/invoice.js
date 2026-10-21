'use strict';
const fs = require('fs');
const path = require('path');
function lineTotal(line) { return line.unitCents * line.qty; }
function subtotal(invoice) { return invoice.lines.reduce((n, line) => n + lineTotal(line), 0); }
function tax(invoice) { return Math.round(subtotal(invoice) * invoice.taxRate); }
function total(invoice) { return subtotal(invoice) + tax(invoice); }
function roundHalfAway(x) { return Math.sign(x) * Math.round(Math.abs(x)); }
function applyDiscount(invoice, code, today) {
  const codes = JSON.parse(fs.readFileSync(path.join(__dirname, 'codes.json'), 'utf8'));
  const key = String(code).trim().toUpperCase();
  const c = codes[key];
  if (!c || today > c.expires) throw new Error(`invalid discount code: ${code}`);
  const sub = subtotal(invoice);
  const off = c.type === 'percent' ? roundHalfAway(sub * c.value / 100) : c.value;
  const discounted = (sub - off);
  return discounted + Math.round(discounted * invoice.taxRate);
}
module.exports = { lineTotal, subtotal, tax, total, applyDiscount };
