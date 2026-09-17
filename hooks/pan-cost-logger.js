#!/usr/bin/env node
// PAN cost logger — SubagentStop hook (v3.4+).
//
// Claude Code fires SubagentStop when a Task-spawned sub-agent finishes.
// The hook receives JSON on stdin describing the session, transcript path,
// and (when available) usage metadata.
//
// We append a minimal record to .planning/metrics/tokens.jsonl so
// `/pan:cost` reports reflect real agent spawns, not just manually-appended
// entries. Token counts come from the subagent's OWN transcript when the host
// names one (`agent_id` → `<session>/subagents/agent-<id>.jsonl`, see
// resolveAgentTranscript), else from a slice of the parent session transcript,
// else from the payload's plausibility-guarded counters. A `source: "hook"`
// flag distinguishes these rows from fully-instrumented records.
//
// This hook NEVER blocks the main agent loop — all errors are swallowed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Runtime config dirs a local PAN install lands in (mirrors installer getDirName).
// Every runtime PAN installs into, by config-directory name. Built from the runtime
// names rather than written as literals on purpose: the installer templates a hook by
// rewriting the string `'.claude'`, including a catch-all for unanchored occurrences,
// which rewrote this list too — a Codex install shipped `.codex` twice and no `.claude`
// at all, so this predicate stopped recognising a Claude-only project (2026-09-17).
// This list is runtime-AGNOSTIC and must survive the install byte for byte.
const PAN_RUNTIME_DIRS = ['claude', 'codex', 'gemini', 'opencode', 'github'].map((r) => `.${r}`);

/**
 * Which planning tree this hook writes to.
 *
 * Mirrors pan-wizard-core/bin/lib/planning-root.cjs, which the hook cannot
 * require (hooks are standalone and run inside the host runtime). Without this
 * the CLI could be pointed at `--track verify` while the cost hook kept writing
 * to `.planning/`, so a track's telemetry landed in the wrong tree.
 *
 * Env only — a hook gets no argv. Values that escape the project root are
 * ignored rather than honoured; a bad value must degrade to the default, never
 * write outside the project.
 */
function planningDirName() {
  const raw = process.env.PAN_PLANNING_DIR || '';
  if (raw.trim()) {
    const rel = raw.trim().replace(/\\/g, '/');
    const bad = rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)
      || rel.split('/').includes('..');
    if (!bad) return rel;
  }
  const track = (process.env.PAN_TRACK || '').trim();
  if (track && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(track)) {
    return `.planning/tracks/${track}`;
  }
  return '.planning';
}

/** Absolute path inside the active planning tree. */
function planningPath(cwd, ...segments) {
  return path.join(cwd, ...planningDirName().split('/'), ...segments);
}

// M62: only instrument actual PAN projects. A global-install hook fires in EVERY
// repo the user opens; without this gate it silently creates .planning/ metrics
// artifacts in non-PAN repos. A project counts as PAN if it already has a
// .planning/ tree (a /pan command created it) OR carries a local PAN install
// (a manifest / core payload under a runtime config dir — covers a fresh local
// install before any .planning/ exists). Global installs in a plain repo match
// neither, so the hook no-ops. Best-effort — never throws.
function isPanProject(cwd) {
  try {
    if (!cwd) return false;
    if (fs.existsSync(planningPath(cwd))) return true;
    for (const d of PAN_RUNTIME_DIRS) {
      if (fs.existsSync(path.join(cwd, d, 'pan-file-manifest.json'))) return true;
      if (fs.existsSync(path.join(cwd, d, 'pan-wizard-core'))) return true;
    }
    return false;
  } catch {
    return false;
  }
}


// Telemetry FILLS a planning tree; it never brings one into existence. isPanProject
// above also accepts a bare install marker, which is right for "is PAN here" but wrong
// as a licence to write: a global-install hook fires in every repo the user opens, and
// scaffolding `.planning/` on the marker alone made repos that had merely installed PAN
// look like half-built projects to `validate health` and `hygiene scan` — five of the
// fourteen field projects swept on 2026-09-17 had a planning tree no /pan command ever
// created. Before the first /pan command there is no project to attribute a run to, so
// the honest record is no record. Best-effort — never throws.
function hasPlanningTree(cwd) {
  try {
    return !!cwd && fs.existsSync(planningPath(cwd));
  } catch {
    return false;
  }
}

const METRICS_DIR = 'metrics';
const TOKENS_FILE = 'tokens.jsonl';
const CURSOR_FILE = '.cost-cursor.json';

// Ledger row schema version. Bump when the record shape changes so readers can
// tell which shape a row was written in (pre-versioned rows read as v1); v3 added
// the per-invocation `event_sig` discriminator; v4 added `agent_id` and the
// `agent-transcript` token source. Kept as a literal in each hook —
// they are standalone zero-dep scripts that can't import from pan-wizard-core, so
// the two hooks must stay in sync by hand. No constant in pan-wizard-core mirrors
// it: the readers there take a row field by field rather than switching on its
// version, so an added field is additive for them.
const SCHEMA_V = 4;

// Reverse-map a resolved model id to its cost tier so the "By tier" dashboard
// section isn't blind on the hook path. Anthropic families only (the tiers PAN
// resolves); unknown models stay null rather than guess.
function tierForModel(model) {
  if (typeof model !== 'string' || !model) return null;
  if (/opus|fable|mythos/i.test(model)) return 'reasoning';
  if (/sonnet/i.test(model)) return 'mid';
  if (/haiku/i.test(model)) return 'fast';
  return null;
}

