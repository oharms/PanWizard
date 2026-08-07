/**
 * Cost accounting must treat the three input token axes as disjoint.
 *
 * Medium finding from the 2026-08 deployed stability test. hooks/pan-cost-logger.js
 * records Anthropic's `input_tokens`, `cache_read_input_tokens` and
 * `cache_creation_input_tokens` into separate fields, and Anthropic's `input_tokens`
 * already EXCLUDES both cache axes. computeCost nevertheless subtracted cache_read
 * from input, hedging that "cache_read is already in input on some providers". That
 * double-discounted, and because a warm cache makes cache_read far larger than input,
 * Math.max(0, …) zeroed the billed input outright.
 *
 * The same wrong assumption pinned the cache-hit metric: its denominator collapsed to
 * cache_read alone whenever the cache was warm, so it reported exactly 100% forever
 * and carried no information.
 *
 * Both errors ran in the direction of looking cheaper and more efficient than reality.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAN_TOOLS = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let tempRoot;
let proj;

function writeLedger(rows) {
  const p = path.join(proj, '.planning', 'metrics', 'tokens.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

function cost() {
  const r = spawnSync('node', [PAN_TOOLS, 'cost', '--raw'], { cwd: proj, encoding: 'utf-8', timeout: 30000 });
  return JSON.parse(r.stdout);
}

const ROW = {
  v: 3, ts: '2026-08-07T00:00:00Z', agent: 'pan-executor',
  model: 'claude-opus-5', tier: 'reasoning',
  input_tokens: 30000, output_tokens: 5000,
  cache_read_tokens: 200000, cache_write_tokens: 12000,
};

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-cost-'));
  proj = path.join(tempRoot, 'proj');
  fs.mkdirSync(path.join(proj, '.planning'), { recursive: true });
});

after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

describe('every token axis is billed at its own rate', () => {
  test('a warm-cache row is priced from all four axes', () => {
    writeLedger([ROW]);

    // claude-opus-5: in 5.0 / out 25.0 / cache_read 0.5 / cache_write 6.25 per 1M.
    // 30000*5 + 5000*25 + 200000*0.5 + 12000*6.25 = 450000 / 1e6 = $0.45
    // REVERT CHECK: subtracting cache_read from input zeroes the input term and
    // yields $0.30 — a 33% understatement on an entirely ordinary row.
    assert.equal(cost().totals.cost_usd, 0.45);
  });

  test('a cold-cache row is unaffected by the change', () => {
    writeLedger([{ ...ROW, input_tokens: 10000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0 }]);
    // 10000*5 + 1000*25 = 75000 / 1e6 = $0.075. With no cache there was nothing to
    // subtract, which is why the bug stayed invisible in simple fixtures.
    assert.equal(cost().totals.cost_usd, 0.075);
  });
});

describe('cache hit rate reflects reality instead of pinning at 100%', () => {
  test('a warm-cache row reports the real ratio', () => {
    writeLedger([ROW]);
    // 200000 / (200000 + 30000) = 86.96% -> 87
    // REVERT CHECK: the old denominator collapsed to cache_read alone, giving 100.
    assert.equal(cost().cache_hit_rate_pct, 87);
  });

  test('no caching reports 0%, not 100%', () => {
    writeLedger([{ ...ROW, cache_read_tokens: 0, cache_write_tokens: 0 }]);
    assert.equal(cost().cache_hit_rate_pct, 0);
  });

  test('a fully cached row still reports 100%', () => {
    writeLedger([{ ...ROW, input_tokens: 0 }]);
    assert.equal(cost().cache_hit_rate_pct, 100, 'the genuine 100% case must survive the fix');
  });
});
