'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/store.js');

test('add returns the new expense with an id', () => {
  const s = createStore();
  const e = s.add({ date: '2026-09-01', amountCents: 1250, description: 'Taxi', costCentre: 'OPS-200', submittedBy: 'sipho' });
  assert.deepStrictEqual(e, { id: 1, date: '2026-09-01', amountCents: 1250, description: 'Taxi', costCentre: 'OPS-200', submittedBy: 'sipho', deletedAt: null });
  assert.equal(s.add({ date: '2026-09-02', amountCents: 1 }).id, 2);
});

test('add rejects a bad date or a non-integer amount', () => {
  const s = createStore();
  assert.throws(() => s.add({ date: '1/9/2026', amountCents: 1 }), /invalid date/);
  assert.throws(() => s.add({ date: '2026-09-01', amountCents: 12.5 }), /integer/);
});

test('remove is a soft delete', () => {
  const s = createStore();
  const e = s.add({ date: '2026-09-01', amountCents: 100 });
  s.remove(e.id);
  assert.ok(s.get(e.id).deletedAt);
  assert.equal(s.all().length, 1);
  assert.throws(() => s.remove(99), /unknown expense/);
});

test('all returns copies', () => {
  const s = createStore();
  s.add({ date: '2026-09-01', amountCents: 100 });
  s.all()[0].amountCents = 5;
  assert.equal(s.get(1).amountCents, 100);
});
