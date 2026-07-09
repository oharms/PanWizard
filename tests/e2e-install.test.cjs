/**
 * E2E: Install PAN Wizard and run commands from installed location
 *
 * This test exercises the real installer (bin/install.js --claude --local),
 * verifies the file structure it creates, then runs pan-tools commands
 * from the INSTALLED location — exactly what a user does after installing.
 */

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

// Shared temp directory for all tests (install once, test many)
let tempDir;
let installedToolsPath;

/**
 * Run pan-tools from the INSTALLED location (not source).
 */
function runInstalled(args, cwd) {
  try {
    const result = execSync(`node "${installedToolsPath}" ${args}`, {
      cwd: cwd || tempDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: result.trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
    };
  }
}

describe('E2E: Install and run from installed location', () => {
  before(() => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-e2e-'));
    installedToolsPath = path.join(tempDir, '.claude', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

    // Run the real installer: non-interactive, local mode
    execSync(`node "${INSTALLER}" --claude --local`, {
      cwd: tempDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ── Group 1: Installation Structure ──────────────────────────

  describe('installation structure', () => {
    test('.claude directory exists', () => {
      assert.ok(fs.existsSync(path.join(tempDir, '.claude')), '.claude dir should exist');
    });

    test('pan-tools.cjs is installed', () => {
      assert.ok(fs.existsSync(installedToolsPath), 'pan-tools.cjs should exist at installed path');
    });

    test('core lib modules are installed', () => {
      const libDir = path.join(tempDir, '.claude', 'pan-wizard-core', 'bin', 'lib');
      const expectedModules = ['core.cjs', 'state.cjs', 'phase.cjs', 'roadmap.cjs', 'verify.cjs', 'constants.cjs', 'utils.cjs', 'frontmatter.cjs'];
      for (const mod of expectedModules) {
        assert.ok(fs.existsSync(path.join(libDir, mod)), `${mod} should be installed`);
      }
    });

    test('commands/pan directory has .md files', () => {
      const commandsDir = path.join(tempDir, '.claude', 'commands', 'pan');
      assert.ok(fs.existsSync(commandsDir), 'commands/pan dir should exist');
      const mdFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
      assert.ok(mdFiles.length >= 30, `should have 30+ command files, got ${mdFiles.length}`);
    });

    test('agents directory has .md files', () => {
      const agentsDir = path.join(tempDir, '.claude', 'agents');
      assert.ok(fs.existsSync(agentsDir), 'agents dir should exist');
      const mdFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
      assert.ok(mdFiles.length >= 10, `should have 10+ agent files, got ${mdFiles.length}`);
    });

    test('hooks directory has .js files', () => {
      const hooksDir = path.join(tempDir, '.claude', 'hooks');
      assert.ok(fs.existsSync(hooksDir), 'hooks dir should exist');
      const jsFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js'));
      assert.ok(jsFiles.length >= 3, `should have 3+ hook files, got ${jsFiles.length}`);
    });

    test('settings.json exists', () => {
      assert.ok(fs.existsSync(path.join(tempDir, '.claude', 'settings.json')), 'settings.json should exist');
    });

    test('VERSION file matches package.json', () => {
      const versionPath = path.join(tempDir, '.claude', 'pan-wizard-core', 'VERSION');
      assert.ok(fs.existsSync(versionPath), 'VERSION file should exist');
      const version = fs.readFileSync(versionPath, 'utf-8').trim();
      assert.strictEqual(version, PKG_VERSION, `VERSION should be ${PKG_VERSION}`);
    });
  });

  // ── Group 2: Core Commands from Installed Location ───────────

  describe('core commands from installed location', () => {
    before(() => {
      // Create project structure so commands can operate
      fs.mkdirSync(path.join(tempDir, '.planning', 'phases'), { recursive: true });

      // Minimal roadmap.md
      fs.writeFileSync(path.join(tempDir, '.planning', 'roadmap.md'), [
        '# Roadmap',
        '',
        '## Phases',
        '',
        '| # | Phase | Status | Progress |',
        '|---|-------|--------|----------|',
        '',
      ].join('\n'));

      // Minimal state.md
      fs.writeFileSync(path.join(tempDir, '.planning', 'state.md'), [
        '# Project State',
        '',
        '**Status:** Active',
        '**Last Activity:** 2026-01-01',
        '**Last Activity Description:** Initial setup',
        '',
        '## Decisions',
        '',
        '## Blockers',
        '',
      ].join('\n'));
    });

    test('generate-slug returns JSON with slug', () => {
      const result = runInstalled('generate-slug "Test Phase Name"');
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.ok(typeof output.slug === 'string', 'should have slug string');
      assert.strictEqual(output.slug, 'test-phase-name', 'slug should be kebab-case');
      assert.ok(!output.error, 'should not have error on success');
    });

    test('current-timestamp returns JSON with timestamp', () => {
      const result = runInstalled('current-timestamp');
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.ok(typeof output.timestamp === 'string', 'should have timestamp string');
      assert.ok(output.timestamp.includes('T'), 'should be ISO format');
      assert.ok(output.timestamp.endsWith('Z'), 'should be UTC');
    });

    test('state json returns project state', () => {
      const result = runInstalled('state json');
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.ok(typeof output === 'object', 'should return state object');
      assert.ok(!output.error, 'should not have error on success');
    });

    test('phases list returns empty when no phases exist', () => {
      const result = runInstalled('phases list');
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.strictEqual(output.count, 0, 'should have 0 phases');
      assert.ok(Array.isArray(output.directories), 'should have directories array');
    });

    test('phase add creates a phase directory', () => {
      const result = runInstalled('phase add "E2E Test Phase"');
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.ok(output.created || output.directory, 'should confirm phase creation');
    });

    test('phases list shows the added phase', () => {
      const result = runInstalled('phases list');
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.ok(output.count >= 1, 'should have at least 1 phase');
    });

    test('config-ensure-section works', () => {
      const result = runInstalled('config-ensure-section');
      assert.ok(result.success, `Command failed: ${result.error}`);
    });

    test('context-budget returns budget report', () => {
      const result = runInstalled('context-budget');
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.ok('status' in output, 'should have status field');
      assert.ok('contextWindow' in output, 'should have contextWindow field');
      assert.ok('budgetUtilization' in output, 'should have budgetUtilization field');
    });

    test('progress health returns composite health score', () => {
      const result = runInstalled('progress health');
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.ok('grade' in output, 'should have grade field');
      assert.ok('composite' in output, 'should have composite field');
      assert.ok(['A', 'B', 'C', 'D'].includes(output.grade), 'grade should be A-D');
    });

    test('validate health returns report', () => {
      const result = runInstalled('validate health');
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.ok(typeof output === 'object', 'should return health report object');
      assert.ok(!output.error, 'should not have error on success');
    });
  });

  // ── Group 3: Workflow Sequence ───────────────────────────────

  describe('workflow sequence from installed location', () => {
    let workflowDir;

    before(() => {
      // Fresh project directory for workflow tests
      workflowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-e2e-wf-'));
      fs.mkdirSync(path.join(workflowDir, '.planning', 'phases'), { recursive: true });

      // ROADMAP with table for update-plan-progress
      fs.writeFileSync(path.join(workflowDir, '.planning', 'roadmap.md'), [
        '# Roadmap',
        '',
        '## Phases',
        '',
        '| # | Phase | Status | Progress |',
        '|---|-------|--------|----------|',
        '',
      ].join('\n'));

      // state.md for state commands
      fs.writeFileSync(path.join(workflowDir, '.planning', 'state.md'), [
        '# Project State',
        '',
        '**Status:** Active',
        '**Last Activity:** 2026-01-01',
        '**Last Activity Description:** Start',
        '',
        '## Decisions',
        '',
        '## Blockers',
        '',
      ].join('\n'));
    });

    after(() => {
      if (workflowDir && fs.existsSync(workflowDir)) {
        fs.rmSync(workflowDir, { recursive: true, force: true });
      }
    });

    test('add multiple phases and list them', () => {
      const add1 = runInstalled('phase add "Auth Module"', workflowDir);
      assert.ok(add1.success, `Phase add 1 failed: ${add1.error}`);

      const add2 = runInstalled('phase add "API Layer"', workflowDir);
      assert.ok(add2.success, `Phase add 2 failed: ${add2.error}`);

      const list = runInstalled('phases list', workflowDir);
      assert.ok(list.success, `Phases list failed: ${list.error}`);
      const output = JSON.parse(list.output);
      assert.strictEqual(output.count, 2, 'should have 2 phases');
    });

    test('write a PLAN.md and update roadmap progress', () => {
      // Find the first phase directory
      const phasesDir = path.join(workflowDir, '.planning', 'phases');
      const phaseDirs = fs.readdirSync(phasesDir).sort();
      assert.ok(phaseDirs.length > 0, 'should have at least one phase dir');

      const firstPhase = phaseDirs[0];
      const planPath = path.join(phasesDir, firstPhase, 'plan.md');
      fs.writeFileSync(planPath, [
        '---',
        'status: complete',
        'one-liner: Built authentication module',
        '---',
        '# Plan: Auth Module',
        '',
        '## Task 1',
        'Implement login flow',
      ].join('\n'));

      const result = runInstalled(`roadmap update-plan-progress ${firstPhase}`, workflowDir);
      assert.ok(result.success, `update-plan-progress failed: ${result.error}`);
    });

    test('state add-decision records a decision', () => {
      const result = runInstalled('state add-decision --summary "Use JWT for auth"', workflowDir);
      assert.ok(result.success, `add-decision failed: ${result.error}`);

      // Verify decision appears in state.md
      const stateContent = fs.readFileSync(path.join(workflowDir, '.planning', 'state.md'), 'utf-8');
      assert.ok(stateContent.includes('JWT'), 'state.md should contain the decision text');
    });

    test('milestone complete archives correctly', () => {
      const result = runInstalled('milestone complete v0.1 --name "E2E Test"', workflowDir);
      assert.ok(result.success, `milestone complete failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.strictEqual(output.version, 'v0.1', 'version should match');

      // Verify milestones.md was created
      const milestonesPath = path.join(workflowDir, '.planning', 'milestones.md');
      assert.ok(fs.existsSync(milestonesPath), 'milestones.md should be created');
      const content = fs.readFileSync(milestonesPath, 'utf-8');
      assert.ok(content.includes('v0.1'), 'should contain the version');
      assert.ok(content.includes('E2E Test'), 'should contain the milestone name');
    });
  });

  // ── Group 6: Installer Edge Cases ──────────────────────────────

  describe('installer edge cases', () => {
    test('VERSION file has trailing newline', () => {
      const versionPath = path.join(tempDir, '.claude', 'pan-wizard-core', 'VERSION');
      assert.ok(fs.existsSync(versionPath), 'VERSION file should exist');
      const content = fs.readFileSync(versionPath, 'utf-8');
      assert.ok(content.endsWith('\n'), 'VERSION should end with newline');
      assert.strictEqual(content.trim(), PKG_VERSION, 'VERSION should match package.json');
    });

    test('CommonJS package.json is installed', () => {
      const pkgPath = path.join(tempDir, '.claude', 'package.json');
      assert.ok(fs.existsSync(pkgPath), 'package.json should exist');
      const content = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      assert.strictEqual(content.type, 'commonjs', 'should force CommonJS mode');
    });

    test('settings.json has valid structure', () => {
      const settingsPath = path.join(tempDir, '.claude', 'settings.json');
      assert.ok(fs.existsSync(settingsPath), 'settings.json should exist');
      const content = fs.readFileSync(settingsPath, 'utf-8');
      // Should be valid JSON
      assert.doesNotThrow(() => JSON.parse(content), 'settings.json should be valid JSON');
    });

    test('reinstall overwrites cleanly', () => {
      // Run installer again on the same directory
      const result = execSync(`node "${INSTALLER}" --claude --local`, {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Should succeed without error
      assert.ok(result.includes('✓'), 'reinstall should show success checkmarks');
      // pan-tools should still work after reinstall
      const toolsResult = runInstalled('current-timestamp');
      assert.ok(toolsResult.success, `current-timestamp should work after reinstall: ${toolsResult.error}`);
    });

    test('uninstall removes PAN files', () => {
      // Create a fresh install to uninstall
      const uninstallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-uninstall-'));
      try {
        execSync(`node "${INSTALLER}" --claude --local`, {
          cwd: uninstallDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Verify install happened
        assert.ok(fs.existsSync(path.join(uninstallDir, '.claude', 'pan-wizard-core')));

        // Run uninstall
        execSync(`node "${INSTALLER}" --uninstall --claude --local`, {
          cwd: uninstallDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // pan-wizard-core should be removed
        assert.ok(
          !fs.existsSync(path.join(uninstallDir, '.claude', 'pan-wizard-core')),
          'pan-wizard-core should be removed after uninstall'
        );
        // PAN agent files should be removed (dir may remain for non-PAN agents)
        const agentsDir = path.join(uninstallDir, '.claude', 'agents');
        if (fs.existsSync(agentsDir)) {
          const remaining = fs.readdirSync(agentsDir).filter(f => f.startsWith('pan-'));
          assert.strictEqual(remaining.length, 0, 'no pan-*.md agents should remain');
        }
      } finally {
        fs.rmSync(uninstallDir, { recursive: true, force: true });
      }
    });
  });

  // ── Group: Uninstall All Runtimes ──────────────────────────────

  describe('uninstall all runtimes', () => {
    const RUNTIMES = [
      { flag: '--claude', configDir: '.claude' },
      { flag: '--opencode', configDir: '.opencode' },
      { flag: '--gemini', configDir: '.gemini' },
      { flag: '--codex', configDir: '.codex' },
      { flag: '--copilot', configDir: '.github' },
    ];

    for (const { flag, configDir } of RUNTIMES) {
      test(`uninstall ${flag} removes pan-wizard-core`, () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `pan-uninst-${configDir.replace('.', '')}-`));
        try {
          execSync(`node "${INSTALLER}" ${flag} --local`, {
            cwd: tmpDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
          });
          assert.ok(fs.existsSync(path.join(tmpDir, configDir, 'pan-wizard-core')),
            `${configDir}/pan-wizard-core should exist after install`);

          execSync(`node "${INSTALLER}" --uninstall ${flag} --local`, {
            cwd: tmpDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
          });
          assert.ok(!fs.existsSync(path.join(tmpDir, configDir, 'pan-wizard-core')),
            `${configDir}/pan-wizard-core should be removed after uninstall`);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      });
    }
  });

  // ── Group: Self-Install Guard ────────────────────────────────

  describe('self-install guard', () => {
    test('installer refuses to run from source repository', () => {
      try {
        execSync(`node "${INSTALLER}" --claude --local`, {
          cwd: PROJECT_ROOT,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert.fail('installer should have exited with error');
      } catch (err) {
        assert.ok(err.status !== 0, 'should exit with non-zero status');
        const stderr = err.stderr?.toString() || '';
        assert.ok(stderr.includes('Refusing to install'), `stderr should mention refusal, got: ${stderr}`);
      }
    });

    test('uninstaller refuses to run from source repository', () => {
      try {
        execSync(`node "${INSTALLER}" --uninstall --claude --local`, {
          cwd: PROJECT_ROOT,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert.fail('uninstaller should have exited with error');
      } catch (err) {
        assert.ok(err.status !== 0, 'should exit with non-zero status');
        const stderr = err.stderr?.toString() || '';
        assert.ok(stderr.includes('Refusing'), `stderr should mention refusal, got: ${stderr}`);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Installer deploys model-profiles.md to all 5 runtimes
// ─────────────────────────────────────────────────────────────────────────────

const { createScenarioRunner, RUNTIME_DIR } = require('./helpers.cjs');

describe('Installer deploys model-profiles.md to all runtimes', () => {
  const runtimes = Object.keys(RUNTIME_DIR); // claude, opencode, gemini, codex, copilot

  for (const runtime of runtimes) {
    test(`${runtime}: model-profiles.md is installed in references/`, () => {
      const runner = createScenarioRunner(runtime);
      try {
        const refsDir = path.join(runner.tmpDir, runner.configDir, 'pan-wizard-core', 'references');
        const profilePath = path.join(refsDir, 'model-profiles.md');
        assert.ok(fs.existsSync(profilePath), `model-profiles.md should exist for ${runtime}`);
        const content = fs.readFileSync(profilePath, 'utf8');
        assert.ok(content.includes('Model Profiles'), 'should contain Model Profiles heading');
        assert.ok(content.includes('quality'), 'should contain quality profile');
        assert.ok(content.includes('balanced'), 'should contain balanced profile');
        assert.ok(content.includes('budget'), 'should contain budget profile');
      } finally {
        runner.cleanup();
      }
    });
  }
});
