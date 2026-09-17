'use strict';
/**
 * Cost ledger rebuild from Claude Code transcripts (`cost rebuild`, 2026-09).
 *
 * Every row the SubagentStop hooks wrote before v3.29 was a slice of the PARENT
 * session transcript booked to whichever subagent happened to stop, and every
 * usage record was counted once per content block rather than once per API
 * turn. Those rows cannot be corrected in place — but the transcripts they were
 * cut from still exist under `<claude config dir>/projects/<encoded cwd>/` for
 * as long as Claude Code keeps them (its `cleanupPeriodDays`, 30 by default):
 *   <session>.jsonl                                  the main thread
 *   <session>/subagents/agent-<id>.jsonl             a Task/Agent-tool subagent
 *   <session>/subagents/workflows/<wf>/agent-<id>.jsonl   a Workflow-tool subagent
 *   <session>/workflows/<wf>.json                    the run record (labels, model)
 * The main thread pairs each `Agent` tool_use (subagent_type) with its result
 * (`toolUseResult.agentId`, `resolvedModel`), so each agent file can be typed.
 *
 * This module rebuilds the ledger from those files: one row per agent file with
 * its exact usage (deduped by `message.id`, the same rule the hooks apply since
 * v3.29), its type, model and measured span, plus — by default — one row per
 * session for the main thread's own usage, which the old parent slices had been
 * the only place to capture. Hook rows of a rebuilt session are superseded;
 * rows of sessions whose transcripts are gone, and rows appended by callers,
 * are kept. The previous ledger is copied aside as dated evidence, the way
 * hygiene's quarantine does, and never overwritten by a later copy. Dry-run
 * unless `apply` is set. Never throws on a bad transcript: an unreadable file
 * contributes nothing and is named in the session's `warnings`.
 *
 * Which sessions count: those the ledger already names, plus any session of the
 * project's OWN transcript folder(s) that has agent files. A folder reached only
 * because the ledger names a session in it contributes that session and nothing
 * else — a ledger copied from another project must not import that project's
 * whole agent history. A plain chat session with neither agents nor ledger rows
 * never involved PAN agents and is left out, so the ledger stays a record of
 * agent work and the sessions around it, not of every conversation.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { output, error, loadConfig } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { readRecords, computeCost, effectiveRates, isSuspectRecord, isEmptyRecord, METRICS_DIR, TOKENS_FILE } = require('./cost.cjs');

const SCHEMA_V = 4; // matches hooks/pan-cost-logger.js SCHEMA_V
const MAIN_THREAD_AGENT = '(main thread)';
const AGENT_FILE = /^agent-([A-Za-z0-9][A-Za-z0-9._-]*)\.jsonl$/;
const SESSION_FILE = /^(?!agent-)[A-Za-z0-9][A-Za-z0-9-]*\.jsonl$/;
// Claude Code writes this as the model of an interruption / API-error record;
// it is not a model and cannot be priced.
const SYNTHETIC_MODEL = '<synthetic>';

function claudeConfigDir(opts) {
  if (opts && opts.claudeDir) return opts.claudeDir;
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  return path.join(os.homedir(), '.claude');
}

/** Claude Code's project-directory name for a working directory: every character
 *  outside [A-Za-z0-9-] becomes '-' (`D:\my_proj` → `D--my-proj`, `/home/u/p` → `-home-u-p`). */
function encodeProjectDirName(cwd) {
  return path.resolve(cwd).replace(/[^A-Za-z0-9-]/g, '-');
}

function tierForModel(model) {
  if (typeof model !== 'string' || !model) return null;
  if (/opus|fable|mythos/i.test(model)) return 'reasoning';
  if (/sonnet/i.test(model)) return 'mid';
  if (/haiku/i.test(model)) return 'fast';
  return null;
}

