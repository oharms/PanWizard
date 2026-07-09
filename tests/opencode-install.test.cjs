// Tests for OpenCode runtime support in the installer.
// Tests the OpenCode installation flow: flat command structure,
// /pan- prefix, agents, hooks, pan-wizard-core, uninstall.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Paths
const PROJECT_ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(PROJECT_ROOT, 'bin', 'install.js');
const PKG_VERSION = require(path.join(PROJECT_ROOT, 'package.json')).version;

// Shared temp directory
let tempDir;

function runInstaller(flags) {
  return execSync(`node "${INSTALLER}" ${flags}`, {
    cwd: tempDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ── Group 1: OpenCode Install Structure ──────────────────

describe('OpenCode: install structure', () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-opencode-'));
    runInstaller('--opencode --local');
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('.opencode directory exists (local install path)', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.opencode')), '.opencode dir should exist');
  });

  test('command directory has flat .md files (not commands/pan/)', () => {
    const commandDir = path.join(tempDir, '.opencode', 'commands');
    assert.ok(fs.existsSync(commandDir), 'command dir should exist');
    const mdFiles = fs.readdirSync(commandDir).filter(f => f.endsWith('.md'));
    assert.ok(mdFiles.length >= 30, `should have 30+ command files, got ${mdFiles.length}`);
  });

  test('command files use pan- prefix (not pan:)', () => {
    const commandDir = path.join(tempDir, '.opencode', 'commands');
    const mdFiles = fs.readdirSync(commandDir).filter(f => f.endsWith('.md') && f.startsWith('pan-'));
    assert.ok(mdFiles.length >= 30, `should have 30+ pan- prefixed files, got ${mdFiles.length}`);
  });

  test('command content uses /pan- references (not /pan:)', () => {
    const commandDir = path.join(tempDir, '.opencode', 'commands');
    const mdFiles = fs.readdirSync(commandDir).filter(f => f.endsWith('.md'));
    // Check a few files for correct prefix
    for (const file of mdFiles.slice(0, 5)) {
      const content = fs.readFileSync(path.join(commandDir, file), 'utf8');
      const claudeRefs = content.match(/\/pan:[a-z0-9-]+/gi) || [];
      assert.strictEqual(claudeRefs.length, 0,
        `${file} should not have /pan: references, found: ${claudeRefs.join(', ')}`);
    }
  });

  test('command content references ~/.config/opencode (not ~/.claude)', () => {
    const commandDir = path.join(tempDir, '.opencode', 'commands');
    const mdFiles = fs.readdirSync(commandDir).filter(f => f.endsWith('.md'));
    for (const file of mdFiles.slice(0, 5)) {
      const content = fs.readFileSync(path.join(commandDir, file), 'utf8');
      const claudePathRefs = (content.match(/~\/\.claude\b/g) || []).length;
      // Some commands may not reference paths at all, which is fine
      // Only fail if file has ~/.claude refs AND doesn't reference ~/.config/opencode
      assert.ok(
        content.includes('~/.config/opencode') || claudePathRefs === 0,
        `${file} has ${claudePathRefs} ~/.claude references that should be ~/.config/opencode`
      );
    }
  });

  test('agents directory has .md files', () => {
    const agentsDir = path.join(tempDir, '.opencode', 'agents');
    assert.ok(fs.existsSync(agentsDir), 'agents dir should exist');
    const mdFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
    assert.ok(mdFiles.length >= 10, `should have 10+ agent files, got ${mdFiles.length}`);
  });

  test('pan-wizard-core is installed', () => {
    const panDir = path.join(tempDir, '.opencode', 'pan-wizard-core');
    assert.ok(fs.existsSync(panDir), 'pan-wizard-core dir should exist');
  });

  test('pan-tools.cjs exists', () => {
    const toolsPath = path.join(tempDir, '.opencode', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    assert.ok(fs.existsSync(toolsPath), 'pan-tools.cjs should exist');
  });

  test('core lib modules are installed', () => {
    const libDir = path.join(tempDir, '.opencode', 'pan-wizard-core', 'bin', 'lib');
    const expectedModules = ['core.cjs', 'state.cjs', 'phase.cjs', 'config.cjs', 'constants.cjs'];
    for (const mod of expectedModules) {
      assert.ok(fs.existsSync(path.join(libDir, mod)), `${mod} should be installed`);
    }
  });

  test('hooks directory does NOT exist (OpenCode has no hook support)', () => {
    const hooksDir = path.join(tempDir, '.opencode', 'hooks');
    assert.ok(!fs.existsSync(hooksDir), 'hooks dir should NOT exist for OpenCode');
  });

  test('manifest file exists with version', () => {
    const manifestPath = path.join(tempDir, '.opencode', 'pan-file-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest should exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.version, PKG_VERSION, `manifest version should match ${PKG_VERSION}`);
  });

  test('workflows directory exists', () => {
    const workflowsDir = path.join(tempDir, '.opencode', 'pan-wizard-core', 'workflows');
    assert.ok(fs.existsSync(workflowsDir), 'workflows dir should exist');
    const mdFiles = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md'));
    assert.ok(mdFiles.length >= 10, `should have 10+ workflow files, got ${mdFiles.length}`);
  });

  test('templates directory exists', () => {
    const templatesDir = path.join(tempDir, '.opencode', 'pan-wizard-core', 'templates');
    assert.ok(fs.existsSync(templatesDir), 'templates dir should exist');
  });

  test('references directory exists', () => {
    const refsDir = path.join(tempDir, '.opencode', 'pan-wizard-core', 'references');
    assert.ok(fs.existsSync(refsDir), 'references dir should exist');
  });
});

// ── Group 2: OpenCode Uninstall ──────────────────

describe('OpenCode: uninstall', () => {
  let uninstallDir;

  before(() => {
    uninstallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-opencode-uninstall-'));
    // Install first
    execSync(`node "${INSTALLER}" --opencode --local`, {
      cwd: uninstallDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Then uninstall
    execSync(`node "${INSTALLER}" --opencode --local --uninstall`, {
      cwd: uninstallDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  after(() => {
    if (uninstallDir && fs.existsSync(uninstallDir)) {
      fs.rmSync(uninstallDir, { recursive: true, force: true });
    }
  });

  test('command directory is removed after uninstall', () => {
    const commandDir = path.join(uninstallDir, '.opencode', 'commands');
    // Either directory doesn't exist or is empty of pan- files
    if (fs.existsSync(commandDir)) {
      const panFiles = fs.readdirSync(commandDir).filter(f => f.startsWith('pan-'));
      assert.strictEqual(panFiles.length, 0, 'pan- command files should be removed');
    }
  });

  test('agents are removed after uninstall', () => {
    const agentsDir = path.join(uninstallDir, '.opencode', 'agents');
    if (fs.existsSync(agentsDir)) {
      const panFiles = fs.readdirSync(agentsDir).filter(f => f.startsWith('pan-'));
      assert.strictEqual(panFiles.length, 0, 'pan- agent files should be removed');
    }
  });

  test('pan-wizard-core is removed after uninstall', () => {
    const panDir = path.join(uninstallDir, '.opencode', 'pan-wizard-core');
    assert.ok(!fs.existsSync(panDir), 'pan-wizard-core should be removed');
  });

  test('hooks are removed after uninstall', () => {
    const hooksDir = path.join(uninstallDir, '.opencode', 'hooks');
    if (fs.existsSync(hooksDir)) {
      const panFiles = fs.readdirSync(hooksDir).filter(f => f.startsWith('pan-'));
      assert.strictEqual(panFiles.length, 0, 'pan- hook files should be removed');
    }
  });

  test('manifest removed after uninstall', () => {
    const manifestPath = path.join(uninstallDir, '.opencode', 'pan-file-manifest.json');
    assert.ok(!fs.existsSync(manifestPath), 'manifest should be removed');
  });
});