// How long a `current-session` pointer is evidence of a live session. An explicit
// (non-auto) session used to stay "current" indefinitely: a field project still pointed
// at a session started on 17 July when it was swept on 17 September, so every ledger row
// since had inherited that session's command and phase. Mirrors SESSION_STALE_MS in
// optimize.cjs — the hooks cannot import it.
const SESSION_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Last write to a session — its event log, else the moment it started, else null.
 * Best-effort; never throws.
 */
function sessionLastActivityMs(dir) {
  try {
    return fs.statSync(path.join(dir, 'trace.jsonl')).mtimeMs;
  } catch { /* no events yet */ }
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf-8'));
    const t = new Date(meta.started_at).getTime();
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/** Finished, or too old to be the session running now. */
function isSessionStale(dir, meta, now = Date.now()) {
  if (meta && meta.ended_at) return true;
  const last = sessionLastActivityMs(dir);
  return last === null || now - last > SESSION_STALE_MS;
}

// Best-effort read of the active trace session's command/phase so hook rows can
// be attributed to the command that spawned them. current-session →
// traces/<sid>/session.json (both written by the trace logger / optimize.cjs).
// Never throws — returns {} on any miss.
function readActiveSessionMeta(cwd) {
  try {
    const optDir = planningPath(cwd, 'optimization');
    const sid = fs.readFileSync(path.join(optDir, 'current-session'), 'utf-8').trim();
    if (!sid) return {};
    const dir = path.join(optDir, 'traces', sid);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf-8'));
    if (!meta || typeof meta !== 'object') return {};
    // A pointer at a finished or long-dead session describes nothing that is running
    // now; its command/phase must not be copied onto this row.
    if (isSessionStale(dir, meta)) return {};
    return meta;
  } catch {
    return {};
  }
}


// How much of a session transcript's tail to read when looking for the command that
// spawned this agent. A long session file runs to hundreds of megabytes, and the answer
// is always in the most recent turns, so the read is bounded.
const COMMAND_TAIL_BYTES = 262144;

// PAN's own command namespace, as a runtime writes it: `/pan:exec-phase` (Claude Code,
// Gemini) or `/pan-exec-phase` (Codex, OpenCode, Copilot). Only these spawn PAN agents,
// so only these are attributed — a host UI command (`/model`, `/compact`) and a plain
// typed prompt leave the row honestly unattributed instead of borrowing a name.
const PAN_COMMAND_RE = /<command-name>\s*\/?pan[:-]([a-z0-9][a-z0-9-]*)\s*<\/command-name>/i;

/**
 * The PAN command in whose turn this agent ran, read from the PARENT session transcript.
 *
 * `command` used to come only from the optimizer's trace session, and tracing is off by
 * default, so outside focus mode every field row carried `command: null` and "which
 * command got expensive" was unanswerable from PAN's own telemetry (field sweep
 * 2026-09-17, 976 rows). A runtime records a slash-command invocation as a TYPED user
 * turn carrying `<command-name>`, so the tail's most recent such turn names this work.
 *
 * Only typed user turns count. A tool_result record is the host replying to a tool call,
 * and its payload may quote a command tag verbatim — a transcript that had grepped another
 * project's history reported that project's command as its own until this was record-scoped
 * rather than text-scoped. Turns without a command (plain prose, an injected reminder) are
 * skipped rather than treated as clearing the attribution, so a mid-run "continue" does not
 * erase it.
 *
 * This is attribution by recency, not by proof: an agent spawned from a plain prompt long
 * after a PAN command still reads as that command while it remains in the window. Scoping
 * the match to PAN's namespace is what keeps that bounded — a session that has run no PAN
 * command reports null rather than naming whatever the user last typed.
 *
 * Returns the bare command name (`/pan:exec-phase` → `exec-phase`) or null. Never throws.
 */
function readCommandFromTranscript(transcriptPath) {
  try {
    if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
    const fd = fs.openSync(transcriptPath, 'r');
    let text;
    let partial = false;
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - COMMAND_TAIL_BYTES);
      partial = start > 0;
      const len = size - start;
      if (len <= 0) return null;
      const buf = Buffer.allocUnsafe(len);
      const read = fs.readSync(fd, buf, 0, len, start);
      text = buf.toString('utf-8', 0, read);
    } finally {
      fs.closeSync(fd);
    }
    const lines = text.split(/\r?\n/);
    if (partial) lines.shift(); // a mid-record first line
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      let rec;
      try { rec = JSON.parse(lines[i]); } catch { continue; }
      if (!rec || rec.type !== 'user' || !rec.message) continue;
      const content = rec.message.content;
      let typed = null;
      if (typeof content === 'string') typed = content;
      else if (Array.isArray(content)) {
        if (content.some((b) => b && b.type === 'tool_result')) continue; // host reply, not a typed turn
        typed = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
      }
      if (!typed) continue;
      const m = typed.match(PAN_COMMAND_RE);
      if (m) return m[1].toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}
/**
 * Current phase from state.md — the fallback when no optimizer trace is running.
 *
 * Phase attribution used to come ONLY from the active trace session, and
 * tracing is off by default, so in normal use every ledger row carried
 * `phase: null`. A field ledger had 121 rows and 100% of them were unattributed,
 * which makes "which phase got expensive" unanswerable from PAN's own telemetry
 * — exactly the question a slowdown raises.
 *
 * state.md is authoritative for the current phase and is present whenever the
 * phase model is in use. Frontmatter first (cheap, canonical), then the
 * `**Current Phase:**` body field that `extractFieldsFromState` reads.
 */
function readCurrentPhase(cwd) {
  try {
    const content = fs.readFileSync(planningPath(cwd, 'state.md'), 'utf-8');
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const m = fm[1].match(/^\s*current_phase\s*:\s*["']?([^"'\r\n]+)["']?\s*$/mi);
      if (m && m[1].trim() && m[1].trim() !== 'null') return m[1].trim();
    }
    const body = content.match(/\*\*Current Phase:\*\*\s*(.+)/i);
    if (body && body[1].trim()) return body[1].trim();
    return null;
  } catch {
    return null;
  }
}

