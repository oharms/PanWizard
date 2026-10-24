'use strict';
// Wrong on purpose (H10 ledger pair): phase 6 re-derives categories from the rules instead of using the stored category and the phase 4 report.
const { categoryFor } = require('./categories');

function budgetStatus(ledger, month) {
  const by = {};
  for (const e of ledger.list()) {
    if (!e.date.startsWith(month + '-')) continue;
    const c = categoryFor(ledger.rules(), e.payee) || e.category;
    if (c) by[c] = Math.round(((by[c] || 0) + e.amount) * 100) / 100;
  }
  return Object.entries(ledger.budgets())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([category, budget]) => {
      const b = Math.round(budget * 100);
      const s = -Math.round((by[category] || 0) * 100);
      const status = s * 100 < b * 80 ? 'ok' : s <= b ? 'warning' : 'over';
      return { category, budget: b / 100, spent: s / 100, remaining: (b - s) / 100, status };
    });
}

function alerts(ledger, month) {
  return budgetStatus(ledger, month)
    .filter((s) => s.status !== 'ok')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'over' ? -1 : 1) || (a.category < b.category ? -1 : 1))
    .map((s) => `${s.category}: ${s.spent.toFixed(2)} of ${s.budget.toFixed(2)} (${Math.floor((Math.round(s.spent * 100) * 100) / Math.round(s.budget * 100))}%)`);
}

module.exports = { budgetStatus, alerts };
