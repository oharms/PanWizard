/**
 * Tests for squads.cjs — the bot-army squad model (ADR-0032).
 * Includes the load-bearing drift test: squad roster ⇄ real agent files.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const squads = require('../pan-wizard-core/bin/lib/squads.cjs');

const AGENTS_DIR = path.join(__dirname, '..', 'agents');
const realAgents = fs.readdirSync(AGENTS_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => f.replace('.md', ''));

describe('squads — registry', () => {
  test('four squads with tier + access contracts', () => {
    const list = squads.listSquads();
    assert.deepEqual(list.map(s => s.name).sort(), ['architecture', 'build', 'quality', 'release']);
    for (const s of list) {
      assert.ok(['reasoning', 'mid', 'fast'].includes(s.tier), `${s.name} tier`);
      assert.ok(typeof s.access === 'string' && s.access.length > 0, `${s.name} access`);
    }
  });

  test('build squad is read-write-bash; architecture + quality read-only; release always-ask', () => {
    assert.equal(squads.getSquad('build').access, 'read-write-bash');
    assert.equal(squads.getSquad('architecture').access, 'read-only');
    assert.equal(squads.getSquad('quality').access, 'read-only');
    assert.equal(squads.getSquad('release').access, 'always-ask');
  });

  test('getSquad returns null for unknown', () => {
    assert.equal(squads.getSquad('nope'), null);
  });

  test('squadForAgent reverse lookup', () => {
    assert.equal(squads.squadForAgent('pan-executor'), 'build');
    assert.equal(squads.squadForAgent('pan-hardener'), 'quality');
    assert.equal(squads.squadForAgent('pan-roadmapper'), 'architecture');
    assert.equal(squads.squadForAgent('pan-conductor'), null, 'coordinator is not a squad member');
    assert.equal(squads.squadForAgent('pan-document_code'), null, 'workers are not squad members');
  });
});

describe('squads — roster drift (ADR-0032 invariant)', () => {
  test('every squad member is a real agent file', () => {
    const v = squads.validateRoster(realAgents);
    assert.deepEqual(v.missing, [], 'squad members must all exist on disk');
  });

  test('every real agent is placed (coordinator, worker, or exactly one squad)', () => {
    const v = squads.validateRoster(realAgents);
    assert.deepEqual(v.unassigned, [],
      'unassigned agents — add to a squad or the worker list in squads.cjs');
    assert.equal(v.ok, true);
  });

  test('no agent is in two squads', () => {
    const seen = new Set();
    for (const name of squads.SQUAD_NAMES) {
      for (const a of squads.getSquad(name).agents) {
        assert.ok(!seen.has(a), `${a} appears in two squads`);
        seen.add(a);
      }
    }
  });

  test('coordinator and workers are disjoint from squads', () => {
    const squadMembers = new Set(
      squads.SQUAD_NAMES.flatMap(n => squads.getSquad(n).agents)
    );
    assert.ok(!squadMembers.has(squads.COORDINATOR));
    for (const w of squads.WORKERS) {
      assert.ok(!squadMembers.has(w), `${w} is both a worker and a squad member`);
    }
  });
});