/**
 * Parse a JSONL file line by line from a Buffer. A whole-file string would hit
 * Node's string ceiling (512 MB) on a long session — one on this machine passed
 * 187 MB in 24 days — and vanish as "unreadable"; a Buffer holds up to 2 GB.
 * Returns { entries, error }: `error` is the fs error code when the file could
 * not be read at all, so the caller can say so instead of reporting zeros.
 */
function readJsonl(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return { entries: [], error: e && e.code ? e.code : 'unreadable' }; }
  const entries = [];
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(0x0a, start);
    if (end === -1) end = buf.length;
    if (end > start) {
      let s = buf.toString('utf8', start, end);
      if (s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1);
      if (s.trim()) {
        try { entries.push(JSON.parse(s)); } catch { /* torn line */ }
      }
    }
    start = end + 1;
  }
  return { entries, error: null };
}

/**
 * Sum a transcript's usage once per API turn (message.id), last snapshot wins.
 * The model is the one most usage records name, ignoring `<synthetic>` — an
 * agent whose last record is an interruption must not price as unknown.
 */
function sumTranscriptUsage(file) {
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, model: null, first_ts: null, last_ts: null, turns: 0, unreadable: false };
  const { entries, error: readError } = readJsonl(file);
  if (readError) { totals.unreadable = true; return totals; }
  const byMessage = new Map();
  const modelCounts = new Map();
  let unkeyed = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.timestamp === 'string') {
      if (!totals.first_ts) totals.first_ts = entry.timestamp;
      totals.last_ts = entry.timestamp;
    }
    const usage = entry.message && entry.message.usage && typeof entry.message.usage === 'object' ? entry.message.usage : null;
    if (!usage) continue;
    const model = entry.message && typeof entry.message.model === 'string' ? entry.message.model : null;
    if (model && model !== SYNTHETIC_MODEL) modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    const id = typeof entry.message.id === 'string' && entry.message.id ? entry.message.id : `__unkeyed_${unkeyed++}`;
    byMessage.set(id, usage);
  }
  const num = (u, k) => (typeof u[k] === 'number' && Number.isFinite(u[k]) ? u[k] : 0);
  for (const u of byMessage.values()) {
    totals.input_tokens += num(u, 'input_tokens');
    totals.output_tokens += num(u, 'output_tokens');
    totals.cache_read_tokens += num(u, 'cache_read_input_tokens');
    totals.cache_write_tokens += num(u, 'cache_creation_input_tokens');
  }
  totals.turns = byMessage.size;
  let best = null;
  for (const [m, n] of modelCounts) if (!best || n >= best.n) best = { m, n }; // ties → last seen
  totals.model = best ? best.m : null;
  return totals;
}

/** agentId → { type, model } from the main thread's Agent tool_use / tool_result pairs. */
function mapAgentsFromParent(file) {
  const uses = new Map();
  const agents = new Map();
  for (const entry of readJsonl(file).entries) {
    if (!entry || typeof entry !== 'object') continue;
    const content = entry.message && Array.isArray(entry.message.content) ? entry.message.content : [];
    for (const block of content) {
      if (block && block.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task') && typeof block.id === 'string') {
        uses.set(block.id, { type: block.input && block.input.subagent_type ? String(block.input.subagent_type) : null });
      }
    }
    const result = entry.toolUseResult;
    if (result && typeof result === 'object' && typeof result.agentId === 'string') {
      // A user record can carry several tool_result blocks (a Bash result beside
      // the Agent's); take the one that answers an Agent call.
      const ref = content.find((b) => b && b.type === 'tool_result' && uses.has(b.tool_use_id));
      const use = ref ? uses.get(ref.tool_use_id) : null;
      agents.set(result.agentId, {
        type: use && use.type ? use.type : null,
        model: typeof result.resolvedModel === 'string' ? result.resolvedModel : null,
      });
    }
  }
  return agents;
}

