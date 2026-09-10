/**
 * Hygiene — project cleanup + version alignment (ADR: docs/FIELD-HARVEST-2026-07.md follow-ups).
 *
 * A PAN-managed project accumulates drift as PAN versions advance and
 * campaigns run: runtime installs fall behind the latest version, legacy
 * uppercase planning filenames linger from pre-v2.2 layouts, atomic-write
 * .tmp orphans survive crashes, per-agent memory logs grow past the cap,
 * cost ledgers written by pre-v3.12.4 hooks are 100% poisoned, telemetry
 * trace sessions pile up unboundedly, and stray fragment `.planning/`
 * directories appear where a mapping step once ran.
 *
 * Two commands, one module:
 *   - scan  — detect all of the above, report findings (read-only)
 *   - clean — apply the SAFE fixes (case renames, tmp removal, memory
 *             compaction, ledger quarantine-by-rename, trace pruning);
 *             dry-run by default, `--apply` to execute. Version drift and
 *             fragment dirs are never auto-fixed — they get remediation
 *             text instead (installer re-run / manual delete).
 *
 * Nothing here deletes user content: the poisoned ledger is renamed in
 * place (quarantined-<date> suffix), and only derived/ephemeral artifacts
 * (.tmp orphans, aged trace sessions) are removed outright.
 */

const fs = require('fs');
const path = require('path');
const { output, safeReadFile, toPosix, buildCachedContext } = require('./core.cjs');
const {
  HYGIENE_TRACE_RETENTION_DAYS,
  HYGIENE_TRACE_KEEP_MIN,
  HYGIENE_LEDGER_SUSPECT_RATIO,
  HYGIENE_LEDGER_SUSPECT_MASS_RATIO,
  HYGIENE_REPORT_KEEP_MIN,
  CACHE_BLOCK_WARN_TOKENS,
  CACHE_BLOCK_CRIT_TOKENS,
  CACHE_FILE_WARN_TOKENS,
  HYGIENE_LEDGER_MIN_RECORDS,
  HYGIENE_TMP_AGE_MS,
  CHARS_PER_TOKEN,
  STATE_FILE,
} = require('./constants.cjs');
const { planningPath, planningRel } = require('./utils.cjs');
const { listMemoryAgents, readMemory, compactMemory } = require('./memory.cjs');
const { readRecords, isSuspectRecord, METRICS_DIR, TOKENS_FILE } = require('./cost.cjs');
const { assessCacheTtl } = require('./context-budget.cjs');
const { planningRootRel, planningRoots, withPlanningRoot, describePlanningRoot, TRACKS_DIR } = require('./planning-root.cjs');

/** Runtime config dirs a PAN install can live in, relative to project root. */
const RUNTIME_DIRS = [
  { runtime: 'claude', dir: '.claude' },
  { runtime: 'codex', dir: '.codex' },
  { runtime: 'gemini', dir: '.gemini' },
  { runtime: 'opencode', dir: '.opencode' },
  { runtime: 'copilot', dir: '.github' },
];

const MANIFEST_NAME = 'pan-file-manifest.json';

/**
 * Per-transcript read cursor written beside the ledger by hooks/pan-cost-logger.js.
 * Mirrored here by name because hooks are standalone and export nothing importable
 * into the core; quarantining a ledger without clearing this leaves the fresh
 * ledger inheriting the old one's read position.
 */
const COST_CURSOR_FILE = '.cost-cursor.json';

/** Pre-v2.2 uppercase planning filenames whose canonical form is lowercase. */
const LEGACY_UPPERCASE_FILES = [
  'STATE.md', 'ROADMAP.md', 'PROJECT.md', 'REQUIREMENTS.md',
  'MILESTONES.md', 'STANDARDS.md', 'PAUSE.md',
];

const MEMORY_ENTRY_CAP = (() => {
  try { return require('./memory.cjs').DEFAULT_MAX_ENTRIES || 500; } catch { return 500; }
})();

// ─── Small helpers ──────────────────────────────────────────────────────────

/** Compare dotted versions; returns -1/0/1. Tolerates missing segments. */
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Version of the pan-wizard-core copy executing this code (install or source root). */
function ownVersion() {
  const pkg = safeReadFile(path.resolve(__dirname, '..', '..', '..', 'package.json'));
  if (!pkg) return null;
  try { return JSON.parse(pkg).version || null; } catch { return null; }
}

