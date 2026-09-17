/**
 * Dispatcher arms — the contract every verb group's error arm keeps, and a live
 * dispatch of the arms no other test reaches (spec docs/specs/testing-system-redesign-2026-09.md
 * §3.2 item 10).
 *
 * Why this file exists. The surface registry (tests/fixtures/surface.json) and the
 * coverage gate both measured the same hole on 2026-09-17: twelve subcommands whose
 * module functions were well tested but whose CLI arm no test ever dispatched, four
 * verbs never dispatched at all, and every one of the thirty-five "Unknown <group>
 * subcommand. Available: …" arms untouched. Those arms are the surface a user and an
 * orchestrator actually hit — an arm that throws instead of refusing cleanly, or that
 * exits 0 on a refusal, is invisible to a module-level test.
 *
 * Everything here is driven FROM the dispatcher's own source, not from a list kept by
 * hand: a new verb group, or a group that stops advertising its subcommands, changes
 * what these tests assert. The error-arm case is parametrised over all of them, so the
 * marginal cost of a new group is zero and the arm can never go unexercised.
 *
 * Every case runs the real CLI in a child process and reads the real exit code. Calling
 * the lib's `cmd*` functions in-process would end in `output()` → `process.exit`, which
 * kills the test process and makes `node --test` report the whole file as one passing
 * test (the trap that hid fifteen tests in tests/cost-rebuild.test.cjs).
 */

const { test, describe, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup, installInto } = require('./helpers.cjs');

const DISPATCHER = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

/**
 * Every verb group that advertises its subcommands in an "Unknown … Available: …"
 * error, read from the dispatcher source. Mirrors the extraction in
 * scripts/test-surface.cjs, which is what the committed surface registry is built from.
 *
 * @returns {Array<{group: string, subs: string[]}>}
 */
function parseErrorArms() {
  const src = fs.readFileSync(DISPATCHER, 'utf-8');
  const out = [];
  const re = /Unknown ([a-z][a-z-]*) subcommand[^`']*Available: ([^`']+)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.push({ group: m[1], subs: m[2].split(',').map((s) => s.trim()).filter(Boolean) });
  }
  return out;
}

// A subcommand token no group will ever advertise, built at run time so this file
// cannot accidentally contain the string it claims is unknown.
const NONSENSE = `zz-no-such-sub-${process.pid}`;

describe('dispatcher arms — every group refuses an unknown subcommand the same way', () => {
  const arms = parseErrorArms();

  test('the extraction is not vacuous: the dispatcher advertises many groups', () => {
    assert.ok(arms.length >= 30, `expected the dispatcher's error arms, found ${arms.length}`);
    const groups = arms.map((a) => a.group);
    for (const expected of ['state', 'cost', 'memory', 'optimize', 'worktree', 'squad']) {
      assert.ok(groups.includes(expected), `group ${expected} should advertise its subcommands`);
    }
    for (const a of arms) {
      assert.ok(a.subs.length > 0, `group ${a.group} advertises an empty subcommand list`);
    }
  });

  // One case per group. A group whose arm throws, or exits 0, or stops naming its
  // subcommands, fails here and nowhere else.
  for (const { group, subs } of arms) {
    test(`\`${group} <unknown>\` exits 1, names the subcommand, and lists the real alternatives`, () => {
      const tmp = createTempProject();
      try {
        const r = runPanTools(`${group} ${NONSENSE}`, tmp);
        assert.equal(r.success, false, `${group} accepted an unknown subcommand`);

        const text = `${r.error}\n${r.output}`;
        assert.match(text, /Unknown/, `${group} did not say the subcommand was unknown: ${text.slice(0, 200)}`);
        assert.match(text, new RegExp(`\\b${group}\\b`), `${group}'s error does not name the group`);
        assert.match(text, /Available:/, `${group} did not list its alternatives`);

        // The advertised list must be the real one, so a subcommand that is added or
        // renamed cannot leave a stale menu behind.
        for (const sub of subs) {
          assert.ok(text.includes(sub), `${group}'s error omits its own subcommand "${sub}"`);
        }

        // A refusal is not a crash: no stack trace reaches the user.
        assert.equal(/\n\s+at\s+\S+/.test(text), false, `${group} leaked a stack trace: ${text.slice(0, 300)}`);
      } finally {
        cleanup(tmp);
      }
    });
  }

  test('a bare group name is its own no-argument form, not an error arm', () => {
    const tmp = createTempProject();
    try {
      // Measured 2026-09-17: `state` with nothing after it is the state payload itself,
      // so the error arm is reached only by an unknown subcommand. Pinned here because
      // the natural assumption — that a bare group prints its menu — is wrong, and a
      // test written on that assumption would have demanded a behaviour change.
      const r = runPanTools('state', tmp);
      assert.equal(r.success, true, `bare \`state\` should print the state payload: ${r.error}`);
      const p = JSON.parse(r.output);
      assert.ok(p && typeof p === 'object' && 'config' in p, `unexpected bare-state payload: ${r.output.slice(0, 200)}`);
    } finally {
      cleanup(tmp);
    }
  });
});