// Duration of a transcript slice from its first→last record timestamp. Returns
// null when either bound is absent/unparseable — never a fabricated 0.
function durationFromSpan(firstTs, lastTs) {
  if (!firstTs || !lastTs) return null;
  const a = Date.parse(firstTs);
  const b = Date.parse(lastTs);
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}

// Per-transcript high-water mark: the count of JSONL records already attributed
// to earlier SubagentStop events, keyed by transcript path. Each event then sums
// ONLY its own slice (records past the cursor) instead of re-summing the whole
// shared-session transcript every time — the latter multiplies cumulative-per-turn
// cache-read into the billions/trillions and stamps it onto every subagent record
// (field report 2026-06). Stored next to tokens.jsonl; best-effort, never blocks.
function cursorFilePath(cwd) {
  return planningPath(cwd, METRICS_DIR, CURSOR_FILE);
}
function readCursor(cwd) {
  try {
    const c = JSON.parse(fs.readFileSync(cursorFilePath(cwd), 'utf-8'));
    return c && typeof c === 'object' ? c : {};
  } catch { return {}; }
}

// N17/N25-N27: reserved key in the cursor map recording, per transcript, the
// SIGNATURES of recently-seen SubagentStop events. An empty-slice event is a
// true re-fire / dual-registration ONLY when its full-payload signature was
// already seen for that transcript; a PARALLEL SIBLING (any payload difference)
// or a FIRST FIRE (missing/unreadable transcript, since===0) carries a new
// signature and must be recorded, not dropped. A bounded FIFO SET rather than a
// single slot (N25): a sibling recorded in between can no longer evict the
// signature that identifies an earlier event's re-fire. Bounded by COUNT, not
// by transcript existence, so the L40 dead-transcript prune can no longer erase
// the live marker of a missing-transcript first fire in the very write meant to
// persist it (N27). The name can never collide with a transcript path (an
// absolute file path).
const SEEN_EVENTS = '__seenEvents';
// Pre-N25 single-slot marker — no longer read; dropped on the next write
// (self-migrating, no reader of the old shape exists outside this hook).
const LEGACY_CONSUME_KEYS = '__consumeKeys';
// Bounds (L40): at most MAX_SEEN_TRANSCRIPTS transcripts x MAX_SEEN_SIGS
// signatures (~40 chars each) — a few KB worst-case. FIFO eviction on both axes.
// This window is the ONLY layer that recognizes a re-fire which is no longer
// ADJACENT to the row it duplicates: the ledger dedup below compares against the
// immediately preceding row and nothing further. A sibling wave wider than
// MAX_SEEN_SIGS on one transcript therefore evicts the earliest sibling's
// signature, and a late re-fire of THAT sibling is admitted as a phantom row.
// That residual is accepted deliberately, not overlooked — see eventSignature
// below for what widening either window was measured to cost.
const MAX_SEEN_SIGS = 8;
const MAX_SEEN_TRANSCRIPTS = 16;
// Cursor path keys. With per-agent transcripts every spawn adds a key that lives
// as long as Claude Code keeps the file (weeks), so existence-pruning alone no
// longer bounds the map (L40). Keep the most recently written keys only; a
// spawn's transcript is sliced once, so an evicted key costs nothing but a
// re-sum if that agent is ever resumed weeks later.
const MAX_CURSOR_KEYS = 512;

