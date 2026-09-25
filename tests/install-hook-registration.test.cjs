/**
 * Hook registration, driven from HOOK_EVENT_MAP, for every runtime that has one.
 *
 * Audit HIGH (spec docs/specs/testing-system-redesign-2026-09.md §3.2 item 8):
 * tests/scenarios/hook-registration.test.cjs checks a hand-written
 * EXPECTED_HOOKS of three files (check-update, context-monitor, statusline) for
 * two runtimes. PAN ships six hooks across four registering runtimes, and the
 * SubagentStop pair in particular is pushed by two independent blocks in the
 * installer — so the trace logger could go missing while the cost logger stayed,
 * and no test would notice.
 *
 * Everything here is generated from the code's own table:
 *   - bin/install-lib.cjs HOOK_EVENT_MAP — runtime → event names + surface file
 *     (`opencode: null` means "no hook system", which is asserted as such)
 *   - scripts/test-surface.cjs hookMatrix() — that table crossed with the hooks
 *     PAN registers per event, plus the Stop/statusLine rows the table predates
 *
 * A new runtime, a new event, a renamed surface file or a new hook in hooks/
 * therefore fails this file until the install actually carries it.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../bin/install-lib.cjs');
const { hookMatrix } = require('../scripts/test-surface.cjs');
const { installInto, cleanup, RUNTIME_DIR } = require('./helpers.cjs');

const ROWS = hookMatrix(lib.HOOK_EVENT_MAP);
const WITH_HOOKS = [...new Set(ROWS.map((r) => r.runtime))].sort();
const WITHOUT_HOOKS = Object.keys(lib.HOOK_EVENT_MAP).filter((rt) => !lib.HOOK_EVENT_MAP[rt]);
/** The hooks PAN ships, from the source directory — not from a literal list. */
const SHIPPED_HOOKS = fs.readdirSync(path.join(__dirname, '..', 'hooks')).filter((f) => f.endsWith('.js')).sort();

/**
 * Where a registration lives. Defaults to the runtime's hook surface from the table, but
 * a row may name its own: Copilot keeps its hooks in `hooks/pan.json` and its statusline
 * in `copilot/settings.json`, so one file per runtime is not enough.
 */
function surfaceFile(projectDir, runtime, surface) {
  return path.join(projectDir, RUNTIME_DIR[runtime], surface || lib.HOOK_EVENT_MAP[runtime].surface);
}

