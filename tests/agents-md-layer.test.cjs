// AGENTS.md universal rules layer (ADR-0028 Phase 3). Local installs
// contribute one marker-fenced PAN section to the project's AGENTS.md and
// bridge CLAUDE.md via @AGENTS.md for the Claude runtime; uninstall strips
// the section only when the last PAN runtime leaves the project. User
// content outside the markers is never touched.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(PROJECT_ROOT, 'bin', 'install.js');
const BEGIN = '<!-- BEGIN PAN WIZARD -->';

function runInstaller(cwd, flags) {
  return execFileSync(process.execPath, [INSTALLER, ...flags.split(/\s+/)], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function countBlocks(cwd, fileName) {
  try {
    return fs.readFileSync(path.join(cwd, fileName), 'utf8').split(BEGIN).length - 1;
  } catch {
    return -1; // file absent
  }
}

describe('AGENTS.md rules layer: install/uninstall lifecycle', () => {
  let tmpDir;
  let afterClaudeUninstall;
  let afterLastUninstall;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-agentsmd-'));
    // Pre-existing user rules file — must survive everything below.
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# My rules\n\nUse tabs.\n');

    runInstaller(tmpDir, '--claude --local --skip-warnings');
    runInstaller(tmpDir, '--codex --local --skip-warnings'); // second runtime + idempotency

    runInstaller(tmpDir, '--claude --local --uninstall');
    afterClaudeUninstall = {
      agentsBlocks: countBlocks(tmpDir, 'AGENTS.md'),
      claudeBlocks: countBlocks(tmpDir, 'CLAUDE.md'),
    };

    runInstaller(tmpDir, '--codex --local --uninstall');
    afterLastUninstall = {
      agentsContent: fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8'),
      claudeMdExists: fs.existsSync(path.join(tmpDir, 'CLAUDE.md')),
    };
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('install adds exactly one PAN section across multiple runtimes (idempotent)', () => {
    // Checked via the post-claude-uninstall snapshot: codex still installed,
    // so the single section must still be present.
    assert.equal(afterClaudeUninstall.agentsBlocks, 1,
      'AGENTS.md should carry exactly one PAN block while a runtime remains');
  });

  test('claude install bridges CLAUDE.md; bridge survives while another runtime remains', () => {
    assert.equal(afterClaudeUninstall.claudeBlocks, 1,
      'CLAUDE.md bridge should remain while codex is still installed');
  });

  test('last uninstall strips the PAN section, preserves user content', () => {
    assert.ok(afterLastUninstall.agentsContent.includes('# My rules'));
    assert.ok(afterLastUninstall.agentsContent.includes('Use tabs.'));
    assert.ok(!afterLastUninstall.agentsContent.includes(BEGIN),
      'PAN block should be gone after the last runtime uninstalls');
  });

  test('last uninstall removes CLAUDE.md when only the bridge remained', () => {
    assert.equal(afterLastUninstall.claudeMdExists, false);
  });
});

describe('AGENTS.md rules layer: global installs do not touch project files', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-agentsmd-global-'));
    const fakeHome = path.join(tmpDir, 'home');
    fs.mkdirSync(fakeHome, { recursive: true });
    runInstaller(tmpDir, `--claude --global --config-dir ${path.join(fakeHome, '.claude')} --skip-warnings`);
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('no AGENTS.md or CLAUDE.md is created in the working directory', () => {
    assert.ok(!fs.existsSync(path.join(tmpDir, 'AGENTS.md')), 'global install must not write project AGENTS.md');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'CLAUDE.md')), 'global install must not write project CLAUDE.md');
  });
});