// Signature of a SubagentStop event: a hash of the FULL payload as delivered.
// A dual-registration re-fire is byte-identical on stdin (the host pipes the
// same JSON to every registration of one event), so its signature matches. A
// parallel sibling is distinguished by ANY differing payload field, without
// hardcoding which field a given runtime provides (N26).
//
// WHICH fields actually differ on real payloads is only partly established, so
// the sibling-admission benefit is CONDITIONAL. What this repo has observed:
//   • `agent_type` / `subagent_type` is supplied and does vary between siblings
//     of DIFFERENT type — the trace rows recorded under
//     experiments/*/.planning/optimization/traces/ were written by the sibling
//     hook from real payloads and carry real agent names. Different-type
//     siblings are therefore always separable.
//   • `session_id` is SHARED with the parent, and so is the session transcript
//     (docs/FIELD-REPORT-army-2026-06.md, root cause 1) — neither is
//     per-invocation.
//   • `model` and `phase` came out null in those recorded rows: the payload
//     carried neither.
//   • `usage` is absent entirely in headless mode (docs/HOOKS.md, P-1805).
//   • Claude Code's hook reference documents `agent_id` as a common input field
//     "present only when the hook fires inside a subagent call", and the
//     matching per-agent transcript files exist on disk beside the session
//     transcript (resolveAgentTranscript). Where it is present, the slice comes
//     from the agent's own transcript and two concurrent same-type siblings are
//     separable by that field alone.
// So on a host that omits `agent_id`, two CONCURRENT SAME-TYPE siblings have no
// confirmed varying payload field. Where the host supplies one, both spawns are
// admitted; where it supplies none the two payloads are the same bytes, hence
// informationally indistinguishable from a re-fire, and the second stays
// suppressed.
//
// What the guards promise, stated as narrowly as they hold: a re-fire is
// suppressed while it is still RECOGNIZABLE — its signature is in this
// transcript's seen-event window (MAX_SEEN_SIGS), or it is byte-identical modulo
// `ts` to the row IMMEDIATELY PRECEDING it in the ledger. Nothing further. A
// re-fire arriving after its signature has been evicted from the marker window,
// and not adjacent to the row it duplicates, IS admitted as a phantom row. That
// is the residual; it is documented rather than engineered away.
//
// It was engineered away once, and the cure destroyed data. The ledger dedup was
// widened to scan a tail of recent rows, with a second prong matching on a
// repeated signature alone for rows carrying no tokens. Both prongs delete real
// spawns. Five genuine spawns X,Y,X,Y,X on one shared transcript — the ordinary
// shared-session topology of docs/FIELD-REPORT-army-2026-06.md, where sequential
// same-type subagents deliver byte-identical payloads and therefore one
// signature — collapsed to TWO rows; when their slices carried real usage the
// collapsed rows' token counts vanished with them. Deleting real cost data is
// strictly worse than the occasional phantom row it prevents. The invariant that
// justified the contentless prong ("an event that consumed a real transcript
// slice never looks contentless") is also false: a slice of records that carry
// no `usage` and no `timestamp` yields zero on every axis and a null duration.
// So the dedup stays adjacent-only, and this comment states the residual instead
// of an invariant the code does not hold. Pinned in
// tests/cost-logger-hook.test.cjs — `grep -n 'no genuine spawn' tests/cost-logger-hook.test.cjs`.
//
// The NO-transcript path carries a wider residual: it never consults the marker
// layer at all (there is no transcript to key it by), so an INTERLEAVED dual
// registration there — A, B, A′, B′ — puts A′ and B′ out of adjacency reach and
// both are admitted as phantom rows. Closing that needs a lookback, and a
// lookback is the window whose failure mode is the data loss above, so it stays
// open.
//
// Where the guards CAN distinguish two events (their payloads differ, so their
// signatures differ) both are recorded — that is what the row's `event_sig`
// exists for. Where they CANNOT (identical bytes), the second is suppressed.
// So the bias falls on the indistinguishable case only, and it is deliberate:
// an undercounted spawn beats a phantom row for cost reporting (N29).
//
// The cost of that bias, stated plainly because no other comment admits it:
// two SEQUENTIAL genuine spawns whose rows coincide in every field but `ts` —
// same agent, same tokens, same span — collapse to one row, and the second
// spawn's real tokens are lost. This is inherent to an adjacent whole-row
// dedup, predates `event_sig`, and is identical in the pre-`event_sig` code;
// removing the dedup instead reinstates the duplicate-row field bug it was
// added for. It is the one UNDER-count residual, distinct from the evicted-
// marker phantom (an over-count) and from N29 (concurrent same-type siblings).
//
// Returns null when the payload cannot be serialized — callers then fail OPEN
// (record, never mark).
function eventSignature(data) {
  try {
    return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
  } catch { return null; }
}

function getSeenSigs(cursor, transcriptPath) {
  const se = cursor && cursor[SEEN_EVENTS];
  const arr = se && typeof se === 'object' ? se[transcriptPath] : null;
  return Array.isArray(arr) ? arr : [];
}
function addSeenSig(cursor, transcriptPath, sig) {
  if (!sig) return; // unhashable payload → never mark (fail open to recording)
  if (!cursor[SEEN_EVENTS] || typeof cursor[SEEN_EVENTS] !== 'object') cursor[SEEN_EVENTS] = {};
  const se = cursor[SEEN_EVENTS];
  const arr = Array.isArray(se[transcriptPath]) ? se[transcriptPath].filter((s) => s !== sig) : [];
  arr.push(sig);
  while (arr.length > MAX_SEEN_SIGS) arr.shift(); // FIFO — evict the oldest signature
  delete se[transcriptPath]; // re-insert so key order tracks recency for the transcript cap
  se[transcriptPath] = arr;
  const keys = Object.keys(se);
  for (let i = 0; i < keys.length - MAX_SEEN_TRANSCRIPTS; i++) delete se[keys[i]];
}

function writeCursor(cwd, cursor) {
  try {
    // Prune cursor keys for transcripts that no longer exist so the map can't
    // grow without bound over a long-lived project (L40, ADR audit 2026-08).
    const pruned = {};
    const live = Object.entries(cursor).filter(([tp]) => tp !== SEEN_EVENTS && tp !== LEGACY_CONSUME_KEYS && tp && fs.existsSync(tp));
    // Insertion order is write order (a key is re-inserted when advanced), so
    // the tail of the list is the most recently sliced transcripts.
    for (const [tp, v] of live.slice(-MAX_CURSOR_KEYS)) pruned[tp] = v;
    // Preserve the seen-event marker (N17/N25-N27). Deliberately NOT pruned by
    // transcript existence — a missing-transcript first fire's marker must
    // survive this very write, or its re-fire is re-admitted as a phantom row
    // (N27). Bounded by count instead (FIFO on both axes), which keeps the file
    // strictly bounded per L40.
    const se = cursor[SEEN_EVENTS];
    if (se && typeof se === 'object') {
      const bounded = {};
      for (const tp of Object.keys(se).slice(-MAX_SEEN_TRANSCRIPTS)) {
        const arr = se[tp];
        if (Array.isArray(arr) && arr.length) bounded[tp] = arr.slice(-MAX_SEEN_SIGS);
      }
      if (Object.keys(bounded).length) pruned[SEEN_EVENTS] = bounded;
    }
    fs.mkdirSync(path.dirname(cursorFilePath(cwd)), { recursive: true });
    fs.writeFileSync(cursorFilePath(cwd), JSON.stringify(pruned), 'utf-8');
  } catch { /* best-effort — never block the agent loop */ }
}

