// Usage limits from the host (market-ideas queue M38).
//
// Claude Code's status-line payload carries `rate_limits.five_hour` and
// `rate_limits.seven_day` (used_percentage, resets_at; code.claude.com/docs/en/statusline,
// read 2026-10-10). On a subscription those windows, not dollars, are what a long
// campaign runs out of. PAN's status line shows them and writes them, account-wide, to
// claude-limits.json in the per-user pan-hooks directory; `pan-tools cost limits`
// reads them, and a focus-auto run stops, resumable, once the 7-day window passes
// `cost.weekly_limit_stop_pct` (default 90).

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildStatuslineOutput } = require('../hooks/pan-statusline.js');
const { readHostLimits, weeklyLimitStop } = require('../pan-wizard-core/bin/lib/cost.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

const TOOLS = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const UID = typeof process.getuid === 'function' ? process.getuid() : (process.env.USERNAME || 'win');
const now = () => Math.floor(Date.now() / 1000);
const hooksDir = (tmp) => path.join(tmp, `pan-hooks-${UID}`);
const writeLimits = (tmp, body) => {
  fs.mkdirSync(hooksDir(tmp), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(hooksDir(tmp), 'claude-limits.json'), JSON.stringify(body));
};
const tools = (args, cwd, tmp) => spawnSync(process.execPath, [TOOLS, ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
});

describe('the status line shows and records the limits', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lim-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('a payload with rate_limits gives a badge and an account-wide file', () => {
    const out = buildStatuslineOutput({
      model: { display_name: 'M' }, session_id: 's1', context_window: { remaining_percentage: 60 },
      rate_limits: { five_hour: { used_percentage: 42, resets_at: 4102444800 }, seven_day: { used_percentage: 91.4, resets_at: 4102444800 } },
    }, { tmpDir: tmp, homeDir: tmp });
    assert.match(out, /5h 42% · 7d 91%/);
    assert.match(out, /\x1b\[31m5h/, 'red from 90%');
    const rec = JSON.parse(fs.readFileSync(path.join(hooksDir(tmp), 'claude-limits.json'), 'utf8'));
    assert.equal(rec.seven_day.used_percentage, 91.4);
    assert.equal(rec.five_hour.resets_at, 4102444800);
  });

  test('a payload without the block shows no badge and writes no file', () => {
    const out = buildStatuslineOutput({ model: { display_name: 'M' }, session_id: 's2', context_window: { remaining_percentage: 60 } }, { tmpDir: tmp, homeDir: tmp });
    assert.doesNotMatch(out, /5h|7d/);
    assert.ok(!fs.existsSync(path.join(hooksDir(tmp), 'claude-limits.json')));
  });

  test('the limits are written even when the payload has no context window', () => {
    buildStatuslineOutput({ model: { display_name: 'M' }, rate_limits: { seven_day: { used_percentage: 10 } } }, { tmpDir: tmp, homeDir: tmp });
    assert.ok(fs.existsSync(path.join(hooksDir(tmp), 'claude-limits.json')));
  });
});

describe('reading the limits back', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lim-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('a fresh reading is returned as written', () => {
    writeLimits(tmp, { seven_day: { used_percentage: 80, resets_at: now() + 3600 }, timestamp: now() });
    const l = readHostLimits({ tmpDir: tmp });
    assert.equal(l.seven_day.used_pct, 80);
    assert.equal(l.stale, false);
  });

  test('a window whose reset time has passed reads as reset', () => {
    writeLimits(tmp, { seven_day: { used_percentage: 95, resets_at: now() - 10 }, timestamp: now() });
    assert.equal(readHostLimits({ tmpDir: tmp }).seven_day.used_pct, 0);
  });

  test('an old reading is stale, and a stale reading never stops a run', () => {
    writeLimits(tmp, { seven_day: { used_percentage: 99 }, timestamp: now() - 3600 });
    const l = readHostLimits({ tmpDir: tmp });
    assert.equal(l.stale, true);
    assert.equal(weeklyLimitStop(tmp, l).stop, false);
  });

  test('no file means no reading', () => {
    assert.equal(readHostLimits({ tmpDir: tmp }), null);
  });
});

describe('the weekly stop', () => {
  let proj, tmp;
  beforeEach(() => { proj = createTempProject(); tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lim-')); });
  afterEach(() => { cleanup(proj); fs.rmSync(tmp, { recursive: true, force: true }); });

  const fresh = (pct) => ({ seven_day: { used_pct: pct }, stale: false });

  test('stops at the default 90%, not below', () => {
    assert.equal(weeklyLimitStop(proj, fresh(90)).stop, true);
    assert.equal(weeklyLimitStop(proj, fresh(89)).stop, false);
  });

  test('cost.weekly_limit_stop_pct sets the threshold, and 0 turns it off', () => {
    fs.writeFileSync(path.join(proj, '.planning', 'config.json'), JSON.stringify({ cost: { weekly_limit_stop_pct: 75 } }));
    assert.equal(weeklyLimitStop(proj, fresh(76)).stop, true);
    fs.writeFileSync(path.join(proj, '.planning', 'config.json'), JSON.stringify({ cost: { weekly_limit_stop_pct: 0 } }));
    assert.equal(weeklyLimitStop(proj, fresh(100)).stop, false);
  });

  test('`cost limits` reports the reading and whether the stop is reached', () => {
    writeLimits(tmp, { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 93 }, timestamp: now() });
    const r = tools(['cost', 'limits'], proj, tmp);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.available, true);
    assert.equal(j.seven_day.used_pct, 93);
    assert.equal(j.weekly_limit_reached, true);
    assert.equal(tools(['cost', 'limits', '--raw'], proj, tmp).stdout, 'weekly_limit_reached');
  });

  test('a focus-auto cycle past the threshold stops the run, resumable', () => {
    assert.equal(tools(['focus', 'auto', '--category', 'cleanup'], proj, tmp).status, 0);
    writeLimits(tmp, { seven_day: { used_percentage: 92 }, timestamp: now() });
    const r = tools(['focus', 'auto', '--update', '--items-completed', '2', '--points-used', '4', '--tests-before', '10', '--tests-after', '10'], proj, tmp);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.stop_reason, 'weekly_limit');
    assert.equal(j.status, 'stopped');
  });

  test('below the threshold the cycle carries on', () => {
    assert.equal(tools(['focus', 'auto', '--category', 'cleanup'], proj, tmp).status, 0);
    writeLimits(tmp, { seven_day: { used_percentage: 40 }, timestamp: now() });
    const j = JSON.parse(tools(['focus', 'auto', '--update', '--items-completed', '2', '--points-used', '4', '--tests-before', '10', '--tests-after', '10'], proj, tmp).stdout);
    assert.equal(j.stop_reason, null);
  });
});