/** agentId → { label, model, workflow } from the session's Workflow run records.
 *  The run record's shape is the Workflow tool's, not PAN's, so every array-valued
 *  field is scanned for entries that name an `agentId` (observed under
 *  `workflowProgress` as `{type:"workflow_agent", agentId, label, model, …}`). */
function mapAgentsFromWorkflowRuns(sessionDir) {
  const agents = new Map();
  const runsDir = path.join(sessionDir, 'workflows');
  let files = [];
  try { files = fs.readdirSync(runsDir).filter((f) => /^wf_.*\.json$/.test(f)); } catch { return agents; }
  for (const f of files) {
    let run;
    try { run = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8')); } catch { continue; }
    if (!run || typeof run !== 'object') continue;
    const name = typeof run.workflowName === 'string' ? run.workflowName : null;
    for (const value of Object.values(run)) {
      if (!Array.isArray(value)) continue;
      for (const l of value) {
        if (l && typeof l === 'object' && typeof l.agentId === 'string' && !agents.has(l.agentId)) {
          agents.set(l.agentId, { label: typeof l.label === 'string' ? l.label : null, model: typeof l.model === 'string' ? l.model : null, workflow: name });
        }
      }
    }
  }
  return agents;
}

/** Every agent transcript of a session: direct Task/Agent subagents and Workflow-tool subagents one level down. */
function listAgentFiles(sessionDir) {
  const out = [];
  const subagents = path.join(sessionDir, 'subagents');
  let entries = [];
  try { entries = fs.readdirSync(subagents); } catch { return out; }
  for (const e of entries) {
    const m = AGENT_FILE.exec(e);
    if (m) out.push({ file: path.join(subagents, e), agentId: m[1], workflow: null });
  }
  const wfRoot = path.join(subagents, 'workflows');
  let runs = [];
  try { runs = fs.readdirSync(wfRoot); } catch { return out; }
  for (const run of runs) {
    let files = [];
    try { files = fs.readdirSync(path.join(wfRoot, run)); } catch { continue; }
    for (const e of files) {
      const m = AGENT_FILE.exec(e);
      if (m) out.push({ file: path.join(wfRoot, run, e), agentId: m[1], workflow: run });
    }
  }
  return out;
}

/** Directories the cost cursor's SESSION transcripts live in (agent-transcript keys
 *  point inside a session folder and are skipped — they are not project folders). */
function readCursorDirs(cwd) {
  const dirs = new Set();
  try {
    const cursor = JSON.parse(fs.readFileSync(planningPath(cwd, METRICS_DIR, '.cost-cursor.json'), 'utf8'));
    for (const key of Object.keys(cursor)) {
      if (!/\.jsonl$/i.test(key) || /^agent-/.test(path.basename(key))) continue;
      if (fs.existsSync(key)) dirs.add(path.dirname(key));
    }
  } catch { /* no cursor */ }
  return dirs;
}

const dirKey = (d) => (process.platform === 'win32' ? path.resolve(d).toLowerCase() : path.resolve(d));

/**
 * Sessions of this project that can be rebuilt: { sessionId, transcript, sessionDir, dir, agentFiles }.
 * Swept directories (every agent-bearing session counts): the encoded cwd under the
 * projects root (case-insensitive — on Windows two spellings of one folder were
 * observed) and every directory a cost-cursor SESSION transcript points into.
 * Named-only directories (just the sessions the ledger names): any directory that
 * holds such a session but is neither of the above — a ledger copied from another
 * project must not pull that project's whole history in.
 */
function discoverSessions(cwd, ledgerSessions, opts) {
  const projectsRoot = path.join(claudeConfigDir(opts), 'projects');
  const wanted = encodeProjectDirName(cwd).toLowerCase();
  const dirs = new Map(); // dirKey → { dir, sweep }
  const add = (d, sweep) => {
    const k = dirKey(d);
    const cur = dirs.get(k);
    if (!cur) dirs.set(k, { dir: path.resolve(d), sweep });
    else if (sweep && !cur.sweep) cur.sweep = true;
  };
  let all = [];
  try { all = fs.readdirSync(projectsRoot); } catch { all = []; }
  for (const name of all) if (name.toLowerCase() === wanted) add(path.join(projectsRoot, name), true);
  for (const d of readCursorDirs(cwd)) add(d, true);
  for (const sid of ledgerSessions) {
    for (const name of all) if (fs.existsSync(path.join(projectsRoot, name, `${sid}.jsonl`))) add(path.join(projectsRoot, name), false);
  }
  const sessions = new Map();
  for (const { dir, sweep } of dirs.values()) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => SESSION_FILE.test(f)); } catch { continue; }
    for (const f of files) {
      const sid = f.slice(0, -'.jsonl'.length);
      const named = ledgerSessions.has(sid);
      if (!named && !sweep) continue; // a foreign folder contributes only the sessions the ledger names
      const sessionDir = path.join(dir, sid);
      const agentFiles = listAgentFiles(sessionDir);
      if (!named && agentFiles.length === 0) continue; // a plain chat session — never involved PAN agents
      if (!sessions.has(sid)) sessions.set(sid, { sessionId: sid, transcript: path.join(dir, f), sessionDir, dir, agentFiles });
    }
  }
  return { projectsRoot, candidateDirs: [...dirs.values()].map((d) => d.dir), sessions: [...sessions.values()] };
}