// ─── Per-agent transcript resolution ────────────────────────────────────────
//
// On SubagentStop Claude Code hands the hook the PARENT session's transcript
// (`transcript_path`) plus the subagent's `agent_id`; the subagent's own
// conversation is written beside the parent transcript as
// `<parent dir>/<session_id>/subagents/agent-<agent_id>.jsonl`. Slicing the
// parent transcript per event booked whatever the session had done since the
// previous stop to whichever subagent happened to stop next — and the FIRST stop
// on a long-lived session (cursor 0, or a cursor a ledger quarantine had reset)
// booked the session's entire history to one row: 7.5 billion cache-read tokens
// over a ten-day "duration" was observed in the field (2026-09). Sibling stops
// arriving before the parent transcript grew produced the complementary all-zero
// rows — 63% of one ledger. The agent transcript is the subagent's usage and
// nothing else, so it is preferred whenever it exists; the parent-slice path
// remains the fallback for hosts that supply no agent id. An explicit
// `agent_transcript_path` in the payload wins over the derivation.
const AGENT_ID_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function resolveAgentTranscript(data) {
  try {
    const explicit = data.agent_transcript_path;
    if (typeof explicit === 'string' && explicit && fs.existsSync(explicit)) return explicit;
    const agentId = data.agent_id;
    if (typeof agentId !== 'string' || !AGENT_ID_SAFE.test(agentId)) return null;
    if (typeof data.transcript_path !== 'string' || !data.transcript_path) return null;
    if (typeof data.session_id !== 'string' || !AGENT_ID_SAFE.test(data.session_id)) return null;
    const base = path.dirname(data.transcript_path);
    const subagentsDir = path.join(base, data.session_id, 'subagents');
    // Containment: every derived path must stay under the parent transcript's directory.
    const resolvedBase = path.resolve(base);
    const contained = (p) => path.resolve(p).startsWith(resolvedBase + path.sep);
    const direct = path.join(subagentsDir, `agent-${agentId}.jsonl`);
    if (contained(direct) && fs.existsSync(direct)) return direct;
    // Subagents spawned by the Workflow tool (the native `/pan-*` workflow
    // scripts) are written one level down, under the run that spawned them:
    // `subagents/workflows/<wf_id>/agent-<agent_id>.jsonl`. In the field those
    // were the majority of spawns (269 of 331 rows in one ledger), so missing
    // this level would have recorded them as unmeasured.
    const workflowsDir = path.join(subagentsDir, 'workflows');
    let runs = [];
    try { runs = fs.readdirSync(workflowsDir); } catch { return null; }
    for (const run of runs) {
      const nested = path.join(workflowsDir, run, `agent-${agentId}.jsonl`);
      if (contained(nested) && fs.existsSync(nested)) return nested;
    }
    return null;
  } catch {
    return null;
  }
}

// A slice is a SUM over one subagent's conversation, so its ceiling sits above a
// single call's (PLAUSIBLE_MAX): a long agent legitimately re-reads its cached
// context on every turn. The cache_read and output ceilings are the absolute
// limits cost.cjs isSuspectRecord quarantines on; input and cache_write are
// hook-only sanity ceilings (the reader has no rule for them). A value past its
// ceiling is a session's cumulative usage that leaked into the slice, never one
// subagent's own — drop it to 0 and flag the row. The parent-slice path had NO
// guard before v3.29: every oversum row in the field carried `clamped: false`.
// The slice's SPAN is not clamped: it is recorded as measured, and the reader's
// six-hour rule (cost.cjs SUSPECT_MAX_DURATION_MS) quarantines a slice that ran
// longer. Nulling the span here instead would hand the row to the reader's
// untimed cache-ratio rule and lose a legitimate long agent with it.
const SLICE_MAX = { input: 2e7, output: 1e7, cache_read: 5e8, cache_write: 1e8 };
function clampSlice(n, max) {
  return typeof n === 'number' && n >= 0 && n <= max ? n : 0;
}

/**
 * Extract what we can from the SubagentStop event payload.
 * Pure function — safe to test without stdin.
 *
 * @param {Object} data - Parsed SubagentStop event JSON
 * @param {string} cwd - Project cwd (for path resolution)
 * @returns {Object|null} Cost record, or null if the event should be ignored
 */
