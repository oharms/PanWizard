/**
 * Hook e2e — every PAN hook spawned as a process, from the installed copy, on every
 * runtime that registers it (spec docs/specs/testing-system-redesign-2026-09.md §3.2
 * items 11–12, test-plan items 9 and 13).
 *
 * Why this file exists. The hooks are the only PAN code the *host* runs, and until now
 * two of the six were never spawned at all: their pure decision functions were unit
 * tested and the process around them — stdin parsing, path resolution, the installer's
 * `.claude` → `.<runtime>` rewrite of the installed copy, the silence a hook owes the
 * agent loop — was not. A hook that throws on stdin still passes a `buildX()` test.
 *
 * What is asserted, per hook × runtime row of the committed surface registry:
 *   - the INSTALLED copy under that runtime's config dir is the thing spawned, never
 *     hooks/ in this repo, so a broken installer rewrite fails here;
 *   - the payload goes in on stdin as a captured fixture from tests/fixtures/hooks/,
 *     each carrying its provenance in a sibling `.meta.json`;
 *   - the OBSERVABLE EFFECT is read back and its fields are parsed and compared —
 *     a ledger row's token counts, a trace event's context, the monitor's
 *     `additionalContext`, the guard's decision, the statusline's rendered line and
 *     bridge record, the update check's cache record;
 *   - exit status is 0 and stderr is empty. A hook that writes to stderr or exits
 *     non-zero is a hook the host reports as failing mid-turn.
 * And once per hook: a malformed payload (invalid JSON, empty stdin) still exits 0 and
 * writes nothing. Fail-open is the hooks' central contract — every one of them swallows
 * its errors on purpose, and nothing else in the suite proves the swallow works from
 * the outside.
 *
 * Doctrine notes for whoever edits this next:
 *   - the telemetry hooks write only into an EXISTING `.planning/` tree and never
 *     scaffold one (field sweep 2026-09-17), so each project fixture creates the tree
 *     before firing;
 *   - the bridge directory (`<tmpdir>/pan-hooks-<uid>`) and the home directory are
 *     per-user globals, so every spawn here gets its own tmpdir and its own fake home;
 *   - `pan-check-update.js` shells out to `npm view` in a detached child. PATH is
 *     pointed at an empty directory so the suite makes no network call, which also
 *     makes the cache record deterministic (`latest: "unknown"`).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { installInto, cleanup, readLedger, spawnHook, withFakeHome, RUNTIME_DIR } = require('./helpers.cjs');
const { HOOK_EVENT_MAP } = require('../bin/install-lib.cjs');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'hooks');
const SURFACE_FILE = path.join(__dirname, 'fixtures', 'surface.json');

/** The committed registry's hook × runtime rows — the matrix this file must cover. */
const REGISTERED = JSON.parse(fs.readFileSync(SURFACE_FILE, 'utf8')).hooks;

/** Which hook file each HOOK_EVENT_MAP slot registers (bin/install-lib.cjs builders). */
const EVENT_HOOKS = Object.freeze({
  sessionStart: ['pan-check-update.js'],
  postToolUse: ['pan-context-monitor.js'],
  subagentStop: ['pan-cost-logger.js', 'pan-trace-logger.js'],
});

/**
 * Every hook SOURCE in hooks/, read off disk rather than listed here: a hook added to
 * that directory must not be able to arrive without a fail-open test. `hooks/dist/` is
 * build output and gitignored, so only the top-level `.js` files count.
 */
