/**
 * Gemini hook + experimental-agents registration after a real local install.
 *
 * Audit HIGH (spec docs/specs/testing-system-redesign-2026-09.md §3.2 item 7):
 * the only assertion the suite made about Gemini's emitted settings.json was
 *
 *     assert.ok(settings.env || settings.customInstructions || settings.hooks)
 *
 * which an empty `hooks: {}` satisfies, and which says nothing at all about
 * WHICH hooks landed. `experimental.enableAgents` — without which Gemini CLI
 * does not load PAN's sub-agents, so every delegated command silently runs
 * inline — had no test whatsoever.
 *
 * Here each event array is named from HOOK_EVENT_MAP.gemini (so renaming an
 * event in the table without changing the installer fails this file) and
 * asserted to carry the pan-* command for that event, with the command string
 * resolved back to a hook file that exists in the install.
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

/**
 * Which hook PAN registers on each canonical event slot. The slot names are the
 * table's; the hook file names are the installer's (bin/install.js builds one
 * command per hook and pushes it onto the event array).
 */
const HOOK_FOR_SLOT = Object.freeze({
  sessionStart: ['pan-check-update.js'],
  postToolUse: ['pan-context-monitor.js'],
  subagentStop: ['pan-cost-logger.js', 'pan-trace-logger.js'],
});

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

describe('Gemini hook registration after a local --gemini install', () => {
  let projectDir;
  let settings;
  let output;

  before(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gemini-hooks-'));
    const r = installInto(projectDir, ['--gemini', '--local', '--skip-warnings']);
    if (!r.success) throw new Error(`gemini install failed: ${r.error || r.output}`);
    output = String(r.output || '').replace(/\u001b\[[0-9;]*m/g, '');
    settings = JSON.parse(fs.readFileSync(path.join(projectDir, GEMINI_DIR, 'settings.json'), 'utf8'));
  });

  after(() => { if (projectDir) cleanup(projectDir); });

  test('the event table names the three canonical events in Gemini settings.json', () => {
    // Not decoration: the loops below are generated from these names, so an
    // emptied or renamed table must not silently make them vacuous.
    assert.equal(EVENTS.surface, 'settings.json', 'Gemini registers hooks in its settings.json');
    assert.deepEqual(
      { sessionStart: EVENTS.sessionStart, postToolUse: EVENTS.postToolUse, subagentStop: EVENTS.subagentStop },
      { sessionStart: 'SessionStart', postToolUse: 'PostToolUse', subagentStop: 'SubagentStop' },
      'Gemini uses the Claude-compatible PascalCase event names');
  });

  for (const [slot, hooks] of Object.entries(HOOK_FOR_SLOT)) {
    test(`${EVENTS[slot]} carries ${hooks.join(' + ')}, each resolving to an installed hook file`, () => {
      const event = EVENTS[slot];
      const commands = commandsFor(settings, event);
      for (const hook of hooks) {
        const match = commands.filter((c) => c.includes(hook));
        assert.equal(match.length, 1, `${event} should register ${hook} exactly once, found ${match.length} of ${commands.length} commands: ${commands.join(' | ')}`);
        assert.equal(match[0], `node ${GEMINI_DIR}/hooks/${hook}`,
          `${event}: a local install registers the hook by project-relative path`);
        const file = resolveHookFile(projectDir, match[0]);
        assert.equal(fs.existsSync(file), true, `${event}: ${hook} is registered but the file does not exist — ${file}`);
      }
      // Nothing foreign, and nothing extra, on an event PAN owns end to end.
      assert.equal(commands.length, hooks.length,
        `${event} should carry exactly ${hooks.length} command(s), got: ${commands.join(' | ')}`);
    });
  }

  test('SubagentStop carries BOTH loggers, in separate entries', () => {
    // The pair is the known gap: the cost logger and the trace logger are pushed
    // by two independent blocks in the installer, so one can go missing without
    // the other. Each one is its own matcher entry rather than two commands in
    // one, which is what lets a host run them independently.
    const event = EVENTS.subagentStop;
    const commands = commandsFor(settings, event);
    assert.equal(commands.some((c) => c.includes('pan-cost-logger')), true, `${event} is missing the cost logger`);
    assert.equal(commands.some((c) => c.includes('pan-trace-logger')), true, `${event} is missing the trace logger`);
    assert.equal(settings.hooks[event].length, 2, `${event} should hold two hook entries, one per logger`);
  });

  test('the Stop event carries the auto-advance stop guard', () => {
    // Not in HOOK_EVENT_MAP (the table covers the three cross-runtime events);
    // the installer registers it for Claude and Gemini only, and P-1809 exists
    // because the phase boundary was being dropped without it.
    const commands = commandsFor(settings, 'Stop');
    assert.deepEqual(commands, [`node ${GEMINI_DIR}/hooks/pan-stop-guard.js`], 'Stop should register only the stop guard');
    assert.equal(fs.existsSync(resolveHookFile(projectDir, commands[0])), true, 'the registered stop guard file must exist');
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

  test('the statusline is registered and points at an installed hook', () => {
    assert.equal(settings.statusLine.type, 'command', 'the statusline is a command hook');
    assert.equal(settings.statusLine.command, `node ${GEMINI_DIR}/hooks/pan-statusline.js`, 'statusline command');
    assert.equal(fs.existsSync(resolveHookFile(projectDir, settings.statusLine.command)), true,
      'the registered statusline file must exist');
  });

  test('every registered command in the file points at a file that exists', () => {
    // The catch-all: a new event registration added to the installer is covered
    // here the moment it lands, even before this file names the event.
    const all = Object.keys(settings.hooks).flatMap((event) => commandsFor(settings, event));
    assert.ok(all.length >= 5, `expected at least the five event registrations, got ${all.length}`);
    for (const command of all) {
      assert.equal(fs.existsSync(resolveHookFile(projectDir, command)), true, `dead hook registration: ${command}`);
      assert.ok(path.basename(resolveHookFile(projectDir, command)).startsWith('pan-'),
        `PAN should only register its own hooks, saw: ${command}`);
    }
  });
});
