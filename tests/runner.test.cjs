// Tests for runner.cjs — v3.7.0 W2 (self-improvement loop, external agent runner).
// Spec: docs/specs/self_improvement_loop_featureai.md §3.2

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const runner = require('../pan-wizard-core/bin/lib/runner.cjs');
const experiment = require('../pan-wizard-core/bin/lib/experiment.cjs');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pan-runner-test-'));
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function scaffoldExperiment(slug, root) {
  const ideaPath = path.join(root, 'idea.md');
  fs.writeFileSync(ideaPath, '# Idea: runner test\n## Problem\nfoo\n');
  const result = experiment.newExperiment(slug, {
    root, ideaPath, runtime: 'claude', skipInstaller: true,
  });
  assert.equal(result.error, undefined);
  return result;
}

// Cross-platform helpers: use `node` to fake the external runtime.
// NODE_BIN_QUICK exits 0 immediately (success path).
// NODE_BIN_FAIL exits 1 (failure path).
// NODE_BIN_HANG sleeps long enough to trigger a timeout.
const NODE_OK_ARGS = ['-e', 'process.stdout.write("ok\\n"); process.exit(0)'];
const NODE_FAIL_ARGS = ['-e', 'process.stderr.write("nope\\n"); process.exit(1)'];
const NODE_HANG_ARGS = ['-e', 'setInterval(() => {}, 1000)'];

// ── Module shape ────────────────────────────────────────────────────────────

describe('runner.cjs — module shape', () => {
  test('exports the W2 functions and adapter map', () => {
    assert.equal(typeof runner.runExperiment, 'function');
    assert.equal(typeof runner.tailExperimentState, 'function');
    assert.equal(typeof runner.stopExperiment, 'function');
    assert.equal(typeof runner.RUNTIME_RUNNERS, 'object');
  });

  test('RUNTIME_RUNNERS supports 4 runtimes; copilot is null/unsupported', () => {
    assert.ok(runner.RUNTIME_RUNNERS.claude, 'claude adapter required');
    assert.ok(runner.RUNTIME_RUNNERS.codex, 'codex adapter required');
    assert.ok(runner.RUNTIME_RUNNERS.gemini, 'gemini adapter required');
    assert.ok(runner.RUNTIME_RUNNERS.opencode, 'opencode adapter required');
    assert.equal(runner.RUNTIME_RUNNERS.copilot, null,
      'copilot must be null (no headless prompt mode known)');
  });

  test('each adapter has bin and buildArgs', () => {
    for (const rt of ['claude', 'codex', 'gemini', 'opencode']) {
      const a = runner.RUNTIME_RUNNERS[rt];
      assert.equal(typeof a.bin, 'string', `${rt} adapter missing bin`);
      assert.equal(typeof a.buildArgs, 'function', `${rt} adapter missing buildArgs`);
      const args = a.buildArgs('test-prompt');
      assert.ok(Array.isArray(args), `${rt} buildArgs must return array`);
      assert.ok(args.includes('test-prompt'),
        `${rt} buildArgs must include the prompt verbatim`);
    }
  });
});

// ── runExperiment — happy path with overridden adapter ─────────────────────

describe('runExperiment — happy path', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('runs subprocess and writes run-state.json with success status', () => {
    scaffoldExperiment('happy-1', tmpRoot);
    const result = runner.runExperiment('happy-1', {
      root: tmpRoot,
      runtimeOverride: { bin: 'node', buildArgs: () => NODE_OK_ARGS },
      timeoutMs: 5000,
      prompt: '/pan:new-project --auto',
    });

    assert.equal(result.error, undefined);
    assert.equal(result.exit_code, 0);
    assert.equal(result.status, 'done');
    assert.equal(result.stop_reason, 'success');
    assert.ok(typeof result.elapsed_ms === 'number');

    // run-state.json should be written into the experiment .planning/
    const stateFile = path.join(tmpRoot, 'happy-1', '.planning', 'run-state.json');
    assert.ok(fs.existsSync(stateFile), 'run-state.json should be written');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.equal(state.status, 'done');
    assert.equal(state.exit_code, 0);
    assert.equal(state.experiment_id, 'happy-1');
    assert.ok(state.started_at, 'started_at timestamp present');
    assert.ok(state.ended_at, 'ended_at timestamp present');
  });
});

