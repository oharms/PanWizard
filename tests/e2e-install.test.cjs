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

    test('installer refuses to run from a SUBDIRECTORY of the source repo (L2 regression)', () => {
      // The guard used to exact-match the repo root only, so `cd sub && install`
      // planted un-ignored artifacts inside the repo. It must now refuse from any
      // subdir. N14: the throwaway subdir MUST live on a gitignored path — nest it
      // under node_modules/ (always .gitignore'd, and present after `npm ci`) so a
      // regression that plants .claude/ artifacts, or an abnormal exit (Ctrl+C, CI
      // timeout) between mkdir and cleanup, can never leave untracked files in the
      // repo. It is still a real subdirectory of the source repo, so the guard fires.
      const subDir = path.join(PROJECT_ROOT, 'node_modules', '.pan-guard-subdir-test');
      fs.mkdirSync(subDir, { recursive: true });
      // N14: hoist the caught error OUT of the try block. Calling assert.fail()
      // inside the try lets the catch swallow its AssertionError (which has no
      // .status), so a regression was mis-diagnosed as a stderr-content failure
      // instead of "installer did not refuse". Assert only after cleanup.
      let err;
      try {
        execSync(`node "${INSTALLER}" --claude --local`, {
          cwd: subDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        err = e;
      } finally {
        fs.rmSync(subDir, { recursive: true, force: true });
      }
      assert.ok(err, 'installer should have refused (non-zero exit) from a source-repo subdir');
      assert.ok(err.status !== 0, 'should exit with non-zero status');
      const stderr = err.stderr?.toString() || '';
      assert.ok(stderr.includes('Refusing to install'), `stderr should mention refusal, got: ${stderr}`);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E-9 model-capability advisory — the notice a user actually sees
//
// detectModelCapabilities() is pinned as a pure function by its own describe
// block in tests/installer-functions.test.cjs (`grep -n "describe('detectModel"
// tests/installer-functions.test.cjs` finds it). The case total is deliberately
// not written here: a count in a comment is a maintenance debt nothing enforces,
// and the one that used to sit in this sentence had already drifted badly enough
// to mislead. M5 (audit 2026-08) was never a table
// bug: finishInstall() re-derived an out-of-scope `targetDir`, the resulting
// ReferenceError was swallowed by the block's bare `catch {}`, and the notice
// became permanently unreachable while every table case stayed green. Every
// other installer test passes --skip-warnings, so the branch that prints was
// exercised by nothing at all. The cases below close that hole by asserting on
// the installer's stdout: it must print for a capability-poor model, stay
// silent under --skip-warnings, and stay silent for a capability-rich one.
//
// If the M5 shape is reintroduced — anything that throws inside the advisory's
// try, or any change that makes the notice unreachable — the assertion that
// fails is `assert.ok(out.includes(NOTICE_LEAD), ...)` in
// "capability-poor default model prints the advisory". The suppression and
// capability-rich cases assert ABSENCE and would still pass, which is exactly
// why absence-only coverage never caught M5.
// ─────────────────────────────────────────────────────────────────────────────

describe('E-9 model-capability advisory (installer stdout)', () => {
  // Stable lead sentence of the notice. Deliberately excludes the recommended
  // model ids: those live in one constant in bin/install.js and move with the
  // lineup (B4.1), so pinning them here would re-create the drift the constant
  // exists to prevent. The "still names a concrete model" guard below matches a
  // shape, not an id.
  const NOTICE_LEAD = "PAN's multi-agent workflows are tuned for frontier reasoning models";

  /**
   * Install into a throwaway sandbox whose .claude/settings.json already
   * declares `model`, with HOME/USERPROFILE pointed at a fake home inside the
   * sandbox so nothing can touch the real one. Returns stdout plus the model
   * field as it survived the install (the advisory reads the resolved settings
   * object, so a lost model field would silence the notice for the wrong
   * reason and must be asserted separately).
   */
  function installWithDefaultModel(model, extraFlags = '') {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-e9-notice-'));
    const fakeHome = path.join(sandbox, 'fake-home');
    fs.mkdirSync(path.join(sandbox, '.claude'), { recursive: true });
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, '.claude', 'settings.json'),
      JSON.stringify({ model }, null, 2) + '\n'
    );

    const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
    delete env.CLAUDE_CONFIG_DIR; // --local ignores it; drop it so the run is env-independent

    try {
      const out = execSync(`node "${INSTALLER}" --claude --local ${extraFlags}`.trim(), {
        cwd: sandbox,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      const written = JSON.parse(
        fs.readFileSync(path.join(sandbox, '.claude', 'settings.json'), 'utf-8')
      );
      const homeEntries = fs.readdirSync(fakeHome);
      return { out, writtenModel: written.model, homeEntries };
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  test('capability-poor default model prints the advisory', () => {
    const { out, writtenModel } = installWithDefaultModel('claude-3-haiku-20240307');
    assert.strictEqual(writtenModel, 'claude-3-haiku-20240307',
      'installer must preserve the model field — otherwise the advisory has nothing to read');
    assert.ok(out.includes(NOTICE_LEAD),
      `advisory did not print for a capability-poor model. This is the assertion that fails if the M5 shape returns (a throw inside the advisory swallowed by its bare catch). stdout was:\n${out}`);
    assert.ok(out.includes('claude-3-haiku-20240307'),
      'advisory should quote the offending model name back to the user');
    assert.ok(out.includes('1M context') && out.includes('extended thinking'),
      'advisory should list both missing capabilities for a Claude 3 Haiku default');
    assert.ok(/claude-[a-z]+-\d/.test(out.slice(out.indexOf(NOTICE_LEAD))),
      'advice must still name at least one concrete model to switch to — tier-only wording stops telling the user what to do (B4.1)');
  });

  test('--skip-warnings suppresses the advisory for the same model', () => {
    const { out, writtenModel } = installWithDefaultModel('claude-3-haiku-20240307', '--skip-warnings');
    assert.strictEqual(writtenModel, 'claude-3-haiku-20240307', 'model field should still be preserved');
    assert.ok(!out.includes(NOTICE_LEAD),
      `--skip-warnings must suppress the advisory. stdout was:\n${out}`);
  });

  test('capability-rich default model prints no advisory', () => {
    // The false-positive direction: forward releases resolve by family through
    // detectModelCapabilities' fallback, so a current flagship must not be told
    // it lacks 1M context or extended thinking.
    const { out, writtenModel } = installWithDefaultModel('claude-opus-5');
    assert.strictEqual(writtenModel, 'claude-opus-5', 'model field should be preserved');
    assert.ok(!out.includes(NOTICE_LEAD),
      `advisory must not fire for a capability-rich model. stdout was:\n${out}`);
  });

  test('sandbox install leaves the redirected home untouched', () => {
    const { homeEntries } = installWithDefaultModel('claude-opus-5', '--skip-warnings');
    assert.deepStrictEqual(homeEntries, [],
      `a --local install must not write into HOME/USERPROFILE, but the fake home gained: ${homeEntries.join(', ')}`);
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
