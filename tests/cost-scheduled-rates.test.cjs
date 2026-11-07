// Price changes a pricing page announces with a date (R58 in
// docs/specs/market-ideas-2026-11.md). Gemini 4 Argon doubles on 2026-12-01 and
// Gemini 3.8 Flash on 2027-01-01; a comment asking someone to edit the row on the day
// was the only mechanism. A record is now priced at the row in force on its own day.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../pan-wizard-core/bin/lib/cost.cjs');

const usd = (model, ts, extra = {}) => C.computeCost({ model, input_tokens: 1e6, output_tokens: 1e6, ts, ...extra });

describe('scheduled rates', () => {
  test('Gemini 4 Argon: the old price through 2026-11-30, the new one from 2026-12-01 (UTC day)', () => {
    assert.equal(usd('gemini-4-argon', '2026-11-30T23:59:59.999Z'), 2 + 10);
    assert.equal(usd('gemini-4-argon', '2026-12-01T00:00:00.000Z'), 4 + 20);
    assert.equal(usd('gemini-4-argon', '2027-06-01'), 4 + 20);
  });

  test('Gemini 3.8 Flash changes on 2027-01-01', () => {
    assert.equal(usd('gemini-3.8-flash', '2026-12-31T12:00:00Z'), 0.75 + 3.75);
    assert.equal(usd('gemini-3.8-flash', '2027-01-01T00:00:00Z'), 1.5 + 7.5);
  });

  test('a versioned id of a scheduled family follows the schedule too', () => {
    assert.equal(usd('gemini-4-argon-001', '2026-12-02'), 4 + 20);
    assert.equal(usd('gemini-4-argon-001', '2026-11-02'), 2 + 10);
  });

  test('a config override still wins over a scheduled row', () => {
    const rates = { 'gemini-4-argon': { input: 1, output: 1, cache_read: 0, cache_write: 0 } };
    assert.equal(C.computeCost({ model: 'gemini-4-argon', input_tokens: 1e6, output_tokens: 1e6, ts: '2026-12-05' }, rates), 2);
  });

  test('cached reads move with the schedule', () => {
    const r = C.computeCost({ model: 'gemini-4-argon', cache_read_tokens: 1e6, ts: '2026-12-05' });
    assert.ok(Math.abs(r - 0.2) < 1e-9, String(r));
  });

  test('scheduledRate ignores a missing or malformed date and unscheduled models', () => {
    assert.equal(C.scheduledRate('gemini-4-argon', null), null);
    assert.equal(C.scheduledRate('gemini-4-argon', 'soon'), null);
    assert.equal(C.scheduledRate('claude-opus-5-5', '2027-01-01'), null);
    assert.ok(C.scheduledRate('gemini-4-argon', '2026-12-01'));
  });

  test('every scheduled model has a current row, and every entry a date and a full rate', () => {
    for (const [model, list] of Object.entries(C.SCHEDULED_RATES)) {
      assert.ok(C.computeCost({ model, input_tokens: 1, ts: '2000-01-01' }) !== null, `${model} has no current row`);
      for (const e of list) {
        assert.match(e.from, /^\d{4}-\d{2}-\d{2}$/);
        for (const k of ['input', 'output', 'cache_read', 'cache_write']) assert.equal(typeof e.rate[k], 'number', `${model} ${e.from} ${k}`);
      }
    }
  });
});

describe('rows added 2026-11-07', () => {
  test('GPT-6.1 Terra is priced (read from the pricing page that day)', () => {
    assert.equal(usd('gpt-6.1-terra', '2026-11-07'), 1 + 5);
  });
});
