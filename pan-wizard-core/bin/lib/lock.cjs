/**
 * Lock — advisory file locking + atomic writes for .planning/ concurrency
 * (ADR-0030). Zero dependencies, synchronous (matches the CJS codebase),
 * cross-platform: exclusive-create (`wx`) is atomic on NTFS and POSIX alike.
 *
 * v1 semantics are BEST-EFFORT serialization: when the lock cannot be
 * acquired within the retry budget, callers fall back to the unlocked write
 * (today's behavior) rather than failing — concurrent fleets get lost-update
 * protection in the common case without introducing a new failure mode for
 * single-agent users. Strict mode (fail on timeout) is the documented
 * escalation path in ADR-0030, taken by `opts.strict`: a strict caller's
 * critical section does not run when the lock is not acquired.
 *
 * Locks are re-entrant within a process (a nested withFileLock on a path this
 * process already holds runs without re-locking), and every lock still held
 * when the process exits — output() and error() end the process — is released
 * by an exit handler, so a command can hold a lock across its whole run.
 *
 * Lock files live outside the project, in <os temp>/pan-locks/, named by a
 * hash of the guarded file's absolute path: a command that commits or lists
 * `.planning/` while it holds a lock never sees the lock file, and nothing is
 * written into a planning tree PAN does not own. Every process on the machine
 * resolves the same file to the same lock.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_RETRIES = 40;
const DEFAULT_INTERVAL_MS = 25;
const DEFAULT_STALE_MS = 10_000;
const STRICT_WAIT_MS = 7_000;          // strict callers: inside the 10 s stale window
const LOCK_DIR = 'pan-locks';
const RENAME_RETRIES = 5;
const RENAME_INTERVAL_MS = 20;

// path -> { lockPath, depth }: the locks this process holds.
const held = new Map();
let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const { lockPath } of held.values()) releaseLock(lockPath);
    held.clear();
  });
}

// Synchronous sleep without busy-waiting: Atomics.wait on a throwaway buffer.
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

/**
 * The lock file that guards filePath: <os temp>/pan-locks/<hash>-<name>.lock.
 * The path is resolved, and lower-cased on Windows, whose paths are
 * case-insensitive, so every spelling of one file meets at one lock.
 */
function lockPathFor(filePath) {
  let abs = path.resolve(filePath);
  if (process.platform === 'win32') abs = abs.toLowerCase();
  const hash = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 20);
  return path.join(os.tmpdir(), LOCK_DIR, `${hash}-${path.basename(filePath)}.lock`);
}

/**
 * Try to acquire filePath's lock (see lockPathFor). Stale locks
 * (older than staleMs — a crashed holder) are stolen. Waits are jittered, so
 * contenders polling the same lock do not wake in step and starve one another.
 * @returns {{ acquired: boolean, lockPath: string }}
 */
function acquireLock(filePath, opts = {}) {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const lockPath = lockPathFor(filePath);
  try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch { return { acquired: false, lockPath }; }

  // A strict caller waits by the clock, not by a count: on a slow filesystem a
  // count of retries ran past the stale window, and the wait then stole a live lock.
  const deadline = opts.strict && opts.retries == null ? Date.now() + STRICT_WAIT_MS : null;
  const more = (attempt) => (deadline ? Date.now() < deadline : attempt < retries);

  for (let attempt = 0; deadline ? true : attempt <= retries; attempt++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return { acquired: true, lockPath };
    } catch (err) {
      // Windows answers EPERM (not EEXIST) while a released lock file is still
      // being deleted: that is contention too, so wait and retry.
      if (['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) {
        if (!more(attempt)) break;
        sleepSync(Math.max(1, Math.round(intervalMs * (0.5 + Math.random()))));
        continue;
      }
      if (err.code !== 'EEXIST') {
        // Lock dir unwritable etc. — treat as unacquirable, don't spin.
        return { acquired: false, lockPath };
      }
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > staleMs) {
          // Holder likely crashed — steal via an atomic rename to a unique name.
          // rename() moves the specific inode: exactly ONE concurrent stealer can
          // rename a given lock file; every other contender's rename fails with
          // ENOENT (the source is gone) instead of blindly unlinking a lock that a
          // winner may already have re-created. This closes the double-holder race
          // where two processes both stat the same stale lock and both unlink it.
          const stealPath = `${lockPath}.steal.${process.pid}.${Date.now()}`;
          try {
            fs.renameSync(lockPath, stealPath);
            // We won the steal — discard the stolen lock and retry wx-create.
            try { fs.unlinkSync(stealPath); } catch { /* best-effort */ }
          } catch { /* another contender stole/cleared it first — loop retries */ }
          continue;
        }
      } catch { /* lock vanished between EEXIST and stat — loop retries */ }
      if (!more(attempt)) break;
      sleepSync(Math.max(1, Math.round(intervalMs * (0.5 + Math.random()))));
    }
  }
  return { acquired: false, lockPath };
}