const ALL_HOOKS = Object.freeze(
  fs.readdirSync(path.join(__dirname, '..', 'hooks'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name)
    .sort(),
);

// What the fixture transcript pair sums to. Per TURN, not per record: the fixture
// repeats one turn's `message.id` across two content blocks on purpose, so a slice that
// sums records instead of turns reads 590 output / 19000 cache-read instead of these.
const EXPECTED_SLICE = Object.freeze({
  input_tokens: 126,
  output_tokens: 550,
  cache_read_tokens: 14000,
  cache_write_tokens: 800,
  total_tokens: 676,
  duration_ms: 1500,
  model: 'claude-sonnet-4-5',
  tier: 'mid',
  command: 'exec-phase',
  agent: 'pan-executor',
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** A fixture document, parsed. */
function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

/** Replace every `{{TOKEN}}` in a fixture with the value `map` gives it. */
function substitute(value, map) {
  if (typeof value === 'string') return value.replace(/\{\{[A-Z_]+\}\}/g, (m) => (m in map ? map[m] : m));
  if (Array.isArray(value)) return value.map((v) => substitute(v, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, map);
    return out;
  }
  return value;
}

/** Every `{{TOKEN}}` a fixture document mentions. */
function placeholdersIn(value, found = new Set()) {
  if (typeof value === 'string') for (const m of value.match(/\{\{[A-Z_]+\}\}/g) || []) found.add(m);
  else if (Array.isArray(value)) for (const v of value) placeholdersIn(v, found);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) placeholdersIn(v, found);
  return found;
}

const REQUIRED_META_KEYS = Object.freeze(['captured_from', 'captured_at', 'hook_event', 'runtime', 'notes']);

/**
 * Provenance findings for a directory of hook payload fixtures — one human-readable
 * string per problem, `[]` when every `*.json` that is not itself a `*.meta.json` has a
 * sibling meta carrying every required key with a non-empty value. Pure: the negative
 * case below runs it against a temp directory rather than breaking a committed fixture.
 */
function lintFixtureProvenance(dir) {
  const findings = [];
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json')).sort();
  if (names.length === 0) findings.push(`${dir}: no payload fixtures at all`);
  for (const name of names) {
    const metaName = `${name.replace(/\.json$/, '')}.meta.json`;
    const metaPath = path.join(dir, metaName);
    if (!fs.existsSync(metaPath)) {
      findings.push(`${name}: no sibling ${metaName} — a fixture without provenance is an invented shape`);
      continue;
    }
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (err) {
      findings.push(`${metaName}: not parseable JSON (${err.message})`);
      continue;
    }
    for (const key of REQUIRED_META_KEYS) {
      const value = meta[key];
      if (typeof value !== 'string' || !value.trim()) findings.push(`${metaName}: ${key} is missing or empty`);
    }
  }
  return findings;
}

// ─── Temp estate ────────────────────────────────────────────────────────────

const tempDirs = [];
function mkTemp(prefix) {
  // Resolved: macOS's os.tmpdir() is a symlink (/var → /private/var) and the installer
  // records the real path, so an unresolved root makes every path comparison macOS-only
  // fragile.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

/** A project the telemetry hooks are allowed to write into: the tree already exists. */
function planningProject(label) {
  const dir = mkTemp(`pan-hookproj-${label}-`);
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  return dir;
}

/**
 * The tmpdir a spawned hook should see. The statusline → context-monitor bridge lives
 * at `<os.tmpdir()>/pan-hooks-<uid>`, one directory per user, so two tests sharing the
 * real tmpdir would share one bridge. All three spellings are set because os.tmpdir()
 * reads TMPDIR on POSIX and TEMP/TMP on Windows.
 */
function tmpdirEnv(dir) {
  return { TMPDIR: dir, TEMP: dir, TMP: dir };
}

let noNpmDir;
/**
 * A PATH with no `npm` on it, so pan-check-update's detached child cannot reach the
 * registry: the suite stays offline and `latest` is deterministically "unknown". Both
 * spellings are set because Windows env keys are case-insensitive and spreading
 * process.env there yields `Path`, which would otherwise survive alongside `PATH`.
 */
function noNpmEnv() {
  return { PATH: noNpmDir, Path: noNpmDir };
}

const installs = new Map();

before(() => {
  noNpmDir = mkTemp('pan-no-npm-');
  for (const runtime of Object.keys(RUNTIME_DIR)) {
    const root = mkTemp(`pan-hooks-e2e-${runtime}-`);
    const result = installInto(root, [`--${runtime}`, '--local']);
    assert.equal(result.success, true, `the installer must succeed for --${runtime}: ${result.error}`);
    installs.set(runtime, root);
  }
});

after(() => {
  for (const dir of tempDirs) cleanup(dir);
});

/** The installed copy of `hookFile` under `runtime`'s config directory. */
function installedHook(runtime, hookFile) {
  const script = path.join(installs.get(runtime), RUNTIME_DIR[runtime], 'hooks', hookFile);
  assert.equal(fs.existsSync(script), true, `the installer must place ${hookFile} in ${RUNTIME_DIR[runtime]}/hooks/`);
  return script;
}

/** The version the install under test carries, as the update check resolves it. */
function installedVersion(runtime) {
  const file = path.join(installs.get(runtime), RUNTIME_DIR[runtime], 'pan-wizard-core', 'VERSION');
  return fs.readFileSync(file, 'utf8').trim();
}

/**
 * Spawn a hook script with RAW stdin bytes and/or extra argv. `spawnHook` serialises
 * its payload, so a deliberately malformed byte stream cannot go through it, and it
 * passes no argv, so pan-check-update's `--run-check` child mode is unreachable through
 * it. Everything else in this file uses the helper.
 */
function spawnScript(script, { input, cwd, env = {}, args = [] }) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd, input, encoding: 'utf-8', env: { ...process.env, ...env }, timeout: 60000,
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// ─── Small readers ──────────────────────────────────────────────────────────

const stripAnsi = (s) => s.replace(/\[[0-9;]*m/g, '');

/** Every file named `name` anywhere under `root`. */
function findFiles(root, name) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...findFiles(full, name));
    else if (entry.name === name) out.push(full);
  }
  return out;
}

/**
 * Wait for pan-check-update's DETACHED child to finish, by waiting for the cache record
 * it writes last. Not a timing assertion and not optional bookkeeping: the child
 * re-creates its cache directory before writing, so a fake home removed while it is
 * still running comes back from the dead as a stray temp directory. Waiting for the
 * record is waiting for the child. No assertion is made about how long it took.
 */
function settleUpdateCheck(home) {
  const deadline = Date.now() + 20000;
  const idle = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline && findFiles(home, 'pan-update-check.json').length === 0) {
    Atomics.wait(idle, 0, 0, 50);
  }
  Atomics.wait(idle, 0, 0, 50); // let the child exit after its final write
}

/** Every directory named `name` anywhere under `root`. */
function findDirs(root, name) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (entry.name === name) out.push(full);
    out.push(...findDirs(full, name));
  }
  return out;
}