function makeRow(fields) {
  return {
    v: SCHEMA_V,
    ts: fields.ts,
    agent: fields.agent,
    agent_id: fields.agent_id,
    command: fields.command,
    model: fields.model,
    tier: tierForModel(fields.model),
    input_tokens: fields.usage.input_tokens,
    output_tokens: fields.usage.output_tokens,
    cache_read_tokens: fields.usage.cache_read_tokens,
    cache_write_tokens: fields.usage.cache_write_tokens,
    cost_usd: null,
    duration_ms: fields.usage.first_ts && fields.usage.last_ts ? Date.parse(fields.usage.last_ts) - Date.parse(fields.usage.first_ts) : null,
    phase: null,
    session: fields.session,
    source: 'rebuild',
    token_source: fields.token_source,
    clamped: false,
    event_sig: null,
  };
}

function buildRowsForSession(s, opts) {
  const rows = [];
  const warnings = [];
  const fromParent = mapAgentsFromParent(s.transcript);
  const fromRuns = mapAgentsFromWorkflowRuns(s.sessionDir);
  for (const a of s.agentFiles) {
    const usage = sumTranscriptUsage(a.file);
    if (usage.unreadable) { warnings.push(`agent transcript unreadable: ${path.basename(a.file)}`); continue; }
    if (usage.turns === 0) continue; // an agent that never made a call is not a spawn worth a row
    const parent = fromParent.get(a.agentId) || {};
    const run = fromRuns.get(a.agentId) || {};
    const model = usage.model || parent.model || run.model || null;
    rows.push(makeRow({
      ts: usage.last_ts || usage.first_ts || new Date().toISOString(),
      agent: parent.type || (a.workflow ? 'workflow-subagent' : 'subagent'),
      agent_id: a.agentId,
      command: run.workflow || null,
      model,
      usage,
      session: s.sessionId,
      token_source: 'agent-transcript',
    }));
  }
  if (opts.mainThread !== false) {
    const main = sumTranscriptUsage(s.transcript);
    if (main.unreadable) warnings.push('session transcript unreadable — no main-thread row, agents typed from run records only');
    else if (main.turns > 0) {
      // Dated to the session's LAST record with the whole span as duration: one row
      // for the session's own usage, not a per-day series (documented in CLI-REFERENCE).
      rows.push(makeRow({
        ts: main.last_ts || main.first_ts || new Date().toISOString(),
        agent: MAIN_THREAD_AGENT,
        agent_id: null,
        command: null,
        model: main.model,
        usage: main,
        session: s.sessionId,
        token_source: 'session-transcript',
      }));
    }
  }
  return { rows, warnings };
}

