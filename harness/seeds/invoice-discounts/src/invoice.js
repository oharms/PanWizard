'use strict';
// Invoice totals, all in integer cents.
// An invoice is { lines: [{ unitCents, qty }], taxRate } with taxRate a fraction (0.15 = 15%).

function lineTotal(line) {
  return line.unitCents * line.qty;
}

function subtotal(invoice) {
  return invoice.lines.reduce((n, line) => n + lineTotal(line), 0);
}

function tax(invoice) {
  return Math.round(subtotal(invoice) * invoice.taxRate);
}

function total(invoice) {
  return subtotal(invoice) + tax(invoice);
}

module.exports = { lineTotal, subtotal, tax, total };