describe('dispatcher arms — an unknown verb is refused by the top-level usage line', () => {
  test('exits 1 and prints the usage line that the surface registry is built from', () => {
    const tmp = createTempProject();
    try {
      const bogus = `zz-no-such-verb-${process.pid}`;
      const r = runPanTools(bogus, tmp);
      assert.equal(r.success, false, 'an unknown verb was accepted');
      const text = `${r.error}\n${r.output}`;
      assert.ok(text.includes(bogus), `the refusal does not name the verb: ${text.slice(0, 200)}`);
      assert.match(text, /--help/, `the refusal does not point anywhere: ${text.slice(0, 200)}`);
      assert.equal(/\n\s+at\s+\S+/.test(text), false, `unknown verb leaked a stack trace: ${text.slice(0, 300)}`);

      // --help is where the verb list lives, and it is what the surface registry parses.
      const help = runPanTools('--help', tmp);
      const helpText = `${help.output}\n${help.error}`;
      assert.match(helpText, /Commands:/, `--help lost its usage line: ${helpText.slice(0, 200)}`);
      for (const verb of ['state', 'cost', 'validate']) {
        assert.ok(helpText.includes(verb), `--help omits the shipped verb ${verb}`);
      }
    } finally {
      cleanup(tmp);
    }
  });
});

