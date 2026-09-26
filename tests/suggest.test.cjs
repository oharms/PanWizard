/**
 * Command suggestions for unknown invocations.
 *
 * ORIGIN: an external harness ledger recorded `pan-tools trace …` 18 times —
 * the most-repeated agent behaviour in it. The docs were investigated and
 * CLEARED (tests/doc-command-surface.test.cjs passes; no shipped surface teaches
 * the bare form), so no prose change could explain those sightings or prevent the
 * next one. What PAN could fix is the recovery: `trace` is a real subcommand one
 * namespace away, and the old message threw that away.
 *
 * These tests pin the behaviour AND the property that keeps it honest — the index
 * is derived from the dispatcher's own "Available:" strings, never a second list.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const suggest = require('../pan-wizard-core/bin/lib/suggest.cjs');

const DISPATCHER = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const SOURCE = fs.readFileSync(DISPATCHER, 'utf8');

/** Run the real CLI and return combined output, whatever the exit code. */
function run(args) {
  try {
    return execFileSync(process.execPath, [DISPATCHER, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
    });
  } catch (e) {
    return `${e.stdout || ''}${e.stderr || ''}`;
  }
}

describe('buildSubcommandIndex — parsed from the dispatcher, not hand-written', () => {
  const index = suggest.buildSubcommandIndex(SOURCE);

  test('finds a substantial set of groups in the real dispatcher', () => {
    // Not pinned to an exact number: the point is that parsing WORKS, and a
    // hardcoded total is the maintenance debt this repo's doctrine bans.
    assert.ok(Object.keys(index).length > 20,
      `expected many groups, parsed ${Object.keys(index).length}`);
  });

  test('the case that started this: optimize owns trace', () => {
    assert.ok(index.optimize, 'optimize group must be parsed');
    assert.ok(index.optimize.includes('trace'), `optimize subs: ${index.optimize}`);
  });

  test('strips trailing usage hints from an entry', () => {
    // hygiene publishes `clean [--apply] [--trace-age-days N]`; only the bare
    // token is a subcommand, and the flags must not leak into the index.
    assert.ok(index.hygiene, 'hygiene group must be parsed');
    assert.ok(index.hygiene.includes('clean'));
    assert.ok(!index.hygiene.some((s) => s.startsWith('[') || s.includes('--')),
      `usage hints leaked: ${index.hygiene}`);
  });

  test('every parsed subcommand is a plain token (no punctuation, no flags)', () => {
    for (const [group, subs] of Object.entries(index)) {
      for (const s of subs) {
        assert.match(s, /^[a-z][a-z0-9-]*$/, `${group} produced a non-token subcommand: "${s}"`);
      }
    }
  });

  test('reads all three wordings the dispatcher uses (2026-09-26)', () => {
    // `Unknown X subcommand: <name>. Available`, `X subcommand required. Available`
    // and `Unknown init workflow: <name>` + a newline + `Available` were all skipped before, so a
    // typo in these groups got no suggestion.
    const expect = { git: 'commit', distill: 'scan', experiment: 'harvest', init: 'plan-phase', state: 'advance-plan', links: 'validate' };
    for (const [group, sub] of Object.entries(expect)) {
      assert.ok(index[group] && index[group].includes(sub), `${group} must be indexed with ${sub}: ${index[group]}`);
    }
  });

  test('is pure and total — junk input yields an empty index, never a throw', () => {
    for (const bad of [null, undefined, 42, '', 'no availability strings here']) {
      assert.deepEqual(suggest.buildSubcommandIndex(bad), {});
    }
  });
});

