/**
 * VSCode E2E test helpers using @vscode/test-electron.
 *
 * Uses `runTests` to launch VSCode with a test runner script that executes
 * INSIDE the VSCode process. This avoids the Playwright _electron.launch
 * incompatibility with VSCode's native launcher (1.110+).
 *
 * Provides:
 *   ensureVSCode()             — download VSCode, return executable path
 *   installPanWizard(dir, rt)  — install PAN Wizard for a given runtime
 *   createE2EProject()         — temp dir + git init + PAN install
 *   runVSCodeTest(project, testModule) — launch VSCode and run a test module inside it
 */

import { runTests, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve system-installed VSCode executable path.
 * Uses `code` from PATH (which points to the system install).
 * Falls back to common install locations on Windows.
 */
export async function ensureVSCode() {
  // Try `where code` / `which code` to find the system install
  try {
    const codePath = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['code'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split(/\r?\n/)[0];

    if (codePath) {
      // The `code` script lives in <install>/bin/code — we need the parent dir's Code.exe
      const installDir = path.resolve(codePath, '..', '..');
      const exe = process.platform === 'win32'
        ? path.join(installDir, 'Code.exe')
        : path.join(installDir, 'code');
      if (fs.existsSync(exe)) return exe;
    }
  } catch { /* fall through */ }

  // Windows fallback: common install locations
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft VS Code', 'Code.exe'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  throw new Error('VSCode not found. Install VSCode or ensure `code` is in PATH.');
}

/**
 * Install PAN Wizard into a directory for a given runtime.
 *
 * @param {string} dir — Project directory (must exist)
 * @param {string} runtime — 'claude' | 'copilot' | 'codex' | 'opencode' | 'gemini'
 */
export function installPanWizard(dir, runtime = 'claude') {
  // Resolve from the PanWizard repo root (2 levels up from tests/e2e/)
  const repoRoot = path.resolve(__dirname, '..', '..');
  const installerPath = path.join(repoRoot, 'bin', 'install.js');
  execFileSync(process.execPath, [installerPath, '--local', `--${runtime}`], {
    cwd: dir,
    stdio: 'pipe',
    timeout: 30_000,
  });
}

/**
 * Create a full E2E project: temp dir, git init, install PAN Wizard.
 *
 * @param {string} [runtime='claude']
 * @returns {{ dir: string, cleanup: () => void }}
 */
export function createE2EProject(runtime = 'claude') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-e2e-'));

  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  installPanWizard(dir, runtime);

  const cleanup = () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  return { dir, cleanup };
}

/**
 * Launch real VSCode on a project directory and run a test module inside it.
 *
 * Uses @vscode/test-electron's runTests, which properly handles the VSCode
 * launcher binary (Code.exe wrapper on Windows, code on macOS/Linux).
 *
 * @param {string} projectDir — Absolute path to the project folder to open
 * @param {string} testModule — Absolute path to a CJS test runner script
 * @returns {Promise<void>} — Resolves on success, rejects on failure
 */
export async function runVSCodeTest(projectDir, testModule) {
  const vscodeExe = await ensureVSCode();
  const stubExtPath = path.join(__dirname, 'stub-extension');

  // Set env var so the test runner knows the workspace root
  const testEnv = { PAN_E2E_WORKSPACE: projectDir };

  // On Windows, resolveCliArgsFromVSCodeExecutablePath returns the code.cmd
  // CLI wrapper which properly forwards flags to the Electron process.
  // Code.exe in VSCode 1.110+ is a native launcher that rejects --flags.
  const [cliPath] = resolveCliArgsFromVSCodeExecutablePath(vscodeExe);

  await runTests({
    vscodeExecutablePath: cliPath,
    extensionDevelopmentPath: stubExtPath,
    extensionTestsPath: testModule,
    extensionTestsEnv: testEnv,
    launchArgs: [
      projectDir,
      '--disable-extensions',
    ],
  });
}
