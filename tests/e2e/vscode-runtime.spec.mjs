/**
 * E2E-022: VSCode multi-runtime structure verification.
 *
 * Runs the runtime-runner inside a real VSCode instance for each runtime,
 * verifying that the correct directory structure is visible.
 * - PW-008: Claude → .claude/, Copilot → .github/
 */

import { test } from '@playwright/test';
import { ensureVSCode, createE2EProject, runVSCodeTest } from './vscode-helpers.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(__dirname, 'runners', 'runtime-runner.cjs');
const stubExtPath = path.join(__dirname, 'stub-extension');

test('PW-008: Claude install structure visible in VSCode', async () => {
  const project = createE2EProject('claude');
  try {
    await runVSCodeTest(project.dir, runnerPath);
  } finally {
    project.cleanup();
  }
});

test('PW-008: Copilot install structure visible in VSCode', async () => {
  const project = createE2EProject('copilot');
  try {
    // Need to pass PAN_E2E_RUNTIME=copilot to the runner
    const vscodeExe = await ensureVSCode();
    const [cliPath] = resolveCliArgsFromVSCodeExecutablePath(vscodeExe);

    await runTests({
      vscodeExecutablePath: cliPath,
      extensionDevelopmentPath: stubExtPath,
      extensionTestsPath: runnerPath,
      extensionTestsEnv: {
        PAN_E2E_WORKSPACE: project.dir,
        PAN_E2E_RUNTIME: 'copilot',
      },
      launchArgs: [
        project.dir,
        '--disable-extensions',
      ],
    });
  } finally {
    project.cleanup();
  }
});