function mkFinding(check, severity, relPath, detail, fix) {
  // `track` is stamped by scanHygiene once it knows which tree produced the
  // finding; null means the project root tree (or a project-wide check).
  return { check, severity, path: toPosix(relPath), detail, fix: fix || null, fixable: !!fix, track: null };
}

// ─── Checks ─────────────────────────────────────────────────────────────────

/**
 * H-1: version alignment across runtime installs. Report-only — the fix is
 * re-running the installer, which hygiene must not do on its own.
 */
function checkVersionAlignment(cwd) {
  const findings = [];
  const installs = [];
  for (const { runtime, dir } of RUNTIME_DIRS) {
    const manifestPath = path.join(cwd, dir, MANIFEST_NAME);
    const raw = safeReadFile(manifestPath);
    if (raw === null) {
      // A pan-wizard-core copy without a manifest is an untracked install.
      let hasCore = false;
      try { fs.accessSync(path.join(cwd, dir, 'pan-wizard-core')); hasCore = true; } catch { /* absent */ }
      if (hasCore) {
        findings.push(mkFinding('version-alignment', 'warn', path.join(dir),
          `${runtime}: pan-wizard-core present but no ${MANIFEST_NAME} — untracked install`,
          null));
      }
      continue;
    }
    let version = null;
    try { version = JSON.parse(raw).version || null; } catch { /* malformed */ }
    installs.push({ runtime, dir, version });
  }

  const own = ownVersion();
  const latest = [own, ...installs.map(i => i.version)]
    .filter(Boolean)
    .sort(compareVersions)
    .pop() || null;

  for (const i of installs) {
    if (i.version && latest && compareVersions(i.version, latest) < 0) {
      findings.push(mkFinding('version-alignment', 'warn', i.dir,
        `${i.runtime}: installed ${i.version}, latest ${latest} — re-run the installer to align`,
        null));
    }
    if (!i.version) {
      findings.push(mkFinding('version-alignment', 'warn', i.dir,
        `${i.runtime}: manifest has no version field — re-run the installer`,
        null));
    }
  }
  return { findings, installs, latest_version: latest };
}

/** H-2: legacy uppercase planning filenames (pre-v2.2 layout). */
function checkLegacyUppercase(cwd) {
  const findings = [];
  const dir = planningPath(cwd);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return { findings }; }
  for (const name of entries) {
    if (!LEGACY_UPPERCASE_FILES.includes(name)) continue;
    const lower = name.toLowerCase();
    // Case-sensitive twin check via literal directory listing (existsSync is
    // case-insensitive on Windows and would always be true here).
    const twin = entries.includes(lower);
    if (twin) {
      findings.push(mkFinding('legacy-filenames', 'warn', planningRel(name),
        `legacy ${name} coexists with ${lower} — merge manually, auto-rename would clobber`,
        null));
    } else {
      findings.push(mkFinding('legacy-filenames', 'warn', planningRel(name),
        `legacy uppercase filename — canonical form is ${lower}`,
        { action: 'rename-lowercase', from: name, to: lower }));
    }
  }
  return { findings };
}

/**
 * Bounded recursive walk of the ACTIVE planning tree, collecting file paths.
 *
 * Never descends into `<root>/tracks/`: those are sibling planning trees, each
 * scanned in its own pass with its own root. Without this the root scan absorbs
 * every track's files — attributing their `.tmp` orphans and docs to `.planning`
 * — and `--all-tracks` counts them twice, once under the root and once under
 * the track they actually belong to.
 */
function walkPlanning(cwd, maxDepth = 5) {
  const root = planningPath(cwd);
  const tracksDir = path.join(root, TRACKS_DIR);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (abs === tracksDir) continue;
        walk(abs, depth + 1);
      } else {
        out.push(abs);
      }
    }
  };
  walk(root, 0);
  return out;
}

/** H-3: orphaned atomic-write .tmp files older than the age threshold. */
function checkTmpOrphans(cwd, now = Date.now()) {
  const findings = [];
  for (const abs of walkPlanning(cwd)) {
    if (!abs.endsWith('.tmp')) continue;
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (now - stat.mtimeMs < HYGIENE_TMP_AGE_MS) continue;
    findings.push(mkFinding('tmp-orphans', 'info', path.relative(cwd, abs),
      `orphaned atomic-write temp file (age ${Math.round((now - stat.mtimeMs) / 3600000)}h)`,
      { action: 'delete' }));
  }
  return { findings };
}

