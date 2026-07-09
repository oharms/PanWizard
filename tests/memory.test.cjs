/**
 * Tests for memory.cjs — cross-phase agent memory layer
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  readMemory,
  appendMemory,
  compactMemory,
  listMemoryAgents,
  selectMemory,
  memoryLoadBudget,
  parseEntries,
  validateAgentName,
  MEMORY_DIR,
  DEFAULT_MAX_ENTRIES,
} = require('../pan-wizard-core/bin/lib/memory.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

function readFile(tmpDir, agent) {
  return fs.readFileSync(path.join(tmpDir, '.planning', MEMORY_DIR, `${agent}.md`), 'utf-8');
}

describe('memory — selectMemory (ADR-0036 FW-2)', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('empty log returns mode "empty" with no entries', () => {
    const r = selectMemory(tmp, 'pan-executor', { cue: 'x' });
    assert.equal(r.mode, 'empty');
    assert.deepEqual(r.selected, []);
    assert.equal(r.total_tokens, 0);
  });

  test('cue mode keeps the recency floor AND cue hits, bounded by budget', () => {
    for (let i = 1; i <= 20; i++) {
      appendMemory(tmp, 'pan-executor', `lesson ${i} about ${i % 3 === 0 ? 'postgres bulk writes' : 'unrelated detail'}`);
    }
    const r = selectMemory(tmp, 'pan-executor', { cue: 'postgres bulk', tokenBudget: 200, recencyFloor: 2 });
    assert.equal(r.mode, 'cue');
    assert.equal(r.considered, 20);
    assert.ok(r.total_tokens <= 200, `tokens ${r.total_tokens} within budget`);
    assert.ok(r.selected.some(e => /lesson 20/.test(e)), 'recency floor keeps the newest entry');
    assert.ok(r.selected.some(e => /postgres/.test(e)), 'a cue hit is included');
    assert.ok(r.selected.length < 20, 'budget dropped some entries');
  });

  test('empty cue falls back to recency-only', () => {
    for (let i = 1; i <= 10; i++) appendMemory(tmp, 'pan-executor', `entry ${i}`);
    const r = selectMemory(tmp, 'pan-executor', { cue: '', tokenBudget: 100 });
    assert.equal(r.mode, 'recency');
    assert.ok(r.selected.length >= 1);
  });

  test('never returns empty on a non-empty log even under a tiny budget', () => {
    appendMemory(tmp, 'pan-executor', 'a fairly long single memory entry that exceeds a one-token budget');
    const r = selectMemory(tmp, 'pan-executor', { cue: 'nomatch', tokenBudget: 1 });
    assert.ok(r.selected.length >= 1, 'recency fallback guarantees non-empty');
  });

  test('output stays in chronological (stored) order', () => {
    for (let i = 1; i <= 6; i++) appendMemory(tmp, 'pan-executor', `postgres lesson ${i}`);
    const r = selectMemory(tmp, 'pan-executor', { cue: 'postgres', tokenBudget: 5000 });
    const nums = r.selected.map(e => Number((e.match(/lesson (\d+)/) || [])[1]));
    assert.deepEqual(nums, [...nums].sort((a, b) => a - b), 'entries stay oldest→newest');
  });

  test('rejects an invalid agent name', () => {
    assert.ok(selectMemory(tmp, '../x', {}).error);
  });
});

describe('memory — soft auto-compaction (ADR-0036)', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('appendMemory trims once the log crosses 2× the cap', () => {
    let fired = false, last;
    for (let i = 0; i < DEFAULT_MAX_ENTRIES * 2 + 2; i++) {
      last = appendMemory(tmp, 'pan-hardener', `entry ${i}`);
      if (last.auto_compacted) fired = true;
    }
    assert.ok(fired, 'soft auto-compaction fired at the soft cap');
    assert.ok(last.count <= DEFAULT_MAX_ENTRIES + 5, `final count ${last.count} bounded near the cap`);
    assert.ok(readMemory(tmp, 'pan-hardener').entries.length <= DEFAULT_MAX_ENTRIES + 5);
  });

  test('does not compact below the soft cap', () => {
    let last;
    for (let i = 0; i < 10; i++) last = appendMemory(tmp, 'pan-hardener', `entry ${i}`);
    assert.equal(last.count, 10);
    assert.equal(last.auto_compacted, undefined);
  });
});

describe('memory — memoryLoadBudget (ADR-0036 acceptance signal)', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('empty project is ok with zero tokens', () => {
    const b = memoryLoadBudget(tmp);
    assert.equal(b.status, 'ok');
    assert.equal(b.memory_tokens, 0);
    assert.equal(b.agents, 0);
  });

  test('flags warning/critical once memory grows large', () => {
    const big = 'x'.repeat(400);
    for (let i = 0; i < 120; i++) appendMemory(tmp, 'pan-executor', `${big} ${i}`);
    const b = memoryLoadBudget(tmp);
    assert.ok(b.memory_tokens > 0);
    assert.ok(['warning', 'critical'].includes(b.status), `status was ${b.status}`);
    assert.match(b.advisory, /memory select|memory compact/);
  });

  test('degrades gracefully with no cost ledger (median null)', () => {
    appendMemory(tmp, 'pan-executor', 'one entry');
    const b = memoryLoadBudget(tmp);
    assert.equal(b.median_input_tokens, null);
    assert.equal(b.fraction, null);
  });
});

describe('memory — validateAgentName', () => {
  test('accepts valid names', () => {
    assert.equal(validateAgentName('pan-planner'), null);
    assert.equal(validateAgentName('pan_executor'), null);
    assert.equal(validateAgentName('custom123'), null);
  });

  test('rejects path traversal', () => {
    assert.ok(validateAgentName('../escape').includes('Invalid'));
    assert.ok(validateAgentName('..\\escape').includes('Invalid'));
    assert.ok(validateAgentName('a/b').includes('Invalid'));
  });

  test('rejects empty or non-string', () => {
    assert.ok(validateAgentName('').includes('Invalid'));
    assert.ok(validateAgentName(null).includes('Invalid'));
    assert.ok(validateAgentName(42).includes('Invalid'));
  });
});

describe('memory — appendMemory + readMemory', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('creates file and directory on first append', () => {
    const res = appendMemory(tmpDir, 'pan-planner', 'Use bulk Postgres writes');
    assert.equal(res.appended, true);
    assert.equal(res.count, 1);
    assert.ok(fs.existsSync(res.file));
  });

  test('reads entries back with correct content', () => {
    appendMemory(tmpDir, 'pan-planner', 'Lesson one');
    appendMemory(tmpDir, 'pan-planner', 'Lesson two');
    const mem = readMemory(tmpDir, 'pan-planner');
    assert.ok(mem);
    assert.equal(mem.entries.length, 2);
    assert.ok(mem.entries[0].endsWith('Lesson one'));
    assert.ok(mem.entries[1].endsWith('Lesson two'));
  });

  test('auto-prefixes date if entry lacks one', () => {
    appendMemory(tmpDir, 'pan-planner', 'Bare lesson');
    const content = readFile(tmpDir, 'pan-planner');
    assert.match(content, /- \d{4}-\d{2}-\d{2}: Bare lesson/);
  });

  test('preserves existing date prefix', () => {
    appendMemory(tmpDir, 'pan-planner', '2025-01-01: Old lesson');
    const content = readFile(tmpDir, 'pan-planner');
    assert.match(content, /- 2025-01-01: Old lesson/);
  });

  test('collapses newlines in entry', () => {
    appendMemory(tmpDir, 'pan-planner', 'line1\nline2\nline3');
    const mem = readMemory(tmpDir, 'pan-planner');
    assert.equal(mem.entries[0].includes('line1 line2 line3'), true);
    assert.equal(mem.entries[0].includes('\n'), false);
  });

  test('returns null for unknown agent', () => {
    assert.equal(readMemory(tmpDir, 'ghost'), null);
  });

  test('rejects invalid agent name', () => {
    const res = appendMemory(tmpDir, '../escape', 'x');
    assert.ok(res.error);
    assert.ok(!res.appended);
  });

  test('rejects empty entry', () => {
    const res = appendMemory(tmpDir, 'pan-planner', '   ');
    assert.ok(res.error);
  });

  test('appends to existing file without overwriting', () => {
    appendMemory(tmpDir, 'pan-planner', 'first');
    appendMemory(tmpDir, 'pan-planner', 'second');
    appendMemory(tmpDir, 'pan-planner', 'third');
    const mem = readMemory(tmpDir, 'pan-planner');
    assert.equal(mem.entries.length, 3);
  });

  test('separate agents have separate files', () => {
    appendMemory(tmpDir, 'pan-planner', 'planner lesson');
    appendMemory(tmpDir, 'pan-verifier', 'verifier lesson');
    const p = readMemory(tmpDir, 'pan-planner');
    const v = readMemory(tmpDir, 'pan-verifier');
    assert.equal(p.entries.length, 1);
    assert.equal(v.entries.length, 1);
    assert.ok(p.entries[0].includes('planner lesson'));
    assert.ok(v.entries[0].includes('verifier lesson'));
  });
});

describe('memory — compactMemory', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('no-op when under threshold', () => {
    for (let i = 0; i < 5; i++) appendMemory(tmpDir, 'pan-planner', `entry ${i}`);
    const res = compactMemory(tmpDir, 'pan-planner', 10);
    assert.equal(res.compacted, true);
    assert.equal(res.kept, 5);
    assert.equal(res.removed, 0);
  });

  test('keeps last N entries when over threshold', () => {
    for (let i = 0; i < 10; i++) appendMemory(tmpDir, 'pan-planner', `entry ${i}`);
    const res = compactMemory(tmpDir, 'pan-planner', 3);
    assert.equal(res.compacted, true);
    assert.equal(res.kept, 3);
    assert.equal(res.removed, 7);

    const mem = readMemory(tmpDir, 'pan-planner');
    assert.equal(mem.entries.length, 3);
    assert.ok(mem.entries[0].includes('entry 7'));
    assert.ok(mem.entries[2].includes('entry 9'));
  });

  test('preserves frontmatter header after compaction', () => {
    for (let i = 0; i < 5; i++) appendMemory(tmpDir, 'pan-planner', `e${i}`);
    compactMemory(tmpDir, 'pan-planner', 2);
    const raw = readFile(tmpDir, 'pan-planner');
    assert.match(raw, /^---\nagent: pan-planner\n/);
    assert.match(raw, /## Entries/);
  });

  test('rejects invalid max', () => {
    appendMemory(tmpDir, 'pan-planner', 'x');
    assert.ok(compactMemory(tmpDir, 'pan-planner', 0).error);
    assert.ok(compactMemory(tmpDir, 'pan-planner', -5).error);
    assert.ok(compactMemory(tmpDir, 'pan-planner', 'abc').error);
  });

  test('returns error for missing file', () => {
    const res = compactMemory(tmpDir, 'ghost', 10);
    assert.ok(res.error);
  });
});

describe('memory — parseEntries', () => {
  test('parses entries from well-formed body', () => {
    const raw = '---\nagent: x\n---\n\n## Entries\n\n- a\n- b\n- c\n';
    assert.deepEqual(parseEntries(raw), ['a', 'b', 'c']);
  });

  test('stops at next heading', () => {
    const raw = '## Entries\n\n- a\n- b\n\n## Notes\n\n- ignored\n';
    assert.deepEqual(parseEntries(raw), ['a', 'b']);
  });

  test('returns empty for file without Entries section', () => {
    assert.deepEqual(parseEntries('hello world'), []);
  });
});

describe('memory — listMemoryAgents', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('empty when no memory dir', () => {
    assert.deepEqual(listMemoryAgents(tmpDir), { agents: [] });
  });

  test('lists agents with entry counts', () => {
    appendMemory(tmpDir, 'pan-planner', 'a');
    appendMemory(tmpDir, 'pan-planner', 'b');
    appendMemory(tmpDir, 'pan-verifier', 'c');
    const { agents } = listMemoryAgents(tmpDir);
    assert.equal(agents.length, 2);
    const planner = agents.find(a => a.agent === 'pan-planner');
    const verifier = agents.find(a => a.agent === 'pan-verifier');
    assert.equal(planner.entries, 2);
    assert.equal(verifier.entries, 1);
  });

  test('ignores non-md files', () => {
    appendMemory(tmpDir, 'pan-planner', 'x');
    fs.writeFileSync(path.join(tmpDir, '.planning', MEMORY_DIR, 'stray.txt'), 'noise');
    const { agents } = listMemoryAgents(tmpDir);
    assert.equal(agents.length, 1);
  });
});

describe('memory — CLI dispatch', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('memory append + read via CLI', () => {
    const a = runPanTools('memory append pan-planner Hello world', tmpDir);
    assert.equal(a.success, true);
    const r = runPanTools('memory read pan-planner', tmpDir);
    assert.equal(r.success, true);
    const json = JSON.parse(r.output);
    assert.equal(json.exists, true);
    assert.equal(json.entries.length, 1);
    assert.ok(json.entries[0].includes('Hello world'));
  });

  test('memory list via CLI', () => {
    runPanTools('memory append pan-planner a', tmpDir);
    runPanTools('memory append pan-verifier b', tmpDir);
    const r = runPanTools('memory list', tmpDir);
    const json = JSON.parse(r.output);
    assert.equal(json.agents.length, 2);
  });

  test('memory read returns exists:false for unknown agent', () => {
    const r = runPanTools('memory read pan-planner', tmpDir);
    const json = JSON.parse(r.output);
    assert.equal(json.exists, false);
    assert.deepEqual(json.entries, []);
  });
});
