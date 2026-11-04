/**
 * Tests for the self-recording step journal: a task commit's `PAN-Step:
 * <plan>/task-N` trailer is resume evidence on its own (journal.cjs
 * trailerIndex and resumePoint), merged with the journal, and seen by
 * open_work and hygiene H-15. Spec: docs/specs/self_recording_journal_featureai.md.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'pan-wizard-core', 'bin', 'lib');
const J = require(path.join(LIB, 'journal.cjs'));
const H = require(path.join(LIB, 'hygiene.cjs'));
const { openWork } = require(path.join(LIB, 'open-work.cjs'));
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let dir;
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
let n = 0;
/** Commit one new file with a message; returns the short sha. */
const commit = (msg) => { n++; write(`src/f${n}.js`, `module.exports = ${n};\n`); git('add', '.'); git('commit', '-qm', msg); return git('rev-parse', '--short', 'HEAD'); };
const task = (plan, ...steps) => commit(`feat(${plan}): work\n\n- change\n\n${steps.map((s) => `PAN-Step: ${plan}/${s}`).join('\n')}`);
const PLAN = '.planning/phases/03-api/03-02-plan.md';
const tools = (...args) => {
  const r = spawnSync(process.execPath, [TOOLS, ...args], { cwd: dir, encoding: 'utf-8' });
  return { status: r.status, json: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-trailers-'));
  n = 0;
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  write(PLAN, '---\nphase: 03\nplan: 02\n---\n<task type="auto">one</task>\n<task type="auto">two</task>\n<task type="auto">three</task>\n');
  commit('init');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('trailers as resume evidence', () => {
  test('two trailer commits and no journal file resume at task 3', () => {
    const s1 = task('03-02', 'task-1');
    const s2 = task('03-02', 'task-2');
    const rp = J.resumePoint(dir, '03-02');
    assert.equal(rp.journal, null);
    assert.equal(rp.resume_at, 'task-3');
    assert.deepEqual(rp.completed, [
      { step: 'task-1', source: 'trailer', commit: s1.slice(0, 7) },
      { step: 'task-2', source: 'trailer', commit: s2.slice(0, 7) },
    ]);
    assert.equal(rp.all_done, false);
  });

  test('a coalesced commit carries a line per task and completes each', () => {
    task('03-02', 'task-1', 'task-2', 'task-3');
    const rp = J.resumePoint(dir, '03-02');
    assert.deepEqual(rp.completed.map((c) => c.step), ['task-1', 'task-2', 'task-3']);
    assert.equal(rp.all_done, true);
  });

  test('where the journal and a trailer agree, the journal is the source', () => {
    const sha = task('03-02', 'task-1');
    assert.equal(J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', commit: sha }).recorded, true);
    const rp = J.resumePoint(dir, '03-02');
    assert.equal(rp.completed.length, 1);
    assert.equal(rp.completed[0].source, 'journal');
    assert.equal(rp.resume_at, 'task-2');
  });

  test('no trailers and no journal keeps today\'s output (resume_at null)', () => {
    commit('feat(03-02): untagged work');
    const rp = J.resumePoint(dir, '03-02');
    assert.deepEqual({ resume_at: rp.resume_at, completed: rp.completed, unverified: rp.unverified, all_done: rp.all_done },
      { resume_at: null, completed: [], unverified: [], all_done: false });
  });
});

describe('history changes', () => {
  test('a rebase leaves the journal\'s shas unreachable, and the rebased trailers still count', () => {
    git('checkout', '-qb', 'work');
    const s1 = task('03-02', 'task-1');
    J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', commit: s1 });
    git('checkout', '-q', '-');
    commit('chore: upstream change');
    git('checkout', '-q', 'work');
    git('rebase', '-q', '-');
    const rp = J.resumePoint(dir, '03-02');
    assert.deepEqual(rp.unverified, []);
    assert.equal(rp.completed[0].source, 'trailer');
    assert.notEqual(rp.completed[0].commit, s1.slice(0, 7));
    assert.equal(rp.resume_at, 'task-2');
  });

  test('a reverted task is open again, and reverting the revert completes it again', () => {
    task('03-02', 'task-1');
    const s2 = task('03-02', 'task-2');
    git('revert', '--no-edit', s2);
    assert.equal(J.resumePoint(dir, '03-02').resume_at, 'task-2');
    git('revert', '--no-edit', 'HEAD');
    assert.equal(J.resumePoint(dir, '03-02').resume_at, 'task-3');
  });

  test('a reverted commit recorded in the journal is unverified', () => {
    const s1 = task('03-02', 'task-1');
    J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', commit: s1 });
    git('revert', '--no-edit', s1);
    const rp = J.resumePoint(dir, '03-02');
    assert.equal(rp.resume_at, 'task-1');
    assert.match(rp.unverified[0].why, /reverted/);
  });

  test('a reset that drops the task commit drops its evidence', () => {
    task('03-02', 'task-1');
    task('03-02', 'task-2');
    git('reset', '-q', '--hard', 'HEAD~1');
    assert.equal(J.resumePoint(dir, '03-02').resume_at, 'task-2');
  });
});

describe('parsing', () => {
  test('an indented trailer (squash message) and a lower-case key count', () => {
    commit('squashed\n\n    feat(03-02): a\n\n    PAN-Step: 03-02/task-1\n\npan-step: 03-02/task-2');
    assert.equal(J.resumePoint(dir, '03-02').resume_at, 'task-3');
  });

  test('a malformed value or a trailer inside a longer line does not count', () => {
    commit('feat(03-02): x\n\nPAN-Step: 03-02 task-1\nsee PAN-Step: 03-02/task-2 later\nPAN-Step: 03-02/task-');
    const rp = J.resumePoint(dir, '03-02');
    assert.equal(rp.completed.length, 0);
    assert.equal(rp.resume_at, null);
  });

  test('decimal and letter plan ids round-trip', () => {
    write('.planning/phases/02.1-hotfix/02.1-03-plan.md', '<task type="auto">a</task>\n<task type="auto">b</task>\n');
    write('.planning/phases/04A-ui/04A-01-plan.md', '<task type="auto">a</task>\n<task type="auto">b</task>\n');
    task('02.1-03', 'task-1');
    task('04A-01', 'task-1', 'task-2');
    assert.equal(J.resumePoint(dir, '02.1-03').resume_at, 'task-2');
    assert.equal(J.resumePoint(dir, '04A-01').all_done, true);
  });

  test('a trailer for another plan never counts for this one', () => {
    write('.planning/phases/03-api/03-01-plan.md', '<task type="auto">a</task>\n');
    task('03-01', 'task-1');
    const rp = J.resumePoint(dir, '03-02');
    assert.equal(rp.resume_at, null);
    assert.deepEqual(rp.completed, []);
  });

  test('a trailer deeper than the scan window is not read', () => {
    task('03-02', 'task-1');
    commit('chore: a');
    commit('chore: b');
    assert.equal(J.resumePoint(dir, '03-02', { window: 2 }).resume_at, null);
    assert.equal(J.resumePoint(dir, '03-02', { window: 3 }).resume_at, 'task-2');
  });
});

describe('journal rows newer than the trailer commit', () => {
  const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
  const journalRow = (row) => {
    const f = path.join(dir, '.planning/phases/03-api/03-02-journal.jsonl');
    fs.appendFileSync(f, JSON.stringify({ seq: 1, run: '03-02', ...row }) + '\n');
  };

  test('a failed row after the task commit keeps the task open', () => {
    task('03-02', 'task-1');
    journalRow({ ts: new Date(Date.now() + 5000).toISOString(), step: 'task-1', event: 'failed' });
    assert.equal(J.resumePoint(dir, '03-02').resume_at, 'task-1');
  });

  test('a started row from before the task commit does not', () => {
    journalRow({ ts: ago(3600), step: 'task-1', event: 'started' });
    task('03-02', 'task-1');
    assert.equal(J.resumePoint(dir, '03-02').resume_at, 'task-2');
  });

  test('a forced row always wins over a trailer', () => {
    journalRow({ ts: ago(3600), step: 'task-1', event: 'forced' });
    task('03-02', 'task-1');
    assert.equal(J.resumePoint(dir, '03-02').resume_at, 'task-1');
  });
});

describe('index and its consumers', () => {
  test('not a git repo: empty index and today\'s output', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-trailers-nogit-'));
    try {
      fs.mkdirSync(path.join(plain, '.planning/phases/03-api'), { recursive: true });
      fs.writeFileSync(path.join(plain, PLAN), '<task type="auto">a</task>\n');
      const idx = J.trailerIndex(plain);
      assert.equal(idx.head, null);
      assert.equal(idx.steps.size, 0);
      assert.equal(J.resumePoint(plain, '03-02').resume_at, null);
    } finally { fs.rmSync(plain, { recursive: true, force: true }); }
  });

  test('a repository with no commits gives an empty index', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-trailers-empty-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: fresh });
      assert.equal(J.trailerIndex(fresh).steps.size, 0);
    } finally { fs.rmSync(fresh, { recursive: true, force: true }); }
  });

  test('one scan per HEAD: the index is reused until HEAD moves', () => {
    task('03-02', 'task-1');
    const a = J.trailerIndex(dir);
    assert.equal(J.trailerIndex(dir), a, 'same HEAD, same index object');
    task('03-02', 'task-2');
    const b = J.trailerIndex(dir);
    assert.notEqual(b, a);
    assert.ok(b.steps.has('03-02/task-2'));
  });

  test('open_work and init resume show a trailer-only plan\'s resume point', () => {
    task('03-02', 'task-1');
    const plans = openWork(dir).phase_plans;
    assert.equal(plans.length, 1);
    assert.equal(plans[0].resume_at, 'task-2');
    assert.equal(plans[0].completed_steps[0].source, 'trailer');
    const r = tools('init', 'resume');
    assert.equal(r.json.open_work.phase_plans[0].resume_at, 'task-2');
  });

  test('a plan with a summary is not visited', () => {
    task('03-02', 'task-1');
    write('.planning/phases/03-api/03-02-summary.md', '# done\n');
    assert.deepEqual(J.journalsIn(dir, path.join(dir, '.planning/phases/03-api')), {});
  });

  test('journal resume-point reports trailer evidence through the CLI', () => {
    task('03-02', 'task-1', 'task-2');
    const r = tools('journal', 'resume-point', '--plan', '03-02');
    assert.equal(r.status, 0);
    assert.equal(r.json.resume_at, 'task-3');
    assert.deepEqual(r.json.completed.map((c) => c.source), ['trailer', 'trailer']);
  });
});