/** H-4: per-agent memory logs past the entry cap (compaction never ran). */
function checkMemoryLogs(cwd) {
  const findings = [];
  const { agents } = listMemoryAgents(cwd);
  for (const a of agents) {
    const mem = readMemory(cwd, a.agent);
    if (!mem || !Array.isArray(mem.entries)) continue;
    if (mem.entries.length <= MEMORY_ENTRY_CAP) continue;
    findings.push(mkFinding('memory-bloat', 'warn',
      planningRel('memory', `${a.agent}.md`),
      `${mem.entries.length} entries exceeds cap ${MEMORY_ENTRY_CAP} — whole-file reads flood context`,
      { action: 'compact-memory', agent: a.agent }));
  }
  return { findings };
}

/**
 * Thousands separator that does not depend on the host locale. `toLocaleString()`
 * emits a narrow no-break space in some locales and a comma in others, which
 * makes finding text vary by machine and any test asserting on it flaky.
 */
function fmtTokens(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Token mass of a ledger record across all four axes. */
function recordMass(r) {
  return (r.input_tokens || 0) + (r.output_tokens || 0)
    + (r.cache_read_tokens || 0) + (r.cache_write_tokens || 0);
}

/**
 * H-5: cost ledger dominated by physically implausible (pre-v3.12.4) records.
 *
 * Gated on token MASS as well as record count. A count-only gate passes a ledger
 * whose few bad rows carry most of the tokens — field case: 24% of rows suspect
 * (under the 50% count gate, so "clean") holding 90% of the token mass, which
 * makes every aggregate read off that file wrong by an order of magnitude. Mass
 * is what `aggregate` actually sums, so mass is what the gate has to watch.
 */
function checkCostLedger(cwd) {
  const findings = [];
  let records = [];
  try { records = readRecords(cwd) || []; } catch { return { findings }; }
  if (records.length < HYGIENE_LEDGER_MIN_RECORDS) return { findings };

  const suspectRecords = records.filter(r => isSuspectRecord(r));
  const suspect = suspectRecords.length;
  const ratio = suspect / records.length;

  const totalMass = records.reduce((sum, r) => sum + recordMass(r), 0);
  const suspectMass = suspectRecords.reduce((sum, r) => sum + recordMass(r), 0);
  const massRatio = totalMass > 0 ? suspectMass / totalMass : 0;

  const byCount = ratio >= HYGIENE_LEDGER_SUSPECT_RATIO;
  const byMass = massRatio >= HYGIENE_LEDGER_SUSPECT_MASS_RATIO;
  if (!byCount && !byMass) return { findings };

  // Name whichever gate fired, so the remediation is not mistaken for a
  // false positive when the record count looks healthy.
  const basis = byCount && byMass ? 'record count and token mass'
    : byCount ? 'record count'
      : 'token mass';
  findings.push(mkFinding('poisoned-ledger', 'critical',
    planningRel(METRICS_DIR, TOKENS_FILE),
    `${suspect}/${records.length} records suspect (${Math.round(ratio * 100)}% of rows, ${Math.round(massRatio * 100)}% of token mass) — pre-v3.12.4 oversum signature, tripped on ${basis}; aggregates quarantine them but the file is dead weight`,
    { action: 'quarantine-ledger' }));
  return { findings };
}

/** H-6: telemetry trace sessions beyond retention (always keep the newest few). */
function checkStaleTraces(cwd, opts, now = Date.now()) {
  const findings = [];
  const retentionDays = Number(opts?.traceAgeDays) || HYGIENE_TRACE_RETENTION_DAYS;
  const tracesDir = path.join(planningPath(cwd), 'optimization', 'traces');
  let entries = [];
  try { entries = fs.readdirSync(tracesDir, { withFileTypes: true }); } catch { return { findings }; }
  const sessions = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const abs = path.join(tracesDir, e.name);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    sessions.push({ name: e.name, abs, mtime: stat.mtimeMs });
  }
  sessions.sort((a, b) => b.mtime - a.mtime);
  const cutoff = now - retentionDays * 24 * 3600 * 1000;
  for (const s of sessions.slice(HYGIENE_TRACE_KEEP_MIN)) {
    if (s.mtime >= cutoff) continue;
    findings.push(mkFinding('stale-traces', 'info',
      path.relative(cwd, s.abs),
      `trace session older than ${retentionDays}d retention (and not among newest ${HYGIENE_TRACE_KEEP_MIN})`,
      { action: 'delete-dir' }));
  }
  return { findings };
}

