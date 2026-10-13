/**
 * scripts/prompt-lint.cjs — the prompt-contract lint (program L2).
 *
 * One seeded defect per rule, each caught, and a clean twin that passes. Then the
 * shipped tree: no finding beyond tests/fixtures/prompt-lint-allowlist.json, and no
 * allowlist entry that no longer matches anything (a stale entry hides the next one).
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../scripts/prompt-lint.cjs');

const ROOT = path.join(__dirname, '..');
const ctx = { ...L.surface(), dev: L.devSkills() };
const rules = (rel, text) => L.lintText(rel, text, ctx).map((f) => f.rule);

describe('prompt lint — each rule catches its seeded defect, and the clean twin passes', () => {
  test('unknown-verb: a verb or subcommand the engine does not have', () => {
    assert.deepEqual(rules('commands/pan/x.md', 'Run `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs frobnicate 3`.'), ['unknown-verb']);
    assert.deepEqual(rules('commands/pan/x.md', 'Run `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs findings sweep`.'), ['unknown-verb']);
    assert.deepEqual(rules('commands/pan/x.md', 'Run `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs findings record --phase 3`, then `pan-tools phase gate 3`.'), []);
    assert.deepEqual(rules('commands/pan/x.md', 'Positional arguments are not subcommands: `pan-tools.cjs find-phase 3`.'), []);
    assert.deepEqual(rules('commands/pan/x.md', 'In prose, pan-tools for key links is fine.'), []);
  });

  test('tool-not-granted: an agent told to use a tool it does not have; a negation is kept, not broken', () => {
    const agent = (tools, body) => `---\nname: pan-x\ntools: ${tools}\n---\n\n${body}\n`;
    assert.deepEqual(rules('agents/pan-x.md', agent('Read, Grep', 'Use the Write tool to save the report.')), ['tool-not-granted']);
    assert.deepEqual(rules('agents/pan-x.md', agent('Read, Write', 'Use the Write tool to save the report.')), []);
    assert.deepEqual(rules('agents/pan-x.md', agent('Read, Grep', 'READ-ONLY: Never use Edit or Write tools.')), []);
    assert.deepEqual(rules('commands/pan/x.md', 'Use the Write tool.'), [], 'commands run in the session, which has every tool');
  });

  test('pasted-source: an @-include of engine source', () => {
    assert.deepEqual(rules('commands/pan/x.md', '<execution_context>\n@~/.claude/pan-wizard-core/bin/lib/cost.cjs\n</execution_context>'), ['pasted-source']);
    assert.deepEqual(rules('commands/pan/x.md', '<execution_context>\n@~/.claude/pan-wizard-core/workflows/x.md\n</execution_context>'), []);
  });

  test('oversized-question: more than four options in one question', () => {
    const ask = (n) => `AskUserQuestion([\n  { question: "Q?", header: "H", multiSelect: false, options: [\n${Array.from({ length: n }, (_, i) => `    { label: "L${i}", description: "d" }`).join(',\n')}\n  ] }\n])`;
    assert.deepEqual(rules('pan-wizard-core/workflows/x.md', ask(5)), ['oversized-question']);
    assert.deepEqual(rules('pan-wizard-core/workflows/x.md', ask(4)), []);
  });

  test('untyped-spawn: no model, or a general-purpose spawn told to read a role file', () => {
    assert.deepEqual(rules('pan-wizard-core/workflows/x.md', 'Task(\n  prompt="go",\n  subagent_type="pan-planner"\n)'), ['untyped-spawn']);
    assert.deepEqual(rules('pan-wizard-core/workflows/x.md', 'Task(\n  prompt="First, read ~/.claude/agents/pan-planner.md for your role and instructions.",\n  subagent_type="general-purpose",\n  model="{planner_model}"\n)'), ['untyped-spawn']);
    assert.deepEqual(rules('pan-wizard-core/workflows/x.md', 'Task(\n  prompt="go",\n  subagent_type="pan-planner",\n  model="{planner_model}"\n)'), []);
    assert.deepEqual(rules('agents/pan-x.md', '---\nname: pan-x\ntools: Read\n---\nTask(\n  prompt="go"\n)'), [], 'agents describe spawns; the rule is for the workflows that issue them');
  });

  test('dev-skill: a shipped prompt sending the user to a dev-only skill', () => {
    assert.ok(ctx.dev.includes('execplan'), 'the dev skills are read from .claude/commands');
    assert.deepEqual(rules('commands/pan/x.md', 'When done, run /execplan to continue.'), ['dev-skill']);
    assert.deepEqual(rules('commands/pan/x.md', 'When done, run `/pan:exec-phase 3` to continue.'), []);
    assert.deepEqual(rules('commands/pan/x.md', 'Tests live in src/test/ and tests/.'), [], 'a path is not a command');
  });
});

describe('prompt lint — the shipped tree', () => {
  const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'prompt-lint-allowlist.json'), 'utf8'));
  const allowed = (f) => allow.some((a) => a.rule === f.rule && a.file === f.file && f.text.includes(a.match));
  const findings = L.lintTree();

  test('the lint reads every shipped prompt', () => {
    assert.ok(L.shippedPrompts().length >= 80, `only ${L.shippedPrompts().length} prompts`);
  });

  test('no finding beyond the allowlist', () => {
    assert.deepEqual(findings.filter((f) => !allowed(f)).map((f) => `${f.rule} ${f.file}:${f.line} — ${f.text}`), []);
  });

  test('every allowlist entry still matches a finding, and says why', () => {
    for (const a of allow) {
      assert.ok(a.reason && a.reason.length > 20, `${a.file}: an allowlist entry needs its reason`);
      assert.ok(findings.some((f) => f.rule === a.rule && f.file === a.file && f.text.includes(a.match)), `stale allowlist entry: ${a.rule} ${a.file}`);
    }
  });
});