/**
 * Release a lock acquired by acquireLock. Best-effort, but ownership-verified:
 * only unlink when the lock file still contains THIS process's pid, so a lock
 * that was stolen (stale) and re-created by a successor is never deleted out
 * from under that successor.
 */
function releaseLock(lockPath) {
  try {
    const owner = fs.readFileSync(lockPath, 'utf-8').trim();
    if (owner !== String(process.pid)) return; // not ours anymore — leave it
    fs.unlinkSync(lockPath);
  } catch { /* already gone / unreadable — nothing to release */ }
}

/**
 * Take <filePath>.lock and keep it until releaseHeld() or process exit.
 * Re-entrant: a path this process already holds only deepens the hold.
 * @returns {{ acquired: boolean, lockPath: string }}
 */
function holdLock(filePath, opts = {}) {
  const key = require('path').resolve(filePath);
  const mine = held.get(key);
  if (mine) { mine.depth++; return { acquired: true, lockPath: mine.lockPath }; }
  const got = acquireLock(filePath, opts);
  if (got.acquired) {
    installExitHook();
    held.set(key, { lockPath: got.lockPath, depth: 1 });
  }
  return got;
}

/** Undo one holdLock(); the lock file goes when the outermost hold ends. */
function releaseHeld(filePath) {
  const key = require('path').resolve(filePath);
  const mine = held.get(key);
  if (!mine) return;
  if (--mine.depth > 0) return;
  held.delete(key);
  releaseLock(mine.lockPath);
}

/** True when this process holds <filePath>.lock. */
function isHeld(filePath) {
  return held.has(require('path').resolve(filePath));
}

/**
 * Run fn while holding <filePath>.lock.
 * @param {string} filePath - The file the lock guards (lock is filePath + '.lock')
 * @param {Function} fn - Critical section
 * @param {object} [opts] - {retries, intervalMs, staleMs, strict}
 * @returns {{ locked: boolean, result: any, timedOut?: boolean }} locked=false
 *   means fn ran WITHOUT the lock (best-effort fallback — see module header);
 *   under opts.strict it means fn did NOT run (timedOut: true).
 */
function withFileLock(filePath, fn, opts = {}) {
  const { acquired } = holdLock(filePath, opts);
  if (!acquired && opts.strict) return { locked: false, timedOut: true, result: undefined };
  try {
    return { locked: acquired, result: fn() };
  } finally {
    if (acquired) releaseHeld(filePath);
  }
}

/**
 * Atomic file write: temp file in the same directory + rename. Readers never
 * observe a torn/partial file. The temp name embeds pid to avoid collisions
 * between concurrent writers.
 * @returns {{ atomic: boolean }} false when the rename kept failing and the
 *   content was written in place (the Windows fallback below).
 */
function writeFileAtomic(filePath, content) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  for (let attempt = 0; attempt <= RENAME_RETRIES; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath);
      return { atomic: true };
    } catch (err) {
      // Windows refuses rename-over-open-file (EPERM/EBUSY/EACCES) while an
      // antivirus scanner or a reader has the target open: wait and retry.
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err && err.code) || attempt === RENAME_RETRIES) break;
      sleepSync(RENAME_INTERVAL_MS);
    }
  }
  // Still refused: write in place so the content lands, then clean the temp.
  fs.writeFileSync(filePath, content, 'utf-8');
  try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
  return { atomic: false };
}

module.exports = {
  acquireLock,
  releaseLock,
  withFileLock,
  holdLock,
  releaseHeld,
  isHeld,
  lockPathFor,
  writeFileAtomic,
  sleepSync,
};
