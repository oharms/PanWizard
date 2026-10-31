/**
 * Program H6: the prompt-rule registry and prompt mutation.
 *
 * scripts/prompt-rules.cjs extracts the normative lines of the shipped prompts (MUST,
 * NEVER, always, do not …) into tests/fixtures/prompt-rules.json, each with a stable id.
 * A harness scenario claims the rules it exercises (`covers: [ids]`). A rule that was in
 * the registry when it was created is grandfathered (`baseline`); any other unclaimed rule
 * fails `--check` unless the allowlist gives a reason. `harness run --prompt-mutant <id>`
 * deletes one rule from the packed package and reruns the scenarios that cover it: a rule
 * whose removal changes nothing is decorative. Code gate: `--check` fails on an unclaimed
 * rule; mutant generation is unit-tested. The mutant run itself spends (live).
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PR = require('../scripts/prompt-rules.cjs');

let dir;
function repo(files, scenarios = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-rules-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(path.join(dir, 'harness', 'scenarios'), { recursive: true });
  for (const [id, covers] of Object.entries(scenarios)) fs.writeFileSync(path.join(dir, 'harness', 'scenarios', `${id}.json`), JSON.stringify({ id, covers }));
  fs.mkdirSync(path.join(dir, 'tests', 'fixtures'), { recursive: true });
}
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });

const AGENT = '---\nname: pan-x\n---\n# X\n\nSome prose.\n\n- You MUST run the tests before you commit.\n- Never push to main.\n- Prefer short names.\n\n```bash\n# never runs: inside a fence\nrm -rf never\n```\n\nAlways cite the file.\n';

describe('extraction (H6)', () => {
  test('normative lines outside code fences, with stable ids', () => {
    repo({ 'agents/pan-x.md': AGENT });
    const rules = PR.extractRules(dir);
    assert.deepEqual(rules.map((r) => r.text), ['You MUST run the tests before you commit.', 'Never push to main.', 'Always cite the file.']);
    assert.ok(rules.every((r) => /^agents\/pan-x:[0-9a-f]{8}$/.test(r.id)), JSON.stringify(rules));
    assert.deepEqual(PR.extractRules(dir).map((r) => r.id), rules.map((r) => r.id), 'ids are stable');
  });

  test('a rule\'s id moves with its text, not its line number', () => {
    repo({ 'agents/pan-x.md': AGENT });
    const before = PR.extractRules(dir).find((r) => r.text.startsWith('Never push'));
    fs.writeFileSync(path.join(dir, 'agents/pan-x.md'), '\n\n\n' + AGENT);
    assert.equal(PR.extractRules(dir).find((r) => r.text.startsWith('Never push')).id, before.id);
  });
});

describe('--check (H6)', () => {
  test('a new unclaimed rule fails; a baseline, claimed or allowlisted one passes', () => {
    repo({ 'agents/pan-x.md': AGENT });
    PR.writeRegistry(dir, { baseline: true });
    assert.deepEqual(PR.checkRegistry(dir).unclaimed, []);
    fs.appendFileSync(path.join(dir, 'agents/pan-x.md'), '\nDo not delete the ledger.\n');
    PR.writeRegistry(dir);
    const id = PR.extractRules(dir).find((r) => r.text === 'Do not delete the ledger.').id;
    assert.deepEqual(PR.checkRegistry(dir).unclaimed.map((r) => r.id), [id]);
    fs.writeFileSync(path.join(dir, 'harness', 'scenarios', 'ledger.json'), JSON.stringify({ id: 'ledger', covers: [id] }));
    assert.deepEqual(PR.checkRegistry(dir).unclaimed, [], 'claimed by a scenario');
    fs.rmSync(path.join(dir, 'harness', 'scenarios', 'ledger.json'));
    fs.writeFileSync(path.join(dir, 'tests', 'fixtures', 'prompt-rules-allowlist.json'), JSON.stringify([{ id, reason: 'covered by tests/ledger.test.cjs' }]));
    assert.deepEqual(PR.checkRegistry(dir).unclaimed, [], 'allowlisted with a reason');
  });

  test('a stale registry (rules changed since --write) fails', () => {
    repo({ 'agents/pan-x.md': AGENT });
    PR.writeRegistry(dir, { baseline: true });
    fs.appendFileSync(path.join(dir, 'agents/pan-x.md'), '\nNever skip the gate.\n');
    assert.equal(PR.checkRegistry(dir).stale, true);
  });

  test('a scenario claiming a rule that does not exist is reported', () => {
    repo({ 'agents/pan-x.md': AGENT }, { s1: ['agents/pan-x:deadbeef'] });
    PR.writeRegistry(dir, { baseline: true });
    assert.deepEqual(PR.checkRegistry(dir).dangling, [{ scenario: 's1', id: 'agents/pan-x:deadbeef' }]);
  });

  test('an allowlist entry that names no rule is reported, so a removed rule cannot leave its excuse behind', () => {
    repo({ 'agents/pan-x.md': AGENT });
    PR.writeRegistry(dir, { baseline: true });
    const live = PR.extractRules(dir)[0].id;
    fs.writeFileSync(path.join(dir, 'tests', 'fixtures', 'prompt-rules-allowlist.json'), JSON.stringify([{ id: live, reason: 'kept' }, { id: 'agents/pan-x:deadbeef', reason: 'gone' }]));
    assert.deepEqual(PR.checkRegistry(dir).staleAllowed, ['agents/pan-x:deadbeef']);
  });

  test('a dead allowlist entry with no reason is reported too, not silently kept', () => {
    repo({ 'agents/pan-x.md': AGENT });
    PR.writeRegistry(dir, { baseline: true });
    fs.writeFileSync(path.join(dir, 'tests', 'fixtures', 'prompt-rules-allowlist.json'), JSON.stringify([{ id: 'agents/pan-x:0badf00d' }]));
    assert.deepEqual(PR.checkRegistry(dir).staleAllowed, ['agents/pan-x:0badf00d']);
  });

  test('the repository\'s registry is current and every new rule is claimed', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'prompt-rules.cjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

describe('mutants (H6)', () => {
  test('a mutant deletes exactly the rule\'s line', () => {
    const m = PR.generateMutant(AGENT, 'Never push to main.');
    assert.ok(m);
    assert.ok(!m.content.includes('Never push to main.'));
    assert.equal(m.content.split('\n').length, AGENT.split('\n').length - 1);
    assert.ok(m.content.includes('You MUST run the tests'));
  });

  test('a rule not in the file gives no mutant', () => {
    assert.equal(PR.generateMutant(AGENT, 'Not there.'), null);
  });

  test('applyMutant edits the extracted package, not the source', () => {
    repo({ 'agents/pan-x.md': AGENT });
    PR.writeRegistry(dir, { baseline: true });
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-pkg-'));
    try {
      fs.mkdirSync(path.join(pkg, 'agents'));
      fs.writeFileSync(path.join(pkg, 'agents', 'pan-x.md'), AGENT);
      const id = PR.extractRules(dir).find((r) => r.text === 'Always cite the file.').id;
      const r = PR.applyMutant(dir, pkg, id);
      assert.equal(r.file, 'agents/pan-x.md');
      assert.ok(!fs.readFileSync(path.join(pkg, 'agents', 'pan-x.md'), 'utf8').includes('Always cite'));
      assert.ok(fs.readFileSync(path.join(dir, 'agents', 'pan-x.md'), 'utf8').includes('Always cite'), 'source untouched');
      assert.equal(PR.applyMutant(dir, pkg, 'agents/pan-x:00000000').error, 'unknown_rule');
    } finally { fs.rmSync(pkg, { recursive: true, force: true }); }
  });

  test('the harness takes --prompt-mutant and runs only the scenarios that cover the rule', () => {
    const { parseArgs } = require('../harness/src/run.cjs');
    assert.equal(parseArgs(['--prompt-mutant', 'agents/pan-x:12345678']).promptMutant, 'agents/pan-x:12345678');
    assert.deepEqual(PR.coveringScenarios([{ id: 'a', covers: ['r1'] }, { id: 'b' }, { id: 'c', covers: ['r1', 'r2'] }], 'r1').map((s) => s.id), ['a', 'c']);
  });
});
