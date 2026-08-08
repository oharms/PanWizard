/**
 * The roadmap "## Phases" checklist must be written by phase add/insert and read by
 * preview — in the format templates/roadmap.md actually prescribes.
 *
 * Two Medium findings from the 2026-08 deployed stability test:
 *
 *   phase add / phase insert wrote only the `### Phase N:` detail section, never the
 *   `- [ ] **Phase N: …**` checklist entry. The phase was permanently absent from the
 *   list users read, and `phase complete` then reported roadmap_updated:true having
 *   changed nothing, because it ticks a line that was never there.
 *
 *   preview phases used one regex that required the line to END at the closing `**`.
 *   templates/roadmap.md prescribes `- [ ] **Phase 1: [Name]** - [description]`, so
 *   every template-shaped line failed to match and preview reported a phase_count
 *   with an EMPTY phases array — contradicting itself in the same payload.
 *
 * The fixtures use the template's exact shape, including the trailing description and
 * a name containing a hyphen, because the naive widening of that regex breaks on both.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAN_TOOLS = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let tempRoot;
let proj;

function pan(args) {
  const r = spawnSync('node', [PAN_TOOLS, ...args], { cwd: proj, encoding: 'utf-8', timeout: 30000 });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function roadmap() {
  return fs.readFileSync(path.join(proj, '.planning', 'roadmap.md'), 'utf-8');
}

function checklistLines() {
  return roadmap().split('\n').filter(l => /^\s*- \[[ x]\]\s*(?:\*\*)?Phase\s/i.test(l));
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-rmc-'));
  proj = path.join(tempRoot, 'proj');
  fs.mkdirSync(path.join(proj, '.planning', 'phases'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.planning', 'roadmap.md'), [
    '# Roadmap',
    '',
    '## Phases',
    '',
    '- [x] **Phase 1: Foundation** - Core scaffolding',
    '- [ ] **Phase 2: Core widget - and validation** - Multi-part name',
    '',
    '### Phase 1: Foundation',
    '**Status:** Complete',
    '',
    '### Phase 2: Core widget - and validation',
    '**Status:** In Progress',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(proj, '.planning', 'state.md'), '# Project State\n\n**Current Phase:** 2\n');
});

after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

describe('preview reads the template checklist format', () => {
  test('every template-shaped entry is listed, including a hyphenated name', () => {
    const { out } = pan(['preview', 'phases', '--raw']);
    const result = JSON.parse(out);

    // REVERT CHECK: the old regex matched none of these, so phases was [] while
    // phase_count said 2 — the payload disagreed with itself.
    assert.equal(result.phases.length, 2, `expected both phases, got ${JSON.stringify(result.phases)}`);
    assert.equal(result.phases.length, result.phase_count, 'count and list must agree');
    assert.deepEqual(result.phases.map(p => p.num), ['1', '2']);
    assert.equal(result.phases[1].name, 'Core widget - and validation',
      'a hyphen inside the name must not truncate it');
    // preview exposes the ticked state as `status`, derived from the `[x]` marker.
    assert.equal(result.phases[0].status, 'completed', 'a [x] entry must read as completed');
    assert.notEqual(result.phases[1].status, 'completed', 'a [ ] entry must not');
  });

  test('the plain (unbolded) form still parses', () => {
    fs.writeFileSync(path.join(proj, '.planning', 'roadmap.md'),
      '# Roadmap\n\n## Phases\n\n- [ ] Phase 1: Plain form\n');
    const result = JSON.parse(pan(['preview', 'phases', '--raw']).out);
    assert.equal(result.phases.length, 1);
    assert.equal(result.phases[0].name, 'Plain form');
  });
});

describe('phase add and insert write the checklist entry', () => {
  test('phase add appends an entry, and phase complete can then tick it', () => {
    const before = checklistLines().length;

    const add = pan(['phase', 'add', 'Hardening pass']);
    assert.equal(add.code, 0, add.out);

    const after = checklistLines();
    // REVERT CHECK: previously only the `### Phase 3` detail section was written.
    assert.equal(after.length, before + 1, `expected a new checklist entry, got:\n${after.join('\n')}`);
    assert.ok(after.some(l => /\*\*Phase 3: Hardening pass\*\*/.test(l)), 'entry must name the new phase');
    assert.match(roadmap(), /^### Phase 3: Hardening pass/m, 'the detail section must still be written');

    // The downstream harm: phase complete reported roadmap_updated:true while the
    // checklist had no line to tick.
    fs.mkdirSync(path.join(proj, '.planning', 'phases', '03-hardening-pass'), { recursive: true });
    pan(['phase', 'complete', '3']);
    assert.ok(checklistLines().some(l => /^\s*- \[x\].*Phase 3/.test(l)),
      'phase complete must actually tick the entry it claims to update');
  });

  test('phase insert appends an entry for the decimal phase', () => {
    const before = checklistLines().length;

    const ins = pan(['phase', 'insert', '2', 'Urgent hotfix']);
    assert.equal(ins.code, 0, ins.out);

    const after = checklistLines();
    assert.equal(after.length, before + 1, `expected a new checklist entry, got:\n${after.join('\n')}`);
    assert.ok(after.some(l => /Urgent hotfix/.test(l)));
  });

  test('a roadmap with no checklist is left alone rather than given one', () => {
    // Some roadmaps carry only detail sections. Inventing a list there would be a
    // bigger surprise than omitting one entry.
    fs.writeFileSync(path.join(proj, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 1: Only details\n**Status:** Complete\n');

    const { code } = pan(['phase', 'add', 'Another']);

    assert.equal(code, 0);
    assert.equal(checklistLines().length, 0, 'must not fabricate a checklist section');
    assert.match(roadmap(), /### Phase 2: Another/, 'the detail section is still added');
  });
});

describe('phase complete ticks regardless of number spelling (P-1811, PanLoop finding 8)', () => {
  test('a padded "02" call ticks the unpadded "Phase 2:" checklist line', () => {
    // REVERT CHECK: the tick regex previously interpolated the caller's RAW
    // argument — "phase complete 02" built /Phase\s+02[:\s]/ against the
    // template's "Phase 2:" line, a silent no-op. State advanced, the checkbox
    // stayed unticked: the exact split PanLoop saw between two runs whose only
    // relevant difference was how the orchestrator spelled the number
    // (dirs and state.md say "01"; the roadmap checklist says "Phase 1").
    fs.mkdirSync(path.join(proj, '.planning', 'phases', '02-core-widget'), { recursive: true });

    const r = pan(['phase', 'complete', '02']);
    assert.equal(r.code, 0, r.out);

    assert.ok(
      checklistLines().some(l => /^\s*- \[x\].*Phase 2/.test(l)),
      `padded call must tick the unpadded checklist line, got:\n${checklistLines().join('\n')}`
    );
    assert.ok(!r.out.includes('roadmap_warning'), `no warning expected on a landed tick: ${r.out}`);
  });

  test('a missing checklist entry is reported loudly, not best-efforted past', () => {
    // The other half of finding 8: when the tick cannot land, the JSON result
    // previously still said roadmap_updated:true (the field only checked the
    // file existed). The caller — and the next audit — must be able to see
    // that the roadmap does not reflect the completion.
    fs.writeFileSync(path.join(proj, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 2: Only details, no checklist\n**Status:** In Progress\n');
    fs.mkdirSync(path.join(proj, '.planning', 'phases', '02-core-widget'), { recursive: true });

    const r = pan(['phase', 'complete', '2']);
    assert.equal(r.code, 0, r.out);

    const payload = JSON.parse(r.out);
    assert.match(payload.roadmap_warning || '', /no roadmap checklist entry/i,
      'a missed tick must surface as roadmap_warning');
    assert.equal(payload.roadmap_updated, false,
      'roadmap_updated must not claim success when the tick did not land');
  });
});
