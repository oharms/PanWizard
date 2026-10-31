'use strict';
/**
 * The learning feedback report (`pan-tools feedback`, `/pan:feedback`;
 * docs/specs/learning_feedback_report_featureai.md).
 *
 * What PAN learned on this project, as a report the user reads in the chat and may
 * paste into a GitHub issue. Nothing is sent. Three layers keep the project out of it:
 *
 *   1. Allowlist construction: the report holds numbers, booleans, a semver, ISO weeks
 *      and members of closed vocabularies defined here or by PAN itself (shipped
 *      command and agent names, finding classes, gate codes …). A value outside its
 *      vocabulary is counted as `other`, never printed. Free text (finding summaries,
 *      trace descriptions, paths, plan text, phase names, test output) is never read
 *      into the model.
 *   2. Coarsening: money and tokens are bucketed, a count of 1 or 2 is `<3`, dates are
 *      ISO weeks, phases are counted, not named.
 *   3. Fail-closed scan (redact.cjs): the rendered text is scanned for credentials,
 *      emails, URLs, paths, addresses and this project's own canaries. Any hit and the
 *      report is refused, naming the rule, never printed partly redacted.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { output } = require('./core.cjs');
const { planningPath, readJsonFile: readJson } = require('./utils.cjs');
const { scanText, projectCanaries } = require('./redact.cjs');
const { readInventory, usageCensus, inWindow } = require('./usage.cjs');

const SCHEMA = 'pan-feedback/1';
const ISSUE_URL = 'https://github.com/oharms/PanWizard/issues/new?template=feedback.md';
const DEFAULT_DAYS = 90;
// About 270 years: far enough back for every ledger, near enough to stay a valid date.
const MAX_DAYS = 100000;
const NOTE_MAX = 600;
const INVENTORY_ROOT = path.resolve(__dirname, '..', '..', '..');

// ─── Vocabularies ────────────────────────────────────────────────────────────

const RUNTIMES = ['claude', 'codex', 'gemini', 'opencode', 'copilot'];
// A project's local install directory per runtime.
const RUNTIME_DIRS = { '.claude': 'claude', '.codex': 'codex', '.gemini': 'gemini', '.opencode': 'opencode', '.github': 'copilot' };
// The directory names an install the engine runs from may have: local, or global
// (~/.config/opencode, ~/.copilot). Any other name (--config-dir) is told by its layout.
const INSTALL_DIRS = { ...RUNTIME_DIRS, opencode: 'opencode', '.copilot': 'copilot' };
const SCOPES = ['local', 'global', 'source'];
const OS_FAMILIES = ['win32', 'darwin', 'linux'];
const TIERS = ['reasoning', 'mid', 'fast'];
const TEST_STATUSES = ['passed', 'failed', 'skipped'];
const TEST_SOURCES = ['flag', 'config', 'package.json', 'pytest', 'go.mod', 'Cargo.toml', 'pom.xml', 'gradle', 'Makefile'];
const GATE_CODES = ['no_plans', 'missing_summary', 'no_verification', 'verification_unreadable', 'verification_failed', 'human_needed_unapproved', 'verification_stale', 'reconcile_contradiction', 'test_failed', 'open_findings', 'stubs_found', 'integrity_violation'];
const GATE_CHECKS = ['freshness', 'stubs', 'test_integrity', 'tests', 'verification'];
const GUARD_RULES = ['secret_write', 'state_write', 'judge_write', 'undeclared_test_edit'];
const GUARD_ACTIONS = ['reported', 'denied'];
const TOOL_ERROR_CLASSES = ['exit_code', 'permission_denied', 'edit_precondition', 'not_found', 'network_or_timeout', 'user_rejected', 'tool_input', 'other'];
const HOST_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit', 'TodoWrite', 'Skill', 'shell', 'apply_patch', 'read_file', 'write_file', 'run_shell_command'];
const TRACE_CATEGORIES = ['phase_gate_forced', 'verdict_passed', 'verdict_failed', 'verdict_needs_human', 'verdict_retry', 'tool_error', 'agent_completion', 'uncached_heavy_run', 'wave_complete', 'plans_created', 'plan_check_overridden', 'phase_complete', 'context', 'skip', 'argument', 'security', 'process', 'quality', 'architecture', 'accessibility', 'memory_recorded'];
// Config values that are reported as they are; any other value of these keys reads `set`.
const CONFIG_ENUMS = {
  model_profile: ['quality', 'balanced', 'budget'],
  mode: ['yolo', 'interactive'],
  depth: ['quick', 'standard', 'comprehensive'],
  branching_strategy: ['none', 'phase', 'milestone'],
  'workflow.phase_gate': ['warn', 'enforce'],
  'workflow.mutation_gate': ['off', 'report', 'gate'],
  'hooks.guard': ['off', 'report', 'enforce'],
  'routing.strategy': ['static', 'complexity'],
  'routing.provider': ['auto', 'anthropic', 'openai', 'google'],
  'execution.default_mode': ['wave_order', 'sequential'],
};
const CONFIG_NUMBERS = ['cost.phase_budget_usd', 'cost.weekly_limit_stop_pct', 'budget.default_points', 'budget.verify_reserve', 'routing.max_escalations'];
const OUTCOMES = ['pass', 'fail', 'needs_human'];
const BUDGET_STATUSES = ['off', 'ok', 'near', 'over'];
const MUTATION_BUCKETS = ['80–100%', '50–80%', '<50%', 'not_scored'];

// ─── Coarsening ──────────────────────────────────────────────────────────────

/** A count as reported: 0, `<3`, or the number. */
const small = (n) => (!n ? 0 : n < 3 ? '<3' : n);

