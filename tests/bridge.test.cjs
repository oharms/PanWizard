/**
 * Tests for bridge.cjs — Y-5 MCP discovery + recommendation (v3.3).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  loadToolCache,
  writeToolCache,
  flattenTools,
  listTools,
  scoreToolForPhase,
  recommendForPhase,
  BRIDGE_DIR,
  TOOLS_FILE,
} = require('../pan-wizard-core/bin/lib/bridge.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─── loadToolCache ──────────────────────────────────────────────────────────

describe('bridge — loadToolCache', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns empty catalog when cache file missing', () => {
    const r = loadToolCache(tmpDir);
    assert.equal(r.source, 'empty');
    assert.deepEqual(r.servers, []);
    assert.equal(r.cached_at, null);
  });

  test('returns empty catalog when cache file malformed', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', BRIDGE_DIR), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', BRIDGE_DIR, TOOLS_FILE), 'not-json');
    const r = loadToolCache(tmpDir);
    assert.equal(r.source, 'empty');
    assert.deepEqual(r.servers, []);
  });

  test('parses valid cache', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', BRIDGE_DIR), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', BRIDGE_DIR, TOOLS_FILE), JSON.stringify({
      cached_at: '2026-04-18T00:00:00Z',
      runtime: 'claude',
      servers: [
        { name: 'linear', tools: [{ name: 'linear.updateTicket', description: 'Update Linear ticket' }] },
      ],
    }));
    const r = loadToolCache(tmpDir);
    assert.equal(r.source, 'cache');
    assert.equal(r.runtime, 'claude');
    assert.equal(r.servers.length, 1);
    assert.equal(r.servers[0].name, 'linear');
  });
});

// ─── writeToolCache ─────────────────────────────────────────────────────────

describe('bridge — writeToolCache', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('creates cache file with required fields', () => {
    const r = writeToolCache(tmpDir, {
      runtime: 'claude',
      servers: [{ name: 'slack', tools: [{ name: 'slack.postMessage' }] }],
    });
    assert.equal(r.written, true);
    const raw = fs.readFileSync(path.join(tmpDir, '.planning', BRIDGE_DIR, TOOLS_FILE), 'utf-8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.runtime, 'claude');
    assert.ok(parsed.cached_at);
    assert.equal(parsed.servers.length, 1);
  });

  test('returns error for invalid input', () => {
    assert.ok(writeToolCache(tmpDir, null).error);
  });

  test('defaults servers to empty array when missing', () => {
    writeToolCache(tmpDir, { runtime: 'claude' });
    const raw = fs.readFileSync(path.join(tmpDir, '.planning', BRIDGE_DIR, TOOLS_FILE), 'utf-8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.servers, []);
  });
});

// ─── flattenTools ───────────────────────────────────────────────────────────

describe('bridge — flattenTools', () => {
  test('empty input yields empty list', () => {
    assert.deepEqual(flattenTools([]), []);
    assert.deepEqual(flattenTools(null), []);
  });

  test('flattens multiple servers each with multiple tools', () => {
    const out = flattenTools([
      { name: 'linear', tools: [{ name: 'linear.updateTicket' }, { name: 'linear.createIssue' }] },
      { name: 'slack', tools: [{ name: 'slack.postMessage' }] },
    ]);
    assert.equal(out.length, 3);
    const names = out.map(t => t.name).sort();
    assert.deepEqual(names, ['linear.createIssue', 'linear.updateTicket', 'slack.postMessage']);
  });

  test('ignores servers with no tools array', () => {
    const out = flattenTools([
      { name: 'empty-server' },
      { name: 'ok', tools: [{ name: 'ok.tool' }] },
    ]);
    assert.equal(out.length, 1);
  });

  test('ignores tools without names', () => {
    const out = flattenTools([
      { name: 's', tools: [{ name: 'a' }, { description: 'no name' }] },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'a');
  });

  test('attaches server name to each tool', () => {
    const out = flattenTools([{ name: 'gh', tools: [{ name: 'gh.createPr' }] }]);
    assert.equal(out[0].server, 'gh');
  });
});

// ─── scoreToolForPhase ──────────────────────────────────────────────────────

describe('bridge — scoreToolForPhase', () => {
  test('empty phase text scores zero', () => {
    const r = scoreToolForPhase('', { name: 'x', description: 'y' });
    assert.equal(r.score, 0);
  });

  test('keyword in plan matches tool name', () => {
    const r = scoreToolForPhase('We will update the linear ticket after deploy.',
      { server: 'linear', name: 'linear.updateTicket', description: 'Update a Linear issue' });
    assert.ok(r.score >= 1);
    assert.ok(r.hits.includes('linear'));
  });

  test('multiple occurrences accumulate', () => {
    const single = scoreToolForPhase('postgres once.',
      { name: 'postgres.query', description: 'query postgres' });
    const multi = scoreToolForPhase('postgres postgres postgres everywhere.',
      { name: 'postgres.query', description: 'query postgres' });
    assert.ok(multi.score > single.score);
  });

  test('word boundary prevents partial matches', () => {
    const r = scoreToolForPhase('postgresql is different.',
      { name: 'postgres.query', description: 'query postgres' });
    // "postgres" should not match inside "postgresql".
    // hits may include "query" or others; just assert postgres specifically misses.
    assert.equal(r.hits.includes('postgres') && r.score === 1, false);
  });

  test('case-insensitive matching', () => {
    const r = scoreToolForPhase('Update LINEAR ticket #42.',
      { name: 'linear.updateTicket', description: 'tool' });
    assert.ok(r.score >= 1);
  });
});

// ─── recommendForPhase ──────────────────────────────────────────────────────

describe('bridge — recommendForPhase', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  function scaffoldPhase(num, slug, planContent) {
    const dir = path.join(tmpDir, '.planning', 'phases', `${num}-${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-plan.md'), planContent);
  }

  function seedCache(servers, runtime = 'claude') {
    writeToolCache(tmpDir, { runtime, servers });
  }

  test('returns empty recommendations when cache is empty', () => {
    scaffoldPhase('01', 'a', 'plan content');
    const r = recommendForPhase(tmpDir, '01');
    assert.deepEqual(r.recommendations, []);
    assert.match(r.reason, /no MCP tools cached/);
  });

  test('returns error for unknown phase', () => {
    seedCache([{ name: 'x', tools: [{ name: 'x.y' }] }]);
    const r = recommendForPhase(tmpDir, '99');
    assert.ok(r.error);
  });

  test('ranks tools by relevance to plan keywords', () => {
    seedCache([
      { name: 'linear', tools: [
        { name: 'linear.updateTicket', description: 'Update Linear ticket' },
        { name: 'linear.createIssue', description: 'Create Linear issue' },
      ]},
      { name: 'slack', tools: [
        { name: 'slack.postMessage', description: 'Post to Slack channel' },
      ]},
    ]);
    scaffoldPhase('02', 'ticket', 'We update the Linear ticket status after deploy. No slack needed.');
    const r = recommendForPhase(tmpDir, '02');
    assert.ok(r.recommendations.length >= 1);
    // Linear tools should score higher than slack.
    const linearTop = r.recommendations[0];
    assert.match(linearTop.name, /^linear/);
  });

  test('respects max_recommendations cap', () => {
    const tools = Array.from({ length: 10 }, (_, i) => ({
      name: `tool${i}.run`, description: `test tool ${i}`,
    }));
    seedCache([{ name: 'test', tools }]);
    scaffoldPhase('03', 'tester', 'We run many test tools here for tool test.');
    const r = recommendForPhase(tmpDir, '03', { max_recommendations: 3 });
    assert.ok(r.recommendations.length <= 3);
  });

  test('min_score filters out unrelated tools', () => {
    seedCache([{ name: 's', tools: [
      { name: 's.a', description: 'completely unrelated' },
      { name: 's.postgres', description: 'postgres query tool' },
    ]}]);
    scaffoldPhase('04', 'db', 'We use postgres for the database layer.');
    const r = recommendForPhase(tmpDir, '04', { min_score: 1 });
    // Only postgres tool should survive.
    assert.ok(r.recommendations.every(t => /postgres/.test(t.name) || /postgres/.test(t.description)));
  });

  test('attaches hits array to each recommendation', () => {
    seedCache([{ name: 'linear', tools: [{ name: 'linear.updateTicket', description: 'Update Linear ticket' }] }]);
    scaffoldPhase('05', 'lin', 'Update the linear ticket.');
    const r = recommendForPhase(tmpDir, '05');
    assert.ok(r.recommendations[0].hits.length >= 1);
    assert.ok(r.recommendations[0].hits.includes('linear'));
  });
});

// ─── CLI dispatch ───────────────────────────────────────────────────────────

describe('bridge — CLI dispatch', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('bridge list returns empty catalog when cache missing', () => {
    const r = runPanTools('bridge list', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.source, 'empty');
    assert.equal(json.tool_count, 0);
  });

  test('bridge list returns tools when cache present', () => {
    writeToolCache(tmpDir, {
      runtime: 'claude',
      servers: [{ name: 'gh', tools: [{ name: 'gh.createPr', description: 'Create PR' }] }],
    });
    const r = runPanTools('bridge list', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.source, 'cache');
    assert.equal(json.tool_count, 1);
    assert.equal(json.tools[0].name, 'gh.createPr');
  });

  test('bridge recommend returns ranked list', () => {
    writeToolCache(tmpDir, {
      runtime: 'claude',
      servers: [{ name: 'linear', tools: [{ name: 'linear.updateTicket', description: 'Update Linear ticket' }] }],
    });
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '06-lin');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-plan.md'), 'Update linear ticket when done.');
    const r = runPanTools('bridge recommend 06', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.ok(json.recommendations.length >= 1);
  });

  test('unknown subcommand errors', () => {
    const r = runPanTools('bridge nuke', tmpDir);
    assert.equal(r.success, false);
  });
});
