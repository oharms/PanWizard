'use strict';
const cents = (amount) => Math.round(amount * 100);

function monthly(entries, month) {
  let inc = 0, exp = 0;
  const cat = {};
  for (const e of entries) {
    if (!String(e.date).startsWith(month + '-')) continue;
    const c = cents(e.amount);
    if (c > 0) inc += c; else exp -= c;
    const k = e.category == null ? 'uncategorized' : e.category;
    cat[k] = (cat[k] || 0) + c;
  }
  const byCategory = Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, v / 100]));
  return { month, income: inc / 100, expenses: exp / 100, net: (inc - exp) / 100, byCategory };
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