/** Dollars in 1-2-5 steps: `$0`, `<$1`, `$1–2`, `$2–5`, `$5–10` … */
function usdBucket(v) {
  if (!(v > 0)) return '$0';
  if (v < 1) return '<$1';
  const steps = [1, 2, 5];
  for (let mag = 1; ; mag *= 10) {
    for (let i = 0; i < steps.length; i++) {
      const lo = steps[i] * mag;
      const hi = (steps[i + 1] || 10) * mag;
      if (v < hi) return `$${lo}–${hi}`;
    }
    if (mag > 1e6) return '>$10M';
  }
}

/** A share as a whole-number percentage in steps of ten. */
const pctBucket = (num, den) => (den ? `${Math.round((num / den) * 10) * 10}%` : null);

/** ISO-8601 week of a date, `YYYY-Www`. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

const inVocab = (v, list) => (list.includes(v) ? v : 'other');
const bump = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };
const coarse = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, small(v)]));

function readJsonl(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return []; }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && typeof r === 'object') out.push(r); } catch { /* malformed rows are skipped */ }
  }
  return out;
}

/** The phase directories, each with its number (null when the name has none). */
function phaseDirs(cwd) {
  const root = planningPath(cwd, 'phases');
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return []; }
  return entries.map((e) => ({ name: e.name, abs: path.join(root, e.name), num: (e.name.match(/^(\d+(?:\.\d+)*)/) || [])[1] || null }));
}

// ─── Collect ─────────────────────────────────────────────────────────────────

function panVersion(root) {
  for (const f of [path.join(root, 'pan-wizard-core', 'VERSION'), path.join(root, 'VERSION')]) {
    try { const v = fs.readFileSync(f, 'utf-8').trim(); if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(v)) return v; } catch { /* next */ }
  }
  const pkg = readJson(path.join(root, 'package.json'));
  return pkg && /^\d+\.\d+\.\d+/.test(pkg.version || '') ? pkg.version : 'unknown';
}

/** The runtime an install directory belongs to: by its name, else by its layout. */
function installRuntime(root) {
  if (INSTALL_DIRS[path.basename(root)]) return INSTALL_DIRS[path.basename(root)];
  const any = (dir, re) => { try { return fs.readdirSync(path.join(root, dir)).some((f) => re.test(f)); } catch { return false; } };
  if (any('agents', /^pan-.*\.agent\.md$/)) return 'copilot';
  if (any(path.join('commands', 'pan'), /\.toml$/)) return 'gemini';
  if (any('commands', /^pan-.*\.md$/) || fs.existsSync(path.join(root, 'plugins', 'pan-wizard.js'))) return 'opencode';
  if (fs.existsSync(path.join(root, 'config.toml'))) return 'codex';
  if (any(path.join('commands', 'pan'), /\.md$/) || fs.existsSync(path.join(root, 'settings.json'))) return 'claude';
  return null;
}

/**
 * Which runtimes this project has PAN installed for, and where the running engine is:
 * `local` (inside the project), `global`, or `source` (a checkout: no install manifest).
 * @param {string} cwd
 * @param {string} [root] the directory the engine runs from (its runtime directory)
 */
function collectInstall(cwd, root = INVENTORY_ROOT) {
  const runtimes = new Set();
  for (const [dir, rt] of Object.entries(RUNTIME_DIRS)) {
    if (fs.existsSync(path.join(cwd, dir, 'pan-file-manifest.json'))) runtimes.add(rt);
  }
  // A --unified-skills core lives in .agents/ and carries no manifest of its own.
  const installed = fs.existsSync(path.join(root, 'pan-file-manifest.json')) || path.basename(root) === '.agents';
  const engine = installed ? installRuntime(root) : null;
  if (engine) runtimes.add(engine);
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  // Inside the project: a relative path that does not climb out (a cwd at a drive or
  // filesystem root already ends in a separator, so a prefix test would miss it).
  const rel = path.relative(norm(cwd), norm(root));
  const local = !!rel && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel);
  return { version: panVersion(root), runtimes: RUNTIMES.filter((r) => runtimes.has(r)), scope: installed ? (local ? 'local' : 'global') : 'source' };
}

