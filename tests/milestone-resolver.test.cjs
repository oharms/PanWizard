/**
 * Tests for the milestone resolver in core.cjs.
 *
 * Regression cover for the "spliced milestone" defect: version and name were
 * matched by two INDEPENDENT unanchored regexes over the whole roadmap, so the
 * version could come from one milestone (or from body prose) and the name from
 * another, producing a milestone that does not exist — silently, with nothing
 * in the output to suggest a problem.
 *
 * The invariant every test here defends: version and name come from THE SAME
 * heading, and that heading is a real heading.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  getMilestoneInfo,
  parseMilestoneHeadings,
  selectCurrentMilestone,
  extractMilestoneName,
} = require('../pan-wizard-core/bin/lib/core.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

/** Resolve a roadmap body through the real file-reading entry point. */
function resolveRoadmap(tmpDir, body) {
  fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), body);
  return getMilestoneInfo(tmpDir);
}

describe('milestone resolver — the splice defect', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('a version mentioned in body prose is never picked up', () => {
    const info = resolveRoadmap(tmpDir, [
      '# Roadmap',
      '',
      'Some overview text mentioning v9.9 in passing.',
      '',
      '### Milestone v1.0 — Foundations (phases 1–5)',
      '### Milestone v2.0 — Expansion (current, phases 6–10)',
      '',
    ].join('\n'));

    assert.notEqual(info.version, 'v9.9', 'prose version leaked into the milestone');
    assert.equal(info.version, 'v2.0');
    assert.equal(info.name, 'Expansion');
  });

  test('version and name always come from the same heading', () => {
    // The exact reported shape: a prose version first, then H3 milestones whose
    // names belong to different versions.
    const info = resolveRoadmap(tmpDir, [
      '# Roadmap',
      '',
      '**Milestone v4.2 — Ledger Rebrand is queued behind the current work.**',
      '',
      '### Milestone v4.1 — Full Platform (phases 1–12)',
      '### Milestone v4.3 — Consolidation (current, phases 1–10)',
      '',
    ].join('\n'));

    assert.equal(info.version, 'v4.3');
    assert.equal(info.name, 'Consolidation');
    assert.notEqual(info.name, 'Full Platform', 'name spliced from a different milestone');
    assert.notEqual(info.version, 'v4.2', 'version taken from prose');
  });

  test('`## ` no longer matches inside `### `', () => {
    const headings = parseMilestoneHeadings('### Milestone v3.0 — Deep Heading\n');
    assert.equal(headings.length, 1);
    assert.equal(headings[0].version, 'v3.0');
    assert.equal(headings[0].name, 'Deep Heading');
  });

  test('resolves PAN\'s own milestone-grouped roadmap template correctly', () => {
    // This format ships in templates/roadmap.md. Under the old resolver it
    // produced v1.0 (a SHIPPED milestone, read out of the summary bullet list)
    // spliced with the name of v1.1.
    const info = resolveRoadmap(tmpDir, [
      '# Roadmap: Demo',
      '',
      '## Milestones',
      '',
      '- ✅ **v1.0 MVP** - Phases 1-4 (shipped 2026-01-01)',
      '- 🚧 **v1.1 Hardening** - Phases 5-6 (in progress)',
      '- 📋 **v2.0 Platform** - Phases 7-10 (planned)',
      '',
      '## Phases',
      '',
      '<details>',
      '<summary>✅ v1.0 MVP (Phases 1-4) - SHIPPED 2026-01-01</summary>',
      '### Phase 1: Foundation',
      '</details>',
      '',
      '### 🚧 v1.1 Hardening (In Progress)',
      '### 📋 v2.0 Platform (Planned)',
      '',
    ].join('\n'));

    assert.equal(info.version, 'v1.1');
    assert.equal(info.name, 'Hardening');
    assert.equal(info.status, 'current');
    assert.equal(info.basis, 'marked-current');
  });
});

