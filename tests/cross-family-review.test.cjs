/**
 * Program R4: a cross-family reviewer lane, opt-in per project.
 *
 * `pan-tools review cross-family <phase>` runs the phase review on another host's CLI
 * (a different model family), read-only, with the argv from hosts.cjs. It is off unless
 * `workflow.cross_family_review` names a host. Code gate: tier-0 argv tests (`--dry-run`
 * prints the argv and spawns nothing) and the lane off by default. The evidence gate (one
 * paid lane run with a ledger row) waits for an approved run.
 */
'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const P = 'PROMPT';

describe('the lane is off by default (R4)', () => {
  test('config default and template say off', () => {
    const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'pan-wizard-core', 'templates', 'config.json'), 'utf8'));
    assert.equal(tpl.workflow.cross_family_review, 'off');
    const src = fs.readFileSync(path.join(ROOT, 'pan-wizard-core', 'bin', 'lib', 'config.cjs'), 'utf8');
    assert.match(src, /cross_family_review: 'off'/);
  });
});

describe('read-only review argv per host (R4)', () => {
  const { HOSTS } = require('../pan-wizard-core/bin/lib/hosts.cjs');
  const SNAPSHOT = {
    claude: { promptVia: 'stdin', args: ['-p', '--allowedTools', 'Read,Grep,Glob', '--output-format', 'text'] },
    codex: { promptVia: 'stdin', args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'] },
    gemini: { promptVia: 'stdin', args: ['-p', 'Review the change on standard input. Reply with the pan-verdict block only.'] },
    copilot: { promptVia: 'arg', args: ['-p', P] },
    opencode: { promptVia: 'arg', args: ['run', P] },
  };
  for (const [host, want] of Object.entries(SNAPSHOT)) {
    test(`${host}: no write or auto-approve flag`, () => {
      const r = HOSTS[host].review;
      assert.equal(r.promptVia, want.promptVia);
      const args = r.args(P);
      assert.deepEqual(args, want.args);
      for (const a of args) assert.doesNotMatch(a, /yolo|dangerously|allow-all|bypass/i, `${host}: ${a}`);
    });
  }
  test('every host names its model family', () => {
    for (const [host, h] of Object.entries(HOSTS)) assert.ok(typeof h.family === 'string' && h.family, host);
    assert.equal(HOSTS.claude.family, 'anthropic');
    assert.equal(HOSTS.codex.family, 'openai');
    assert.equal(HOSTS.gemini.family, 'google');
  });
});

describe('review cross-family (R4)', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-xfam-'));
    const p = path.join(dir, '.planning');
    fs.mkdirSync(path.join(p, 'phases', '01-a'), { recursive: true });
    fs.writeFileSync(path.join(p, 'roadmap.md'), '# Roadmap\n\n### Phase 1: A\n**Goal:** g\n');
    fs.writeFileSync(path.join(p, 'phases', '01-a', '01-01-plan.md'), '---\nphase: 01\n---\n<objective>\nAdd a.\n</objective>\n');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // An error result exits non-zero with its JSON on stdout.
  const run = (args) => JSON.parse(spawnSync(process.execPath, [TOOLS, ...args, '--cwd', dir], { encoding: 'utf8' }).stdout);
  const setLane = (v) => fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ workflow: { cross_family_review: v } }));

  test('with the lane off it runs nothing and says so', () => {
    setLane('off');
    const r = run(['review', 'cross-family', '1', '--dry-run']);
    assert.equal(r.enabled, false);
    assert.equal(r.reason, 'lane_off');
  });

  test('with a host set, --dry-run prints the lane, family and argv and spawns nothing', () => {
    setLane('codex');
    const r = run(['review', 'cross-family', '1', '--dry-run']);
    assert.equal(r.enabled, true);
    assert.equal(r.lane, 'cross-family:codex');
    assert.equal(r.host, 'codex');
    assert.equal(r.family, 'openai');
    assert.equal(r.bin, 'codex');
    assert.deepEqual(r.argv, ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-']);
    assert.equal(r.prompt_via, 'stdin');
    assert.match(r.prompt, /pan-verdict/);
    assert.match(r.prompt, /Add a\./, 'the plans\' intent is in the prompt');
    assert.equal(r.dry_run, true);
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'reviews', '01', 'cross-family-codex.md')), false);
  });

  test('--host overrides the configured host; an unknown host is refused', () => {
    setLane('codex');
    assert.equal(run(['review', 'cross-family', '1', '--dry-run', '--host', 'gemini']).host, 'gemini');
    const bad = run(['review', 'cross-family', '1', '--dry-run', '--host', 'nope']);
    assert.equal(bad.error, 'unknown_host');
  });
});