/** The parsed config a given row's registration should be found in. */
function configForRow(projectDir, row, byRuntime) {
  if (!row.surface || row.surface === lib.HOOK_EVENT_MAP[row.runtime].surface) return byRuntime[row.runtime];
  const file = surfaceFile(projectDir, row.runtime, row.surface);
  assert.equal(fs.existsSync(file), true, `${row.runtime}: ${row.hook} should be registered in ${file}, which does not exist`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The hook handlers registered on one event, normalised across the two schemas:
 * Claude/Gemini/Codex nest `[{ hooks: [{type, command}] }]`; Copilot's
 * version-1 schema is FLAT — `[{type, command}]`. Writing the nested shape into
 * Copilot's file (or the reverse) produces a config that parses and is ignored.
 */
function handlersOn(config, runtime, event) {
  const entries = (config.hooks || {})[event];
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    if (runtime === 'copilot') {
      assert.equal(entry.hooks, undefined, `copilot's schema is flat — ${event} must not nest a hooks[] array`);
      out.push(entry);
    } else {
      assert.ok(Array.isArray(entry.hooks), `${runtime}: ${event} entries wrap a hooks[] array`);
      out.push(...entry.hooks);
    }
  }
  return out;
}

/** Every registered handler in a runtime's surface file, including the statusline. */
function allHandlers(config, runtime) {
  const out = Object.keys(config.hooks || {}).flatMap((event) => handlersOn(config, runtime, event).map((h) => ({ ...h, event })));
  if (config.statusLine && config.statusLine.command) out.push({ ...config.statusLine, event: 'statusLine' });
  return out;
}

/** The file a `node <path>` command names, resolved against the project root. */
function hookFileOf(projectDir, command) {
  const m = /^node\s+(\S+)$/.exec(String(command));
  assert.ok(m, `a registered command should be "node <path>", got: ${command}`);
  return path.resolve(projectDir, m[1]);
}

describe('hook registration across every runtime in HOOK_EVENT_MAP', () => {
  let projectDir;
  const config = {}; // runtime → parsed surface file

  before(() => {
    // macOS: os.tmpdir() is a symlink (/var → /private/var) and the installer records the
    // RESOLVED path, so the root is resolved here — otherwise every path comparison below
    // passes on Linux and Windows and fails on macOS.
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-hookreg-')));
    const r = installInto(projectDir, ['--claude', '--codex', '--gemini', '--opencode', '--copilot', '--local', '--skip-warnings']);
    if (!r.success) throw new Error(`five-runtime install failed: ${r.error || r.output}`);
    for (const runtime of WITH_HOOKS) {
      const file = surfaceFile(projectDir, runtime);
      config[runtime] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    }
  });

  after(() => { if (projectDir) cleanup(projectDir); });

  test('the table this file is generated from is the expected shape (guards against a vacuous run)', () => {
    assert.deepEqual(WITH_HOOKS, ['claude', 'codex', 'copilot', 'gemini'],
      'four runtimes register hooks; a fifth must be added to the table AND to the installer');
    assert.deepEqual(WITHOUT_HOOKS, ['opencode'], 'OpenCode is the only runtime with no hook system');
    // claude: SessionStart + PostToolUse + 2 x SubagentStop + Stop + statusline;
    // codex: the four event rows; copilot: the four + statusline; gemini (R29):
    // SessionStart + AfterAgent only — Gemini has no event the context monitor or
    // the loggers could run on, and no statusline command.
    assert.equal(ROWS.length, 17, `expected 17 runtime x hook rows, got ${ROWS.length}: ${ROWS.map((r) => `${r.runtime}/${r.hook}`).join(', ')}`);
    for (const runtime of WITH_HOOKS) {
      const spec = lib.HOOK_EVENT_MAP[runtime];
      assert.ok(spec.sessionStart, `${runtime}: every hook runtime runs the update check at session start`);
      for (const slot of ['postToolUse', 'subagentStop', 'stop']) {
        assert.ok(typeof spec[slot] === 'string' || spec[slot] === null,
          `${runtime}.${slot} must name an event or be null (a deliberate "not on this runtime"), got ${spec[slot]}`);
      }
      assert.ok(spec.surface, `${runtime}: the table must name the file the registrations go in`);
    }
  });

  for (const runtime of WITH_HOOKS) {
    test(`${runtime}: the registration surface exists at the documented path (${lib.HOOK_EVENT_MAP[runtime].surface})`, () => {
      const file = surfaceFile(projectDir, runtime);
      assert.equal(fs.existsSync(file), true, `${runtime}: nothing written at ${file}`);
      assert.ok(config[runtime], `${runtime}: surface file is not parseable JSON`);
      assert.ok(config[runtime].hooks, `${runtime}: surface file carries no hooks block`);
    });
  }

  for (const row of ROWS) {
    test(`${row.runtime}: ${row.hook} is registered on ${row.event}, pointing at an installed file`, () => {
      const cfg = configForRow(projectDir, row, config);
      assert.ok(cfg, `${row.runtime}: no parsed surface file`);
      const handlers = row.event === 'statusLine'
        ? (cfg.statusLine ? [cfg.statusLine] : [])
        : handlersOn(cfg, row.runtime, row.event);
      const marker = row.hook.replace(/\.js$/, '');
      const mine = handlers.filter((h) => String(h.command).includes(marker));
      assert.equal(mine.length, 1,
        `${row.runtime}: ${marker} should be registered exactly once on ${row.event}, found ${mine.length} among [${handlers.map((h) => h.command).join(' | ')}]`);
      assert.equal(mine[0].type, 'command', `${row.runtime}: ${row.hook} must be a command hook`);
      assert.equal(mine[0].command, `node ${RUNTIME_DIR[row.runtime]}/hooks/${row.hook}`,
        `${row.runtime}: a local install registers the hook by project-relative path into its own dir`);
      const file = hookFileOf(projectDir, mine[0].command);
      assert.equal(fs.existsSync(file), true,
        `${row.runtime}: ${row.hook} is registered on ${row.event} but the file does not exist — ${file}`);
    });
  }

  for (const runtime of WITH_HOOKS.filter((rt) => lib.HOOK_EVENT_MAP[rt].subagentStop)) {
    test(`${runtime}: ${lib.HOOK_EVENT_MAP[runtime].subagentStop} carries BOTH loggers`, () => {
      // THE known gap. The cost logger and the trace logger are appended by two
      // separate blocks in bin/install.js (and two rows of the Codex/Copilot
      // builders), so one can be dropped while the other stays — leaving either
      // no ledger rows or no optimisation trace, with nothing failing.
      const event = lib.HOOK_EVENT_MAP[runtime].subagentStop;
      const commands = handlersOn(config[runtime], runtime, event).map((h) => h.command);
      assert.equal(commands.filter((c) => c.includes('pan-cost-logger')).length, 1,
        `${runtime}: ${event} must register the cost logger exactly once, saw [${commands.join(' | ')}]`);
      assert.equal(commands.filter((c) => c.includes('pan-trace-logger')).length, 1,
        `${runtime}: ${event} must register the trace logger exactly once, saw [${commands.join(' | ')}]`);
      for (const c of commands) {
        assert.equal(fs.existsSync(hookFileOf(projectDir, c)), true, `${runtime}: ${event} points at a missing file — ${c}`);
      }
    });
  }

  for (const runtime of WITH_HOOKS.filter((rt) => !lib.HOOK_EVENT_MAP[rt].subagentStop)) {
    test(`${runtime}: no subagent-completion event, so neither logger is registered anywhere`, () => {
      // Gemini (R29): registering the loggers under an event it does not have is
      // what left them dead from v3.4 on — the honest registration is none.
      const commands = allHandlers(config[runtime], runtime).map((h) => String(h.command));
      for (const logger of ['pan-cost-logger', 'pan-trace-logger']) {
        assert.equal(commands.filter((c) => c.includes(logger)).length, 0,
          `${runtime}: ${logger} must not be registered, saw [${commands.join(' | ')}]`);
      }
    });
  }

  test('every hook PAN ships is registered by at least one runtime', () => {
    // Driven from hooks/ on disk: a seventh hook that nothing registers fails
    // here, which is the failure the old three-name EXPECTED_HOOKS could not see.
    const registered = new Set();
    for (const runtime of WITH_HOOKS) {
      for (const h of allHandlers(config[runtime], runtime)) registered.add(path.basename(hookFileOf(projectDir, h.command)));
    }
    assert.deepEqual([...registered].sort(), SHIPPED_HOOKS,
      `every shipped hook must be registered somewhere — shipped [${SHIPPED_HOOKS.join(', ')}], registered [${[...registered].sort().join(', ')}]`);
  });

  test('every runtime with hooks gets all six hook files copied into its own dir', () => {
    for (const runtime of WITH_HOOKS) {
      const dir = path.join(projectDir, RUNTIME_DIR[runtime], 'hooks');
      const present = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
      assert.deepEqual(present, SHIPPED_HOOKS, `${runtime}: hooks/ should hold every shipped hook`);
    }
  });

  test('the emitted registrations are EXACTLY the mapped rows, and every one resolves to an installed pan hook', () => {
    // The catch-all, in both directions: a registration the rows above do not name shows
    // up here as an extra, and a row the installer stopped writing shows up as a missing
    // one. Scoped to the rows that live in the runtime's own hook surface, because that is
    // what this scan reads; a row naming a different file (Copilot's statusline, in
    // copilot/settings.json) is asserted in its own test below. The registry carries the
    // Gemini and Copilot statuslines as of 2026-09-17 — they were missing from
    // EXTRA_HOOK_ROWS while the installer had been emitting both.
    const found = [];
    for (const runtime of WITH_HOOKS) {
      for (const h of allHandlers(config[runtime], runtime)) {
        const file = hookFileOf(projectDir, h.command);
        assert.equal(fs.existsSync(file), true, `${runtime}/${h.event}: dead hook registration — ${h.command}`);
        assert.ok(path.basename(file).startsWith('pan-'), `${runtime}/${h.event}: PAN should register only its own hooks — ${h.command}`);
        assert.equal(path.dirname(file), path.join(projectDir, RUNTIME_DIR[runtime], 'hooks'),
          `${runtime}/${h.event}: must run its OWN installed copy, not another runtime's — ${h.command}`);
        found.push(`${runtime}/${h.event}/${path.basename(file)}`);
      }
    }
    const inRuntimeSurface = (r) => !r.surface || r.surface === lib.HOOK_EVENT_MAP[r.runtime].surface;
    const expected = ROWS.filter(inRuntimeSurface).map((r) => `${r.runtime}/${r.event}/${r.hook}`).sort();
    assert.deepEqual(found.sort(), expected, 'the emitted hook registrations drifted from the mapped surface');
    // The rows this scan cannot see must be few and named, not silently skipped.
    assert.deepEqual(ROWS.filter((r) => !inRuntimeSurface(r)).map((r) => `${r.runtime}/${r.event}/${r.hook}`),
      ['copilot/statusLine/pan-statusline.js'],
      'a registration outside its runtime hook surface needs its own assertion');
  });

  test('copilot registers its statusline in the settings file it reads, not in its hooks file', () => {
    // Copilot's hook surface (.github/hooks/pan.json, version-1 schema) has no
    // statusline slot; the documented read path is .github/copilot/settings.json
    // for a repo-level install. Registering it in the hooks file instead would
    // parse and be ignored.
    assert.equal(config.copilot.statusLine, undefined, 'the hooks file has no statusline slot');
    const settingsPath = path.join(projectDir, RUNTIME_DIR.copilot, 'copilot', 'settings.json');
    assert.equal(fs.existsSync(settingsPath), true, `copilot settings.json missing at ${settingsPath}`);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine.type, 'command', 'the statusline is a command hook');
    assert.equal(settings.statusLine.command, `node ${RUNTIME_DIR.copilot}/hooks/pan-statusline.js`, 'copilot statusline command');
    assert.equal(fs.existsSync(hookFileOf(projectDir, settings.statusLine.command)), true,
      'the registered copilot statusline file must exist');
  });

  test('codex marks the silent observers async and keeps the context monitor synchronous', () => {
    // An async Codex handler runs off the critical path and cannot inject
    // context. The context monitor returns additionalContext the model must see
    // THIS turn, so it must stay synchronous; the loggers and the update check
    // print nothing, so they must not block the agent.
    const spec = lib.HOOK_EVENT_MAP.codex;
    const flag = (event, marker) => {
      const h = handlersOn(config.codex, 'codex', event).find((x) => x.command.includes(marker));
      assert.ok(h, `codex: ${marker} should be registered on ${event}`);
      return h.async;
    };
    assert.equal(flag(spec.sessionStart, 'pan-check-update'), true, 'the update check prints nothing — it must be async');
    assert.equal(flag(spec.subagentStop, 'pan-cost-logger'), true, 'the cost logger only appends a ledger row — it must be async');
    assert.equal(flag(spec.subagentStop, 'pan-trace-logger'), true, 'the trace logger only appends a trace event — it must be async');
    assert.equal(flag(spec.postToolUse, 'pan-context-monitor'), undefined,
      'the context monitor injects context the model must read this turn — it must NOT be async');
  });

  for (const runtime of WITHOUT_HOOKS) {
    test(`${runtime}: HOOK_EVENT_MAP says no hook system, and the install registers nothing`, () => {
      const dir = path.join(projectDir, RUNTIME_DIR[runtime]);
      assert.equal(fs.existsSync(dir), true, `${runtime}: precondition — the runtime was installed`);
      assert.equal(fs.existsSync(path.join(dir, 'hooks')), false, `${runtime}: no hooks directory should be installed`);
      assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false, `${runtime}: PAN writes no settings.json here`);
      // Its config file IS written (for MCP + permissions) — it just must carry
      // no hook registrations.
      const own = JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'));
      assert.equal(own.hooks, undefined, `${runtime}: opencode.json must carry no hooks block`);
      assert.equal(/pan-(?:check-update|context-monitor|cost-logger|trace-logger|stop-guard|statusline)/.test(JSON.stringify(own)), false,
        `${runtime}: no hook command should appear anywhere in its config`);
    });
  }
});