describe('dispatcher arms — the CLI arms no other test dispatched', () => {
  // These twelve sat in tests/fixtures/surface-allowlist.json with the reason "module
  // function tested, CLI arm never dispatched". Each assertion below is about the ARM:
  // that dispatching it reaches the module and returns that module's shape, rather than
  // failing on argument handling inside the dispatcher. The modules' own behaviour stays
  // where it is tested (squads.test.cjs, worktree.test.cjs, optimize.test.cjs, …).
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  /** Parse a successful --raw-less run's JSON payload, with a readable failure. */
  const payload = (args) => {
    const r = runPanTools(args, tmp);
    assert.equal(r.success, true, `\`${args}\` failed: ${r.error || r.output}`);
    try {
      return JSON.parse(r.output);
    } catch (e) {
      throw new assert.AssertionError({ message: `\`${args}\` did not print JSON: ${r.output.slice(0, 300)}` });
    }
  };

  test('`memory budget` reaches memoryLoadBudget and reports the whole-prompt denominator', () => {
    const b = payload('memory budget');
    assert.equal(b.status, 'ok', `a fresh project should be within budget, got ${b.status}`);
    assert.equal(b.memory_tokens, 0);
    assert.equal(b.agents, 0);
    assert.equal(b.median_prompt_tokens, null, 'no ledger yet, so no denominator');
    assert.ok('fraction' in b, 'the budget payload must carry fraction');
  });

  test('`optimize stats`, `optimize list` and `optimize apply` each reach their module', () => {
    const stats = payload('optimize stats');
    assert.equal(stats.trace_sessions, 0, 'a fresh project has traced nothing');
    assert.equal(stats.total_events_traced, 0);
    assert.equal(stats.current_session, null);

    const list = payload('optimize list');
    assert.ok(Array.isArray(list.reports), `optimize list should carry reports[], got ${Object.keys(list).join(', ')}`);
    assert.equal(list.count, 0, 'a fresh project has no optimization reports');

    // Measured: `apply` with no report to apply REFUSES (exit 1) rather than returning
    // an empty success, and says what to run first. That is the arm's contract.
    const r = runPanTools('optimize apply', tmp);
    assert.equal(r.success, false, 'optimize apply invented something to apply');
    const text = `${r.error}\n${r.output}`;
    assert.match(text, /No optimization reports found/, `unhelpful refusal: ${text.slice(0, 200)}`);
    assert.equal(/\n\s+at\s+\S+/.test(text), false, 'optimize apply leaked a stack trace');
  });

  test('`squad list` and `squad show` reach the registry and report an empty one honestly', () => {
    // Measured: the registry ships four built-in squads, so a fresh project lists
    // those rather than nothing.
    const list = payload('squad list');
    assert.ok(Array.isArray(list.squads), `squad list should carry squads[], got ${Object.keys(list).join(', ')}`);
    const names = list.squads.map((s) => s.name);
    for (const builtin of ['architecture', 'build', 'quality', 'release']) {
      assert.ok(names.includes(builtin), `squad list omits the built-in squad ${builtin}: ${names.join(', ')}`);
    }

    // `show` names a built-in, and refuses one that does not exist by listing the real
    // ones — the same menu contract the group error arms keep.
    const shown = payload('squad show architecture');
    assert.ok(shown && typeof shown === 'object', 'squad show returned no payload');

    const r = runPanTools('squad show no-such-squad', tmp);
    assert.equal(r.success, false, 'squad show invented a missing squad');
    const text = `${r.error}\n${r.output}`;
    assert.match(text, /Available:/, `squad show did not list the real squads: ${text.slice(0, 200)}`);
    assert.equal(/\n\s+at\s+\S+/.test(text), false, 'squad show leaked a stack trace');
  });

  test('`worktree list` and `worktree create` reach the module through the dispatcher', () => {
    const list = payload('worktree list');
    assert.ok(Array.isArray(list.worktrees), `worktree list should carry worktrees[], got ${Object.keys(list).join(', ')}`);

    // createTempProject() is not a git repository, so create must refuse — and refuse
    // as a clean error, which is the arm's contract.
    const r = runPanTools('worktree create test-branch', tmp);
    const text = `${r.error}\n${r.output}`;
    assert.equal(/\n\s+at\s+\S+/.test(text), false, `worktree create leaked a stack trace: ${text.slice(0, 300)}`);
    assert.ok(text.trim().length > 0 && (r.success === false || /worktree/i.test(text)),
      `worktree create said nothing useful: ${text.slice(0, 200)}`);
  });

  test('`bridge cache` reaches the bridge module', () => {
    const r = runPanTools('bridge cache', tmp);
    const text = `${r.error}\n${r.output}`;
    assert.equal(/\n\s+at\s+\S+/.test(text), false, `bridge cache leaked a stack trace: ${text.slice(0, 300)}`);
    if (r.success) {
      const p = JSON.parse(r.output);
      assert.ok(p && typeof p === 'object', 'bridge cache returned no payload');
    } else {
      assert.match(text, /bridge|cache/i, `bridge cache failed without saying why: ${text.slice(0, 200)}`);
    }
  });

  test('`learn unpromote` refuses an entry that was never promoted', () => {
    const r = runPanTools('learn unpromote no-such-learning', tmp);
    assert.equal(r.success, false, 'unpromote accepted an unknown entry');
    const text = `${r.error}\n${r.output}`;
    assert.equal(/\n\s+at\s+\S+/.test(text), false, `learn unpromote leaked a stack trace: ${text.slice(0, 300)}`);
  });

  test('`focus reflection` reaches the focus module on a project with no focus run', () => {
    const r = runPanTools('focus reflection', tmp);
    const text = `${r.error}\n${r.output}`;
    assert.equal(/\n\s+at\s+\S+/.test(text), false, `focus reflection leaked a stack trace: ${text.slice(0, 300)}`);
    assert.ok(text.trim().length > 0, 'focus reflection printed nothing at all');
  });

  test('`campaign record-run` reaches the campaign module', () => {
    const r = runPanTools('campaign record-run', tmp);
    const text = `${r.error}\n${r.output}`;
    assert.equal(/\n\s+at\s+\S+/.test(text), false, `campaign record-run leaked a stack trace: ${text.slice(0, 300)}`);
    assert.ok(text.trim().length > 0, 'campaign record-run printed nothing at all');
  });
});

