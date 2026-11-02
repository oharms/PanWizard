/**
 * Tests for store.cjs — one write path for orchestration files (durable
 * orchestration Stage A), the lock.cjs changes it rests on, and the races the
 * stage closes, run with real concurrent processes.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const store = require('../pan-wizard-core/bin/lib/store.cjs');
const lock = require('../pan-wizard-core/bin/lib/lock.cjs');
const lk = (f) => { const p = require('../pan-wizard-core/bin/lib/lock.cjs').lockPathFor(f); fs.mkdirSync(path.dirname(p), { recursive: true }); return p; };

const LIB = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib');
const TOOLS = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-store-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** Run `node -e code` in n child processes at once; resolves with their exit codes. */
function parallel(n, code, cwd) {
  return Promise.all(Array.from({ length: n }, () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', code], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (status) => resolve({ status, err }));
  })));
}

describe('updateRecord', () => {
  test('creates the record with _rev 1 and returns it', () => {
    const f = path.join(tmp, 'a', 'run.json');
    const r = store.updateRecord(f, (cur) => ({ ...(cur || {}), status: 'initialized' }));
    assert.equal(r.ok, true);
    assert.equal(r.written, true);
    assert.equal(r.rev, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf-8')), { status: 'initialized', _rev: 1 });
    assert.ok(!fs.existsSync(lk(f)), 'the lock is released after the write');
  });

  test('a record without _rev reads as revision 0 and its first write sets 1', () => {
    const f = path.join(tmp, 'old.json');
    fs.writeFileSync(f, JSON.stringify({ status: 'stopped' }));
    assert.equal(store.readRecord(f).rev, 0);
    const r = store.updateRecord(f, (cur) => ({ ...cur, status: 'in_progress' }));
    assert.equal(r.rev, 1);
    assert.equal(store.readRecord(f).data.status, 'in_progress');
  });

  test('mutate sees the record as it is on disk now, not as an earlier read had it', () => {
    const f = path.join(tmp, 'run.json');
    store.updateRecord(f, () => ({ status: 'in_progress', n: 1 }));
    const early = store.readRecord(f).data;
    store.updateRecord(f, (cur) => ({ ...cur, status: 'stopped' })); // another writer, in between
    store.updateRecord(f, (cur) => ({ ...cur, n: early.n + 1 }));
    const now = store.readRecord(f).data;
    assert.equal(now.status, 'stopped', 'the in-between write is kept');
    assert.equal(now.n, 2);
  });

  test('expectRev mismatch refuses stale_write and leaves the file alone', () => {
    const f = path.join(tmp, 'run.json');
    store.updateRecord(f, () => ({ v: 1 }));
    store.updateRecord(f, (cur) => ({ ...cur, v: 2 }));
    const before = fs.readFileSync(f, 'utf-8');
    const r = store.updateRecord(f, (cur) => ({ ...cur, v: 99 }), { expectRev: 1 });
    assert.equal(r.error, 'stale_write');
    assert.equal(r.expected, 1);
    assert.equal(r.actual, 2);
    assert.equal(fs.readFileSync(f, 'utf-8'), before);
  });

  test('abort() refuses with its payload and writes nothing; null leaves the file alone', () => {
    const f = path.join(tmp, 'run.json');
    store.updateRecord(f, () => ({ status: 'completed' }));
    const before = fs.readFileSync(f, 'utf-8');
    const r = store.updateRecord(f, (cur) => (cur.status === 'completed' ? store.abort({ error: 'illegal', from: cur.status }) : cur));
    assert.deepEqual(r, { error: 'illegal', from: 'completed' });
    const n = store.updateRecord(f, () => null);
    assert.equal(n.written, false);
    assert.equal(fs.readFileSync(f, 'utf-8'), before);
  });

  test('an unreadable record is reported, not overwritten', () => {
    const f = path.join(tmp, 'run.json');
    fs.writeFileSync(f, '{ not json');
    const r = store.updateRecord(f, () => ({ fresh: true }));
    assert.equal(r.error, 'unreadable');
    assert.equal(fs.readFileSync(f, 'utf-8'), '{ not json');
  });

  test('keepMtime restores the mtime that orders same-day files', () => {
    const f = path.join(tmp, 'batch.json');
    store.updateRecord(f, () => ({ batch: [] }));
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(f, old, old);
    store.updateRecord(f, (cur) => ({ ...cur, results: { a: 'done' } }), { keepMtime: true });
    assert.equal(Math.round(fs.statSync(f).mtimeMs / 1000), Math.round(old.getTime() / 1000));
  });

  test('a lock held by a live foreign holder refuses lock_timeout (strict) and writes nothing', () => {
    const f = path.join(tmp, 'run.json');
    store.updateRecord(f, () => ({ v: 1 }));
    fs.writeFileSync(lk(f), '99999'); // fresh foreign lock
    const t0 = Date.now();
    const r = store.updateRecord(f, (cur) => ({ ...cur, v: 2 }));
    assert.equal(r.error, 'lock_timeout');
    assert.equal(r.lock, lk(f));
    assert.ok(Date.now() - t0 >= 4000, 'a strict caller waits about 5 s before refusing');
    assert.equal(store.readRecord(f).data.v, 1);
  });

  test('a stale lock (crashed holder) is stolen and the write goes through', () => {
    const f = path.join(tmp, 'run.json');
    fs.writeFileSync(lk(f), '99999');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lk(f), old, old);
    const r = store.updateRecord(f, () => ({ v: 1 }));
    assert.equal(r.ok, true);
  });
});

