/**
 * Tests for lock.cjs — advisory file locking + atomic writes (ADR-0030).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { acquireLock, releaseLock, withFileLock, writeFileAtomic } =
  require('../pan-wizard-core/bin/lib/lock.cjs');

let tmpDir;

beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lock-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('acquireLock / releaseLock', () => {
  test('acquires and releases the lock file', () => {
    const target = path.join(tmpDir, 'state.md');
    const { acquired, lockPath } = acquireLock(target);
    assert.equal(acquired, true);
    assert.ok(fs.existsSync(lockPath), 'lock file should exist while held');
    releaseLock(lockPath);
    assert.ok(!fs.existsSync(lockPath), 'lock file should be gone after release');
  });

  test('contended fresh lock is not acquired within a small retry budget', () => {
    const target = path.join(tmpDir, 'state.md');
    fs.writeFileSync(target + '.lock', '99999'); // fresh foreign lock
    const { acquired } = acquireLock(target, { retries: 2, intervalMs: 5 });
    assert.equal(acquired, false);
    assert.ok(fs.existsSync(target + '.lock'), 'foreign fresh lock must not be stolen');
  });

  test('stale lock (crashed holder) is stolen', () => {
    const target = path.join(tmpDir, 'state.md');
    const lockPath = target + '.lock';
    fs.writeFileSync(lockPath, '99999');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, old, old); // age it past staleMs
    const { acquired } = acquireLock(target, { retries: 2, intervalMs: 5, staleMs: 10_000 });
    assert.equal(acquired, true, 'stale lock should be stolen');
    releaseLock(lockPath);
  });
});

describe('withFileLock', () => {
  test('runs the critical section and reports locked: true', () => {
    const target = path.join(tmpDir, 'state.md');
    const out = withFileLock(target, () => 'done');
    assert.deepEqual(out, { locked: true, result: 'done' });
    assert.ok(!fs.existsSync(target + '.lock'), 'lock released after the section');
  });

  test('falls back to unlocked execution on contention (best-effort v1)', () => {
    const target = path.join(tmpDir, 'state.md');
    fs.writeFileSync(target + '.lock', '99999');
    const out = withFileLock(target, () => 'ran anyway', { retries: 1, intervalMs: 5 });
    assert.equal(out.locked, false, 'should report the lock was not held');
    assert.equal(out.result, 'ran anyway', 'critical section still runs (no new failure mode)');
    assert.ok(fs.existsSync(target + '.lock'), 'foreign lock untouched');
  });

  test('releases the lock even when fn throws', () => {
    const target = path.join(tmpDir, 'state.md');
    assert.throws(() => withFileLock(target, () => { throw new Error('boom'); }), /boom/);
    assert.ok(!fs.existsSync(target + '.lock'), 'lock must not leak on throw');
  });
});

describe('writeFileAtomic', () => {
  test('writes content and leaves no temp files', () => {
    const target = path.join(tmpDir, 'state.md');
    writeFileAtomic(target, '# State\n');
    assert.equal(fs.readFileSync(target, 'utf8'), '# State\n');
    const leftovers = fs.readdirSync(tmpDir).filter(f => f.includes('.tmp'));
    assert.equal(leftovers.length, 0, 'no temp files should remain');
  });

  test('replaces existing content atomically', () => {
    const target = path.join(tmpDir, 'state.md');
    fs.writeFileSync(target, 'old');
    writeFileAtomic(target, 'new');
    assert.equal(fs.readFileSync(target, 'utf8'), 'new');
  });
});

describe('writeStateMd integration (ADR-0030)', () => {
  test('state writes go through the lock and land atomically', () => {
    const { writeStateMd } = require('../pan-wizard-core/bin/lib/state.cjs');
    const planningDir = path.join(tmpDir, '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    const statePath = path.join(planningDir, 'state.md');
    writeStateMd(statePath, '# Project State\n\n**Current Phase:** 1\n', tmpDir);
    const content = fs.readFileSync(statePath, 'utf8');
    assert.ok(content.includes('Current Phase'), 'content should land');
    assert.ok(!fs.existsSync(statePath + '.lock'), 'lock released');
    const leftovers = fs.readdirSync(planningDir).filter(f => f.includes('.tmp'));
    assert.equal(leftovers.length, 0, 'no temp files should remain');
  });
});
