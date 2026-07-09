/**
 * Tests for review-deep.cjs — Y-2 deep review data layer (v3.2).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parseReviewFindings,
  mergeReviews,
  writeDeepReview,
  SEVERITIES,
  REVIEWS_DIR,
} = require('../pan-wizard-core/bin/lib/review-deep.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─── parseReviewFindings ────────────────────────────────────────────────────

describe('review-deep — parseReviewFindings', () => {
  test('empty input returns empty array', () => {
    assert.deepEqual(parseReviewFindings('', 'reviewer'), []);
    assert.deepEqual(parseReviewFindings(null, 'reviewer'), []);
  });

  test('parses well-formed finding with severity + file + line', () => {
    const md = `## Findings

- **[HIGH] sql-injection** — Unsanitized input used in query. File: \`src/api.js:42\` — No parameterized query.
`;
    const findings = parseReviewFindings(md, 'hardener');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'high');
    assert.equal(findings[0].category, 'sql-injection');
    assert.equal(findings[0].file, 'src/api.js');
    assert.equal(findings[0].line, 42);
    assert.equal(findings[0].source, 'hardener');
  });

  test('severity is lowercased', () => {
    const md = `## Findings

- **[CRITICAL] auth** — missing check. File: \`src/x.js\`.
`;
    const findings = parseReviewFindings(md, 'r');
    assert.equal(findings[0].severity, 'critical');
  });

  test('missing severity defaults to info', () => {
    const md = `## Findings

- Naming convention: prefer camelCase.
`;
    const findings = parseReviewFindings(md, 'reviewer');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'info');
    assert.equal(findings[0].category, 'general');
  });

  test('stops parsing at next heading', () => {
    const md = `## Findings

- **[HIGH] a** — first finding. File: \`x.js\`.

## Notes

- this is not a finding.
- another non-finding.
`;
    const findings = parseReviewFindings(md, 'reviewer');
    assert.equal(findings.length, 1);
  });

  test('handles multiple findings', () => {
    const md = `## Findings

- **[HIGH] a** — one. File: \`a.js:1\`.
- **[MEDIUM] b** — two. File: \`b.js:2\`.
- **[LOW] c** — three. File: \`c.js:3\`.
`;
    const findings = parseReviewFindings(md, 'r');
    assert.equal(findings.length, 3);
  });

  test('stores source label on every finding', () => {
    const md = `## Findings

- **[HIGH] x** — description. File: \`f.js\`.
`;
    const findings = parseReviewFindings(md, 'hardener');
    for (const f of findings) assert.equal(f.source, 'hardener');
  });

  test('returns empty when no Findings section', () => {
    const md = `## Summary

This phase looks good.`;
    assert.deepEqual(parseReviewFindings(md, 'r'), []);
  });
});

// ─── mergeReviews ───────────────────────────────────────────────────────────

describe('review-deep — mergeReviews', () => {
  test('accepts array inputs directly', () => {
    const r = [{ source: 'reviewer', severity: 'low', category: 'x', description: 'y', file: 'a.js', line: null, rationale: null }];
    const h = [{ source: 'hardener', severity: 'high', category: 'z', description: 'w', file: 'b.js', line: null, rationale: null }];
    const merged = mergeReviews(r, h);
    assert.equal(merged.findings.length, 2);
    assert.equal(merged.coverage.by_source.reviewer, 1);
    assert.equal(merged.coverage.by_source.hardener, 1);
  });

  test('accepts markdown string inputs (parses on the fly)', () => {
    const rMd = `## Findings\n\n- **[LOW] style** — spacing. File: \`a.js:1\`.`;
    const hMd = `## Findings\n\n- **[HIGH] security** — problem. File: \`b.js:5\`.`;
    const merged = mergeReviews(rMd, hMd);
    assert.equal(merged.findings.length, 2);
  });

  test('sorts by severity descending', () => {
    const r = [
      { source: 'r', severity: 'low', category: 'x', description: 'y', file: 'a.js', line: null, rationale: null },
      { source: 'r', severity: 'critical', category: 'x', description: 'y', file: 'b.js', line: null, rationale: null },
      { source: 'r', severity: 'medium', category: 'x', description: 'y', file: 'c.js', line: null, rationale: null },
    ];
    const merged = mergeReviews(r, []);
    assert.equal(merged.findings[0].severity, 'critical');
    assert.equal(merged.findings[1].severity, 'medium');
    assert.equal(merged.findings[2].severity, 'low');
  });

  test('verdict = block when critical finding present', () => {
    const r = [{ source: 'r', severity: 'critical', category: 'x', description: 'y', file: null, line: null, rationale: null }];
    assert.equal(mergeReviews(r, []).verdict, 'block');
  });

  test('verdict = review_required when only high', () => {
    const r = [{ source: 'r', severity: 'high', category: 'x', description: 'y', file: null, line: null, rationale: null }];
    assert.equal(mergeReviews(r, []).verdict, 'review_required');
  });

  test('verdict = ok_with_minor when only low', () => {
    const r = [{ source: 'r', severity: 'low', category: 'x', description: 'y', file: null, line: null, rationale: null }];
    assert.equal(mergeReviews(r, []).verdict, 'ok_with_minor');
  });

  test('verdict = ok when no findings', () => {
    assert.equal(mergeReviews([], []).verdict, 'ok');
  });

  test('detects meta_dispute conflict via dispute keyword', () => {
    const meta = [{ source: 'meta-reviewer', severity: 'info', category: 'x', description: 'I dispute the reviewer flag on this', file: null, line: null, rationale: null }];
    const merged = mergeReviews([], [], meta);
    assert.equal(merged.conflicts.length, 1);
    assert.equal(merged.conflicts[0].type, 'meta_dispute');
  });

  test('detects meta_addition conflict on new file', () => {
    const r = [{ source: 'r', severity: 'low', category: 'x', description: 'a', file: 'a.js', line: null, rationale: null }];
    const meta = [{ source: 'meta-reviewer', severity: 'high', category: 'y', description: 'missed issue', file: 'b.js', line: null, rationale: null }];
    const merged = mergeReviews(r, [], meta);
    const additions = merged.conflicts.filter(c => c.type === 'meta_addition');
    assert.equal(additions.length, 1);
  });

  test('does not flag meta finding on same file+line as addition', () => {
    const r = [{ source: 'r', severity: 'low', category: 'x', description: 'a', file: 'a.js', line: 10, rationale: null }];
    const meta = [{ source: 'meta-reviewer', severity: 'low', category: 'y', description: 'same place', file: 'a.js', line: 10, rationale: null }];
    const merged = mergeReviews(r, [], meta);
    const additions = merged.conflicts.filter(c => c.type === 'meta_addition');
    assert.equal(additions.length, 0);
  });

  test('coverage counts all severities', () => {
    const all = SEVERITIES.map(s => ({ source: 'r', severity: s, category: 'x', description: 'y', file: null, line: null, rationale: null }));
    const merged = mergeReviews(all, []);
    for (const s of SEVERITIES) {
      assert.equal(merged.coverage.by_severity[s], 1);
    }
  });
});

// ─── writeDeepReview ────────────────────────────────────────────────────────

describe('review-deep — writeDeepReview', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error when phaseNum missing', () => {
    const r = writeDeepReview(tmpDir, null, { findings: [], conflicts: [], coverage: { total: 0, by_source: { reviewer: 0, hardener: 0, meta_reviewer: 0 }, by_severity: {} }, verdict: 'ok' });
    assert.ok(r.error);
  });

  test('writes deep-review.md with frontmatter + sections', () => {
    const payload = mergeReviews(
      [{ source: 'reviewer', severity: 'high', category: 'x', description: 'danger', file: 'a.js', line: 5, rationale: null }],
      []
    );
    const r = writeDeepReview(tmpDir, '07', payload, { audit_channel: false });
    assert.equal(r.written, true);
    const content = fs.readFileSync(path.join(tmpDir, '.planning', REVIEWS_DIR, '07', 'deep-review.md'), 'utf-8');
    assert.ok(content.includes('type: deep-review'));
    assert.ok(content.includes('phase: 07'));
    assert.ok(content.includes('verdict: review_required'));
    assert.ok(content.includes('## Findings'));
    assert.ok(content.includes('a.js'));
  });

  test('writes "No findings" placeholder when findings empty', () => {
    const r = writeDeepReview(tmpDir, '01', mergeReviews([], []), { audit_channel: false });
    const content = fs.readFileSync(path.join(tmpDir, '.planning', REVIEWS_DIR, '01', 'deep-review.md'), 'utf-8');
    assert.ok(content.includes('No findings'));
    assert.ok(content.includes('verdict: ok'));
  });

  test('includes conflicts section when meta adds findings', () => {
    const payload = mergeReviews(
      [],
      [],
      [{ source: 'meta-reviewer', severity: 'high', category: 'x', description: 'missed issue', file: 'c.js', line: null, rationale: null }]
    );
    writeDeepReview(tmpDir, '02', payload, { audit_channel: false });
    const content = fs.readFileSync(path.join(tmpDir, '.planning', REVIEWS_DIR, '02', 'deep-review.md'), 'utf-8');
    assert.ok(content.includes('Conflicts & additions'));
    assert.ok(content.includes('meta_addition'));
  });

  test('publishes audit entry to bus channel by default', () => {
    const payload = mergeReviews(
      [{ source: 'reviewer', severity: 'low', category: 'x', description: 'y', file: 'a.js', line: null, rationale: null }],
      []
    );
    writeDeepReview(tmpDir, '03', payload);
    const busFile = path.join(tmpDir, '.planning', 'bus', 'review-handoff.jsonl');
    assert.ok(fs.existsSync(busFile));
    const entry = JSON.parse(fs.readFileSync(busFile, 'utf-8').trim());
    assert.equal(entry.source, 'pan-meta-reviewer');
    assert.equal(entry.payload.phase, '03');
    assert.equal(entry.payload.finding_count, 1);
  });

  test('audit_channel: false skips bus publish', () => {
    writeDeepReview(tmpDir, '04', mergeReviews([], []), { audit_channel: false });
    const busFile = path.join(tmpDir, '.planning', 'bus', 'review-handoff.jsonl');
    assert.equal(fs.existsSync(busFile), false);
  });
});

// ─── CLI dispatch ───────────────────────────────────────────────────────────

describe('review-deep — CLI dispatch', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  function writeInputs(dir, reviewerMd, hardenerMd) {
    fs.writeFileSync(path.join(dir, 'reviewer.md'), reviewerMd);
    fs.writeFileSync(path.join(dir, 'hardener.md'), hardenerMd);
  }

  test('review-deep merge writes deep-review.md and returns verdict', () => {
    writeInputs(
      tmpDir,
      `## Findings\n\n- **[LOW] style** — fix. File: \`a.js:1\`.\n`,
      `## Findings\n\n- **[HIGH] sec** — vulnerable. File: \`b.js:5\`.\n`
    );
    const r = runPanTools(
      `review-deep merge 05 --reviewer-file ${path.join(tmpDir, 'reviewer.md')} --hardener-file ${path.join(tmpDir, 'hardener.md')}`,
      tmpDir
    );
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.written, true);
    assert.equal(json.verdict, 'review_required');
    assert.equal(json.coverage.total, 2);
  });

  test('review-deep analyze returns payload without writing file', () => {
    writeInputs(
      tmpDir,
      `## Findings\n\n- **[LOW] x** — fix. File: \`a.js\`.`,
      ''
    );
    const r = runPanTools(
      `review-deep analyze 06 --reviewer-file ${path.join(tmpDir, 'reviewer.md')} --hardener-file ${path.join(tmpDir, 'hardener.md')}`,
      tmpDir
    );
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.verdict, 'ok_with_minor');
    // Should NOT have created the file.
    assert.equal(fs.existsSync(path.join(tmpDir, '.planning', REVIEWS_DIR, '06', 'deep-review.md')), false);
  });

  test('unknown subcommand errors', () => {
    const r = runPanTools('review-deep explode', tmpDir);
    assert.equal(r.success, false);
  });
});