/**
 * H-8: optimization reports past retention.
 *
 * `checkStaleTraces` pruned `optimization/traces/` but nothing ever pruned
 * `optimization/reports/`, which is where the analysis JSON lands — in the field
 * the single largest file in a planning tree was a 92 KB analysis report from a
 * session whose trace had long since been pruned. Same retention, same
 * keep-newest floor, so the two halves of one subsystem age together.
 */
function checkStaleReports(cwd, opts, now = Date.now()) {
  const findings = [];
  const retentionDays = Number(opts?.traceAgeDays) || HYGIENE_TRACE_RETENTION_DAYS;
  const reportsDir = planningPath(cwd, 'optimization', 'reports');
  let entries = [];
  try { entries = fs.readdirSync(reportsDir, { withFileTypes: true }); } catch { return { findings }; }

  const reports = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = path.join(reportsDir, e.name);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    reports.push({ name: e.name, abs, mtime: stat.mtimeMs, size: stat.size });
  }
  reports.sort((a, b) => b.mtime - a.mtime);

  const cutoff = now - retentionDays * 24 * 3600 * 1000;
  for (const r of reports.slice(HYGIENE_REPORT_KEEP_MIN)) {
    if (r.mtime >= cutoff) continue;
    findings.push(mkFinding('stale-reports', 'info',
      path.relative(cwd, r.abs),
      `optimization report older than ${retentionDays}d retention (and not among newest ${HYGIENE_REPORT_KEEP_MIN}) — ${(r.size / 1024).toFixed(1)} KB`,
      { action: 'delete' }));
  }
  return { findings };
}

/**
 * H-9: cached prompt context bloat.
 *
 * The files in CACHEABLE_CONTEXT_FILES are re-read into EVERY agent call, so
 * their combined size is the dominant recurring cost of a PAN project — cache
 * reads outweigh generated tokens by roughly two orders of magnitude. Nothing
 * used to watch this: `context-budget` measured the block and reported it
 * without any threshold, so a state.md that had grown to ~14k tokens of mostly
 * closed history was re-read for months without a single warning.
 *
 * Report-only for the block as a whole; the per-file finding carries the
 * `state compact` remediation because state.md is the file that actually grows.
 */
/**
 * Remove superseded quarantined ledgers, keeping only the one just written.
 *
 * Quarantine is deliberately non-destructive — the poisoned rows are evidence,
 * not garbage — but keeping EVERY quarantine forever turns the cure into the
 * disease. The newest is retained so the most recent evidence survives; older
 * ones have already been superseded by it.
 *
 * @param {string} metricsDirAbs - directory holding the ledger
 * @param {string} keepAbs - the quarantine file to preserve
 * @returns {number} how many were removed
 */
function pruneOldQuarantines(metricsDirAbs, keepAbs) {
  let removed = 0;
  let entries = [];
  try { entries = fs.readdirSync(metricsDirAbs); } catch { return 0; }
  const keepName = path.basename(keepAbs);
  for (const name of entries) {
    if (name === keepName) continue;
    if (!name.startsWith(`${TOKENS_FILE}.quarantined-`)) continue;
    try { fs.unlinkSync(path.join(metricsDirAbs, name)); removed++; } catch { /* leave it */ }
  }
  return removed;
}

/** How many markdown docs the planning tree holds — "is there anything to cache?". */
function planningDocCount(cwd) {
  return walkPlanning(cwd).filter(p => p.endsWith('.md')).length;
}

