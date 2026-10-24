'use strict';
function categoryFor(rules, payee) {
  const p = String(payee || '').toLowerCase();
  for (const r of rules || []) if (p.includes(String(r.payeeContains).toLowerCase())) return r.category;
  return null;
}
module.exports = { categoryFor };
