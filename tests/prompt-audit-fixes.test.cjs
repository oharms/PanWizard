// What Claude Code's prompt audit (`/doctor prompt-audit`, market-ideas M34) found in
// PAN's shipped prompts on 2026-10-03, pinned so each class cannot come back: paths
// and file names an install never has, flags a command never forwards or a workflow
// does not take, and writing duties an agent's tools cannot carry out. Where a fix
// generalises, the check covers every shipped file rather than the one the audit named.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const shipped = () => [
  ...fs.readdirSync(path.join(ROOT, 'commands', 'pan')).filter((f) => f.endsWith('.md')).map((f) => `commands/pan/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => `agents/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'pan-wizard-core', 'workflows')).filter((f) => f.endsWith('.md')).map((f) => `pan-wizard-core/workflows/${f}`),
];

describe('paths an install actually has', () => {
  test('no shipped prompt looks for a phase directory as .planning/phase-N (they live under .planning/phases/)', () => {
    // pan-verifier's prior-phase check listed `.planning/phase-${PREV_PHASE}*`, which
    // never matches, so the previous phase always read as unverified.
    const offenders = shipped().filter((f) => /\.planning\/phase-[$\d{]/.test(read(f)));
    assert.deepEqual(offenders, []);
  });

  test('no shipped prompt names a codebase-map document in uppercase (map-codebase writes lowercase)', () => {
    // pan-verifier read `.planning/codebase/CONVENTIONS.md`; a case-sensitive
    // filesystem never matches the `conventions.md` map-codebase writes.
    const offenders = shipped().filter((f) => /\.planning\/codebase\/[A-Z][A-Z_-]*\.md/.test(read(f)));
    assert.deepEqual(offenders, []);
  });

  test("pan-verifier finds the previous phase through find-phase, reading a padded number as decimal", () => {
    const verifier = read('agents/pan-verifier.md');
    assert.match(verifier, /pan-tools\.cjs find-phase "\$PREV_PHASE"/);
    // bash reads 08 and 09 as invalid octal without the 10# prefix
    assert.match(verifier, /PREV_PHASE=\$\(\(10#/);
  });
});

describe('flags', () => {
  test('/pan:focus-auto forwards every flag focusAutoInit reads', () => {
    // The init line passed on only some of them, so `/pan:focus-auto --enforce-budget`
    // never enforced anything.
    const src = read('pan-wizard-core/bin/lib/focus.cjs');
    const start = src.indexOf('function focusAutoInit(');
    assert.ok(start >= 0, 'focusAutoInit not found');
    const body = src.slice(start, src.indexOf('\nfunction ', start + 1));
    const flags = [...new Set([...body.matchAll(/(?:getVal|hasFlag)\('(--[a-z-]+)'/g)].map((m) => m[1]))];
    assert.ok(flags.includes('--enforce-budget'), `parsed flags: ${flags.join(' ')}`);
    const initLine = read('commands/pan/focus-auto.md').split('\n').find((l) => l.includes('pan-tools focus auto --category'));
    assert.ok(initLine, 'the init step is not in the command');
    const missing = flags.filter((f) => !initLine.includes(f));
    assert.deepEqual(missing, [], 'flags the tooling reads but the command never passes on');
  });

  test('pan-conductor attributes no --skip-verify to exec-phase (exec-phase has no such flag)', () => {
    assert.doesNotMatch(read('agents/pan-conductor.md'), /--skip-verify/);
    assert.doesNotMatch(read('commands/pan/exec-phase.md'), /--skip-verify/);
  });
});

const toolsOf = (rel) => {
  const m = read(rel).match(/^tools:\s*(.+)$/m);
  return m ? m[1].split(',').map((t) => t.trim()) : [];
};

describe('what an agent is told to do, its tools can do', () => {
  test('the agents that must write a report at a given path hold Write', () => {
    // pan-optimizer's report never got written (its caller waits for the file);
    // the hardener and meta-reviewer were handed an output path with no Write.
    for (const agent of ['pan-optimizer', 'pan-hardener', 'pan-meta-reviewer']) {
      assert.ok(toolsOf(`agents/${agent}.md`).includes('Write'), `${agent} must hold Write`);
    }
  });

  test('pan-experiment-runner, which holds no Write, claims no write duty', () => {
    assert.ok(!toolsOf('agents/pan-experiment-runner.md').includes('Write'));
    assert.doesNotMatch(read('agents/pan-experiment-runner.md'), /^- (Update|Write)\b[^\n]*run-state\.json/m);
  });

  test('no agent without Edit is told to edit in place', () => {
    // pan-roadmapper's revision step said "Edit, not rewrite" while its tools have
    // no Edit and its own P-1808 rule is one Write per file.
    const offenders = fs.readdirSync(path.join(ROOT, 'agents')).filter((f) => f.endsWith('.md'))
      .filter((f) => !toolsOf(`agents/${f}`).includes('Edit'))
      .filter((f) => /\(Edit, not rewrite|in place \(Edit\b/.test(read(`agents/${f}`)));
    assert.deepEqual(offenders, []);
  });

  test('the parallel project researchers leave summary.md to the synthesizer', () => {
    // Each of the parallel researchers was told to write summary.md (and every
    // dimension file), so they could overwrite each other and the synthesizer.
    assert.doesNotMatch(read('agents/pan-project-researcher.md'), /\*\*summary\.md\*\* — Always/);
  });
});

describe('facts in shipped prompts', () => {
  test('an OWASP list named 2025 uses the 2025 categories, not the 2021 ones', () => {
    // The hardener, the standards catalog and focus-auto all carried the 2021 list
    // under the 2025 name. These pairings exist only in 2021.
    const stale = /A03:? Injection|A10:? SSRF|A06:? Vulnerable Components|A02:? Cryptographic Failures/;
    const files = [...shipped(), 'pan-wizard-core/bin/lib/constants.cjs'].filter((f) => read(f).includes('2025'));
    const offenders = files.filter((f) => stale.test(read(f)));
    assert.deepEqual(offenders, []);
    assert.match(read('pan-wizard-core/bin/lib/constants.cjs'), /A10: Mishandling of Exceptional Conditions/);
  });

  test('no agent reads "do not load AGENTS.md" as skipping the project\'s own instructions', () => {
    // CLAUDE.md is `@AGENTS.md` in an install, so the old rule told agents to skip
    // the project's instructions; it meant the large AGENTS.md in skill directories.
    const offenders = shipped().filter((f) => /Do NOT load full `AGENTS\.md` files/.test(read(f)));
    assert.deepEqual(offenders, []);
  });

  test('no shipped prompt carries a path from a developer machine', () => {
    const offenders = shipped().filter((f) => /\b[A-Za-z]:[\\/]PanWizard\b/i.test(read(f)));
    assert.deepEqual(offenders, []);
  });

  test('pan-knowledge does not claim the prompt cache carries files between turns', () => {
    assert.doesNotMatch(read('agents/pan-knowledge.md'), /prompt cache has warmed/i);
  });
});
