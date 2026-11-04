/**
 * 3.42.0 Stage C — phase insert / add field defects:
 *   PAN-23 a decimal insert is a sibling (29.4 → 29.5), nesting only when 29.5 is taken;
 *   PAN-05 insert and add write a Progress-table row;
 *   PAN-14 no `.gitkeep`, and the dependency is the phase immediately before.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const { insertProgressTableRow } = require('../pan-wizard-core/bin/lib/roadmap.cjs');

describe('phase insert / add — PAN-23, PAN-05, PAN-14', () => {
  let tmpDir;
  const roadmapFile = () => path.join(tmpDir, '.planning', 'roadmap.md');
  const readRoadmap = () => fs.readFileSync(roadmapFile(), 'utf-8');
  const mkPhase = (name) => fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', name), { recursive: true });
  const write = (text) => fs.writeFileSync(roadmapFile(), text);
  const run = (args) => {
    const r = runPanTools(args, tmpDir);
    assert.ok(r.success, `Command failed: ${r.error}`);
    return JSON.parse(r.output);
  };
  const roadmap = (headings, table) => [
    '# Roadmap', '',
    ...headings.flatMap((h) => [`### Phase ${h}: P${h}`, `**Goal:** g${h}`, '']),
    ...(table ? ['## Progress', '', ...table, ''] : []),
  ].join('\n');

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('after 29.4 with no 29.5 gives the sibling 29.5, not 29.4.1', () => {
    write(roadmap(['29', '29.4', '30']));
    mkPhase('29-a'); mkPhase('29.4-b');
    const out = run('phase insert 29.4 Sibling');
    assert.strictEqual(out.phase_number, '29.5');
    assert.strictEqual(out.nested, false);
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'phases', '29.5-sibling')));
    assert.match(readRoadmap(), /### Phase 29\.5: Sibling \(INSERTED\)[\s\S]*?\*\*Depends on:\*\* Phase 29\.4\n/);
  });

  test('after 29.4 when 29.5 exists it nests (29.4.1) and reports nested: true', () => {
    write(roadmap(['29', '29.4', '29.5', '30']));
    mkPhase('29.4-b'); mkPhase('29.5-c');
    const out = run('phase insert 29.4 Nested');
    assert.strictEqual(out.phase_number, '29.4.1');
    assert.strictEqual(out.nested, true);
  });

  test('29.5 named only in the roadmap (no directory) still counts as taken', () => {
    write(roadmap(['29', '29.4', '29.5']));
    mkPhase('29.4-b');
    assert.strictEqual(run('phase insert 29.4 Nested').phase_number, '29.4.1');
  });

  test('after integer 29 with 29.1-29.4 gives 29.5, depending on Phase 29.4', () => {
    write(roadmap(['29', '29.1', '29.2', '29.3', '29.4', '30']));
    for (const d of ['29-a', '29.1-a', '29.2-a', '29.3-a', '29.4-a']) mkPhase(d);
    const out = run('phase insert 29 Next');
    assert.strictEqual(out.phase_number, '29.5');
    assert.strictEqual(out.nested, false);
    assert.match(readRoadmap(), /### Phase 29\.5: Next \(INSERTED\)[\s\S]*?\*\*Depends on:\*\* Phase 29\.4\n/);
  });

  test('a decimal the roadmap names without a directory is not handed out again', () => {
    write(roadmap(['7', '7.1', '8']));
    mkPhase('07-a'); // no 07.1 directory
    assert.strictEqual(run('phase insert 7 Fresh').phase_number, '07.2');
  });

  test('`insert 06` depends on Phase 6, unpadded, not the raw argument', () => {
    write(roadmap(['6', '7']));
    mkPhase('06-a');
    run('phase insert 06 Urgent');
    assert.match(readRoadmap(), /\*\*Depends on:\*\* Phase 6\n/);
    assert.doesNotMatch(readRoadmap(), /Depends on:\*\* Phase 06/);
  });

  test('phase add depends on the last phase in roadmap order, a decimal included', () => {
    write(roadmap(['5', '5.2']));
    run('phase add Later');
    assert.match(readRoadmap(), /### Phase 6: Later[\s\S]*?\*\*Depends on:\*\* Phase 5\.2\n/);
  });

  test('neither insert nor add leaves a .gitkeep in the new directory', () => {
    write(roadmap(['1', '2']));
    mkPhase('01-a');
    const ins = run('phase insert 1 Hot');
    const add = run('phase add Later');
    for (const dir of [ins.directory, add.directory]) {
      const abs = path.join(tmpDir, dir);
      assert.ok(fs.existsSync(abs), `${dir} created`);
      assert.deepStrictEqual(fs.readdirSync(abs), [], `${dir} is empty`);
    }
  });

  test('insert writes a Progress row in numeric order, and update-plan-progress then finds it', () => {
    write(roadmap(['1', '2', '3'], [
      '| Phase | Plans Complete | Status | Completed |',
      '|-------|----------------|--------|-----------|',
      '| 1. P1 | 1/1 | Complete | 2026-01-01 |',
      '| 2. P2 | 0/2 | Planned | - |',
      '| 3. P3 | 0/1 | Planned | - |',
    ]));
    mkPhase('02-p2');
    run('phase insert 2 Hot fix');
    const rows = readRoadmap().split('\n').filter((l) => /^\| \d/.test(l)).map((l) => l.split('|')[1].trim());
    assert.deepStrictEqual(rows, ['1. P1', '2. P2', '2.1. Hot fix', '3. P3']);
    assert.match(readRoadmap(), /\| 2\.1\. Hot fix \| 0\/0 \| Not started \| - \|/);

    fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '02.1-hot-fix', '02.1-01-plan.md'), '# plan\n');
    const upd = run('roadmap update-plan-progress 2.1');
    assert.strictEqual(upd.updated, true);
    assert.match(readRoadmap(), /\| 2\.1\. Hot fix \| 0\/1 \| Planned \|/);
  });

  test('the milestone-variant table gets the row, its Milestone cell copied from the after-phase', () => {
    write(roadmap(['5', '6'], [
      '| Phase | Milestone | Plans Complete | Status | Completed |',
      '|-------|-----------|----------------|--------|-----------|',
      '| 5. P5 | v1.1 | 2/2 | Complete | 2026-01-01 |',
      '| 6. P6 | v1.1 | 0/1 | Planned | - |',
    ]));
    mkPhase('05-p5');
    run('phase insert 5 Patch');
    assert.match(readRoadmap(), /\| 5\. P5 [^\n]*\n\| 5\.1\. Patch \| v1\.1 \| 0\/0 \| Not started \| - \|\n\| 6\. P6/);
  });

  test('phase add appends a Progress row', () => {
    write(roadmap(['1'], [
      '| Phase | Plans Complete | Status | Completed |',
      '|-------|----------------|--------|-----------|',
      '| 1. P1 | 0/1 | Planned | - |',
    ]));
    run('phase add Second');
    assert.match(readRoadmap(), /\| 1\. P1 [^\n]*\n\| 2\. Second \| 0\/0 \| Not started \| - \|/);
  });

  test('a roadmap without a Progress table is not given one', () => {
    write(roadmap(['1', '2']));
    mkPhase('01-p1');
    run('phase insert 1 NoTable');
    assert.match(readRoadmap(), /### Phase 01\.1: NoTable/);
    assert.doesNotMatch(readRoadmap(), /\|/, 'no table invented');
  });
});

describe('insertProgressTableRow (pure)', () => {
  test('no table with Plans and Status columns: content unchanged', () => {
    const text = '# R\n\n| Phase | Goal |\n|---|---|\n| 1 | x |\n';
    const r = insertProgressTableRow(text, '1', '1.1', 'New');
    assert.strictEqual(r.updated, false);
    assert.strictEqual(r.content, text);
  });

  test('copies a "Phase N: name" number format and keeps CRLF', () => {
    const text = '| Phase | Plans | Status |\r\n|---|---|---|\r\n| Phase 3: A | 1/1 | Complete |\r\n| Phase 4: B | 0/1 | Planned |\r\n';
    const r = insertProgressTableRow(text, '3', '3.1', 'Ins');
    assert.strictEqual(r.updated, true);
    assert.ok(r.content.includes('| Phase 3: A | 1/1 | Complete |\r\n| Phase 3.1: Ins | 0/0 | Not started |\r\n| Phase 4: B'), r.content);
  });

  test('copies a zero-padded number-only cell', () => {
    const text = '| Phase | Plans | Status |\n|---|---|---|\n| 03 | 1/1 | Complete |\n| 04 | 0/1 | Planned |\n';
    const r = insertProgressTableRow(text, '3', '3.1', 'Ins');
    assert.ok(r.content.includes('| 03 | 1/1 | Complete |\n| 03.1 | 0/0 | Not started |\n| 04 |'), r.content);
  });

  test('a row for the new phase already present: unchanged', () => {
    const text = '| Phase | Plans | Status |\n|---|---|---|\n| 3.1 | 0/0 | Not started |\n';
    assert.strictEqual(insertProgressTableRow(text, '3', '3.1', 'x').updated, false);
  });
});
