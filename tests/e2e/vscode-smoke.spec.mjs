/**
 * E2E-020: VSCode smoke — launch + file explorer verification.
 *
 * Runs the smoke-runner inside a real VSCode instance to verify:
 * - PW-001: VSCode launches with workspace
 * - PW-002: .claude/ directory visible
 * - PW-003: 30+ command .md files
 * - PW-004: 10+ agent .md files
 * - PW-005: Hook files load without error
 * - PW-006: pan-tools.cjs has dispatcher
 * - PW-007: help.md opens via VSCode API
 */

import { test } from '@playwright/test';
import { createE2EProject, runVSCodeTest } from './vscode-helpers.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('PW-001..007: Claude install smoke test in real VSCode', async () => {
  const project = createE2EProject('claude');
  try {
    await runVSCodeTest(project.dir, path.join(__dirname, 'runners', 'smoke-runner.cjs'));
  } finally {
    project.cleanup();
  }
});