/** A row the rebuild may replace: written by a hook or an earlier rebuild for a known session.
 *  Any versioned row with a session is such a row — `v` exists only on hook-written rows. */
function isSupersedable(row) {
  if (!row || typeof row.session !== 'string' || !row.session) return false;
  return row.source === 'hook' || row.source === 'rebuild' || row.v != null;
}

function ledgerFile(cwd) { return path.join(planningPath(cwd, METRICS_DIR), TOKENS_FILE); }

function readLedgerLines(cwd) {
  try { return fs.readFileSync(ledgerFile(cwd), 'utf8').split('\n').filter((l) => l.trim()); } catch { return []; }
}

/**
 * Plan a rebuild: which sessions, what the ledger says now, what it would say after.
 * Pure apart from reads; `applyRebuild` performs the write.
 */
function planRebuild(cwd, opts = {}) {
  const snapshotLines = readLedgerLines(cwd);
  const records = readRecords(cwd);
  const rates = effectiveRates(loadConfig(cwd));
  // Priced the way `cost report` prices: quarantined and unmeasured rows count for
  // nothing, so "before" is what the report shows today, not the raw file sum.
  const price = (r) => {
    if (isSuspectRecord(r) || isEmptyRecord(r)) return 0;
    const c = computeCost(r, rates);
    return typeof c === 'number' ? c : 0;
  };
  const ledgerSessions = new Set(records.map((r) => r.session).filter((s) => typeof s === 'string' && s));
  const found = discoverSessions(cwd, ledgerSessions, opts);
  const rebuilt = new Set(found.sessions.map((s) => s.sessionId));

  const sessions = [];
  const newRows = [];
  for (const s of found.sessions) {
    const { rows, warnings } = buildRowsForSession(s, opts);
    const old = records.filter((r) => isSupersedable(r) && r.session === s.sessionId);
    sessions.push({
      session: s.sessionId,
      transcript: s.transcript,
      agent_files: s.agentFiles.length,
      superseded_rows: old.length,
      rebuilt_rows: rows.length,
      old_cost_usd: round(old.reduce((a, r) => a + price(r), 0)),
      new_cost_usd: round(rows.reduce((a, r) => a + price(r), 0)),
      main_thread_cost_usd: round(rows.filter((r) => r.agent === MAIN_THREAD_AGENT).reduce((a, r) => a + price(r), 0)),
      warnings,
    });
    newRows.push(...rows);
  }
  const kept = records.filter((r) => !(isSupersedable(r) && rebuilt.has(r.session)));
  const keptHook = kept.filter((r) => isSupersedable(r)).length;
  const ledger = [...kept, ...newRows].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  return {
    dry_run: !opts.apply,
    claude_projects_dir: found.projectsRoot,
    candidate_dirs: found.candidateDirs,
    main_thread_rows: opts.mainThread !== false,
    sessions,
    kept_rows: { hook_without_transcript: keptHook, caller: kept.length - keptHook },
    totals: {
      old_rows: records.length,
      new_rows: ledger.length,
      old_cost_usd: round(records.reduce((a, r) => a + price(r), 0)),
      new_cost_usd: round(ledger.reduce((a, r) => a + price(r), 0)),
    },
    _ledger: ledger,
    _snapshot: snapshotLines,
  };
}

function round(n) { return Math.round(n * 10000) / 10000; }

/**
 * Write the rebuilt ledger. The current file is copied aside first (a later copy
 * never overwrites an earlier one), rows a live hook appended since the plan was
 * read are carried forward, and the write goes through a temp file + rename so a
 * crash leaves either the old ledger or the new one, never a torn file. A plan
 * that changes nothing writes nothing.
 * Returns { written, backup, carried_forward }.
 */