function collectConfig(cwd) {
  const cfg = readJson(planningPath(cwd, 'config.json')) || {};
  const out = {};
  let other = 0;
  const get = (key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), cfg);
  for (const [key, values] of Object.entries(CONFIG_ENUMS)) {
    const v = get(key);
    if (v === undefined) continue;
    out[key] = values.includes(v) ? v : 'set';
  }
  for (const key of CONFIG_NUMBERS) {
    const v = get(key);
    if (v === undefined) continue;
    out[key] = typeof v === 'number' && Number.isFinite(v) ? (key.endsWith('_usd') ? usdBucket(v) : v) : (typeof v === 'boolean' ? v : 'set');
  }
  // Any other key PAN itself defines (config.cjs) with a boolean value: the key name is PAN's,
  // the value says nothing. Not a user's `x-` key, and nothing inside an open section
  // (model_overrides, focus …), whose key names the user chooses: those are counted.
  // The known keys are built once here, not per key (config.cjs isKnownConfigPath rebuilds them).
  const { knownConfigKeys, OPEN_CONFIG_SECTIONS } = require('./config.cjs');
  const { top, sections } = knownConfigKeys();
  const isPans = (key) => {
    const [head, sub] = key.split('.');
    if (!top.has(head) || OPEN_CONFIG_SECTIONS.includes(head)) return false;
    return sub === undefined || !sections.has(head) || sections.get(head).has(sub);
  };
  const walk = (o, prefix, depth) => {
    for (const [k, v] of Object.entries(o || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (Object.prototype.hasOwnProperty.call(out, key)) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1) { walk(v, key, depth + 1); continue; }
      if (typeof v === 'boolean' && /^[a-z_]+(\.[a-z_]+)?$/.test(key) && isPans(key)) out[key] = v;
      else other++;
    }
  };
  walk(cfg, '', 0);
  return { values: out, other_keys: small(other) };
}

/** The phase gate as it stands now (not windowed), with the commit log read once for all phases. */
function collectGate(cwd, dirs) {
  const { phaseGate } = require('./phase-gate.cjs');
  const { withCommitLogCache } = require('./verify-scope.cjs');
  const refusals = {};
  const notChecked = {};
  let phases = 0;
  let ok = 0;
  withCommitLogCache(() => {
    for (const d of dirs.slice(0, 200)) {
      if (!d.num) continue;
      let g;
      try { g = phaseGate(cwd, d.num, { mode: 'warn' }); } catch { continue; }
      if (!g || g.error) continue;
      phases++;
      if (g.ok) ok++;
      for (const r of g.reasons || []) bump(refusals, inVocab(r.code, GATE_CODES));
      for (const n of g.not_checked || []) bump(notChecked, inVocab(n.check, GATE_CHECKS));
    }
  });
  return { phases, ok, refusals, not_checked: notChecked };
}

function collectJudges(cwd, agents, since) {
  const F = require('./findings.cjs');
  const V = require('./verdict.cjs');
  // Fold the whole ledger, then keep what was active in the window: a finding raised earlier
  // and dismissed, fixed or reported again inside it is part of what the user did.
  const fold = F.foldFindings(F.readLedger(cwd).rows);
  const active = (f) => !f.first_seen || [f.first_seen, f.last_reported, f.disposed_at].some((ts) => ts && inWindow(ts, since));
  const judges = {};
  const judge = (a) => {
    const name = agents.includes(a) ? a : 'other';
    if (!judges[name]) judges[name] = { verdicts: 0, outcomes: {}, findings: 0, by_class: {}, by_severity: {}, suppressed: 0, returned: 0, lowered_by: {} };
    return judges[name];
  };
  for (const v of fold.verdicts) {
    if (!inWindow(v.ts, since)) continue;
    const j = judge(v.agent);
    j.verdicts++;
    bump(j.outcomes, inVocab(v.outcome, ['pass', 'fail', 'needs_human']));
    j.suppressed += Array.isArray(v.suppressed) ? v.suppressed.length : 0;
    j.returned += Array.isArray(v.returned_ids) ? v.returned_ids.length : 0;
    for (const l of Array.isArray(v.lowered_by) ? v.lowered_by : []) bump(j.lowered_by, typeof l === 'string' && /^[a-z_]{2,32}$/.test(l) ? l : 'other');
  }
  for (const f of fold.findings.values()) {
    if (!active(f)) continue;
    const j = judge(f.agent);
    j.findings++;
    const cls = inVocab(f.class, V.FINDING_CLASSES);
    if (!j.by_class[cls]) j.by_class[cls] = { total: 0 };
    j.by_class[cls].total++;
    bump(j.by_class[cls], inVocab(f.status, F.STATUSES));
    bump(j.by_severity, inVocab(f.severity, V.SEVERITIES));
  }
  return judges;
}

