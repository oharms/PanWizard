'use strict';

/**
 * The expenses store. An expense is
 *   { id, date, amountCents, description, costCentre, submittedBy, deletedAt }
 * where date is YYYY-MM-DD, amountCents an integer (a refund is negative), costCentre a
 * code or null, and deletedAt null or an ISO timestamp.
 */
function createStore() {
  const records = [];
  let nextId = 1;

  function add({ date, amountCents, description = '', costCentre = null, submittedBy = '' }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error(`invalid date: ${date}`);
    if (!Number.isInteger(amountCents)) throw new Error(`amountCents must be an integer: ${amountCents}`);
    const e = { id: nextId++, date, amountCents, description: String(description), costCentre, submittedBy: String(submittedBy), deletedAt: null };
    records.push(e);
    return { ...e };
  }

  function get(id) {
    const e = records.find((r) => r.id === id);
    return e ? { ...e } : null;
  }

  /** Soft delete: the record is marked, and kept for the audit trail. */
  function remove(id) {
    const e = records.find((r) => r.id === id);
    if (!e) throw new Error(`unknown expense: ${id}`);
    if (!e.deletedAt) e.deletedAt = new Date().toISOString();
    return { ...e };
  }

  /** Every record, in the order added. */
  function all() {
    return records.map((r) => ({ ...r }));
  }

  return { add, get, remove, all };
}

module.exports = { createStore };
