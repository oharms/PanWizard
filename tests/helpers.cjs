/**
 * PAN Tools Test Helpers
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOOLS_PATH = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

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
  fs.rmSync(tmpDir, { recursive: true, force: true });
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { tmpDir, installedToolsPath, configDir, run, cleanup: cleanupRunner };
}

module.exports = { runPanTools, createTempProject, cleanup, createScenarioRunner, TOOLS_PATH, INSTALLER_PATH, RUNTIME_DIR };