// ── runExperiment — non-zero exit ───────────────────────────────────────────

describe('runExperiment — non-zero exit', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('records non-zero exit as failed', () => {
    scaffoldExperiment('fail-1', tmpRoot);
    const result = runner.runExperiment('fail-1', {
      root: tmpRoot,
      runtimeOverride: { bin: 'node', buildArgs: () => NODE_FAIL_ARGS },
      timeoutMs: 5000,
      prompt: '/pan:new-project --auto',
    });

    assert.equal(result.exit_code, 1);
    assert.equal(result.status, 'failed');
    assert.equal(result.stop_reason, 'error');
  });
});

// ── runExperiment — timeout ─────────────────────────────────────────────────

describe('runExperiment — timeout', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('aborts a hanging subprocess after timeoutMs', () => {
    scaffoldExperiment('hang-1', tmpRoot);
    const start = Date.now();
    const result = runner.runExperiment('hang-1', {
      root: tmpRoot,
      runtimeOverride: { bin: 'node', buildArgs: () => NODE_HANG_ARGS },
      timeoutMs: 800, // very short
      prompt: '/pan:new-project --auto',
    });
    const elapsed = Date.now() - start;

    assert.equal(result.status, 'failed');
    assert.equal(result.stop_reason, 'timeout');
    assert.ok(elapsed < 4000, `should abort fast (got ${elapsed}ms)`);
  });
});

// ── runExperiment — guards ──────────────────────────────────────────────────

describe('runExperiment — guards', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('errors when experiment does not exist', () => {
    const result = runner.runExperiment('nonexistent', {
      root: tmpRoot,
      runtimeOverride: { bin: 'node', buildArgs: () => NODE_OK_ARGS },
    });
    assert.match(result.error || '', /not.*found|not.*exist/i);
  });

  test('refuses unsupported runtime (copilot)', () => {
    scaffoldExperiment('copilot-block', tmpRoot);
    // Patch the manifest's runtime to copilot
    const manifestPath = path.join(tmpRoot, 'copilot-block', '.planning', 'experiment.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.runtime = 'copilot';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runner.runExperiment('copilot-block', {
      root: tmpRoot,
      // no override — should detect runtime from manifest and refuse
    });
    assert.match(result.error || '', /copilot|unsupported|not.*support/i);
  });
});

// ── tailExperimentState ─────────────────────────────────────────────────────

describe('tailExperimentState (snapshot read)', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('returns current state snapshot for an experiment', () => {
    scaffoldExperiment('tail-1', tmpRoot);
    runner.runExperiment('tail-1', {
      root: tmpRoot,
      runtimeOverride: { bin: 'node', buildArgs: () => NODE_OK_ARGS },
      timeoutMs: 5000,
    });

    const snapshot = runner.tailExperimentState('tail-1', { root: tmpRoot });
    assert.equal(snapshot.experiment_id, 'tail-1');
    assert.equal(snapshot.status, 'done');
    assert.ok(snapshot.elapsed_ms != null);
  });

  test('returns error when experiment has no run-state.json yet', () => {
    scaffoldExperiment('tail-2', tmpRoot);
    const snapshot = runner.tailExperimentState('tail-2', { root: tmpRoot });
    assert.match(snapshot.error || '', /not.*started|no.*run.*state|not.*found/i);
  });
});

// ── stopExperiment ──────────────────────────────────────────────────────────

