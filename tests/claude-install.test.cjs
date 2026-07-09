// Tests for Claude Code runtime install + uninstall.
// Regression: uninstaller must clean up skills/pan-*.md shim files
// (bug: prior versions only removed commands/pan/ and left skills/ orphaned).

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(PROJECT_ROOT, 'bin', 'install.js');

function runInstaller(flags, cwd) {
  return execSync(`node "${INSTALLER}" ${flags}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ─── Install structure ─────────────────────────────────────────────────────────

describe('Claude: install structure', () => {
  let tempDir;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-claude-install-'));
    runInstaller('--claude --local', tempDir);
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('.claude directory exists', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.claude')), '.claude dir should exist');
  });

  test('commands/pan has command .md files', () => {
    const commandsDir = path.join(tempDir, '.claude', 'commands', 'pan');
    assert.ok(fs.existsSync(commandsDir), 'commands/pan dir should exist');
    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    assert.ok(files.length >= 30, `should have 30+ command files, got ${files.length}`);
  });

  test('skills/ has pan-*.md shim files (one per command)', () => {
    const skillsDir = path.join(tempDir, '.claude', 'skills');
    assert.ok(fs.existsSync(skillsDir), 'skills dir should exist');
    const shims = fs.readdirSync(skillsDir).filter(f => f.startsWith('pan-') && f.endsWith('.md'));
    assert.ok(shims.length >= 30, `should have 30+ skill shims, got ${shims.length}`);
  });

  test('skill shim count matches command count', () => {
    const commandsDir = path.join(tempDir, '.claude', 'commands', 'pan');
    const skillsDir = path.join(tempDir, '.claude', 'skills');
    const commands = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    const shims = fs.readdirSync(skillsDir).filter(f => f.startsWith('pan-') && f.endsWith('.md'));
    assert.equal(shims.length, commands.length, 'one shim per command');
  });

  test('pan-wizard-core is installed', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.claude', 'pan-wizard-core')));
  });

  // Native Claude Code workflows (2026-06): deterministic orchestration
  // scripts in .claude/workflows/ — Claude-only surface.
  test('native workflows are installed with valid meta headers', () => {
    const workflowsDir = path.join(tempDir, '.claude', 'workflows');
    assert.ok(fs.existsSync(workflowsDir), 'workflows dir should exist');
    const scripts = fs.readdirSync(workflowsDir).filter(f => f.startsWith('pan-') && f.endsWith('.js'));
    assert.ok(scripts.length >= 2, `should have 2+ native workflows, got ${scripts.length}`);
    for (const script of scripts) {
      const content = fs.readFileSync(path.join(workflowsDir, script), 'utf8');
      assert.ok(content.startsWith('export const meta = {'), `${script} must begin with export const meta`);
      assert.match(content, /name: 'pan-[a-z-]+'/, `${script} meta must carry a pan-* name`);
    }
  });

  test('native workflows are tracked in the manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(tempDir, '.claude', 'pan-file-manifest.json'), 'utf8'));
    const wfKeys = Object.keys(manifest.files).filter(k => k.startsWith('workflows/pan-'));
    assert.ok(wfKeys.length >= 2, `manifest should track the native workflows, got ${wfKeys.length}`);
  });

  test('agents are installed', () => {
    const agentsDir = path.join(tempDir, '.claude', 'agents');
    assert.ok(fs.existsSync(agentsDir));
    const panAgents = fs.readdirSync(agentsDir).filter(f => f.startsWith('pan-'));
    assert.ok(panAgents.length >= 10, `should have 10+ pan- agents, got ${panAgents.length}`);
  });

  test('hooks are installed', () => {
    const hooksDir = path.join(tempDir, '.claude', 'hooks');
    assert.ok(fs.existsSync(hooksDir));
  });

  test('manifest is written', () => {
    const manifestPath = path.join(tempDir, '.claude', 'pan-file-manifest.json');
    assert.ok(fs.existsSync(manifestPath));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.version);
    assert.ok(Object.keys(manifest.files).length > 100);
  });
});

// ─── Uninstall cleanup — including skills/ regression test ────────────────────

describe('Claude: uninstall', () => {
  let uninstallDir;

  before(() => {
    uninstallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-claude-uninstall-'));
    runInstaller('--claude --local', uninstallDir);
    runInstaller('--claude --local --uninstall', uninstallDir);
  });

  after(() => {
    if (uninstallDir && fs.existsSync(uninstallDir)) {
      fs.rmSync(uninstallDir, { recursive: true, force: true });
    }
  });

  test('commands/pan directory is removed', () => {
    const commandsDir = path.join(uninstallDir, '.claude', 'commands', 'pan');
    assert.ok(!fs.existsSync(commandsDir), 'commands/pan should be removed');
  });

  test('pan-wizard-core is removed', () => {
    const panDir = path.join(uninstallDir, '.claude', 'pan-wizard-core');
    assert.ok(!fs.existsSync(panDir), 'pan-wizard-core should be removed');
  });

  test('pan- agents are removed', () => {
    const agentsDir = path.join(uninstallDir, '.claude', 'agents');
    if (fs.existsSync(agentsDir)) {
      const panFiles = fs.readdirSync(agentsDir).filter(f => f.startsWith('pan-'));
      assert.equal(panFiles.length, 0, 'pan- agent files should be removed');
    }
  });

  test('pan- hooks are removed', () => {
    const hooksDir = path.join(uninstallDir, '.claude', 'hooks');
    if (fs.existsSync(hooksDir)) {
      const panFiles = fs.readdirSync(hooksDir).filter(f => f.startsWith('pan-'));
      assert.equal(panFiles.length, 0, 'pan- hook files should be removed');
    }
  });

  test('manifest is removed', () => {
    const manifestPath = path.join(uninstallDir, '.claude', 'pan-file-manifest.json');
    assert.ok(!fs.existsSync(manifestPath), 'manifest should be removed');
  });

  // Regression: previously, skills/pan-*.md shims were left behind after uninstall
  test('REGRESSION: skills/pan-*.md shim files are removed', () => {
    const skillsDir = path.join(uninstallDir, '.claude', 'skills');
    if (fs.existsSync(skillsDir)) {
      const shims = fs.readdirSync(skillsDir).filter(f => f.startsWith('pan-') && f.endsWith('.md'));
      assert.equal(shims.length, 0, 'all pan- skill shims should be removed');
    }
  });

  // Found by the 2026-06-11 e2e teardown pass: SessionStart/PostToolUse were
  // stripped on uninstall but the v3.4+/v3.5+ SubagentStop loggers were not,
  // leaving dangling hook commands pointing at deleted scripts.
  test('REGRESSION: SubagentStop logger hooks are removed from settings.json', () => {
    const settingsPath = path.join(uninstallDir, '.claude', 'settings.json');
    if (!fs.existsSync(settingsPath)) return; // settings removed entirely — fine
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const flat = JSON.stringify(settings.hooks || {});
    assert.ok(!flat.includes('pan-cost-logger'), 'cost logger must be stripped');
    assert.ok(!flat.includes('pan-trace-logger'), 'trace logger must be stripped');
  });

  test('native workflows are removed after uninstall', () => {
    const workflowsDir = path.join(uninstallDir, '.claude', 'workflows');
    if (fs.existsSync(workflowsDir)) {
      const scripts = fs.readdirSync(workflowsDir).filter(f => f.startsWith('pan-') && f.endsWith('.js'));
      assert.equal(scripts.length, 0, 'all pan- native workflows should be removed');
    }
  });

  test('REGRESSION: empty skills/ directory is removed', () => {
    const skillsDir = path.join(uninstallDir, '.claude', 'skills');
    assert.ok(!fs.existsSync(skillsDir), 'empty skills/ dir should be removed');
  });
});

// ─── Uninstall preserves user skills ─────────────────────────────────────────

describe('Claude: uninstall preserves non-PAN skills', () => {
  let preserveDir;

  before(() => {
    preserveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-claude-preserve-'));
    runInstaller('--claude --local', preserveDir);
    // Add a user-owned skill shim (not starting with pan-)
    const userSkill = path.join(preserveDir, '.claude', 'skills', 'my-custom-skill.md');
    fs.writeFileSync(userSkill, '# My custom skill\n');
    runInstaller('--claude --local --uninstall', preserveDir);
  });

  after(() => {
    if (preserveDir && fs.existsSync(preserveDir)) {
      fs.rmSync(preserveDir, { recursive: true, force: true });
    }
  });

  test('user-owned skill (non-pan-*) survives uninstall', () => {
    const userSkill = path.join(preserveDir, '.claude', 'skills', 'my-custom-skill.md');
    assert.ok(fs.existsSync(userSkill), 'non-pan- skill should be preserved');
  });

  test('skills/ dir is preserved when non-PAN skills remain', () => {
    const skillsDir = path.join(preserveDir, '.claude', 'skills');
    assert.ok(fs.existsSync(skillsDir), 'skills/ dir should remain when user skills exist');
  });

  test('pan- shims are still removed (user skills untouched)', () => {
    const skillsDir = path.join(preserveDir, '.claude', 'skills');
    const panShims = fs.readdirSync(skillsDir).filter(f => f.startsWith('pan-') && f.endsWith('.md'));
    assert.equal(panShims.length, 0, 'pan- shims should all be removed');
  });
});