describe('updateText', () => {
  test('writes markdown with nothing added and returns its hash', () => {
    const f = path.join(tmp, 'roadmap.md');
    fs.writeFileSync(f, '# Roadmap\n');
    const r = store.updateText(f, (raw) => raw + '- [ ] Phase 1\n');
    assert.equal(r.written, true);
    assert.equal(fs.readFileSync(f, 'utf-8'), '# Roadmap\n- [ ] Phase 1\n');
    assert.equal(r.hash, store.hashOf('# Roadmap\n- [ ] Phase 1\n'));
  });

  test('expectHash on unchanged CRLF content succeeds (hash of the raw bytes)', () => {
    const f = path.join(tmp, 'state.md');
    fs.writeFileSync(f, '# State\r\n**Status:** Ready\r\n');
    const h = store.hashOf(fs.readFileSync(f, 'utf-8'));
    const r = store.updateText(f, (raw) => raw.replace('Ready', 'Done'), { expectHash: h });
    assert.equal(r.written, true);
    assert.equal(fs.readFileSync(f, 'utf-8'), '# State\r\n**Status:** Done\r\n');
  });

  test('expectHash after another write refuses stale_write', () => {
    const f = path.join(tmp, 'state.md');
    fs.writeFileSync(f, 'a\n');
    const h = store.hashOf('a\n');
    fs.writeFileSync(f, 'b\n');
    const r = store.updateText(f, () => 'c\n', { expectHash: h });
    assert.equal(r.error, 'stale_write');
    assert.equal(fs.readFileSync(f, 'utf-8'), 'b\n');
  });
});

describe('appendLine', () => {
  test('numbers lines seq 1, 2, 3 and skips a torn last line when counting', () => {
    const f = path.join(tmp, 'j', 'journal.jsonl');
    assert.equal(store.appendLine(f, { event: 'started' }).seq, 1);
    assert.equal(store.appendLine(f, (seq) => ({ event: 'completed', note: `n${seq}` })).seq, 2);
    fs.appendFileSync(f, '{"seq": 3, "ev');
    fs.appendFileSync(f, '\n');
    assert.equal(store.appendLine(f, { event: 'started' }).seq, 3);
    const rows = fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean);
    assert.deepEqual(JSON.parse(rows[1]), { seq: 2, event: 'completed', note: 'n2' });
  });
});

describe('reserveDir', () => {
  test('claims the computed number, then the next one when it is taken', () => {
    const parent = path.join(tmp, 'quick');
    const a = store.reserveDir(parent, (n) => `${n}-focus-exec-2026-11-02`, () => 3);
    assert.equal(a.ok, true);
    assert.equal(a.n, 3);
    const b = store.reserveDir(parent, (n) => `${n}-focus-exec-2026-11-02`, 3);
    assert.equal(b.n, 4);
    assert.ok(fs.existsSync(b.dir));
  });
});

