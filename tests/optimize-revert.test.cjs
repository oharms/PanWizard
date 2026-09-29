/**
 * Revertible `optimize apply` (evidence loop EL-11; spec D10).
 *
 * An apply writes memory that every later agent reads. The gate the investigation
 * set: apply → revert round-trips byte-for-byte on a memory_append, refuses a
 * hand-edited file, and a second apply of the same report no longer appends
 * everything twice. Reverts go last-in, first-out per file, and a CRLF file comes
 * back CRLF (the 3.31.0 line-ending lesson).
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { applyReportRecommendations, revertApply, readApplyLog, getOptimizeStats } = require('../pan-wizard-core/bin/lib/optimize.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const FENCE = '`'.repeat(3);
let dir;
const opt = (...p) => path.join(dir, '.planning', 'optimization', ...p);
const mem = (name) => path.join(dir, '.planning', 'memory', name);

function report(name, actions) {
  const file = opt('reports', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# Optimization report\n\n## Auto-Apply Actions\n\n${FENCE}json\n${JSON.stringify(actions, null, 2)}\n${FENCE}\n`);
  return file;
}
const APPEND = { type: 'memory_append', path: '.planning/memory/pan-executor.md', content: '- run the suite with npm run test:all' };
const CREATE = { type: 'memory', path: '.planning/memory/pan-verifier.md', content: '# pan-verifier memory\n\n- check key links first\n' };
const NOTE = { type: 'note', description: 'Recurring tool failure', content: 'npm test fails on a clean checkout', target: '.planning/memory/' };

beforeEach(() => {
  dir = createTempProject();
  fs.mkdirSync(path.join(dir, '.planning', 'memory'), { recursive: true });
  fs.mkdirSync(opt(), { recursive: true });
});
afterEach(() => cleanup(dir));

describe('optimize apply records what it wrote', () => {
  test('each apply gets an apply_id and one record per action: path, kind, text, post-write hash', () => {
    fs.writeFileSync(mem('pan-executor.md'), '# pan-executor memory\n');
    const r = applyReportRecommendations(dir, report('r1.md', [APPEND, CREATE, NOTE]));
    assert.match(r.apply_id, /^apl_\d{8}_\d{6}_[0-9a-f]{4}$/);
    assert.equal(r.applied.length, 3);
    const [row] = readApplyLog(dir);
    assert.deepEqual([row.kind, row.apply_id, row.applied_count], ['apply', r.apply_id, 3]);
    assert.deepEqual(row.actions.map((a) => [a.i, a.type, a.path, a.kind]), [
      [0, 'memory_append', '.planning/memory/pan-executor.md', 'appended'],
      [1, 'memory', '.planning/memory/pan-verifier.md', 'created'],
      [2, 'note', '.planning/optimization/suggestions.md', 'appended'],
    ]);
    assert.equal(row.actions[0].text, '\n- run the suite with npm run test:all');
    for (const a of row.actions) assert.match(a.sha256_after, /^[0-9a-f]{64}$/);
  });

  test('applying the same report again appends nothing — each action names the apply that already wrote it', () => {
    fs.writeFileSync(mem('pan-executor.md'), '# pan-executor memory\n');
    const file = report('r1.md', [APPEND, NOTE]);
    const first = applyReportRecommendations(dir, file);
    const once = fs.readFileSync(mem('pan-executor.md'), 'utf8');
    const notes = fs.readFileSync(opt('suggestions.md'), 'utf8');
    const second = applyReportRecommendations(dir, file);
    assert.equal(second.applied.length, 0);
    assert.equal(second.skipped.length, 2);
    for (const s of second.skipped) assert.match(s.reason, new RegExp(`already applied in ${first.apply_id}`));
    assert.equal(fs.readFileSync(mem('pan-executor.md'), 'utf8'), once, 'the memory file is unchanged');
    assert.equal(fs.readFileSync(opt('suggestions.md'), 'utf8'), notes);
  });
});

describe('optimize revert', () => {
  test('a memory_append round-trips byte-for-byte on an LF file', () => {
    const before = '# pan-executor memory\n\n- existing rule\n';
    fs.writeFileSync(mem('pan-executor.md'), before);
    const { apply_id } = applyReportRecommendations(dir, report('r1.md', [APPEND]));
    assert.notEqual(fs.readFileSync(mem('pan-executor.md'), 'utf8'), before);
    const r = revertApply(dir, apply_id);
    assert.deepEqual([r.status, r.reverted, r.refused], ['reverted', [0], []]);
    assert.equal(fs.readFileSync(mem('pan-executor.md'), 'utf8'), before);
  });

  test('a CRLF file round-trips byte-for-byte, even after the checkout turned the append into CRLF too', () => {
    const before = '# pan-executor memory\r\n\r\n- existing rule\r\n';
    fs.writeFileSync(mem('pan-executor.md'), before);
    const { apply_id } = applyReportRecommendations(dir, report('r1.md', [APPEND]));
    // What a core.autocrlf checkout leaves: the whole file CRLF.
    fs.writeFileSync(mem('pan-executor.md'), fs.readFileSync(mem('pan-executor.md'), 'utf8').replace(/\r?\n/g, '\r\n'));
    assert.equal(revertApply(dir, apply_id).status, 'reverted');
    assert.equal(fs.readFileSync(mem('pan-executor.md'), 'utf8'), before);
  });

  test('a created memory file is deleted, a note\'s appended entry is cut', () => {
    fs.writeFileSync(opt('suggestions.md'), '# Suggestions\n');
    const { apply_id } = applyReportRecommendations(dir, report('r1.md', [CREATE, NOTE]));
    assert.equal(fs.existsSync(mem('pan-verifier.md')), true);
    assert.equal(revertApply(dir, apply_id).status, 'reverted');
    assert.equal(fs.existsSync(mem('pan-verifier.md')), false);
    assert.equal(fs.readFileSync(opt('suggestions.md'), 'utf8'), '# Suggestions\n');
  });

  test('a hand-edited file is refused and left exactly as the human left it', () => {
    fs.writeFileSync(mem('pan-executor.md'), '# memory\n');
    const { apply_id } = applyReportRecommendations(dir, report('r1.md', [APPEND]));
    const edited = fs.readFileSync(mem('pan-executor.md'), 'utf8') + '- a rule a human added\n';
    fs.writeFileSync(mem('pan-executor.md'), edited);
    const r = revertApply(dir, apply_id);
    assert.equal(r.status, 'refused');
    assert.match(r.refused[0].reason, /changed since the apply/);
    assert.equal(fs.readFileSync(mem('pan-executor.md'), 'utf8'), edited);
  });

  test('reverts go last-in, first-out per file: an earlier apply waits for the later one', () => {
    const before = '# memory\n';
    fs.writeFileSync(mem('pan-executor.md'), before);
    const a = applyReportRecommendations(dir, report('a.md', [APPEND]));
    const b = applyReportRecommendations(dir, report('b.md', [{ ...APPEND, content: '- a second lesson' }]));
    const early = revertApply(dir, a.apply_id);
    assert.equal(early.status, 'refused');
    assert.match(early.refused[0].reason, new RegExp(`later apply \\(${b.apply_id}\\)`));
    assert.equal(revertApply(dir, b.apply_id).status, 'reverted');
    assert.equal(revertApply(dir, a.apply_id).status, 'reverted');
    assert.equal(fs.readFileSync(mem('pan-executor.md'), 'utf8'), before);
  });

  test('after a revert the same report can be applied again', () => {
    fs.writeFileSync(mem('pan-executor.md'), '# memory\n');
    const file = report('r1.md', [APPEND]);
    const first = applyReportRecommendations(dir, file);
    revertApply(dir, first.apply_id);
    assert.equal(applyReportRecommendations(dir, file).applied.length, 1);
  });

  test('refusals: unknown id, a legacy row with no records, and a fully reverted apply', () => {
    assert.equal(revertApply(dir, 'apl_20260101_000000_abcd').error, 'unknown_apply');
    fs.appendFileSync(opt('applied.jsonl'), JSON.stringify({ ts: '2026-08-01T00:00:00.000Z', report: 'old.md', applied_count: 1, skipped_count: 0, applied_types: ['memory_append'] }) + '\n');
    assert.equal(revertApply(dir, 'last').error, 'not_revertible');
    fs.writeFileSync(mem('pan-executor.md'), '# memory\n');
    const { apply_id } = applyReportRecommendations(dir, report('r1.md', [APPEND]));
    revertApply(dir, apply_id);
    assert.equal(revertApply(dir, apply_id).status, 'nothing_to_revert');
  });
});

describe('optimize revert — CLI and stats', () => {
  test('optimize revert --last reverts the newest apply; --raw prints the status', () => {
    fs.writeFileSync(mem('pan-executor.md'), '# memory\n');
    runPanTools(`optimize apply --report ${JSON.stringify(report('r1.md', [APPEND]))}`, dir);
    const r = runPanTools('optimize revert --last --raw', dir);
    assert.deepEqual([r.success, r.output], [true, 'reverted']);
    assert.equal(fs.readFileSync(mem('pan-executor.md'), 'utf8'), '# memory\n');
  });

  test('optimize apply prints the apply_id to revert with', () => {
    fs.writeFileSync(mem('pan-executor.md'), '# memory\n');
    const json = JSON.parse(runPanTools(`optimize apply --report ${JSON.stringify(report('r1.md', [APPEND]))}`, dir).output);
    assert.match(json.apply_id, /^apl_/);
    const byId = JSON.parse(runPanTools(`optimize revert ${json.apply_id}`, dir).output);
    assert.deepEqual([byId.apply_id, byId.status], [json.apply_id, 'reverted']);
  });

  test('optimize revert with no target, or an unknown one, exits 1', () => {
    for (const args of ['optimize revert', 'optimize revert apl_20260101_000000_abcd']) {
      const r = runPanTools(args, dir);
      assert.equal(r.success, false, args);
      assert.ok(JSON.parse(r.output).error, args);
    }
  });

  test('stats count apply runs and reverted runs separately', () => {
    fs.writeFileSync(mem('pan-executor.md'), '# memory\n');
    const a = applyReportRecommendations(dir, report('a.md', [APPEND]));
    applyReportRecommendations(dir, report('b.md', [NOTE]));
    revertApply(dir, 'last');
    const s = getOptimizeStats(dir);
    assert.deepEqual([s.apply_runs, s.reverted_runs, s.total_optimizations_applied], [2, 1, 2]);
    assert.notEqual(s.last_apply_id, a.apply_id);
  });
});
