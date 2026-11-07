// `install.js --dry-run` (M54, MI-145 in docs/specs/market-ideas-2026-11.md): list the
// files a local install or uninstall would add, change or delete, and write nothing.
// It installs into a throwaway copy of lib.DRY_RUN_PATHS, so these tests hold it to
// two promises: the project is untouched, and the list is exactly what a real run
// then writes. A third keeps DRY_RUN_PATHS complete.

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const lib = require('../bin/install-lib.cjs');
const { installInto, INSTALLER_PATH, cleanup } = require('./helpers.cjs');

const dryRun = (cwd, flags) => {
  const r = spawnSync(process.execPath, [INSTALLER_PATH, ...flags, '--dry-run', '--json'], { cwd, encoding: 'utf8', timeout: 120000 });
  return { status: r.status, json: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
};
const everything = (dir) => lib.snapshotPaths(dir, fs.readdirSync(dir));

let project;
beforeEach(() => {
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-dry-run-test-')));
});
afterEach(() => cleanup(project));

describe('the pure helpers', () => {
  test('dryRunArgs drops only the preview flags', () => {
    assert.deepEqual(lib.dryRunArgs(['--claude', '--dry-run', '--local', '--json', '--unified-skills']), ['--claude', '--local', '--unified-skills']);
  });

  test('diffSnapshots sorts added, changed and deleted paths', () => {
    const before = new Map([['a', '1'], ['b', '2'], ['d', '4']]);
    const after = new Map([['a', '1'], ['b', '9'], ['c', '3']]);
    assert.deepEqual(lib.diffSnapshots(before, after), { added: ['c'], changed: ['b'], deleted: ['d'] });
    assert.deepEqual(lib.diffSnapshots(new Map(), new Map()), { added: [], changed: [], deleted: [] });
  });

  test('snapshotPaths reads only the named paths and skips missing ones', () => {
    fs.mkdirSync(path.join(project, '.claude', 'x'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'x', 'f.md'), 'one');
    fs.writeFileSync(path.join(project, 'other.txt'), 'not listed');
    const snap = lib.snapshotPaths(project, ['.claude', 'AGENTS.md']);
    assert.deepEqual([...snap.keys()], ['.claude/x/f.md']);
  });
});

describe('a dry run', () => {
  test('writes nothing, and lists exactly what the real install then writes', () => {
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# my project notes\n');
    fs.mkdirSync(path.join(project, '.planning'));
    fs.writeFileSync(path.join(project, '.planning', 'config.json'), '{}\n');
    const untouched = everything(project);
    const r = dryRun(project, ['--claude', '--local']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.dry_run, true);
    assert.deepEqual(everything(project), untouched, 'the project is byte-identical after a dry run');

    const before = lib.snapshotPaths(project, lib.DRY_RUN_PATHS);
    assert.ok(installInto(project, ['--claude', '--local']).success);
    const real = lib.diffSnapshots(before, lib.snapshotPaths(project, lib.DRY_RUN_PATHS));
    assert.deepEqual(r.json.added, real.added);
    assert.ok(real.added.length > 0 && r.json.changed.includes('CLAUDE.md'), 'the existing CLAUDE.md is reported as changed');
    // The manifest records when it was written; every other change must match.
    const withoutManifest = (list) => list.filter((p) => !p.endsWith('pan-file-manifest.json'));
    assert.deepEqual(withoutManifest(r.json.changed), withoutManifest(real.changed));
    assert.deepEqual(r.json.deleted, real.deleted);
    assert.deepEqual(r.json.outside_project, []);
  });

  test('an uninstall preview lists the deletions and keeps them', () => {
    assert.ok(installInto(project, ['--claude', '--local']).success);
    const installed = everything(project);
    const r = dryRun(project, ['--claude', '--local', '--uninstall']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.json.deleted.some((p) => p.startsWith('.claude/agents/pan-')), 'PAN agents would be removed');
    assert.deepEqual(everything(project), installed, 'nothing was removed');
  });

  test('a global preview is refused and writes nothing', () => {
    const r = spawnSync(process.execPath, [INSTALLER_PATH, '--claude', '--global', '--dry-run'], { cwd: project, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--dry-run previews a local install/);
    assert.deepEqual(fs.readdirSync(project), []);
  });

  test('the report is never cut short: the run ends by setting the exit code, not by process.exit()', () => {
    // On macOS stdout to a pipe is asynchronous; exiting right after the write
    // truncated the JSON on CI (Node 18 and 20) while every other platform passed.
    const src = fs.readFileSync(INSTALLER_PATH, 'utf8');
    const start = src.indexOf('function runDryRun()');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    const afterWrite = body.slice(body.indexOf('process.stdout.write('));
    assert.ok(start > 0 && afterWrite.length > 0);
    assert.doesNotMatch(afterWrite, /process\.exit\(/);
    assert.match(afterWrite, /process\.exitCode = code;/);
  });

  test('the source repository is refused', () => {
    const repo = path.resolve(__dirname, '..');
    const r = spawnSync(process.execPath, [INSTALLER_PATH, '--claude', '--dry-run'], { cwd: repo, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /PAN source repository/);
  });
});

describe('DRY_RUN_PATHS stays complete', () => {
  for (const flags of [['--all', '--local'], ['--all', '--local', '--unified-skills']]) {
    test(`a real ${flags.join(' ')} install creates nothing at the top level outside the list`, () => {
      const out = execFileSync(process.execPath, [INSTALLER_PATH, ...flags], { cwd: project, encoding: 'utf8', timeout: 120000 });
      assert.ok(out.length > 0);
      const allowed = new Set(lib.DRY_RUN_PATHS.map((p) => p.split('/')[0]));
      const extra = fs.readdirSync(project).filter((name) => !allowed.has(name));
      assert.deepEqual(extra, [], `add these to DRY_RUN_PATHS: ${extra.join(', ')}`);
    });
  }
});