describe('dispatcher arms — the verbs no test dispatched at all', () => {
  // experiment, distill, squad and worktree sat in tests/fixtures/coverage-policy.json's
  // arms_allow with the reason "module is unit-tested; the CLI arm is never dispatched".
  // Their modules stay tested where they are (experiment.test.cjs, distill.test.cjs, …);
  // what was missing was any execution of the dispatcher arm itself, which is what the
  // coverage gate measures. A bare verb reaches the arm and stops at its own guard — and
  // for `experiment` that is the safest possible dispatch, because its subcommands spawn
  // the installer.
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  // Measured 2026-09-17: the four arms do not behave alike, and the difference is the
  // point. `experiment` and `distill` REFUSE without a subcommand; `squad` and
  // `worktree` default to their list form and exit 0. A single parametrised assumption
  // would have demanded a behaviour change from two of them.
  for (const verb of ['experiment', 'distill']) {
    test(`\`${verb}\` with no subcommand refuses with its own menu`, () => {
      const r = runPanTools(verb, tmp);
      assert.equal(r.success, false, `bare \`${verb}\` should refuse`);
      const text = `${r.error}\n${r.output}`;
      assert.match(text, new RegExp(`\\b${verb}\\b`), `${verb}'s refusal does not name the verb: ${text.slice(0, 200)}`);
      assert.match(text, /Available:/, `${verb} did not list its subcommands: ${text.slice(0, 200)}`);
      assert.equal(/\n\s+at\s+\S+/.test(text), false, `${verb} leaked a stack trace: ${text.slice(0, 300)}`);
    });
  }

  test('bare `squad` and bare `worktree` default to their list form', () => {
    const squads = JSON.parse(runPanTools('squad', tmp).output);
    assert.ok(Array.isArray(squads.squads), 'bare squad should list squads');
    assert.deepEqual(squads, JSON.parse(runPanTools('squad list', tmp).output),
      'bare squad must mean exactly `squad list`');

    const trees = JSON.parse(runPanTools('worktree', tmp).output);
    assert.ok(Array.isArray(trees.worktrees), 'bare worktree should list worktrees');
    assert.deepEqual(trees, JSON.parse(runPanTools('worktree list', tmp).output),
      'bare worktree must mean exactly `worktree list`');
  });

  test('the menus each verb advertises are the ones the dispatcher really carries', () => {
    // Read the advertised lists back out of the source so a renamed subcommand cannot
    // leave a stale menu in front of the user.
    const src = fs.readFileSync(DISPATCHER, 'utf-8');
    for (const verb of ['experiment', 'distill']) {
      const m = new RegExp(verb + String.raw` subcommand required[^'\x60]*Available: ([^'\x60]+)`).exec(src);
      assert.ok(m, `the dispatcher no longer advertises ${verb}'s subcommands`);
      const advertised = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      assert.ok(advertised.length >= 3, `${verb} advertises only ${advertised.length} subcommands`);
      const text = String(runPanTools(verb, tmp).error);
      for (const sub of advertised) {
        assert.ok(text.includes(sub), `${verb}'s refusal omits its own subcommand "${sub}"`);
      }
    }
  });
});