describe('milestone resolver — selection rules', () => {
  test('an explicitly current milestone wins over document order', () => {
    const info = selectCurrentMilestone(parseMilestoneHeadings([
      '## Milestone v1.0 — First',
      '## Milestone v2.0 — Second (current)',
      '## Milestone v3.0 — Third',
    ].join('\n')));
    assert.equal(info.milestone.version, 'v2.0');
    assert.equal(info.basis, 'marked-current');
  });

  test('"(current, phases 6-10)" counts as a current marker', () => {
    const [h] = parseMilestoneHeadings('### Milestone v2.0 — Expansion (current, phases 6–10)\n');
    assert.equal(h.status, 'current',
      'a marker embedded in a longer parenthetical must still register');
  });

  test('with nothing marked current, the first unshipped milestone wins', () => {
    const info = selectCurrentMilestone(parseMilestoneHeadings([
      '## v1.0 MVP (Shipped: 2025-11-25)',
      '## v1.1 Hardening',
      '## v2.0 Platform',
    ].join('\n')));
    assert.equal(info.milestone.version, 'v1.1');
    assert.equal(info.basis, 'first-unshipped');
  });

  test('when everything is shipped, the newest shipped milestone wins', () => {
    const info = selectCurrentMilestone(parseMilestoneHeadings([
      '## v1.0 MVP (Shipped: 2025-11-25)',
      '## v1.1 Security & Polish (Shipped: 2025-12-10)',
    ].join('\n')));
    assert.equal(info.milestone.version, 'v1.1');
    assert.equal(info.milestone.name, 'Security & Polish');
    assert.equal(info.basis, 'last-shipped');
  });

  test('two milestones marked current is reported as ambiguous, not resolved silently', () => {
    const info = selectCurrentMilestone(parseMilestoneHeadings([
      '### Milestone v3.0 — Alpha (current)',
      '### Milestone v3.1 — Beta (current)',
    ].join('\n')));
    assert.equal(info.ambiguous, true,
      'a duplicated (current) marker is a planning-state error and must surface');
    assert.equal(info.milestone.version, 'v3.0', 'first wins, but the caller is told');
  });

  test('a roadmap with no milestone heading resolves to the default, flagged', () => {
    const info = selectCurrentMilestone(parseMilestoneHeadings('# Roadmap\n\n### Phase 1: Setup\n'));
    assert.equal(info.milestone, null);
    assert.equal(info.basis, 'none');
  });
});

describe('milestone resolver — name extraction', () => {
  test('strips emoji, the version token, and trailing parentheticals', () => {
    assert.equal(extractMilestoneName('🚧 Milestone v4.1 — Full Platform (phases 1–12)', 'v4.1'), 'Full Platform');
    assert.equal(extractMilestoneName('📋 v2.0 Platform (Planned)', 'v2.0'), 'Platform');
  });

  test('strips the leading separator the old resolver left behind', () => {
    // The old code returned "— Full Platform", em dash included.
    const name = extractMilestoneName('Milestone v4.1 — Full Platform', 'v4.1');
    assert.equal(name, 'Full Platform');
    assert.ok(!name.startsWith('—'), 'leading separator not stripped');
  });

  test('handles a colon separator', () => {
    assert.equal(extractMilestoneName('Milestone v2.5: Great Feature', 'v2.5'), 'Great Feature');
  });

  test('drops a shipped-date trailer', () => {
    assert.equal(extractMilestoneName('v1.1 Security & Polish (Shipped: 2025-12-10)', 'v1.1'), 'Security & Polish');
  });

  test('a heading with no name yields an empty string, not junk', () => {
    assert.equal(extractMilestoneName('Milestone v1.0', 'v1.0'), '');
  });
});

describe('milestone resolver — versions and defaults', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('supports three-part versions', () => {
    const info = resolveRoadmap(tmpDir, '## Milestone v1.2.3 — Patch Train (current)\n');
    assert.equal(info.version, 'v1.2.3');
    assert.equal(info.name, 'Patch Train');
  });

  test('falls back to defaults when roadmap.md is absent', () => {
    const info = getMilestoneInfo(tmpDir);
    assert.equal(info.version, 'v1.0');
    assert.equal(info.name, 'milestone');
    assert.equal(info.basis, 'default');
  });

  test('an empty roadmap falls back and says why', () => {
    const info = resolveRoadmap(tmpDir, '');
    assert.equal(info.version, 'v1.0');
    assert.equal(info.name, 'milestone');
    assert.equal(info.basis, 'no-milestone-heading');
  });

  test('a nameless heading falls back to the generic name, keeping the real version', () => {
    const info = resolveRoadmap(tmpDir, '## Milestone v7.0\n');
    assert.equal(info.version, 'v7.0');
    assert.equal(info.name, 'milestone');
  });

  test('reports how many milestone headings it saw', () => {
    const info = resolveRoadmap(tmpDir, [
      '## Milestone v1.0 — First',
      '## Milestone v2.0 — Second',
      '## Milestone v3.0 — Third',
    ].join('\n'));
    assert.equal(info.candidates, 3);
  });
});

