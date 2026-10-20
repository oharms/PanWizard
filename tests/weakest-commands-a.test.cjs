/**
 * Program L6a: the weakest commands, part 1. One test per fix, each proven red first.
 *
 * - army's merge gate: `pan-tools merge request` stages a merge through
 *   mcp/merge-gate.cjs (the phase gate decides verify_pass); `pan-tools merge confirm`
 *   refuses outside an interactive terminal, so an agent can stage a merge but only a
 *   person can approve it. No environment-variable seam exists to get past that.
 * - `cost clear` backs the ledger up before it deletes it.
 * - health asks per repair class: `validate health` lists `repairs_available`, and
 *   `--repair --only <class>` runs only the chosen ones.
 * (what-if's cleanup guard landed in sprint 1: whatif.cjs refuses branches and
 * worktrees outside its own prefix.)
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

let dir;
const run = (...args) => spawnSync(process.execPath, [TOOLS_PATH, ...args], { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

beforeEach(() => { dir = createTempProject(); });
afterEach(() => cleanup(dir));

describe('army merge gate through pan-tools (L6a)', () => {
  test('merge request stages the request and never prints the approval token', () => {
    const r = run('merge', 'request', 'army/feature-x', '--ci-green');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'awaiting_approval');
    assert.equal(out.branch, 'army/feature-x');
    assert.equal(out.approval_token, undefined, 'the token is for a person, not for the agent that staged the merge');
    assert.match(out.next, /merge confirm army\/feature-x/);
  });

  test('merge confirm refuses without an interactive terminal, even with the token in the environment', () => {
    run('merge', 'request', 'army/feature-x', '--ci-green');
    const rec = JSON.parse(fs.readFileSync(fs.readdirSync(path.join(dir, '.planning', 'orchestration', 'approvals')).map((f) => path.join(dir, '.planning', 'orchestration', 'approvals', f))[0], 'utf8'));
    const r = spawnSync(process.execPath, [TOOLS_PATH, 'merge', 'confirm', 'army/feature-x'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PAN_MERGE_APPROVAL: rec.approval_token } });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, 'human_terminal_required');
  });
});

describe('cost clear backs the ledger up first (L6a)', () => {
  test('the cleared ledger survives as a timestamped backup', () => {
    const metrics = path.join(dir, '.planning', 'metrics');
    fs.mkdirSync(metrics, { recursive: true });
    fs.writeFileSync(path.join(metrics, 'tokens.jsonl'), '{"cost_usd":1}\n');
    const r = run('cost', 'clear');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.cleared, true);
    assert.ok(out.backup && fs.existsSync(out.backup), 'the backup file exists');
    assert.equal(fs.readFileSync(out.backup, 'utf8'), '{"cost_usd":1}\n');
  });
});

describe('health asks per repair class (L6a)', () => {
  test('validate health lists the repairs it would run, and --only runs just the chosen class', () => {
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), '{ not json');
    const look = JSON.parse(run('validate', 'health').stdout);
    assert.ok(Array.isArray(look.repairs_available) && look.repairs_available.includes('resetConfig'), JSON.stringify(look.repairs_available));
    const skip = JSON.parse(run('validate', 'health', '--repair', '--only', 'regenerateState').stdout);
    assert.ok(!(skip.repairs_performed || []).some((a) => a.action === 'resetConfig'), 'a class the user did not choose is not repaired');
    assert.equal(fs.readFileSync(path.join(dir, '.planning', 'config.json'), 'utf8'), '{ not json');
    const fix = JSON.parse(run('validate', 'health', '--repair', '--only', 'resetConfig').stdout);
    assert.ok(fix.repairs_performed.some((a) => a.action === 'resetConfig' && a.success));
  });
});
