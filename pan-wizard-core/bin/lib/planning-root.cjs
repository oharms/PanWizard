/**
 * Planning root — resolves WHICH planning tree a pan-tools invocation acts on.
 *
 * Before this module every path was `path.join(cwd, '.planning', …)`, so a repo
 * holding more than one planning tree (several products merged into one repo, a
 * monorepo, a spike kept beside the mainline) could address exactly one of
 * them. The other trees were not merely awkward to reach — they were
 * unreachable, and commands did not say so. `hygiene scan` reported "clean"
 * while a sibling track sat three times over its trace retention, because it
 * had looked at the wrong directory and had no vocabulary for saying which one.
 *
 * The rule this module encodes: a command may operate on a tree other than
 * `.planning/`, but it must always be able to name the tree it chose. Every
 * resolution carries its `source`, and callers surface it, so a wrong target is
 * visible in the output instead of being indistinguishable from a right one.
 *
 * Resolution precedence, highest first:
 *   1. explicit override      — `--planning-dir <path>` / `--track <name>`
 *   2. PAN_PLANNING_DIR env   — a project-relative path
 *   3. PAN_TRACK env          — a track name under `.planning/tracks/`
 *   4. default                — `.planning`
 *
 * Roots are always stored project-relative and POSIX-separated: they are used
 * both to build absolute paths and, verbatim, as the display paths in command
 * output and `git add` arguments.
 */

const fs = require('fs');
const path = require('path');

/** The planning tree every project has unless told otherwise. */
const DEFAULT_PLANNING_DIR = '.planning';

/** Directory under the default root that holds sibling planning trees. */
const TRACKS_DIR = 'tracks';

/**
 * Files/dirs that mark a directory as a real planning tree rather than an
 * incidental folder. Mirrors the hygiene "spine" test: the phase model, the
 * focus model, or an orchestration campaign.
 */
const PLANNING_SPINE = [
  'state.md', 'roadmap.md', 'project.md', 'requirements.md',
  'phases', 'milestones', 'focus', 'quick', 'orchestration', 'config.json',
];

/** Explicit override set by the CLI, or null. @type {{rel: string, source: string, track: string|null}|null} */
let override = null;

/**
 * Normalize a project-relative planning path to POSIX form, rejecting anything
 * that escapes the project root.
 *
 * @param {string} input - candidate path, relative to the project root
 * @param {string} label - flag/env name, for error text
 * @returns {string} normalized POSIX-relative path
 * @throws {Error} if absolute, empty, or containing a `..` segment
 */
function normalizeRoot(input, label) {
  const value = String(input == null ? '' : input).trim();
  if (!value) throw new Error(`${label}: missing value`);

  // Reject absolute paths on both platforms, plus Windows drive-relative
  // ("C:foo") and UNC forms. Checked inline rather than via a helper: static
  // analysis does not follow guards across function boundaries, and this is
  // the barrier that keeps a planning root inside the project.
  if (value.startsWith('/') || value.startsWith('\\')) {
    throw new Error(`${label}: must be relative to the project root, got absolute path "${value}"`);
  }
  if (/^[A-Za-z]:/.test(value)) {
    throw new Error(`${label}: must be relative to the project root, got drive path "${value}"`);
  }

  const segments = value.split(/[\\/]+/).filter(s => s && s !== '.');
  if (segments.length === 0) throw new Error(`${label}: missing value`);
  if (segments.includes('..')) {
    throw new Error(`${label}: must stay inside the project root, got "${value}"`);
  }
  return segments.join('/');
}

/**
 * Validate a track name. Track names become a single path segment, so they are
 * restricted to a slug alphabet — this is the barrier against traversal via
 * `--track ../../etc`, and it is deliberately stricter than normalizeRoot.
 *
 * @param {string} name
 * @returns {string} the validated name
 * @throws {Error} if the name is empty or not a plain slug
 */
function normalizeTrackName(name) {
  const value = String(name == null ? '' : name).trim();
  if (!value) throw new Error('--track: missing value');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`--track: "${value}" is not a valid track name (letters, digits, dot, dash, underscore)`);
  }
  return value;
}