// Directories under a runtime config dir that carry SHIPPED CONTENT rather than
// configuration, plus the two JSON files that record an install rather than register a
// hook. Everything else is a surface the host reads.
const CONTENT_DIRS = new Set(['pan-wizard-core', 'commands', 'agents', 'prompts', 'chatmodes', 'skills', 'workflows', 'instructions']);
const NON_CONFIG_JSON = new Set(['pan-file-manifest.json', 'package.json']);

/**
 * Every PAN hook script named as a command anywhere in a runtime's config surface,
 * sorted. Reads the install back rather than trusting a table: this is the evidence
 * that a shipped registration cannot sit outside the surface registry.
 */
function registeredHooks(configDir) {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!CONTENT_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.json') || NON_CONFIG_JSON.has(entry.name)) continue;
      for (const m of fs.readFileSync(path.join(dir, entry.name), 'utf8').match(/pan-[a-z-]+\.js/g) || []) found.add(m);
    }
  };
  walk(configDir);
  return [...found].sort();
}

/**
 * The bridge directory the hook created under the tmpdir it was given. Taken from the
 * hook's own output rather than recomputed here: the uid suffix is the hook's business,
 * and re-deriving it would let both sides be wrong together.
 */
function bridgeDirIn(tmpdir) {
  const found = fs.readdirSync(tmpdir).filter((n) => n.startsWith('pan-hooks-'));
  assert.equal(found.length, 1, `the hook must create exactly one bridge directory under ${tmpdir}, found ${JSON.stringify(found)}`);
  return path.join(tmpdir, found[0]);
}

/** The trace events of the one auto-session the trace logger minted, with its id. */
function readTrace(project) {
  const tracesDir = path.join(project, '.planning', 'optimization', 'traces');
  const sessions = fs.readdirSync(tracesDir);
  assert.equal(sessions.length, 1, `the trace logger must mint exactly one session, found ${JSON.stringify(sessions)}`);
  const file = path.join(tracesDir, sessions[0], 'trace.jsonl');
  const events = fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  return { sessionId: sessions[0], events };
}

// ─── Payload builders ───────────────────────────────────────────────────────

/** The placeholder map every fixture is substituted through. */
function baseMap(project, sessionId, transcriptPath, agentId) {
  return {
    '{{PROJECT_DIR}}': project,
    '{{SESSION_ID}}': sessionId,
    '{{TRANSCRIPT_PATH}}': transcriptPath,
    '{{AGENT_ID}}': agentId || 'unused',
  };
}

/**
 * Lay out the transcript pair a real SubagentStop addresses — the parent session file
 * plus the subagent's own conversation at `<parent dir>/<session_id>/subagents/
 * agent-<agent_id>.jsonl` — and return the payload the host would send with it.
 */
function seedSubagentStop(project, sessionId, agentId) {
  const dir = path.join(project, 'transcripts');
  fs.mkdirSync(path.join(dir, sessionId, 'subagents'), { recursive: true });
  const parentPath = path.join(dir, `${sessionId}.jsonl`);
  const agentPath = path.join(dir, sessionId, 'subagents', `agent-${agentId}.jsonl`);
  const map = baseMap(project, sessionId, parentPath, agentId);
  const transcripts = substitute(fixture('subagent-transcripts-claude.json'), map);
  const jsonl = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(parentPath, jsonl(transcripts.parent), 'utf-8');
  fs.writeFileSync(agentPath, jsonl(transcripts.agent), 'utf-8');
  return substitute(fixture('subagent-stop-claude.json'), map);
}

/**
 * A project wearing the exact boundary-drop fingerprint the Stop guard arms on:
 * autonomy on in config, no legitimate-stop marker in state, an unticked phase in the
 * roadmap. The roadmap line is the shipped `- [ ] **Phase N:` shape.
 */
function armedStopProject(label) {
  const project = planningProject(label);
  const planning = path.join(project, '.planning');
  fs.writeFileSync(path.join(planning, 'config.json'), JSON.stringify({ workflow: { auto_advance: true } }), 'utf-8');
  fs.writeFileSync(path.join(planning, 'state.md'), '---\ncurrent_phase: 1\n---\n\n**Status:** Phase 1 complete\n', 'utf-8');
  fs.writeFileSync(path.join(planning, 'roadmap.md'), '- [x] **Phase 1: Groundwork**\n- [ ] **Phase 2: Bridge**\n', 'utf-8');
  return project;
}

// ─── Drivers: one per hook, run for every runtime that registers it ─────────

