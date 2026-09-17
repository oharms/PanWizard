/**
 * Surface map — every shipped surface row is named by a test, or sits in the
 * allowlist with a reason (spec docs/specs/testing-system-redesign-2026-09.md §3.1).
 *
 * The rows come from the code (scripts/test-surface.cjs), not from the tests, so a
 * new verb, flag, hook registration, MCP tool or config key shows up here as a
 * failure until a test names it. The committed registry tests/fixtures/surface.json
 * is the reviewable copy; it must match the extraction.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  ROOT, REGISTRY_REL, ALLOWLIST_REL, extractSurface, surfaceRows, mapSurface, loadTestSources, diffSurface,
} = require('../scripts/test-surface.cjs');

describe('surface map — the code names the surface, the tests must name it back', () => {
  const surface = extractSurface(ROOT);
  const rows = mapSurface(surfaceRows(surface), loadTestSources(ROOT));

  test('the committed registry matches the code (run `node scripts/test-surface.cjs --write` after a surface change)', () => {
    const committed = JSON.parse(fs.readFileSync(path.join(ROOT, REGISTRY_REL), 'utf8'));
    const d = diffSurface(committed, surface);
    assert.deepEqual(d, { added: [], removed: [] }, `registry drift — added ${JSON.stringify(d.added)} removed ${JSON.stringify(d.removed)}`);
  });

  test('the extraction is not vacuous: the known surface is present', () => {
    assert.ok(surface.verbs.includes('state') && surface.verbs.includes('cost'));
    assert.ok(surface.subcommands.includes('state snapshot') && surface.subcommands.includes('cost rebuild'));
    assert.ok(surface.case_arms.includes('state') && surface.case_arms.length > 50);
    assert.ok(surface.installer_flags.includes('--claude') && surface.installer_flags.includes('--unified-skills'));
    assert.ok(surface.hooks.some((h) => h.runtime === 'codex' && h.hook === 'pan-cost-logger.js'));
    assert.ok(!surface.hooks.some((h) => h.runtime === 'opencode'), 'OpenCode has no hook system');
    assert.ok(surface.mcp.tools.includes('pan_next_action') && surface.mcp.resources.includes('pan://health'));
    assert.ok(surface.config_keys.includes('commit_docs') && surface.config_keys.some((k) => k.startsWith('budget.')));
    assert.deepEqual(Object.keys(surface.content).sort(), ['agents', 'commands/pan', 'pan-wizard-core/workflows']);
  });

  test('every surface row is referenced by a test, or allowlisted with a reason that is still true', () => {
    let allowlist = [];
    try { allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, ALLOWLIST_REL), 'utf8')); } catch { /* none */ }
    const allow = new Map(allowlist.map((a) => [a.id, a]));
    const problems = [];
    for (const a of allowlist) {
      if (!a.reason || !String(a.reason).trim()) problems.push(`allowlist entry ${a.id} has no reason`);
      const row = rows.find((r) => r.id === a.id);
      if (!row) problems.push(`allowlist entry ${a.id} names a surface row that no longer exists — remove it`);
      else if (row.hits.length) problems.push(`allowlist entry ${a.id} is referenced now by ${row.hits[0]} — remove the entry`);
    }
    const missing = rows.filter((r) => !r.hits.length && !allow.has(r.id));
    for (const r of missing) problems.push(`no test names ${r.id} — write one (\`node scripts/test-surface.cjs --scaffold <dir>\` emits a stub) or allowlist it in ${ALLOWLIST_REL} with a reason`);
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  test('the map itself can fail: a row nothing names is reported missing, a named one is found', () => {
    // A subcommand name no test file can contain (this file included) — built at run time.
    const never = `zz-never-${process.pid}-${Date.now()}`;
    const fake = mapSurface([{ id: `sub:state ${never}`, kind: 'sub', verb: 'state', sub: never }, { id: 'sub:state snapshot', kind: 'sub', verb: 'state', sub: 'snapshot' }], loadTestSources(ROOT));
    assert.equal(fake[0].hits.length, 0);
    assert.ok(fake[1].hits.length > 0);
  });
});
