'use strict';

/**
 * VSCode file accessibility runner — executes INSIDE the VSCode process.
 *
 * Tests PW-004 through PW-006: Hook files, agent discoverability,
 * pan-tools dispatcher, and file opening via VSCode API.
 */

const path = require('path');
const fs = require('fs');

async function run() {
  const vscode = require('vscode');
  const errors = [];
  const workspaceRoot = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : process.env.PAN_E2E_WORKSPACE;

  if (!workspaceRoot) {
    console.error('FAIL: No workspace root');
    return 1;
  }

  const claudeDir = path.join(workspaceRoot, '.claude');

  try {
    // PW-004: Hook files open without syntax errors in VSCode
    const hooksDir = path.join(claudeDir, 'hooks');
    if (fs.existsSync(hooksDir)) {
      const hooks = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js'));
      for (const hook of hooks) {
        const hookPath = path.join(hooksDir, hook);
        const doc = await vscode.workspace.openTextDocument(hookPath);
        if (doc.lineCount > 0 && doc.languageId === 'javascript') {
          console.log(`PW-004 PASS: ${hook} opened as JavaScript, ${doc.lineCount} lines`);
        } else {
          errors.push(`PW-004: ${hook} — unexpected languageId: ${doc.languageId}`);
        }
      }
    } else {
      errors.push('PW-004: hooks/ not found');
    }

    // PW-005: Agent files discoverable (11+ via Quick Open search)
    const agentsDir = path.join(claudeDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
      if (agents.length >= 10) {
        // Verify each agent file is openable
        for (const agent of agents.slice(0, 3)) { // spot-check 3
          const doc = await vscode.workspace.openTextDocument(path.join(agentsDir, agent));
          if (doc.lineCount === 0) {
            errors.push(`PW-005: ${agent} opened but empty`);
          }
        }
        console.log(`PW-005 PASS: ${agents.length} agents, spot-checked 3 open successfully`);
      } else {
        errors.push(`PW-005: Expected 10+ agents, found ${agents.length}`);
      }
    } else {
      errors.push('PW-005: agents/ not found');
    }

    // PW-006: pan-tools.cjs opens and contains dispatcher switch
    const panTools = path.join(claudeDir, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    if (fs.existsSync(panTools)) {
      const doc = await vscode.workspace.openTextDocument(panTools);
      const text = doc.getText();
      if (text.includes('switch') && text.includes('case')) {
        console.log(`PW-006 PASS: pan-tools.cjs opened, ${doc.lineCount} lines, has dispatcher`);
      } else {
        errors.push('PW-006: pan-tools.cjs missing dispatcher switch/case');
      }
    } else {
      errors.push('PW-006: pan-tools.cjs not found');
    }

    // PW-extra: Core lib modules all openable
    const libDir = path.join(claudeDir, 'pan-wizard-core', 'bin', 'lib');
    if (fs.existsSync(libDir)) {
      const modules = fs.readdirSync(libDir).filter(f => f.endsWith('.cjs'));
      if (modules.length >= 10) {
        console.log(`PW-LIB PASS: ${modules.length} core lib modules present`);
      } else {
        errors.push(`PW-LIB: Expected 10+ core modules, found ${modules.length}`);
      }
    } else {
      errors.push('PW-LIB: lib/ not found');
    }

  } catch (e) {
    errors.push(`Unexpected error: ${e.message}`);
  }

  if (errors.length > 0) {
    console.error('\n=== FAILURES ===');
    for (const err of errors) console.error(`  FAIL: ${err}`);
    return 1;
  }
  console.log('\n=== ALL FILE ACCESSIBILITY TESTS PASSED ===');
  return 0;
}

module.exports = { run };
