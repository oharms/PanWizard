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
 * Lock files live outside the project, in a per-user directory under the
 * system temp directory (`<os temp>/pan-locks-<user>/`, mode 0700), named by a
 * hash of the guarded file's real directory and its name: a command that
 * commits or lists `.planning/` while it holds a lock never sees the lock file,
 * nothing is written into a planning tree PAN does not own, and every spelling
 * of one file (symlink, junction, 8.3 short name) meets at one lock. Processes
 * whose temp directories differ do not share locks.
 *
 * A lock is stale only when its holder is gone (durable orchestration R1): the
 * lock file names `<pid>@<host>`, and a waiter steals a lock older than staleMs
 * only when that pid is not alive on this host (a lock from another host is
 * judged by age). A live holder keeps its lock however long its command runs.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_RETRIES = 40;
const DEFAULT_INTERVAL_MS = 25;
const DEFAULT_STALE_MS = 10_000;
const STRICT_WAIT_MS = 7_000;
const RENAME_RETRIES = 5;
const RENAME_INTERVAL_MS = 20;
const HOST = os.hostname();
const OWNER = `${process.pid}@${HOST}`;

/** How long a strict caller waits: PAN_LOCK_WAIT_MS when set (tests), else 7 s. */
function strictWaitMs() {
  const v = Number(process.env.PAN_LOCK_WAIT_MS);
  return Number.isFinite(v) && v > 0 ? v : STRICT_WAIT_MS;
}

// lock path -> { depth }: the locks this process holds.
const held = new Map();
let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const lockPath of held.keys()) releaseLock(lockPath);
    held.clear();
  });
}

// Synchronous sleep without busy-waiting: Atomics.wait on a throwaway buffer.
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

/** This user's lock directory: <os temp>/pan-locks-<user>. */
function lockDir() {
  let user = '';
  try { user = os.userInfo().username; } catch { /* no passwd entry */ }
  if (!user && typeof process.getuid === 'function') user = String(process.getuid());
  return path.join(os.tmpdir(), `pan-locks-${String(user || 'user').replace(/[^A-Za-z0-9._-]/g, '_')}`);
}

/**
 * The lock file that guards filePath: <lock dir>/<hash>-<name>.lock. The hash is
 * of the file's directory resolved through realpath (when it exists) and its
 * name, lower-cased on Windows, whose paths are case-insensitive.
 */
function lockPathFor(filePath) {
  const abs = path.resolve(filePath);
  let dir = path.dirname(abs);
  try { dir = fs.realpathSync.native(dir); } catch { /* not created yet: as resolved */ }
  let id = path.join(dir, path.basename(abs));
  if (process.platform === 'win32') id = id.toLowerCase();
  const hash = crypto.createHash('sha1').update(id).digest('hex').slice(0, 20);
  return path.join(lockDir(), `${hash}-${path.basename(abs)}.lock`);
}

/** Is the process that wrote this lock content gone? (Only judged on this host.) */
function holderGone(content) {
  const m = /^(\d+)(?:@(.*))?$/.exec(String(content || '').trim());
  if (!m) return true;                      // unreadable owner: judged by age alone
  if (m[2] && m[2] !== HOST) return true;   // another host: cannot ask, judged by age
  const pid = Number(m[1]);
  if (pid === process.pid) return false;
  try { process.kill(pid, 0); return false; } catch (e) { return e.code !== 'EPERM'; }
}

/**
 * Who holds a lock, for a message a person acts on (DD-17): the holder named in the
 * lock file, how old the lock is, and whether its holder is gone, the only case in
 * which deleting the file is safe. A holder on this host is gone when its pid is not
 * alive; one on another host (or an unreadable lock) when the lock is older than
 * staleMs, the same rule a waiter steals by.
 * @param {string} lockPath
 * @param {{staleMs?: number, now?: number}} [opts]
 * @returns {{exists: false} | {exists: true, holder: {pid: number, host: string|null}|null, this_host: boolean, age_ms: number, alive: boolean|null, gone: boolean}}
 */