function driveSessionStart(runtime) {
  const script = installedHook(runtime, 'pan-check-update.js');
  const project = planningProject(`start-${runtime}`);
  const payload = substitute(fixture('session-start-claude.json'), baseMap(project, 'sess-start-0001', path.join(project, 'transcript.jsonl')));

  withFakeHome((home) => {
    // Parent mode: hand the event straight back and leave the (possibly slow) npm query
    // to a detached child, so SessionStart is never blocked.
    const parent = spawnHook(script, payload, project, noNpmEnv());
    assert.equal(parent.status, 0, `SessionStart must exit 0 on ${runtime}: ${parent.stderr}`);
    assert.equal(parent.stdout, '', 'the update check says nothing to the host on SessionStart');
    assert.equal(parent.stderr, '', 'a hook that writes to stderr is reported as failing mid-turn');
    const caches = findDirs(home, 'cache');
    assert.equal(caches.length, 1, `the update check must prepare exactly one cache directory under the home it is given, found ${JSON.stringify(caches)}`);
    settleUpdateCheck(home);

    // Child mode: the work the detached child does, run synchronously so the record it
    // leaves for the statusline can be read back. The installer rewrites this path per
    // runtime, so the record is located by searching the home rather than by a table.
    // No stderr assertion on this one, and the reason is a finding rather than an
    // oversight: defaultFetchLatest() runs `npm view` through execSync with inherited
    // stderr, so a registry failure is printed verbatim. Today nobody sees it because
    // the PARENT spawns this child with stdio: 'ignore' — the silence is the caller's,
    // not the hook's. The host-visible contract is asserted on the parent above.
    const child = spawnScript(script, { cwd: installs.get(runtime), args: ['--run-check'], env: noNpmEnv() });
    assert.equal(child.status, 0, `--run-check must exit 0 on ${runtime} even with no npm on PATH: ${child.stderr}`);
    const records = findFiles(home, 'pan-update-check.json');
    assert.equal(records.length, 1, `exactly one update-check record must be written, found ${JSON.stringify(records)}`);
    const record = JSON.parse(fs.readFileSync(records[0], 'utf-8'));
    assert.equal(record.installed, installedVersion(runtime), `the record must name the version installed under ${RUNTIME_DIR[runtime]}`);
    assert.equal(record.latest, 'unknown', 'PATH carries no npm, so the registry was never reached');
    assert.equal(record.update_available, false, 'an unknown latest must never claim an update — that badge nudges a downgrade');
    assert.equal(typeof record.checked, 'number', 'the record must carry the unix second it was checked');
  });
}

function drivePostToolUse(runtime) {
  const script = installedHook(runtime, 'pan-context-monitor.js');
  const project = planningProject(`ctx-${runtime}`);
  const tmpdir = mkTemp(`pan-bridge-${runtime}-`);
  const env = tmpdirEnv(tmpdir);
  const sessionId = `ctx-${runtime}-0001`;
  const payload = substitute(fixture('post-tool-use-claude.json'), baseMap(project, sessionId, path.join(project, 'transcript.jsonl')));

  // No bridge metrics yet — a subagent, or a fresh session. Nothing to warn about.
  const quiet = spawnHook(script, payload, project, env);
  assert.equal(quiet.status, 0, `PostToolUse must exit 0 on ${runtime}: ${quiet.stderr}`);
  assert.equal(quiet.stdout, '', 'with no metrics on the bridge the monitor injects nothing');
  assert.equal(quiet.stderr, '', 'a missing bridge file is not an error');

  // Seed the bridge the way the statusline does, in the CRITICAL band.
  const bridge = bridgeDirIn(tmpdir);
  fs.writeFileSync(path.join(bridge, `claude-ctx-${sessionId}.json`), JSON.stringify({
    session_id: sessionId, remaining_percentage: 18, used_pct: 100, timestamp: Math.floor(Date.now() / 1000),
  }), 'utf-8');

  const warned = spawnHook(script, payload, project, env);
  assert.equal(warned.status, 0, `PostToolUse must exit 0 when it warns on ${runtime}: ${warned.stderr}`);
  assert.equal(warned.stderr, '', 'the warning travels on stdout, never stderr');
  const emitted = JSON.parse(warned.stdout);
  assert.equal(emitted.hookSpecificOutput.hookEventName, 'PostToolUse', 'the envelope must name the event the host fired');
  assert.match(
    emitted.hookSpecificOutput.additionalContext,
    /^CONTEXT MONITOR CRITICAL: Usage at 82%\. Remaining: 18%\./,
    'usage and remaining must be reported on one scale and sum to 100 (L39)',
  );
  assert.match(emitted.hookSpecificOutput.additionalContext, /\/pan:pause/, 'the critical warning must name the command that saves state');
  const warnState = JSON.parse(fs.readFileSync(path.join(bridge, `claude-ctx-${sessionId}-warned.json`), 'utf-8'));
  assert.deepEqual(warnState, { callsSinceWarn: 0, lastLevel: 'critical' }, 'the emit must reset the debounce counter and record the level it fired at');
}