function checkCachedContext(cwd) {
  const findings = [];
  let cached;
  try { cached = buildCachedContext(cwd); } catch { return { findings }; }
  if (!cached || !Array.isArray(cached.blocks)) return { findings };

  // An empty block is not "small" — it means this project gets NO prompt
  // caching at all, which is worth saying out loud rather than reporting as a
  // healthy zero. But only for a tree that HAS planning content: a freshly
  // scaffolded `.planning/phases/` has nothing to cache yet, and reporting that
  // as a finding is noise on every new project. The signal is "you have
  // planning docs and none of them are cached", not "you have no docs".
  if (cached.blocks.length === 0) {
    if (planningDocCount(cwd) > 0) {
      findings.push(mkFinding('cache-context', 'info', planningRel(),
        'planning docs exist but none are cacheable — every agent call re-sends its context uncached. '
        + 'Add project.md/standards.md, or list stable docs under config.json cache.extra_files',
        null));
    }
    return { findings };
  }

  const blockTokens = Math.ceil(cached.total_bytes / CHARS_PER_TOKEN);
  if (blockTokens >= CACHE_BLOCK_WARN_TOKENS) {
    const severity = blockTokens >= CACHE_BLOCK_CRIT_TOKENS ? 'critical' : 'warn';
    findings.push(mkFinding('cache-context', severity, planningRel(),
      `cached context block is ~${fmtTokens(blockTokens)} tokens across ${cached.blocks.length} file(s) `
      + `(warn ${fmtTokens(CACHE_BLOCK_WARN_TOKENS)}, critical ${fmtTokens(CACHE_BLOCK_CRIT_TOKENS)}) — `
      + 're-read on every agent call, so this is the project\'s largest recurring cost',
      null));
  }

  for (const b of cached.blocks) {
    const tokens = Math.ceil((b.content || '').length / CHARS_PER_TOKEN);
    if (tokens < CACHE_FILE_WARN_TOKENS) continue;
    const isState = String(b.path).endsWith(STATE_FILE);

    // A finding may only advertise `auto-fixable` when running the fix would
    // actually change something. state.md stays over the threshold once its
    // settled history has already been archived — the remaining bulk is LIVE
    // content, and no amount of re-running `clean` will shrink it. Claiming
    // otherwise makes `clean --apply` report a permanent `failed: 1` and the
    // project never converges to clean.
    let fix = null;
    let suffix = '';
    if (isState) {
      suffix = ' — state.md section writers only append; closed history is still being re-read';
      const archivable = stateCompactionAvailable(cwd);
      if (archivable > 0) {
        fix = { action: 'compact-state' };
      } else {
        suffix = ' — already compacted; the remaining bulk is LIVE content, so trim it by hand'
          + ' (or widen the window with `state compact --keep-days N`)';
      }
    }

    findings.push(mkFinding('cache-context', 'warn', b.path,
      `~${fmtTokens(tokens)} tokens re-read on every agent call (warn ${fmtTokens(CACHE_FILE_WARN_TOKENS)})${suffix}`,
      fix));
  }

  // Lifetime signal (ADR-0046 D5): the ledger shows cache WRITES that followed
  // an idle gap of five to sixty minutes — misses a one-hour subagent cache
  // lifetime would have turned into hits. Informational and never fixable: the
  // remedy is a Claude Code setting the user weighs against the 2× write price.
  try {
    const ttl = assessCacheTtl(readRecords(cwd).filter(r => !isSuspectRecord(r)));
    if (ttl.recommend) {
      findings.push(mkFinding('cache-context', 'info', planningRel(path.join(METRICS_DIR, TOKENS_FILE)), ttl.advice, null));
    }
  } catch { /* no ledger, or unreadable — nothing to say */ }
  return { findings };
}

/**
 * How many state.md sections `state compact` could archive right now.
 *
 * Consulted before offering the `compact-state` fix so hygiene never advertises
 * a remedy that would no-op. Returns 0 on any failure — an unavailable planner
 * must make the finding manual, never falsely fixable.
 */
function stateCompactionAvailable(cwd) {
  try {
    const { planStateCompaction } = require('./state-compact.cjs');
    return planStateCompaction(cwd).archivable.length;
  } catch {
    return 0;
  }
}

