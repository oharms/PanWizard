/**
 * Tests for hooks/pan-cost-logger.js — SubagentStop hook (v3.4+).
 *
 * The hook's pure helpers are importable. Stdin-driven execution is tested
 * indirectly via buildCostRecord inputs that mirror Claude Code's
 * SubagentStop event shape.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildCostRecord, appendRecord, METRICS_DIR, TOKENS_FILE } =
  require('../hooks/pan-cost-logger.js');
const { createTempProject, cleanup } = require('./helpers.cjs');

describe('pan-cost-logger — buildCostRecord', () => {
  test('returns null for non-object input', () => {
    assert.equal(buildCostRecord(null), null);
    assert.equal(buildCostRecord('string'), null);
    assert.equal(buildCostRecord(undefined), null);
  });

  test('returns null when hook_event_name is wrong', () => {
    assert.equal(buildCostRecord({ hook_event_name: 'Stop' }), null);
    assert.equal(buildCostRecord({ hook_event_name: 'PostToolUse' }), null);
  });

  test('accepts SubagentStop or unlabeled event', () => {
    const r1 = buildCostRecord({ hook_event_name: 'SubagentStop' });
    assert.ok(r1);
    assert.equal(r1.source, 'hook');
    const r2 = buildCostRecord({});
    assert.ok(r2);
  });

  test('extracts agent and session from event', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-planner',
      session_id: 'abc-123',
    });
    assert.equal(r.agent, 'pan-planner');
    assert.equal(r.session, 'abc-123');
  });

  test('fallback to subagent_type when agent_type absent', () => {
    const r = buildCostRecord({ subagent_type: 'pan-verifier' });
    assert.equal(r.agent, 'pan-verifier');
  });

  test('extracts usage.input_tokens and output_tokens', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      usage: { input_tokens: 5000, output_tokens: 200 },
    });
    assert.equal(r.input_tokens, 5000);
    assert.equal(r.output_tokens, 200);
  });

  test('extracts cache usage fields', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      usage: {
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 500,
      },
    });
    assert.equal(r.cache_read_tokens, 8000);
    assert.equal(r.cache_write_tokens, 500);
  });

  test('defaults token fields to 0 when usage missing', () => {
    const r = buildCostRecord({ hook_event_name: 'SubagentStop' });
    assert.equal(r.input_tokens, 0);
    assert.equal(r.output_tokens, 0);
    assert.equal(r.cache_read_tokens, 0);
    assert.equal(r.cache_write_tokens, 0);
  });

  test('sets source: "hook" for aggregator to distinguish from caller writes', () => {
    const r = buildCostRecord({ hook_event_name: 'SubagentStop' });
    assert.equal(r.source, 'hook');
  });

  test('timestamp is ISO-8601', () => {
    const r = buildCostRecord({ hook_event_name: 'SubagentStop' });
    assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('model and phase passed through when present', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      model: 'claude-opus-4-7',
      phase: '07',
    });
    assert.equal(r.model, 'claude-opus-4-7');
    assert.equal(r.phase, '07');
  });
});

describe('pan-cost-logger — appendRecord', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('no-op when record is null', () => {
    assert.equal(appendRecord(tmpDir, null), false);
  });

  test('creates file and directory on first record', () => {
    const r = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'x' });
    const ok = appendRecord(tmpDir, r);
    assert.equal(ok, true);
    const file = path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);
    assert.ok(fs.existsSync(file));
  });

  test('appends multiple records as separate lines', () => {
    const r1 = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'a' });
    const r2 = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'b' });
    appendRecord(tmpDir, r1);
    appendRecord(tmpDir, r2);
    const lines = fs.readFileSync(
      path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE),
      'utf-8'
    ).split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
  });

  test('returns false silently on write error (non-blocking)', () => {
    // Point at a path that can't be written: a file where the parent is also a file.
    const badCwd = path.join(tmpDir, '.planning', 'metrics');
    // Create .planning/metrics as a FILE so mkdirSync succeeds on cwd but
    // fails when trying to create .planning/metrics as directory.
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'metrics'), 'not-a-dir');
    const r = buildCostRecord({ hook_event_name: 'SubagentStop' });
    const ok = appendRecord(tmpDir, r);
    assert.equal(ok, false); // write failed, but no throw
  });

  test('records parse as valid JSON', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-executor',
      usage: { input_tokens: 1000, output_tokens: 100 },
    });
    appendRecord(tmpDir, r);
    const line = fs.readFileSync(
      path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE),
      'utf-8'
    ).trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.agent, 'pan-executor');
    assert.equal(parsed.input_tokens, 1000);
    assert.equal(parsed.source, 'hook');
  });
});

describe('pan-cost-logger — integration with cost.cjs aggregator', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('hook records are visible to cost.aggregate()', () => {
    const { aggregate } = require('../pan-wizard-core/bin/lib/cost.cjs');
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-executor',
      model: 'claude-opus-4-7',
      usage: { input_tokens: 2000, output_tokens: 200 },
    });
    appendRecord(tmpDir, r);
    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.calls, 1);
    assert.equal(agg.totals.input_tokens, 2000);
    assert.equal(agg.by_agent['pan-executor'].calls, 1);
  });

  test('hook records without model still aggregate (cost_unknown bumps)', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-unknown',
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    appendRecord(tmpDir, r);
    const { aggregate } = require('../pan-wizard-core/bin/lib/cost.cjs');
    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.calls, 1);
    assert.equal(agg.totals.cost_unknown, 1);
  });
});