function driveCostLogger(runtime) {
  const script = installedHook(runtime, 'pan-cost-logger.js');
  const project = planningProject(`cost-${runtime}`);
  const sessionId = `cost-${runtime}-0001`;
  const agentId = `agent-${runtime}-0001`;
  const payload = seedSubagentStop(project, sessionId, agentId);

  const result = spawnHook(script, payload, project);
  assert.equal(result.status, 0, `the cost logger must exit 0 on ${runtime}: ${result.stderr}`);
  assert.equal(result.stdout, '', 'a telemetry hook says nothing to the host');
  assert.equal(result.stderr, '', 'a hook that writes to stderr is reported as failing mid-turn');

  const rows = readLedger(project);
  assert.equal(rows.length, 1, `one SubagentStop must book exactly one ledger row, got ${rows.length}`);
  const row = rows[0];
  assert.equal(row.token_source, 'agent-transcript', 'the counts must come from the subagent\'s own transcript, not a slice of the parent session');
  assert.equal(row.input_tokens, EXPECTED_SLICE.input_tokens, 'input tokens must be the per-turn sum of the agent transcript');
  assert.equal(row.output_tokens, EXPECTED_SLICE.output_tokens, 'output tokens must count each turn once — the fixture repeats a turn across two content blocks');
  assert.equal(row.cache_read_tokens, EXPECTED_SLICE.cache_read_tokens, 'cache reads must count each turn once');
  assert.equal(row.cache_write_tokens, EXPECTED_SLICE.cache_write_tokens, 'cache writes must count each turn once');
  assert.equal(row.duration_ms, EXPECTED_SLICE.duration_ms, 'the duration must be the measured first→last span of the slice');
  assert.equal(row.model, EXPECTED_SLICE.model, 'the model must come from the transcript when the payload omits one');
  assert.equal(row.tier, EXPECTED_SLICE.tier, 'the tier must be derived from the resolved model');
  assert.equal(row.command, EXPECTED_SLICE.command, 'the command must be read off the parent transcript\'s typed invocation');
  assert.equal(row.agent, EXPECTED_SLICE.agent, 'the row must name the agent type the payload carried');
  assert.equal(row.agent_id, agentId, 'the row must persist the per-spawn id that made the transcript addressable');
  assert.equal(row.session, sessionId, 'the row must name the host session');
  assert.equal(row.source, 'hook', 'a hook-written row must be distinguishable from a caller-appended one');
  assert.equal(row.clamped, false, 'a plausible slice must not be flagged as guarded');
  assert.equal(row.cost_usd, null, 'the hook never prices a row — the aggregator does');
  assert.equal(row.phase, null, 'with no state.md and no trace session there is no phase to attribute');
  assert.ok(row.v >= 4, `the row schema must be at least v4 (agent_id + agent-transcript source), got ${row.v}`);
  assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'the row must carry an ISO timestamp');

  // The payload's own `usage` is a CUMULATIVE session counter. If it ever wins again,
  // these are the numbers that show up instead of the slice's.
  assert.notEqual(row.cache_read_tokens, payload.usage.cache_read_input_tokens, 'the payload\'s cumulative usage must never reach the row');
  assert.notEqual(row.input_tokens, payload.usage.input_tokens, 'the payload\'s cumulative usage must never reach the row');
}

function driveTraceLogger(runtime) {
  const script = installedHook(runtime, 'pan-trace-logger.js');
  const project = planningProject(`trace-${runtime}`);
  const sessionId = `trace-${runtime}-0001`;
  const agentId = `agent-${runtime}-0002`;
  const payload = seedSubagentStop(project, sessionId, agentId);

  const result = spawnHook(script, payload, project);
  assert.equal(result.status, 0, `the trace logger must exit 0 on ${runtime}: ${result.stderr}`);
  assert.equal(result.stdout, '', 'a telemetry hook says nothing to the host');
  assert.equal(result.stderr, '', 'a hook that writes to stderr is reported as failing mid-turn');

  const { sessionId: traceSession, events } = readTrace(project);
  assert.match(traceSession, /^sess_auto_\d{8}$/, 'the hook must mint a day-scoped auto-session when none is current');
  const pointer = fs.readFileSync(path.join(project, '.planning', 'optimization', 'current-session'), 'utf-8').trim();
  assert.equal(pointer, traceSession, 'the current-session pointer must name the session the events landed in');

  assert.equal(events.length, 1, `one SubagentStop must append exactly one trace event, got ${events.length}`);
  const event = events[0];
  assert.equal(event.category, 'agent_completion', 'the core event of a subagent stop is its completion');
  assert.equal(event.type, 'decision', 'the completion is recorded as a decision event');
  assert.equal(event.agent, EXPECTED_SLICE.agent, 'the event must name the agent type the payload carried');
  assert.equal(event.session, traceSession, 'the event must be stamped with the session it was appended to');
  assert.equal(event.context.token_source, 'agent-transcript', 'the counts must come from the subagent\'s own transcript');
  assert.equal(event.context.input_tokens, EXPECTED_SLICE.input_tokens, 'input tokens must be the per-turn sum of the agent transcript');
  assert.equal(event.context.output_tokens, EXPECTED_SLICE.output_tokens, 'output tokens must count each turn once');
  assert.equal(event.context.cache_read_tokens, EXPECTED_SLICE.cache_read_tokens, 'cache reads must count each turn once');
  assert.equal(event.context.total_tokens, EXPECTED_SLICE.total_tokens, 'total tokens must be input + output');
  assert.equal(event.context.duration_ms, EXPECTED_SLICE.duration_ms, 'the duration must be the measured first→last span of the slice');
  assert.equal(event.context.model, EXPECTED_SLICE.model, 'the model must come from the transcript when the payload omits one');
  assert.equal(event.context.command, EXPECTED_SLICE.command, 'the command must be read off the parent transcript\'s typed invocation');
  assert.equal(event.context.agent_id, agentId, 'the event must persist the per-spawn id');
  assert.equal(event.context.clamped, false, 'a plausible slice must not be flagged as guarded');
  assert.equal(event.context.exit_code, 0, 'a stop with no exit code recorded is a clean finish');
}

