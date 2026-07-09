/**
 * E-4 scenario test: cross-phase memory persists between invocations.
 *
 * The memory layer is file-based (.planning/memory/<agent>.md) so it survives
 * process restarts. This test simulates phase N's planner writing a lesson
 * and phase N+2's planner reading it back.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('../helpers.cjs');

describe('E-4 scenario: memory persists across phases', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('phase 1 planner writes lesson; phase 3 planner reads it', () => {
    // Phase 1 invocation — write a lesson.
    const w1 = runPanTools('memory append pan-planner Prefer-bulk-writes-over-per-row-commits', tmpDir);
    assert.ok(w1.success, w1.error);

    // Simulate phase 2 — different agent writes, should not overwrite planner.
    const w2 = runPanTools('memory append pan-verifier Always-check-for-stubs-before-marking-passed', tmpDir);
    assert.ok(w2.success, w2.error);

    // Phase 3 — planner reads memory back.
    const r = runPanTools('memory read pan-planner', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.exists, true);
    assert.ok(json.entries.some(e => e.includes('Prefer-bulk-writes')));
    // Verifier lessons should not leak into planner memory.
    assert.equal(json.entries.some(e => e.includes('stubs')), false);
  });

  test('memory list surfaces all agents that have written', () => {
    runPanTools('memory append pan-planner a', tmpDir);
    runPanTools('memory append pan-verifier b', tmpDir);
    runPanTools('memory append pan-reviewer c', tmpDir);

    const r = runPanTools('memory list', tmpDir);
    const json = JSON.parse(r.output);
    assert.equal(json.agents.length, 3);
    const names = json.agents.map(a => a.agent).sort();
    assert.deepEqual(names, ['pan-planner', 'pan-reviewer', 'pan-verifier']);
  });

  test('compaction keeps only the most recent N entries', () => {
    for (let i = 0; i < 10; i++) {
      runPanTools(`memory append pan-planner entry-${i}`, tmpDir);
    }

    const comp = runPanTools('memory compact pan-planner 3', tmpDir);
    assert.ok(comp.success, comp.error);
    const compJson = JSON.parse(comp.output);
    assert.equal(compJson.kept, 3);
    assert.equal(compJson.removed, 7);

    const r = runPanTools('memory read pan-planner', tmpDir);
    const json = JSON.parse(r.output);
    assert.equal(json.entries.length, 3);
    // Must keep the newest (entry-7, entry-8, entry-9).
    assert.ok(json.entries[2].includes('entry-9'));
    assert.ok(json.entries[0].includes('entry-7'));
  });

  test('memory file has stable frontmatter + single Entries section after multiple writes', () => {
    for (let i = 0; i < 5; i++) {
      runPanTools(`memory append pan-planner lesson${i}`, tmpDir);
    }
    const memFile = path.join(tmpDir, '.planning', 'memory', 'pan-planner.md');
    const content = fs.readFileSync(memFile, 'utf-8');

    // Exactly one frontmatter block.
    const fmMatches = content.match(/^---\n[\s\S]*?\n---/gm) || [];
    assert.equal(fmMatches.length, 1);

    // Exactly one "## Entries" heading.
    const headingMatches = content.match(/^## Entries\s*$/gm) || [];
    assert.equal(headingMatches.length, 1);
  });

  test('path traversal attempts are rejected across CLI', () => {
    const r = runPanTools('memory append ../escape foo', tmpDir);
    // Command returns JSON with error, shell still succeeds.
    const json = JSON.parse(r.output);
    assert.ok(json.error);
    assert.equal(fs.existsSync(path.join(tmpDir, '.planning', 'memory', '..', 'escape.md')), false);
  });
});
