// hygiene's host-memory check (memory optimisation O10): Claude Code's auto memory
// keeps an index, MEMORY.md, and loads only its first 200 lines or 25 KB at session
// start. PAN does not own that store (MI-010) and never writes it; hygiene reads the
// index and reports what the host would silently cut, and index lines holding content
// where a pointer belongs. Every test runs against a fake home.

'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkHostMemory, hostMemoryDir } = require('../pan-wizard-core/bin/lib/hygiene.cjs');
const { runPanTools, cleanup } = require('./helpers.cjs');

let base;
let home;
let proj;
const key = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-');
const index = (root, text) => {
  const dir = path.join(home, '.claude', 'projects', key(root), 'memory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), text);
  return path.join(dir, 'MEMORY.md');
};
const pointer = (i) => `- [Memory ${i}](memory-${i}.md) — a short hook`;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-hostmem-'));
  home = path.join(base, 'home');
  proj = path.join(base, 'proj');
  fs.mkdirSync(path.join(proj, '.planning'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
});
afterEach(() => cleanup(base));

describe('the index against the host\'s load limit', () => {
  test('past 200 lines is a warning; the rest is never loaded', () => {
    index(proj, Array.from({ length: 250 }, (_, i) => pointer(i)).join('\n') + '\n');
    const r = checkHostMemory(proj, { homeDir: home });
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].severity, 'warn');
    assert.match(r.findings[0].detail, /250 lines .* loads only the first 200 lines or 25 KB/);
    assert.equal(r.findings[0].fixable, false, 'PAN never edits the host\'s store');
  });

  test('past 25 KB is a warning even under 200 lines', () => {
    index(proj, Array.from({ length: 100 }, (_, i) => `${pointer(i)} ${'x'.repeat(240)}`).join('\n') + '\n');
    const r = checkHostMemory(proj, { homeDir: home });
    assert.ok(r.findings.some((f) => f.severity === 'warn' && /KB; it loads only/.test(f.detail)));
  });

  test('near the limit is an info finding; a small index is clean', () => {
    index(proj, Array.from({ length: 185 }, (_, i) => pointer(i)).join('\n') + '\n');
    assert.match(checkHostMemory(proj, { homeDir: home }).findings[0].detail, /near the 200-line \/ 25 KB load limit/);
    index(proj, Array.from({ length: 20 }, (_, i) => pointer(i)).join('\n') + '\n');
    assert.deepEqual(checkHostMemory(proj, { homeDir: home }).findings, []);
  });

  test('index lines that hold content instead of a pointer are counted', () => {
    index(proj, [pointer(1), `- ${'detail '.repeat(100)}`, `- ${'more '.repeat(120)}`].join('\n'));
    const f = checkHostMemory(proj, { homeDir: home }).findings;
    assert.equal(f.length, 1);
    assert.match(f[0].detail, /^2 index lines hold content instead of a pointer \(longest 702 characters/);
  });

  test('no index, no finding', () => {
    const r = checkHostMemory(proj, { homeDir: home });
    assert.deepEqual(r.findings, []);
    assert.equal(r.host_memory.index, false);
  });
});

describe('finding the store the way Claude Code does', () => {
  test('keyed by the git root, so a subdirectory finds its repository\'s store', () => {
    const sub = path.join(proj, 'packages', 'api');
    fs.mkdirSync(sub, { recursive: true });
    index(proj, Array.from({ length: 250 }, (_, i) => pointer(i)).join('\n'));
    assert.equal(checkHostMemory(sub, { homeDir: home }).findings.length, 1);
  });

  test('a worktree shares its main repository\'s store', () => {
    const wt = path.join(base, 'wt');
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(proj, '.git', 'worktrees', 'wt')}\n`);
    assert.equal(hostMemoryDir(wt, home).dir, path.join(home, '.claude', 'projects', key(proj), 'memory'));
  });

  test('autoMemoryDirectory in settings moves it, with ~/ meaning the home', () => {
    fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/notes/mem' }));
    const loc = hostMemoryDir(proj, home);
    assert.equal(loc.dir, path.join(home, 'notes', 'mem'));
    assert.equal(loc.source, 'autoMemoryDirectory');
  });
});

describe('through hygiene, read-only', () => {
  test('hygiene scan reports it, and hygiene clean --apply leaves the store byte for byte', () => {
    const file = index(proj, Array.from({ length: 250 }, (_, i) => pointer(i)).join('\n') + '\n');
    const before = fs.readFileSync(file);
    const env = { HOME: home, USERPROFILE: home };
    const { execFileSync } = require('child_process');
    const tools = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const scan = JSON.parse(execFileSync(process.execPath, [tools, 'hygiene', 'scan', '--cwd', proj], { encoding: 'utf8', env: { ...process.env, ...env } }));
    const f = scan.findings.find((x) => x.check === 'host-memory');
    assert.ok(f, JSON.stringify(scan.findings.map((x) => x.check)));
    assert.equal(f.fixable, false);
    assert.equal(scan.host_memory.lines, 250);
    execFileSync(process.execPath, [tools, 'hygiene', 'clean', '--apply', '--cwd', proj], { encoding: 'utf8', env: { ...process.env, ...env } });
    assert.ok(fs.readFileSync(file).equals(before), 'the host\'s store is never written');
    void runPanTools;
  });
});
