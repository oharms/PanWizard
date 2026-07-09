/**
 * Tests for hooks/pan-statusline.js — E-8 Opus 4.7 indicators plus baseline
 * context rendering.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');

const { buildStatuslineOutput } = require('../hooks/pan-statusline.js');

// Fake fs with no todos / no update cache / no bridge writes.
function mockDeps(overrides = {}) {
  const fakeFs = {
    writeFileSync: () => { /* swallow bridge writes so tests don't touch disk */ },
    readFileSync: (p) => { throw new Error('ENOENT ' + p); },
    readdirSync: () => { throw new Error('ENOENT'); },
    statSync: () => { throw new Error('ENOENT'); },
  };
  return {
    fs: { ...fakeFs, ...(overrides.fs || {}) },
    path: require('path'),
    homeDir: overrides.homeDir || '/tmp/home',
    tmpDir: overrides.tmpDir || '/tmp',
    skipBridge: true,
  };
}

function strip(s) {
  // Strip ANSI for easier assertions.
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('pan-statusline (E-8)', () => {
  test('returns empty string for non-object data', () => {
    assert.equal(buildStatuslineOutput(null, mockDeps()), '');
    assert.equal(buildStatuslineOutput('not-an-object', mockDeps()), '');
  });

  test('renders model + directory with no extras', () => {
    const out = buildStatuslineOutput({
      model: { display_name: 'Opus 4.7' },
      workspace: { current_dir: '/Users/x/projects/repo' },
    }, mockDeps());
    const plain = strip(out);
    assert.ok(plain.includes('Opus 4.7'));
    assert.ok(plain.includes('repo'));
  });

  test('renders thinking badge when data.thinking.active is true', () => {
    const out = buildStatuslineOutput({
      model: { display_name: 'Opus' },
      workspace: { current_dir: '/x' },
      thinking: { active: true },
    }, mockDeps());
    assert.ok(out.includes('🧠'));
  });

  test('no thinking badge when not active', () => {
    const out = buildStatuslineOutput({
      model: { display_name: 'Opus' },
      workspace: { current_dir: '/x' },
      thinking: { active: false },
    }, mockDeps());
    assert.equal(out.includes('🧠'), false);
  });

  test('renders cache badge with green color at ≥70% hit rate', () => {
    const out = buildStatuslineOutput({
      model: { display_name: 'Opus' },
      workspace: { current_dir: '/x' },
      cache: { hit_rate_pct: 85 },
    }, mockDeps());
    assert.match(out, /⚡85%/);
    // Green ANSI: \x1b[32m
    assert.ok(out.includes('\x1b[32m⚡85%'));
  });

  test('renders cache badge with yellow color at 30-70%', () => {
    const out = buildStatuslineOutput({
      model: { display_name: 'Opus' },
      workspace: { current_dir: '/x' },
      cache: { hit_rate_pct: 45 },
    }, mockDeps());
    assert.match(out, /⚡45%/);
    assert.ok(out.includes('\x1b[33m⚡45%'));
  });

  test('renders cache badge with dim color below 30% (warmup)', () => {
    const out = buildStatuslineOutput({
      model: { display_name: 'Opus' },
      workspace: { current_dir: '/x' },
      cache: { hit_rate_pct: 5 },
    }, mockDeps());
    assert.ok(out.includes('\x1b[2m⚡5%'));
  });

  test('clamps cache hit rate to 0-100', () => {
    const high = buildStatuslineOutput({
      model: { display_name: 'x' }, workspace: { current_dir: '/x' },
      cache: { hit_rate_pct: 150 },
    }, mockDeps());
    assert.match(high, /⚡100%/);
    const low = buildStatuslineOutput({
      model: { display_name: 'x' }, workspace: { current_dir: '/x' },
      cache: { hit_rate_pct: -20 },
    }, mockDeps());
    assert.match(low, /⚡0%/);
  });

  test('no cache badge when hit_rate_pct absent', () => {
    const out = buildStatuslineOutput({
      model: { display_name: 'x' }, workspace: { current_dir: '/x' },
    }, mockDeps());
    assert.equal(out.includes('⚡'), false);
  });

  test('bridge file fills in cache/thinking when stdin data lacks them', () => {
    const bridge = {
      thinking_active: true,
      cache_hit_rate_pct: 72,
    };
    const deps = mockDeps({
      fs: {
        readFileSync: (p) => {
          if (p.endsWith('claude-pan-SES123.json')) return JSON.stringify(bridge);
          throw new Error('ENOENT');
        },
      },
    });
    const out = buildStatuslineOutput({
      model: { display_name: 'x' },
      workspace: { current_dir: '/x' },
      session_id: 'SES123',
    }, deps);
    assert.ok(out.includes('🧠'));
    assert.match(out, /⚡72%/);
  });

  test('stdin data takes precedence over bridge file', () => {
    const deps = mockDeps({
      fs: {
        readFileSync: () => JSON.stringify({ cache_hit_rate_pct: 10 }),
      },
    });
    const out = buildStatuslineOutput({
      model: { display_name: 'x' }, workspace: { current_dir: '/x' },
      session_id: 'S', cache: { hit_rate_pct: 90 },
    }, deps);
    assert.match(out, /⚡90%/);
    assert.equal(/⚡10%/.test(out), false);
  });

  test('context bar renders when remaining_percentage present', () => {
    const out = buildStatuslineOutput({
      model: { display_name: 'x' }, workspace: { current_dir: '/x' },
      context_window: { remaining_percentage: 50 },
    }, mockDeps());
    assert.match(out, /\d+%/);
    assert.ok(out.includes('█') || out.includes('░'));
  });

  test('update arrow appears when update cache says so', () => {
    const deps = mockDeps({
      fs: {
        readFileSync: (p) => {
          if (p.endsWith('pan-update-check.json')) return JSON.stringify({ update_available: true });
          throw new Error('ENOENT');
        },
      },
    });
    const out = buildStatuslineOutput({
      model: { display_name: 'x' }, workspace: { current_dir: '/x' },
    }, deps);
    assert.ok(out.includes('/pan:update'));
  });
});
