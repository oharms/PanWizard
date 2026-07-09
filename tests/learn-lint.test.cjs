/**
 * Tests for learn-lint module.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { lintPatterns, extractPatternBody, collectAllPatterns, KNOWN_EXPERIMENT_TOKENS } = require('../pan-wizard-core/bin/lib/learn-lint.cjs');

function makeTmp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-learn-lint-'));
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

test('L-001: detects duplicate pattern IDs across files', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-1201', summary: 'one' }],
      '\n## P-1201 — one\n\n**Rule:** A.\n');
    writeTopic(tmp, 'universal', 'b', [{ id: 'P-1201', summary: 'two' }],
      '\n## P-1201 — two\n\n**Rule:** B.\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    const dup = result.violations.find(v => v.code === 'L-001');
    assert.ok(dup, 'expected L-001 violation');
    assert.equal(dup.pattern_id, 'P-1201');
    assert.equal(dup.locations.length, 2);
    assert.equal(dup.severity, 'error');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('L-002: detects dangling pattern references', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-100', summary: 'x' }],
      '\n## P-100 — x\n\n**Rule:** See P-9999 for the canonical case.\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    const dangle = result.violations.find(v => v.code === 'L-002');
    assert.ok(dangle);
    assert.equal(dangle.dangling_ref, 'P-9999');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('L-002: pattern reference to itself is NOT a violation', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-100', summary: 'x' }],
      '\n## P-100 — x\n\n**Rule:** Per P-100, do this.\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    assert.equal(result.violations.filter(v => v.code === 'L-002').length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('L-003: empty source_experiments while body cites known experiment', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-100', summary: 'x', source_experiments: [] }],
      '\n## P-100 — x\n\n**Evidence:** notepadrs Plan 03-05 ran fine.\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    const v = result.violations.find(x => x.code === 'L-003');
    assert.ok(v);
    assert.deepEqual(v.cited_experiments, ['notepadrs']);
    assert.equal(v.severity, 'warning');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('L-003: non-empty source_experiments suppresses warning', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-100', summary: 'x', source_experiments: ['notepadrs'] }],
      '\n## P-100 — x\n\n**Evidence:** notepadrs Plan 03-05 ran fine.\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    assert.equal(result.violations.filter(v => v.code === 'L-003').length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('L-004: universal pattern with PAN-internal terms in body', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-100', summary: 'x' }],
      '\n## P-100 — x\n\n**Rule:** PAN\'s pan-tools dispatcher should ...\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    const v = result.violations.find(x => x.code === 'L-004');
    assert.ok(v, 'expected L-004 violation');
    assert.ok(v.terms.length > 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('L-004: PAN mention only in evidence prose does NOT trigger', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-100', summary: 'x' }],
      '\n## P-100 — generic universal pattern\n\n**Evidence:** PAN whoocache experiment hit this.\n\n**Rule:** When persisting state across processes, write atomically.\n\n**Applies in:** any state writer\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    assert.equal(result.violations.filter(v => v.code === 'L-004').length, 0,
      'PAN mention in Evidence section only should not trigger L-004');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('L-004: PAN mention in Rule section triggers', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-100', summary: 'x' }],
      '\n## P-100 — Track wall-clock-per-commit metric\n\n**Evidence:** found in many places.\n\n**Rule:** PAN\'s autonomous loops should track these metrics.\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    const v = result.violations.find(x => x.code === 'L-004');
    assert.ok(v, 'PAN mention in Rule section should trigger L-004');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('L-004: PAN mention in pattern heading triggers', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-100', summary: 'x' }],
      '\n## P-100 — Exercising PAN\'s actual surfaces produces signal\n\n**Rule:** Generic-sounding rule.\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    const v = result.violations.find(x => x.code === 'L-004');
    assert.ok(v, 'PAN mention in heading should trigger L-004');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('L-004: internal scope is exempt from PAN-internal-term check', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'internal', 'a', [{ id: 'P-100', summary: 'x' }],
      '\n## P-100 — x\n\n**Rule:** PAN\'s pan-tools dispatcher should ...\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    assert.equal(result.violations.filter(v => v.code === 'L-004').length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractPatternBody: extracts the right section between headings', () => {
  const body = '\n# Topic (AI-derived)\n\n## P-100 — first\n\n**Rule:** Foo.\n\n**Applies in:** bar\n\n## P-200 — second\n\n**Rule:** Baz.\n';
  const a = extractPatternBody(body, 'P-100');
  assert.match(a, /\*\*Rule:\*\* Foo/);
  assert.doesNotMatch(a, /Baz/);
  const b = extractPatternBody(body, 'P-200');
  assert.match(b, /Baz/);
});

test('lintPatterns reports counts and pass/fail correctly', () => {
  const tmp = makeTmp();
  try {
    writeTopic(tmp, 'universal', 'a', [{ id: 'P-100', summary: 'x' }],
      '\n## P-100 — x\n\n**Rule:** Foo.\n');
    const all = collectAllPatterns(tmp);
    const result = lintPatterns(all);
    assert.equal(result.pattern_count, 1);
    assert.equal(result.file_count, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('KNOWN_EXPERIMENT_TOKENS includes notepadrs and whoo* family', () => {
  assert.ok(KNOWN_EXPERIMENT_TOKENS.includes('notepadrs'));
  assert.ok(KNOWN_EXPERIMENT_TOKENS.includes('whoolog'));
  assert.ok(KNOWN_EXPERIMENT_TOKENS.includes('whoocache'));
});
