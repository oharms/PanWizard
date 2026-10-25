/**
 * Programs S1, S2 and S5: the autopilot (development only, never shipped).
 *
 * S1: each WATCH row of the ideas ledger can carry a machine predicate
 * (docs/specs/watch-triggers.json). harness/autopilot/market-watch.cjs evaluates them
 * model-free (npm dist-tags, GitHub releases with ETags, CHANGELOG text, harness results)
 * and writes an inbox of deltas. It never writes the ledger.
 * S2: harness/autopilot/autopilot.cjs <lane>: a dry-run plan by default; a model lane
 * runs only with a per-run approval; bot branches are local and never pushed; a scope
 * check refuses edits to evaluator files; canary mutants must stay red.
 * S5: harness/autopilot/state-of-pan.cjs: a deterministic weekly report.
 */
'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MW = require('../harness/autopilot/market-watch.cjs');
const AP = require('../harness/autopilot/autopilot.cjs');
const SC = require('../harness/autopilot/bot-scope-check.cjs');
const SP = require('../harness/autopilot/state-of-pan.cjs');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ap-')); dirs.push(d); return d; };

describe('S1: executable WATCH triggers', () => {
  const TRIGGERS = [
    { id: 'MI-900', predicate: { kind: 'npm_dist_tag', package: 'some-cli', tag: 'latest', gt: '2.1.0' } },
    { id: 'MI-901', predicate: { kind: 'github_release', repo: 'o/r', tag_matches: '^v3\\.' } },
    { id: 'MI-902', predicate: { kind: 'changelog_contains', file: 'CHANGELOG.md', pattern: 'MCP Tasks' } },
    { id: 'MI-903', predicate: { kind: 'harness_result', scenario: 'cross-family-defect', status: 'passed' } },
  ];
  const responses = (over = {}) => ({
    'https://registry.npmjs.org/some-cli': { status: 200, etag: 'e1', body: { 'dist-tags': { latest: '2.1.0' }, time: { '2.1.0': '2026-10-01T00:00:00Z' } } },
    'https://api.github.com/repos/o/r/releases?per_page=20': { status: 200, etag: 'g1', body: [{ tag_name: 'v2.9.0', published_at: '2026-10-01T00:00:00Z' }] },
    ...over,
  });

  function repo() {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'CHANGELOG.md'), '# Changelog\n\n- nothing yet\n');
    fs.mkdirSync(path.join(d, 'docs', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(d, 'docs', 'specs', 'market-ideas-ledger.md'), '| ID | Idea | Seen | First | Status | Decision | Trigger |\n|---|---|---|---|---|---|---|\n| MI-900 | x | y | z | WATCH | d | t |\n');
    fs.mkdirSync(path.join(d, 'harness'), { recursive: true });
    fs.writeFileSync(path.join(d, 'harness', 'ledger.jsonl'), '');
    return d;
  }

  test('the fixture responses flip the right rows, and only those', () => {
    const d = repo();
    const first = MW.runWatch({ root: d, triggers: TRIGGERS, fetch: MW.fixtureFetch(responses()), now: '2026-10-20' });
    assert.deepEqual(first.fired, []);
    assert.deepEqual(Object.fromEntries(first.results.map((r) => [r.id, r.value])), { 'MI-900': false, 'MI-901': false, 'MI-902': false, 'MI-903': null });
    fs.appendFileSync(path.join(d, 'CHANGELOG.md'), '- MCP Tasks support\n');
    const second = MW.runWatch({ root: d, triggers: TRIGGERS, fetch: MW.fixtureFetch(responses({
      'https://registry.npmjs.org/some-cli': { status: 200, etag: 'e2', body: { 'dist-tags': { latest: '2.2.0' }, time: { '2.2.0': '2026-10-19T00:00:00Z' } } },
    })), now: '2026-10-21' });
    assert.deepEqual(second.fired.map((f) => f.id).sort(), ['MI-900', 'MI-902']);
    const inbox = fs.readFileSync(path.join(d, MW.INBOX), 'utf8');
    assert.match(inbox, /MI-900/);
    assert.match(inbox, /2\.2\.0/);
    assert.doesNotMatch(inbox, /MI-901/);
  });

  test('an unchanged response (304, by ETag) keeps the last value', () => {
    const d = repo();
    MW.runWatch({ root: d, triggers: TRIGGERS, fetch: MW.fixtureFetch(responses()), now: '2026-10-20' });
    const seen = [];
    const r = MW.runWatch({ root: d, triggers: TRIGGERS, fetch: (url, etag) => { seen.push(etag); return { status: 304 }; }, now: '2026-10-21' });
    assert.ok(seen.includes('e1') && seen.includes('g1'), 'the stored ETags are sent');
    assert.equal(r.results.find((x) => x.id === 'MI-900').value, false);
  });

  test('the inbox writer never touches the ledger, the status column least of all', () => {
    const d = repo();
    const ledger = path.join(d, 'docs', 'specs', 'market-ideas-ledger.md');
    const before = fs.readFileSync(ledger, 'utf8');
    fs.appendFileSync(path.join(d, 'CHANGELOG.md'), '- MCP Tasks support\n');
    MW.runWatch({ root: d, triggers: TRIGGERS, fetch: MW.fixtureFetch(responses()), now: '2026-10-21' });
    assert.equal(fs.readFileSync(ledger, 'utf8'), before);
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'harness', 'autopilot', 'market-watch.cjs'), 'utf8'), /market-ideas-ledger/);
  });

  test('every trigger in the repository names a WATCH row of the ledger and a known predicate', () => {
    const triggers = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'specs', 'watch-triggers.json'), 'utf8'));
    const ledger = fs.readFileSync(path.join(ROOT, 'docs', 'specs', 'market-ideas-ledger.md'), 'utf8');
    assert.ok(triggers.length >= 3);
    for (const t of triggers) {
      assert.match(ledger, new RegExp(`\\| ${t.id} \\|[^\\n]*\\| WATCH \\|`), t.id);
      assert.ok(MW.PREDICATES.includes(t.predicate.kind), t.predicate.kind);
    }
  });
});