function collectExecution(dirs, since) {
  const test = { runs: 0, by_status: {}, by_source: {}, regressions: 0, preexisting: 0, timed_out: 0 };
  const mutation = { reports: 0, score: {} };
  // A record's time: its own start, else the file's.
  const before = (r, file) => {
    let t = Date.parse(r.started_at);
    if (!Number.isFinite(t)) { try { t = fs.statSync(file).mtimeMs; } catch { return false; } }
    return t < since;
  };
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(d.abs); } catch { continue; }
    for (const f of files) {
      if (/-test-run\.json$/.test(f)) {
        const r = readJson(path.join(d.abs, f));
        if (!r || before(r, path.join(d.abs, f))) continue;
        test.runs++;
        bump(test.by_status, inVocab(r.status, TEST_STATUSES));
        bump(test.by_source, r.source ? inVocab(r.source, TEST_SOURCES) : 'none');
        test.regressions += Array.isArray(r.regressions) ? r.regressions.length : 0;
        test.preexisting += Array.isArray(r.preexisting) ? r.preexisting.length : 0;
        if (r.timed_out) test.timed_out++;
      } else if (/-mutation\.json$/.test(f)) {
        const r = readJson(path.join(d.abs, f));
        if (!r || before(r, path.join(d.abs, f))) continue;
        mutation.reports++;
        const s = typeof r.score === 'number' ? r.score : null;
        bump(mutation.score, s === null ? 'not_scored' : s >= 0.8 ? '80–100%' : s >= 0.5 ? '50–80%' : '<50%');
      }
    }
  }
  return { test, mutation };
}

function collectCost(cwd, dirs, agents, since) {
  const C = require('./cost.cjs');
  const { loadConfig } = require('./core.cjs');
  // Read once: the per-phase budget and forecast below take the config and rows instead of
  // re-reading them for every phase.
  const config = loadConfig(cwd);
  const rates = C.effectiveRates(config);
  const byAgent = {};
  const byTier = {};
  let total = 0;
  // The phases that spent inside the window: only their budget and forecast are reported.
  const spentIn = new Set();
  const records = C.readRecords(cwd);
  for (const r of records) {
    if (C.isSuspectRecord(r) || C.isEmptyRecord(r)) continue;
    if (!inWindow(r.ts, since)) continue;
    spentIn.add(C.samePhaseKey(r.phase));
    const usd = typeof r.cost_usd === 'number' ? r.cost_usd : C.computeCost(r, rates);
    if (typeof usd !== 'number') continue;
    total += usd;
    bump(byAgent, r.agent && agents.includes(r.agent) ? r.agent : (r.agent ? 'other' : 'main'), usd);
    bump(byTier, r.tier ? inVocab(r.tier, TIERS) : 'unknown', usd);
  }
  const budget = { phases: 0, ok: 0, near: 0, over: 0, off: 0 };
  const forecast = { checked: 0, below_p10: 0, within: 0, above_p90: 0 };
  for (const d of dirs) {
    const num = d.num;
    if (!num || !spentIn.has(C.samePhaseKey(num))) continue;
    const b = C.phaseBudget(cwd, num, { records, config });
    if (!(b.spent_usd > 0)) continue;
    budget.phases++;
    bump(budget, b.status);
    let plans = 0;
    try { plans = fs.readdirSync(d.abs).filter((f) => /-plan\.md$/i.test(f)).length; } catch { /* none */ }
    const fc = C.costForecast(cwd, { plans, excludePhase: num, records, config });
    if (fc.phase && fc.phase.status === 'ok') {
      forecast.checked++;
      if (b.spent_usd < fc.phase.p10) forecast.below_p10++;
      else if (b.spent_usd > fc.phase.p90) forecast.above_p90++;
      else forecast.within++;
    }
  }
  const usd = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, usdBucket(v)]));
  return { total: usdBucket(total), by_agent: usd(byAgent), by_tier: usd(byTier), budget: coarse(budget), forecast };
}

function collectUsage(cwd, inv, since) {
  const u = usageCensus(cwd, { inv, since });
  return {
    commands_installed: u.commands.installed,
    commands_used: u.commands.used.map((c) => c.name).filter((n) => /^[a-z0-9-]+$/.test(n)).sort(),
    commands_never_used: small(u.commands.never_used.length),
    commands_unfinished: u.commands.unfinished.map((c) => c.name).filter((n) => /^[a-z0-9-]+$/.test(n)).sort(),
    agents_used: u.agents.used.map((a) => a.name).filter((n) => /^pan-[a-z0-9_-]+$/.test(n)).sort(),
  };
}

function collectGuard(cwd, since) {
  const out = {};
  for (const r of readJsonl(planningPath(cwd, 'guard.jsonl'))) {
    if (!inWindow(r.ts, since)) continue;
    const rule = inVocab(r.rule, GUARD_RULES);
    if (!out[rule]) out[rule] = {};
    bump(out[rule], inVocab(r.action, GUARD_ACTIONS));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, coarse(v)]));
}

