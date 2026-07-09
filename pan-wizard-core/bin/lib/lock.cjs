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
 * escalation path in ADR-0030.
 */

'use strict';

const fs = require('fs');

const DEFAULT_RETRIES = 40;
const DEFAULT_INTERVAL_MS = 25;
const DEFAULT_STALE_MS = 10_000;

// Synchronous sleep without busy-waiting: Atomics.wait on a throwaway buffer.
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

/**
 * Try to acquire <filePath>.lock. Stale locks (older than staleMs — a crashed
 * holder) are stolen.
 * @returns {{ acquired: boolean, lockPath: string }}
 */
function acquireLock(filePath, opts = {}) {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const lockPath = filePath + '.lock';

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return { acquired: true, lockPath };
    } catch (err) {
      if (err.code !== 'EEXIST') {
        // Lock dir unwritable etc. — treat as unacquirable, don't spin.
        return { acquired: false, lockPath };
      }
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > staleMs) {
          // Holder likely crashed — steal and retry immediately.
          try { fs.unlinkSync(lockPath); } catch { /* racing steal — loop retries */ }
          continue;
        }
      } catch { /* lock vanished between EEXIST and stat — loop retries */ }
      if (attempt < retries) sleepSync(intervalMs);
    }
  }
  return { acquired: false, lockPath };
}

/** Release a lock acquired by acquireLock. Best-effort. */
function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
}

/**
 * Run fn while holding <filePath>.lock.
 * @param {string} filePath - The file the lock guards (lock is filePath + '.lock')
 * @param {Function} fn - Critical section
 * @param {object} [opts] - {retries, intervalMs, staleMs}
 * @returns {{ locked: boolean, result: any }} locked=false means fn ran
 *   WITHOUT the lock (best-effort fallback — see module header).
 */
function withFileLock(filePath, fn, opts = {}) {
  const { acquired, lockPath } = acquireLock(filePath, opts);
  try {
    return { locked: acquired, result: fn() };
  } finally {
    if (acquired) releaseLock(lockPath);
  }
}

/**
 * Atomic file write: temp file in the same directory + rename. Readers never
 * observe a torn/partial file. The temp name embeds pid to avoid collisions
 * between concurrent writers.
 */
function writeFileAtomic(filePath, content) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Windows can refuse rename-over-open-file; fall back to direct write so
    // the content still lands, then clean the temp.
    fs.writeFileSync(filePath, content, 'utf-8');
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  withFileLock,
  writeFileAtomic,
  sleepSync,
};
