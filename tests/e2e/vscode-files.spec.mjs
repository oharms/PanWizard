/**
 * E2E-021: VSCode file accessibility — commands, agents, hooks, core.
 *
 * Runs the files-runner inside a real VSCode instance to verify:
 * - PW-004: Hook files open as JavaScript
 * - PW-005: Agent files discoverable and openable
 * - PW-006: pan-tools.cjs opens with dispatcher
 * - PW-LIB: 10+ core lib modules present
 */

import { test } from '@playwright/test';
import { createE2EProject, runVSCodeTest } from './vscode-helpers.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('PW-004..006: File accessibility in real VSCode', async () => {
  const project = createE2EProject('claude');
  try {
    await runVSCodeTest(project.dir, path.join(__dirname, 'runners', 'files-runner.cjs'));
  } finally {
    project.cleanup();
  }
});
