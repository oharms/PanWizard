// Field report on 3.42.1: five places where finished, verified work could not be
// recorded without hand edits.
//   1. requirements with Go or shell tests stayed `not_checked` at `phase complete`:
//      `workflow.test_file_command` had only `{file}`, and Go runs a package folder.
//      Now `{dir}`, and the phase's passed engine test run counts for a test file no
//      per-file command can run.
//   2. a comment-only change made the verification stale; `verify refresh` moves it.
//   3. `roadmap update-plan-progress` ticked the phase "(completed DATE)" before it
//      was verified; it now records `Executed`, and only `phase complete` ticks.
//   4. `test run` stopped at a fixed 15 minutes; `workflow.test_timeout_minutes`.
//   5. `validate health` warned on shipped milestones' phases; they fold into I008/I009.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runPanTools, createTempProject, cleanup, gateOff } = require('./helpers.cjs');
const TG = require('../pan-wizard-core/bin/lib/test-gate.cjs');
const RL = require('../pan-wizard-core/bin/lib/requirements-lint.cjs');
const VS = require('../pan-wizard-core/bin/lib/verify-scope.cjs');
const { shippedMilestonePhases } = require('../pan-wizard-core/bin/lib/verify.cjs');

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');
const git = (dir, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const json = (r) => { assert.ok(r.output, r.error); return JSON.parse(r.output); };
function gitInit(dir) {
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init', '--allow-empty');
  return git(dir, 'rev-parse', 'HEAD');
}

// ─── 1. Requirements whose tests no per-file command can run ────────────────

describe('item 1: test_file_command {dir} placeholder', () => {
  test('{dir} is the test file\'s folder as ./dir, quoted', () => {
    const r = TG.fileCommand('.', 'internal/store/store_test.go', { workflow: { test_file_command: 'go test {dir}' } });
    assert.equal(r.command, 'go test "./internal/store"');
  });

  test('{dir} of a file at the root is .', () => {
    assert.equal(TG.fileCommand('.', 'main_test.go', { workflow: { test_file_command: 'go test {dir}' } }).command, 'go test "."');
  });

  test('a Windows path gives the same forward-slash folder', () => {
    assert.equal(TG.fileCommand('.', 'pkg\\api\\api_test.go', { workflow: { test_file_command: 'go test {dir}' } }).command, 'go test "./pkg/api"');
  });

  test('{file} and {dir} both fill in', () => {
    const r = TG.fileCommand('.', 'tests/a.sh', { workflow: { test_file_command: 'cd {dir} && bash {file}' } });
    assert.equal(r.command, 'cd "./tests" && bash "tests/a.sh"');
  });

  test('a command with neither placeholder names both in its reason', () => {
    const r = TG.fileCommand('.', 'tests/a.sh', { workflow: { test_file_command: 'make check' } });
    assert.equal(r.command, null);
    assert.match(r.reason, /\{file\} or \{dir\}/);
  });
});

describe('item 1: a passed engine test run counts for a test no command can run', () => {
  let tmp; let head;
  const REQS = [
    '# Requirements', '',
    '- [ ] **OPS-01**: Backups run',
    '  - WHEN the nightly job fires THE SYSTEM SHALL write a backup',
    '  - Test: scripts/backup_test.sh', '',
    '## Traceability', '',
    '| Requirement | Phase | Status |',
    '|-------------|-------|--------|',
    '| OPS-01 | Phase 1 | Pending |', '',
  ].join('\n');
  const record = (status, extra = {}) => write(tmp, '.planning/phases/01-ops/01-test-run.json', JSON.stringify({ version: 1, kind: 'run', command: 'make test', head, status, failing: [], preexisting_failures: [], ...extra }));
  beforeEach(() => {
    tmp = createTempProject();
    write(tmp, '.planning/requirements.md', REQS);
    // A Makefile suite: no derived per-file command, and no test_file_command.
    write(tmp, 'Makefile', 'test:\n\tbash scripts/backup_test.sh\n');
    write(tmp, 'scripts/backup_test.sh', 'exit 0\n');
    write(tmp, '.planning/phases/01-ops/01-01-plan.md', '# plan\n');
    head = gitInit(tmp);
  });
  afterEach(() => cleanup(tmp));

  test('without a phase the test stays not_checked, with the reason', () => {
    const d = RL.tickDecisions(tmp, ['OPS-01']).get('OPS-01');
    assert.equal(d.allowed, false);
    assert.equal(d.status, 'not_checked');
    assert.match(d.not_checked[0].reason, /test_file_command with a \{file\} or \{dir\}/);
  });

  test('with the phase and a passed run, the requirement may be ticked', () => {
    record('passed');
    const d = RL.tickDecisions(tmp, ['OPS-01'], { phase: '1' }).get('OPS-01');
    assert.equal(d.allowed, true);
    assert.equal(d.status, 'passed');
  });

  test('a failed run is no evidence', () => {
    record('failed');
    assert.equal(RL.tickDecisions(tmp, ['OPS-01'], { phase: '1' }).get('OPS-01').allowed, false);
  });

  test('a pre-existing failure naming the file is no evidence', () => {
    record('passed', { preexisting_failures: ['scripts/backup_test.sh > nightly'] });
    assert.equal(RL.suiteRunEvidence(tmp, 'scripts/backup_test.sh', '1'), null);
  });

  test('a Go failure naming the test file\'s package folder is no evidence; a sibling folder is', () => {
    record('passed', { preexisting_failures: ['example.com/app/scripts > TestX'] });
    assert.equal(RL.suiteRunEvidence(tmp, 'scripts/backup_test.sh', '1'), null);
    record('passed', { preexisting_failures: ['example.com/app/scripts2 > TestX'] });
    assert.equal(RL.suiteRunEvidence(tmp, 'scripts/backup_test.sh', '1').via, 'suite_run');
  });

  test('a test file edited since the run is no evidence', () => {
    record('passed');
    write(tmp, 'scripts/backup_test.sh', 'exit 1\n');
    assert.equal(RL.suiteRunEvidence(tmp, 'scripts/backup_test.sh', '1'), null);
  });

  test('phase complete ticks it (it held it as not_checked before)', () => {
    gateOff(tmp);
    write(tmp, '.planning/roadmap.md', '# Roadmap\n\n- [ ] **Phase 1: Ops**\n\n### Phase 1: Ops\n**Requirements:** OPS-01\n**Plans:** 1 plans\n');
    write(tmp, '.planning/phases/01-ops/01-01-summary.md', '# summary\n');
    git(tmp, 'add', '-A'); git(tmp, 'commit', '-q', '-m', 'work');
    head = git(tmp, 'rev-parse', 'HEAD');
    record('passed');
    const r = runPanTools('phase complete 1 --no-commit', tmp);
    assert.ok(r.success, r.error || r.output);
    assert.match(read(tmp, '.planning/requirements.md'), /- \[x\] \*\*OPS-01\*\*/);
  });
});

// ─── 2. verify refresh ──────────────────────────────────────────────────────

describe('item 2: verify refresh moves a verification past comment-only changes', () => {
  let tmp; let verified;
  const VER = '.planning/phases/01-core/01-verification.md';
  beforeEach(() => {
    tmp = createTempProject();
    write(tmp, '.planning/phases/01-core/01-01-plan.md', '---\nfiles_modified:\n  - src/a.go\n---\n# plan\n');
    write(tmp, '.planning/phases/01-core/01-01-summary.md', '# summary\n');
    write(tmp, 'src/a.go', 'package a\n\n// Sum adds tow numbers.\nfunc Sum(a, b int) int { return a + b } // fast\n');
    verified = gitInit(tmp);
    write(tmp, VER, `---\nstatus: passed\nverified_commit: ${verified}\ntest_gate: passed\n---\n# Verification\n`);
    git(tmp, 'add', '-A'); git(tmp, 'commit', '-q', '-m', 'verify');
  });
  afterEach(() => cleanup(tmp));

  test('a fixed comment word: refreshed to HEAD, the old commit and reason recorded', () => {
    write(tmp, 'src/a.go', 'package a\n\n// Sum adds two numbers.\nfunc Sum(a, b int) int { return a + b } // quick\n');
    git(tmp, 'commit', '-qam', 'typo');
    assert.equal(json(runPanTools('verify stale 1', tmp)).state, 'stale');
    const out = json(runPanTools('verify refresh 1 --reason "typo in a comment"', tmp));
    assert.equal(out.refreshed, true);
    const head = git(tmp, 'rev-parse', 'HEAD');
    const text = read(tmp, VER);
    assert.match(text, new RegExp(`verified_commit: ${head}`));
    assert.match(text, new RegExp(`refreshed_from: ${verified}`));
    assert.match(text, /refresh_reason: .*typo in a comment/);
    assert.equal(json(runPanTools('verify stale 1', tmp)).state, 'fresh');
  });

  test('a changed line of code is refused with code_changed and the file named', () => {
    write(tmp, 'src/a.go', 'package a\n\n// Sum adds tow numbers.\nfunc Sum(a, b int) int { return a - b } // fast\n');
    git(tmp, 'commit', '-qam', 'bug');
    const out = json(runPanTools('verify refresh 1 --reason "just a comment"', tmp));
    assert.equal(out.error, 'code_changed');
    assert.deepEqual(out.code_changes.map((c) => c.file), ['src/a.go']);
    assert.match(read(tmp, VER), new RegExp(`verified_commit: ${verified}`), 'the verification is untouched');
  });

  test('an uncommitted comment edit is refused: the commit must hold it', () => {
    write(tmp, 'src/a.go', 'package a\n\n// Sum adds two numbers.\nfunc Sum(a, b int) int { return a + b } // fast\n');
    assert.equal(json(runPanTools('verify refresh 1 --reason "typo"', tmp)).error, 'uncommitted_changes');
  });

  test('no --reason is refused', () => {
    assert.equal(json(runPanTools('verify refresh 1', tmp)).error, 'reason_required');
  });

  test('a fresh verification is left alone', () => {
    const out = json(runPanTools('verify refresh 1 --reason "nothing"', tmp));
    assert.equal(out.refreshed, false);
    assert.equal(out.state, 'fresh');
  });
});

describe('item 2: commentOnlyDiff', () => {
  const diff = (file, removed, added, header = '') => `diff --git a/${file} b/${file}\n${header}--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${removed.map((l) => `-${l}`).join('\n')}\n${added.map((l) => `+${l}`).join('\n')}\n`;

  test('a trailing comment changed after unchanged code is comment-only', () => {
    assert.equal(VS.commentOnlyDiff(diff('a.py', ['x = 1  # old'], ['x = 1  # new'])).ok, true);
  });

  test('block-comment lines are comment-only; `*p++` is code', () => {
    assert.equal(VS.commentOnlyDiff(diff('a.c', [' * old text'], [' * new text'])).ok, true);
    assert.equal(VS.commentOnlyDiff(diff('a.c', ['*p++;'], ['*q++;'])).ok, false);
  });

  test('a URL is code, not a comment', () => {
    assert.equal(VS.commentOnlyDiff(diff('a.js', ['const u = "http://a";'], ['const u = "http://b";'])).ok, false);
  });

  test('a file type with no known comment syntax is never comment-only', () => {
    assert.equal(VS.commentOnlyDiff(diff('notes.txt', ['a'], ['b'])).ok, false);
  });

  test('a new file is never comment-only', () => {
    assert.equal(VS.commentOnlyDiff(diff('a.js', [], ['// hi'], 'new file mode 100644\n')).ok, false);
  });
});

// ─── 3. update-plan-progress records Executed, not Complete ─────────────────

describe('item 3: roadmap update-plan-progress does not complete the phase', () => {
  let tmp;
  const ROADMAP = [
    '# Roadmap', '',
    '- [ ] **Phase 1: Core** - core', '',
    '### Phase 1: Core',
    '**Plans:** 0 plans', '',
    '## Progress', '',
    '| Phase | Plans Complete | Status | Completed |',
    '|-------|----------------|--------|-----------|',
    '| 1. Core | 0/1 | Not started | - |', '',
  ].join('\n');
  beforeEach(() => {
    tmp = createTempProject();
    write(tmp, '.planning/roadmap.md', ROADMAP);
    write(tmp, '.planning/phases/01-core/01-01-plan.md', '# plan\n');
    write(tmp, '.planning/phases/01-core/01-01-summary.md', '# summary\n');
  });
  afterEach(() => cleanup(tmp));

  test('every plan executed: Executed, unticked, undated', () => {
    const out = json(runPanTools('roadmap update-plan-progress 1', tmp));
    assert.equal(out.status, 'Executed');
    assert.equal(out.complete, false);
    assert.equal(out.all_plans_executed, true);
    const roadmap = read(tmp, '.planning/roadmap.md');
    assert.match(roadmap, /^- \[ \] \*\*Phase 1: Core\*\* - core$/m);
    assert.doesNotMatch(roadmap, /\(completed /);
    assert.match(roadmap, /^\| 1\. Core \| 1\/1 \| Executed \|  \|$/m);
    assert.match(roadmap, /^\*\*Plans:\*\* 1\/1 plans executed$/m);
  });

  test('a phase phase complete already ticked stays Complete with its own date', () => {
    write(tmp, '.planning/roadmap.md', ROADMAP.replace('- [ ] **Phase 1', '- [x] **Phase 1').replace('| 0/1 | Not started | - |', '| 1/1 | Complete | 2026-10-01 |'));
    const out = json(runPanTools('roadmap update-plan-progress 1', tmp));
    assert.equal(out.status, 'Complete');
    assert.match(read(tmp, '.planning/roadmap.md'), /^\| 1\. Core \| 1\/1 \| Complete \| 2026-10-01 \|$/m);
  });

  test('phase complete then ticks and dates it', () => {
    gateOff(tmp);
    runPanTools('roadmap update-plan-progress 1', tmp);
    const r = runPanTools('phase complete 1 --no-commit', tmp);
    assert.ok(r.success, r.error || r.output);
    const roadmap = read(tmp, '.planning/roadmap.md');
    assert.match(roadmap, /^- \[x\] \*\*Phase 1: Core\*\* - core \(completed \d{4}-\d{2}-\d{2}\)$/m);
    assert.match(roadmap, /^\| 1\. Core \| 1\/1 \| Complete \| \d{4}-\d{2}-\d{2} \|$/m);
  });
});

// ─── 4. Configurable suite timeout ──────────────────────────────────────────

describe('item 4: workflow.test_timeout_minutes', () => {
  test('minutes become milliseconds; absent, zero or junk is null', () => {
    assert.equal(TG.configuredTimeoutMs({ workflow: { test_timeout_minutes: 30 } }), 1800000);
    assert.equal(TG.configuredTimeoutMs({ workflow: { test_timeout_minutes: '0.5' } }), 30000);
    assert.equal(TG.configuredTimeoutMs({ workflow: {} }), null);
    assert.equal(TG.configuredTimeoutMs({ workflow: { test_timeout_minutes: 0 } }), null);
    assert.equal(TG.configuredTimeoutMs({ workflow: { test_timeout_minutes: 'long' } }), null);
  });

  test('test run stops at the configured limit and says which key raises it', () => {
    const tmp = createTempProject();
    try {
      write(tmp, '.planning/config.json', JSON.stringify({ workflow: { test_timeout_minutes: 0.01 } }));
      write(tmp, 'slow.js', 'setTimeout(() => {}, 20000);\n');
      const r = runPanTools('test run --command "node slow.js"', tmp);
      const out = json(r);
      assert.equal(out.timed_out, true);
      assert.equal(out.timeout_ms, 600);
      assert.equal(out.status, 'failed');
      assert.match(out.reason, /timed out after 0\.6 s; raise workflow\.test_timeout_minutes/);
    } finally { cleanup(tmp); }
  });

  test('--timeout still wins over the config', () => {
    const tmp = createTempProject();
    try {
      write(tmp, '.planning/config.json', JSON.stringify({ workflow: { test_timeout_minutes: 60 } }));
      write(tmp, 'slow.js', 'setTimeout(() => {}, 20000);\n');
      const out = json(runPanTools('test run --timeout 500 --command "node slow.js"', tmp));
      assert.equal(out.timeout_ms, 500);
      assert.equal(out.timed_out, true);
    } finally { cleanup(tmp); }
  });

  test('validate health does not call the key unknown', () => {
    const tmp = createTempProject();
    try {
      write(tmp, '.planning/config.json', JSON.stringify({ workflow: { test_timeout_minutes: 30 } }));
      const out = json(runPanTools('validate health', tmp));
      const unknown = [...(out.info || []), ...(out.warnings || [])].filter((i) => i.code === 'I006');
      assert.ok(!unknown.some((i) => /test_timeout_minutes/.test(i.message)), JSON.stringify(unknown));
    } finally { cleanup(tmp); }
  });
});

// ─── 5. Shipped milestones in validate health ───────────────────────────────

describe('item 5: shipped milestones fold into I008 / I009', () => {
  const ROADMAP = [
    '# Roadmap', '',
    '## Milestones', '',
    '- ✅ **v1.0 MVP** - Phases 13-15 (shipped 2026-06-01)',
    '- 🚧 **v2.0 Next** - Phases 50-52 (in progress)', '',
    '## Phases', '',
    '<details>',
    '<summary>✅ v0.9 Early - SHIPPED</summary>', '',
    '### Phase 34: Retired', '',
    '</details>', '',
    '### 🚧 v2.0 Next (In Progress)', '',
    '- [x] **Phase 13: A**',
    '- [ ] **Phase 50: Now**', '',
    '#### Phase 13: A',
    '#### Phase 14: B',
    '#### Phase 15: C',
    '#### Phase 34: Retired again',
    '#### Phase 35: Lost',
    '#### Phase 50: Now',
    '#### Phase 51: Unverified', '',
  ].join('\n');

  test('shippedMilestonePhases reads ranges and shipped <details> blocks', () => {
    const f = shippedMilestonePhases(ROADMAP);
    assert.equal(f('13'), 'v1.0');
    assert.equal(f('15'), 'v1.0');
    assert.equal(f('14.1'), 'v1.0');
    assert.equal(f('34'), 'v0.9');
    assert.equal(f('35'), null);
    assert.equal(f('50'), null, 'an in-progress milestone is not shipped');
    assert.equal(f('51'), null);
  });

  test('validate health: one info line per check for shipped phases, warnings for the rest', () => {
    const tmp = createTempProject();
    try {
      write(tmp, '.planning/project.md', '# P\n\n## What This Is\nx\n\n## Core Value\nx\n\n## Requirements\nx\n');
      write(tmp, '.planning/roadmap.md', ROADMAP);
      write(tmp, '.planning/state.md', '# State\n\n**Current Phase:** 51\n');
      write(tmp, '.planning/config.json', JSON.stringify({ workflow: { verifier: true } }));
      for (const [dir, n] of [['13-a', '13'], ['14-b', '14'], ['15-c', '15'], ['50-now', '50'], ['51-unverified', '51']]) {
        write(tmp, `.planning/phases/${dir}/${n}-01-plan.md`, '# plan\n');
        write(tmp, `.planning/phases/${dir}/${n}-01-summary.md`, '# summary\n');
      }
      write(tmp, '.planning/phases/50-now/50-verification.md', '---\nstatus: passed\n---\n');
      const out = json(runPanTools('validate health', tmp));
      const all = [...(out.errors || []), ...(out.warnings || []), ...(out.info || [])];
      const of = (code) => all.filter((i) => i.code === code);
      assert.deepEqual(of('VERIFICATION_GATE_MISSING').map((i) => i.message.match(/Phase (\S+)/)[1]), ['51']);
      assert.equal(of('I008').length, 1);
      assert.match(of('I008')[0].message, /13, 14, 15/);
      assert.deepEqual(of('W006').map((i) => i.message.match(/Phase (\S+)/)[1]), ['35']);
      assert.equal(of('I009').length, 1);
      assert.match(of('I009')[0].message, /\b34\b/);
    } finally { cleanup(tmp); }
  });

  test('a phase folder archived under milestones/vX-phases/ counts as on disk', () => {
    const tmp = createTempProject();
    try {
      write(tmp, '.planning/roadmap.md', '# Roadmap\n\n### Phase 1: A\n### Phase 2: B\n');
      write(tmp, '.planning/state.md', '# State\n\n**Current Phase:** 2\n');
      write(tmp, '.planning/milestones/v1.0-phases/01-a/01-01-plan.md', '# plan\n');
      write(tmp, '.planning/phases/02-b/02-01-plan.md', '# plan\n');
      const out = json(runPanTools('validate health', tmp));
      const w006 = [...(out.warnings || [])].filter((i) => i.code === 'W006');
      assert.deepEqual(w006, []);
    } finally { cleanup(tmp); }
  });
});