function collectTrace(cwd, since, withToolErrors) {
  const root = planningPath(cwd, 'optimization', 'traces');
  let sessions = 0;
  const byType = {};
  const byCategory = {};
  const tools = new Map();
  let names = [];
  try { names = fs.readdirSync(root).filter((n) => n.startsWith('sess_')); } catch { /* no traces */ }
  const { EVENT_TYPES } = require('./optimize.cjs');
  for (const n of names) {
    const events = readJsonl(path.join(root, n, 'trace.jsonl')).filter((e) => inWindow(e.ts, since));
    if (!events.length) continue;
    sessions++;
    for (const e of events) {
      bump(byType, inVocab(e.type, EVENT_TYPES));
      bump(byCategory, inVocab(e.category, TRACE_CATEGORIES));
      if (withToolErrors && e.category === 'tool_error' && e.context && typeof e.context === 'object') {
        const c = e.context;
        const entry = {
          tool: inVocab(c.tool, HOST_TOOLS),
          class: inVocab(c.error_class, TOOL_ERROR_CLASSES),
          exit_code: Number.isInteger(c.exit_code) && c.exit_code >= 0 && c.exit_code < 256 ? c.exit_code : null,
          sig: typeof c.message_sig === 'string' && /^[0-9a-f]{12}$/.test(c.message_sig) ? c.message_sig : 'none',
        };
        const key = [entry.tool, entry.class, entry.exit_code, entry.sig].join('|');
        const cnt = Number.isInteger(c.count) && c.count > 0 ? c.count : 1;
        if (tools.has(key)) tools.get(key).count += cnt;
        else tools.set(key, { ...entry, count: cnt });
      }
    }
  }
  const toolErrors = withToolErrors ? [...tools.values()].sort((a, b) => b.count - a.count).slice(0, 20).map((t) => ({ ...t, count: small(t.count) })) : undefined;
  return { sessions: small(sessions), by_type: coarse(byType), by_category: coarse(byCategory), ...(withToolErrors ? { tool_errors: toolErrors } : {}) };
}

// ─── Suggested learnings (fixed rules, no model) ─────────────────────────────

function suggestions(m) {
  const out = [];
  // `other` folds judges PAN does not ship and classes it does not know: nothing to act on.
  for (const [agent, j] of Object.entries(m.judges || {})) {
    if (agent === 'other') continue;
    for (const [cls, c] of Object.entries(j.by_class || {})) {
      if (cls === 'other') continue;
      const dismissed = c.dismissed || 0;
      if (c.total >= 10 && dismissed / c.total >= 0.6) {
        out.push({ id: 'judge_noise', text: `${agent} \`${cls}\` findings were dismissed ${pctBucket(dismissed, c.total)} of the time: a candidate for that judge's noise list.`, evidence: { agent, class: cls, total: small(c.total), dismissed: small(dismissed) } });
      }
    }
  }
  const refusals = m.gate && m.gate.refusals ? Object.entries(m.gate.refusals).sort((a, b) => b[1] - a[1]) : [];
  if (refusals.length && refusals[0][1] >= 3) {
    out.push({ id: 'gate_top_refusal', text: `The phase gate's most common refusal is \`${refusals[0][0]}\`.`, evidence: { code: refusals[0][0], count: small(refusals[0][1]) } });
  }
  const fc = m.cost && m.cost.forecast;
  if (fc && fc.checked >= 5 && fc.above_p90 / fc.checked >= 0.3) {
    out.push({ id: 'forecast_low', text: `Phases cost more than the forecast's p90 ${pctBucket(fc.above_p90, fc.checked)} of the time: the forecast underestimates here.`, evidence: { checked: small(fc.checked), above_p90: small(fc.above_p90) } });
  }
  const t = m.execution && m.execution.test;
  if (t && t.runs >= 3 && (t.by_source.none || 0) === t.runs) {
    out.push({ id: 'no_test_command', text: 'No test command was detected in any phase: a candidate for test-runner detection.', evidence: { runs: small(t.runs) } });
  }
  for (const name of (m.usage && m.usage.commands_unfinished) || []) {
    out.push({ id: 'command_unfinished', text: `\`/pan:${name}\` was started and never finished.`, evidence: { command: name } });
  }
  return out;
}

// ─── Model, render, scan ─────────────────────────────────────────────────────

/**
 * The report's data, from closed vocabularies only.
 * @param {string} cwd
 * @param {{days?: number, toolErrors?: boolean, now?: Date, inventory?: string,
 *   inv?: {commands: string[], agents: string[]}, dirs?: object[]}} [opts]
 *   inv and dirs: the inventory and phase directories, when the caller has read them already
 */