function buildCostRecord(data, cwd) {
  if (!data || typeof data !== 'object') return null;

  // Only log actual subagent stops; ignore other Stop variants.
  if (data.hook_event_name && data.hook_event_name !== 'SubagentStop') return null;

  // Per-call token counts come from the transcript SLICE — the records since
  // this transcript's previous SubagentStop cursor. The SubagentStop `data.usage`,
  // when Claude Code supplies it, is a CUMULATIVE session counter, NOT this
  // subagent's delta, so logging it verbatim stamped impossible per-row magnitudes
  // (tens of millions of output tokens, billions of cache-read) onto every record
  // and made /pan:cost and the optimizer unusable (field reports 2026-06 / 2026-07).
  // The transcript slice is the authoritative per-invocation delta; `data.usage`
  // is a guarded fallback used only when no transcript is available.
  let model = typeof data.model === 'string' && data.model ? data.model : null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let durationMs = null;
  // token_source records WHICH path produced the counts: `agent-transcript` (the
  // subagent's own conversation file — see resolveAgentTranscript), `transcript`
  // (a slice of the parent session transcript, the fallback when the host names
  // no agent) or `usage-fallback` (the payload's own counters). `clamped` marks
  // a value dropped to 0 by a plausibility guard so a guarded zero is
  // distinguishable from a genuine zero-token run.
  const agentTranscript = resolveAgentTranscript(data);
  const parentPath = typeof data.transcript_path === 'string' && data.transcript_path ? data.transcript_path : null;
  // The host NAMED an agent (a bare id, or an explicit agent transcript path) but
  // its file is not there — not flushed yet, or a host that sends ids without
  // per-agent files. The parent slice is the wrong answer for that spawn: it is
  // the whole session since the last parent-slice stop, booked to one agent. So
  // this event consumes nothing and records an unmeasured spawn (zeros, a
  // distinct token_source), which the reader excludes from calls.
  const agentNamed = (typeof data.agent_id === 'string' && AGENT_ID_SAFE.test(data.agent_id))
    || (typeof data.agent_transcript_path === 'string' && data.agent_transcript_path !== '');
  const agentFileMissing = !agentTranscript && agentNamed && parentPath !== null;
  const sliceSource = agentTranscript || (agentFileMissing ? null : parentPath);
  const tokenSource = agentTranscript ? 'agent-transcript'
    : agentFileMissing ? 'agent-transcript-missing'
      : sliceSource ? 'transcript' : 'usage-fallback';
  let clamped = false;
  // Set when a transcript-sourced event consumed no new records AND is an
  // identical re-fire / dual-registration. Carried on the returned record as a
  // transient flag so appendRecord can drop the phantom row; never written to
  // the ledger (M61).
  let emptySlice = false;
  const agent = data.agent_type || data.subagent_type || null;
  const agentId = typeof data.agent_id === 'string' && data.agent_id ? data.agent_id : null;
  // This event's per-invocation identity, hashed once and used by BOTH layers:
  // the seen-event marker below and the `event_sig` row field further down.
  // buildCostRecord never mutates `data`, so hoisting the hash here yields the
  // same value the marker calls used when they each computed it themselves.
  const eventSig = eventSignature(data);
  if (sliceSource || agentFileMissing) {
    // The cursor and the seen-event marker are keyed by whichever file is being
    // sliced: the agent transcript (one file per spawn, so a re-fire is the only
    // way to see an empty slice) or the shared parent transcript. A named-but-
    // missing agent file consumes nothing and is keyed by the parent, so the
    // re-fire / sibling marker logic below applies to it unchanged.
    const keyPath = sliceSource || parentPath;
    const cursor = readCursor(cwd);
    const since = cursor[keyPath] || 0;
    const fromTranscript = sliceSource
      ? readUsageFromTranscript(sliceSource, data.session_id, since)
      : { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: null, first_ts: null, last_ts: null, lineCount: since };
    const rawIn = fromTranscript.input_tokens;
    const rawOut = fromTranscript.output_tokens;
    const rawCr = fromTranscript.cache_read_input_tokens;
    const rawCw = fromTranscript.cache_creation_input_tokens;
    inputTokens = clampSlice(rawIn, SLICE_MAX.input);
    outputTokens = clampSlice(rawOut, SLICE_MAX.output);
    cacheRead = clampSlice(rawCr, SLICE_MAX.cache_read);
    cacheWrite = clampSlice(rawCw, SLICE_MAX.cache_write);
    clamped = rawIn > SLICE_MAX.input || rawOut > SLICE_MAX.output
      || rawCr > SLICE_MAX.cache_read || rawCw > SLICE_MAX.cache_write;
    durationMs = durationFromSpan(fromTranscript.first_ts, fromTranscript.last_ts); // as measured — see SLICE_MAX
    if (!model) model = fromTranscript.model;
    if (fromTranscript.lineCount > since) {
      // A real slice. Advance the cursor so the next subagent's record starts
      // fresh — the slices partition the transcript, so it is never re-summed on
      // every event. Remember this event's signature (N17/N25) so a later
      // empty-slice event can tell its re-fire from a parallel sibling — even
      // when other siblings are recorded in between (N25). Re-insert the key so
      // insertion order tracks write order (writeCursor keeps the newest keys).
      delete cursor[keyPath];
      cursor[keyPath] = fromTranscript.lineCount;
      addSeenSig(cursor, keyPath, eventSig);
      writeCursor(cwd, cursor);
    } else {
      // No transcript records past the cursor: this event consumed NO slice of
      // its own. Two very different situations land here (N17):
      //   • A re-fire / dual global+local hook registration — the SAME event
      //     delivered again (byte-identical payload). Its all-zero row is a
      //     phantom the ledger dedup cannot catch — the zeros differ from the
      //     real row the re-fire follows — so flag it and let appendRecord drop
      //     it (M61). This marker is the ONLY layer that catches that case; there
      //     is no signature-matching backstop below it, by design (see
      //     eventSignature).
      //   • A PARALLEL SIBLING (another subagent — same or different type — whose
      //     sibling already consumed the shared transcript to EOF and advanced
      //     this shared cursor) or a FIRST FIRE whose transcript_path is
      //     missing/unreadable (lineCount=0, since=0). These are legitimate
      //     spawns that must be RECORDED with zero tokens, not dropped —
      //     dropping them undercounts /pan:cost.
      // The full-payload signature distinguishes them (N25/N26): DROP only when
      // this exact payload was already seen for this transcript (true re-fire);
      // otherwise record the spawn.
      if (eventSig && getSeenSigs(cursor, keyPath).includes(eventSig)) {
        emptySlice = true; // already-seen event → re-fire; appendRecord drops the phantom row (M61)
      } else {
        // Sibling / first-fire / named-but-missing agent file: record the spawn
        // (zero tokens) and remember its signature so a subsequent re-fire of
        // THIS event is dropped.
        addSeenSig(cursor, keyPath, eventSig);
        writeCursor(cwd, cursor);
      }
    }
  } else {
    // No transcript to slice — best-effort from data.usage, plausibility-guarded
    // so a cumulative counter can never slip through as a per-call value. Flag
    // when the guard actually fired so a dropped value isn't read as a real zero.
    const rawIn = extractNumber(data.usage, 'input_tokens');
    const rawOut = extractNumber(data.usage, 'output_tokens');
    const rawCr = extractNumber(data.usage, 'cache_read_input_tokens');
    const rawCw = extractNumber(data.usage, 'cache_creation_input_tokens');
    inputTokens = clampPlausible(rawIn);
    outputTokens = clampPlausible(rawOut);
    cacheRead = clampPlausible(rawCr);
    cacheWrite = clampPlausible(rawCw);
    clamped = [rawIn, rawOut, rawCr, rawCw].some((n) => n > PLAUSIBLE_MAX);
  }

  // Backfill command/phase from the active trace session when the payload omits
  // them (real SubagentStop payloads carry neither); tier is derived from the model.
  const sessionMeta = readActiveSessionMeta(cwd);
  // The trace session only exists while the optimizer runs, so the parent transcript is
  // the fallback that makes command attribution work outside focus mode — see
  // readCommandFromTranscript.
  const command = data.command || sessionMeta.command || readCommandFromTranscript(data.transcript_path) || null;
  // The trace session is only present while the optimizer is running (off by
  // default), so state.md is the fallback that makes phase attribution work in
  // ordinary use instead of only under tracing.
  const phase = data.phase || sessionMeta.phase || readCurrentPhase(cwd) || null;

  const record = {
    v: SCHEMA_V,
    ts: new Date().toISOString(),
    agent,
    // The host's per-spawn id (null where the host supplies none). What made
    // the agent's own transcript addressable; persisted so a reader can tell
    // two same-type siblings apart without hashing the payload.
    agent_id: agentId,
    command,
    model,
    tier: tierForModel(model),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    cost_usd: null,
    duration_ms: durationMs,
    phase,
    session: data.session_id || null,
    source: 'hook',
    token_source: tokenSource,
    clamped,
    // This spawn's per-invocation discriminator: the event signature, persisted.
    // The signature was already hashed for the seen-event marker but never
    // written into the row, so two parallel same-type siblings produced rows
    // that were byte-identical modulo `ts` and the dedup ate the second one even
    // though the marker layer had correctly admitted it (N26). Persisting it
    // gives both layers ONE notion of event identity: siblings differ here even
    // when every other field matches, while a re-fire carries the same signature
    // and still matches the row it duplicates.
    // It is a field the dedup COMPARES as part of whole-row identity — never a
    // key the dedup searches the ledger by. Two sequential subagents on a shared
    // growing transcript share one payload and therefore one signature while
    // holding different real token counts, so matching on the signature alone
    // deletes genuine rows (see eventSignature). null when the payload could not
    // be hashed.
    event_sig: eventSig,
  };

  // Non-enumerable transient flag: it must NOT be serialized into the ledger,
  // but appendRecord needs to read it to drop a phantom re-fire row (M61).
  if (emptySlice) {
    Object.defineProperty(record, '__emptySlice', { value: true, enumerable: false });
  }

  return record;
}

