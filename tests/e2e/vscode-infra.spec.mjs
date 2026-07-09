/**
 * E2E-019: @vscode/test-electron infrastructure tests.
 *
 * Validates that VSCode can be downloaded and that the test runner
 * infrastructure works end-to-end.
 */

import { test, expect } from '@playwright/test';
import { ensureVSCode, createE2EProject, runVSCodeTest } from './vscode-helpers.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('VSCode can be downloaded and executable path resolved', async () => {
  const exePath = await ensureVSCode();
  expect(exePath).toBeTruthy();
  expect(typeof exePath).toBe('string');
});

test('VSCode launches with PAN project and smoke runner passes', async () => {
  const project = createE2EProject('claude');
  try {
    const runnerPath = path.join(__dirname, 'runners', 'smoke-runner.cjs');
    await runVSCodeTest(project.dir, runnerPath);
    // If runVSCodeTest resolves, the runner returned 0 (success)
  } finally {
    project.cleanup();
  }
});
