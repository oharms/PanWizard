/**
 * GitHub's Agent Skills validator over every skill PAN emits (market-ideas M30).
 *
 * `gh skill publish --dry-run` checks skills against the agentskills.io rules: strict
 * names, a name that matches its directory, the required fields, `allowed-tools` as
 * a string. It needs no network and no login. Three converters write SKILL.md files:
 * the unified one (the `.agents/skills` tree and the Agent Plugins bundle), Codex's
 * and Copilot's. Each one's real output is validated here. SKIPPED when the GitHub
 * CLI or its `skill` command is absent, as `claude plugin validate` is in
 * tests/plugin-marketplace.test.cjs, so CI and contributors are never blocked by a
 * local tool. The hand-written frontmatter tests stay the always-on floor.
 *
 * Accepted warnings: a body over the validator's line budget (long skills are the
 * subject of the progressive-disclosure work in market-ideas S8) and "not a git
 * repository" (the validation copy is not one). Anything else fails.
 */

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildAgentPluginInto, installInto, cleanup } = require('./helpers.cjs');

// "not a git repository": the validation copy is not one. A long body is accepted
// only in an install's skills, which load whole; the Agent Plugins bundle splits every
// long skill into a pointer page and references/instructions.md (market-ideas S8).
const NOT_A_REPO = /not a git repository/;
const LONG_BODY = /recommended max: \d+ for efficient context/;

function ghSkillAvailable() {
  const r = spawnSync('gh', ['skill', 'publish', '--help'], { encoding: 'utf8', timeout: 30000 });
  return r.status === 0 && /--dry-run/.test(r.stdout || '');
}

/** Copy a tree of `<name>/SKILL.md` directories to `<tmp>/skills/` and validate it. */
function validate(skillsDir, accepted) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ghskill-'));
  try {
    fs.cpSync(skillsDir, path.join(root, 'skills'), { recursive: true });
    const count = fs.readdirSync(path.join(root, 'skills')).filter((d) => fs.existsSync(path.join(root, 'skills', d, 'SKILL.md'))).length;
    const r = spawnSync('gh', ['skill', 'publish', '--dry-run', '.'], { cwd: root, encoding: 'utf8', timeout: 120000 });
    const lines = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => /^(warning|error)\t/.test(l));
    return {
      status: r.status,
      count,
      errors: lines.filter((l) => l.startsWith('error')),
      unexpected: lines.filter((l) => l.startsWith('warning') && !accepted.some((re) => re.test(l))),
      license: lines.filter((l) => /license/.test(l)),
    };
  } finally {
    cleanup(root);
  }
}

const available = ghSkillAvailable();

describe('every emitted skill passes GitHub\'s Agent Skills validator (M30)', { skip: available ? false : 'the GitHub CLI skill command is not available' }, () => {
  let bundle;
  let codex;
  let copilot;
  before(() => {
    bundle = buildAgentPluginInto();
    codex = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ghskill-codex-'));
    copilot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ghskill-copilot-'));
    assert.ok(installInto(codex, ['--codex', '--local']).success, 'codex install');
    assert.ok(installInto(copilot, ['--copilot', '--local']).success, 'copilot install');
  });
  after(() => { cleanup(bundle); cleanup(codex); cleanup(copilot); });

  for (const [label, dir, accepted] of [
    ['the Agent Plugins bundle (unified converter; long skills split, so no long body)', () => path.join(bundle, 'skills'), [NOT_A_REPO]],
    ['a Codex install (.agents/skills)', () => path.join(codex, '.agents', 'skills'), [NOT_A_REPO, LONG_BODY]],
    ['a Copilot install (.github/skills)', () => path.join(copilot, '.github', 'skills'), [NOT_A_REPO, LONG_BODY]],
  ]) {
    test(label, () => {
      const r = validate(dir(), accepted);
      assert.ok(r.count > 0, 'non-vacuity: the tree holds skills');
      assert.equal(r.status, 0, `the validator failed:\n${[...r.errors, ...r.unexpected].join('\n')}`);
      assert.deepEqual(r.errors, []);
      assert.deepEqual(r.unexpected, [], 'only the accepted warnings may remain');
      assert.deepEqual(r.license, [], 'every skill carries the package licence');
    });
  }
});

// Always on, whether or not the GitHub CLI is installed: every converter writes the
// package's licence, which the validator above would otherwise warn on for each skill.
describe('every skill converter writes the package licence (M30)', () => {
  const lib = require('../bin/install-lib.cjs');
  const licence = require('../package.json').license;
  const cmd = '---\nname: pan:help\ndescription: Help\n---\nBody\n';
  for (const f of ['convertClaudeCommandToUnifiedSkill', 'convertClaudeCommandToCodexSkill', 'convertClaudeCommandToCopilotSkill']) {
    test(f, () => {
      const fm = lib[f](cmd, 'pan-help').split('\n---\n')[0];
      assert.ok(fm.split('\n').includes(`license: "${licence}"`), fm);
    });
  }
});