/**
 * Project-relative path of a named track's planning tree.
 * @param {string} name - track name
 * @returns {string} e.g. `.planning/tracks/verify`
 */
function trackRel(name) {
  return [DEFAULT_PLANNING_DIR, TRACKS_DIR, normalizeTrackName(name)].join('/');
}

/**
 * Set the planning root explicitly. Called by the CLI once, before dispatch.
 *
 * @param {Object} opts
 * @param {string} [opts.planningDir] - project-relative path (`--planning-dir`)
 * @param {string} [opts.track] - track name (`--track`)
 * @returns {{rel: string, source: string, track: string|null}|null} the resolution
 */
function setPlanningRoot({ planningDir, track } = {}) {
  if (planningDir && track) {
    throw new Error('--planning-dir and --track are mutually exclusive');
  }
  if (track) {
    const name = normalizeTrackName(track);
    override = { rel: trackRel(name), source: 'flag:--track', track: name };
  } else if (planningDir) {
    override = { rel: normalizeRoot(planningDir, '--planning-dir'), source: 'flag:--planning-dir', track: null };
  } else {
    override = null;
  }
  return override;
}

/** Drop any explicit override, returning to env/default resolution. */
function clearPlanningRoot() {
  override = null;
}

/**
 * Run `fn` with the planning root pinned to `rel`, then restore the previous
 * resolution — always, including on throw.
 *
 * This exists for the one job that genuinely needs it: sweeping several trees
 * in a single invocation (`hygiene --all-tracks`). The alternative, threading a
 * root argument through every check, would stop at the module boundary — the
 * checks call into memory.cjs and cost.cjs, which resolve the root themselves.
 * Scoping the ambient root is what makes those downstream readers follow the
 * sweep instead of all reporting on `.planning/`.
 *
 * Synchronous only. Do not await inside `fn`: overlapping scopes would
 * interleave and the restore would land on the wrong value.
 *
 * @param {string} rel - project-relative planning root to pin
 * @param {Function} fn - synchronous callback
 * @param {string|null} [track] - track name this root belongs to, so anything
 *   reporting from inside the scope (describePlanningRoot, and every payload
 *   that spreads it) names the right tree rather than defaulting to null
 * @returns {*} whatever `fn` returns
 */
function withPlanningRoot(rel, fn, track = null) {
  const previous = override;
  override = { rel: normalizeRoot(rel, 'planning root'), source: 'scoped', track: track || null };
  try {
    return fn();
  } finally {
    override = previous;
  }
}

/**
 * Resolve the active planning root.
 *
 * Env vars are read on every call rather than cached at load, so a host that
 * sets them late (and every test that does) sees the change.
 *
 * @returns {{rel: string, source: string, track: string|null}}
 */
function resolvePlanningRoot() {
  if (override) return { ...override };

  const envDir = process.env.PAN_PLANNING_DIR;
  if (envDir && envDir.trim()) {
    return { rel: normalizeRoot(envDir, 'PAN_PLANNING_DIR'), source: 'env:PAN_PLANNING_DIR', track: null };
  }

  const envTrack = process.env.PAN_TRACK;
  if (envTrack && envTrack.trim()) {
    const name = normalizeTrackName(envTrack);
    return { rel: trackRel(name), source: 'env:PAN_TRACK', track: name };
  }

  return { rel: DEFAULT_PLANNING_DIR, source: 'default', track: null };
}

/**
 * Active planning root, project-relative and POSIX-separated.
 * This is the value that replaces the old `PLANNING_DIR` constant at call sites.
 * @returns {string}
 */
function planningRootRel() {
  return resolvePlanningRoot().rel;
}

/**
 * Absolute path of the active planning root.
 * @param {string} cwd - project root
 * @returns {string}
 */
function planningRootAbs(cwd) {
  return path.join(cwd, ...planningRootRel().split('/'));
}

/**
 * Does this directory look like a planning tree (as opposed to any old folder)?
 * @param {string} abs - absolute directory path
 * @returns {boolean}
 */