function driveStopGuard(runtime) {
  const script = installedHook(runtime, 'pan-stop-guard.js');
  const project = armedStopProject(`stop-${runtime}`);
  const payload = substitute(fixture('stop-claude.json'), baseMap(project, `stop-${runtime}-0001`, path.join(project, 'transcript.jsonl')));

  const blocked = spawnHook(script, payload, project);
  assert.equal(blocked.status, 0, `the Stop guard must exit 0 on ${runtime}: ${blocked.stderr}`);
  assert.equal(blocked.stderr, '', 'the decision travels on stdout, never stderr');
  const decision = JSON.parse(blocked.stdout);
  assert.equal(decision.decision, 'block', 'the boundary-drop fingerprint must block the stop once');
  assert.match(decision.reason, /next: Phase 2\b/, 'the reason must name the phase the roadmap leaves unticked');
  assert.match(decision.reason, /pan-tools config-set workflow\.auto_advance false/, 'the reason must tell the user how to stop deliberately');

  // One-shot: the host sets stop_hook_active on the stop attempt that follows a block,
  // and the guard must always let that one through or the session is trapped.
  const allowed = spawnHook(script, { ...payload, stop_hook_active: true }, project);
  assert.equal(allowed.status, 0, `the Stop guard must exit 0 on a re-stop on ${runtime}: ${allowed.stderr}`);
  assert.equal(allowed.stdout, '', 'a stop attempt that follows a block must never be blocked again');
  assert.equal(allowed.stderr, '', 'the one-shot path is silent');

  // The escape hatch beats every arming signal.
  fs.writeFileSync(
    path.join(project, '.planning', 'config.json'),
    JSON.stringify({ workflow: { auto_advance: true, stop_guard: false } }),
    'utf-8',
  );
  const disarmed = spawnHook(script, payload, project);
  assert.equal(disarmed.status, 0, `the Stop guard must exit 0 when disarmed on ${runtime}: ${disarmed.stderr}`);
  assert.equal(disarmed.stdout, '', 'workflow.stop_guard false must disable the guard even with autonomy armed');
}

function driveStatusline(runtime) {
  const script = installedHook(runtime, 'pan-statusline.js');
  const project = planningProject(`statusline-${runtime}`);
  const tmpdir = mkTemp(`pan-slbridge-${runtime}-`);
  const sessionId = `statusline-${runtime}-0001`;
  const payload = substitute(fixture('statusline-claude.json'), baseMap(project, sessionId, path.join(project, 'transcript.jsonl')));

  withFakeHome(() => {
    const result = spawnHook(script, payload, project, tmpdirEnv(tmpdir));
    assert.equal(result.status, 0, `the statusline must exit 0 on ${runtime}: ${result.stderr}`);
    assert.equal(result.stderr, '', 'the statusline writes its line to stdout and nothing to stderr');
    // 28.5% remaining renders as 89% used: the bar is rescaled so 80% real usage shows
    // as 100%, and 8 of 10 cells are filled at 89%.
    assert.equal(
      stripAnsi(result.stdout),
      `Opus │ ${path.basename(project)} ████████░░ 89%`,
      'the line must carry the model, the project directory and the rescaled context bar',
    );

    const bridgeFile = path.join(bridgeDirIn(tmpdir), `claude-ctx-${sessionId}.json`);
    const bridge = JSON.parse(fs.readFileSync(bridgeFile, 'utf-8'));
    assert.equal(bridge.session_id, sessionId, 'the bridge record must name the session the monitor will look it up by');
    assert.equal(bridge.remaining_percentage, 28.5, 'the bridge must carry the RAW remaining percentage');
    assert.equal(bridge.used_pct, 89, 'the bridge must carry the rescaled used percentage the statusline displayed');
    assert.equal(typeof bridge.timestamp, 'number', 'the bridge record must be stamped so the monitor can ignore stale metrics');
  });
}

const DRIVERS = Object.freeze({
  'pan-check-update.js': {
    title: 'returns at once and leaves a resolvable update-check record',
    run: driveSessionStart,
  },
  'pan-context-monitor.js': {
    title: 'injects the CRITICAL warning the bridge file earns it',
    run: drivePostToolUse,
  },
  'pan-cost-logger.js': {
    title: 'books one ledger row measured from the subagent\'s own transcript',
    run: driveCostLogger,
  },
  'pan-trace-logger.js': {
    title: 'appends one completion event measured from the subagent\'s own transcript',
    run: driveTraceLogger,
  },
  'pan-stop-guard.js': {
    title: 'blocks the boundary drop once, then lets the stop through',
    run: driveStopGuard,
  },
  'pan-statusline.js': {
    title: 'renders the context bar and writes the bridge record the monitor reads',
    run: driveStatusline,
  },
});

// ─── The matrix ─────────────────────────────────────────────────────────────

