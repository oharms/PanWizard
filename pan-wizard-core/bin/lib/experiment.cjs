'use strict';
// @pan: ADR-0026
/**
 * experiment.cjs — Self-improvement loop W1: experiment scaffolding.
 *
 * Spec: docs/specs/self_improvement_loop_featureai.md
 * ADR: ADR-0026 (pending)
 *
 * Manages the lifecycle of an "experiment" — an isolated project folder
 * outside the PAN source repo where we drive an external AI coding session
 * to build an idea, then harvest the resulting telemetry back into
 * pan-wizard-core/learnings/.
 *
 * W1 (this file as shipped in v3.7.0):
 *   - newExperiment(slug, opts)         — scaffold folder + copy idea + write manifest
 *   - listExperiments(opts)             — enumerate experiments under root
 *   - getExperimentManifest(slug, opts) — read manifest by slug
 *
 * W3 (v3.7.2): adds harvestExperiment, pruneExperiment.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// Source repo root — used for the "never write inside source repo" guard.
// Computed once at module load; mirrors install.js PAN_SOURCE_ROOT.
const PAN_SOURCE_ROOT = path.resolve(__dirname, '..', '..', '..');

// Default experiment root: ~/pan-experiments. Configurable via opts.root.
const PAN_EXPERIMENTS_ROOT_DEFAULT = path.join(os.homedir(), 'pan-experiments');

const VALID_RUNTIMES = ['claude', 'codex', 'gemini', 'opencode', 'copilot'];

// Slug rules: lowercase, digits, hyphens; max 40 chars; cannot start/end with hyphen.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// ── Helpers ─────────────────────────────────────────────────────────────────

function normPath(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function isInsideSourceRepo(p) {
  const abs = normPath(path.resolve(p));
  const src = normPath(PAN_SOURCE_ROOT);
  return abs === src || abs.startsWith(src + path.sep) || abs.startsWith(src + '/');
}

function validateSlug(slug) {
  if (typeof slug !== 'string' || slug.length === 0) {
    return 'slug must be a non-empty string';
  }
  if (slug.length > 40) {
    return `slug too long (max 40 chars, got ${slug.length})`;
  }
  if (!SLUG_RE.test(slug)) {
    return 'slug invalid: must be lowercase letters, digits, hyphens (no leading/trailing hyphen)';
  }
  return null;
}

function validateRuntime(runtime) {
  if (!VALID_RUNTIMES.includes(runtime)) {
    return `runtime must be one of: ${VALID_RUNTIMES.join(', ')}, got "${runtime}"`;
  }
  return null;
}

// ── newExperiment ───────────────────────────────────────────────────────────

/**
 * Scaffold a new experiment folder.
 *
 * @param {string} slug - lowercase-hyphen slug, max 40 chars
 * @param {object} opts
 * @param {string} opts.ideaPath - absolute path to the idea.md to copy in
 * @param {string} opts.runtime - one of VALID_RUNTIMES
 * @param {string} [opts.root] - experiment root dir (default: PAN_EXPERIMENTS_ROOT_DEFAULT)
 * @param {boolean} [opts.skipInstaller] - if true, don't run the PAN installer (used by tests)
 * @param {number} [opts.budget] - optional budget cap in points (saved to manifest)
 * @returns {object} { experiment_id, path, runtime, idea_path, created_at } or { error }
 */
