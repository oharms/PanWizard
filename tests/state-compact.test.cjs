/**
 * Tests for state-compact.cjs — moving closed history out of state.md.
 *
 * state.md is in CACHEABLE_CONTEXT_FILES, so every byte is re-read into every
 * agent call, and its section writers only append. These tests defend the two
 * properties that make compaction safe to run unattended:
 *   - nothing is ever lost (archive is written before state.md is rewritten)
 *   - nothing LIVE is moved (protected headings, and anything the frontmatter
 *     is rebuilt from, stay put)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  splitSections,
  classifySection,
  planStateCompaction,
  compactState,
} = require('../pan-wizard-core/bin/lib/state-compact.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const NOW = Date.parse('2026-08-21T00:00:00Z');

/**
 * A state.md with a live working set plus settled history.
 *
 * The history sections are deliberately BULKY, because that is the real shape —
 * the field case was a 25 KB session log. A toy two-line section is smaller than
 * the pointer that would replace it, which compaction correctly declines to do.
 */
function sampleState() {
  const bulk = (label) => Array.from({ length: 40 }, (_, i) => `${label} narrative line ${i} — settled detail that no longer drives any decision.`).join('\n');
  return [
    '---',
    'pan_state_version: 1.0',
    'milestone: v2.0',
    '---',
    '',
    '## 2026-01-04 — Old session log',
    '',
    'A long since-settled narrative.',
    bulk('session'),
    '',
    '## Next Action',
    '',
    'Do the next thing.',
    '',
    '## Phase 1 closure',
    '',
    'Phase 1 shipped.',
    bulk('closure'),
    '',
    '## Toolchain state',
    '',
    'node 22',
    '',
  ].join('\n');
}

function writeState(tmp, content) {
  fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), content);
}

describe('state-compact — section splitting', () => {
  test('splits on H2 only, so nested H3 writers stay with their parent', () => {
    const { sections } = splitSections([
      '## Decisions Made',
      '### Accumulated',
      '- one',
      '## Next Action',
      'go',
    ].join('\n'));
    assert.deepEqual(sections.map(s => s.title), ['Decisions Made', 'Next Action']);
    assert.match(sections[0].text, /### Accumulated/, 'H3 must not start a new section');
  });

  test('preamble holds the frontmatter', () => {
    const { preamble, sections } = splitSections(sampleState());
    assert.match(preamble, /pan_state_version/);
    assert.equal(sections.length, 4);
  });

  test('a file with no headings yields no sections', () => {
    const { sections } = splitSections('just prose\nand more\n');
    assert.deepEqual(sections, []);
  });
});

describe('state-compact — classification', () => {
  const cls = (title, text = '') => classifySection({ title, text }, 30, NOW);

  test('a dated section past the window is archivable', () => {
    assert.equal(cls('2026-01-04 — Old session').archive, true);
  });

  test('a dated section inside the window is kept', () => {
    assert.equal(cls('2026-08-15 — Recent session').archive, false);
  });

  test('closure records are archivable', () => {
    assert.equal(cls('Phase 3 closure').archive, true);
    assert.equal(cls('Phase 3 closed').archive, true);
  });

  test('headings PAN reads or writes are always protected', () => {
    for (const t of ['Decisions Made', 'Blockers', 'Next Action', 'Phase Progress',
      'Project Reference', 'Source Authority', 'Toolchain state', 'Session']) {
      assert.equal(cls(t).archive, false, `${t} must never be archived`);
    }
  });

  test('an unrecognised heading is left alone rather than guessed at', () => {
    assert.equal(cls('Some notes').archive, false);
  });

  test('a section carrying a frontmatter-source field is never archived', () => {
    // state.cjs rebuilds frontmatter from the FIRST `**Field:**` in the body, so
    // moving one could silently rewrite state.md metadata.
    const v = cls('2026-01-04 — Old session', '## 2026-01-04\n**Status:** In progress\n');
    assert.equal(v.archive, false);
    assert.match(v.reason, /frontmatter is rebuilt from/);
  });

  test('an unparseable date is left in place', () => {
    assert.equal(cls('2026-13-45 — nonsense date').archive, false);
  });
});

describe('state-compact — planning', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => cleanup(tmp));

  test('reports per-section verdicts and the per-call saving', () => {
    writeState(tmp, sampleState());
    const plan = planStateCompaction(tmp, { now: NOW });
    assert.equal(plan.found, true);
    assert.deepEqual(plan.archivable.map(v => v.title),
      ['2026-01-04 — Old session log', 'Phase 1 closure']);
    assert.ok(plan.tokens_saved_per_call > 0);
    assert.ok(plan.tokens_after < plan.tokens_before);
  });

  test('--keep-days widens or narrows the window', () => {
    writeState(tmp, sampleState());
    const wide = planStateCompaction(tmp, { now: NOW, keepDays: 3650 });
    assert.deepEqual(wide.archivable.map(v => v.title), ['Phase 1 closure'],
      'the dated section falls inside a 10-year window');
  });

  test('a missing state.md is reported, not thrown', () => {
    const plan = planStateCompaction(tmp, { now: NOW });
    assert.equal(plan.found, false);
  });

  test('planning never writes anything', () => {
    writeState(tmp, sampleState());
    const before = fs.readFileSync(path.join(tmp, '.planning', 'state.md'), 'utf8');
    planStateCompaction(tmp, { now: NOW });
    assert.equal(fs.readFileSync(path.join(tmp, '.planning', 'state.md'), 'utf8'), before);
    assert.equal(fs.existsSync(path.join(tmp, '.planning', 'state-history.md')), false);
  });
});