function applyRebuild(cwd, plan) {
  const file = ledgerFile(cwd);
  const exists = fs.existsSync(file);
  if (!exists && plan.sessions.length === 0) return { written: false, backup: null, carried_forward: 0 };

  // Rows appended after the plan's snapshot (a SubagentStop landing mid-rebuild).
  const current = readLedgerLines(cwd);
  const seen = new Map();
  for (const l of plan._snapshot || []) seen.set(l, (seen.get(l) || 0) + 1);
  const carried = [];
  for (const l of current) {
    const n = seen.get(l) || 0;
    if (n > 0) seen.set(l, n - 1);
    else { try { carried.push(JSON.parse(l)); } catch { /* torn line — drop */ } }
  }
  const rows = [...plan._ledger, ...carried].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  const content = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  if (exists && content === current.join('\n') + (current.length ? '\n' : '')) {
    return { written: false, backup: null, carried_forward: carried.length, unchanged: true };
  }

  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  let backup = null;
  if (exists) {
    const stamp = new Date().toISOString().slice(0, 10);
    backup = `${file}.rebuilt-${stamp}`;
    for (let n = 2; fs.existsSync(backup); n++) backup = `${file}.rebuilt-${stamp}-${n}`;
    fs.copyFileSync(file, backup);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
  return { written: true, backup, carried_forward: carried.length };
}

function renderPlan(plan) {
  const lines = [];
  const mode = plan.dry_run ? 'DRY RUN (pass --apply to write)' : plan.written ? 'APPLIED' : 'APPLIED — nothing changed';
  lines.push(`Cost ledger rebuild — ${mode}`);
  lines.push(`  Transcripts under: ${plan.claude_projects_dir}`);
  lines.push(`  Sessions rebuilt : ${plan.sessions.length}${plan.main_thread_rows ? ' (one main-thread row each, dated at session end)' : ''}`);
  for (const s of plan.sessions) {
    lines.push(`    ${s.session.slice(0, 8)}  agent files ${String(s.agent_files).padStart(3)}  rows ${String(s.superseded_rows).padStart(3)} → ${String(s.rebuilt_rows).padStart(3)}  cost $${s.old_cost_usd.toFixed(2)} → $${s.new_cost_usd.toFixed(2)}${plan.main_thread_rows ? ` (main thread $${s.main_thread_cost_usd.toFixed(2)})` : ''}`);
    for (const w of s.warnings || []) lines.push(`             ! ${w}`);
  }
  lines.push(`  Kept as-is       : ${plan.kept_rows.hook_without_transcript} hook row(s) whose session transcript is gone, ${plan.kept_rows.caller} caller-appended row(s)`);
  lines.push(`  Ledger           : ${plan.totals.old_rows} → ${plan.totals.new_rows} rows, $${plan.totals.old_cost_usd.toFixed(2)} → $${plan.totals.new_cost_usd.toFixed(2)}`);
  if (plan.carried_forward) lines.push(`  Carried forward  : ${plan.carried_forward} row(s) a hook appended while the plan was being read`);
  if (plan.backup) lines.push(`  Previous ledger  : ${plan.backup}`);
  return lines.join('\n');
}

/** `cost rebuild [--apply] [--no-main-thread] [--claude-dir <path>]` */
function cmdCostRebuild(cwd, opts = {}, raw) {
  let plan;
  try {
    plan = planRebuild(cwd, opts);
    if (opts.apply) Object.assign(plan, applyRebuild(cwd, plan));
  } catch (e) {
    return error(`cost rebuild failed: ${e.message}`);
  }
  const { _ledger, _snapshot, ...result } = plan;
  output(result, raw, renderPlan(plan));
}

module.exports = {
  encodeProjectDirName,
  readJsonl,
  sumTranscriptUsage,
  mapAgentsFromParent,
  mapAgentsFromWorkflowRuns,
  listAgentFiles,
  discoverSessions,
  planRebuild,
  applyRebuild,
  renderPlan,
  cmdCostRebuild,
  MAIN_THREAD_AGENT,
};
