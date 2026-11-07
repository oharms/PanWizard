/**
 * Durable orchestration Stage A, at the writers: the races store.cjs closes,
 * checked where each writer lives (focus, autodev, the merge gate, the cost
 * cursor), plus a guard that the writers stay on the store.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'pan-wizard-core', 'bin', 'lib');
const focus = require(path.join(LIB, 'focus.cjs'));
const autodev = require(path.join(LIB, 'autodev.cjs'));
const lock = require(path.join(LIB, 'lock.cjs'));

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-adopt-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf-8'));

describe('focus', () => {
  test('a --stop made while focus open measures the tests is kept, and the cycle is still recorded', () => {
    write('.planning/state.md', '# Project State\n');
    write('.planning/focus/batch-2026-11-02.json', JSON.stringify({ date: '2026-11-02', batch: [{ id: 'P1-1', title: 'Guard readdir', file: 'src/a.js', tier: 'MICRO' }] }));
    write('.planning/focus/auto-run.json', JSON.stringify({ run_id: 'auto-2026-11-02-1', status: 'in_progress', max_cycles: 3 }));
    const opened = focus.focusOpen(dir, {
      run: 'auto-2026-11-02-1',
      measure: () => {
        // Another session stops the run while this one is running the tests.
        const run = readJson('.planning/focus/auto-run.json');
        write('.planning/focus/auto-run.json', JSON.stringify({ ...run, status: 'stopped', stop_reason: 'user_stop' }));
        return { passed: 5, status: 'passed', command: 'node t.cjs' };
      },
    });
    assert.equal(opened.opened, true);
    const run = readJson('.planning/focus/auto-run.json');
    assert.equal(run.status, 'stopped', 'the stop is not undone by the open');
    assert.equal(run.stop_reason, 'user_stop');
    assert.equal(run.current_cycle, opened.dir);
  });

  test('the batch close write keeps the batch file\'s mtime', () => {
    write('.planning/state.md', '# Project State\n');
    write('.planning/focus/batch-2026-11-02.json', JSON.stringify({ date: '2026-11-02', batch: [{ id: 'P1-1', title: 'Guard readdir', file: 'src/a.js', tier: 'MICRO' }] }));
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(path.join(dir, '.planning/focus/batch-2026-11-02.json'), old, old);
    const opened = focus.focusOpen(dir, { kind: 'docs', batch: '.planning/focus/batch-2026-11-02.json' });
    const closed = focus.focusClose(dir, { dir: opened.dir, status: 'verified', done: ['P1-1'], measure: false });
    assert.equal(closed.batch_results, 'written');
    const st = fs.statSync(path.join(dir, '.planning/focus/batch-2026-11-02.json'));
    assert.equal(Math.round(st.mtimeMs / 1000), Math.round(old.getTime() / 1000));
    assert.equal(readJson('.planning/focus/batch-2026-11-02.json').results['P1-1'], 'done');
  });
});

describe('autodev', () => {
  test('a run driven by another live process is refused run_busy', async () => {
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
    try {
      write('.planning/autodev/run-x/run.json', JSON.stringify({ id: 'run-x', started: new Date().toISOString(), host: 'claude', limits: {}, owner: { pid: holder.pid, since: 'then' } }));
      const r = autodev.runAutodev(dir, { runId: 'run-x', host: 'claude', maxUsd: 1 });
      assert.equal(r.error, 'run_busy');
      assert.equal(r.owner_pid, holder.pid);
      assert.equal(readJson('.planning/autodev/run-x/run.json').owner.pid, holder.pid, 'the owner is left alone');
    } finally {
      holder.kill();
    }
  });

  test('a run whose owner process has gone is claimed, and released when the call returns', () => {
    write('.planning/autodev/run-y/run.json', JSON.stringify({ id: 'run-y', started: new Date().toISOString(), host: 'nohost', limits: {}, owner: { pid: 2147483646, since: 'then' } }));
    const r = autodev.runAutodev(dir, { runId: 'run-y', host: 'nohost', maxUsd: 1 });
    assert.equal(r.error, 'unsupported_host', 'the claim went through and the run got as far as the host check');
    assert.equal(readJson('.planning/autodev/run-y/run.json').owner, null, 'released on return');
  });
});

describe('merge gate', () => {
  test('two concurrent confirms of one approved request merge once', async () => {
    write('.planning/orchestration/approvals/feat-x.json', JSON.stringify({
      id: 'feat-x', branch: 'feat/x', approval_token: 'tok', ci_green: true, verify_pass: true, status: 'awaiting_approval',
    }));
    const log = path.join(dir, 'merges.log');
    const code = `
      const { confirmMerge } = require(${JSON.stringify(path.join(ROOT, 'pan-wizard-core', 'mcp', 'merge-gate.cjs'))});
      const fs = require('fs');
      const git = (argv) => {
        if (argv[0] === 'merge') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); fs.appendFileSync(${JSON.stringify(log)}, 'merge\\n'); }
        return { ok: true, stdout: '', stderr: '' };
      };
      const r = confirmMerge(${JSON.stringify(dir)}, { branch: 'feat/x' }, { PAN_MERGE_APPROVAL: 'tok' }, git);
      console.log(JSON.stringify(r));`;
    const run = () => new Promise((resolve) => {
      const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('close', () => resolve(JSON.parse(out)));
    });
    const results = await Promise.all([run(), run()]);
    assert.equal(fs.readFileSync(log, 'utf-8').trim().split('\n').length, 1, 'git merge ran once');
    assert.deepEqual(results.map((r) => r.merged).sort(), [false, true]);
    assert.ok(results.find((r) => !r.merged).reasons.includes('already_consumed'));
    assert.equal(readJson('.planning/orchestration/approvals/feat-x.json').status, 'merged');
  });
});

describe('cost cursor', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'hooks', 'pan-cost-logger.js'), 'utf-8');
  const lockSrc = fs.readFileSync(path.join(LIB, 'lock.cjs'), 'utf-8');
  const num = (src, re) => Number(src.match(re)[1].replace(/_/g, ''));

  test('the hook\'s inline lock keeps lock.cjs\'s protocol and timings', () => {
    assert.equal(num(hook, /CURSOR_LOCK_RETRIES = (\d+)/), num(lockSrc, /DEFAULT_RETRIES = (\d+)/));
    assert.equal(num(hook, /CURSOR_LOCK_INTERVAL_MS = (\d+)/), num(lockSrc, /DEFAULT_INTERVAL_MS = (\d+)/));
    assert.equal(num(hook, /CURSOR_LOCK_STALE_MS = ([\d_]+)/), num(lockSrc, /DEFAULT_STALE_MS = ([\d_]+)/));
    assert.match(hook, /flag: 'wx'/);
    assert.match(hook, /renameSync\(tmp, cursorFilePath\(cwd\)\)/, 'the cursor lands by rename');
  });

  test('the hook and lock.cjs name the same lock file for the cursor, through any spelling of the project', () => {
    const H = require(path.join(ROOT, 'hooks', 'pan-cost-logger.js'));
    fs.mkdirSync(path.join(dir, '.planning', 'metrics'), { recursive: true });
    const cursor = path.join(dir, '.planning', 'metrics', H.CURSOR_FILE);
    assert.equal(H.cursorLockPath(dir), lock.lockPathFor(cursor));
    const real = fs.realpathSync.native(dir);
    assert.equal(H.cursorLockPath(real), lock.lockPathFor(cursor), 'the real path meets the same lock');
  });

  test('the hook treats Windows pending-delete errors as contention, as lock.cjs does', () => {
    assert.match(hook, /LOCK_CONTENTION = process\.platform === 'win32' \? \['EPERM', 'EACCES', 'EBUSY'\] : \[\]/);
    assert.match(lockSrc, /CONTENTION = process\.platform === 'win32' \? \['EPERM', 'EACCES', 'EBUSY'\] : \[\]/);
  });

  test('the cursor read and write sit inside one hold of the lock, the slice read before it', () => {
    const peek = hook.indexOf('let since = readCursor(cwd)[keyPath] || 0;');
    const start = hook.indexOf('const cursorLock = acquireCursorLock(cwd);');
    const read = hook.indexOf('const cursor = readCursor(cwd);');
    const release = hook.indexOf('releaseCursorLock(cursorLock);', read);
    assert.ok(peek > 0 && peek < start, 'the transcript slice is read before the lock');
    assert.match(hook.slice(read, release), /if \(\(cursor\[keyPath\] \|\| 0\) !== since\) \{/, 'a moved cursor is re-sliced under the lock');
    assert.match(hook.slice(release - 40, release), /finally \{/, 'released in finally');
    assert.ok(start > 0 && start < read && read < release, 'acquire, then read, then release');
    const writes = [...hook.slice(read, release).matchAll(/writeCursor\(cwd, cursor\)/g)];
    assert.equal(writes.length, 2, 'both cursor writes are inside the hold');
  });
});

// The trace logger keeps its own cursor and fires on the same SubagentStop events, so
// it needs the same hold (M55 in docs/specs/market-ideas-2026-11.md).
describe('trace cursor', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'hooks', 'pan-trace-logger.js'), 'utf-8');
  const lockSrc = fs.readFileSync(path.join(LIB, 'lock.cjs'), 'utf-8');
  const num = (src, re) => Number(src.match(re)[1].replace(/_/g, ''));

  test('the hook\'s inline lock keeps lock.cjs\'s protocol and timings', () => {
    assert.equal(num(hook, /CURSOR_LOCK_RETRIES = (\d+)/), num(lockSrc, /DEFAULT_RETRIES = (\d+)/));
    assert.equal(num(hook, /CURSOR_LOCK_INTERVAL_MS = (\d+)/), num(lockSrc, /DEFAULT_INTERVAL_MS = (\d+)/));
    assert.equal(num(hook, /CURSOR_LOCK_STALE_MS = ([\d_]+)/), num(lockSrc, /DEFAULT_STALE_MS = ([\d_]+)/));
    assert.match(hook, /flag: 'wx'/);
    assert.match(hook, /LOCK_CONTENTION = process\.platform === 'win32' \? \['EPERM', 'EACCES', 'EBUSY'\] : \[\]/);
    assert.match(hook, /renameSync\(tmp, traceCursorPath\(cwd\)\)/, 'the cursor lands by rename');
  });

  test('the hook and lock.cjs name the same lock file for the trace cursor, through any spelling of the project', () => {
    const H = require(path.join(ROOT, 'hooks', 'pan-trace-logger.js'));
    fs.mkdirSync(path.join(dir, '.planning', H.OPTIMIZE_DIR), { recursive: true });
    const cursor = path.join(dir, '.planning', H.OPTIMIZE_DIR, H.TRACE_CURSOR_FILE);
    assert.equal(H.cursorLockPath(dir), lock.lockPathFor(cursor));
    const real = fs.realpathSync.native(dir);
    assert.equal(H.cursorLockPath(real), lock.lockPathFor(cursor), 'the real path meets the same lock');
  });

  test('the cursor read and write sit inside one hold of the lock, the slice read before it', () => {
    const peek = hook.indexOf('let since = readTraceCursor(cwd)[keyPath] || 0;');
    const start = hook.indexOf('const cursorLock = cwd ? acquireCursorLock(cwd) : null;');
    const read = hook.indexOf('const cursor = readTraceCursor(cwd);', start);
    const release = hook.indexOf('releaseCursorLock(cursorLock);', read);
    assert.ok(peek > 0 && peek < start, 'the transcript slice is read before the lock');
    assert.ok(start > 0 && start < read && read < release, 'acquire, then read, then release');
    assert.match(hook.slice(read, release), /if \(\(cursor\[keyPath\] \|\| 0\) !== since\) \{/, 'a moved cursor is re-sliced under the lock');
    assert.match(hook.slice(release - 40, release), /finally \{/, 'released in finally');
    const writes = [...hook.slice(read, release).matchAll(/writeTraceCursor\(cwd, cursor\)/g)];
    assert.equal(writes.length, 2, 'both cursor writes are inside the hold');
  });
});

describe('lock files and git', () => {
  test('a held lock leaves nothing in the project: git and directory listings never see it', () => {
    const { execFileSync } = require('child_process');
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf-8' });
    git('init', '-q');
    write('.planning/state.md', '# Project State\n');
    const state = path.join(dir, '.planning', 'state.md');
    lock.holdLock(state);
    try {
      assert.ok(fs.existsSync(lock.lockPathFor(state)), 'the lock is held');
      assert.ok(!lock.lockPathFor(state).startsWith(dir), 'the lock file is outside the project');
      assert.deepEqual(fs.readdirSync(path.join(dir, '.planning')), ['state.md']);
      git('add', '.planning/');
      const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
      assert.deepEqual(staged, ['.planning/state.md']);
    } finally {
      lock.releaseHeld(state);
    }
  });
});

describe('guard: the writers stay on the store', () => {
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
  const body = (text, name) => {
    const i = text.indexOf(`function ${name}(`);
    assert.ok(i >= 0, `${name} exists`);
    const next = text.indexOf('\nfunction ', i + 1);
    return text.slice(i, next === -1 ? undefined : next);
  };

  for (const [file, fns] of [
    ['pan-wizard-core/bin/lib/focus.cjs', ['writeAutoRun', 'focusRoute', 'focusClose', 'focusOpen']],
    ['pan-wizard-core/bin/lib/autodev.cjs', ['persistRunFacts', 'claimRun', 'releaseRun', 'runAutodevLoop']],
    ['pan-wizard-core/mcp/merge-gate.cjs', ['writeJson', 'confirmMerge', 'confirmMergeLocked']],
  ]) {
    test(`${path.basename(file)}: ${fns.join(', ')} write no orchestration record with writeFileSync`, () => {
      const text = src(file);
      for (const fn of fns) {
        const b = body(text, fn);
        const direct = [...b.matchAll(/fs\.writeFileSync\(([^\n]+)/g)].map((m) => m[1].trim())
          .filter((target) => !/planPath|summary|test-baseline|test-run|cycle\.summary/.test(target));
        assert.deepEqual(direct, [], `${fn} writes ${direct.join(', ')} directly`);
      }
    });
  }

  test('bus publish takes the channel lock, and consume reads its entries inside it', () => {
    const text = src('pan-wizard-core/bin/lib/bus.cjs');
    assert.match(text, /withFileLock\(file, \(\) => fs\.appendFileSync\(file, line/);
    assert.match(text, /withFileLock\(file, \(\) => \{\n\s+read = readChannel\(cwd, channel, opts\);/);
  });

  test('every command that edits planning markdown takes its locks in the dispatcher', () => {
    const tools = src('pan-wizard-core/bin/pan-tools.cjs');
    const i = tools.indexOf("lockCommand(cwd, command, args[1], args)");
    assert.ok(i > 0 && i < tools.indexOf('switch (command) {'), 'locks are taken before dispatch');
  });

  test('lock.cjs is the only lock implementation the engine uses', () => {
    for (const f of fs.readdirSync(LIB).filter((n) => n.endsWith('.cjs') && n !== 'lock.cjs')) {
      const text = fs.readFileSync(path.join(LIB, f), 'utf-8');
      assert.ok(!(/flag: 'wx'/.test(text) && /'\.lock'/.test(text)), `${f} re-implements the lock`);
    }
    assert.equal(typeof lock.holdLock, 'function');
  });
});
