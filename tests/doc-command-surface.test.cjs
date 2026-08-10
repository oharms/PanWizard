/**
 * PAN Tools Tests — shipped content invokes only real commands (P-1813)
 *
 * PanLoop finding 10: during new-project --auto an agent invoked
 * `pan-tools state snapshot`, which did not exist — the real command was the
 * top-level `state-snapshot`, which reads exactly like a `state` subcommand.
 * pan-tools refused safely, but a guessed subcommand that COLLIDES with a
 * real one taking different arguments would not fail loudly. Two responses:
 * the guessed form is now a real alias (the dispatcher's state group), and
 * this lint asserts, model-free, that every `pan-tools <group> <sub>`
 * invocation in shipped content resolves to an implemented subcommand — the
 * reverse direction of the exhaustiveness pattern verify-health-codes uses
 * for issue codes.
 *
 * The command surface is parsed from pan-tools.cjs' own load-bearing error
 * strings — the top-level usage list and each group's
 * "Unknown X subcommand. Available: ..." message. Those enumerations are what
 * a user is shown, so they cannot go stale without being wrong on screen.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const DISPATCHER = path.join(REPO_ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

// Shipped content only — the surfaces agents actually load. docs/ is a human
// reference and carries deliberate error-message examples; it is out of scope.
const SHIPPED_DIRS = [
  'commands/pan',
  'agents',
  'pan-wizard-core/workflows',
  'pan-wizard-core/references',
  'pan-wizard-core/templates',
];

function walkMd(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(fp, out);
    else if (e.name.endsWith('.md')) out.push(fp);
  }
  return out;
}

/** Top-level commands, from the usage error's own enumeration. */
function parseTopLevelCommands(src) {
  const m = src.match(/Commands: ([^']+)'/);
  assert.ok(m, 'pan-tools.cjs must carry the top-level usage command list');
  return new Set(m[1].split(',').map(s => s.trim()).filter(Boolean));
}

/**
 * Per-group subcommands, from every "Unknown X subcommand. ... Available: ..."
 * error string. Entries like "phase <N>" contribute their first token.
 * @returns {Map<string, Set<string>>}
 */
function parseGroupSubcommands(src) {
  const groups = new Map();
  for (const m of src.matchAll(/Unknown ([a-z][a-z-]*) subcommand[^`']*Available: ([^`']+)/g)) {
    const subs = new Set(
      m[2].split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean)
    );
    groups.set(m[1], subs);
  }
  return groups;
}

describe('shipped content invokes only implemented pan-tools commands', () => {
  const src = fs.readFileSync(DISPATCHER, 'utf-8');
  const topLevel = parseTopLevelCommands(src);
  const groups = parseGroupSubcommands(src);

  test('sanity: the parsers find the surface they are meant to find', () => {
    // Guards against a silently-empty parse making the lint vacuous.
    assert.ok(topLevel.has('state'), 'usage list should include state');
    assert.ok(topLevel.has('state-snapshot'), 'usage list should include state-snapshot');
    assert.ok(groups.has('state'), 'state group error should be found');
    assert.ok(groups.has('verify'), 'verify group error should be found');
    assert.ok(groups.get('state').has('snapshot'),
      'the state group must accept "snapshot" — the P-1813 alias for state-snapshot (PanLoop finding 10)');
  });

  test('every `pan-tools <group> <sub>` in shipped content resolves', () => {
    // REVERT CHECK: with the P-1813 alias removed from the dispatcher, the
    // sanity test above goes red; with a doc that writes a nonexistent
    // subcommand (the finding-10 shape), this test goes red naming the file.
    // Two shapes count as an invocation an agent would copy: the runnable
    // `node …pan-tools.cjs <group> <sub>` form, and a backticked
    // `pan-tools <group> <sub>` command reference. Prose mentions of the tool
    // ("use pan-tools to validate…") or of the FILE ("MODEL_PROFILES in
    // pan-tools.cjs for the profile") are not commands and are skipped — the
    // first drafts of this lint flagged thirteen of those.
    const INVOCATION_RE = /(?:node [^\n`]*pan-tools\.cjs|`pan-tools)\s+([a-z][a-z0-9-]*)\s+([a-z][a-z0-9-]*)/g;
    const violations = [];
    for (const dir of SHIPPED_DIRS) {
      for (const file of walkMd(path.join(REPO_ROOT, dir))) {
        const content = fs.readFileSync(file, 'utf-8');
        for (const m of content.matchAll(INVOCATION_RE)) {
          const [, group, sub] = m;
          if (!topLevel.has(group)) {
            violations.push(`${path.relative(REPO_ROOT, file)}: unknown command group "pan-tools ${group}"`);
            continue;
          }
          // Only groups whose dispatcher enumerates subcommands are checked;
          // for plain top-level commands the second token is a positional arg.
          if (groups.has(group) && !groups.get(group).has(sub)) {
            violations.push(`${path.relative(REPO_ROOT, file)}: "pan-tools ${group} ${sub}" — ${group} has no subcommand "${sub}" (available: ${[...groups.get(group)].join(', ')})`);
          }
        }
      }
    }
    assert.deepStrictEqual(violations, [],
      `shipped content invokes pan-tools commands that do not exist:\n${violations.join('\n')}\n` +
      'Fix the doc (or add the subcommand/alias) rather than deleting this assertion — ' +
      'an agent will type exactly what these files teach it.');
  });
});

describe('pan-tools --help works (P-1814, PanLoop finding 11)', () => {
  // REVERT CHECK: `--help` was the single most frequent failed probe in field
  // transcripts — 26 sightings across 10 command docs. The obvious guess must
  // work; teaching ten documents not to make it does not scale.
  const { spawnSync } = require('child_process');
  const PAN_TOOLS = path.join(REPO_ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

  function invoke(...args) {
    return spawnSync(process.execPath, [PAN_TOOLS, ...args], { encoding: 'utf8', timeout: 15000 });
  }

  for (const flag of ['--help', '-h', 'help']) {
    test(`"${flag}" prints the command list and exits 0`, () => {
      const r = invoke(flag);
      assert.equal(r.status, 0, `an explicit help request is a success, got exit ${r.status}: ${r.stderr}`);
      assert.match(r.stdout, /Commands: state,/, 'help must print the usage command list');
    });
  }

  test('a missing command is still an error (the documented exit contract)', () => {
    // The very first defect this harness ever confirmed was an exit-code
    // disagreement — pin the boundary: help-on-request is 0, no-command is 1.
    const r = invoke();
    assert.equal(r.status, 1, 'bare invocation must stay exit 1');
  });

  test('an unknown command points at --help', () => {
    const r = invoke('definitely-not-a-command');
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /--help/, 'the refusal should name the probe that now works');
  });
});

describe('state snapshot alias behaves identically to state-snapshot (P-1813)', () => {
  test('both spellings produce the same snapshot', () => {
    const tmpDir = createTempProject();
    try {
      const planningDir = path.join(tmpDir, '.planning');
      fs.writeFileSync(path.join(planningDir, 'state.md'), [
        '# Project State',
        '',
        '**Current Phase:** 02',
        '**Status:** In progress',
        '**Total Phases:** 3',
        '',
      ].join('\n'));

      const hyphenated = runPanTools('state-snapshot', tmpDir);
      const spaced = runPanTools('state snapshot', tmpDir);

      assert.equal(spaced.exitCode, hyphenated.exitCode, 'exit codes must match');
      assert.deepStrictEqual(
        JSON.parse(spaced.output),
        JSON.parse(hyphenated.output),
        'the alias must dispatch to the same handler, byte-equivalent output'
      );
    } finally {
      cleanup(tmpDir);
    }
  });
});
