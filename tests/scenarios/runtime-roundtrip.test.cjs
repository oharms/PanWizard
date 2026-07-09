// Per-runtime install-and-invoke round-trip (June 2026 ecosystem review §1,
// "Runtime e2e coverage"). For each runtime: install into a temp dir, extract
// the pan-tools dispatcher path FROM the installed command artifact — not
// from test assumptions — and execute the dispatcher through that exact path.
// This catches the format-migration bug class where converted content embeds
// a path that doesn't resolve on disk (e.g. a renamed config dir or a dead
// skills location), which unit tests on the converters can't see.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const INSTALLER = path.join(PROJECT_ROOT, 'bin', 'install.js');

function runInstaller(cwd, flags) {
  return execFileSync(process.execPath, [INSTALLER, ...flags.split(/\s+/)], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// The pan-git command carries the densest set of dispatcher invocations in
// shipped content, so it is the extraction target in every format.
const RUNTIMES = [
  { flag: '--claude', artifact: ['.claude', 'commands', 'pan', 'git.md'] },
  { flag: '--gemini', artifact: ['.gemini', 'commands', 'pan', 'git.toml'] },
  { flag: '--opencode', artifact: ['.opencode', 'commands', 'pan-git.md'] },
  { flag: '--codex', artifact: ['.agents', 'skills', 'pan-git', 'SKILL.md'] },
  { flag: '--copilot', artifact: ['.github', 'skills', 'pan-git', 'SKILL.md'] },
  // ADR-0028 unified tree: skills must resolve against the shared core
  { flag: '--claude --unified-skills', artifact: ['.agents', 'skills', 'pan-git', 'SKILL.md'] },
];

for (const rt of RUNTIMES) {
  describe(`runtime round-trip: ${rt.flag}`, () => {
    let tmpDir;
    let embeddedPath;   // dispatcher path as written in the installed artifact
    let resolvedPath;   // absolute path it resolves to from the project root

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `pan-roundtrip-${rt.flag.replace(/[^a-z]/g, '')}-`));
      runInstaller(tmpDir, `${rt.flag} --local --skip-warnings`);

      const artifactPath = path.join(tmpDir, ...rt.artifact);
      assert.ok(fs.existsSync(artifactPath), `installed artifact should exist: ${rt.artifact.join('/')}`);
      const content = fs.readFileSync(artifactPath, 'utf8');

      const match = content.match(/(\S*pan-wizard-core[\\/]bin[\\/]pan-tools\.cjs)/);
      assert.ok(match, 'installed artifact should embed a pan-tools dispatcher path');
      embeddedPath = match[1];
      resolvedPath = path.resolve(tmpDir, embeddedPath);
    });

    after(() => {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('embedded dispatcher path is project-relative, not home-anchored', () => {
      assert.ok(!embeddedPath.startsWith('~'),
        `local install must not embed a ~-anchored path, got: ${embeddedPath}`);
    });

    test('embedded dispatcher path resolves to a real file', () => {
      assert.ok(fs.existsSync(resolvedPath),
        `embedded path "${embeddedPath}" should resolve from the project root`);
      assert.ok(fs.statSync(resolvedPath).size > 0, 'dispatcher must be non-empty');
    });

    test('dispatcher executes through the embedded path', () => {
      const out = execFileSync(process.execPath, [resolvedPath, 'current-timestamp', '--raw'], {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      assert.match(out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        `dispatcher should emit an ISO timestamp, got: ${out.slice(0, 80)}`);
    });

    test('dispatcher returns valid JSON through the embedded path', () => {
      const out = execFileSync(process.execPath, [resolvedPath, 'generate-slug', 'Round Trip Check'], {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(out);
      assert.equal(parsed.slug, 'round-trip-check');
    });
  });
}