// ─── init milestone-op: multi-track sweep ───────────────────────────────────

/**
 * `--all-tracks` exists because a milestone audit run against the wrong tree
 * produces a confident, plausible, wrong report. The sweep makes the scope
 * explicit instead of implicit in whichever directory the command resolved.
 */
describe('init milestone-op — multi-track', () => {
  const { runPanTools } = require('./helpers.cjs');
  let tmp;

  function makeTrack(name, roadmap) {
    const abs = path.join(tmp, '.planning', 'tracks', name);
    fs.mkdirSync(path.join(abs, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(abs, 'state.md'), '# State\n');
    if (roadmap) fs.writeFileSync(path.join(abs, 'roadmap.md'), roadmap);
    return abs;
  }

  beforeEach(() => {
    tmp = createTempProject();
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), '# State\n');
    fs.writeFileSync(path.join(tmp, '.planning', 'roadmap.md'),
      '### Milestone v1.0 — Exchange Core (current)\n');
  });
  afterEach(() => cleanup(tmp));

  test('--track audits a sibling tree, not the root', () => {
    makeTrack('core', [
      '# Roadmap',
      '',
      '**Milestone v4.2 — Ledger Rebrand is queued behind the current work.**',
      '',
      '### Milestone v4.1 — Full Platform (phases 1–12)',
      '### Milestone v4.3 — Consolidation (current, phases 1–10)',
      '',
    ].join('\n'));

    const j = JSON.parse(runPanTools('init milestone-op --track core', tmp).output);
    assert.equal(j.planning_root, '.planning/tracks/core');
    assert.equal(j.track, 'core');
    assert.equal(j.milestone_version, 'v4.3');
    assert.equal(j.milestone_name, 'Consolidation');
    assert.notEqual(j.milestone_version, 'v1.0', 'resolved the root tree instead of the track');
  });

  test('--all-tracks reports every tree, each labelled with its own root', () => {
    makeTrack('core', '### Milestone v4.3 — Consolidation (current)\n');
    makeTrack('verify', '### Milestone v2.0 — Harness (current)\n');

    const j = JSON.parse(runPanTools('init milestone-op --all-tracks', tmp).output);
    assert.equal(j.all_tracks, true);
    assert.equal(j.track_count, 3);
    assert.deepEqual(j.tracks.map(t => t.track), [null, 'core', 'verify']);
    assert.deepEqual(j.tracks.map(t => t.planning_root),
      ['.planning', '.planning/tracks/core', '.planning/tracks/verify']);
    assert.deepEqual(j.tracks.map(t => t.milestone_version), ['v1.0', 'v4.3', 'v2.0'],
      'each tree resolves its own milestone');
  });

  test('a track marking two milestones current is surfaced, not silently resolved', () => {
    makeTrack('defense', '### Milestone v2.0 — Alpha (current)\n### Milestone v2.1 — Beta (current)\n');

    const j = JSON.parse(runPanTools('init milestone-op --all-tracks', tmp).output);
    assert.deepEqual(j.ambiguous_tracks, ['defense'],
      'the audit must be told which tree it cannot resolve');
    const defense = j.tracks.find(t => t.track === 'defense');
    assert.equal(defense.milestone_ambiguous, true);
  });

  test('a single-tree run reports how the milestone was decided', () => {
    const j = JSON.parse(runPanTools('init milestone-op', tmp).output);
    assert.equal(j.milestone_basis, 'marked-current');
    assert.equal(j.milestone_ambiguous, false);
    assert.equal(j.planning_root, '.planning');
    assert.equal(j.planning_root_source, 'default');
  });

  test('a roadmap with no milestone heading reports basis "default", not a fake v1.0 answer', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'roadmap.md'), '# Roadmap\n\n### Phase 1: Setup\n');
    const j = JSON.parse(runPanTools('init milestone-op', tmp).output);
    assert.equal(j.milestone_version, 'v1.0');
    assert.equal(j.milestone_basis, 'no-milestone-heading',
      'the caller must be able to tell a real v1.0 from a fallback');
    assert.equal(j.milestone_candidates, 0);
  });
});
