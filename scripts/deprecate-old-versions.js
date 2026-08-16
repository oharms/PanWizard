#!/usr/bin/env node
/**
 * Deprecate published versions that have fallen far enough behind.
 *
 * WHY. Old releases stay installable forever, and `npm install pan-wizard@3.20.0`
 * silently gives someone a build from several cycles ago with none of the fixes
 * since. Deprecation is the honest signal: the version keeps working, keeps
 * resolving, and anyone installing it sees a warning telling them what to move to.
 *
 * WHY DEPRECATE AND NEVER UNPUBLISH. Unpublishing removes a tarball other people
 * may depend on and is refused by npm outside a 72-hour window anyway. Deprecation
 * is additive, reversible (`npm deprecate <pkg>@<ver> ""` clears it), and breaks
 * nobody. **This script must never gain an unpublish path.**
 *
 * THE RULE. Keep the newest N stable releases (default 3 — the one just published
 * plus the two behind it) and deprecate every stable release older than those.
 * Prereleases are never counted as "kept": once a stable release exists that
 * supersedes them they are deprecated too, since an rc is not something anyone
 * should be installing after the real release shipped.
 *
 * SAFETY, in the order it matters:
 *   - DRY RUN BY DEFAULT. `--apply` is required to change anything.
 *   - The version being released is never deprecated, even if the arithmetic
 *     somehow selects it — an explicit guard, not a consequence.
 *   - Already-deprecated versions are skipped, so re-running is a no-op.
 *   - A failure to deprecate NEVER fails the build. By the time this runs the
 *     publish has already succeeded; turning a housekeeping failure into a red
 *     release would be strictly worse than leaving an old version undeprecated.
 *
 * Usage:
 *   node scripts/deprecate-old-versions.js                 # dry run, keep 3
 *   node scripts/deprecate-old-versions.js --apply         # actually deprecate
 *   node scripts/deprecate-old-versions.js --keep 5 --apply
 */

'use strict';

const { execFileSync } = require('child_process');

const PKG = 'pan-wizard';
const DEFAULT_KEEP = 3;

/**
 * Parse a semver string into comparable parts. Returns null for anything that is
 * not `major.minor.patch[-prerelease]`, so junk sorts out rather than throwing.
 */
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(String(v || '').trim());
  if (!m) return null;
  return {
    version: v,
    nums: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] || null,
  };
}

/**
 * Compare two parsed versions, ascending. Prerelease-aware: 3.26.0-rc.1 sorts
 * BELOW 3.26.0, which the update-check hook's comparator deliberately does not do
 * (it ignores the suffix). Getting this backwards would deprecate a real release
 * in favour of its own release candidate, so it is implemented here rather than
 * reused.
 */
function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;   // release > prerelease
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;  // lexical is good enough for rc.1 < rc.2
}

/**
 * Decide what to deprecate. PURE — no network, no process — so the rule is
 * testable without touching a registry.
 *
 * @param {string[]} published   every version on the registry
 * @param {string} current       the version just released (never deprecated)
 * @param {number} keep          how many newest STABLE releases to leave alone
 * @param {string[]} [already]   versions already carrying a deprecation message
 * @returns {{deprecate:string[], keep:string[], reason:Object<string,string>}}
 */
function selectVersionsToDeprecate(published, current, keep = DEFAULT_KEEP, already = []) {
  const parsed = (published || []).map(parse).filter(Boolean).sort(compare);
  const skip = new Set(already || []);
  const stable = parsed.filter((p) => !p.pre);
  // The newest `keep` stable releases are protected.
  const kept = new Set(stable.slice(-keep).map((p) => p.version));
  // The current release is protected regardless of where the arithmetic lands it.
  kept.add(current);

  const reason = {};
  const deprecate = [];
  for (const p of parsed) {
    if (kept.has(p.version)) continue;
    if (skip.has(p.version)) continue;
    reason[p.version] = p.pre
      ? `prerelease superseded by ${current}`
      : `more than ${keep - 1} releases behind ${current}`;
    deprecate.push(p.version);
  }
  return { deprecate, keep: [...kept].sort(), reason };
}

/** Message a deprecated version carries. Points at what to install instead. */
function buildMessage(current) {
  return `No longer maintained — install pan-wizard@${current} or later (npm i pan-wizard@latest).`;
}

// ─── IO layer ───────────────────────────────────────────────────────────────

