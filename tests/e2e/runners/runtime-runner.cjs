'use strict';

/**
 * VSCode multi-runtime structure runner — executes INSIDE the VSCode process.
 *
 * Tests PW-008: Verifies the installed runtime structure matches expectations.
 * The runtime type is passed via PAN_E2E_RUNTIME env var.
 */

const path = require('path');
const fs = require('fs');

async function run() {
  const vscode = require('vscode');
  const errors = [];
  const workspaceRoot = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : process.env.PAN_E2E_WORKSPACE;
  const runtime = process.env.PAN_E2E_RUNTIME || 'claude';

  if (!workspaceRoot) {
    console.error('FAIL: No workspace root');
    return 1;
  }

  try {
    // Runtime-specific directory structure
    const runtimeDirs = {
      claude: { root: '.claude', commands: 'commands/pan', agents: 'agents' },
      copilot: { root: '.github', commands: 'skills', agents: 'agents' },
    };

    const spec = runtimeDirs[runtime];
    if (!spec) {
      errors.push(`PW-008: Unknown runtime "${runtime}"`);
      return 1;
    }

    const rootDir = path.join(workspaceRoot, spec.root);
    if (!fs.existsSync(rootDir)) {
      errors.push(`PW-008: ${spec.root}/ not found for runtime ${runtime}`);
    } else {
      console.log(`PW-008 PASS: ${spec.root}/ exists for ${runtime}`);
    }

    // Commands/skills directory
    const cmdsDir = path.join(rootDir, spec.commands);
    if (fs.existsSync(cmdsDir)) {
      const items = fs.readdirSync(cmdsDir);
      if (items.length >= 20) {
        console.log(`PW-008 PASS: ${spec.commands}/ has ${items.length} items for ${runtime}`);
      } else {
        errors.push(`PW-008: ${spec.commands}/ has only ${items.length} items (expected 20+)`);
      }
    } else {
      errors.push(`PW-008: ${spec.commands}/ not found`);
    }

    // pan-wizard-core always present
    const corePath = path.join(rootDir, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    if (fs.existsSync(corePath)) {
      console.log(`PW-008 PASS: pan-tools.cjs present for ${runtime}`);
    } else {
      errors.push(`PW-008: pan-tools.cjs not found for ${runtime}`);
    }

  } catch (e) {
    errors.push(`Unexpected error: ${e.message}`);
  }

  if (errors.length > 0) {
    console.error('\n=== FAILURES ===');
    for (const err of errors) console.error(`  FAIL: ${err}`);
    return 1;
  }
  console.log(`\n=== RUNTIME ${runtime.toUpperCase()} TESTS PASSED ===`);
  return 0;
}

module.exports = { run };