describe('hygiene H-15 with trailer evidence', () => {
  const day = 86400000;
  test('a trailer-only plan idle for over a day is reported against its plan file', () => {
    task('03-02', 'task-1');
    const f = H.checkDurableState(dir, Date.now() + 2 * day).findings.filter((x) => x.check === 'journal-abandoned');
    assert.equal(f.length, 1);
    assert.equal(f[0].path, '.planning/phases/03-api/03-02-plan.md');
    assert.match(f[0].detail, /last committed task-1/);
  });

  test('a fresh trailer-only plan is not reported', () => {
    task('03-02', 'task-1');
    const f = H.checkDurableState(dir, Date.now()).findings.filter((x) => x.check === 'journal-abandoned');
    assert.equal(f.length, 0);
  });
});

describe('large histories and failed scans (PAN-25, DD-11)', () => {
  test('a log of bodies over 1 MiB still indexes the trailers', () => {
    task('03-02', 'task-1');
    const big = 'x'.repeat(120 * 1024);
    // A message file: a 120 KB argument is past Windows' command-line limit.
    const msg = path.join(dir, '..', `${path.basename(dir)}-msg.txt`);
    try {
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(msg, `docs: long note ${i}\n\n${big}\n`);
        n++; write(`src/f${n}.js`, `module.exports = ${n};\n`); git('add', '.'); git('commit', '-q', '-F', msg);
      }
    } finally { fs.rmSync(msg, { force: true }); }
    task('03-02', 'task-2');
    const total = execFileSync('git', ['log', '--format=%B', 'HEAD'], { cwd: dir, maxBuffer: 64 * 1024 * 1024 }).length;
    assert.ok(total > 1024 * 1024, `history bodies are ${total} bytes`);
    const rp = J.resumePoint(dir, '03-02');
    assert.equal(rp.trailer_scan, undefined);
    assert.equal(rp.resume_at, 'task-3');
    assert.deepEqual(rp.completed.map((c) => c.step), ['task-1', 'task-2']);
  });

  test('the window still lists every commit, not only the matching ones', () => {
    task('03-02', 'task-1');
    commit('chore: a');
    assert.equal(J.trailerIndex(dir).shas.length, 3, 'init, the task and the chore');
  });

  test('a scan that overruns its buffer reports trailer_scan_failed', () => {
    task('03-02', 'task-1');
    const idx = J.trailerIndex(dir, { maxBuffer: 16 });
    assert.equal(idx.error, 'trailer_scan_failed');
    assert.match(idx.reason, /ENOBUFS/);
    assert.equal(J.resumePoint(dir, '03-02', { maxBuffer: 16 }).trailer_scan.error, 'trailer_scan_failed');
  });

  /** Break the history below HEAD: rev-parse still answers, git log does not. */
  const breakHistory = () => {
    const root = git('rev-list', '--max-parents=0', 'HEAD');
    fs.rmSync(path.join(dir, '.git', 'objects', root.slice(0, 2), root.slice(2)), { force: true });
  };

  test('a failed scan surfaces through resume-point, open_work and hygiene, not as nothing done', () => {
    task('03-02', 'task-1');
    task('03-02', 'task-2');
    breakHistory();
    const r = tools('journal', 'resume-point', '--plan', '03-02');
    assert.equal(r.json.trailer_scan.error, 'trailer_scan_failed');
    const raw = spawnSync(process.execPath, [TOOLS, 'journal', 'resume-point', '--plan', '03-02', '--raw'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(raw.stdout.trim(), 'trailer_scan_failed');
    const plans = openWork(dir).phase_plans;
    assert.equal(plans.length, 1);
    assert.equal(plans[0].trailer_scan.error, 'trailer_scan_failed');
    const f = H.checkDurableState(dir, Date.now()).findings.filter((x) => x.check === 'trailer-scan-failed');
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, 'warn');
  });

  test('the grep still finds indented squash trailers and reverts', () => {
    commit('squashed (#7)\n\n* feat(03-02): a\n\n    PAN-Step: 03-02/task-1\n\n* feat(03-02): b\n\n    PAN-Step: 03-02/task-2');
    const s3 = task('03-02', 'task-3');
    git('revert', '--no-edit', s3);
    const rp = J.resumePoint(dir, '03-02');
    assert.deepEqual(rp.completed.map((c) => c.step), ['task-1', 'task-2']);
    assert.equal(rp.resume_at, 'task-3');
  });
});

describe('trailer order (DD-13)', () => {
  test('PAN-Step after Co-Authored-By counts', () => {
    commit('feat(03-02): a\n\n- change\n\nCo-Authored-By: Someone <s@example.com>\nPAN-Step: 03-02/task-1');
    assert.equal(J.resumePoint(dir, '03-02').resume_at, 'task-2');
  });

  test('PAN-Step first, Co-Authored-By after, counts', () => {
    commit('feat(03-02): a\n\n- change\n\nPAN-Step: 03-02/task-1\nPAN-Step: 03-02/task-2\nCo-Authored-By: Someone <s@example.com>');
    assert.equal(J.resumePoint(dir, '03-02').resume_at, 'task-3');
  });
});
