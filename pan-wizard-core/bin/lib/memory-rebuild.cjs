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
 *      the marker-fenced `<!-- BEGIN/END PAN WIZARD -->` section (Codex, Copilot and
 *      OpenCode read AGENTS.md natively; Claude via the CLAUDE.md bridge; Gemini through the context.fileName entry its install adds). User content
 *      outside the markers is preserved byte-for-byte.
 *   2. CLAUDE.md — the Claude bridge (`@AGENTS.md` import), regenerated only
 *      when a Claude install is visible: in the project, or a global one.
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
  sectionState,
  routingModeOf,
  DEFAULT_ROUTING_MODE,
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

// `--only agents-md`: the tools memory alone (AGENTS.md and the Claude bridge), as
// new-project and /pan:settings ask for it; state.md is left alone.
const ONLY_TARGETS = ['agents-md'];

/**
 * True when a user-level Claude Code install of PAN is visible: this engine runs from
 * one, or the Claude user directory (CLAUDE_CONFIG_DIR, else ~/.claude) holds a core.
 * A global install writes nothing into projects, so this is how a project it serves
 * gets the CLAUDE.md bridge. `opts.homeDir` / `opts.claudeConfigDir` are test seams.
 */
function globalClaudeInstall(opts = {}) {
  const userDir = opts.claudeConfigDir !== undefined
    ? opts.claudeConfigDir
    : (opts.homeDir ? path.join(opts.homeDir, '.claude') : (process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude')));
  if (!opts.homeDir && opts.claudeConfigDir === undefined && path.basename(PAN_SOURCE_ROOT) === '.claude') return true;
  try { return !!userDir && fs.statSync(path.join(userDir, 'pan-wizard-core')).isDirectory(); } catch { return false; }
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

  if (opts.only != null && !ONLY_TARGETS.includes(opts.only)) {
    output({ error: 'bad_only', rebuilt: [] }, raw, `--only takes one of: ${ONLY_TARGETS.join(', ')}`);
    return;
  }
  const runtimes = detectRuntimes(cwd);
  const targets = [];
  const warnings = [];
  let routing = DEFAULT_ROUTING_MODE;
  try { routing = routingModeOf(JSON.parse(fs.readFileSync(path.join(planningPath(cwd), 'config.json'), 'utf8'))); } catch { /* no config: the default */ }

  // 1. AGENTS.md — universal PAN section (Claude Code reads it through the bridge in step 2).
  {
    const p = path.join(cwd, 'AGENTS.md');
    const existing = safeReadFile(p);
    const desired = upsertAgentsMdSection(existing, buildAgentsMdSection({ mode: routing }));
    // A section the project wrote for itself is kept; say so rather than "unchanged".
    const kept = sectionState(existing, 'agents') === 'edited';
    targets.push({ file: 'AGENTS.md', ...(kept ? { action: 'kept_edited', wrote: false } : rebuildFile(p, existing, desired, apply)) });
    scanForDirectives('AGENTS.md', desired, warnings);
  }

  // 2. CLAUDE.md — Claude bridge, when a Claude install is visible here: in the project,
  // or the user-level one a global install puts every project's commands in.
  const claude = runtimes.includes('claude') || globalClaudeInstall(opts);
  if (claude) {
    const p = path.join(cwd, 'CLAUDE.md');
    const existing = safeReadFile(p);
    const desired = ensureClaudeMdImport(existing);
    targets.push({ file: 'CLAUDE.md', ...rebuildFile(p, existing, desired, apply) });
    scanForDirectives('CLAUDE.md', desired, warnings);
  }

  // 3. state.md — re-derive YAML frontmatter from the body (progress/status).
  if (opts.only !== 'agents-md') {
    const p = path.join(planningPath(cwd), 'state.md');
    const existing = safeReadFile(p);
    if (existing != null) {
      let desired = null;
      try {
        desired = syncStateFrontmatter(existing, cwd);
      } catch (err) {
        // A state.md PAN refuses to re-derive (stacked front matter) is reported,
        // never rewritten on a guess.
        targets.push({ file: '.planning/state.md', action: 'refused', reason: err.message });
      }
      if (desired !== null) targets.push({ file: '.planning/state.md', ...rebuildFile(p, existing, desired, apply) });
    }
  }

  const changed = targets.filter((t) => t.action !== 'unchanged' && t.action !== 'kept_edited');
  const result = {
    apply,
    runtimes,
    routing,
    claude_bridge: claude,
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
  globalClaudeInstall,
  ONLY_TARGETS,
  isInsideSourceRepo,
  rebuildFile,
  scanForDirectives,
  PAN_SOURCE_ROOT,
  RUNTIME_DIRS,
};