function collect(cwd, opts = {}) {
  const now = opts.now || new Date();
  const days = Number.isFinite(opts.days) && opts.days > 0 && opts.days <= MAX_DAYS ? opts.days : DEFAULT_DAYS;
  const since = now.getTime() - days * 86400000;
  const inventory = opts.inventory || INVENTORY_ROOT;
  const inv = opts.inv || readInventory(inventory);
  const dirs = opts.dirs || phaseDirs(cwd);
  const agents = inv.agents.filter((a) => /^pan-[a-z0-9_-]+$/.test(a));
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const m = {
    schema: SCHEMA,
    pan: collectInstall(cwd, inventory),
    env: { os: inVocab(process.platform, OS_FAMILIES), node: nodeMajor },
    window: { from: isoWeek(new Date(since)), to: isoWeek(now), days },
    config: collectConfig(cwd),
    gate: collectGate(cwd, dirs),
    judges: collectJudges(cwd, agents, since),
    execution: collectExecution(dirs, since),
    cost: collectCost(cwd, dirs, agents, since),
    usage: collectUsage(cwd, inv, since),
    guard: collectGuard(cwd, since),
    trace: collectTrace(cwd, since, !!opts.toolErrors),
  };
  m.suggestions = suggestions(m);
  // Coarsen the counts the suggestions needed exact.
  m.gate = { phases: small(m.gate.phases), ok: small(m.gate.ok), refusals: coarse(m.gate.refusals), not_checked: coarse(m.gate.not_checked) };
  for (const j of Object.values(m.judges)) {
    j.verdicts = small(j.verdicts); j.findings = small(j.findings); j.suppressed = small(j.suppressed); j.returned = small(j.returned);
    j.outcomes = coarse(j.outcomes); j.by_severity = coarse(j.by_severity); j.lowered_by = coarse(j.lowered_by);
    j.by_class = Object.fromEntries(Object.entries(j.by_class).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, coarse(v)]));
  }
  const t = m.execution.test;
  m.execution.test = { runs: small(t.runs), by_status: coarse(t.by_status), by_source: coarse(t.by_source), regressions: small(t.regressions), preexisting: small(t.preexisting), timed_out: small(t.timed_out) };
  m.execution.mutation = { reports: small(m.execution.mutation.reports), score: coarse(m.execution.mutation.score) };
  const fc = m.cost.forecast;
  m.cost.forecast = { checked: small(fc.checked), below_p10: small(fc.below_p10), within: small(fc.within), above_p90: small(fc.above_p90) };
  return m;
}

const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n') : '');
const pairs = (o) => Object.entries(o || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none';

/** The report as markdown, ending in the machine block. */
function render(m, opts = {}) {
  const L = [];
  L.push('## PAN learning report', '');
  L.push(`PAN ${m.pan.version} · ${m.pan.runtimes.join(', ') || 'no runtime detected'} · ${m.pan.scope} · ${m.env.os} · node ${m.env.node} · weeks ${m.window.from} to ${m.window.to}`);
  L.push('', 'Built on your machine from counts, codes and PAN\'s own names only. Nothing was sent. Read it, then share it if you want to.', '');
  const cfg = Object.entries(m.config.values).map(([k, v]) => `${k}=${v}`).join(' · ');
  L.push(`**Settings:** ${cfg || 'defaults'}${m.config.other_keys ? ` · other keys set: ${m.config.other_keys}` : ''}`, '');
  if (m.gate.phases) {
    L.push('### Phase gate', `${m.gate.phases} phases, ${m.gate.ok} would complete now. Refusals: ${pairs(m.gate.refusals)}. Not checked: ${pairs(m.gate.not_checked)}.`, '');
  }
  const judgeRows = [];
  for (const [agent, j] of Object.entries(m.judges)) {
    for (const [cls, c] of Object.entries(j.by_class)) judgeRows.push([agent, cls, c.total, c.fixed || 0, c.deferred || 0, c.dismissed || 0, c.decision || 0, c.open || 0]);
  }
  if (judgeRows.length) {
    L.push('### What the judges found, and what you did with it', table(['judge', 'class', 'total', 'fixed', 'deferred', 'dismissed', 'decision', 'open'], judgeRows));
    const extra = Object.entries(m.judges).filter(([, j]) => j.suppressed || j.returned || Object.keys(j.lowered_by).length).map(([a, j]) => `${a}: suppressed ${j.suppressed}, returned ${j.returned}${Object.keys(j.lowered_by).length ? `, lowered by ${pairs(j.lowered_by)}` : ''}`);
    if (extra.length) L.push('', extra.join(' · '));
    L.push('');
  }
  const t = m.execution.test;
  if (t.runs || m.execution.mutation.reports) {
    L.push('### Tests', `Test runs ${t.runs}: ${pairs(t.by_status)}; runner ${pairs(t.by_source)}; regressions ${t.regressions}, inherited failures ${t.preexisting}, timed out ${t.timed_out}.${m.execution.mutation.reports ? ` Mutation reports ${m.execution.mutation.reports}: ${pairs(m.execution.mutation.score)}.` : ''}`, '');
  }
  if (m.cost.total !== '$0') {
    const fc = m.cost.forecast;
    L.push('### Cost', `Spend ${m.cost.total} (API-equivalent). By tier: ${pairs(m.cost.by_tier)}. By agent: ${pairs(m.cost.by_agent)}.`);
    L.push(`Phase budget: ${pairs(m.cost.budget)}.${fc.checked ? ` Forecast vs actual, ${fc.checked} phases: below p10 ${fc.below_p10}, within ${fc.within}, above p90 ${fc.above_p90}.` : ''}`, '');
  }
  const u = m.usage;
  L.push('### What you used', `Commands used: ${u.commands_used.map((c) => `\`${c}\``).join(', ') || 'none'} (of ${u.commands_installed}; never used ${u.commands_never_used}).${u.commands_unfinished.length ? ` Started, never finished: ${u.commands_unfinished.map((c) => `\`${c}\``).join(', ')}.` : ''}`, '');
  if (Object.keys(m.guard).length) L.push('### Guard', Object.entries(m.guard).map(([r, a]) => `${r}: ${pairs(a)}`).join(' · '), '');
  if (m.trace.sessions) L.push('### Trace', `Sessions ${m.trace.sessions}. Events by type: ${pairs(m.trace.by_type)}.`, '');
  if (m.trace.tool_errors && m.trace.tool_errors.length) {
    L.push('### Tool errors', table(['tool', 'class', 'exit', 'signature', 'count'], m.trace.tool_errors.map((e) => [e.tool, e.class, e.exit_code === null ? '–' : e.exit_code, e.sig, e.count])), '');
  }
  if (m.suggestions.length) L.push('### Suggested learnings', ...m.suggestions.map((s) => `- ${s.text}`), '');
  if (opts.note) L.push('### Note from the user', ...String(opts.note).split('\n').map((l) => `> ${l}`), '');
  L.push('```pan-feedback', JSON.stringify(m), '```', '');
  L.push(`Share it by pasting everything above into ${ISSUE_URL} (the "PAN learning report" template). Anything you add around it is yours to check.`);
  return L.join('\n');
}