describe('installer flags — the legacy --both alias still selects its two runtimes', () => {
  // `--both` predates the five-runtime installer and is kept working for old scripts
  // (bin/install.js: "Legacy flag, keeps working"). It sat in the surface allowlist with
  // no test naming it, which is exactly how a legacy alias stops working unnoticed.
  test('--both resolves to claude + opencode, and --all still means all five', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'install.js'), 'utf-8');
    // The resolution is a plain flag-to-runtime mapping in the installer's argument
    // handling; assert the mapping the flag promises rather than re-running five installs.
    const both = src.match(/else if \(hasBoth\) \{\s*selectedRuntimes = (\[[^\]]*\])/);
    assert.ok(both, 'bin/install.js no longer maps --both to a runtime list');
    assert.deepEqual(JSON.parse(both[1].replace(/'/g, '"')), ['claude', 'opencode'],
      '--both must keep selecting exactly the two runtimes it always selected');

    const all = src.match(/if \(hasAll\) \{\s*selectedRuntimes = (\[[^\]]*\])/);
    assert.ok(all, 'bin/install.js no longer maps --all to a runtime list');
    assert.deepEqual(JSON.parse(all[1].replace(/'/g, '"')).sort(),
      ['claude', 'codex', 'copilot', 'gemini', 'opencode'],
      '--all must cover every shipped runtime');
  });

  test('--both actually installs both runtimes and nothing else', () => {
    const target = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-both-'));
    try {
      const r = installInto(target, ['--both', '--local']);
      assert.equal(r.success, true, `--both install failed: ${r.error || r.output}`);
      assert.equal(fs.existsSync(path.join(target, '.claude', 'pan-file-manifest.json')), true, '--both did not install Claude');
      assert.equal(fs.existsSync(path.join(target, '.opencode', 'pan-file-manifest.json')), true, '--both did not install OpenCode');
      for (const dir of ['.gemini', '.codex', '.github']) {
        assert.equal(fs.existsSync(path.join(target, dir)), false, `--both installed ${dir}, which it never selected`);
      }
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});

describe('dispatcher arms — `--flag value` and `--flag=value` are one surface', () => {
  // The surface registry counts both spellings as one row (spec §3.3 item 8). The
  // dispatcher parses them in two different places, so a regression in either spelling
  // is invisible to a test that only uses the other.
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('--cwd and --cwd= name the same project root', () => {
    const other = createTempProject();
    try {
      const spaced = runPanTools(`--cwd "${other}" memory budget`, tmp);
      const equals = runPanTools(`--cwd="${other}" memory budget`, tmp);
      assert.equal(spaced.success, true, `--cwd <value> failed: ${spaced.error}`);
      assert.equal(equals.success, true, `--cwd=<value> failed: ${equals.error}`);
      assert.deepEqual(JSON.parse(equals.output), JSON.parse(spaced.output),
        'the two spellings of --cwd produced different answers');
    } finally {
      cleanup(other);
    }
  });

  test('a --cwd with no value is refused in both spellings, not silently ignored', () => {
    for (const args of ['--cwd', '--cwd=']) {
      const r = runPanTools(`${args} memory budget`, tmp);
      assert.equal(r.success, false, `\`${args}\` was accepted without a value`);
      assert.match(`${r.error}${r.output}`, /cwd/i, `\`${args}\` did not say what was wrong`);
    }
  });

  test('--cwd pointing at a non-directory is refused with the path named', () => {
    const file = path.join(tmp, 'not-a-dir.txt');
    fs.writeFileSync(file, 'x');
    const r = runPanTools(`--cwd "${file}" memory budget`, tmp);
    assert.equal(r.success, false, 'a file was accepted as a project root');
    assert.match(`${r.error}${r.output}`, /not a directory|Invalid --cwd/i, `unhelpful refusal: ${r.error}`);
  });
});