describe('lock.cjs — re-entrant holds, strict mode, exit release', () => {
  test('a nested withFileLock on a held path runs without re-locking', () => {
    const f = path.join(tmp, 'state.md');
    let inner = null;
    lock.withFileLock(f, () => {
      inner = lock.withFileLock(f, () => 'nested');
      assert.ok(fs.existsSync(lk(f)), 'the outer hold keeps the lock');
    });
    assert.equal(inner.locked, true);
    assert.equal(inner.result, 'nested');
    assert.ok(!fs.existsSync(lk(f)));
  });

  test('strict withFileLock does not run the section on timeout', () => {
    const f = path.join(tmp, 'state.md');
    fs.writeFileSync(lk(f), '99999');
    let ran = false;
    const r = lock.withFileLock(f, () => { ran = true; }, { strict: true, retries: 2, intervalMs: 5 });
    assert.equal(r.timedOut, true);
    assert.equal(ran, false);
  });

  test('a lock still held when the process exits is released', () => {
    const f = path.join(tmp, 'state.md');
    const r = spawnSync(process.execPath, ['-e', `
      const { holdLock } = require(${JSON.stringify(path.join(LIB, 'lock.cjs'))});
      holdLock(${JSON.stringify(f)});
      process.exit(1);`], { encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.ok(!fs.existsSync(lk(f)), 'the exit handler released the lock');
  });

  test('writeFileAtomic reports atomic: true on a normal write', () => {
    const f = path.join(tmp, 'x.json');
    assert.deepEqual(lock.writeFileAtomic(f, '{}'), { atomic: true });
    assert.ok(!fs.readdirSync(tmp).some((n) => n.endsWith('.tmp')));
  });
});

describe('commandLockFiles', () => {
  test('names the planning files a command reads and writes, in a fixed order', () => {
    assert.deepEqual(store.commandLockFiles('phase', 'complete'), ['roadmap.md', 'requirements.md', 'state.md']);
    assert.deepEqual(store.commandLockFiles('state', 'update'), ['state.md']);
    assert.deepEqual(store.commandLockFiles('validate', 'health'), ['config.json', 'roadmap.md', 'requirements.md', 'state.md']);
    assert.deepEqual(store.commandLockFiles('focus', 'close'), []);
  });

  test('under concurrency.strict a held lock refuses the command before it reads anything', () => {
    const planning = path.join(tmp, '.planning');
    fs.mkdirSync(planning);
    fs.writeFileSync(path.join(planning, 'config.json'), JSON.stringify({ concurrency: { strict: true } }));
    fs.writeFileSync(path.join(planning, 'state.md'), '# State\n\n**Status:** Ready\n');
    fs.writeFileSync(lk(path.join(planning, 'state.md')), '99999');
    const r = spawnSync(process.execPath, [TOOLS, 'state', 'update', 'Status', 'Done'], { cwd: tmp, encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, 'lock_timeout');
    assert.match(fs.readFileSync(path.join(planning, 'state.md'), 'utf-8'), /Ready/);
  });
});

describe('races, with real concurrent processes', () => {
  test('8 processes x 25 updateRecord increments lose nothing', async () => {
    const f = path.join(tmp, 'counter.json');
    const code = `
      const store = require(${JSON.stringify(path.join(LIB, 'store.cjs'))});
      for (let i = 0; i < 25; i++) {
        const r = store.updateRecord(${JSON.stringify(f)}, (cur) => ({ n: ((cur && cur.n) || 0) + 1 }));
        if (!r.ok) { console.error(JSON.stringify(r)); process.exit(1); }
      }`;
    const results = await parallel(8, code, tmp);
    assert.deepEqual(results.map((r) => r.status), Array(8).fill(0), results.map((r) => r.err).join('\n'));
    const rec = store.readRecord(f).data;
    assert.equal(rec.n, 200);
    assert.equal(rec._rev, 200);
  });

  test('6 processes x 10 appendLine give unique, gap-free seq', async () => {
    const f = path.join(tmp, 'journal.jsonl');
    const code = `
      const store = require(${JSON.stringify(path.join(LIB, 'store.cjs'))});
      for (let i = 0; i < 10; i++) store.appendLine(${JSON.stringify(f)}, { pid: process.pid });`;
    await parallel(6, code, tmp);
    const seqs = fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l).seq);
    assert.deepEqual(seqs, Array.from({ length: 60 }, (_, i) => i + 1));
  });

  test('concurrent `state record-metric` commands keep every row in state.md', async () => {
    const planning = path.join(tmp, '.planning');
    fs.mkdirSync(planning);
    fs.writeFileSync(path.join(planning, 'state.md'),
      '# Project State\n\n## Performance Metrics\n\n| Plan | Duration | Tasks | Files |\n|------|----------|-------|-------|\n');
    const code = `
      const { spawnSync } = require('child_process');
      for (let i = 0; i < 3; i++) {
        spawnSync(process.execPath, [${JSON.stringify(TOOLS)}, 'state', 'record-metric', '--phase', '1', '--plan', String(process.pid) + '-' + i, '--duration', '1m'], { cwd: ${JSON.stringify(tmp)} });
      }`;
    await parallel(5, code, tmp);
    const rows = fs.readFileSync(path.join(planning, 'state.md'), 'utf-8').split('\n').filter((l) => /^\| Phase 1 P/.test(l));
    assert.equal(rows.length, 15, 'every command\'s row is kept');
  });

  test('concurrent reserveDir calls never hand out one number twice', async () => {
    const parent = path.join(tmp, 'quick');
    const code = `
      const fs = require('fs');
      const store = require(${JSON.stringify(path.join(LIB, 'store.cjs'))});
      const next = () => { try { return Math.max(0, ...fs.readdirSync(${JSON.stringify(parent)}).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n))) + 1; } catch { return 1; } };
      for (let i = 0; i < 5; i++) store.reserveDir(${JSON.stringify(parent)}, (n) => n + '-task-' + process.pid, next);`;
    await parallel(4, code, tmp);
    const nums = fs.readdirSync(parent).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
