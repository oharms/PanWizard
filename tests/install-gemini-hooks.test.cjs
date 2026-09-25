/**
 * Gemini hook + experimental-agents registration after a real local install.
 *
 * Audit HIGH (spec docs/specs/testing-system-redesign-2026-09.md §3.2 item 7):
 * the only assertion the suite once made about Gemini's emitted settings.json was
 * `assert.ok(settings.env || settings.customInstructions || settings.hooks)`,
 * which an empty `hooks: {}` satisfies.
 *
 * Reality check 2026-09-22 (R29): the file that replaced it then pinned the WRONG
 * contract. It asserted Claude's event names — PostToolUse, SubagentStop, Stop —
 * because that is what the installer wrote. Gemini CLI's event vocabulary is its
 * own (packages/core/src/hooks/types.ts `HookEventName`: BeforeTool, AfterTool,
 * BeforeAgent, AfterAgent, SessionStart, SessionEnd, PreCompress, BeforeModel,
 * AfterModel, BeforeToolSelection, Notification), and its hook registry skips any
 * other key with an "Invalid hook event name" warning. So a test derived from the
 * installer's own output agreed with the installer, and three of PAN's four Gemini
 * registrations had never run. What is pinned now:
 *   - SessionStart runs the update check; AfterAgent (Gemini's end of turn, which
 *     re-prompts on a block exactly like Claude's Stop) runs the stop guard;
 *   - the context monitor and the two loggers are NOT registered — no Gemini hook
 *     payload carries context usage, and there is no subagent-completion event;
 *   - no statusLine block (Gemini CLI has no statusline command);
 *   - an upgrade over an older install removes the dead keys it left.
 * Every event key is also checked against the vocabulary fixture by
 * tests/hook-vocabulary.test.cjs; this file pins the registrations themselves.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../bin/install-lib.cjs');
const { installInto, cleanup, RUNTIME_DIR } = require('./helpers.cjs');

const GEMINI_DIR = RUNTIME_DIR.gemini;
const EVENTS = lib.HOOK_EVENT_MAP.gemini;

/** Every command string registered on one Claude-shaped event array. */
function commandsFor(settings, event) {
  const entries = settings.hooks && settings.hooks[event];
  assert.ok(Array.isArray(entries), `settings.hooks.${event} should be an array of hook entries`);
  const commands = [];
  for (const entry of entries) {
    assert.ok(Array.isArray(entry.hooks), `each ${event} entry wraps a hooks[] array`);
    for (const h of entry.hooks) {
      assert.equal(h.type, 'command', `${event}: PAN registers command hooks`);
      commands.push(h.command);
    }
  }
  return commands;
}

/** The hook file a registered command names, resolved against the project root. */
function resolveHookFile(projectDir, command) {
  const m = /^node\s+(\S+)$/.exec(command);
  assert.ok(m, `a registered command should be "node <path>", got: ${command}`);
  return path.resolve(projectDir, m[1]);
}

function freshProject(label) {
  // macOS: os.tmpdir() is a symlink (/var → /private/var) and the installer records the
  // RESOLVED path, so the root is resolved here — otherwise every path comparison below
  // passes on Linux and Windows and fails on macOS.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `pan-gemini-hooks-${label}-`)));
}