describe('suggestCommand', () => {
  const index = suggest.buildSubcommandIndex(SOURCE);
  const topLevel = (SOURCE.match(/Commands: ([^'"`\n]+)/) || [, ''])[1]
    .split(',').map((s) => s.trim()).filter(Boolean);

  test('a namespace miss names the fully-qualified form', () => {
    assert.deepEqual(suggest.suggestCommand('trace', index, topLevel), ['pan-tools optimize trace']);
  });

  test('a subcommand owned by several groups lists them all, deterministically', () => {
    const s = suggest.suggestCommand('scan', index, topLevel);
    assert.ok(s.length > 1, `expected multiple owners for "scan", got ${JSON.stringify(s)}`);
    assert.deepEqual(s, [...s].sort(), 'ordering must be stable, not hash-order');
  });

  test('a typo resolves to the nearest top-level command', () => {
    assert.ok(suggest.suggestCommand('optimze', index, topLevel).includes('pan-tools optimize'));
  });

  test('typos do NOT muddy a valid namespace miss', () => {
    // When the token IS a real subcommand, spelling guesses are suppressed —
    // otherwise the useful answer competes with noise.
    for (const s of suggest.suggestCommand('trace', index, topLevel)) {
      assert.match(s, /optimize trace$/);
    }
  });

  test('genuine nonsense suggests nothing (no false confidence)', () => {
    assert.deepEqual(suggest.suggestCommand('zzzzqqq', index, topLevel), []);
  });

  test('short tokens use a tight threshold so unrelated commands do not match', () => {
    // "hud" and "cost" are 3-4 chars; a loose threshold would pair them with
    // half the surface and make every message useless.
    const s = suggest.suggestCommand('xyz', index, topLevel);
    assert.ok(s.length <= 3, `too many guesses for a 3-char token: ${JSON.stringify(s)}`);
  });

  test('is total — bad arguments never throw', () => {
    for (const bad of [null, undefined, '', 42, {}]) {
      assert.deepEqual(suggest.suggestCommand(bad, index, topLevel), []);
    }
    assert.doesNotThrow(() => suggest.suggestCommand('trace', null, null));
  });
});

describe('formatSuggestions', () => {
  test('ends with a period so the caller can append prose', () => {
    // REGRESSION: the first version omitted it and the message read
    // "…optimize trace Run pan-tools --help to see available commands."
    assert.match(suggest.formatSuggestions(['pan-tools optimize trace']), /trace\.$/);
    assert.match(suggest.formatSuggestions(['a', 'b']), /b\.$/);
  });

  test('empty input yields an empty string, so concatenation is safe', () => {
    assert.equal(suggest.formatSuggestions([]), '');
    assert.equal(suggest.formatSuggestions(null), '');
  });
});

describe('end-to-end through the real CLI', () => {
  test('THE 18-SIGHTING CASE: `pan-tools trace` now names the right form', () => {
    const out = run(['trace']);
    assert.match(out, /Unknown command: trace/);
    assert.match(out, /pan-tools optimize trace/,
      'the whole point of this feature: say where trace actually lives');
  });

  test('the message is readable — no run-together sentences', () => {
    const out = run(['trace']);
    assert.ok(!/trace Run pan-tools/.test(out), `punctuation regression: ${out.trim()}`);
  });

  test('a healthy command is unaffected (suggestions are error-path only)', () => {
    const out = run(['resolve-model', 'pan-planner']);
    assert.match(out, /"model"/);
    assert.ok(!/Did you mean/.test(out), 'a successful call must not carry suggestions');
  });

  test('nonsense still fails cleanly with no invented suggestion', () => {
    const out = run(['zzzzqqq']);
    assert.match(out, /Unknown command: zzzzqqq/);
    assert.ok(!/Did you mean/.test(out));
  });
});

describe('learn publishes its surface (the ledger item-2 defect)', () => {
  // `learn` was the ONLY group that never published an "Available:" list, so its
  // subcommands were invisible to a user AND to the suggester. Worse, an unknown
  // subcommand fell through to the bare `optimize learn` alias and silently ran
  // trace analysis — so `pan-tools learn promotee` returned a trace-session error
  // and the caller concluded `promote` was broken.
  test('an unknown learn subcommand is refused, and lists the real ones', () => {
    const out = run(['learn', 'promotee']);
    assert.match(out, /Unknown learn subcommand/);
    for (const sub of ['promote', 'unpromote', 'list-promoted', 'build-index', 'topics-for', 'lint']) {
      assert.ok(out.includes(sub), `the available list should name "${sub}"`);
    }
    assert.ok(!/No trace session active/.test(out),
      'an unknown subcommand must NOT silently run the analyser');
  });

  test('BARE `learn` is still the documented alias for `optimize learn`', () => {
    // CLI-REFERENCE lists `learn (alias)`. Publishing the surface must not have
    // broken it — that would be a real regression for a documented invocation.
    const bare = run(['learn']);
    const viaOptimize = run(['optimize', 'learn']);
    assert.equal(bare.trim(), viaOptimize.trim(), 'the alias must stay byte-identical');
  });

  test('a real learn subcommand still works', () => {
    assert.match(run(['learn', 'list-promoted']), /universal|internal|\{/);
  });

  test("learn's subcommands are now reachable by suggestion", () => {
    const index = suggest.buildSubcommandIndex(SOURCE);
    assert.ok(index.learn, 'learn must now appear in the parsed index');
    assert.match(run(['promote']), /pan-tools learn promote/);
  });
});

describe('DRIFT GUARD: published surfaces match what the dispatcher accepts', () => {
  test("every subcommand learn advertises is one it actually handles", () => {
    // The published list is prose and could drift from the branches below it.
    // Derive the handled set from the source and compare.
    const learnCase = SOURCE.slice(SOURCE.indexOf("case 'learn': {"));
    const body = learnCase.slice(0, learnCase.indexOf("\n    case '"));
    const handled = new Set([...body.matchAll(/subcommand === '([a-z-]+)'/g)].map((m) => m[1]));
    const advertised = (body.match(/Unknown learn subcommand\. Available: ([^'"`\n]+)/) || [, ''])[1]
      .split(',').map((s) => s.trim()).filter(Boolean);
    assert.ok(advertised.length > 0, 'learn must publish an Available: list');
    const phantom = advertised.filter((s) => !handled.has(s));
    assert.deepEqual(phantom, [], `learn advertises subcommands it does not handle: ${phantom}`);
    const unadvertised = [...handled].filter((s) => !advertised.includes(s));
    assert.deepEqual(unadvertised, [], `learn handles subcommands it does not advertise: ${unadvertised}`);
  });
});