describe('S2: the autopilot spine', () => {
  const LANES = [
    { id: 'watch', model: false, command: ['node', '-e', 'console.log(1)'] },
    { id: 'docs', model: true, prompt: 'Fix stale docs.', paths: ['docs/'] },
  ];

  test('a dry-run plan by default: worktree, local bot branch, command, never a push', () => {
    const plan = AP.planLane(LANES, 'docs', { root: 'X:/pantesting', id: 'r1' });
    assert.equal(plan.dry_run, true);
    assert.equal(plan.branch, 'bot/docs/r1');
    assert.match(plan.worktree.replace(/\\/g, '/'), /^X:\/pantesting\/autopilot\/docs-r1$/);
    assert.equal(plan.pushes, false);
    assert.equal(plan.model, true);
    assert.equal(plan.approval, 'required: --approve-usd <N>');
  });

  test('a model lane does not run without a per-run approval; a model-free one does', () => {
    assert.equal(AP.checkRun(LANES, 'docs', {}).error, 'approval_required');
    assert.equal(AP.checkRun(LANES, 'docs', { approveUsd: 2 }).ok, true);
    assert.equal(AP.checkRun(LANES, 'watch', {}).ok, true);
  });

  test('the kill switch stops every lane', () => {
    assert.equal(AP.checkRun(LANES, 'watch', { env: { PAN_AUTOPILOT_KILL: '1' } }).error, 'killed');
  });

  test('the monthly spend cap refuses a run that would pass it', () => {
    const spend = [{ ts: '2026-10-02T00:00:00Z', usd: 8 }, { ts: '2026-09-30T00:00:00Z', usd: 50 }];
    assert.equal(AP.checkRun(LANES, 'docs', { approveUsd: 3, spend, monthlyCapUsd: 10, now: '2026-10-20' }).error, 'monthly_cap');
    assert.equal(AP.checkRun(LANES, 'docs', { approveUsd: 2, spend, monthlyCapUsd: 10, now: '2026-10-20' }).ok, true);
  });

  test('scope check, both ways: the lane\'s own files pass, evaluator files and files outside the lane are refused', () => {
    assert.deepEqual(SC.scopeCheck(['docs/USER-GUIDE.md', 'docs/FAQ.md'], { paths: ['docs/'] }), { ok: true, refused: [] });
    const r = SC.scopeCheck(['docs/FAQ.md', 'harness/scenarios/x.json', 'tests/fixtures/liveness-allowlist.json', '.github/workflows/ci.yml', 'tests/fixtures/coverage-policy.json', 'src/a.js'], { paths: ['docs/'] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.refused.map((x) => [x.file, x.reason]), [
      ['harness/scenarios/x.json', 'evaluator'], ['tests/fixtures/liveness-allowlist.json', 'evaluator'],
      ['.github/workflows/ci.yml', 'evaluator'], ['tests/fixtures/coverage-policy.json', 'evaluator'], ['src/a.js', 'outside_lane'],
    ]);
  });

  test('a run that turns a canary mutant green is refused (canary gaming)', () => {
    const before = { 'canary-null-guard': 'red', 'canary-off-by-one': 'red' };
    assert.equal(SC.canaryCheck(before, { 'canary-null-guard': 'red', 'canary-off-by-one': 'red' }).ok, true);
    const gamed = SC.canaryCheck(before, { 'canary-null-guard': 'green', 'canary-off-by-one': 'red' });
    assert.equal(gamed.ok, false);
    assert.deepEqual(gamed.gamed, ['canary-null-guard']);
  });

  test('there is no push path in the autopilot', () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'harness', 'autopilot')).filter((n) => n.endsWith('.cjs'))) {
      const src = fs.readFileSync(path.join(ROOT, 'harness', 'autopilot', f), 'utf8');
      assert.doesNotMatch(src, /['"`]push['"`]/, `${f} names a git push`);
      assert.doesNotMatch(src, /git push|gh pr create/, f);
    }
  });

  test('/execplan stages named files, never git add -A', () => {
    const t = fs.readFileSync(path.join(ROOT, '.claude', 'commands', 'execplan.md'), 'utf8');
    assert.doesNotMatch(t, /git add -A|git add \.(\s|$)|git add --all/m);
  });
});