function isPlanningTree(abs) {
  let entries;
  try { entries = fs.readdirSync(abs); } catch { return false; }
  const lower = entries.map(e => e.toLowerCase());
  return PLANNING_SPINE.some(s => lower.includes(s));
}

/**
 * Discover sibling planning trees under `.planning/tracks/`.
 *
 * Only directories that pass isPlanningTree() are returned — an empty or
 * incidental folder under tracks/ is not a track, and silently treating one as
 * a track would reintroduce the very "operated on the wrong thing" failure this
 * module exists to prevent.
 *
 * @param {string} cwd - project root
 * @returns {Array<{name: string, rel: string, abs: string}>} sorted by name
 */
function discoverTracks(cwd) {
  const tracksAbs = path.join(cwd, DEFAULT_PLANNING_DIR, TRACKS_DIR);
  let entries = [];
  try { entries = fs.readdirSync(tracksAbs, { withFileTypes: true }); } catch { return []; }

  const tracks = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    let name;
    try { name = normalizeTrackName(e.name); } catch { continue; }
    const abs = path.join(tracksAbs, name);
    if (!isPlanningTree(abs)) continue;
    tracks.push({ name, rel: [DEFAULT_PLANNING_DIR, TRACKS_DIR, name].join('/'), abs });
  }
  tracks.sort((a, b) => a.name.localeCompare(b.name));
  return tracks;
}

/**
 * Every planning root a command should act on.
 *
 * Without `allTracks` this is exactly the resolved root — one tree, the one the
 * user asked for. With it, the default root (when it is a real tree) plus every
 * discovered track, each labelled, so aggregate output can attribute findings.
 *
 * @param {string} cwd - project root
 * @param {Object} [opts]
 * @param {boolean} [opts.allTracks] - include every discovered track
 * @returns {Array<{name: string|null, rel: string, abs: string, source: string}>}
 */
function planningRoots(cwd, opts = {}) {
  const resolved = resolvePlanningRoot();

  if (!opts.allTracks) {
    return [{
      name: resolved.track,
      rel: resolved.rel,
      abs: path.join(cwd, ...resolved.rel.split('/')),
      source: resolved.source,
    }];
  }

  const roots = [];
  const rootAbs = path.join(cwd, DEFAULT_PLANNING_DIR);
  if (isPlanningTree(rootAbs)) {
    roots.push({ name: null, rel: DEFAULT_PLANNING_DIR, abs: rootAbs, source: 'all-tracks' });
  }
  for (const t of discoverTracks(cwd)) {
    roots.push({ name: t.name, rel: t.rel, abs: t.abs, source: 'all-tracks' });
  }
  // A project with no tracks and no root spine still gets one root to act on,
  // so --all-tracks never silently does nothing.
  if (roots.length === 0) {
    roots.push({ name: null, rel: DEFAULT_PLANNING_DIR, abs: rootAbs, source: 'all-tracks' });
  }
  return roots;
}

/**
 * Human/machine-readable description of the active root, for command output.
 * @param {string} cwd - project root
 * @returns {{planning_root: string, track: string|null, planning_root_source: string, planning_root_exists: boolean}}
 */
function describePlanningRoot(cwd) {
  const resolved = resolvePlanningRoot();
  const abs = path.join(cwd, ...resolved.rel.split('/'));
  let exists = false;
  try { exists = fs.statSync(abs).isDirectory(); } catch { /* absent */ }
  return {
    planning_root: resolved.rel,
    track: resolved.track,
    planning_root_source: resolved.source,
    planning_root_exists: exists,
  };
}

module.exports = {
  DEFAULT_PLANNING_DIR,
  TRACKS_DIR,
  PLANNING_SPINE,
  normalizeRoot,
  normalizeTrackName,
  trackRel,
  setPlanningRoot,
  clearPlanningRoot,
  withPlanningRoot,
  resolvePlanningRoot,
  planningRootRel,
  planningRootAbs,
  isPlanningTree,
  discoverTracks,
  planningRoots,
  describePlanningRoot,
};