/**
 * Run npm.
 *
 * WINDOWS: `npm` is a `.cmd` shim, so `execFileSync('npm', …)` fails ENOENT and
 * `'npm.cmd'` fails EINVAL — the shim can only be launched through a shell. This
 * is the same scar `runner.cjs` carries as its `shell: 'win32'` opt-in, and the
 * first version of this script reproduced the bug: a local dry run reported
 * "could not read the registry" and returned, so the fail-open path made a real
 * platform bug look like a benign skip.
 *
 * QUOTING: with `shell: true` node CONCATENATES arguments rather than escaping
 * them, so anything containing a space must be quoted or it arrives as several
 * arguments — which matters here because the deprecation message is a sentence.
 * Every argument is program-controlled (package name, versions read from the
 * registry, our own message), so this is a correctness problem rather than an
 * injection one, but it still has to be right. `assertQuotable` refuses a value
 * carrying a double quote instead of emitting a broken command line.
 */
function assertQuotable(a) {
  if (String(a).includes('"')) {
    throw new Error(`refusing to shell-quote an argument containing a double quote: ${a}`);
  }
  return a;
}

function runNpm(args, opts = {}) {
  const win = process.platform === 'win32';
  const argv = win ? args.map((a) => (/\s/.test(a) ? `"${assertQuotable(a)}"` : a)) : args;
  return execFileSync('npm', argv, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: win, ...opts,
  });
}

/**
 * `npm view <pkg> <field> --json` prints NOTHING when the field is unset across
 * every version — which is exactly the healthy starting state for `deprecated`
 * (nothing deprecated yet). `JSON.parse('')` throws, and the fail-open handler
 * then reported "could not read the registry", turning the normal case into an
 * apparent failure. Empty means absent, not broken.
 */
function npmJson(args, fallback = null) {
  const out = runNpm(args);
  if (!out || !out.trim()) return fallback;
  return JSON.parse(out);
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const keepIdx = args.indexOf('--keep');
  const keep = keepIdx > -1 ? Number(args[keepIdx + 1]) : DEFAULT_KEEP;
  const current = require('../package.json').version;

  if (!Number.isInteger(keep) || keep < 1) {
    console.error(`deprecate: --keep must be a positive integer, got ${keep}`);
    process.exit(1);
  }

  // A prerelease must never trigger a deprecation sweep: it is not the thing
  // users are being pointed at, and treating it as "the new release" would
  // deprecate the current stable one.
  if (parse(current) && parse(current).pre) {
    console.log(`deprecate: ${current} is a prerelease — skipping (sweeps run for stable releases only).`);
    return;
  }

  let published = [];
  let deprecatedAlready = [];
  try {
    published = npmJson(['view', PKG, 'versions', '--json'], []);
    if (!Array.isArray(published)) published = [published];
    const map = npmJson(['view', PKG, 'deprecated', '--json'], {});
    // npm returns a bare string for a single version, or {version: message}.
    deprecatedAlready = (map && typeof map === 'object') ? Object.keys(map) : [];
  } catch (e) {
    console.error(`deprecate: could not read the registry (${String(e.message).split('\n')[0]}). Nothing changed.`);
    return; // never fail the build over housekeeping
  }

  const { deprecate, keep: kept, reason } = selectVersionsToDeprecate(published, current, keep, deprecatedAlready);
  const message = buildMessage(current);

  console.log(`deprecate: current=${current} keep=${keep}`);
  console.log(`  protected: ${kept.join(', ')}`);
  if (deprecate.length === 0) {
    console.log('  nothing to deprecate.');
    return;
  }
  console.log(`  ${apply ? 'deprecating' : 'WOULD deprecate (dry run — pass --apply)'}: ${deprecate.length}`);
  for (const v of deprecate) console.log(`    ${v}  — ${reason[v]}`);

  if (!apply) return;

  let failed = 0;
  for (const v of deprecate) {
    try {
      runNpm(['deprecate', `${PKG}@${v}`, message]);
      console.log(`  ✓ ${v}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${v}: ${String(e.stderr || e.message).split('\n')[0]}`);
    }
  }
  if (failed) {
    // Reported, not fatal. The publish already succeeded; a red build here would
    // imply the release failed, which is false and worse than the omission.
    console.error(`deprecate: ${failed} of ${deprecate.length} failed — release is unaffected.`);
  }
}

if (require.main === module) main();

module.exports = { selectVersionsToDeprecate, buildMessage, parse, compare, assertQuotable };
