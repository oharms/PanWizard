/**
 * Claude Code's skill surface after a real install (reality check 2026-09-22, R32 + R33).
 *
 * Claude Code discovers a skill only as `skills/<name>/SKILL.md`. Its skills
 * documentation lists personal, project, nested, managed and `--add-dir`
 * `.claude/skills/` directories, plugin and synced skills, and legacy
 * `.claude/commands/` files — no `.agents/skills/` location and no flat-file form —
 * and the loader it ships reads `<skills>/<entry>/SKILL.md` for each entry. Two
 * consequences, both pinned here against an installed tree:
 *
 *   - a --unified-skills install sweeps the nested /pan:<name> commands, so it must
 *     give Claude its own copy of every compiled skill, or Claude is left with no
 *     PAN commands at all while the installer prints "run /pan:new-project" (R32);
 *   - the flat skills/pan-*.md shims earlier installs wrote were never loaded, so
 *     no install writes them any more (R33; the default-install side is pinned in
 *     tests/claude-install.test.cjs).
 *
 * Replaces the E-5 scenario, which asserted the never-loaded shims existed.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installInto, cleanup, createScenarioRunner } = require('../helpers.cjs');

const SOURCE_COMMANDS = path.join(__dirname, '..', '..', 'commands', 'pan');

const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const panDirs = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('pan-')).map((e) => e.name).sort()
  : []);
const panFlatFiles = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.startsWith('pan-') && f.endsWith('.md'))
  : []);

function freshDir(label) {
  // realpath: os.tmpdir() is a symlink on macOS and the installer records the resolved path.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `pan-claude-skills-${label}-`)));
}

function install(dir, flags) {
  const r = installInto(dir, flags);
  if (!r.success) throw new Error(`install ${flags.join(' ')} failed: ${r.error || r.output}`);
  return stripAnsi(r.output);
}

describe('a --unified-skills install gives Claude Code its own copy of every skill (R32)', () => {
  let dir;
  let output;
  before(() => {
    dir = freshDir('unified');
    output = install(dir, ['--claude', '--local', '--unified-skills', '--skip-warnings']);
  });
  after(() => { if (dir) cleanup(dir); });

  test('every shared skill has a Claude copy, and every copy is byte-identical to it', () => {
    const shared = panDirs(path.join(dir, '.agents', 'skills'));
    const claude = panDirs(path.join(dir, '.claude', 'skills'));
    assert.ok(shared.length > 0, 'precondition: the shared tree must be populated, or the comparison below is vacuous');
    assert.deepEqual(claude, shared, 'the Claude copy must hold exactly the shared tree\'s skills');
    for (const name of shared) {
      const a = fs.readFileSync(path.join(dir, '.agents', 'skills', name, 'SKILL.md'));
      const b = fs.readFileSync(path.join(dir, '.claude', 'skills', name, 'SKILL.md'));
      assert.equal(Buffer.compare(a, b), 0, `${name}: the Claude copy differs from the shared skill`);
    }
  });

  test('one Claude skill per shipped command', () => {
    const commands = fs.readdirSync(SOURCE_COMMANDS).filter((f) => f.endsWith('.md')).map((f) => `pan-${f.slice(0, -3)}`).sort();
    assert.deepEqual(panDirs(path.join(dir, '.claude', 'skills')), commands);
  });

  test('the nested commands are swept and no flat shim is written', () => {
    assert.equal(fs.existsSync(path.join(dir, '.claude', 'commands', 'pan')), false, 'commands/pan must be swept so nothing resolves twice');
    assert.deepEqual(panFlatFiles(path.join(dir, '.claude', 'skills')), [], 'no flat skills/pan-*.md shim may be written');
  });

  test('the manifest tracks every Claude copy, so verify and patch backup can see it', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'pan-file-manifest.json'), 'utf8'));
    for (const name of panDirs(path.join(dir, '.claude', 'skills'))) {
      assert.ok(manifest.files[`skills/${name}/SKILL.md`], `manifest should track skills/${name}/SKILL.md`);
    }
  });

  test('the closing message names the hyphenated skill Claude now has, not the swept command', () => {
    assert.match(output, /Mirrored \d+ unified skills to skills\/ \(Claude Code does not read \.agents\/skills\/\)/);
    assert.match(output, /Open a blank directory in Claude Code and run \/pan-new-project\./);
    assert.doesNotMatch(output, /\/pan:new-project/, 'the colon form was swept and must not be advertised');
  });
});

describe('reinstalling without --unified-skills removes the Claude copies', () => {
  let dir;
  before(() => {
    dir = freshDir('switch-back');
    install(dir, ['--claude', '--local', '--unified-skills', '--skip-warnings']);
    install(dir, ['--claude', '--local', '--skip-warnings']);
  });
  after(() => { if (dir) cleanup(dir); });

  test('the nested commands are back and no PAN skill copy remains to resolve twice', () => {
    assert.equal(fs.existsSync(path.join(dir, '.claude', 'commands', 'pan', 'new-project.md')), true, 'the default install restores commands/pan');
    assert.deepEqual(panDirs(path.join(dir, '.claude', 'skills')), [], '/pan-<name> copies left beside /pan:<name> would list every command twice');
  });
});

describe('uninstalling a --unified-skills Claude install removes the Claude copies', () => {
  let dir;
  before(() => {
    dir = freshDir('uninstall');
    install(dir, ['--claude', '--local', '--unified-skills', '--skip-warnings']);
    fs.mkdirSync(path.join(dir, '.claude', 'skills', 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\n');
    install(dir, ['--claude', '--local', '--uninstall']);
  });
  after(() => { if (dir) cleanup(dir); });

  test('no PAN skill directory remains, and the user skill beside them survives', () => {
    assert.deepEqual(panDirs(path.join(dir, '.claude', 'skills')), []);
    assert.equal(fs.existsSync(path.join(dir, '.claude', 'skills', 'my-skill', 'SKILL.md')), true, 'a non-PAN skill must survive');
  });
});

describe('Copilot keeps its own skills pipeline (moved from the retired E-5 scenario)', () => {
  let runner;
  before(() => { runner = createScenarioRunner('copilot'); });
  after(() => { runner.cleanup(); });

  test('copilot installs one SKILL.md directory per command under .github/skills', () => {
    const skillsDir = path.join(runner.tmpDir, '.github', 'skills');
    const dirs = panDirs(skillsDir);
    const commands = fs.readdirSync(SOURCE_COMMANDS).filter((f) => f.endsWith('.md')).map((f) => `pan-${f.slice(0, -3)}`).sort();
    assert.deepEqual(dirs, commands, 'one skill directory per shipped command');
    for (const name of dirs) {
      assert.equal(fs.existsSync(path.join(skillsDir, name, 'SKILL.md')), true, `${name}/SKILL.md should exist`);
    }
  });
});