function phaseSlugs(dirs) {
  return dirs.map((d) => d.name.replace(/^\d+(?:\.\d+)*-?/, '')).filter(Boolean);
}

/**
 * The words the report's own template prints, whatever the project: the skeleton model
 * fills every section with PAN's own vocabulary, so nothing here comes from a project.
 * A canary that is one of them (an OS user called `node`, a host called `tests`) could
 * not identify anyone, and would refuse every report.
 */
let templateWordsCache = null;
function templateWords() {
  if (templateWordsCache) return templateWordsCache;
  const counts = { a: 3 };
  const skeleton = {
    schema: SCHEMA,
    pan: { version: '0.0.0', runtimes: RUNTIMES, scope: 'local' },
    env: { os: 'linux', node: 22 },
    window: { from: '2026-W01', to: '2026-W02', days: DEFAULT_DAYS },
    config: { values: { model_profile: 'balanced' }, other_keys: 3 },
    gate: { phases: 3, ok: 3, refusals: { no_plans: 3 }, not_checked: { tests: 3 } },
    judges: { 'pan-reviewer': { verdicts: 3, outcomes: counts, findings: 3, by_class: { quality: { total: 3, fixed: 3, deferred: 3, dismissed: 3, decision: 3, open: 3 } }, by_severity: counts, suppressed: 3, returned: 3, lowered_by: { test_gate: 3 } } },
    execution: { test: { runs: 3, by_status: { passed: 3 }, by_source: { config: 3 }, regressions: 3, preexisting: 3, timed_out: 3 }, mutation: { reports: 3, score: { '<50%': 3 } } },
    cost: { total: '$1–2', by_agent: { main: '$1–2' }, by_tier: { mid: '$1–2' }, budget: counts, forecast: { checked: 3, below_p10: 3, within: 3, above_p90: 3 } },
    usage: { commands_installed: 3, commands_used: ['quick'], commands_never_used: 3, commands_unfinished: ['quick'], agents_used: [] },
    guard: { secret_write: { reported: 3 } },
    trace: { sessions: 3, by_type: { error: 3 }, by_category: { tool_error: 3 }, tool_errors: [{ tool: 'Bash', class: 'exit_code', exit_code: 1, sig: 'none', count: 3 }] },
    suggestions: [],
  };
  skeleton.suggestions = [
    { text: 'pan-reviewer `quality` findings were dismissed 60% of the time: a candidate for that judge\'s noise list.' },
    { text: 'The phase gate\'s most common refusal is `no_plans`.' },
    { text: 'Phases cost more than the forecast\'s p90 30% of the time: the forecast underestimates here.' },
    { text: 'No test command was detected in any phase: a candidate for test-runner detection.' },
    { text: '`/pan:quick` was started and never finished.' },
  ];
  templateWordsCache = new Set((render(skeleton, { note: ' ' }).toLowerCase().match(/[a-z][a-z0-9_-]*/g) || []));
  return templateWordsCache;
}

/**
 * Every word the report can print that is PAN's own: each vocabulary above and PAN's
 * (finding classes, severities, statuses, trace event types), every key PAN defines in
 * config.json, the shipped command and agent names, and the template's words. Each value
 * is also split where the canary match splits (`model_profile` gives `model` and
 * `profile`), because `scanText` matches a canary between any two non-alphanumerics.
 */