describe('stopExperiment', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('returns error when experiment has no active run', () => {
    scaffoldExperiment('no-run', tmpRoot);
    const result = runner.stopExperiment('no-run', { root: tmpRoot });
    assert.match(result.error || '', /not.*running|no.*active|not.*found/i);
  });

  test('records stopped state when called on a finished run', () => {
    scaffoldExperiment('finished', tmpRoot);
    runner.runExperiment('finished', {
      root: tmpRoot,
      runtimeOverride: { bin: 'node', buildArgs: () => NODE_OK_ARGS },
      timeoutMs: 5000,
    });
    // Already finished — stopExperiment should report as already-done, not error
    const result = runner.stopExperiment('finished', { root: tmpRoot });
    // Either reports already-done or error; both acceptable for v3.7.0 W2
    assert.ok(result.status === 'done' || result.error,
      'should either report done or error gracefully');
  });
});

// ── runExperiment — captureMetrics (P-1603, v3.7.5) ────────────────────────

describe('runExperiment — captureMetrics', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('parses trailing JSON envelope and stores metrics in run-state', () => {
    scaffoldExperiment('metrics-1', tmpRoot);

    // Mock claude --output-format json: emits a trailing JSON object on stdout.
    const fakeEnvelope = JSON.stringify({
      result: 'ok',
      total_cost_usd: 0.0421,
      num_turns: 3,
      session_id: 'sess-abc-123',
      usage: {
        input_tokens: 1234,
        output_tokens: 567,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 200,
      },
    });
    const mockArgs = ['-e', `process.stdout.write(${JSON.stringify('chatter line\n' + fakeEnvelope)}); process.exit(0)`];

    const result = runner.runExperiment('metrics-1', {
      root: tmpRoot,
      runtimeOverride: { bin: 'node', buildArgs: () => mockArgs },
      timeoutMs: 5000,
      prompt: '/pan:new-project --auto',
      captureMetrics: true,
    });

    assert.equal(result.error, undefined);
    assert.equal(result.exit_code, 0);

    const stateFile = path.join(tmpRoot, 'metrics-1', '.planning', 'run-state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.ok(state.metrics, 'metrics block should be persisted');
    assert.equal(state.metrics.total_cost_usd, 0.0421);
    assert.equal(state.metrics.num_turns, 3);
    assert.equal(state.metrics.session_id, 'sess-abc-123');
    assert.equal(state.metrics.input_tokens, 1234);
    assert.equal(state.metrics.output_tokens, 567);
    assert.equal(state.metrics.cache_creation_input_tokens, 100);
    assert.equal(state.metrics.cache_read_input_tokens, 200);
    // Headless claude runs bill against the Agent SDK credit pool
    // (separate from interactive subscription limits since June 15, 2026).
    assert.equal(state.metrics.billing_pool, 'agent_sdk');
  });

  test('records metrics_unavailable when captureMetrics requested but no JSON envelope present', () => {
    scaffoldExperiment('metrics-2', tmpRoot);
    const result = runner.runExperiment('metrics-2', {
      root: tmpRoot,
      runtimeOverride: { bin: 'node', buildArgs: () => NODE_OK_ARGS },
      timeoutMs: 5000,
      prompt: '/pan:new-project --auto',
      captureMetrics: true,
    });

    assert.equal(result.exit_code, 0);
    const stateFile = path.join(tmpRoot, 'metrics-2', '.planning', 'run-state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.equal(state.metrics, undefined, 'no metrics block when envelope missing');
    const evt = state.events.find(e => e.type === 'metrics_unavailable');
    assert.ok(evt, 'metrics_unavailable event should be logged');
  });

  test('claude adapter omits --output-format json by default', () => {
    const args = runner.RUNTIME_RUNNERS.claude.buildArgs('test-prompt');
    assert.ok(!args.includes('--output-format'), 'default args should not include --output-format');
    assert.ok(args.includes('test-prompt'));
  });

  test('claude adapter adds --output-format json when captureMetrics is true', () => {
    const args = runner.RUNTIME_RUNNERS.claude.buildArgs('test-prompt', { captureMetrics: true });
    assert.ok(args.includes('--output-format'), 'should include --output-format flag');
    const idx = args.indexOf('--output-format');
    assert.equal(args[idx + 1], 'json', 'flag value should be "json"');
    assert.ok(args.includes('test-prompt'));
  });
});
