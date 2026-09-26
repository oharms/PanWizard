// Failure-tier escalation (market-ideas queue M8, MI-029).
//
// A retry of work that failed on a cheaper tier climbs one tier per failed
// attempt, capped by `routing.max_escalations` (default 1) and never above the
// agent's own quality tier. Under `quality`/`balanced` every agent already runs
// on the reasoning tier, so this is the `budget` profile's retry path. Explicit
// pins (model_overrides, a roadmap per-phase tier) are never escalated.

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { escalateTier, resolveModelDetailed, TIER_LADDER, MODEL_PROFILES } = require('../pan-wizard-core/bin/lib/core.cjs');
const { buildConfigDefaults } = require('../pan-wizard-core/bin/lib/config.cjs');
const registry = require('../pan-wizard-core/mcp/tool-registry.cjs');
const { createTempProject, cleanup, runPanTools } = require('./helpers.cjs');

describe('escalateTier', () => {
  test('the ladder is fast → mid → reasoning', () => {
    assert.deepEqual([...TIER_LADDER], ['fast', 'mid', 'reasoning']);
  });

  test('a first try never escalates', () => {
    assert.deepEqual(escalateTier('mid', 1), { tier: 'mid', escalated_from: null });
    assert.deepEqual(escalateTier('mid', undefined), { tier: 'mid', escalated_from: null });
  });

  test('each failed attempt climbs one step, capped by maxEscalations (default 1)', () => {
    assert.deepEqual(escalateTier('fast', 2), { tier: 'mid', escalated_from: 'fast' });
    assert.deepEqual(escalateTier('fast', 3), { tier: 'mid', escalated_from: 'fast' }, 'the default cap is one step');
    assert.deepEqual(escalateTier('fast', 3, { maxEscalations: 2 }), { tier: 'reasoning', escalated_from: 'fast' });
    assert.deepEqual(escalateTier('fast', 2, { maxEscalations: 0 }), { tier: 'fast', escalated_from: null }, '0 turns escalation off');
  });

  test('never above the ceiling, and never from the top', () => {
    assert.deepEqual(escalateTier('fast', 5, { maxEscalations: 5, ceiling: 'mid' }), { tier: 'mid', escalated_from: 'fast' });
    assert.deepEqual(escalateTier('mid', 2, { ceiling: 'mid' }), { tier: 'mid', escalated_from: null });
    assert.deepEqual(escalateTier('reasoning', 4), { tier: 'reasoning', escalated_from: null });
  });

  test('legacy names are read as their tiers', () => {
    assert.deepEqual(escalateTier('sonnet', 2), { tier: 'reasoning', escalated_from: 'mid' });
  });
});

describe('routing.max_escalations is a documented default', () => {
  test('new configs carry routing.max_escalations: 1', () => {
    assert.equal(buildConfigDefaults(false, {}).routing.max_escalations, 1);
  });
});

describe('resolve-model --attempt', () => {
  let dir;
  const writeConfig = (cfg) => fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify(cfg));
  const resolve = (args) => {
    const r = runPanTools(`resolve-model ${args}`, dir);
    assert.ok(r.success, `resolve-model ${args} failed: ${r.error}`);
    return JSON.parse(r.output);
  };
  beforeEach(() => { dir = createTempProject(); });
  afterEach(() => cleanup(dir));

  test('budget: the executor\'s retry runs on the reasoning tier and says what it escalated from', () => {
    writeConfig({ model_profile: 'budget', routing: { provider: 'anthropic' } });
    assert.equal(MODEL_PROFILES['pan-executor'].budget, 'mid', 'fixture premise');
    const first = resolve('pan-executor');
    assert.equal(first.model, 'sonnet');
    assert.ok(!('attempt' in first), 'no --attempt, no attempt fields');
    const retry = resolve('pan-executor --attempt 2');
    assert.equal(retry.model, 'inherit');
    assert.equal(retry.attempt, 2);
    assert.equal(retry.escalated_from, 'mid');
  });

  test('routing.max_escalations raises the cap; the quality tier is the ceiling', () => {
    writeConfig({ model_profile: 'budget', routing: { provider: 'anthropic', max_escalations: 2 } });
    assert.equal(resolve('pan-verifier --attempt 3').model, 'inherit', 'fast → mid → reasoning');
    writeConfig({ model_profile: 'budget', routing: { provider: 'anthropic', max_escalations: 0 } });
    const off = resolve('pan-verifier --attempt 3');
    assert.equal(off.model, 'haiku');
    assert.equal(off.escalated_from, null);
  });

  test('balanced is already at the top: a retry changes nothing', () => {
    writeConfig({ model_profile: 'balanced' });
    const r = resolve('pan-executor --attempt 2');
    assert.equal(r.model, 'inherit');
    assert.equal(r.escalated_from, null);
  });

  test('an explicit model_overrides pin is never escalated', () => {
    writeConfig({ model_profile: 'budget', routing: { provider: 'anthropic' }, model_overrides: { 'pan-executor': 'haiku' } });
    const r = resolve('pan-executor --attempt 3');
    assert.equal(r.model, 'haiku');
    assert.equal(r.escalated_from, null);
    assert.equal(resolveModelDetailed(dir, 'pan-executor', { attempt: 3 }).tier, 'fast');
  });

  test('an attempt that is not a positive integer is refused', () => {
    for (const bad of ['0', '-1', '1.5', 'two']) {
      const r = runPanTools(`resolve-model pan-executor --attempt ${bad}`, dir);
      assert.equal(r.success, false, `--attempt ${bad} must fail`);
      assert.match(r.error, /--attempt must be a positive integer/);
    }
  });
});

describe('the MCP resolve tool forwards the attempt', () => {
  const tool = registry.SPAWN_TOOLS.find((t) => t.name === 'pan_resolve_model');

  test('attempt is optional and becomes --attempt', () => {
    assert.deepEqual(tool.args({ agent: 'pan-executor' }), ['pan-executor']);
    assert.deepEqual(tool.args({ agent: 'pan-executor', attempt: 2 }), ['pan-executor', '--attempt', '2']);
    assert.equal(tool.inputSchema.properties.attempt.type, 'integer');
  });

  test('a malformed attempt is rejected before anything spawns', () => {
    assert.throws(() => tool.args({ agent: 'pan-executor', attempt: 0 }), /Invalid "attempt"/);
    assert.throws(() => tool.args({ agent: 'pan-executor', attempt: '2' }), /Invalid "attempt"/);
  });
});