function extractNumber(obj, key) {
  if (!obj || typeof obj !== 'object') return 0;
  const v = obj[key];
  return typeof v === 'number' ? v : 0;
}

// A single subagent call's token counts never realistically exceed this; a value
// above it is a cumulative session counter that leaked in, so we drop it to 0
// rather than poison the ledger. Generous vs. any real call, tiny vs. the
// billions/tens-of-millions the cumulative bug produced.
const PLAUSIBLE_MAX = 20000000;
function clampPlausible(n) {
  return typeof n === 'number' && n >= 0 && n <= PLAUSIBLE_MAX ? n : 0;
}

/**
 * P-1805 (v3.7.8): read transcript JSONL and sum usage across assistant messages.
 *
 * `sinceLine` (P-360, field report 2026-06): skip the first N non-empty records —
 * the count already attributed to earlier SubagentStop events for this transcript.
 * Summing only the slice past the cursor is what stops a shared-session transcript
 * from being re-summed on every event (which multiplied cumulative-per-turn
 * cache-read into the billions). Returns `lineCount` = total non-empty records seen
 * so the caller can advance the cursor. Returns zeros if missing/unreadable.
 *
 * @param {string} transcriptPath
 * @param {string} sessionId
 * @param {number} [sinceLine=0] - records already attributed (the cursor)
 */
