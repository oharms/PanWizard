/**
 * Program S3: verifiable fix lanes, ordered by how mechanical their gate is.
 *
 * The autopilot's fix lanes run in order: kill a surviving mutant, cover an unreferenced
 * surface row, cover a dispatcher arm, fix docs and links, turn a harness finding green,
 * change a prompt. A lane unlocks after the one before it has N branches the owner merged
 * and none reverted. A bot branch is kept for the owner only when it passes its lane's
 * gates: the same-seed mutation re-probe (fewer survivors than the base), the test
 * quality lint, and the suite. The owner opens any PR; the autopilot opens none.
 */
'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AP = require('../harness/autopilot/autopilot.cjs');
const LANES = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness', 'autopilot', 'lanes.json'), 'utf8'));

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('S3: the fix lanes and their order', () => {
  test('six fix lanes, most mechanical gate first', () => {
    const fix = LANES.filter((l) => l.fix).sort((a, b) => a.order - b.order).map((l) => l.id);
    assert.deepEqual(fix, ['fix-mutant', 'fix-surface', 'fix-dispatcher', 'fix-docs', 'fix-harness', 'fix-prompt']);
    for (const l of LANES.filter((x) => x.fix)) {
      assert.equal(l.model, true, l.id);
      assert.ok(Array.isArray(l.gates) && l.gates.includes('suite') && l.gates.includes('quality-lint'), l.id);
    }
    assert.ok(LANES.find((l) => l.id === 'fix-mutant').gates.includes('reprobe'));
  });

  test('the first lane is open; a later lane opens after N merged branches of the one before, none reverted', () => {
    const merged = (n, lane = 'fix-mutant') => Array.from({ length: n }, (_, i) => ({ lane, branch: `bot/${lane}/${i}`, outcome: 'merged' }));
    assert.equal(AP.laneUnlocked(LANES, 'fix-mutant', []), true);
    assert.equal(AP.laneUnlocked(LANES, 'fix-surface', merged(2)), false);
    assert.equal(AP.laneUnlocked(LANES, 'fix-surface', merged(3)), true);
    assert.equal(AP.laneUnlocked(LANES, 'fix-surface', [...merged(3), { lane: 'fix-mutant', branch: 'bot/fix-mutant/9', outcome: 'reverted' }]), false, 'a revert closes it again');
    assert.equal(AP.laneUnlocked(LANES, 'fix-dispatcher', merged(3)), false, 'one lane at a time');
  });

  test('a locked lane does not run', () => {
    assert.equal(AP.checkRun(LANES, 'fix-docs', { approveUsd: 1, botRuns: [], spend: [] }).error, 'lane_locked');
    assert.equal(AP.checkRun(LANES, 'fix-mutant', { approveUsd: 1, botRuns: [], spend: [] }).ok, true);
  });
});

describe('S3: a branch is kept only when it passes its lane\'s gates', () => {
  const lane = { id: 'fix-mutant', gates: ['reprobe', 'quality-lint', 'suite'], target: 'hooks/pan-cost-logger.js' };
  const exec = (map) => (gate, cwd) => map[gate][cwd === 'BASE' ? 'base' : 'head'];

  test('fewer survivors at the same seed, a clean quality lint and a green suite: kept', () => {
    const r = AP.verifyGates(lane, { worktree: 'HEAD', base: 'BASE', seed: 7, exec: exec({
      reprobe: { base: { status: 0, survived: 3 }, head: { status: 0, survived: 2 } },
      'quality-lint': { head: { status: 0 } }, suite: { head: { status: 0 } },
    }) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.results.map((x) => x.gate), ['reprobe', 'quality-lint', 'suite']);
  });

  test('a re-probe that kills nothing more, a lint finding, or a red suite: refused, named', () => {
    const base = { 'quality-lint': { head: { status: 0 } }, suite: { head: { status: 0 } } };
    const same = AP.verifyGates(lane, { worktree: 'HEAD', base: 'BASE', seed: 7, exec: exec({ ...base, reprobe: { base: { status: 0, survived: 3 }, head: { status: 0, survived: 3 } } }) });
    assert.equal(same.ok, false); assert.equal(same.failed, 'reprobe');
    const lint = AP.verifyGates(lane, { worktree: 'HEAD', base: 'BASE', seed: 7, exec: exec({ ...base, reprobe: { base: { survived: 3 }, head: { survived: 1 } }, 'quality-lint': { head: { status: 1 } } }) });
    assert.equal(lint.failed, 'quality-lint');
    const suite = AP.verifyGates(lane, { worktree: 'HEAD', base: 'BASE', seed: 7, exec: exec({ ...base, reprobe: { base: { survived: 3 }, head: { survived: 1 } }, suite: { head: { status: 1 } } }) });
    assert.equal(suite.failed, 'suite');
  });

  test('the model lane runs its gates before it keeps a branch', () => {
    const src = fs.readFileSync(path.join(ROOT, 'harness', 'autopilot', 'autopilot.cjs'), 'utf8');
    assert.match(src, /verifyGates\(/);
    assert.match(src.slice(src.indexOf('function runModelLane')), /verifyGates\(/);
  });

  test('the owner records what became of a branch: merged or reverted', () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lanes-'));
    dirs.push(state);
    AP.recordOutcome('bot/fix-mutant/1', 'merged', { stateDir: state });
    AP.recordOutcome('bot/fix-mutant/2', 'reverted', { stateDir: state });
    const rows = fs.readFileSync(path.join(state, 'bot-runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => [r.lane, r.outcome]), [['fix-mutant', 'merged'], ['fix-mutant', 'reverted']]);
    assert.throws(() => AP.recordOutcome('bot/x/1', 'pushed', { stateDir: state }), /merged or reverted/);
  });
});
