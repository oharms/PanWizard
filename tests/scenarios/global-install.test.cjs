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
    // Sandbox HOME/USERPROFILE into the temp cwd so ANY home-based resolution
    // lands in the sandbox, never the developer's real home. The Codex --global
    // skills tree resolves to ~/.agents/skills (home-based, NOT CODEX_HOME), so
    // without this the test wrote 59 pan-* skills into the real ~/.agents/skills
    // on every suite run (N16). extraEnv may still override.
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, ...(extraEnv || {}) },
  });
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// N16 outside-sandbox guard: the Codex --global skills tree resolves to
// ~/.agents/skills via os.homedir() (NOT CODEX_HOME). runInstaller sandboxes
// HOME/USERPROFILE, but if a future resolution path ignored both env vars the
// installer would write pan-* skills into the developer's REAL home again.
// Snapshot the real home's shared skills tree (os.homedir() of the TEST
// process) before any home-touching install and assert the pan-* entry set is
// unchanged after. Deliberately a before/after DELTA check, never an
// emptiness check: pre-existing entries from pre-N16 runs are tolerated,
// additions/deletions are not.
const REAL_HOME_SKILLS = path.join(os.homedir(), '.agents', 'skills');

function listRealHomePanSkills() {
  if (!fs.existsSync(REAL_HOME_SKILLS)) return [];
  return fs.readdirSync(REAL_HOME_SKILLS).filter(e => e.startsWith('pan-')).sort();
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

  // M57 gap (1): global path rewriting in INSTALLED content had no assertion —
  // shipped-content-prefix.test.cjs lints only the source tree, and the other
  // global tests never read installed .md. A regression in the rewrite would ship
  // to npm unseen. Assert the installed commands carry the absolute config-dir
  // path to pan-tools and carry no residual ~/.claude/ reference.
  test('installed command content rewrites ~/.claude paths to the global config dir', () => {
    const cmdDir = path.join(configDir, 'commands', 'pan');
    const files = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md'));
    assert.ok(files.length > 0, 'commands were installed');
    const posixConfig = configDir.replace(/\\/g, '/');
    let sawAbsoluteCorePath = false;
    for (const f of files) {
      const content = fs.readFileSync(path.join(cmdDir, f), 'utf8');
      assert.ok(!/~\/\.claude\//.test(content), `${f} must not keep a literal ~/.claude/ ref`);
      assert.ok(!/\.\/\.claude\//.test(content), `${f} must not keep a literal ./.claude/ ref`);
      if (content.includes(`${posixConfig}/pan-wizard-core/bin/pan-tools.cjs`)) sawAbsoluteCorePath = true;
    }
    assert.ok(sawAbsoluteCorePath, 'at least one command invokes pan-tools via the absolute global config-dir path');
  });
});

// ── M57 gap (3): env-var resolution for Codex / OpenCode / Copilot (all 5 runtimes)

describe('M57: Codex --global honors CODEX_HOME', () => {
  let workDir;
  let realHomeSkillsBefore;

  before(() => {
    workDir = mkTmp('pan-global-codex-');
    realHomeSkillsBefore = listRealHomePanSkills();
  });
  after(() => rmTmp(workDir));

  test('codex global install resolves to CODEX_HOME when no --config-dir is given', () => {
    const codexHome = path.join(workDir, 'codex-home');
    runInstaller('--codex --global --skip-warnings', workDir, { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: '' });
    assert.ok(
      fs.existsSync(path.join(codexHome, 'pan-wizard-core', 'VERSION')),
      'codex global install should resolve to CODEX_HOME'
    );
  });

  test('codex global skills land in the sandboxed home, not the real one (N16)', () => {
    // Positive pin: with HOME/USERPROFILE sandboxed into the temp cwd by
    // runInstaller, the home-based skills tree resolves INSIDE the sandbox.
    // Reverting the runInstaller env hunk sends these writes to the real
    // ~/.agents/skills instead and leaves this dir absent.
    const sandboxSkills = path.join(workDir, '.agents', 'skills');
    assert.ok(
      fs.existsSync(sandboxSkills),
      '.agents/skills should exist inside the sandbox cwd (home redirect took effect)'
    );
    assert.ok(
      fs.readdirSync(sandboxSkills).some(e => e.startsWith('pan-')),
      'pan-* skills should land inside the sandbox, not the real home'
    );

    // Delta check: the REAL home's shared skills tree gained and lost nothing.
    assert.deepEqual(
      listRealHomePanSkills(),
      realHomeSkillsBefore,
      'a sandboxed codex --global install must not add or remove pan-* entries in the real ~/.agents/skills'
    );
  });
});

describe('M57: OpenCode --global precedence chain', () => {
  let workDir;
  before(() => { workDir = mkTmp('pan-global-oc-'); });
  after(() => rmTmp(workDir));

  // Neutralize any inherited opencode env so each test controls the chain.
  const baseEnv = { OPENCODE_CONFIG_DIR: '', OPENCODE_CONFIG: '', XDG_CONFIG_HOME: '' };

  test('OPENCODE_CONFIG_DIR wins over OPENCODE_CONFIG and XDG_CONFIG_HOME', () => {
    const dir = path.join(workDir, 'oc-explicit');
    runInstaller('--opencode --global --skip-warnings', workDir, {
      ...baseEnv,
      OPENCODE_CONFIG_DIR: dir,
      OPENCODE_CONFIG: path.join(workDir, 'oc-file', 'opencode.json'),
      XDG_CONFIG_HOME: path.join(workDir, 'oc-xdg'),
    });
    assert.ok(fs.existsSync(path.join(dir, 'pan-wizard-core', 'VERSION')), 'lands in OPENCODE_CONFIG_DIR');
    assert.ok(!fs.existsSync(path.join(workDir, 'oc-file', 'pan-wizard-core')), 'OPENCODE_CONFIG dir untouched');
    assert.ok(!fs.existsSync(path.join(workDir, 'oc-xdg', 'opencode', 'pan-wizard-core')), 'XDG dir untouched');
  });

  test('OPENCODE_CONFIG (a file) resolves to its dirname when OPENCODE_CONFIG_DIR is unset', () => {
    const cfgDir = path.join(workDir, 'oc-cfgfile');
    runInstaller('--opencode --global --skip-warnings', workDir, {
      ...baseEnv,
      OPENCODE_CONFIG: path.join(cfgDir, 'opencode.json'),
      XDG_CONFIG_HOME: path.join(workDir, 'oc-xdg2'),
    });
    assert.ok(fs.existsSync(path.join(cfgDir, 'pan-wizard-core', 'VERSION')), 'lands in dirname(OPENCODE_CONFIG)');
    assert.ok(!fs.existsSync(path.join(workDir, 'oc-xdg2', 'opencode', 'pan-wizard-core')), 'XDG not used when OPENCODE_CONFIG set');
  });

  test('XDG_CONFIG_HOME/opencode is used when only XDG is set', () => {
    const xdg = path.join(workDir, 'oc-xdgonly');
    runInstaller('--opencode --global --skip-warnings', workDir, { ...baseEnv, XDG_CONFIG_HOME: xdg });
    assert.ok(
      fs.existsSync(path.join(xdg, 'opencode', 'pan-wizard-core', 'VERSION')),
      'lands in XDG_CONFIG_HOME/opencode'
    );
  });
});

describe('M57: Copilot --global honors COPILOT_CONFIG_DIR', () => {
  let workDir;
  before(() => { workDir = mkTmp('pan-global-copilot-'); });
  after(() => rmTmp(workDir));

  test('copilot global install resolves to COPILOT_CONFIG_DIR', () => {
    const dir = path.join(workDir, 'copilot-cfg');
    runInstaller('--copilot --global --skip-warnings', workDir, { COPILOT_CONFIG_DIR: dir });
    assert.ok(
      fs.existsSync(path.join(dir, 'pan-wizard-core', 'VERSION')),
      'copilot global install should resolve to COPILOT_CONFIG_DIR'
    );
  });
});

// ── M57 gap (2): --global --uninstall cleanup (incl. the global opencode.json branch)

describe('M57: OpenCode --global --uninstall cleanup', () => {
  let workDir;
  before(() => { workDir = mkTmp('pan-global-ocuninstall-'); });
  after(() => rmTmp(workDir));

  test('a global uninstall removes the core payload and cleans the global opencode.json', () => {
    const ocDir = path.join(workDir, 'oc-uninstall');
    const env = { OPENCODE_CONFIG_DIR: ocDir, OPENCODE_CONFIG: '', XDG_CONFIG_HOME: '' };
    runInstaller('--opencode --global --skip-warnings', workDir, env);
    assert.ok(fs.existsSync(path.join(ocDir, 'pan-wizard-core', 'VERSION')), 'installed first');

    runInstaller('--opencode --global --uninstall --skip-warnings', workDir, env);
    assert.ok(!fs.existsSync(path.join(ocDir, 'pan-wizard-core')), 'core payload removed on global uninstall');
    // The global opencode.json PAN entries must be cleaned: the installer removes
    // pan-wizard-core permission keys and deletes the file if it becomes empty.
    const cfgPath = path.join(ocDir, 'opencode.json');
    if (fs.existsSync(cfgPath)) {
      assert.ok(!fs.readFileSync(cfgPath, 'utf8').includes('pan-wizard-core'), 'no PAN entries left in global opencode.json');
    }
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