function readUsageFromTranscript(transcriptPath, sessionId, sinceLine = 0) {
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    model: null,
    first_ts: null,
    last_ts: null,
    lineCount: 0,
  };
  if (!transcriptPath || typeof transcriptPath !== 'string') return totals;
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf-8'); } catch { return totals; }
  let seen = 0; // count of non-empty JSONL records (the cursor unit)
  // One API turn, one usage. Claude Code writes an assistant turn as one JSONL
  // record PER CONTENT BLOCK (text, tool_use, …), each carrying that turn's
  // `message.id` and a usage snapshot; the last block's snapshot holds the
  // turn's final counts. Summing every record therefore counted a three-block
  // turn three times — a real 65-turn agent transcript summed to 14.8M
  // cache-read tokens against 8.5M actual (2026-09). Keyed by `message.id`,
  // last snapshot wins; records with no id (older transcripts, other hosts)
  // are summed as they come.
  const byMessage = new Map();
  let unkeyed = 0;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    seen++;
    if (seen <= sinceLine) continue; // already attributed to an earlier event
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    // Claude Code names this field `sessionId`; the guard read `session_id` only, so it
    // was inert — 199 of 200 records in a real local transcript carry the camelCase
    // spelling and none carry the snake_case one (measured 2026-09-17). Harmless on the
    // per-agent path, where every record in the file belongs to the one agent, but the
    // scoping it claims to do never happened on the parent-slice fallback. Both
    // spellings are accepted rather than one guessed at.
    const entrySession = entry.sessionId || entry.session_id;
    if (sessionId && entrySession && entrySession !== sessionId) continue;
    // Span of THIS subagent's slice (after the session filter) — first→last
    // record timestamp gives a measured runtime rather than an idle-gap proxy.
    const entryTs = typeof entry.timestamp === 'string' ? entry.timestamp : null;
    if (entryTs) {
      if (!totals.first_ts) totals.first_ts = entryTs;
      totals.last_ts = entryTs;
    }
    // Assistant messages carry the model id alongside their usage — keep the
    // last one seen (mid-session model switches resolve to the final model).
    const entryModel = entry.message?.model || entry.model || null;
    if (typeof entryModel === 'string' && entryModel) totals.model = entryModel;
    const usage = entry.usage
      || entry.message?.usage
      || entry.response?.usage
      || (entry.type === 'assistant' && entry.message?.usage)
      || null;
    if (!usage || typeof usage !== 'object') continue;
    const messageId = entry.message && typeof entry.message.id === 'string' && entry.message.id
      ? entry.message.id
      : `__unkeyed_${unkeyed++}`;
    byMessage.set(messageId, usage);
  }
  for (const usage of byMessage.values()) {
    totals.input_tokens += extractNumber(usage, 'input_tokens');
    totals.output_tokens += extractNumber(usage, 'output_tokens');
    totals.cache_read_input_tokens += extractNumber(usage, 'cache_read_input_tokens');
    totals.cache_creation_input_tokens += extractNumber(usage, 'cache_creation_input_tokens');
  }
  totals.lineCount = seen;
  return totals;
}

/**
 * Append record to .planning/metrics/tokens.jsonl. Silently succeeds
 * even if the file or directory can't be written — hook must not block.
 *
 * @param {string} cwd - Working directory (project root)
 * @param {Object} record - Cost record from buildCostRecord
 * @returns {boolean} true if written, false otherwise
 */
function appendRecord(cwd, record) {
  if (!record) return false;
  // M61 re-fire guard: a transcript-sourced event that consumed no new records
  // (buildCostRecord flags it via __emptySlice) is a re-fired / dual-registered
  // SubagentStop with nothing of its own to attribute. Dropping it here is the
  // real guard the last-row dedup could not be — the phantom all-zero row
  // differs from the real row it follows, so the dedup never fired (M61).
  if (record.__emptySlice) return false;
  try {
    const dir = planningPath(cwd, METRICS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, TOKENS_FILE);
    // Idempotency guard: a re-fired SubagentStop must not double-log. Skip the
    // append when this record is identical (every field but the timestamp) to
    // the immediately-preceding row — the source of ~57% duplicate rows in the
    // field (2026-07). Adjacent-only on purpose; see isDuplicateOfLastRecord.
    // Best-effort: any read error just proceeds with the append.
    if (isDuplicateOfLastRecord(file, record)) return false;
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `record` equals the LAST JSONL row of `file`, ignoring `ts`.
 *
 * Adjacent-only, and that is the design rather than an oversight. The comparison
 * covers every field including the `event_sig` discriminator, so a true re-fire
 * (same payload → same signature → same row) still matches the row it follows,
 * while two siblings the payload can distinguish both survive (N26).
 *
 * It deliberately does NOT scan back over a tail of recent rows, and does not
 * match on a repeated signature. Both of those were tried and both delete real
 * spawns: an identity scan over a window collapses genuine repeat spawns whose
 * rows coincide, and a signature prong collapses genuine spawns that share a
 * payload — the ordinary shared-transcript topology. eventSignature carries the
 * measured reproduction and the residual this leaves standing;
 * tests/cost-logger-hook.test.cjs pins both
 * (`grep -n 'no genuine spawn' tests/cost-logger-hook.test.cjs`).
 *
 * Rows written before the discriminator existed carry no `event_sig` and an
 * older `v`, so a row written now never equals one of them. The bounded
 * consequence: the first append after a schema bump can land beside a pre-bump
 * row without matching it, and the guard resumes on the following same-shape
 * pair. Those older rows still parse and still report — the readers in
 * pan-wizard-core take a row field by field and require no particular version
 * or field to be present.
 */
function isDuplicateOfLastRecord(file, record) {
  let prev;
  try {
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    if (!lines.length) return false;
    prev = JSON.parse(lines[lines.length - 1]);
  } catch {
    return false; // no file / unreadable / bad JSON → not a duplicate
  }
  const strip = (r) => { const { ts, ...rest } = r; return JSON.stringify(rest); };
  return strip(prev) === strip(record);
}

// ─── Stdin driver ───────────────────────────────────────────────────────────

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      // Prefer cwd from the event (Claude Code sends it in most hook payloads);
      // fall back to process.cwd() which is the project root when Claude Code
      // invokes the hook.
      const cwd = data.cwd || data.workspace?.current_dir || process.cwd();
      // M62: a global-install hook fires in every repo; don't pollute non-PAN
      // projects with .planning/ metrics artifacts. The tree must already exist —
      // see hasPlanningTree (field sweep 2026-09-17).
      if (!hasPlanningTree(cwd)) return;
      const record = buildCostRecord(data, cwd);
      appendRecord(cwd, record);
    } catch {
      // Silent fail — don't block agent loop on hook errors.
    }
  });
}

module.exports = { buildCostRecord, appendRecord, readUsageFromTranscript, resolveAgentTranscript, readCursor, writeCursor, isPanProject, hasPlanningTree, readCommandFromTranscript, isSessionStale, PAN_RUNTIME_DIRS, METRICS_DIR, TOKENS_FILE, CURSOR_FILE, SLICE_MAX, MAX_CURSOR_KEYS };
