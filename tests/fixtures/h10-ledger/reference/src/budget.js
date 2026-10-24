'use strict';
const { monthly } = require('./report');

function budgetStatus(ledger, month) {
  const by = monthly(ledger.list(), month).byCategory;
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