/** H-7: fragment .planning — artifacts present but no project spine. Report-only. */
function checkPlanningFragment(cwd) {
  const findings = [];
  const dir = planningPath(cwd);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return { findings, planning_exists: false }; }
  const lower = entries.map(e => e.toLowerCase());
  // Spine = anything that marks a deliberate PAN workflow: the phase model
  // (project/state/phases/roadmap/requirements/milestones) OR the focus model
  // (focus/quick) OR an orchestration campaign. A dir holding only generated
  // artifacts (codebase maps, metrics, traces) is a stray fragment.
  const SPINE = ['project.md', 'state.md', 'phases', 'roadmap.md', 'requirements.md',
    'milestones', 'focus', 'quick', 'orchestration'];
  const hasSpine = SPINE.some(s => lower.includes(s));
  if (!hasSpine && entries.length > 0) {
    findings.push(mkFinding('planning-fragment', 'info', planningRootRel(),
      `.planning exists with ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (${entries.slice(0, 5).join(', ')}) but no workflow spine (project/state/phases/focus/…) — likely a stray partial run; review and delete manually`,
      null));
  }
  return { findings, planning_exists: true };
}

// ─── Scan ───────────────────────────────────────────────────────────────────

/**
 * Run all hygiene checks. Read-only.
 *
 * @param {string} cwd - project root
 * @param {Object} [opts] - {traceAgeDays}
 * @returns {Object} {findings, installs, latest_version, planning_exists, summary}
 */
/**
 * Run every planning-tree check against one root, tagging each finding with
 * the track it came from.
 *
 * @param {string} cwd - project root
 * @param {{name: string|null, rel: string}} root - the tree to scan
 * @param {Object} [opts]
 * @returns {{findings: Array, planning_exists: boolean}}
 */
function scanOneRoot(cwd, root, opts) {
  return withPlanningRoot(root.rel, () => {
    const fragment = checkPlanningFragment(cwd);
    const findings = [
      ...fragment.findings,
      ...checkLegacyUppercase(cwd).findings,
      ...checkTmpOrphans(cwd).findings,
      ...checkMemoryLogs(cwd).findings,
      ...checkCostLedger(cwd).findings,
      ...checkStaleTraces(cwd, opts).findings,
      ...checkStaleReports(cwd, opts).findings,
      ...checkCachedContext(cwd).findings,
    ];
    for (const f of findings) f.track = root.name;
    return { findings, planning_exists: fragment.planning_exists !== false };
  }, root.name);
}

function scanHygiene(cwd, opts) {
  // Version alignment is a property of the PROJECT (which runtimes are
  // installed, at what version), not of any planning tree — run it once no
  // matter how many trees we sweep, or a four-track repo reports the same
  // drift four times.
  const version = checkVersionAlignment(cwd);
  const roots = planningRoots(cwd, { allTracks: !!opts?.allTracks });

  const findings = [...version.findings];
  const scanned = [];
  let planningExists = false;

  for (const root of roots) {
    const result = scanOneRoot(cwd, root, opts);
    if (result.planning_exists) planningExists = true;
    scanned.push({
      track: root.name,
      planning_root: root.rel,
      planning_exists: result.planning_exists,
      findings: result.findings.length,
    });
    findings.push(...result.findings);
  }

  const byCheck = {};
  for (const f of findings) byCheck[f.check] = (byCheck[f.check] || 0) + 1;
  const byTrack = {};
  for (const f of findings) {
    const key = f.track || '(root)';
    byTrack[key] = (byTrack[key] || 0) + 1;
  }

  return {
    findings,
    installs: version.installs,
    latest_version: version.latest_version,
    planning_exists: planningExists,
    // What was actually looked at. Present in every scan, not just --all-tracks:
    // a scan that reports "clean" must always say which tree it read, so a
    // wrong target is visible instead of passing for a clean bill of health.
    ...describePlanningRoot(cwd),
    all_tracks: !!opts?.allTracks,
    roots_scanned: scanned,
    summary: {
      total: findings.length,
      fixable: findings.filter(f => f.fixable).length,
      by_check: byCheck,
      by_track: byTrack,
      by_severity: findings.reduce((m, f) => { m[f.severity] = (m[f.severity] || 0) + 1; return m; }, {}),
    },
  };
}

// ─── Clean ──────────────────────────────────────────────────────────────────

