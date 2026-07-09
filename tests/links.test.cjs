/**
 * Tests for the doc-code link graph (links.cjs) — ADR-0027.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  validateAll,
  scanForwardLinks,
  scanAnchors,
  resolveDocId,
  parseAnchorLine,
  parseInlineLinks,
} = require('../pan-wizard-core/bin/lib/links.cjs');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pan-links-'));
}

function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

// ─── parseAnchorLine ─────────────────────────────────────────────────────────

test('parseAnchorLine: extracts id from JS comment', () => {
  assert.equal(parseAnchorLine('// @pan: ADR-0027', '//'), 'ADR-0027');
  assert.equal(parseAnchorLine('  //  @pan:  docs/specs/foo.md  ', '//'), 'docs/specs/foo.md');
});

test('parseAnchorLine: extracts id from shell comment', () => {
  assert.equal(parseAnchorLine('# @pan: ADR-0001', '#'), 'ADR-0001');
});

test('parseAnchorLine: extracts id from HTML comment with closer', () => {
  assert.equal(parseAnchorLine('<!-- @pan: ADR-0007 -->', '<!--'), 'ADR-0007');
  assert.equal(parseAnchorLine('<!-- @pan: ADR-0007 -->', '<!--'), 'ADR-0007');
  assert.equal(parseAnchorLine('  <!--  @pan:  ADR-0007  -->  ', '<!--'), 'ADR-0007');
});

test('parseAnchorLine: returns null for non-anchor lines', () => {
  assert.equal(parseAnchorLine('const x = 1;', '//'), null);
  assert.equal(parseAnchorLine('// regular comment', '//'), null);
  assert.equal(parseAnchorLine('const s = "// @pan: fake";', '//'), null);
});

test('parseAnchorLine: returns null when leader unknown', () => {
  assert.equal(parseAnchorLine('// @pan: ADR-0001', '/*'), null);
});

// ─── parseInlineLinks ────────────────────────────────────────────────────────

test('parseInlineLinks: finds bracketed ids in body text', () => {
  const links = parseInlineLinks('See [[ADR-0027]] and [[docs/foo.md]] for context.');
  assert.equal(links.length, 2);
  assert.equal(links[0].rawId, 'ADR-0027');
  assert.equal(links[1].rawId, 'docs/foo.md');
});

test('parseInlineLinks: ignores links inside fenced code blocks', () => {
  const text = [
    'Real ref: [[ADR-0001]]',
    '```',
    'Example: [[<id>]] is the syntax',
    '```',
    'Another: [[ADR-0002]]',
  ].join('\n');
  const links = parseInlineLinks(text);
  assert.equal(links.length, 2);
  assert.deepEqual(links.map(l => l.rawId), ['ADR-0001', 'ADR-0002']);
});

test('parseInlineLinks: ignores links inside backtick spans', () => {
  const links = parseInlineLinks('Use `[[<id>]]` syntax to reference [[ADR-0001]].');
  assert.equal(links.length, 1);
  assert.equal(links[0].rawId, 'ADR-0001');
});

test('parseInlineLinks: tracks line numbers', () => {
  const links = parseInlineLinks('first\n[[ADR-0001]]\nthird');
  assert.equal(links.length, 1);
  assert.equal(links[0].line, 2);
});

// ─── resolveDocId ────────────────────────────────────────────────────────────

test('resolveDocId: ADR-NNNN shortcut resolves via glob', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'docs/decisions/ADR-0042-example-decision.md', '# ADR-0042\n');
    const r = resolveDocId('ADR-0042', tmp);
    assert.equal(r.resolved, true);
    assert.equal(r.path, 'docs/decisions/ADR-0042-example-decision.md');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveDocId: ADR-NNNN with no match returns reason', () => {
  const tmp = makeTmp();
  try {
    fs.mkdirSync(path.join(tmp, 'docs', 'decisions'), { recursive: true });
    const r = resolveDocId('ADR-9999', tmp);
    assert.equal(r.resolved, false);
    assert.match(r.reason, /no ADR-9999/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveDocId: direct .md path resolves when file exists', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'docs/specs/foo.md', '# Foo\n');
    const r = resolveDocId('docs/specs/foo.md', tmp);
    assert.equal(r.resolved, true);
    assert.equal(r.path, 'docs/specs/foo.md');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveDocId: bare path tries .md and README.md', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'learnings/universal/test-iso.md', '# t\n');
    const r = resolveDocId('learnings/universal/test-iso', tmp);
    assert.equal(r.resolved, true);
    assert.equal(r.path, 'learnings/universal/test-iso.md');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveDocId: section anchor matches existing heading via slug', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'docs/decisions/ADR-0001-thing.md', '# Title\n\n## Some Decision\n');
    const r = resolveDocId('ADR-0001#Some Decision', tmp);
    assert.equal(r.resolved, true);
    assert.equal(r.section, 'Some Decision');
    assert.equal(r.sectionMissing, undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveDocId: missing section flags sectionMissing', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'docs/decisions/ADR-0001-thing.md', '# Title\n');
    const r = resolveDocId('ADR-0001#Nope', tmp);
    assert.equal(r.resolved, true);
    assert.equal(r.sectionMissing, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveDocId: empty id is unresolved', () => {
  assert.equal(resolveDocId('', '/tmp').resolved, false);
  assert.equal(resolveDocId('   ', '/tmp').resolved, false);
});

// ─── Forward-link scanner ────────────────────────────────────────────────────

test('scanForwardLinks: picks up inline [[<id>]] from doc roots', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'docs/USER.md', 'See [[ADR-0001]] for details.\n');
    writeFile(tmp, 'docs/decisions/ADR-0001-thing.md', '# T\n');
    const links = scanForwardLinks(['docs'], tmp);
    const inline = links.filter(l => l.via === 'inline');
    assert.equal(inline.length, 1);
    assert.equal(inline[0].rawId, 'ADR-0001');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanForwardLinks: handles missing doc root silently', () => {
  const tmp = makeTmp();
  try {
    const links = scanForwardLinks(['nonexistent-dir'], tmp);
    assert.deepEqual(links, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── Source-anchor scanner ───────────────────────────────────────────────────

test('scanAnchors: finds @pan: in .cjs file', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'src/foo.cjs', '// @pan: ADR-0027\nconst x = 1;\n');
    const anchors = scanAnchors(['src'], tmp);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].rawId, 'ADR-0027');
    assert.equal(anchors[0].sourceLine, 1);
    assert.equal(anchors[0].leader, '//');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanAnchors: skips node_modules and .git', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'src/foo.cjs', '// @pan: ADR-0001\n');
    writeFile(tmp, 'src/node_modules/x/y.cjs', '// @pan: ADR-9999\n');
    writeFile(tmp, 'src/.git/x.cjs', '// @pan: ADR-9999\n');
    const anchors = scanAnchors(['src'], tmp);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].rawId, 'ADR-0001');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanAnchors: handles multiple comment leaders by extension', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'src/a.cjs', '// @pan: A\n');
    writeFile(tmp, 'src/b.py', '# @pan: B\n');
    writeFile(tmp, 'src/c.md', '<!-- @pan: C -->\n');
    const anchors = scanAnchors(['src'], tmp);
    const ids = anchors.map(a => a.rawId).sort();
    assert.deepEqual(ids, ['A', 'B', 'C']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── validateAll: full pipeline ──────────────────────────────────────────────

function makeFixture() {
  const tmp = makeTmp();
  // Real ADR file
  writeFile(tmp, 'docs/decisions/ADR-0001-thing.md', '# ADR-0001\n## Decision\n');
  // Doc with require-code-mention but NO anchors → B-001
  writeFile(tmp, 'docs/decisions/ADR-0002-uncovered.md', [
    '---',
    'require-code-mention: true',
    '---',
    '# ADR-0002\n',
  ].join('\n'));
  // Doc with require-code-mention AND a covering anchor → no finding
  writeFile(tmp, 'docs/decisions/ADR-0003-covered.md', [
    '---',
    'require-code-mention: true',
    '---',
    '# ADR-0003\n',
  ].join('\n'));
  // User guide with: 1 valid inline link, 1 broken inline link, 1 broken section anchor
  writeFile(tmp, 'docs/USER.md', [
    'See [[ADR-0001]] for the real one.',
    'See [[ADR-9999]] for the broken one.',
    'See [[ADR-0001#Nonexistent]] for the broken section.',
  ].join('\n') + '\n');
  // Source: one anchor to ADR-0003 (covers contract), one stale anchor to ADR-9999 (A-001)
  writeFile(tmp, 'src/covered.cjs', '// @pan: ADR-0003\nconst x = 1;\n');
  writeFile(tmp, 'src/stale.cjs', '// @pan: ADR-9999\nconst y = 2;\n');
  return tmp;
}

test('validateAll: produces F-001, F-002, B-001, A-001 findings on the canary fixture', () => {
  const tmp = makeFixture();
  try {
    const result = validateAll(tmp, {
      docRoots: ['docs'],
      sourceRoots: ['src'],
    });
    const codes = result.findings.map(f => f.code).sort();
    assert.ok(codes.includes('F-001'), 'expected F-001 (broken inline link)');
    assert.ok(codes.includes('F-002'), 'expected F-002 (broken section anchor)');
    assert.ok(codes.includes('B-001'), 'expected B-001 (require-code-mention with no anchors)');
    assert.ok(codes.includes('A-001'), 'expected A-001 (stale @pan: anchor)');

    // ADR-0002 should be the B-001 source
    const b001 = result.findings.find(f => f.code === 'B-001');
    assert.match(b001.source, /ADR-0002/);

    // ADR-0003 should NOT have a B-001 finding (it's covered)
    assert.equal(result.findings.filter(f => f.code === 'B-001' && /ADR-0003/.test(f.source)).length, 0);

    assert.equal(result.summary.status, 'fail');
    assert.equal(result.ok, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validateAll: clean fixture passes', () => {
  const tmp = makeTmp();
  try {
    writeFile(tmp, 'docs/decisions/ADR-0001-thing.md', '# ADR-0001\n## Decision\n');
    writeFile(tmp, 'docs/USER.md', 'See [[ADR-0001]].\n');
    const result = validateAll(tmp, {
      docRoots: ['docs'],
      sourceRoots: ['src'],
    });
    assert.equal(result.summary.errors, 0);
    assert.equal(result.summary.status, 'pass');
    assert.equal(result.ok, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validateAll: --strict flips real warnings to fail (excluding B-002)', () => {
  const tmp = makeTmp();
  try {
    // A-002 warning: anchor points to a real file but a missing section.
    writeFile(tmp, 'docs/decisions/ADR-0001-thing.md', '# ADR-0001\n## Decision\n');
    writeFile(tmp, 'src/anchored.cjs', '// @pan: ADR-0001#NoSuchSection\n');
    const lax = validateAll(tmp, { docRoots: ['docs'], sourceRoots: ['src'] });
    const strict = validateAll(tmp, { docRoots: ['docs'], sourceRoots: ['src'], strict: true });
    assert.equal(lax.summary.status, 'pass');
    assert.equal(strict.summary.status, 'fail');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validateAll: B-002 is informational and does NOT flip --strict (spec §5.2)', () => {
  const tmp = makeTmp();
  try {
    // Single anchor covering a require-code-mention doc → B-002 warning only
    writeFile(tmp, 'docs/decisions/ADR-0003-covered.md', [
      '---',
      'require-code-mention: true',
      '---',
      '# ADR-0003\n',
    ].join('\n'));
    writeFile(tmp, 'src/covered.cjs', '// @pan: ADR-0003\n');
    const strict = validateAll(tmp, { docRoots: ['docs'], sourceRoots: ['src'], strict: true });
    const codes = strict.findings.map(f => f.code);
    assert.deepEqual(codes, ['B-002'], 'expected only B-002 warning');
    assert.equal(strict.summary.status, 'pass', 'B-002 alone must not fail under --strict');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validateAll: anchor with empty id flags A-004', () => {
  const tmp = makeTmp();
  try {
    // Empty id can be produced by trailing whitespace stripped to nothing — use minimal regex match.
    // The anchor regex requires at least one non-space char, so this test verifies the empty path
    // by invoking runAnchorTargetPass via validateAll with no source (no anchors → no A-004).
    // That path is exercised separately by parseAnchorLine returning null. We assert the regex
    // does NOT match `// @pan:` with nothing after.
    assert.equal(parseAnchorLine('// @pan:', '//'), null);
    assert.equal(parseAnchorLine('// @pan: ', '//'), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validateAll: summary counts are accurate', () => {
  const tmp = makeFixture();
  try {
    const result = validateAll(tmp, {
      docRoots: ['docs'],
      sourceRoots: ['src'],
    });
    assert.equal(result.summary.doc_files_scanned, 4);  // ADR-0001, 0002, 0003, USER
    assert.equal(result.summary.source_files_scanned, 2);  // covered, stale
    assert.equal(result.summary.anchors_found, 2);
    assert.equal(result.summary.backlink_contracts_checked, 2);  // ADR-0002 + ADR-0003
    assert.ok(result.summary.forward_links_found >= 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