describe('state-compact — applying', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => cleanup(tmp));

  test('dry-run by default — nothing on disk changes', () => {
    writeState(tmp, sampleState());
    const before = fs.readFileSync(path.join(tmp, '.planning', 'state.md'), 'utf8');
    const r = compactState(tmp, { now: NOW });
    assert.equal(r.applied, false);
    assert.equal(r.dry_run, true);
    assert.equal(fs.readFileSync(path.join(tmp, '.planning', 'state.md'), 'utf8'), before);
  });

  test('--apply archives history and shrinks state.md', () => {
    writeState(tmp, sampleState());
    const r = compactState(tmp, { now: NOW, apply: true });
    assert.equal(r.applied, true);
    assert.deepEqual(r.archived, ['2026-01-04 — Old session log', 'Phase 1 closure']);

    const state = fs.readFileSync(path.join(tmp, '.planning', 'state.md'), 'utf8');
    const history = fs.readFileSync(path.join(tmp, '.planning', 'state-history.md'), 'utf8');

    assert.ok(!state.includes('A long since-settled narrative'), 'body moved out of state.md');
    assert.ok(history.includes('A long since-settled narrative'), 'body landed in history');
    assert.ok(history.includes('Phase 1 shipped.'));
    assert.ok(state.includes('Do the next thing.'), 'live section untouched');
    assert.ok(state.includes('node 22'), 'protected section untouched');
  });

  test('a pointer is left where each archived section stood', () => {
    writeState(tmp, sampleState());
    compactState(tmp, { now: NOW, apply: true });
    const state = fs.readFileSync(path.join(tmp, '.planning', 'state.md'), 'utf8');
    assert.match(state, /## Phase 1 closure\s*\n\s*\n_Archived to \[state-history\.md\]/);
  });

  test('no content is lost — every substantive body line survives somewhere', () => {
    writeState(tmp, sampleState());
    const original = fs.readFileSync(path.join(tmp, '.planning', 'state.md'), 'utf8');
    compactState(tmp, { now: NOW, apply: true });
    const state = fs.readFileSync(path.join(tmp, '.planning', 'state.md'), 'utf8');
    const history = fs.readFileSync(path.join(tmp, '.planning', 'state-history.md'), 'utf8');

    const body = original.slice(original.indexOf('\n---\n', 4) + 5);
    const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    const lost = lines.filter(l => !state.includes(l) && !history.includes(l));
    assert.deepEqual(lost, [], 'compaction must never lose a line');
  });

  test('repeated runs are idempotent — history is not duplicated', () => {
    writeState(tmp, sampleState());
    compactState(tmp, { now: NOW, apply: true });
    const afterFirst = fs.readFileSync(path.join(tmp, '.planning', 'state-history.md'), 'utf8');
    const second = compactState(tmp, { now: NOW, apply: true });
    assert.equal(second.applied, false, 'nothing left to archive');
    assert.equal(fs.readFileSync(path.join(tmp, '.planning', 'state-history.md'), 'utf8'), afterFirst);
  });

  test('a state.md with only live sections is left completely alone', () => {
    writeState(tmp, '---\nv: 1\n---\n\n## Next Action\n\ngo\n');
    const r = compactState(tmp, { now: NOW, apply: true });
    assert.equal(r.applied, false);
    assert.equal(fs.existsSync(path.join(tmp, '.planning', 'state-history.md')), false);
  });
});

describe('state-compact — CLI', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => cleanup(tmp));

  test('state compact returns a JSON plan and is dry-run by default', () => {
    writeState(tmp, sampleState());
    const r = runPanTools('state compact', tmp);
    assert.ok(r.success, r.error);
    const j = JSON.parse(r.output);
    assert.equal(j.dry_run, true);
    assert.equal(j.applied, false);
    assert.ok(j.archivable.length >= 1);
    assert.equal(fs.existsSync(path.join(tmp, '.planning', 'state-history.md')), false);
  });

  test('state compact --apply executes', () => {
    writeState(tmp, sampleState());
    const r = runPanTools('state compact --apply', tmp);
    assert.ok(r.success, r.error);
    assert.equal(JSON.parse(r.output).applied, true);
    assert.ok(fs.existsSync(path.join(tmp, '.planning', 'state-history.md')));
  });

  test('state compact --keep-days is honoured through the CLI', () => {
    writeState(tmp, sampleState());
    const j = JSON.parse(runPanTools('state compact --keep-days 3650', tmp).output);
    assert.equal(j.keep_days, 3650);
    assert.deepEqual(j.archivable.map(v => v.title), ['Phase 1 closure']);
  });
});

describe('state-compact — refuses to make things worse', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => cleanup(tmp));

  test('a history section smaller than its pointer is left in place', () => {
    // Compaction exists to shrink the per-call re-read. On a file whose history
    // is two lines, the pointer costs more than the body it replaces.
    writeState(tmp, '---\nv: 1\n---\n\n## Phase 1 closure\n\ndone\n');
    const plan = planStateCompaction(tmp, { now: NOW });
    assert.deepEqual(plan.archivable, []);
    assert.match(plan.sections[0].reason, /would not shrink state\.md/);
    assert.equal(plan.bytes_after, plan.bytes_before);
  });

  test('dry-run byte count matches what --apply actually writes', () => {
    writeState(tmp, sampleState());
    const plan = planStateCompaction(tmp, { now: NOW });
    const applied = compactState(tmp, { now: NOW, apply: true });
    assert.equal(applied.bytes_after, plan.bytes_after,
      'a dry-run that disagrees with the apply is not a dry-run');
  });
});
