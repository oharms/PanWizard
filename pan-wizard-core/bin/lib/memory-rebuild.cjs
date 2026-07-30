'use strict';

/**
 * PAN memory rebuild (A2) — regenerate DERIVED memory from source, idempotently.
 *
 * "Rebuild" is a projection, not a mutation: it re-emits only the regions PAN
 * owns and can reproduce from source, and leaves everything the user wrote
 * alone. Per the memory-management research, a rebuild must be an idempotent
 * projection touching only derived regions — running it twice changes nothing.
 *
 * Three derived targets:
 *   1. AGENTS.md — the universal, cross-runtime tools memory. PAN owns exactly
 *      the marker-fenced `<!-- BEGIN/END PAN WIZARD -->` section (every runtime,
 *      including Copilot/.github, reads AGENTS.md natively). User content
 *      outside the markers is preserved byte-for-byte.
 *   2. CLAUDE.md — the Claude bridge (`@AGENTS.md` import), regenerated only
 *      when the Claude runtime is installed here.
 *   3. state.md — its YAML frontmatter is re-derived from the body (phase
 *      progress, status). The body prose is never touched.
 *
 * Dry-run by default (`--apply` to write). Refuses to run inside the PAN source
 * repository, mirroring the installer and experiment guards.
 */

const fs = require('fs');
const path = require('path');
const { output, safeReadFile } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { syncStateFrontmatter } = require('./state.cjs');
const {
  buildAgentsMdSection,
  upsertAgentsMdSection,
  ensureClaudeMdImport,
} = require('./agents-md.cjs');
const { isSuspiciousDirective } = require('./memory-optimize.cjs');

/**
 * Scan a procedural-memory file (AGENTS.md / CLAUDE.md) for lines that read like
 * directives aimed at the agent — a memory-injection risk in the ALWAYS-loaded
 * instruction files (ADR-0040). rebuild owns only the marker-fenced PAN section
 * (regenerated from a fixed template, so it can't be poisoned); user content is
 * preserved by contract, so here we WARN rather than auto-edit — surfacing
 * suspect lines for human review instead of silently rewriting the user's file.
 */
function scanForDirectives(file, content, warnings) {
  if (typeof content !== 'string') return;
  content.split('\n').forEach((line, i) => {
    if (isSuspiciousDirective(line)) {
      warnings.push({ file, line: i + 1, text: line.trim().slice(0, 200) });
    }
  });
}

// Source repo root — mirrors experiment.cjs / install.js. __dirname is
// .../pan-wizard-core/bin/lib, so three levels up is the repo (or install) root.
const PAN_SOURCE_ROOT = path.resolve(__dirname, '..', '..', '..');

// Runtime → config directory. A runtime is "installed here" when its dir exists
// in the project. AGENTS.md is shared by all; only Claude gets a bridge file.
const RUNTIME_DIRS = {
  claude: '.claude',
  codex: '.codex',
  gemini: '.gemini',
  opencode: '.opencode',
  copilot: '.github',
};

function normPath(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * True only when `cwd` is the genuine PAN source repository — inside
 * PAN_SOURCE_ROOT *and* that root actually looks like the source checkout
 * (has bin/install.js). In an install layout PAN_SOURCE_ROOT resolves to the
 * runtime config dir, which has no bin/install.js, so this stays false.
 */
function isInsideSourceRepo(cwd) {
  const abs = normPath(path.resolve(cwd));
  const src = normPath(PAN_SOURCE_ROOT);
  const inside = abs === src || abs.startsWith(src + path.sep) || abs.startsWith(src + '/');
  if (!inside) return false;
  return fs.existsSync(path.join(PAN_SOURCE_ROOT, 'bin', 'install.js')) &&
    fs.existsSync(path.join(PAN_SOURCE_ROOT, 'pan-wizard-core'));
}

/** Which PAN runtimes are installed in this project (by config-dir presence). */
function detectRuntimes(cwd) {
  return Object.entries(RUNTIME_DIRS)
    .filter(([, dir]) => {
      try { return fs.statSync(path.join(cwd, dir)).isDirectory(); }
      catch { return false; }
    })
    .map(([name]) => name);
}

/**
 * Rebuild one file: compute the desired content from `existing`, compare, and
 * (on apply) write only when it differs. Returns a per-target status.
 */
function rebuildFile(filePath, existing, desired, apply) {
  const absent = existing == null;
  if (existing === desired) return { action: 'unchanged', wrote: false };
  const action = absent ? 'create' : 'update';
  if (apply) fs.writeFileSync(filePath, desired, 'utf-8');
  return { action, wrote: apply };
}

/**
 * `memory rebuild [--apply]` — regenerate derived tools-memory + state.md
 * frontmatter. Dry-run by default: reports what WOULD change.
 */
function cmdMemoryRebuild(cwd, opts = {}, raw) {
  const apply = !!opts.apply;

  if (isInsideSourceRepo(cwd)) {
    output(
      { error: 'source_repo', rebuilt: [] },
      raw,
      `refusing to rebuild memory inside the PAN source repository (${PAN_SOURCE_ROOT})`,
    );
    return;
  }

  const runtimes = detectRuntimes(cwd);
  const targets = [];
  const warnings = [];

  // 1. AGENTS.md — universal PAN section (all runtimes read it natively).
  {
    const p = path.join(cwd, 'AGENTS.md');
    const existing = safeReadFile(p);
    const desired = upsertAgentsMdSection(existing, buildAgentsMdSection());
    targets.push({ file: 'AGENTS.md', ...rebuildFile(p, existing, desired, apply) });
    scanForDirectives('AGENTS.md', desired, warnings);
  }

  // 2. CLAUDE.md — Claude bridge, only when the Claude runtime is installed.
  if (runtimes.includes('claude')) {
    const p = path.join(cwd, 'CLAUDE.md');
    const existing = safeReadFile(p);
    const desired = ensureClaudeMdImport(existing);
    targets.push({ file: 'CLAUDE.md', ...rebuildFile(p, existing, desired, apply) });
    scanForDirectives('CLAUDE.md', desired, warnings);
  }

  // 3. state.md — re-derive YAML frontmatter from the body (progress/status).
  {
    const p = path.join(planningPath(cwd), 'state.md');
    const existing = safeReadFile(p);
    if (existing != null) {
      const desired = syncStateFrontmatter(existing, cwd);
      targets.push({ file: '.planning/state.md', ...rebuildFile(p, existing, desired, apply) });
    }
  }

  const changed = targets.filter((t) => t.action !== 'unchanged');
  const result = {
    apply,
    runtimes,
    rebuilt: targets,
    changed_count: changed.length,
    directive_warnings: warnings,
  };
  const warnNote = warnings.length ? `; ⚠ ${warnings.length} directive-like line(s) in procedural memory — review (not auto-edited)` : '';
  const summary = (changed.length === 0
    ? `tools memory already current (${targets.map((t) => t.file).join(', ')}) — nothing to do`
    : `${apply ? 'rebuilt' : 'would rebuild'} ${changed.map((t) => `${t.file} (${t.action})`).join(', ')}`) + warnNote;
  output(result, raw, summary);
}

module.exports = {
  cmdMemoryRebuild,
  detectRuntimes,
  isInsideSourceRepo,
  rebuildFile,
  scanForDirectives,
  PAN_SOURCE_ROOT,
  RUNTIME_DIRS,
};
