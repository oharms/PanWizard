/**
 * Tests for learn-index module.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  buildIndex, writeIndex, readIndex, topicsForAgent,
  cmdBuildIndex, cmdTopicsFor,
} = require('../pan-wizard-core/bin/lib/learn-index.cjs');

function makeTmp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-learn-index-'));
  fs.mkdirSync(path.join(tmp, 'pan-wizard-core', 'learnings', 'universal'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'pan-wizard-core', 'learnings', 'internal'), { recursive: true });
  return tmp;
}

function writeTopic(root, scope, topic, frontPatterns, body) {
  const filePath = path.join(root, 'pan-wizard-core', 'learnings', scope, `${topic}.md`);
  let fm = `topic: ${topic}\nlast_updated: 2026-01-01T00:00:00.000Z\npatterns:\n`;
  for (const p of frontPatterns) {
    fm += `  - id: ${p.id}\n`;
    fm += `    summary: ${p.summary || 'x'}\n`;
    fm += `    promoted_at: 2026-01-01T00:00:00.000Z\n`;
    fm += `    source_experiments: [${(p.source_experiments || []).join(', ')}]\n`;
  }
  fs.writeFileSync(filePath, `---\n${fm}---\n${body}`);
}

test('buildIndex collects all topics from both scopes', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'atomic-state', [{ id: 'P-100' }], '\n## P-100 — x\n\n**Rule:** A.\n');
    writeTopic(tmp, 'universal', 'concurrency', [{ id: 'P-200' }], '\n## P-200 — y\n\n**Rule:** B.\n');
    writeTopic(tmp, 'internal', 'pan-dev-bugs', [{ id: 'P-300' }], '\n## P-300 — z\n\n**Rule:** C.\n');
    const idx = buildIndex(tmp);
    assert.equal(idx.topics.length, 3);
    assert.equal(idx.totals.patterns, 3);
    assert.ok(idx.schema_version >= 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildIndex computes size_bytes and size_tokens_est', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'atomic-state', [{ id: 'P-100' }],
      '\n## P-100 — x\n\n**Rule:** A.\n');
    const idx = buildIndex(tmp);
    const t = idx.topics[0];
    assert.ok(t.size_bytes > 0);
    assert.ok(t.size_tokens_est > 0);
    assert.equal(t.size_tokens_est, Math.ceil(t.size_bytes / 4));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildIndex assigns curated relevance for known topics', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'design-process', [{ id: 'P-100' }],
      '\n## P-100 — x\n\n**Rule:** A.\n');
    writeTopic(tmp, 'universal', 'idempotency', [{ id: 'P-200' }],
      '\n## P-200 — y\n\n**Rule:** B.\n');
    const idx = buildIndex(tmp);
    const dp = idx.topics.find(t => t.name === 'design-process');
    assert.equal(dp.agent_relevance.planner, 'high');
    const idem = idx.topics.find(t => t.name === 'idempotency');
    assert.equal(idem.agent_relevance.executor, 'high');
    assert.equal(idem.agent_relevance.verifier, 'high');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('topicsForAgent filters by min relevance and budget', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'design-process', [{ id: 'P-100' }],
      '\n## P-100 — x\n\n**Rule:** ' + 'A'.repeat(2000) + '\n');
    writeTopic(tmp, 'universal', 'unicode', [{ id: 'P-200' }],
      '\n## P-200 — y\n\n**Rule:** B.\n');
    const idx = buildIndex(tmp);
    const result = topicsForAgent(idx, { agent: 'planner', tokenBudget: 100 });
    assert.equal(result.selected.length, 0);
    assert.ok(result.dropped.length > 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('topicsForAgent prefers higher relevance first', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'design-process', [{ id: 'P-100' }],
      '\n## P-100 — x\n\n**Rule:** A.\n');
    writeTopic(tmp, 'universal', 'unicode', [{ id: 'P-200' }],
      '\n## P-200 — y\n\n**Rule:** B.\n');
    const idx = buildIndex(tmp);
    const result = topicsForAgent(idx, { agent: 'planner', tokenBudget: 5000 });
    const designProcess = result.selected.find(t => t.name === 'design-process');
    assert.ok(designProcess, 'planner should select design-process (high relevance)');
    assert.equal(designProcess.relevance, 'high');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('writeIndex round-trips through readIndex', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'atomic-state', [{ id: 'P-100' }], '\n## P-100 — x\n\n**Rule:** A.\n');
    const idx = buildIndex(tmp);
    writeIndex(tmp, idx);
    const reloaded = readIndex(tmp);
    assert.equal(reloaded.totals.topics, 1);
    assert.equal(reloaded.topics[0].name, 'atomic-state');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readIndex falls back to buildIndex when index.json missing', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'atomic-state', [{ id: 'P-100' }], '\n## P-100 — x\n\n**Rule:** A.\n');
    const idx = readIndex(tmp);
    assert.equal(idx.totals.topics, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cmdBuildIndex returns summary fields', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'atomic-state', [{ id: 'P-100' }], '\n## P-100 — x\n\n**Rule:** A.\n');
    const result = cmdBuildIndex(tmp);
    assert.equal(result.topics, 1);
    assert.equal(result.patterns, 1);
    assert.ok(result.written_to.endsWith('index.json'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('topicsForAgent handles unknown topic with default relevance', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'novel-topic', [{ id: 'P-100' }], '\n## P-100 — x\n\n**Rule:** A.\n');
    const idx = buildIndex(tmp);
    const t = idx.topics.find(t => t.name === 'novel-topic');
    assert.equal(t.agent_relevance.executor, 'medium');
    assert.equal(t.agent_relevance.planner, 'low');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
