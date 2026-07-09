// Tests for Gemini CLI runtime support in the installer.
// Tests the Gemini CLI installation flow: commands/pan/ structure,
// /pan: prefix preserved, agents, hooks, pan-wizard-core, uninstall.

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

// ── Group 1: Gemini Install Structure ──────────────────

describe('Gemini: install structure', () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gemini-'));
    runInstaller('--gemini --local');
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('.gemini directory exists (local install path)', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.gemini')), '.gemini dir should exist');
  });

  test('commands/pan directory has .toml files', () => {
    const commandsDir = path.join(tempDir, '.gemini', 'commands', 'pan');
    assert.ok(fs.existsSync(commandsDir), 'commands/pan dir should exist');
    const tomlFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.toml'));
    assert.ok(tomlFiles.length >= 30, `should have 30+ command files, got ${tomlFiles.length}`);
  });

  test('command content uses .gemini paths (not .claude)', () => {
    const commandsDir = path.join(tempDir, '.gemini', 'commands', 'pan');
    const tomlFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.toml'));
    for (const file of tomlFiles.slice(0, 5)) {
      const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
      const localClaudeRefs = (content.match(/\.\/\.claude\//g) || []).length;
      assert.strictEqual(localClaudeRefs, 0,
        `${file} should not have ./.claude/ local references`);
    }
  });

  test('agents directory has .md files', () => {
    const agentsDir = path.join(tempDir, '.gemini', 'agents');
    assert.ok(fs.existsSync(agentsDir), 'agents dir should exist');
    const mdFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
    assert.ok(mdFiles.length >= 10, `should have 10+ agent files, got ${mdFiles.length}`);
  });

  test('pan-wizard-core is installed', () => {
    const panDir = path.join(tempDir, '.gemini', 'pan-wizard-core');
    assert.ok(fs.existsSync(panDir), 'pan-wizard-core dir should exist');
  });

  test('pan-tools.cjs exists', () => {
    const toolsPath = path.join(tempDir, '.gemini', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    assert.ok(fs.existsSync(toolsPath), 'pan-tools.cjs should exist');
  });

  test('core lib modules are installed', () => {
    const libDir = path.join(tempDir, '.gemini', 'pan-wizard-core', 'bin', 'lib');
    const expectedModules = ['core.cjs', 'state.cjs', 'phase.cjs', 'config.cjs', 'constants.cjs'];
    for (const mod of expectedModules) {
      assert.ok(fs.existsSync(path.join(libDir, mod)), `${mod} should be installed`);
    }
  });

  test('hooks directory has .js files', () => {
    const hooksDir = path.join(tempDir, '.gemini', 'hooks');
    assert.ok(fs.existsSync(hooksDir), 'hooks dir should exist');
    const jsFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js'));
    assert.ok(jsFiles.length >= 1, `should have 1+ hook files, got ${jsFiles.length}`);
  });

  test('manifest file exists with version', () => {
    const manifestPath = path.join(tempDir, '.gemini', 'pan-file-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest should exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.version, PKG_VERSION, `manifest version should match ${PKG_VERSION}`);
  });

  test('manifest tracks hooks with hashes', () => {
    const manifestPath = path.join(tempDir, '.gemini', 'pan-file-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const hookEntries = Object.keys(manifest.files).filter(k => k.startsWith('hooks/'));
    assert.ok(hookEntries.length >= 1, `manifest should track hook files, got ${hookEntries.length}`);
    for (const entry of hookEntries) {
      assert.match(manifest.files[entry], /^[a-f0-9]{64}$/, `${entry} should have SHA256 hash`);
    }
  });

  test('settings.json exists with PAN config', () => {
    const settingsPath = path.join(tempDir, '.gemini', 'settings.json');
    assert.ok(fs.existsSync(settingsPath), 'settings.json should exist');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.env || settings.customInstructions || settings.hooks,
      'settings.json should have PAN configuration');
  });

  test('workflows directory exists', () => {
    const workflowsDir = path.join(tempDir, '.gemini', 'pan-wizard-core', 'workflows');
    assert.ok(fs.existsSync(workflowsDir), 'workflows dir should exist');
    const mdFiles = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md'));
    assert.ok(mdFiles.length >= 10, `should have 10+ workflow files, got ${mdFiles.length}`);
  });

  test('templates directory exists', () => {
    const templatesDir = path.join(tempDir, '.gemini', 'pan-wizard-core', 'templates');
    assert.ok(fs.existsSync(templatesDir), 'templates dir should exist');
  });

  test('references directory exists', () => {
    const refsDir = path.join(tempDir, '.gemini', 'pan-wizard-core', 'references');
    assert.ok(fs.existsSync(refsDir), 'references dir should exist');
  });
});

// ── Group 2: Gemini TOML Syntax Validation ──────────────────

describe('Gemini: TOML syntax validation', () => {
  // Reuse the install from Group 1 by creating a separate install
  let tomlDir;

  before(() => {
    tomlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gemini-toml-'));
    execSync(`node "${INSTALLER}" --gemini --local`, {
      cwd: tomlDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  after(() => {
    if (tomlDir && fs.existsSync(tomlDir)) {
      fs.rmSync(tomlDir, { recursive: true, force: true });
    }
  });

  test('all .toml files have prompt = "..." key-value pair', () => {
    const commandsDir = path.join(tomlDir, '.gemini', 'commands', 'pan');
    const tomlFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.toml'));
    for (const file of tomlFiles) {
      const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
      assert.match(content, /^prompt\s*=\s*"/m,
        `${file} should have a prompt = "..." line`);
    }
  });

  test('all .toml files have valid key = value format', () => {
    const commandsDir = path.join(tomlDir, '.gemini', 'commands', 'pan');
    const tomlFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.toml'));
    for (const file of tomlFiles) {
      const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      for (const line of lines) {
        // Each non-empty line should be key = value (TOML format)
        assert.match(line, /^\w+\s*=\s*.+/,
          `${file}: line should be key = value, got: ${line.slice(0, 60)}`);
      }
    }
  });

  test('no markdown frontmatter leaking into .toml files', () => {
    const commandsDir = path.join(tomlDir, '.gemini', 'commands', 'pan');
    const tomlFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.toml'));
    for (const file of tomlFiles) {
      const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
      assert.ok(!content.startsWith('---'),
        `${file} should not start with --- (markdown frontmatter)`);
    }
  });

  test('prompt values are properly quoted strings', () => {
    const commandsDir = path.join(tomlDir, '.gemini', 'commands', 'pan');
    const tomlFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.toml'));
    for (const file of tomlFiles) {
      const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
      const promptMatch = content.match(/^prompt\s*=\s*(".*")\s*$/m);
      assert.ok(promptMatch, `${file} should have prompt = "..." with quoted string`);
      // Verify it's valid JSON string (JSON.stringify format)
      assert.doesNotThrow(() => JSON.parse(promptMatch[1]),
        `${file}: prompt value should be a valid JSON-quoted string`);
    }
  });

  test('description values (when present) are properly quoted', () => {
    const commandsDir = path.join(tomlDir, '.gemini', 'commands', 'pan');
    const tomlFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.toml'));
    let foundDescription = false;
    for (const file of tomlFiles) {
      const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
      const descMatch = content.match(/^description\s*=\s*(".*")\s*$/m);
      if (descMatch) {
        foundDescription = true;
        assert.doesNotThrow(() => JSON.parse(descMatch[1]),
          `${file}: description value should be a valid JSON-quoted string`);
      }
    }
    assert.ok(foundDescription, 'at least some .toml files should have descriptions');
  });
});

// ── Group 3: Gemini Uninstall ──────────────────

describe('Gemini: uninstall', () => {
  let uninstallDir;

  before(() => {
    uninstallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gemini-uninstall-'));
    // Install first
    execSync(`node "${INSTALLER}" --gemini --local`, {
      cwd: uninstallDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Then uninstall
    execSync(`node "${INSTALLER}" --gemini --local --uninstall`, {
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

  test('commands/pan directory is removed after uninstall', () => {
    const commandsDir = path.join(uninstallDir, '.gemini', 'commands', 'pan');
    assert.ok(!fs.existsSync(commandsDir), 'commands/pan should be removed');
  });

  test('agents are removed after uninstall', () => {
    const agentsDir = path.join(uninstallDir, '.gemini', 'agents');
    if (fs.existsSync(agentsDir)) {
      const panFiles = fs.readdirSync(agentsDir).filter(f => f.startsWith('pan-'));
      assert.strictEqual(panFiles.length, 0, 'pan- agent files should be removed');
    }
  });

  test('pan-wizard-core is removed after uninstall', () => {
    const panDir = path.join(uninstallDir, '.gemini', 'pan-wizard-core');
    assert.ok(!fs.existsSync(panDir), 'pan-wizard-core should be removed');
  });

  test('hooks are removed after uninstall', () => {
    const hooksDir = path.join(uninstallDir, '.gemini', 'hooks');
    if (fs.existsSync(hooksDir)) {
      const panFiles = fs.readdirSync(hooksDir).filter(f => f.startsWith('pan-'));
      assert.strictEqual(panFiles.length, 0, 'pan- hook files should be removed');
    }
  });

  test('manifest removed after uninstall', () => {
    const manifestPath = path.join(uninstallDir, '.gemini', 'pan-file-manifest.json');
    assert.ok(!fs.existsSync(manifestPath), 'manifest should be removed');
  });
});