describe('a lane run against a stand-in host CLI (R4, tier 0)', () => {
  let dir;
  let binDir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-xfam-run-'));
    const p = path.join(dir, '.planning');
    fs.mkdirSync(path.join(p, 'phases', '01-a'), { recursive: true });
    fs.writeFileSync(path.join(p, 'roadmap.md'), '# Roadmap\n\n### Phase 1: A\n**Goal:** g\n');
    fs.writeFileSync(path.join(p, 'phases', '01-a', '01-01-plan.md'), '---\nphase: 01\n---\n<objective>\nAdd a.\n</objective>\n');
    fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ workflow: { cross_family_review: 'codex' } }));
    // A stand-in \`codex\` that answers with a verdict block, whatever it is asked.
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-xfam-bin-'));
    const verdict = JSON.stringify({ contract: '1.0', agent: 'cross-family-reviewer', phase: '01', verdict: 'NEEDS_FIXES', outcome: 'fail', findings: [{ class: 'defect', severity: 'high', where: 'src/a.js:3', summary: 'off by one' }] });
    const answer = path.join(binDir, 'answer.txt');
    fs.writeFileSync(answer, 'Review done.\n\n\u0060\u0060\u0060pan-verdict\n' + verdict + '\n\u0060\u0060\u0060\n');
    const js = path.join(binDir, 'codex-stand-in.js');
    fs.writeFileSync(js, `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(require('fs').readFileSync(${JSON.stringify(answer)},'utf8')));`);
    if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "${js}" %*\r\n`);
    else { fs.writeFileSync(path.join(binDir, 'codex'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); fs.chmodSync(path.join(binDir, 'codex'), 0o755); }
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(binDir, { recursive: true, force: true }); });

  test('the verdict is parsed, reported per rep, and written for review-deep', () => {
    const env = { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, PAN_STANDIN_DIR: binDir };
    const res = spawnSync(process.execPath, [TOOLS, 'review', 'cross-family', '1', '--reps', '2', '--cwd', dir], { encoding: 'utf8', env });
    const r = JSON.parse(res.stdout);
    assert.equal(r.lane, 'cross-family:codex');
    assert.equal(r.reps, 2);
    assert.deepEqual(r.runs.map((x) => x.verdict), ['NEEDS_FIXES', 'NEEDS_FIXES']);
    assert.equal(r.verdict, 'NEEDS_FIXES');
    const file = path.join(dir, r.file);
    const { mergeReviews } = require('../pan-wizard-core/bin/lib/review-deep.cjs');
    const m = mergeReviews('', '', '', fs.readFileSync(file, 'utf8'));
    assert.equal(m.coverage.by_source.cross_family, 1, 'review-deep reads the lane file');
    assert.equal(m.findings[0].file, 'src/a.js');
  });
});

describe('review-deep merges the lane as a fourth source (R4)', () => {
  const { mergeReviews } = require('../pan-wizard-core/bin/lib/review-deep.cjs');
  test('cross-family findings count and drive the verdict', () => {
    const cross = [{ source: 'cross-family', severity: 'high', category: 'bug', description: 'd', file: 'a.js', line: 3, rationale: null }];
    const m = mergeReviews([], [], [], cross);
    assert.equal(m.coverage.by_source.cross_family, 1);
    assert.equal(m.verdict, 'review_required');
  });
  test('the review-deep command runs the lane when the project turned it on', () => {
    const t = fs.readFileSync(path.join(ROOT, 'commands', 'pan', 'review-deep.md'), 'utf8');
    assert.match(t, /review cross-family/);
    assert.match(t, /--cross-file/);
  });
});