function newExperiment(slug, opts = {}) {
  const slugError = validateSlug(slug);
  if (slugError) return { error: slugError };

  const runtime = opts.runtime || 'claude';
  const runtimeError = validateRuntime(runtime);
  if (runtimeError) return { error: runtimeError };

  if (!opts.ideaPath) {
    return { error: 'ideaPath is required' };
  }
  if (!fs.existsSync(opts.ideaPath)) {
    return { error: `idea file not found: ${opts.ideaPath}` };
  }

  const root = opts.root || PAN_EXPERIMENTS_ROOT_DEFAULT;
  if (isInsideSourceRepo(root)) {
    return {
      error: `refusing to scaffold experiment inside PAN source repo (${PAN_SOURCE_ROOT}); ` +
             `set opts.root to a directory outside the source tree`,
    };
  }

  const expPath = path.join(root, slug);
  if (fs.existsSync(expPath)) {
    return { error: `experiment folder already exists: ${expPath}` };
  }

  const createdAt = new Date().toISOString();

  try {
    fs.mkdirSync(path.join(expPath, '.planning'), { recursive: true });
  } catch (err) {
    return { error: `failed to create experiment folder: ${err.message}` };
  }

  // Copy idea.md into <experiment>/.planning/idea.md
  try {
    const ideaContent = fs.readFileSync(opts.ideaPath, 'utf-8');
    fs.writeFileSync(path.join(expPath, '.planning', 'idea.md'), ideaContent);
  } catch (err) {
    return { error: `failed to copy idea: ${err.message}` };
  }

  // Write the experiment manifest
  const manifest = {
    experiment_id: slug,
    runtime,
    idea_path: path.join(expPath, '.planning', 'idea.md'),
    source_idea_path: path.resolve(opts.ideaPath),
    created_at: createdAt,
    status: 'scaffolded',
    budget: opts.budget != null ? opts.budget : null,
    pan_version: readPanVersion(),
    path: expPath,
  };

  try {
    fs.writeFileSync(
      path.join(expPath, '.planning', 'experiment.json'),
      JSON.stringify(manifest, null, 2)
    );
  } catch (err) {
    return { error: `failed to write manifest: ${err.message}` };
  }

  // P-EXP-001 root-cause fix (2026-05-02): initialize git and inherit identity
  // from the PAN source repo. Without this, autonomous runs that hit a fresh
  // shell without global git config get `committed: false reason: commit_failed`
  // returns from `pan-tools commit`, silently leaving artifacts uncommitted.
  // whoocache hit this exactly — 24 min of work, no commits, and the run kept
  // going because the workflow-level commit step exit code was 0.
  initExperimentGit(expPath);

  // Optional: invoke installer for the chosen runtime in the experiment folder
  if (!opts.skipInstaller) {
    const installerError = runInstaller(expPath, runtime);
    if (installerError) {
      // Non-fatal: the experiment exists, but installer failed. Return both info.
      manifest.installer_error = installerError;
      try {
        fs.writeFileSync(
          path.join(expPath, '.planning', 'experiment.json'),
          JSON.stringify(manifest, null, 2)
        );
      } catch { /* best effort */ }
      return {
        ...manifest,
        warning: `experiment scaffolded, but installer failed: ${installerError}`,
      };
    }
    manifest.status = 'ready';
    // P-101 fix (v3.7.1): persist the status update — earlier versions
    // mutated the in-memory manifest but never wrote it back, so the on-disk
    // file kept saying "scaffolded" forever.
    try {
      fs.writeFileSync(
        path.join(expPath, '.planning', 'experiment.json'),
        JSON.stringify(manifest, null, 2)
      );
    } catch { /* best effort — non-fatal */ }
  }

  return {
    experiment_id: slug,
    path: expPath,
    runtime,
    idea_path: manifest.idea_path,
    created_at: createdAt,
  };
}

function runInstaller(expPath, runtime) {
  const installerPath = path.join(PAN_SOURCE_ROOT, 'bin', 'install.js');
  try {
    execFileSync('node', [installerPath, `--${runtime}`, '--local'], {
      cwd: expPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
    });
    return null;
  } catch (err) {
    return err.stderr?.toString() || err.message;
  }
}