describe('hook × runtime registration — the matrix this file must cover', () => {
  test('the registry\'s event-slot rows are exactly what HOOK_EVENT_MAP says', () => {
    const slotHooks = new Set(Object.values(EVENT_HOOKS).flat());
    const expected = [];
    for (const [runtime, spec] of Object.entries(HOOK_EVENT_MAP)) {
      if (!spec) continue;
      for (const [slot, hooks] of Object.entries(EVENT_HOOKS)) {
        if (!spec[slot]) continue;
        for (const hook of hooks) expected.push(`${runtime}/${hook} @${spec[slot]}`);
      }
    }
    const actual = REGISTERED.filter((row) => slotHooks.has(row.hook)).map((row) => `${row.runtime}/${row.hook} @${row.event}`);
    assert.deepEqual(actual.sort(), expected.sort(), 'the registry and HOOK_EVENT_MAP must name the same rows, with the same per-runtime event spelling');
  });

  test('what a real install registers is exactly what the registry claims', () => {
    // The registry's non-event rows (the statusline, the Stop guard) are hand-maintained
    // in scripts/test-surface.cjs, which is the weak point its own comment admits. This
    // is the loop closed from the other end: read the hook commands back out of the
    // config surface a real install writes, and require the registry to name every one
    // of them and no others. Copilot keeps its statusline in `.github/copilot/
    // settings.json` while its events live in `.github/hooks/pan.json`, so the walk
    // covers the whole config directory rather than a per-runtime file list.
    for (const runtime of Object.keys(RUNTIME_DIR)) {
      const claimed = REGISTERED.filter((row) => row.runtime === runtime).map((row) => row.hook).sort();
      const actual = registeredHooks(path.join(installs.get(runtime), RUNTIME_DIR[runtime]));
      assert.deepEqual(actual, claimed, `the ${runtime} install registers ${JSON.stringify(actual)}, the registry claims ${JSON.stringify(claimed)}`);
    }
  });

  test('every hook source in hooks/ reaches an install, and every one has a driver', () => {
    // scripts/build-hooks.js copies a hand-maintained HOOKS_TO_COPY list, so a new hook
    // source can be written, registered and never shipped. Compare the directory with
    // what a real install carries.
    for (const runtime of Object.keys(HOOK_EVENT_MAP)) {
      if (!HOOK_EVENT_MAP[runtime]) continue;
      const dir = path.join(installs.get(runtime), RUNTIME_DIR[runtime], 'hooks');
      const shipped = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
      assert.deepEqual(shipped, [...ALL_HOOKS], `the ${runtime} install must carry every hook source in hooks/`);
    }
    const undriven = ALL_HOOKS.filter((hook) => !DRIVERS[hook]);
    assert.deepEqual(undriven, [], 'a shipped hook with no driver here is a hook nothing spawns as a process');
  });

  test('every registered row has an e2e driver in this file', () => {
    const undriven = REGISTERED.filter((row) => !DRIVERS[row.hook]).map((row) => `${row.runtime}/${row.hook} (${row.event})`);
    assert.deepEqual(undriven, [], 'a hook × runtime row with no driver is a hook the host runs and nothing spawns');
  });

  test('OpenCode registers no hooks, and the installer places none', () => {
    assert.equal(HOOK_EVENT_MAP.opencode, null, 'OpenCode has no hook system — the map must say so');
    assert.deepEqual(REGISTERED.filter((row) => row.runtime === 'opencode'), [], 'no registry row may claim a hook on OpenCode');
    const configDir = path.join(installs.get('opencode'), RUNTIME_DIR.opencode);
    assert.equal(fs.existsSync(configDir), true, 'the OpenCode install must still produce its config directory');
    assert.equal(fs.existsSync(path.join(configDir, 'hooks')), false, 'an install with no hook system must not carry a hooks directory');
    const strays = findFiles(configDir, 'pan-cost-logger.js');
    assert.deepEqual(strays, [], 'no hook script may be installed for a runtime that cannot run one');
  });
});

for (const runtime of [...new Set(REGISTERED.map((row) => row.runtime))].sort()) {
  const rows = REGISTERED.filter((row) => row.runtime === runtime).sort((a, b) => a.hook.localeCompare(b.hook));
  describe(`hooks e2e — ${runtime} (${RUNTIME_DIR[runtime]})`, () => {
    for (const row of rows) {
      const driver = DRIVERS[row.hook];
      if (!driver) {
        test(`${row.event} — ${row.hook} has no e2e driver`, () => {
          assert.fail(`${row.hook} is registered on ${runtime} for ${row.event} but this file has no driver for it`);
        });
        continue;
      }
      test(`${row.event} — the installed ${row.hook} ${driver.title}`, () => driver.run(runtime, row));
    }
  });
}

// ─── Fail-open: a malformed payload must never block the agent loop ─────────

describe('hooks e2e — a malformed payload never blocks the agent loop', () => {
  for (const hookFile of ALL_HOOKS) {
    test(`${hookFile} exits 0 and writes nothing on invalid JSON and on empty stdin`, () => {
      const project = planningProject(`bad-${hookFile.replace(/\.js$/, '')}`);
      const tmpdir = mkTemp('pan-badbridge-');
      const script = installedHook('claude', hookFile);
      const env = { ...tmpdirEnv(tmpdir), ...noNpmEnv() };
      withFakeHome((home) => {
        for (const [label, input] of [['invalid JSON', '{ "hook_event_name": '], ['empty stdin', '']]) {
          const result = spawnScript(script, { input, cwd: project, env });
          assert.equal(result.status, 0, `${hookFile} must exit 0 on ${label}: ${result.stderr}`);
          assert.equal(result.stdout, '', `${hookFile} must write nothing to stdout on ${label}`);
          assert.equal(result.stderr, '', `${hookFile} must write nothing to stderr on ${label} — the host surfaces it as a failing hook`);
        }
        // The update check spawns its detached child whatever the payload said, so wait
        // for it before this fake home is torn down (see settleUpdateCheck).
        if (hookFile === 'pan-check-update.js') settleUpdateCheck(home);
      });
      assert.deepEqual(fs.readdirSync(path.join(project, '.planning')), [], `${hookFile} must leave the planning tree untouched on a malformed payload`);
    });
  }
});