describe('Gemini hook registration after a local --gemini install', () => {
  let projectDir;
  let settings;
  let output;

  before(() => {
    projectDir = freshProject('fresh');
    const r = installInto(projectDir, ['--gemini', '--local', '--skip-warnings']);
    if (!r.success) throw new Error(`gemini install failed: ${r.error || r.output}`);
    output = String(r.output || '').replace(/\u001b\[[0-9;]*m/g, '');
    settings = JSON.parse(fs.readFileSync(path.join(projectDir, GEMINI_DIR, 'settings.json'), 'utf8'));
  });

  after(() => { if (projectDir) cleanup(projectDir); });

  test('the event table uses Gemini\'s own vocabulary, with null where Gemini has nothing to run', () => {
    // Not decoration: the assertions below read their event names from this table,
    // so an emptied or renamed table must not silently make them vacuous.
    assert.equal(EVENTS.surface, 'settings.json', 'Gemini registers hooks in its settings.json');
    assert.deepEqual(
      { sessionStart: EVENTS.sessionStart, postToolUse: EVENTS.postToolUse, subagentStop: EVENTS.subagentStop, stop: EVENTS.stop },
      { sessionStart: 'SessionStart', postToolUse: null, subagentStop: null, stop: 'AfterAgent' });
  });

  test('SessionStart carries only the update check, resolving to an installed hook file', () => {
    const commands = commandsFor(settings, EVENTS.sessionStart);
    assert.deepEqual(commands, [`node ${GEMINI_DIR}/hooks/pan-check-update.js`]);
    assert.equal(fs.existsSync(resolveHookFile(projectDir, commands[0])), true, 'the registered update check must exist');
  });

  test('AfterAgent carries only the auto-advance stop guard, resolving to an installed hook file', () => {
    // Gemini's end-of-turn event: a {decision: "block"} re-prompts the agent with
    // the reason, which is the contract P-1809's guard was written against.
    const commands = commandsFor(settings, EVENTS.stop);
    assert.deepEqual(commands, [`node ${GEMINI_DIR}/hooks/pan-stop-guard.js`]);
    assert.equal(fs.existsSync(resolveHookFile(projectDir, commands[0])), true, 'the registered stop guard must exist');
  });

  test('exactly the two supported events are written — no Claude-named key Gemini would skip', () => {
    assert.deepEqual(Object.keys(settings.hooks).sort(), ['AfterAgent', 'SessionStart']);
    for (const dead of ['PostToolUse', 'SubagentStop', 'Stop']) {
      assert.equal(settings.hooks[dead], undefined, `${dead} is not a Gemini event and must not be written`);
    }
  });

  test('the installer says which hooks Gemini cannot run, instead of claiming it configured them', () => {
    assert.match(output, /Gemini CLI has no context-window metric for hooks and no subagent-completion event, so pan-context-monitor, pan-cost-logger, pan-trace-logger are not registered there/);
    assert.doesNotMatch(output, /Configured context window monitor hook/);
    assert.doesNotMatch(output, /Configured cost logger hook/);
  });

  test('no statusLine block — Gemini CLI has no statusline command', () => {
    assert.equal(settings.statusLine, undefined);
    assert.doesNotMatch(output, /Configured statusline/);
  });

  test('experimental.enableAgents is true — without it Gemini loads none of PAN\'s sub-agents', () => {
    assert.ok(settings.experimental, 'settings.json should carry an experimental block');
    assert.equal(settings.experimental.enableAgents, true, 'experimental.enableAgents must be exactly true');
    assert.match(output, /Enabled experimental agents/, 'the installer should report enabling it');
    // The flag is worthless if the agents it unlocks were not installed.
    const agentsDir = path.join(projectDir, GEMINI_DIR, 'agents');
    const agents = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    assert.ok(agents.length > 0, 'enableAgents is set, so agent definitions must have been installed');
  });

  test('every registered command in the file points at a PAN hook file that exists', () => {
    const all = Object.keys(settings.hooks).flatMap((event) => commandsFor(settings, event));
    assert.equal(all.length, 2, `expected the two Gemini registrations, got ${all.length}`);
    for (const command of all) {
      assert.equal(fs.existsSync(resolveHookFile(projectDir, command)), true, `dead hook registration: ${command}`);
      assert.ok(path.basename(resolveHookFile(projectDir, command)).startsWith('pan-'),
        `PAN should only register its own hooks, saw: ${command}`);
    }
  });
});

describe('Gemini: reinstalling over an install that wrote Claude-named hooks and a statusline', () => {
  let projectDir;
  let settings;
  let output;

  before(() => {
    projectDir = freshProject('upgrade');
    const geminiDir = path.join(projectDir, GEMINI_DIR);
    fs.mkdirSync(geminiDir, { recursive: true });
    const hook = (name) => ({ hooks: [{ type: 'command', command: `node ${GEMINI_DIR}/hooks/${name}` }] });
    // Exactly what PAN wrote before R29, plus a user's own hook and setting that
    // must survive the migration.
    fs.writeFileSync(path.join(geminiDir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [hook('pan-check-update.js')],
        PostToolUse: [hook('pan-context-monitor.js')],
        SubagentStop: [hook('pan-cost-logger.js'), hook('pan-trace-logger.js')],
        Stop: [hook('pan-stop-guard.js')],
        BeforeTool: [{ matcher: 'run_shell_command', hooks: [{ type: 'command', command: 'node my-own-guard.js' }] }],
      },
      statusLine: { type: 'command', command: `node ${GEMINI_DIR}/hooks/pan-statusline.js` },
      ui: { theme: 'mine' },
    }, null, 2));
    const r = installInto(projectDir, ['--gemini', '--local', '--skip-warnings']);
    if (!r.success) throw new Error(`gemini upgrade install failed: ${r.error || r.output}`);
    output = String(r.output || '').replace(/\u001b\[[0-9;]*m/g, '');
    settings = JSON.parse(fs.readFileSync(path.join(geminiDir, 'settings.json'), 'utf8'));
  });

  after(() => { if (projectDir) cleanup(projectDir); });

  test('the dead keys are gone and the stop guard now sits under AfterAgent', () => {
    for (const dead of ['PostToolUse', 'SubagentStop', 'Stop']) {
      assert.equal(settings.hooks[dead], undefined, `${dead} must be removed on upgrade`);
    }
    assert.deepEqual(commandsFor(settings, 'AfterAgent'), [`node ${GEMINI_DIR}/hooks/pan-stop-guard.js`]);
    assert.deepEqual(commandsFor(settings, 'SessionStart'), [`node ${GEMINI_DIR}/hooks/pan-check-update.js`],
      'the update check is kept once, not duplicated');
  });

  test('the user\'s own hook and settings survive, and PAN\'s statusline block is removed', () => {
    assert.deepEqual(commandsFor(settings, 'BeforeTool'), ['node my-own-guard.js']);
    assert.equal(settings.hooks.BeforeTool[0].matcher, 'run_shell_command');
    assert.deepEqual(settings.ui, { theme: 'mine' });
    assert.equal(settings.statusLine, undefined);
  });

  test('the install reports each move, so the user can see why the file changed', () => {
    assert.match(output, /Removed the auto-advance stop guard hook from Stop/);
    assert.match(output, /Removed the context window monitor hook from PostToolUse \(gemini has no event for it\)/);
    assert.match(output, /Removed the cost logger hook from SubagentStop \(gemini has no event for it\)/);
    assert.match(output, /Removed the statusline block from Gemini settings/);
  });
});

describe('Gemini: uninstall removes the AfterAgent stop guard too', () => {
  let projectDir;

  before(() => {
    projectDir = freshProject('uninstall');
    let r = installInto(projectDir, ['--gemini', '--local', '--skip-warnings']);
    if (!r.success) throw new Error(`gemini install failed: ${r.error || r.output}`);
    r = installInto(projectDir, ['--gemini', '--local', '--uninstall']);
    if (!r.success) throw new Error(`gemini uninstall failed: ${r.error || r.output}`);
  });

  after(() => { if (projectDir) cleanup(projectDir); });

  test('no PAN hook remains under any event', () => {
    const settingsPath = path.join(projectDir, GEMINI_DIR, 'settings.json');
    const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
    const flat = JSON.stringify(settings.hooks || {});
    for (const name of lib.PAN_SETTINGS_HOOKS) {
      assert.ok(!flat.includes(name), `${name} must be stripped on uninstall, found in: ${flat}`);
    }
  });
});
