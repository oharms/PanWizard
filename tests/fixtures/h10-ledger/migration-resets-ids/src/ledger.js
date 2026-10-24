'use strict';
// Wrong on purpose (H10 ledger pair): the migration drops nextId and restarts from the largest id, so a removed id comes back.
const fs = require('fs');
const { categoryFor } = require('./categories');

const VERSION = 2;

function validDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** Currency units to integer cents; throws unless finite with at most two decimals. */
function toCents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('amount must be a finite number');
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 1e-6) throw new Error('amount has more than two decimals: ' + amount);
  return cents;
}

const fromCents = (c) => c / 100;

function migrate(raw, file) {
  const entries = (raw.entries || []).map((e) => ({ id: e.id, date: e.date, cents: Math.round(Number(e.amount) * 100), payee: e.payee, memo: e.memo || '', category: e.category == null ? null : e.category }));
  const maxId = entries.reduce((m, e) => Math.max(m, e.id), 0);
  fs.copyFileSync(file, file + '.v1.bak');
  return { version: VERSION, nextId: maxId + 1, entries, rules: raw.rules || [], budgets: {} };
}

function load(file) {
  if (!fs.existsSync(file)) return { data: { version: VERSION, nextId: 1, entries: [], rules: [], budgets: {} }, migrated: false };
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.version === undefined) return { data: migrate(raw, file), migrated: true };
  if (raw.version > VERSION) throw new Error(`unsupported ledger file version ${raw.version}`);
  return { data: { version: VERSION, nextId: raw.nextId, entries: raw.entries || [], rules: raw.rules || [], budgets: raw.budgets || {} }, migrated: false };
}

function openLedger(file) {
  const loaded = load(file);
  const data = loaded.data;
  const save = () => fs.writeFileSync(file, JSON.stringify(data));
  if (loaded.migrated) save();
  const view = (e) => ({ id: e.id, date: e.date, amount: fromCents(e.cents), payee: e.payee, memo: e.memo, category: e.category });
  const find = (id) => { const e = data.entries.find((x) => x.id === id); if (!e) throw new Error('no entry ' + id); return e; };
  const nonEmpty = (s, what) => { if (typeof s !== 'string' || !s.trim()) throw new Error(what + ' must be a non-empty string'); };

  return {
    add({ date, amount, payee, memo = '', category = null } = {}) {
      if (!validDate(date)) throw new Error('bad date ' + date);
      const cents = toCents(amount);
      nonEmpty(payee, 'payee');
      const cat = category == null ? categoryFor(data.rules, payee) : category;
      const e = { id: data.nextId++, date, cents, payee, memo, category: cat };
      data.entries.push(e); save(); return view(e);
    },
    remove(id) { find(id); data.entries = data.entries.filter((x) => x.id !== id); save(); },
    list({ from, to } = {}) {
      return data.entries
        .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
        .map(view);
    },
    addRule({ payeeContains, category } = {}) {
      nonEmpty(payeeContains, 'payeeContains'); nonEmpty(category, 'category');
      const r = { payeeContains, category };
      data.rules.push(r); save(); return { ...r };
    },
    rules() { return data.rules.map((r) => ({ ...r })); },
    setCategory(id, category) {
      const e = find(id);
      e.category = category == null ? null : category; save(); return view(e);
    },
    applyRules() {
      let n = 0;
      for (const e of data.entries) {
        if (e.category !== null) continue;
        const c = categoryFor(data.rules, e.payee);
        if (c !== null) { e.category = c; n++; }
      }
      if (n) save();
      return n;
    },
    setBudget(category, amount) {
      nonEmpty(category, 'category');
      const cents = toCents(amount);
      if (cents < 0) throw new Error('budget must be positive');
      if (cents === 0) delete data.budgets[category]; else data.budgets[category] = cents;
      save();
    },
    budgets() { return Object.fromEntries(Object.entries(data.budgets).map(([k, v]) => [k, fromCents(v)])); },
  };
}

module.exports = { openLedger, toCents, validDate };