// ─── The two hooks that share an artifact ───────────────────────────────────

describe('hooks e2e — the update-check record is the one the statusline reads', () => {
  test('a cache record written by pan-check-update.js raises the statusline\'s update badge', () => {
    const project = planningProject('badge');
    const tmpdir = mkTemp('pan-badgebridge-');
    const sessionId = 'badge-0001';
    const payload = substitute(fixture('statusline-claude.json'), baseMap(project, sessionId, path.join(project, 'transcript.jsonl')));

    withFakeHome((home) => {
      const check = spawnScript(installedHook('claude', 'pan-check-update.js'), {
        cwd: installs.get('claude'), args: ['--run-check'], env: noNpmEnv(),
      });
      assert.equal(check.status, 0, `--run-check must exit 0: ${check.stderr}`);
      const records = findFiles(home, 'pan-update-check.json');
      assert.equal(records.length, 1, `the update check must write exactly one record, found ${JSON.stringify(records)}`);

      // The statusline reads the same file from its own path expression, so rewriting
      // this record in place is what proves the two installed copies agree on it.
      const record = JSON.parse(fs.readFileSync(records[0], 'utf-8'));
      assert.equal(record.update_available, false, 'the record starts with no update claimed');
      fs.writeFileSync(records[0], JSON.stringify({ ...record, update_available: true, latest: '99.0.0' }), 'utf-8');

      const line = stripAnsi(spawnHook(installedHook('claude', 'pan-statusline.js'), payload, project, tmpdirEnv(tmpdir)).stdout);
      assert.equal(
        line,
        `⬆ /pan:update │ Opus │ ${path.basename(project)} ████████░░ 89%`,
        'the statusline must read the update flag out of the record pan-check-update.js wrote',
      );
    });
  });
});

// ─── Fixture provenance (spec §3.3 test-plan item 9) ────────────────────────

describe('hook payload fixtures carry their provenance', () => {
  test('every committed fixture has a sibling .meta.json with a non-empty captured_from', () => {
    assert.deepEqual(lintFixtureProvenance(FIXTURE_DIR), [], 'a payload fixture without provenance is an invented shape');
  });

  test('a fixture whose .meta.json is missing or empty fails the lint', () => {
    const dir = mkTemp('pan-fixlint-');
    fs.writeFileSync(path.join(dir, 'made-up-event.json'), JSON.stringify({ hook_event_name: 'MadeUp' }), 'utf-8');
    const missing = lintFixtureProvenance(dir);
    assert.deepEqual(missing, [
      'made-up-event.json: no sibling made-up-event.meta.json — a fixture without provenance is an invented shape',
    ], 'a fixture with no meta must be reported by name');

    // A meta that exists but says nothing is the same failure wearing a file.
    fs.writeFileSync(path.join(dir, 'made-up-event.meta.json'), JSON.stringify({
      hook_event: 'MadeUp', runtime: 'claude', captured_at: '2026-09-17', captured_from: '   ', notes: 'none',
    }), 'utf-8');
    assert.deepEqual(lintFixtureProvenance(dir), [
      'made-up-event.meta.json: captured_from is missing or empty',
    ], 'a blank captured_from must be reported as missing');

    // And it passes once the provenance is real.
    fs.writeFileSync(path.join(dir, 'made-up-event.meta.json'), JSON.stringify({
      hook_event: 'MadeUp', runtime: 'claude', captured_at: '2026-09-17',
      captured_from: 'derived from the fields the hook reads', notes: 'synthetic values',
    }), 'utf-8');
    assert.deepEqual(lintFixtureProvenance(dir), [], 'a fixture with complete provenance must pass');
  });

  test('every placeholder a fixture uses is documented in its meta', () => {
    const undocumented = [];
    for (const name of fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))) {
      const meta = fixture(`${name.replace(/\.json$/, '')}.meta.json`);
      const declared = new Set(Object.keys(meta.placeholders || {}));
      for (const token of placeholdersIn(fixture(name))) {
        if (!declared.has(token)) undocumented.push(`${name}: ${token}`);
      }
    }
    assert.deepEqual(undocumented, [], 'a placeholder the test substitutes must be explained in the fixture\'s provenance');
  });

  test('every fixture names a hook event this suite drives, and a runtime that exists', () => {
    const events = new Set(REGISTERED.map((row) => row.event));
    const runtimes = new Set(Object.keys(RUNTIME_DIR));
    const problems = [];
    for (const name of fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.meta.json'))) {
      const meta = fixture(name);
      if (!events.has(meta.hook_event)) problems.push(`${name}: hook_event ${meta.hook_event} is not a registered hook event`);
      if (!runtimes.has(meta.runtime)) problems.push(`${name}: runtime ${meta.runtime} is not one PAN installs into`);
    }
    assert.deepEqual(problems, [], 'a fixture must name an event and a runtime the code knows');
  });
});