// P-EXP-001 root-cause fix (2026-05-02): initialize git and configure local
// user identity so the autonomous loop's `pan-tools commit` calls succeed even
// in environments without global git config. Identity is inherited from the
// PAN source repo when available; falls back to placeholders that produce
// valid commits (the agent can't run, but at least the commits land).
function initExperimentGit(expPath) {
  const tryGit = (args, cwd) => {
    try {
      execFileSync('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
      return true;
    } catch { return false; }
  };
  const readGit = (args, cwd) => {
    try {
      return execFileSync('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000, encoding: 'utf-8' }).trim();
    } catch { return ''; }
  };

  // Init the experiment repo. Idempotent — git init on an existing repo is a no-op.
  if (!tryGit(['init', '--initial-branch=main'], expPath)) {
    // Fallback for older git that doesn't know --initial-branch
    tryGit(['init'], expPath);
  }

  // Inherit identity from the PAN source repo, then global, then placeholders.
  const sourceEmail = readGit(['config', '--get', 'user.email'], PAN_SOURCE_ROOT);
  const sourceName = readGit(['config', '--get', 'user.name'], PAN_SOURCE_ROOT);
  const email = sourceEmail || 'experiment@pan-wizard.local';
  const name = sourceName || 'PAN Experiment Runner';

  tryGit(['config', '--local', 'user.email', email], expPath);
  tryGit(['config', '--local', 'user.name', name], expPath);
}

function readPanVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PAN_SOURCE_ROOT, 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// ── listExperiments ─────────────────────────────────────────────────────────

/**
 * Enumerate all experiments under the root directory.
 * Returns { experiments: [...], count } where each entry has the manifest fields.
 */
function listExperiments(opts = {}) {
  const root = opts.root || PAN_EXPERIMENTS_ROOT_DEFAULT;

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { experiments: [], count: 0 };
    }
    return { error: `failed to read root: ${err.message}` };
  }

  // Soft-pruned experiments are renamed to <slug>-archived-<ISO-ts>. Skip
  // those by default — they're not active. Pass opts.includeArchived=true
  // to surface them anyway (status/diagnostic listings).
  const ARCHIVED_RE = /-archived-\d{4}-\d{2}-\d{2}T/;

  const experiments = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (!opts.includeArchived && ARCHIVED_RE.test(slug)) continue;
    const manifestPath = path.join(root, slug, '.planning', 'experiment.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      experiments.push({
        ...manifest,
        path: path.join(root, slug),
      });
    } catch {
      // Not a PAN experiment folder; skip silently
    }
  }

  // Sort newest first
  experiments.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  return { experiments, count: experiments.length };
}

// ── getExperimentManifest ───────────────────────────────────────────────────

/**
 * Read the manifest for a single experiment by slug.
 */
function getExperimentManifest(slug, opts = {}) {
  const slugError = validateSlug(slug);
  if (slugError) return { error: slugError };

  const root = opts.root || PAN_EXPERIMENTS_ROOT_DEFAULT;
  const manifestPath = path.join(root, slug, '.planning', 'experiment.json');

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return manifest;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { error: `experiment not found: ${slug}` };
    }
    return { error: `failed to read manifest: ${err.message}` };
  }
}

// ── harvestExperiment (W3) ──────────────────────────────────────────────────

// Paths to harvest from <experiment>/ — relative to the experiment folder.
// Optional paths are skipped if absent (e.g., a fresh experiment hasn't
// produced .planning/optimization/ yet).
const HARVEST_PATHS = [
  '.planning/idea.md',
  '.planning/experiment.json',
  '.planning/state.md',
  '.planning/run-state.json',
  '.planning/agent-history.json',
  '.planning/optimization',
  '.planning/phases',
];

/**
 * Recursively copy a directory or file. Returns total bytes copied.
 */
function copyRecursive(src, dest) {
  let total = 0;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const childSrc = path.join(src, entry.name);
      const childDest = path.join(dest, entry.name);
      total += copyRecursive(childSrc, childDest);
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    total += stat.size;
  }
  return total;
}

/**
 * Harvest an experiment's telemetry into <sourceRoot>/experiments/<slug>/.
 *
 * Copies idea.md, experiment.json, state.md, run-state.json, agent-history.json,
 * optimization/, and phases/ if present. Writes a harvest.json manifest.
 *
 * @param {string} slug
 * @param {object} opts
 * @param {string} [opts.root] - experiment root (default PAN_EXPERIMENTS_ROOT_DEFAULT)
 * @param {string} [opts.sourceRoot] - destination repo root (default PAN_SOURCE_ROOT)
 * @param {boolean} [opts.force] - overwrite an existing harvest
 * @returns {object} { experiment_id, harvest_path, harvested_paths, total_bytes, harvested_at }
 */
