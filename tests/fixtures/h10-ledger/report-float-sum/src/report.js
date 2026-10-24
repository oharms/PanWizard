'use strict';
// Wrong on purpose (H10 ledger pair): sums the decimal amounts as floats, so totals drift
// off the cent (0.1 + 0.2 is 0.30000000000000004).
function monthly(entries, month) {
  let income = 0, expenses = 0;
  const byCategory = {};
  for (const e of entries) {
    if (!String(e.date).startsWith(month + '-')) continue;
    if (e.amount > 0) income += e.amount; else expenses -= e.amount;
    const k = e.category == null ? 'uncategorized' : e.category;
    byCategory[k] = (byCategory[k] || 0) + e.amount;
  }
  return { month, income, expenses, net: income - expenses, byCategory };
}

function trend(entries, fromMonth, toMonth) {
  const out = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ month, net: monthly(entries, month).net });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

module.exports = { monthly, trend };