function describeLock(lockPath, opts = {}) {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  let content;
  let mtimeMs;
  try {
    content = fs.readFileSync(lockPath, 'utf-8');
    mtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch { return { exists: false }; }
  const age = Math.max(0, Math.round((opts.now ?? Date.now()) - mtimeMs));
  const m = /^(\d+)(?:@(.*))?$/.exec(String(content).trim());
  const holder = m ? { pid: Number(m[1]), host: m[2] || null } : null;
  const thisHost = Boolean(holder && (!holder.host || holder.host === HOST));
  // Alive is known only for a holder on this host.
  const alive = thisHost ? !holderGone(content) : null;
  const gone = thisHost ? !alive : age > staleMs;
  return { exists: true, holder, this_host: thisHost, age_ms: age, alive, gone };
}

// The errors that mean "someone else has it" rather than "this cannot work":
// Windows answers EPERM/EBUSY/EACCES while a released lock file is still being
// deleted. On POSIX an EACCES is a directory this user cannot write: give up.
const CONTENTION = process.platform === 'win32' ? ['EPERM', 'EACCES', 'EBUSY'] : [];

/**
 * Try to acquire filePath's lock (see lockPathFor). A lock older than staleMs
 * whose holder is gone is stolen. Waits are jittered, so contenders polling
 * the same lock do not wake in step and starve one another.
 * @param {object} [opts] - {retries, intervalMs, staleMs, strict, waitMs}
 * @returns {{ acquired: boolean, lockPath: string }}
 */
function acquireLock(filePath, opts = {}) {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const lockPath = lockPathFor(filePath);
  try { fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 }); } catch { return { acquired: false, lockPath }; }

  // A strict caller waits by the clock, not by a count.
  const deadline = opts.strict && opts.retries == null ? Date.now() + (opts.waitMs ?? strictWaitMs()) : null;
  const more = (attempt) => (deadline ? Date.now() < deadline : attempt < retries);
  const pause = () => sleepSync(Math.max(1, Math.round(intervalMs * (0.5 + Math.random()))));

  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(lockPath, OWNER, { flag: 'wx' });
      return { acquired: true, lockPath };
    } catch (err) {
      if (CONTENTION.includes(err.code)) {
        if (!more(attempt)) break;
        pause();
        continue;
      }
      if (err.code !== 'EEXIST') {
        // Lock dir unwritable etc. — treat as unacquirable, don't spin.
        return { acquired: false, lockPath };
      }
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > staleMs && holderGone(fs.readFileSync(lockPath, 'utf-8'))) {
          // The holder is gone — steal via an atomic rename to a unique name.
          // rename() moves the specific inode: exactly ONE concurrent stealer can
          // rename a given lock file; every other contender's rename fails with
          // ENOENT instead of unlinking a lock a winner may already have re-created.
          const stealPath = `${lockPath}.steal.${process.pid}.${Date.now()}`;
          let stole = false;
          try {
            fs.renameSync(lockPath, stealPath);
            stole = true;
            try { fs.unlinkSync(stealPath); } catch { /* best-effort */ }
          } catch { /* another contender got there first, or it cannot be moved */ }
          // A won steal retries at once; a failed one waits like any contention,
          // so an unmovable stale lock cannot spin a strict caller forever.
          if (stole) continue;
        }
      } catch { /* lock vanished between EEXIST and stat — loop retries */ }
      if (!more(attempt)) break;
      pause();
    }
  }
  return { acquired: false, lockPath };
}

/**
 * Release a lock acquired by acquireLock. Best-effort, but ownership-verified:
 * only unlink when the lock file still names THIS process, so a lock that was
 * stolen and re-created by a successor is never deleted out from under it.
 */
function releaseLock(lockPath) {
  try {
    if (!ownsLock(lockPath)) return; // not ours anymore — leave it
    fs.unlinkSync(lockPath);
  } catch { /* already gone / unreadable — nothing to release */ }
}

/** Does the lock file name this process? */
function ownsLock(lockPath) {
  try {
    const owner = fs.readFileSync(lockPath, 'utf-8').trim();
    return owner === OWNER || owner === String(process.pid);
  } catch { return false; }
}

/**
 * Take filePath's lock and keep it until releaseHeld() or process exit.
 * Re-entrant: a lock this process holds only deepens the hold, after checking
 * the lock file still names this process (re-acquiring it if it does not).
 * @returns {{ acquired: boolean, lockPath: string }}
 */
function holdLock(filePath, opts = {}) {
  const lockPath = lockPathFor(filePath);
  const mine = held.get(lockPath);
  if (mine) {
    if (ownsLock(lockPath)) { mine.depth++; return { acquired: true, lockPath }; }
    held.delete(lockPath); // lost (deleted by hand): take it again, never assume it
    const again = acquireLock(filePath, opts);
    if (again.acquired) held.set(lockPath, { depth: mine.depth + 1 });
    return again;
  }
  const got = acquireLock(filePath, opts);
  if (got.acquired) {
    installExitHook();
    held.set(lockPath, { depth: 1 });
  }
  return got;
}

/** Undo one holdLock(); the lock file goes when the outermost hold ends. */
function releaseHeld(filePath) {
  const lockPath = lockPathFor(filePath);
  const mine = held.get(lockPath);
  if (!mine) return;
  if (--mine.depth > 0) return;
  held.delete(lockPath);
  releaseLock(lockPath);
}

/** True when this process holds filePath's lock. */
function isHeld(filePath) {
  return held.has(lockPathFor(filePath));
}

/**
 * Run fn while holding filePath's lock.
 * @param {string} filePath - The file the lock guards (see lockPathFor)
 * @param {Function} fn - Critical section
 * @param {object} [opts] - {retries, intervalMs, staleMs, strict, waitMs}
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
  lockDir,
  holderGone,
  describeLock,
  DEFAULT_STALE_MS,
  writeFileAtomic,
  sleepSync,
};