function harvestExperiment(slug, opts = {}) {
  const slugError = validateSlug(slug);
  if (slugError) return { error: slugError };

  const root = opts.root || PAN_EXPERIMENTS_ROOT_DEFAULT;
  const sourceRoot = opts.sourceRoot || PAN_SOURCE_ROOT;

  const expPath = path.join(root, slug);
  if (!fs.existsSync(expPath)) {
    return { error: `experiment not found: ${slug}` };
  }

  const harvestDir = path.join(sourceRoot, 'experiments', slug);
  if (fs.existsSync(harvestDir) && !opts.force) {
    return {
      error: `harvest already exists at ${harvestDir} (use --force to overwrite)`,
    };
  }

  // Wipe existing harvest if force
  if (fs.existsSync(harvestDir) && opts.force) {
    try {
      fs.rmSync(harvestDir, { recursive: true, force: true });
    } catch (err) {
      return { error: `failed to clear existing harvest: ${err.message}` };
    }
  }

  fs.mkdirSync(harvestDir, { recursive: true });

  const harvestedPaths = [];
  let totalBytes = 0;

  for (const rel of HARVEST_PATHS) {
    const srcPath = path.join(expPath, rel);
    if (!fs.existsSync(srcPath)) continue;
    const destPath = path.join(harvestDir, rel);
    try {
      const bytes = copyRecursive(srcPath, destPath);
      harvestedPaths.push(rel);
      totalBytes += bytes;
    } catch (err) {
      return { error: `failed to copy ${rel}: ${err.message}` };
    }
  }

  const harvestManifest = {
    experiment_id: slug,
    harvested_at: new Date().toISOString(),
    source_path: expPath,
    harvest_path: harvestDir,
    harvested_paths: harvestedPaths,
    total_bytes: totalBytes,
    pan_version: readPanVersion(),
  };

  try {
    fs.writeFileSync(
      path.join(harvestDir, 'harvest.json'),
      JSON.stringify(harvestManifest, null, 2)
    );
  } catch (err) {
    return { error: `failed to write harvest manifest: ${err.message}` };
  }

  return harvestManifest;
}

// ── pruneExperiment (W3) ────────────────────────────────────────────────────

/**
 * Prune (delete) an experiment after harvest.
 *
 * Soft mode (default): rename to <root>/<slug>-archived-<timestamp>.
 * Hard mode (opts.hard=true): permanently delete the folder.
 *
 * @param {string} slug
 * @param {object} opts
 * @param {string} [opts.root]
 * @param {boolean} [opts.hard]
 * @returns {object} { pruned: slug, mode: 'soft'|'hard', archive_path? }
 */
function pruneExperiment(slug, opts = {}) {
  const slugError = validateSlug(slug);
  if (slugError) return { error: slugError };

  const root = opts.root || PAN_EXPERIMENTS_ROOT_DEFAULT;
  const expPath = path.join(root, slug);
  if (!fs.existsSync(expPath)) {
    return { error: `experiment not found: ${slug}` };
  }

  if (opts.hard) {
    try {
      fs.rmSync(expPath, { recursive: true, force: true });
    } catch (err) {
      return { error: `failed to delete experiment: ${err.message}` };
    }
    return { pruned: slug, mode: 'hard' };
  }

  // Soft: rename to <root>/<slug>-archived-<ts>
  // Filesystem-safe timestamp: replace : and . with -
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(root, `${slug}-archived-${ts}`);
  try {
    fs.renameSync(expPath, archivePath);
  } catch (err) {
    return { error: `failed to archive experiment: ${err.message}` };
  }

  return { pruned: slug, mode: 'soft', archive_path: archivePath };
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  newExperiment,
  listExperiments,
  getExperimentManifest,
  harvestExperiment,
  pruneExperiment,
  PAN_EXPERIMENTS_ROOT_DEFAULT,
  PAN_SOURCE_ROOT,
  VALID_RUNTIMES,
  HARVEST_PATHS,
  // Test-only exports (validation helpers)
  _validateSlug: validateSlug,
  _isInsideSourceRepo: isInsideSourceRepo,
};
