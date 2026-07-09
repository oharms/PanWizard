// Tests for Codex CLI runtime support in the installer.
// Tests the Codex CLI installation flow: skills/ structure,
// $pan- prefix, agents, hooks, pan-wizard-core, uninstall.

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

// ── Group 1: Codex Install Structure ──────────────────

describe('Codex: install structure', () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-codex-'));
    runInstaller('--codex --local');
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('.codex directory exists (local install path)', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.codex')), '.codex dir should exist');
  });

  test('skills directory has pan-* skill directories', () => {
    const skillsDir = path.join(tempDir, '.agents', 'skills');
    assert.ok(fs.existsSync(skillsDir), 'skills dir should exist');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('pan-'));
    assert.ok(skillDirs.length >= 30, `should have 30+ skill dirs, got ${skillDirs.length}`);
  });

  test('each skill directory has SKILL.md', () => {
    const skillsDir = path.join(tempDir, '.agents', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('pan-'));
    for (const dir of skillDirs.slice(0, 5)) {
      const skillPath = path.join(skillsDir, dir.name, 'SKILL.md');
      assert.ok(fs.existsSync(skillPath), `${dir.name}/SKILL.md should exist`);
    }
  });

  test('skill content uses $pan- prefix (not /pan: or /pan-)', () => {
    const skillsDir = path.join(tempDir, '.agents', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('pan-'));
    for (const dir of skillDirs.slice(0, 5)) {
      const content = fs.readFileSync(path.join(skillsDir, dir.name, 'SKILL.md'), 'utf8');
      const claudeRefs = content.match(/\/pan:[a-z0-9-]+/gi) || [];
      assert.strictEqual(claudeRefs.length, 0,
        `${dir.name}/SKILL.md should not have /pan: references, found: ${claudeRefs.join(', ')}`);
    }
  });

  test('skill content references .codex paths (not .claude)', () => {
    const skillsDir = path.join(tempDir, '.agents', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('pan-'));
    for (const dir of skillDirs.slice(0, 5)) {
      const content = fs.readFileSync(path.join(skillsDir, dir.name, 'SKILL.md'), 'utf8');
      const localClaudeRefs = (content.match(/\.\/\.claude\//g) || []).length;
      assert.strictEqual(localClaudeRefs, 0,
        `${dir.name}/SKILL.md should not have ./.claude/ local references`);
    }
  });

  test('agents directory has standalone .toml files (2026-06 Codex format)', () => {
    const agentsDir = path.join(tempDir, '.codex', 'agents');
    assert.ok(fs.existsSync(agentsDir), 'agents dir should exist');
    const tomlFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.toml'));
    assert.ok(tomlFiles.length >= 10, `should have 10+ agent TOML files, got ${tomlFiles.length}`);
    const mdFiles = fs.readdirSync(agentsDir).filter(f => f.startsWith('pan-') && f.endsWith('.md'));
    assert.equal(mdFiles.length, 0, 'no legacy pan-*.md agent files should remain');
  });

  test('agent TOML has required fields and effort mapping', () => {
    const agentsDir = path.join(tempDir, '.codex', 'agents');
    const planner = fs.readFileSync(path.join(agentsDir, 'pan-planner.toml'), 'utf8');
    assert.match(planner, /^name = "pan-planner"$/m);
    assert.match(planner, /^description = /m);
    assert.match(planner, /^developer_instructions = """$/m);
    // pan-planner declares effort: xhigh → model_reasoning_effort
    assert.match(planner, /^model_reasoning_effort = "xhigh"$/m);
  });

  test('pan-wizard-core is installed', () => {
    const panDir = path.join(tempDir, '.codex', 'pan-wizard-core');
    assert.ok(fs.existsSync(panDir), 'pan-wizard-core dir should exist');
  });

  // Codex hooks (2026-06): .codex/hooks.json with Claude-compatible
  // PascalCase events; hook scripts in .codex/hooks/.
  test('hooks.json registers all four PAN hooks', () => {
    const hooksJsonPath = path.join(tempDir, '.codex', 'hooks.json');
    assert.ok(fs.existsSync(hooksJsonPath), '.codex/hooks.json should exist');
    const config = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
    const flat = JSON.stringify(config.hooks);
    for (const marker of ['pan-check-update', 'pan-context-monitor', 'pan-cost-logger', 'pan-trace-logger']) {
      assert.ok(flat.includes(marker), `hooks.json should register ${marker}`);
    }
    assert.ok(config.hooks.SessionStart, 'SessionStart (PascalCase) should exist');
    assert.ok(config.hooks.SubagentStop, 'SubagentStop (PascalCase) should exist');
  });

  test('hook scripts are installed to .codex/hooks/', () => {
    const hooksDir = path.join(tempDir, '.codex', 'hooks');
    assert.ok(fs.existsSync(hooksDir), 'hooks dir should exist');
    const jsFiles = fs.readdirSync(hooksDir).filter(f => f.startsWith('pan-') && f.endsWith('.js'));
    assert.ok(jsFiles.length >= 4, `should have 4+ hook scripts, got ${jsFiles.length}`);
  });

  test('pan-tools.cjs exists', () => {
    const toolsPath = path.join(tempDir, '.codex', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    assert.ok(fs.existsSync(toolsPath), 'pan-tools.cjs should exist');
  });

  test('core lib modules are installed', () => {
    const libDir = path.join(tempDir, '.codex', 'pan-wizard-core', 'bin', 'lib');
    const expectedModules = ['core.cjs', 'state.cjs', 'phase.cjs', 'config.cjs', 'constants.cjs'];
    for (const mod of expectedModules) {
      assert.ok(fs.existsSync(path.join(libDir, mod)), `${mod} should be installed`);
    }
  });

  // (Codex hooks shipped 2026-06 — positive coverage lives in the
  // 'hooks.json registers all four PAN hooks' tests above.)

  test('manifest file exists with version', () => {
    const manifestPath = path.join(tempDir, '.codex', 'pan-file-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest should exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.version, PKG_VERSION, `manifest version should match ${PKG_VERSION}`);
  });

  test('workflows directory exists', () => {
    const workflowsDir = path.join(tempDir, '.codex', 'pan-wizard-core', 'workflows');
    assert.ok(fs.existsSync(workflowsDir), 'workflows dir should exist');
    const mdFiles = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md'));
    assert.ok(mdFiles.length >= 10, `should have 10+ workflow files, got ${mdFiles.length}`);
  });

  test('templates directory exists', () => {
    const templatesDir = path.join(tempDir, '.codex', 'pan-wizard-core', 'templates');
    assert.ok(fs.existsSync(templatesDir), 'templates dir should exist');
  });

  test('references directory exists', () => {
    const refsDir = path.join(tempDir, '.codex', 'pan-wizard-core', 'references');
    assert.ok(fs.existsSync(refsDir), 'references dir should exist');
  });

  // Regression: Codex executes commands literally; bare `pan-tools X`
  // fails because there's no `pan-tools` binary on PATH.
  test('REGRESSION: bare `pan-tools X` invocations replaced with node path', () => {
    const skillsDir = path.join(tempDir, '.agents', 'skills');
    const focusAutoSkill = path.join(skillsDir, 'pan-focus-auto', 'SKILL.md');
    assert.ok(fs.existsSync(focusAutoSkill), 'pan-focus-auto skill should exist');
    const content = fs.readFileSync(focusAutoSkill, 'utf8');
    const bareInvocations = content.match(/`pan-tools\s+[a-z]/g);
    assert.equal(bareInvocations, null, 'no bare `pan-tools X` invocations should remain after install');
    assert.ok(
      content.includes('node ./.codex/pan-wizard-core/bin/pan-tools.cjs'),
      'should contain explicit node path invocation'
    );
  });
});

// ── Group 2: Codex SKILL.md YAML Frontmatter Validation ──────────────────

describe('Codex: SKILL.md YAML frontmatter', () => {
  let fmDir;

  before(() => {
    fmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-codex-fm-'));
    execSync(`node "${INSTALLER}" --codex --local`, {
      cwd: fmDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  after(() => {
    if (fmDir && fs.existsSync(fmDir)) {
      fs.rmSync(fmDir, { recursive: true, force: true });
    }
  });

  test('all SKILL.md files have YAML frontmatter', () => {
    const skillsDir = path.join(fmDir, '.agents', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('pan-'));
    for (const dir of skillDirs) {
      const content = fs.readFileSync(path.join(skillsDir, dir.name, 'SKILL.md'), 'utf8');
      assert.ok(content.startsWith('---\n'),
        `${dir.name}/SKILL.md should start with --- frontmatter`);
      const endIdx = content.indexOf('---', 3);
      assert.ok(endIdx > 3,
        `${dir.name}/SKILL.md should have closing --- frontmatter`);
    }
  });

  test('all SKILL.md files have name field in frontmatter', () => {
    const skillsDir = path.join(fmDir, '.agents', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('pan-'));
    for (const dir of skillDirs) {
      const content = fs.readFileSync(path.join(skillsDir, dir.name, 'SKILL.md'), 'utf8');
      const endIdx = content.indexOf('---', 3);
      const frontmatter = content.substring(4, endIdx);
      assert.match(frontmatter, /^name:\s*.+$/m,
        `${dir.name}/SKILL.md should have name: field`);
      // Verify name value is non-empty
      const nameMatch = frontmatter.match(/^name:\s*"?(.+?)"?\s*$/m);
      assert.ok(nameMatch && nameMatch[1].trim().length > 0,
        `${dir.name}/SKILL.md name should be non-empty`);
    }
  });

  test('all SKILL.md files have description field in frontmatter', () => {
    const skillsDir = path.join(fmDir, '.agents', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('pan-'));
    for (const dir of skillDirs) {
      const content = fs.readFileSync(path.join(skillsDir, dir.name, 'SKILL.md'), 'utf8');
      const endIdx = content.indexOf('---', 3);
      const frontmatter = content.substring(4, endIdx);
      assert.match(frontmatter, /^description:\s*.+$/m,
        `${dir.name}/SKILL.md should have description: field`);
      const descMatch = frontmatter.match(/^description:\s*"?(.+?)"?\s*$/m);
      assert.ok(descMatch && descMatch[1].trim().length > 0,
        `${dir.name}/SKILL.md description should be non-empty`);
    }
  });

  test('all SKILL.md files have metadata.short-description', () => {
    const skillsDir = path.join(fmDir, '.agents', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('pan-'));
    for (const dir of skillDirs) {
      const content = fs.readFileSync(path.join(skillsDir, dir.name, 'SKILL.md'), 'utf8');
      const endIdx = content.indexOf('---', 3);
      const frontmatter = content.substring(4, endIdx);
      assert.match(frontmatter, /metadata:/m,
        `${dir.name}/SKILL.md should have metadata: section`);
      assert.match(frontmatter, /short-description:\s*.+/m,
        `${dir.name}/SKILL.md should have short-description field`);
    }
  });

  test('SKILL.md files contain codex_skill_adapter header', () => {
    const skillsDir = path.join(fmDir, '.agents', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('pan-'));
    for (const dir of skillDirs.slice(0, 5)) {
      const content = fs.readFileSync(path.join(skillsDir, dir.name, 'SKILL.md'), 'utf8');
      assert.ok(content.includes('<codex_skill_adapter>'),
        `${dir.name}/SKILL.md should contain codex_skill_adapter header`);
    }
  });
});

// ── Group 3: Codex Uninstall ──────────────────

describe('Codex: uninstall', () => {
  let uninstallDir;

  before(() => {
    uninstallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-codex-uninstall-'));
    // Install first
    execSync(`node "${INSTALLER}" --codex --local`, {
      cwd: uninstallDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Then uninstall
    execSync(`node "${INSTALLER}" --codex --local --uninstall`, {
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

  test('skills directory is removed after uninstall', () => {
    const skillsDir = path.join(uninstallDir, '.agents', 'skills');
    if (fs.existsSync(skillsDir)) {
      const panFiles = fs.readdirSync(skillsDir).filter(f => f.startsWith('pan-'));
      assert.strictEqual(panFiles.length, 0, 'pan- skill files should be removed');
    }
  });

  test('agents are removed after uninstall', () => {
    const agentsDir = path.join(uninstallDir, '.codex', 'agents');
    if (fs.existsSync(agentsDir)) {
      const panFiles = fs.readdirSync(agentsDir).filter(f => f.startsWith('pan-'));
      assert.strictEqual(panFiles.length, 0, 'pan- agent files should be removed');
    }
  });

  test('pan-wizard-core is removed after uninstall', () => {
    const panDir = path.join(uninstallDir, '.codex', 'pan-wizard-core');
    assert.ok(!fs.existsSync(panDir), 'pan-wizard-core should be removed');
  });

  test('hooks are removed after uninstall', () => {
    const hooksDir = path.join(uninstallDir, '.codex', 'hooks');
    if (fs.existsSync(hooksDir)) {
      const panFiles = fs.readdirSync(hooksDir).filter(f => f.startsWith('pan-'));
      assert.strictEqual(panFiles.length, 0, 'pan- hook files should be removed');
    }
  });

  test('manifest removed after uninstall', () => {
    const manifestPath = path.join(uninstallDir, '.codex', 'pan-file-manifest.json');
    assert.ok(!fs.existsSync(manifestPath), 'manifest should be removed');
  });
});