function applyFix(cwd, finding) {
  const fix = finding.fix;
  const abs = path.join(cwd, finding.path);
  try {
    switch (fix.action) {
      case 'rename-lowercase': {
        // Two-step rename: Windows treats case-only renames inconsistently
        // across fs layers, so hop through a temp name.
        const dir = path.dirname(abs);
        const hop = path.join(dir, `${fix.to}.case-hop`);
        fs.renameSync(abs, hop);
        fs.renameSync(hop, path.join(dir, fix.to));
        return { applied: true, detail: `renamed ${fix.from} -> ${fix.to}` };
      }
      case 'delete':
        fs.unlinkSync(abs);
        return { applied: true, detail: 'deleted' };
      case 'delete-dir':
        fs.rmSync(abs, { recursive: true, force: true });
        return { applied: true, detail: 'removed directory' };
      case 'compact-memory': {
        const r = compactMemory(cwd, fix.agent);
        if (r.error) return { applied: false, detail: r.error };
        return { applied: true, detail: `compacted to ${r.kept ?? r.entries ?? 'cap'} entries` };
      }
      case 'compact-state': {
        // Required lazily: state-compact pulls in state.cjs, which pulls in core
        // — importing it at module load would put hygiene on that cycle.
        const { compactState } = require('./state-compact.cjs');
        const r = compactState(cwd, { apply: true });
        if (!r.found) return { applied: false, detail: 'state.md not found' };
        if (!r.applied) return { applied: false, detail: 'nothing past the retention window' };
        return {
          applied: true,
          detail: `archived ${r.archived.length} section(s) to ${r.history_path} — saves ~${r.tokens_saved_per_call} tokens per agent call`,
        };
      }
      case 'quarantine-ledger': {
        const stamp = new Date().toISOString().slice(0, 10);
        const dest = `${abs}.quarantined-${stamp}`;
        fs.renameSync(abs, dest);

        // The cursor is a per-transcript high-water mark INTO the ledger we just
        // moved aside. Left behind it points at rows that are no longer there,
        // so the fresh ledger starts mid-stream and the next slice is undercounted.
        // A "fresh ledger" that inherits the old ledger's read position is not fresh.
        let cursorNote = '';
        try {
          const cursor = path.join(path.dirname(abs), COST_CURSOR_FILE);
          fs.unlinkSync(cursor);
          cursorNote = ', cursor reset';
        } catch { /* no cursor to reset */ }

        // Quarantine leaves a dated copy behind, and nothing else ever removes
        // one. Run hygiene a few times over a year and the metrics dir fills
        // with dead ledgers — the very bloat this command exists to remove.
        const pruned = pruneOldQuarantines(path.dirname(abs), dest);
        const prunedNote = pruned > 0 ? `, ${pruned} older quarantine(s) removed` : '';

        return {
          applied: true,
          detail: `renamed to ${path.basename(dest)}${cursorNote}${prunedNote} — fresh ledger starts clean`,
        };
      }
      default:
        return { applied: false, detail: `unknown fix action ${fix.action}` };
    }
  } catch (e) {
    return { applied: false, detail: `fix failed: ${e.message}` };
  }
}

/**
 * Apply safe fixes for fixable findings. Dry-run unless opts.apply.
 *
 * @param {string} cwd
 * @param {Object} [opts] - {apply, traceAgeDays}
 * @returns {Object} {dry_run, applied, skipped, remaining, summary}
 */
function cleanHygiene(cwd, opts) {
  const scan = scanHygiene(cwd, opts);
  const apply = !!opts?.apply;
  const applied = [];
  const skipped = [];

  // Which tree each finding came from. Most fixes act on finding.path, which is
  // already track-correct — but compact-memory delegates to memory.cjs, which
  // resolves the root itself. Without this map a track's bloated memory log
  // would be "fixed" by compacting the root tree's log instead.
  const rootByTrack = new Map();
  for (const r of scan.roots_scanned || []) rootByTrack.set(r.track, r.planning_root);

  for (const f of scan.findings) {
    if (!f.fixable) {
      skipped.push({ check: f.check, path: f.path, track: f.track, reason: 'no safe auto-fix — see detail', detail: f.detail });
      continue;
    }
    if (!apply) {
      applied.push({ check: f.check, path: f.path, track: f.track, action: f.fix.action, applied: false, detail: 'dry-run' });
      continue;
    }
    const rootRel = rootByTrack.get(f.track);
    const result = rootRel
      ? withPlanningRoot(rootRel, () => applyFix(cwd, f))
      : applyFix(cwd, f);
    applied.push({ check: f.check, path: f.path, track: f.track, action: f.fix.action, ...result });
  }

  return {
    dry_run: !apply,
    applied,
    skipped,
    planning_root: scan.planning_root,
    track: scan.track,
    planning_root_source: scan.planning_root_source,
    planning_root_exists: scan.planning_root_exists,
    all_tracks: scan.all_tracks,
    roots_scanned: scan.roots_scanned,
    summary: {
      fixable: applied.length,
      executed: applied.filter(a => a.applied).length,
      failed: apply ? applied.filter(a => !a.applied).length : 0,
      manual: skipped.length,
    },
  };
}

