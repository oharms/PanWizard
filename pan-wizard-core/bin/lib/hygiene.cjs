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
const { output, safeReadFile, toPosix } = require('./core.cjs');
const {
  PLANNING_DIR,
  HYGIENE_TRACE_RETENTION_DAYS,
  HYGIENE_TRACE_KEEP_MIN,
  HYGIENE_LEDGER_SUSPECT_RATIO,
  HYGIENE_LEDGER_MIN_RECORDS,
  HYGIENE_TMP_AGE_MS,
} = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');
const { listMemoryAgents, readMemory, compactMemory } = require('./memory.cjs');
const { readRecords, isSuspectRecord, METRICS_DIR, TOKENS_FILE } = require('./cost.cjs');

/** Runtime config dirs a PAN install can live in, relative to project root. */
const RUNTIME_DIRS = [
  { runtime: 'claude', dir: '.claude' },
  { runtime: 'codex', dir: '.codex' },
  { runtime: 'gemini', dir: '.gemini' },
  { runtime: 'opencode', dir: '.opencode' },
  { runtime: 'copilot', dir: '.github' },
];

const MANIFEST_NAME = 'pan-file-manifest.json';

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
  return { check, severity, path: toPosix(relPath), detail, fix: fix || null, fixable: !!fix };
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
      findings.push(mkFinding('legacy-filenames', 'warn', path.join(PLANNING_DIR, name),
        `legacy ${name} coexists with ${lower} — merge manually, auto-rename would clobber`,
        null));
    } else {
      findings.push(mkFinding('legacy-filenames', 'warn', path.join(PLANNING_DIR, name),
        `legacy uppercase filename — canonical form is ${lower}`,
        { action: 'rename-lowercase', from: name, to: lower }));
    }
  }
  return { findings };
}

/** Bounded recursive walk of .planning collecting file paths. */
function walkPlanning(cwd, maxDepth = 5) {
  const root = planningPath(cwd);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, depth + 1);
      else out.push(abs);
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
      path.join(PLANNING_DIR, 'memory', `${a.agent}.md`),
      `${mem.entries.length} entries exceeds cap ${MEMORY_ENTRY_CAP} — whole-file reads flood context`,
      { action: 'compact-memory', agent: a.agent }));
  }
  return { findings };
}

/** H-5: cost ledger dominated by physically implausible (pre-v3.12.4) records. */
function checkCostLedger(cwd) {
  const findings = [];
  let records = [];
  try { records = readRecords(cwd) || []; } catch { return { findings }; }
  if (records.length < HYGIENE_LEDGER_MIN_RECORDS) return { findings };
  const suspect = records.filter(r => isSuspectRecord(r)).length;
  const ratio = suspect / records.length;
  if (ratio < HYGIENE_LEDGER_SUSPECT_RATIO) return { findings };
  findings.push(mkFinding('poisoned-ledger', 'critical',
    path.join(PLANNING_DIR, METRICS_DIR, TOKENS_FILE),
    `${suspect}/${records.length} records are suspect (${Math.round(ratio * 100)}%) — pre-v3.12.4 oversum signature; aggregates quarantine them but the file is dead weight`,
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
    findings.push(mkFinding('planning-fragment', 'info', PLANNING_DIR,
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
function scanHygiene(cwd, opts) {
  const version = checkVersionAlignment(cwd);
  const fragment = checkPlanningFragment(cwd);
  const findings = [
    ...version.findings,
    ...fragment.findings,
    ...checkLegacyUppercase(cwd).findings,
    ...checkTmpOrphans(cwd).findings,
    ...checkMemoryLogs(cwd).findings,
    ...checkCostLedger(cwd).findings,
    ...checkStaleTraces(cwd, opts).findings,
  ];
  const byCheck = {};
  for (const f of findings) byCheck[f.check] = (byCheck[f.check] || 0) + 1;
  return {
    findings,
    installs: version.installs,
    latest_version: version.latest_version,
    planning_exists: fragment.planning_exists !== false,
    summary: {
      total: findings.length,
      fixable: findings.filter(f => f.fixable).length,
      by_check: byCheck,
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
      case 'quarantine-ledger': {
        const stamp = new Date().toISOString().slice(0, 10);
        const dest = `${abs}.quarantined-${stamp}`;
        fs.renameSync(abs, dest);
        return { applied: true, detail: `renamed to ${path.basename(dest)} — fresh ledger starts clean` };
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
  for (const f of scan.findings) {
    if (!f.fixable) {
      skipped.push({ check: f.check, path: f.path, reason: 'no safe auto-fix — see detail', detail: f.detail });
      continue;
    }
    if (!apply) {
      applied.push({ check: f.check, path: f.path, action: f.fix.action, applied: false, detail: 'dry-run' });
      continue;
    }
    const result = applyFix(cwd, f);
    applied.push({ check: f.check, path: f.path, action: f.fix.action, ...result });
  }
  return {
    dry_run: !apply,
    applied,
    skipped,
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
    lines.push(`  [${f.severity.toUpperCase().padEnd(8)}] ${f.check.padEnd(18)} ${f.path}`);
    lines.push(`             ${f.detail}${f.fixable ? '  (auto-fixable)' : ''}`);
  }
  return lines;
}

function cmdHygieneScan(cwd, opts, raw) {
  const result = scanHygiene(cwd, opts);
  if (raw) {
    const lines = [`Hygiene scan: ${result.summary.total} finding(s), ${result.summary.fixable} auto-fixable`];
    if (result.latest_version) {
      lines.push(`Latest version seen: ${result.latest_version}; installs: ${result.installs.map(i => `${i.runtime}@${i.version || '?'}`).join(', ') || 'none'}`);
    }
    lines.push('', ...renderFindings(result.findings));
    if (result.findings.length === 0) lines.push('  Clean — nothing to do.');
    output(result, true, lines.join('\n'));
  } else {
    output(result, false);
  }
}

function cmdHygieneClean(cwd, opts, raw) {
  const result = cleanHygiene(cwd, opts);
  if (raw) {
    const mode = result.dry_run ? 'DRY-RUN (pass --apply to execute)' : 'APPLIED';
    const lines = [`Hygiene clean — ${mode}`, ''];
    for (const a of result.applied) {
      lines.push(`  ${a.applied ? '✓' : (result.dry_run ? '·' : '✗')} ${a.action.padEnd(18)} ${a.path}  ${a.detail}`);
    }
    for (const s of result.skipped) {
      lines.push(`  ! manual            ${s.path}  ${s.detail}`);
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
  checkPlanningFragment,
  compareVersions,
  cmdHygieneScan,
  cmdHygieneClean,
  RUNTIME_DIRS,
  LEGACY_UPPERCASE_FILES,
};
