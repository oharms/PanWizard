'use strict';

/**
 * VSCode smoke test runner — executes INSIDE the VSCode process.
 *
 * This module is loaded by @vscode/test-electron's runTests().
 * It has access to the `vscode` API and the real workspace.
 *
 * Exports a `run()` function that returns 0 on success, 1 on failure.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function run() {
  // vscode module is available inside the VSCode process
  const vscode = require('vscode');
  const errors = [];

  try {
    // PW-001: VSCode launched successfully with a workspace
    const folders = vscode.workspace.workspaceFolders;
    // Use env var as fallback since workspace folder may not be set via --folder-uri
    const workspaceRoot = (folders && folders.length > 0)
      ? folders[0].uri.fsPath
      : process.env.PAN_E2E_WORKSPACE;

    if (!workspaceRoot) {
      errors.push('PW-001: No workspace folder opened and PAN_E2E_WORKSPACE not set');
      return 1;
    }
    console.log(`PW-001 PASS: Workspace root: ${workspaceRoot}`);

    // PW-002: .claude/ directory visible in workspace
    const claudeDir = path.join(workspaceRoot, '.claude');
    if (!fs.existsSync(claudeDir)) {
      errors.push('PW-002: .claude/ directory not found in workspace');
    } else {
      const entries = fs.readdirSync(claudeDir);
      if (entries.length === 0) {
        errors.push('PW-002: .claude/ directory is empty');
      } else {
        console.log(`PW-002 PASS: .claude/ has ${entries.length} entries`);
      }
    }

    // PW-003: Commands directory has .md files
    const commandsDir = path.join(claudeDir, 'commands', 'pan');
    if (!fs.existsSync(commandsDir)) {
      errors.push('PW-003: commands/pan/ not found');
    } else {
      const cmds = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
      if (cmds.length < 30) {
        errors.push(`PW-003: Expected 30+ command files, found ${cmds.length}`);
      } else {
        console.log(`PW-003 PASS: ${cmds.length} command .md files`);
      }
    }

    // PW-004: Agents directory has .md files
    const agentsDir = path.join(claudeDir, 'agents');
    if (!fs.existsSync(agentsDir)) {
      errors.push('PW-004: agents/ not found');
    } else {
      const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
      if (agents.length < 10) {
        errors.push(`PW-004: Expected 10+ agent files, found ${agents.length}`);
      } else {
        console.log(`PW-004 PASS: ${agents.length} agent .md files`);
      }
    }

    // PW-005: Hook files exist and are valid JS
    const hooksDir = path.join(claudeDir, 'hooks');
    if (!fs.existsSync(hooksDir)) {
      errors.push('PW-005: hooks/ not found');
    } else {
      const hooks = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js'));
      for (const hook of hooks) {
        try {
          require(path.join(hooksDir, hook));
          console.log(`PW-005 PASS: Hook ${hook} loads without error`);
        } catch (e) {
          errors.push(`PW-005: Hook ${hook} failed to load: ${e.message}`);
        }
      }
    }

    // PW-006: pan-tools.cjs exists and has dispatcher
    const panTools = path.join(claudeDir, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    if (!fs.existsSync(panTools)) {
      errors.push('PW-006: pan-tools.cjs not found');
    } else {
      const content = fs.readFileSync(panTools, 'utf8');
      if (!content.includes('switch') || !content.includes('case')) {
        errors.push('PW-006: pan-tools.cjs does not contain dispatcher switch');
      } else {
        console.log('PW-006 PASS: pan-tools.cjs has dispatcher');
      }
    }

    // PW-007: Can open a file via VSCode API
    const helpFile = path.join(commandsDir, 'help.md');
    if (fs.existsSync(helpFile)) {
      const doc = await vscode.workspace.openTextDocument(helpFile);
      if (doc.lineCount > 0) {
        console.log(`PW-007 PASS: help.md opened, ${doc.lineCount} lines`);
      } else {
        errors.push('PW-007: help.md opened but empty');
      }
    } else {
      errors.push('PW-007: help.md not found');
    }

  } catch (e) {
    errors.push(`Unexpected error: ${e.message}`);
  }

  if (errors.length > 0) {
    console.error('\n=== FAILURES ===');
    for (const err of errors) console.error(`  FAIL: ${err}`);
    console.error(`\n${errors.length} failure(s)`);
    return 1;
  }

  console.log('\n=== ALL TESTS PASSED ===');
  return 0;
}

module.exports = { run };