// ─── CLI wrappers ───────────────────────────────────────────────────────────

function renderFindings(findings) {
  const lines = [];
  for (const f of findings) {
    const where = f.track ? `[${f.track}] ` : '';
    lines.push(`  [${f.severity.toUpperCase().padEnd(8)}] ${f.check.padEnd(18)} ${where}${f.path}`);
    lines.push(`             ${f.detail}${f.fixable ? '  (auto-fixable)' : ''}`);
  }
  return lines;
}

/**
 * One line naming exactly which tree(s) were read.
 *
 * Printed on every scan, including clean ones. "Clean" is only meaningful
 * alongside "…and here is what I looked at" — the original defect was a scan
 * reporting no findings because it had read the wrong directory, which is
 * indistinguishable from a healthy project unless the target is stated.
 */
function renderScope(result) {
  if (result.all_tracks) {
    const names = (result.roots_scanned || []).map(r => r.track || '(root)');
    return `Scanned ${names.length} planning tree(s): ${names.join(', ')}`;
  }
  const via = result.planning_root_source && result.planning_root_source !== 'default'
    ? ` (via ${result.planning_root_source})` : '';
  const missing = result.planning_root_exists === false ? '  — DIRECTORY NOT FOUND' : '';
  return `Scanned planning root: ${result.planning_root}${via}${missing}`;
}

function cmdHygieneScan(cwd, opts, raw) {
  const result = scanHygiene(cwd, opts);
  if (raw) {
    const lines = [`Hygiene scan: ${result.summary.total} finding(s), ${result.summary.fixable} auto-fixable`];
    lines.push(renderScope(result));
    if (result.latest_version) {
      lines.push(`Latest version seen: ${result.latest_version}; installs: ${result.installs.map(i => `${i.runtime}@${i.version || '?'}`).join(', ') || 'none'}`);
    }
    lines.push('', ...renderFindings(result.findings));
    if (result.findings.length === 0) {
      lines.push('  Clean — nothing to do.');
      if (!result.all_tracks) {
        lines.push('  (one tree only — pass --all-tracks to include .planning/tracks/*)');
      }
    }
    output(result, true, lines.join('\n'));
  } else {
    output(result, false);
  }
}

function cmdHygieneClean(cwd, opts, raw) {
  const result = cleanHygiene(cwd, opts);
  if (raw) {
    const mode = result.dry_run ? 'DRY-RUN (pass --apply to execute)' : 'APPLIED';
    const lines = [`Hygiene clean — ${mode}`, renderScope(result), ''];
    for (const a of result.applied) {
      const where = a.track ? `[${a.track}] ` : '';
      lines.push(`  ${a.applied ? '✓' : (result.dry_run ? '·' : '✗')} ${a.action.padEnd(18)} ${where}${a.path}  ${a.detail}`);
    }
    for (const s of result.skipped) {
      const where = s.track ? `[${s.track}] ` : '';
      lines.push(`  ! manual            ${where}${s.path}  ${s.detail}`);
    }
    lines.push('', `fixable: ${result.summary.fixable}, executed: ${result.summary.executed}, failed: ${result.summary.failed}, manual: ${result.summary.manual}`);
    output(result, true, lines.join('\n'));
  } else {
    output(result, false);
  }
}

module.exports = {
  scanHygiene,
  cleanHygiene,
  checkVersionAlignment,
  checkLegacyUppercase,
  checkTmpOrphans,
  checkMemoryLogs,
  checkCostLedger,
  checkStaleTraces,
  checkStaleReports,
  checkCachedContext,
  checkPlanningFragment,
  compareVersions,
  cmdHygieneScan,
  cmdHygieneClean,
  RUNTIME_DIRS,
  LEGACY_UPPERCASE_FILES,
};
