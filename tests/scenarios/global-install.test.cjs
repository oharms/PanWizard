/**
 * Global-install scenario tests.
 *
 * M57: global-install mode (--global with --config-dir / env-var / home
 * resolution) had exactly one negative assertion in the whole suite. These
 * tests exercise the positive path: a global install lays down a working
 * installation in the resolved config dir, the precedence chain
 * (--config-dir > env var > ~/) is honored, the installed pan-tools runs from
 * the global path, and nothing leaks into the working directory.
 *
 * L35: statusline existing-config preservation and --force-statusline
 * replacement were untested. The bottom describe drives the installer twice to
 * assert a foreign statusline survives a re-install and is replaced only under
 * --force-statusline.
 *
 * All installs target OS-temp dirs (fake config dirs / fake HOME); nothing
 * touches the developer's real ~/.claude or the source repo.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const INSTALLER = path.join(__dirname, '..', '..', 'bin', 'install.js');

function runInstaller(flags, cwd, extraEnv) {
  return execSync(`node "${INSTALLER}" ${flags}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60000,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// ── M57: --config-dir global install lays down a working installation ─────────

describe('M57: global install into an explicit --config-dir', () => {
  let workDir;
  let configDir;

  before(() => {
    workDir = mkTmp('pan-global-cfg-work-');
    configDir = path.join(workDir, 'global-config');
    runInstaller(`--claude --global --config-dir "${configDir}" --skip-warnings`, workDir);
  });

  after(() => rmTmp(workDir));

  test('pan-wizard-core + VERSION land in the config dir', () => {
    const versionFile = path.join(configDir, 'pan-wizard-core', 'VERSION');
    assert.ok(fs.existsSync(versionFile), 'pan-wizard-core/VERSION should exist in config dir');
    const version = fs.readFileSync(versionFile, 'utf8').trim();
    assert.match(version, /^\d+\.\d+\.\d+/, 'VERSION should be a semver string');
  });

  test('commands, agents, and hooks land in the config dir', () => {
    const commandsDir = path.join(configDir, 'commands', 'pan');
    assert.ok(fs.existsSync(commandsDir), 'commands/pan should exist');
    assert.ok(fs.readdirSync(commandsDir).some(f => f.endsWith('.md')), 'commands/pan has .md files');
    assert.ok(fs.existsSync(path.join(configDir, 'agents')), 'agents/ should exist');
    const hooksDir = path.join(configDir, 'hooks');
    assert.ok(fs.existsSync(hooksDir), 'hooks/ should exist');
    assert.ok(fs.existsSync(path.join(hooksDir, 'pan-statusline.js')), 'pan-statusline.js installed');
  });

  test('manifest is written to the config dir', () => {
    assert.ok(
      fs.existsSync(path.join(configDir, 'pan-file-manifest.json')),
      'pan-file-manifest.json should exist in config dir'
    );
  });

  test('the installed pan-tools runs from the global config path', () => {
    const toolsPath = path.join(configDir, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    assert.ok(fs.existsSync(toolsPath), 'pan-tools.cjs should exist under config dir');
    const out = execSync(`node "${toolsPath}" current-timestamp`, {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    const parsed = JSON.parse(out.trim());
    assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T/, 'pan-tools produces an ISO timestamp');
  });

  test('a global install does not leak PAN files into the working directory', () => {
    assert.ok(!fs.existsSync(path.join(workDir, '.claude')), 'no .claude in working dir');
    assert.ok(!fs.existsSync(path.join(workDir, 'CLAUDE.md')), 'no project CLAUDE.md');
    assert.ok(!fs.existsSync(path.join(workDir, 'AGENTS.md')), 'no project AGENTS.md');
  });
});

// ── M57: config-dir resolution precedence ─────────────────────────────────────

describe('M57: global config-dir resolution precedence', () => {
  let workDir;

  before(() => { workDir = mkTmp('pan-global-prec-'); });
  after(() => rmTmp(workDir));

  test('CLAUDE_CONFIG_DIR env var is honored when no --config-dir is given', () => {
    const envCfg = path.join(workDir, 'env-claude');
    runInstaller('--claude --global --skip-warnings', workDir, { CLAUDE_CONFIG_DIR: envCfg });
    assert.ok(
      fs.existsSync(path.join(envCfg, 'pan-wizard-core', 'VERSION')),
      'install should resolve to CLAUDE_CONFIG_DIR'
    );
  });

  test('--config-dir wins over CLAUDE_CONFIG_DIR', () => {
    const explicit = path.join(workDir, 'explicit');
    const envCfg = path.join(workDir, 'ignored-env');
    runInstaller(`--claude --global --config-dir "${explicit}" --skip-warnings`, workDir, {
      CLAUDE_CONFIG_DIR: envCfg,
    });
    assert.ok(
      fs.existsSync(path.join(explicit, 'pan-wizard-core', 'VERSION')),
      '--config-dir target should be installed'
    );
    assert.ok(
      !fs.existsSync(path.join(envCfg, 'pan-wizard-core')),
      'the env-var dir must be untouched when --config-dir is given'
    );
  });

  test('home resolution: --gemini --global installs into <home>/.gemini', () => {
    const fakeHome = path.join(workDir, 'fake-home');
    fs.mkdirSync(fakeHome, { recursive: true });
    const env = { HOME: fakeHome, USERPROFILE: fakeHome };
    delete env.GEMINI_CONFIG_DIR;
    // Ensure any inherited GEMINI_CONFIG_DIR does not shadow home resolution.
    runInstaller('--gemini --global --skip-warnings', workDir, { ...env, GEMINI_CONFIG_DIR: '' });
    assert.ok(
      fs.existsSync(path.join(fakeHome, '.gemini', 'pan-wizard-core', 'VERSION')),
      'gemini global install should resolve to <home>/.gemini'
    );
  });
});

// ── L35: statusline preservation + --force-statusline replacement ─────────────

describe('L35: statusline preservation and --force-statusline replacement', () => {
  let workDir;
  let settingsPath;

  before(() => {
    workDir = mkTmp('pan-statusline-');
    runInstaller('--claude --local --skip-warnings', workDir);
    settingsPath = path.join(workDir, '.claude', 'settings.json');
  });

  after(() => rmTmp(workDir));

  test('fresh install configures the PAN statusline', () => {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.statusLine, 'statusLine should be configured on fresh install');
    assert.match(settings.statusLine.command, /pan-statusline\.js/);
  });

  test('a foreign statusline survives a re-install (no --force-statusline)', () => {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.statusLine = { type: 'command', command: 'my-custom-statusline.sh' };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    runInstaller('--claude --local --skip-warnings', workDir);

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(
      after.statusLine.command,
      'my-custom-statusline.sh',
      'a user-set statusline must be preserved on re-install'
    );
  });

  test('--force-statusline replaces the foreign statusline with PAN\'s', () => {
    // Precondition: the foreign statusline is still in place from the prior test.
    const before = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(before.statusLine.command, 'my-custom-statusline.sh');

    runInstaller('--claude --local --skip-warnings --force-statusline', workDir);

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.match(
      after.statusLine.command,
      /pan-statusline\.js/,
      '--force-statusline must replace the foreign statusline with PAN\'s'
    );
  });
});
