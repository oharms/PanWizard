/**
 * research-questions.test.cjs — research is opt-in, question-driven and bounded.
 *
 * The owner, 2026-10-25: PAN's research "never technically finished; the planning
 * became perpetual". The researchers ended on coverage checklists with no stop rule,
 * new-project spawned four researchers and a synthesizer (and researched by default in
 * auto mode, putting "table stakes" into v1), and plan-phase researched every phase.
 * Now research is off by default; when it runs, the workflow writes at most five
 * blocking questions, ONE researcher answers each with a source or an assumption, at
 * most four searches or fetches per question, and `research check` holds it to that.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

let dir;
beforeEach(() => { dir = createTempProject(); });
afterEach(() => cleanup(dir));

function cli(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [TOOLS_PATH, ...args], { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '').trim() };
  }
}

const HEADER = '| # | Question | Answer | Source | Confidence | Decision it settles |\n|---|---|---|---|---|---|\n';
function write(name, text) { fs.writeFileSync(path.join(dir, name), text); return name; }
function questions(n) {
  return write('questions.md', '# Research questions\n\n' + Array.from({ length: n }, (_, i) => `${i + 1}. Question ${i + 1}? — blocks: decision ${i + 1}`).join('\n') + '\n');
}
function answers(rows, extra = '') {
  return write('answers.md', '# Research\n\n## Answers\n\n' + HEADER + rows.map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n\n## Ideas (v2 candidates)\n\n- an idea\n' + extra);
}
const sourced = (n) => [String(n), `Question ${n}?`, `Answer ${n}`, `https://example.com/docs/${n} (2026-10-20)`, 'HIGH', `use ${n}`];
const codes = (out) => JSON.parse(out).errors.map((e) => e.code).sort();

describe('research check (CLI)', () => {
  test('every question answered with a source passes', () => {
    const r = cli(['research', 'check', questions(3), answers([sourced(1), sourced(2), sourced(3)])]);
    assert.equal(r.code, 0, r.out);
    const j = JSON.parse(r.out);
    assert.deepEqual([j.ok, j.questions, j.answered, j.unknown], [true, 3, 3, 0]);
  });

  test('more than five questions fails', () => {
    const rows = [1, 2, 3, 4, 5, 6].map(sourced);
    const r = cli(['research', 'check', questions(6), answers(rows)]);
    assert.equal(r.code, 1);
    assert.deepEqual(codes(r.out), ['too_many_questions']);
  });

  test('a question with no answer row fails, and so does an answer with no source', () => {
    const r = cli(['research', 'check', questions(3), answers([sourced(1), ['3', 'Question 3?', 'Answer 3', '', 'HIGH', 'x']])]);
    assert.equal(r.code, 1);
    assert.deepEqual(codes(r.out), ['answer_no_source', 'question_unanswered']);
    assert.equal(JSON.parse(r.out).errors.find((e) => e.code === 'question_unanswered').question, 2);
  });

  test('unknown with an assumption passes; unknown without one fails', () => {
    const ok = cli(['research', 'check', questions(2), answers([sourced(1), ['2', 'Question 2?', 'unknown — assume: the API allows 10 requests a second', 'searched the vendor docs', 'LOW', 'throttle at 10/s']])]);
    assert.equal(ok.code, 0, ok.out);
    assert.deepEqual([JSON.parse(ok.out).answered, JSON.parse(ok.out).unknown], [1, 1]);
    const bad = cli(['research', 'check', questions(2), answers([sourced(1), ['2', 'Question 2?', 'unknown', 'searched', 'LOW', 'tbd']])]);
    assert.equal(bad.code, 1);
    assert.deepEqual(codes(bad.out), ['unknown_without_assumption']);
  });

  test('market mode: five products pass, six fail, none at all fails', () => {
    const products = (n) => '\n## Comparable products\n\n| Product | What users get | What the brief does not cover |\n|---|---|---|\n' + Array.from({ length: n }, (_, i) => `| P${i + 1} | x | y |`).join('\n') + '\n';
    const q = questions(1);
    answers([sourced(1)], products(5));
    assert.equal(cli(['research', 'check', q, 'answers.md', '--market']).code, 0);
    answers([sourced(1)], products(6));
    const six = cli(['research', 'check', q, 'answers.md', '--market']);
    assert.equal(six.code, 1);
    assert.deepEqual(codes(six.out), ['too_many_products']);
    answers([sourced(1)]);
    assert.deepEqual(codes(cli(['research', 'check', q, 'answers.md', '--market']).out), ['products_missing']);
  });

  test('no questions is not research; a missing file is an error; usage without arguments', () => {
    write('empty.md', '# Research questions\n\nNothing blocks building.\n');
    assert.deepEqual(codes(cli(['research', 'check', 'empty.md', answers([sourced(1)])]).out), ['no_questions']);
    const missing = cli(['research', 'check', 'nope.md', 'answers.md']);
    assert.equal(JSON.parse(missing.out).error, 'file_not_found');
    assert.notEqual(cli(['research', 'check']).code, 0);
  });

  test('research lint reads an answers table as claims when there is no ## Claims section', () => {
    answers([sourced(1), ['2', 'Q?', 'unknown — assume: x', 'tried', 'LOW', 'y'], ['3', 'Q3?', 'Answer 3', 'vendor docs', 'MEDIUM', 'z']]);
    const r = cli(['research', 'lint', 'answers.md', '--now', '2026-10-25']);
    assert.equal(r.code, 1, 'the third row has no date in its source');
    const j = JSON.parse(r.out);
    assert.equal(j.claims, 2, 'the unknown row is not a claim');
    assert.deepEqual(j.errors.map((e) => e.code), ['claim_no_date']);
  });
});

describe('research is off by default (config)', () => {
  const { loadConfig } = require('../pan-wizard-core/bin/lib/core.cjs');
  const { buildConfigDefaults } = require('../pan-wizard-core/bin/lib/config.cjs');
  test('the default is false, in config-ensure-section, loadConfig and the template', () => {
    assert.equal(buildConfigDefaults(false, {}).workflow.research, false);
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), '{}');
    assert.equal(loadConfig(dir).research, false);
    assert.equal(JSON.parse(read('pan-wizard-core/templates/config.json')).workflow.research, false);
  });
  test('an existing config that says true keeps it', () => {
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ workflow: { research: true } }));
    assert.equal(loadConfig(dir).research, true);
    const r = cli(['init', 'new-milestone']);
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(r.out).research_enabled, true);
  });
});

describe('the prompts: opt-in, a questions file, one researcher, the caps', () => {
  test('new-project: research only when asked, questions file, one researcher, no synthesizer, check after', () => {
    const s = read('pan-wizard-core/workflows/new-project.md');
    assert.match(s, /Research is \*\*off by default\*\*/);
    assert.match(s, /"Skip research \(Recommended\)"/);
    assert.doesNotMatch(s, /Research first \(Recommended\)/);
    assert.match(s, /`--research market`/);
    assert.match(s, /at most \*\*5\*\* open questions/);
    assert.match(s, /\.planning\/research\/questions\.md/);
    assert.match(s, /\*\*No questions → no research\.\*\*/);
    assert.equal((s.match(/subagent_type="pan-project-researcher"/g) || []).length, 1, 'one researcher spawn');
    assert.doesNotMatch(s, /pan-research-synthesizer|Spawning 4 researchers|4 parallel/);
    assert.match(s, /research check \.planning\/research\/questions\.md/);
    assert.match(s, /One revision at most/);
    assert.match(s, /compare at most 5 comparable products/);
    assert.doesNotMatch(s, /Auto-include all table stakes/, 'auto mode never puts table stakes into v1');
    assert.match(s, /No finding moves into v1 by itself/);
  });
  test('new-project: a precise brief never researches; an open one only when asked', () => {
    const s = read('pan-wizard-core/workflows/new-project.md');
    assert.match(s, /A precise brief never needs research/);
    assert.match(s, /when `--research` was passed or the frontmatter says `research_enabled: true` \(and `BRIEF_SIZE` is not `lean`\)/);
  });
  test('new-project command: the argument hint and the flag', () => {
    const s = read('commands/pan/new-project.md');
    assert.match(s, /argument-hint: "\[--auto\] \[--research \[market\]\]"/);
    assert.match(s, /`--research market`/);
  });
  test('plan-phase: research only with --research or workflow.research; questions file; one researcher; check', () => {
    const s = read('pan-wizard-core/workflows/plan-phase.md');
    assert.match(s, /Research is \*\*opt-in\*\*: it runs only with `--research`, or when `research_enabled`/);
    assert.match(s, /\{phase_dir\}\/\{padded_phase\}-research-questions\.md/);
    assert.match(s, /at most \*\*5\*\* open questions/);
    assert.equal((s.match(/subagent_type="pan-phase-researcher"/g) || []).length, 1);
    assert.match(s, /pan-tools\.cjs research check/);
    assert.match(s, /never plans an item from `## Ideas \(v2 candidates\)`/);
  });
  test('settings: off is the default', () => {
    const s = read('pan-wizard-core/workflows/settings.md');
    assert.match(s, /`false` for research and nyquist_validation/);
    assert.match(s, /label: "No \(default\)"/);
  });
  test('the researchers: answer each question, 4 searches per question, a table, ideas apart, no survey', () => {
    for (const f of ['agents/pan-project-researcher.md', 'agents/pan-phase-researcher.md']) {
      const s = read(f);
      assert.match(s, /\*\*At most 4 searches or fetches per question, then stop\.\*\*/, f);
      assert.match(s, /\| # \| Question \| Answer \| Source \| Confidence \| Decision it settles \|/, f);
      assert.match(s, /## Ideas \(v2 candidates\)/, f);
      assert.match(s, /Done means every listed question has a row/, f);
      assert.match(s, /research check/, f);
      assert.doesNotMatch(s, /Domain ecosystem surveyed|Feature landscape mapped|\*\*Be comprehensive|Comprehensive not shallow/, f);
    }
    assert.match(read('agents/pan-project-researcher.md'), /at most \*\*5\*\* comparable products/);
  });
  test('pan-research-synthesizer is retired everywhere it was wired', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'agents', 'pan-research-synthesizer.md')), false);
    const { MODEL_PROFILES } = require('../pan-wizard-core/bin/lib/core.cjs');
    assert.equal(MODEL_PROFILES['pan-research-synthesizer'], undefined);
    for (const f of ['pan-wizard-core/workflows/milestone-new.md', 'pan-wizard-core/bin/lib/init.cjs', 'pan-wizard-core/bin/lib/squads.cjs']) {
      assert.doesNotMatch(read(f), /synthesizer/, f);
    }
  });
});
