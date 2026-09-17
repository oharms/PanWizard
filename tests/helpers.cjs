/**
 * PAN Tools Test Helpers
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOLS_PATH = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

/**
 * Build the Claude Code plugin into a FRESH temp directory and return its path.
 *
 * Every test that needs a built plugin must go through here rather than run the
 * builder against dist/pan-wizard-plugin: `node --test` runs test files in
 * parallel, and two files rebuilding the same directory raced (one's rmSync
 * inside the other's copy → ENOENT) on 2026-09-10. The builder honours
 * PAN_PLUGIN_OUT for exactly this reason. Callers own cleanup(dir).
 */
function buildPluginInto() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-plugin-'));
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-plugin.js')], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PAN_PLUGIN_OUT: out },
  });
  return out;
}

/** Same contract for the Agent Plugins bundle (scripts/build-agent-plugin.js, ADR-0045). */
function buildAgentPluginInto() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-agent-plugin-'));
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-agent-plugin.js')], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PAN_AGENT_PLUGIN_OUT: out },
  });
  return out;
}

// Helper to run pan-tools command
function runPanTools(args, cwd = process.cwd()) {
  try {
    const result = execSync(`node "${TOOLS_PATH}" ${args}`, {
      cwd,
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

// Create temp directory structure
function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  // Best-effort removal. maxRetries absorbs short ENOTEMPTY/EBUSY races, but a
  // DETACHED background process (git gc --auto on macOS detaches after commits)
  // can hold .git entries past any reasonable retry window. These dirs live in
  // os.tmpdir(); never fail a suite over cleanup — settle, retry once, warn.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (err) {
      console.warn(`cleanup: leaving temp dir behind (${err.code}): ${tmpDir}`);
    }
  }
}

const INSTALLER_PATH = path.join(__dirname, '..', 'bin', 'install.js');

/** Runtime → config directory name mapping (mirrors installer getDirName) */
const RUNTIME_DIR = {
  claude: '.claude',
  opencode: '.opencode',
  gemini: '.gemini',
  codex: '.codex',
  copilot: '.github',
};

/**
 * Create a scenario runner for a specific runtime.
 * Installs PAN for the given runtime in a temp directory,
 * then provides helpers to run commands from the installed location.
 *
 * @param {string} runtime - 'claude'|'opencode'|'gemini'|'codex'|'copilot'
 * @returns {{ tmpDir: string, installedToolsPath: string, run: Function, cleanup: Function }}
 */
function createScenarioRunner(runtime) {
  const configDir = RUNTIME_DIR[runtime];
  if (!configDir) throw new Error(`Unknown runtime: ${runtime}`);

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), `pan-scenario-${runtime}-`));
  const installedToolsPath = path.join(tmpDir, configDir, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

  // Install PAN for this runtime
  try {
    execSync(`node "${INSTALLER_PATH}" --${runtime} --local`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw new Error(`Installer failed for ${runtime}: ${err.stderr || err.message}`);
  }

  /**
   * Run a pan-tools command from the installed location.
   * @param {string} args - Command arguments
   * @param {string} [cwd] - Working directory (defaults to tmpDir)
   * @returns {{ success: boolean, output: string, error: string }}
   */
  function run(args, cwd) {
    try {
      const result = execSync(`node "${installedToolsPath}" ${args}`, {
        cwd: cwd || tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
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

  function cleanupRunner() {
    cleanup(tmpDir);
  }

  return { tmpDir, installedToolsPath, configDir, run, cleanup: cleanupRunner };
}

/**
 * Run `fn(fakeHome)` with HOME, USERPROFILE and CLAUDE_CONFIG_DIR pointed at a fresh
 * temp directory, then restore them and remove it. Tests must never read the
 * developer's real home (test-quality rule Q7): a global PAN install or a real
 * ~/.claude/projects tree there makes a test pass or fail for reasons unrelated to
 * the change under test.
 */
function withFakeHome(fn) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-home-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(fakeHome, '.claude');
  try {
    return fn(fakeHome);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    cleanup(fakeHome);
  }
}

/** The cost ledger rows of a project, parsed; [] when there is no ledger. */
function readLedger(cwd) {
  try {
    return fs.readFileSync(path.join(cwd, '.planning', 'metrics', 'tokens.jsonl'), 'utf-8')
      .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch { return []; }
}

/**
 * Spawn a hook script as its host would: JSON payload on stdin, the project as cwd.
 * `hook` is a file name in hooks/ (source) or an absolute path (an installed copy).
 * Returns { status, stdout, stderr }. The environment is inherited (so coverage
 * instrumentation reaches the hook) with `extraEnv` layered on top.
 */
function spawnHook(hook, payload, cwd, extraEnv = {}) {
  const { spawnSync } = require('child_process');
  const script = path.isAbsolute(hook) ? hook : path.join(__dirname, '..', 'hooks', hook);
  const r = spawnSync(process.execPath, [script], {
    cwd, input: JSON.stringify(payload), encoding: 'utf-8', env: { ...process.env, ...extraEnv }, timeout: 20000,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/**
 * Run the installer into `cwd` with the given flags (e.g. ['--claude', '--local']).
 * Refuses the source repository: the installer has its own guard, but a test must
 * never even ask. Returns { success, output, error }.
 */
function installInto(cwd, flags) {
  const repo = path.resolve(__dirname, '..');
  if (path.resolve(cwd) === repo || path.resolve(cwd).startsWith(repo + path.sep)) {
    throw new Error(`installInto: refusing to install into the source repository (${cwd})`);
  }
  try {
    const out = execFileSync(process.execPath, [INSTALLER_PATH, ...flags], { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    return { success: true, output: out.trim() };
  } catch (err) {
    return { success: false, output: err.stdout?.toString().trim() || '', error: err.stderr?.toString().trim() || err.message };
  }
}

module.exports = { runPanTools, createTempProject, cleanup, createScenarioRunner, buildPluginInto, buildAgentPluginInto, withFakeHome, readLedger, spawnHook, installInto, TOOLS_PATH, INSTALLER_PATH, RUNTIME_DIR };
