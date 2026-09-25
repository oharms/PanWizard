// Tests for the installer's statusline guard chain (E2E audit 2026-08, N20).
// Pins three behaviors that regressed twice (M6, N4) with a green suite:
//   (a) a secondary runtime's custom statusline survives a multi-runtime
//       non-interactive install while the primary still gets PAN's statusline
//       (finishInstall preserve guard + isPrimaryStatusline threading);
//   (b) the Fix #330 legacy migration never rewrites user scripts that merely
//       contain — or are exactly named — statusline.js (hooks/ path anchor);
//   (c) the genuine legacy hooks/statusline.js path still migrates to
//       hooks/pan-statusline.js, in both slash directions.

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
  // Sandbox HOME/USERPROFILE into a fake home inside the temp cwd so no
  // home-based path resolution can ever touch the developer's real home
  // (same N16 pattern as tests/scenarios/global-install.test.cjs).
  const fakeHome = path.join(cwd, '.fake-home');
  fs.mkdirSync(fakeHome, { recursive: true });
  return execSync(`node "${INSTALLER}" ${flags}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60000,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pan-statusline-guard-'));
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function seedStatusline(projectDir, runtimeDir, command) {
  const dir = path.join(projectDir, runtimeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command } }, null, 2) + '\n'
  );
}

function readSettings(projectDir, runtimeDir) {
  return JSON.parse(fs.readFileSync(path.join(projectDir, runtimeDir, 'settings.json'), 'utf8'));
}

// ─── (a) Secondary-runtime preserve guard + primary threading (M6/N4) ─────────

describe('statusline guard: multi-runtime non-interactive install preserves secondary custom statusline', () => {
  let tempDir;
  let output;
  // Copilot's local statusline lives in .github/copilot/settings.json. (Gemini was
  // the secondary runtime here until 2026-09-23; Gemini CLI has no statusline
  // command, so PAN no longer offers it one — see the Gemini describe below.)
  const COPILOT_SETTINGS_DIR = path.join('.github', 'copilot');

  before(() => {
    tempDir = mkTmp();
    // Custom statusline in the SECONDARY runtime (copilot) only — claude, the
    // first statusline-capable runtime, is the primary.
    seedStatusline(tempDir, COPILOT_SETTINGS_DIR, 'node my-status-bar.js');
    output = runInstaller('--claude --copilot --local --skip-warnings', tempDir);
  });

  after(() => rmTmp(tempDir));

  test('copilot custom statusline command survives byte-exact', () => {
    // Reverting the finishInstall preserve guard (or treating copilot as
    // primary via broken isPrimaryStatusline threading) clobbers this with
    // node .github/hooks/pan-statusline.js.
    const settings = readSettings(tempDir, COPILOT_SETTINGS_DIR);
    assert.equal(settings.statusLine.type, 'command');
    assert.equal(settings.statusLine.command, 'node my-status-bar.js');
  });

  test('installer announced it kept the existing statusline', () => {
    assert.ok(output.includes('Kept your existing statusline'),
      `expected the preserve notice in installer output, got:\n${output}`);
  });

  test('claude (primary) still got the PAN statusline', () => {
    // If the primary-selection threading breaks (e.g. handleStatusline is fed
    // the runtime that HAS a statusline), the non-interactive skip path answers
    // false for everyone and claude never gets PAN's statusline.
    const settings = readSettings(tempDir, '.claude');
    assert.equal(settings.statusLine.type, 'command');
    assert.equal(settings.statusLine.command, 'node .claude/hooks/pan-statusline.js');
  });
});

describe('statusline guard: Gemini CLI gets no statusline, and a user\'s own survives (R29)', () => {
  let tempDir;

  before(() => {
    tempDir = mkTmp();
    seedStatusline(tempDir, '.gemini', 'node my-status-bar.js');
    runInstaller('--claude --gemini --local --skip-warnings', tempDir);
  });

  after(() => rmTmp(tempDir));

  test('a custom statusline in Gemini settings is left byte-exact — PAN only removes its own', () => {
    // Gemini CLI has no statusline command (its footer shows built-in items), so
    // PAN writes none there and strips only a block that runs pan-statusline.js.
    const settings = readSettings(tempDir, '.gemini');
    assert.equal(settings.statusLine.command, 'node my-status-bar.js');
  });
});

// ─── (b) Migration anchor: user scripts are never rewritten (M6 residual) ─────

describe('statusline migration anchor: user commands containing or named statusline.js survive', () => {
  // One sandbox per fixture — a settings.json holds a single statusLine.
  const fixtures = [
    // Substring match regression: name CONTAINS statusline.js.
    { label: 'name containing statusline.js', command: 'node my-custom-statusline.js' },
    // Basename-anchor regression: script literally NAMED statusline.js
    // (separator alternative of the old /(^|[\\/])statusline\.js\b/ regex).
    { label: 'exact basename ./statusline.js', command: 'node ./statusline.js' },
    // Start-of-string alternative of the old regex.
    { label: 'bare statusline.js at start of command', command: 'statusline.js --fast' },
  ];

  for (const { label, command } of fixtures) {
    describe(label, () => {
      let tempDir;
      let output;

      before(() => {
        tempDir = mkTmp();
        seedStatusline(tempDir, '.claude', command);
        output = runInstaller('--claude --local --skip-warnings', tempDir);
      });

      after(() => rmTmp(tempDir));

      test('command survives byte-exact (never migrated, never clobbered)', () => {
        // Any loosening of the hooks/ anchor rewrites the command to a
        // nonexistent pan-statusline.js path, after which isPanStatusline
        // misclassifies it as PAN-owned and the guard stands down.
        const settings = readSettings(tempDir, '.claude');
        assert.equal(settings.statusLine.type, 'command');
        assert.equal(settings.statusLine.command, command);
      });

      test('installer never claimed a statusline path migration', () => {
        assert.ok(!output.includes('Updated statusline path'),
          `migration must not fire for "${command}", got:\n${output}`);
      });
    });
  }
});

// ─── (c) Legacy hooks/statusline.js migration still works (Fix #330) ──────────

describe('statusline migration: legacy hooks/statusline.js path still migrates', () => {
  const fixtures = [
    {
      label: 'forward-slash legacy path',
      seeded: 'node .claude/hooks/statusline.js',
      migrated: 'node .claude/hooks/pan-statusline.js',
    },
    {
      label: 'backslash legacy path (Windows settings.json)',
      seeded: 'node .claude\\hooks\\statusline.js',
      migrated: 'node .claude\\hooks\\pan-statusline.js',
    },
  ];

  for (const { label, seeded, migrated } of fixtures) {
    describe(label, () => {
      let tempDir;
      let output;

      before(() => {
        tempDir = mkTmp();
        seedStatusline(tempDir, '.claude', seeded);
        output = runInstaller('--claude --local --skip-warnings', tempDir);
      });

      after(() => rmTmp(tempDir));

      test('legacy path is rewritten to pan-statusline.js, separators preserved', () => {
        // Pins that tightening the migration regex (hooks/ anchor) never
        // breaks the genuine v1.9.0 rename migration in either slash style.
        const settings = readSettings(tempDir, '.claude');
        assert.equal(settings.statusLine.type, 'command');
        assert.equal(settings.statusLine.command, migrated);
      });

      test('installer announced the migration', () => {
        assert.ok(output.includes('Updated statusline path'),
          `expected the migration notice in installer output, got:\n${output}`);
      });
    });
  }
});
