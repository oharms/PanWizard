/**
 * harness/scripts/feedback-intake.cjs — developer intake for /pan:feedback reports.
 *
 * Takes pasted reports, keeps only well-formed pan-feedback/1 blocks, drops exact
 * duplicates, and surfaces what recurs across at least three reports.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const I = require('../harness/scripts/feedback-intake.cjs');
const FB = require('../pan-wizard-core/bin/lib/feedback.cjs');

function report(overrides = {}) {
  const block = {
    schema: 'pan-feedback/1', pan: { version: '3.37.0', runtimes: ['claude'], scope: 'local' }, env: { os: 'linux', node: 22 }, window: { from: '2026-W31', to: '2026-W44', days: 90 },
    config: { values: {}, other_keys: 0 }, gate: { phases: 4, ok: 1, refusals: { no_verification: 3 }, not_checked: {} },
    judges: { 'pan-reviewer': { by_class: { quality: { total: 12, dismissed: 9, fixed: 3 } } } },
    execution: { test: {}, mutation: {} }, cost: { forecast: { checked: 5, above_p90: 2 } }, usage: { commands_unfinished: ['exec-phase'] }, guard: {}, trace: {},
    suggestions: [{ id: 'judge_noise', evidence: { agent: 'pan-reviewer', class: 'quality' } }],
    ...overrides,
  };
  return `Some words the user added.\n\n\`\`\`pan-feedback\n${JSON.stringify(block)}\n\`\`\`\n`;
}

describe('feedback intake', () => {
  test('a real engine report is accepted as is', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fbi-'));
    try {
      fs.mkdirSync(path.join(dir, '.planning'));
      const r = FB.buildReport(dir, {});
      const found = I.extract(r.text);
      assert.deepEqual(found.map((f) => f.ok), [true]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('an unknown schema, extra fields or bad JSON are rejected', () => {
    assert.match(I.extract(report({ schema: 'pan-feedback/2' }))[0].why, /schema/);
    assert.match(I.extract(report({ project_name: 'x' }))[0].why, /extra project_name/);
    assert.match(I.extract('```pan-feedback\n{not json\n```')[0].why, /not JSON/);
  });

  test('aggregates counts across reports and reads <3 as one', () => {
    const blocks = [report(), report({ gate: { refusals: { no_verification: '<3', test_failed: 5 } } })].flatMap(I.extract).map((f) => f.block);
    const a = I.aggregate(blocks);
    assert.deepEqual(a.gate_refusals, { no_verification: 4, test_failed: 5 });
    assert.deepEqual(a.judge_classes['pan-reviewer quality'], { total: 24, dismissed: 18, reports: 2 });
    assert.deepEqual(a.forecast, { checked: 10, above_p90: 4 });
  });

  test('a suggestion recurs only when three different reports carry it', () => {
    const two = I.aggregate([report(), report({ env: { os: 'win32', node: 22 } })].flatMap(I.extract).map((f) => f.block));
    assert.deepEqual(two.recurring, []);
    const three = I.aggregate([report(), report({ env: { os: 'win32', node: 22 } }), report({ env: { os: 'darwin', node: 20 } })].flatMap(I.extract).map((f) => f.block));
    assert.deepEqual(three.recurring, [{ key: 'judge_noise pan-reviewer quality', reports: 3 }]);
  });

  test('CLI: the same report pasted twice counts once; --json prints the aggregate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fbi-'));
    try {
      const f = path.join(dir, 'a.md');
      fs.writeFileSync(f, report() + report() + report({ schema: 'x' }));
      const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'harness', 'scripts', 'feedback-intake.cjs'), f, '--json'], { encoding: 'utf8' }));
      assert.deepEqual([out.reports, out.duplicates, out.rejected.length], [1, 1, 1]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