describe('nothing under harness/autopilot ships', () => {
  test('npm pack --dry-run lists no harness file', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    // npm 11 prints an array of pack results; npm 12 (`latest` since 2026-10) an object keyed
    // by package name. The 3.37.0 publish failed on the runner's npm@latest at `[0].files`.
    const parsed = JSON.parse(out);
    const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
    assert.ok(entry && Array.isArray(entry.files), `npm pack --json gave no pack result: ${out.slice(0, 200)}`);
    const files = entry.files.map((f) => f.path.replace(/\\/g, '/'));
    assert.ok(files.length > 100, 'non-vacuity');
    assert.deepEqual(files.filter((f) => f.startsWith('harness/')), []);
  });
});

describe('S5: the weekly State of PAN', () => {
  function fixture() {
    const d = tmp();
    const st = path.join(d, 'harness', 'autopilot', 'state');
    fs.mkdirSync(st, { recursive: true });
    const w = (rel, rows) => fs.writeFileSync(path.join(d, rel), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    w('harness/autopilot/state/history.jsonl', [
      { ts: '2026-10-06T00:00:00Z', tests: 5800, fail: 0, line_coverage: 88.1 },
      { ts: '2026-10-13T00:00:00Z', tests: 5850, fail: 1, line_coverage: 88.4 },
      { ts: '2026-10-19T00:00:00Z', tests: 5911, fail: 0, line_coverage: 88.9 },
    ]);
    w('harness/prompt-mutants.jsonl', [{ ts: '2026-10-18T00:00:00Z', rule: 'agents/pan-x:1234abcd', verdict: 'decorative' }, { ts: '2026-10-18T00:00:00Z', rule: 'agents/pan-y:5678abcd', verdict: 'load_bearing' }]);
    w('harness/ledger.jsonl', [
      { signature: 'a1', scenario: 'quick-mode', detail: 'exit 1', first_seen: '2026-10-10T00:00:00Z' },
      { signature: 'b2', scenario: 'old', detail: 'x', first_seen: '2026-09-01T00:00:00Z', resolved_at: '2026-09-02T00:00:00Z' },
    ]);
    w('harness/autopilot/state/market-watch.json', [{ fired: [{ id: 'MI-040', at: '2026-10-17', note: 'latest 2.2.0' }] }]);
    w('harness/autopilot/state/bot-runs.jsonl', [{ ts: '2026-10-15T00:00:00Z', lane: 'docs', branch: 'bot/docs/r1', outcome: 'opened' }, { ts: '2026-10-16T00:00:00Z', lane: 'docs', branch: 'bot/docs/r1', outcome: 'merged' }]);
    w('harness/autopilot/state/spend.jsonl', [{ ts: '2026-10-15T00:00:00Z', lane: 'docs', usd: 1.25 }, { ts: '2026-09-15T00:00:00Z', lane: 'docs', usd: 9 }]);
    fs.mkdirSync(path.join(d, '.ci-local', 'scheduled', 'outdated'), { recursive: true });
    w('.ci-local/scheduled/outdated/last-run.json', [{ job: 'outdated', status: 'report', at: '2026-10-19T09:00:04.000Z', report: '.ci-local/scheduled/outdated/20261019-090004.md' }]);
    return d;
  }

  const SNAPSHOT = `# State of PAN — week ending 2026-10-20

## Suite
| Run | Tests | Failing | Line coverage |
|---|---|---|---|
| 2026-10-06 | 5800 | 0 | 88.1% |
| 2026-10-13 | 5850 | 1 | 88.4% |
| 2026-10-19 | 5911 | 0 | 88.9% |

Trend: +111 tests, coverage +0.8 points over 3 runs.

## Prompt mutants
- decorative: 1 (agents/pan-x:1234abcd)
- load-bearing: 1

## Surface
- drift: none

## Open harness findings
| Scenario | Detail | Age (days) |
|---|---|---|
| quick-mode | exit 1 | 10 |

## Fired WATCH triggers
- MI-040 (2026-10-17): latest 2.2.0

## Bot branches
- opened 1, merged 1, reverted 0

## Scheduled checks
- codescan: no run yet (\`npm run ci:schedule -- --install\`)
- outdated: report on 2026-10-19 — [report](../../../.ci-local/scheduled/outdated/20261019-090004.md)
- market-watch: no run yet (\`npm run ci:schedule -- --install\`)

## Autopilot spend
- this month: $1.25
`;

  test('the report of a fixture state is exactly the snapshot', () => {
    const d = fixture();
    assert.equal(SP.buildReport({ root: d, now: '2026-10-20', surfaceDrift: [] }), SNAPSHOT);
  });

  test('the same inputs give the same report', () => {
    const d = fixture();
    assert.equal(SP.buildReport({ root: d, now: '2026-10-20', surfaceDrift: [] }), SP.buildReport({ root: d, now: '2026-10-20', surfaceDrift: [] }));
  });
});