let baseWordsCache = null;
function ownWords(vocabulary = []) {
  const addAll = (words, list) => {
    for (const v of list) {
      const s = String(v).toLowerCase();
      words.add(s);
      for (const part of s.split(/[^a-z0-9]+/)) if (part) words.add(part);
    }
  };
  if (!baseWordsCache) {
    const V = require('./verdict.cjs');
    const F = require('./findings.cjs');
    const { EVENT_TYPES } = require('./optimize.cjs');
    const { knownConfigKeys } = require('./config.cjs');
    const { top, sections } = knownConfigKeys();
    baseWordsCache = new Set();
    for (const list of [
      RUNTIMES, SCOPES, OS_FAMILIES, TIERS, TEST_STATUSES, TEST_SOURCES, GATE_CODES, GATE_CHECKS, GUARD_RULES, GUARD_ACTIONS,
      TOOL_ERROR_CLASSES, HOST_TOOLS, TRACE_CATEGORIES, Object.keys(CONFIG_ENUMS), ...Object.values(CONFIG_ENUMS), CONFIG_NUMBERS,
      OUTCOMES, BUDGET_STATUSES, MUTATION_BUCKETS, V.FINDING_CLASSES, V.SEVERITIES, F.STATUSES, EVENT_TYPES,
      [...top], ...[...sections.values()].map((s) => [...s]), [...templateWords()],
    ]) addAll(baseWordsCache, list);
  }
  const words = new Set(baseWordsCache);
  addAll(words, vocabulary);
  return words;
}

/**
 * Scan a rendered report. A hit refuses it; the result names rules, never text.
 * A canary that is one of PAN's own words (a project named `review`, a phase named
 * `profile`, an OS user called `node`) would refuse every report and identify nothing,
 * so it is skipped and counted.
 */
function finalize(text, canaries, vocabulary = []) {
  const own = ownWords(vocabulary);
  const usable = canaries.filter((c) => !own.has(c.value.toLowerCase()));
  const hits = scanText(text, { canaries: usable, allowed: [ISSUE_URL] });
  return { ok: hits.length === 0, rules: hits, canaries_checked: usable.length, canaries_skipped: canaries.length - usable.length };
}

/** Whether the user's note alone would be refused, judged exactly as the report is. */
function noteRefused(note, canaries, vocabulary = []) {
  return !!note && !finalize(String(note), canaries, vocabulary).ok;
}

/**
 * Build, render and scan the report.
 * @returns {{ok: true, text, model}|{ok: false, error, rules, reason}}
 */
function buildReport(cwd, opts = {}) {
  if (!fs.existsSync(planningPath(cwd))) return { ok: false, error: 'not_a_pan_project', rules: [], reason: 'no .planning/ directory here' };
  const note = opts.note == null ? null : String(opts.note).replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX);
  const inv = readInventory(opts.inventory || INVENTORY_ROOT);
  const dirs = phaseDirs(cwd);
  const model = collect(cwd, { ...opts, inv, dirs });
  const text = render(model, { note });
  const canaries = projectCanaries(cwd, { phaseSlugs: phaseSlugs(dirs) });
  const vocabulary = [...inv.commands, ...inv.agents];
  const scan = finalize(text, canaries, vocabulary);
  if (!scan.ok) {
    const fromNote = noteRefused(note, canaries, vocabulary);
    return {
      ok: false,
      error: 'feedback_refused',
      rules: scan.rules,
      reason: fromNote
        ? 'your --note contains something that looks private (see rules); change it and run again'
        : 'the report matched a privacy rule it should never match, so nothing was printed. This is a PAN bug: please report the rule names (not the report) at https://github.com/oharms/PanWizard/issues',
    };
  }
  return { ok: true, text, model, scan };
}

/**
 * `pan-tools feedback`. A flag given without its value arrives as '' (pan-tools.cjs) and is
 * an error, never a silent default.
 */
function cmdFeedback(cwd, opts, raw) {
  const fail = (error, reason) => { output({ error, reason }, raw); process.exitCode = 1; };
  const days = opts.days != null ? Number(opts.days) : undefined;
  if (opts.days != null && !(opts.days !== '' && Number.isFinite(days) && days > 0 && days <= MAX_DAYS)) return fail('invalid_days', `--days must be a number above 0 and at most ${MAX_DAYS}`);
  if (opts.note === '') return fail('invalid_note', '--note needs your words after it, in quotes');
  if (opts.format != null && !['md', 'json'].includes(opts.format)) return fail('invalid_format', '--format must be md or json');
  const r = buildReport(cwd, { note: opts.note, toolErrors: !!opts.toolErrors, days });
  if (!r.ok) {
    process.stdout.write(JSON.stringify({ error: r.error, rules: r.rules, reason: r.reason }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }
  if (opts.selfCheck) { output({ ok: true, canaries_checked: r.scan.canaries_checked, canaries_skipped: r.scan.canaries_skipped, bytes: Buffer.byteLength(r.text) }, raw); return; }
  if (opts.format === 'json') { process.stdout.write(JSON.stringify(r.model, null, 2) + '\n'); return; }
  process.stdout.write(r.text + '\n');
}

module.exports = { SCHEMA, ISSUE_URL, collect, collectInstall, render, finalize, noteRefused, templateWords, buildReport, cmdFeedback, suggestions, usdBucket, isoWeek, small };
