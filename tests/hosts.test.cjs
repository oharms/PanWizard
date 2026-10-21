/**
 * Program A0: one host table. `pan-wizard-core/bin/lib/hosts.cjs` holds how PAN runs
 * each host CLI — the autonomous runner's argv (experiments, and later autodev) and the
 * harness's headless argv — where runner.cjs and harness/src/model.cjs each kept their
 * own table.
 *
 * Code gate: the argv per host is unchanged by the merge. The snapshot below was taken
 * from both old tables before hosts.cjs existed; both consumers now read from it.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const P = 'PROMPT';
const SNAPSHOT = {
  runner: {
    claude: ['-p', '--dangerously-skip-permissions', P],
    claudeMetrics: ['-p', '--dangerously-skip-permissions', '--output-format', 'json', P],
    codex: ['exec', P],
    gemini: ['-p', '--yolo', P],
    opencode: [P],
    copilot: null,
  },
  harness: {
    codex: ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-'],
    copilot: ['-p', P, '--output-format', 'json', '--allow-all-tools', '--allow-all-paths'],
    gemini: ['-p', P, '-o', 'json', '--approval-mode', 'yolo'],
    opencode: ['run', '--format', 'json', P],
  },
};

describe('argv per host is unchanged by the merge (A0)', () => {
  test('the runner builds the snapshot argv', () => {
    const { RUNTIME_RUNNERS } = require('../pan-wizard-core/bin/lib/runner.cjs');
    assert.deepEqual(RUNTIME_RUNNERS.claude.buildArgs(P, {}), SNAPSHOT.runner.claude);
    assert.deepEqual(RUNTIME_RUNNERS.claude.buildArgs(P, { captureMetrics: true }), SNAPSHOT.runner.claudeMetrics);
    for (const rt of ['codex', 'gemini', 'opencode']) assert.deepEqual(RUNTIME_RUNNERS[rt].buildArgs(P, {}), SNAPSHOT.runner[rt], rt);
    assert.equal(RUNTIME_RUNNERS.copilot, null, 'no autonomous runner adapter for Copilot yet');
    for (const rt of ['claude', 'codex', 'gemini', 'opencode']) assert.equal(RUNTIME_RUNNERS[rt].shell, 'win32', rt);
  });

  test('the harness builds the snapshot argv', () => {
    const { modelArgsFor, MODEL_RUNTIMES } = require('../harness/src/model.cjs');
    for (const rt of ['codex', 'copilot', 'gemini', 'opencode']) assert.deepEqual(modelArgsFor(rt, P), SNAPSHOT.harness[rt], rt);
    assert.equal(MODEL_RUNTIMES.claude.parse, true);
    assert.deepEqual(Object.keys(MODEL_RUNTIMES).sort(), ['claude', 'codex', 'copilot', 'gemini', 'opencode']);
  });
});

describe('one table, two consumers (A0)', () => {
  test('both read hosts.cjs', () => {
    const H = require('../pan-wizard-core/bin/lib/hosts.cjs');
    assert.deepEqual(Object.keys(H.HOSTS).sort(), ['claude', 'codex', 'copilot', 'gemini', 'opencode']);
    const { RUNTIME_RUNNERS } = require('../pan-wizard-core/bin/lib/runner.cjs');
    const { MODEL_RUNTIMES } = require('../harness/src/model.cjs');
    assert.equal(RUNTIME_RUNNERS.codex.buildArgs, H.HOSTS.codex.runner.buildArgs, 'the runner takes its adapter from hosts.cjs');
    assert.equal(MODEL_RUNTIMES.codex.args, H.HOSTS.codex.headless.args, 'the harness takes its argv from hosts.cjs');
    for (const [name, h] of Object.entries(H.HOSTS)) assert.equal(h.bin, name === 'claude' ? 'claude' : name, `${name}: bin`);
  });
});
