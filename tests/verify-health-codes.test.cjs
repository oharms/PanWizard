/**
 * PAN Tools Tests — validate health issue codes
 *
 * These tests exist because the code table in docs/CLI-REFERENCE.md and the codes
 * verify.cjs actually emits drifted apart unnoticed: W002 was documented as
 * non-repairable while shipping repairable=true, and STATE_REQ_DRIFT was emitted
 * but absent from a table that reads as exhaustive. Nothing pinned either side.
 *
 * The contract tests below are driven FROM the doc table, so the doc and the code
 * cannot disagree again without a red test.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const CLI_REFERENCE = path.join(REPO_ROOT, 'docs', 'CLI-REFERENCE.md');
const HEALTH_WORKFLOW = path.join(REPO_ROOT, 'pan-wizard-core', 'workflows', 'health.md');
const VERIFY_SRC = path.join(REPO_ROOT, 'pan-wizard-core', 'bin', 'lib', 'verify.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Parse the documented code tables out of docs/CLI-REFERENCE.md
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect every code row from the `validate health` code tables.
 * Both tables (unconditional codes, and flag-gated codes) use the code as the
 * first cell and `Yes`/`No` as the last; the flag-gated table has an extra
 * column in between, which is why the repairable value is read from the end.
 * @returns {Map<string, {repairable: boolean}>}
 */
function parseDocumentedCodes() {
  const doc = fs.readFileSync(CLI_REFERENCE, 'utf-8');
  // Scope to the validate health section so tables elsewhere in the reference
  // cannot silently satisfy these assertions.
  const start = doc.indexOf('**Error/warning codes:**');
  assert.ok(start !== -1, 'CLI-REFERENCE.md must contain the validate health code table');
  const end = doc.indexOf('### `validate deployment`', start);
  assert.ok(end !== -1, 'validate health code table must be followed by validate deployment');
  return parseCodeTables(doc.slice(start, end));
}

/**
 * Same contract, for the agent-facing table in workflows/health.md. This one is
 * loaded at runtime by the health workflow, so an agent branching on codes reads
 * it directly — it drifting is worse than the reference drifting, not better.
 * @returns {Map<string, {repairable: boolean}>}
 */
function parseWorkflowCodes() {
  const doc = fs.readFileSync(HEALTH_WORKFLOW, 'utf-8');
  const start = doc.indexOf('<error_codes>');
  assert.ok(start !== -1, 'workflows/health.md must contain an <error_codes> block');
  const end = doc.indexOf('</error_codes>', start);
  assert.ok(end !== -1, '<error_codes> block must be closed');
  return parseCodeTables(doc.slice(start, end));
}

/**
 * Read every markdown table row in `section` as a code row: code first cell,
 * Yes/No last. Tables with an extra Flag column are handled by reading the
 * repairable value from the end rather than a fixed index.
 * @param {string} section
 * @returns {Map<string, {repairable: boolean}>}
 */
function parseCodeTables(section) {
  const codes = new Map();
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 4) continue;
    const code = cells[0].replace(/`/g, '');
    if (code === 'Code' || /^-+$/.test(code)) continue;
    const repairable = cells[cells.length - 1];
    assert.ok(
      repairable === 'Yes' || repairable === 'No',
      `Repairable column for ${code} must be Yes or No, got "${repairable}"`
    );
    codes.set(code, { repairable: repairable === 'Yes' });
  }
  return codes;
}

/**
 * Collect every issue code cmdValidateHealth can emit, read from the source.
 * Covers both string literals and the concatenated `'STD-' + id` family.
 * @returns {Set<string>}
 */
function parseEmittedCodes() {
  const src = fs.readFileSync(VERIFY_SRC, 'utf-8');
  const codes = new Set();
  for (const m of src.matchAll(/addIssue\(\s*'(?:error|warning|info)',\s*'([A-Z][A-Z_0-9-]*)'(\s*\+)?/g)) {
    // A trailing `+` means the literal is only the prefix of a computed code
    // (e.g. 'STD-' + id). Record the documented wildcard form instead.
    if (m[2]) codes.add(`${m[1]}*id*`);
    else codes.add(m[1]);
  }
  return codes;
}

describe('validate health code table is a contract', () => {
  test('every code verify.cjs can emit is documented', () => {
    const documented = parseDocumentedCodes();
    const emitted = parseEmittedCodes();

    const undocumented = [...emitted].filter(c => !documented.has(c));
    assert.deepStrictEqual(
      undocumented,
      [],
      `verify.cjs emits codes missing from the docs/CLI-REFERENCE.md table: ${undocumented.join(', ')}. ` +
      'Add a row (code, severity, description, repairable) rather than deleting this assertion.'
    );
  });

  test('the table lists no code the implementation cannot emit', () => {
    const documented = parseDocumentedCodes();
    const emitted = parseEmittedCodes();

    const phantom = [...documented.keys()].filter(c => !emitted.has(c));
    assert.deepStrictEqual(
      phantom,
      [],
      `docs/CLI-REFERENCE.md documents codes verify.cjs never emits: ${phantom.join(', ')}`
    );
  });

  test('the agent-facing table in workflows/health.md lists the same codes', () => {
    const reference = parseDocumentedCodes();
    const workflow = parseWorkflowCodes();

    assert.deepStrictEqual(
      [...workflow.keys()].sort(),
      [...reference.keys()].sort(),
      'workflows/health.md and docs/CLI-REFERENCE.md must document the same code set'
    );
    for (const [code, { repairable }] of reference) {
      assert.strictEqual(
        workflow.get(code).repairable,
        repairable,
        `${code} repairable flag disagrees between workflows/health.md and docs/CLI-REFERENCE.md`
      );
    }
  });

  test('sanity: the parsers find the codes they are meant to find', () => {
    // Guards against a silently-empty parse making the two tests above vacuous.
    const documented = parseDocumentedCodes();
    const emitted = parseEmittedCodes();
    for (const known of ['E001', 'W002', 'W006', 'I001', 'STATE_REQ_DRIFT']) {
      assert.ok(documented.has(known), `doc parser should find ${known}`);
      assert.ok(emitted.has(known), `source parser should find ${known}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W002 — one warning per missing phase, and a repairable flag matching the docs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed a project whose state.md references a phase that has no directory,
 * `mentions` times over.
 */
function seedMissingPhaseRefs(tmpDir, mentions, refText = 'Phase 3') {
  const planningDir = path.join(tmpDir, '.planning');
  fs.writeFileSync(
    path.join(planningDir, 'project.md'),
    '# Project\n**Name:** Test\n\n## What This Is\nA test project.\n\n## Core Value\nTesting.\n\n## Requirements\n- Req 1\n'
  );
  fs.writeFileSync(
    path.join(planningDir, 'roadmap.md'),
    '# Roadmap v1.0 MVP\n\n### Phase 1: Setup\n**Goal:** Test\n\n### Phase 2: Build\n**Goal:** Test\n'
  );
  const refLines = Array.from({ length: mentions }, (_, i) => `Note ${i + 1}: see ${refText}.`).join('\n');
  fs.writeFileSync(
    path.join(planningDir, 'state.md'),
    `# Project State\n\n**Current Phase:** 02\n**Status:** Building\n**Total Phases:** 2\n\n${refLines}\n`
  );
  fs.writeFileSync(path.join(planningDir, 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
  fs.mkdirSync(path.join(planningDir, 'phases', '01-setup'), { recursive: true });
  fs.mkdirSync(path.join(planningDir, 'phases', '02-build'), { recursive: true });
}

describe('W002 fires once per missing phase, not once per mention', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('one missing phase referenced 5 times yields exactly one W002', () => {
    seedMissingPhaseRefs(tmpDir, 5);

    const result = runPanTools('validate health', tmpDir);
    const output = JSON.parse(result.output);
    const w002 = output.warnings.filter(w => w.code === 'W002');

    assert.strictEqual(w002.length, 1, `expected exactly one W002, got ${w002.length}: ${JSON.stringify(w002)}`);
  });

  test('differently-spelled references to the same phase collapse to one W002', () => {
    seedMissingPhaseRefs(tmpDir, 1, 'Phase 3');
    const statePath = path.join(tmpDir, '.planning', 'state.md');
    fs.appendFileSync(statePath, '\nAlso blocked on Phase 03 and phase 3.\n');

    const output = JSON.parse(runPanTools('validate health', tmpDir).output);
    const w002 = output.warnings.filter(w => w.code === 'W002');

    assert.strictEqual(w002.length, 1, 'Phase 3, Phase 03 and phase 3 are the same phase');
  });

  test('two distinct missing phases still yield two W002 warnings', () => {
    seedMissingPhaseRefs(tmpDir, 2, 'Phase 3');
    fs.appendFileSync(path.join(tmpDir, '.planning', 'state.md'), '\nAlso Phase 4 twice: Phase 4.\n');

    const output = JSON.parse(runPanTools('validate health', tmpDir).output);
    const w002 = output.warnings.filter(w => w.code === 'W002');

    assert.strictEqual(w002.length, 2, 'deduping must not collapse genuinely different phases');
  });

  test('sub-phase references are not collapsed into their parent', () => {
    seedMissingPhaseRefs(tmpDir, 1, 'Phase 3');
    fs.appendFileSync(path.join(tmpDir, '.planning', 'state.md'), '\nAnd Phase 3.1 is separate.\n');

    const output = JSON.parse(runPanTools('validate health', tmpDir).output);
    const w002 = output.warnings.filter(w => w.code === 'W002');

    assert.strictEqual(w002.length, 2, 'Phase 3 and Phase 3.1 are different phases');
  });

  test("W002's repairable flag matches the documented table", () => {
    seedMissingPhaseRefs(tmpDir, 1);

    const output = JSON.parse(runPanTools('validate health', tmpDir).output);
    const w002 = output.warnings.find(w => w.code === 'W002');
    assert.ok(w002, 'fixture should produce a W002');

    const documented = parseDocumentedCodes().get('W002');
    assert.strictEqual(
      w002.repairable,
      documented.repairable,
      'W002 repairable flag must match docs/CLI-REFERENCE.md — change both or neither'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W006 / I002 — a phase ahead of the current one is progress, not a problem
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed a 4-phase roadmap with directories only for phases 1..builtThrough,
 * and state.md sitting at `currentPhase`.
 */
function seedPartiallyBuiltRoadmap(tmpDir, { builtThrough, currentPhase }) {
  const planningDir = path.join(tmpDir, '.planning');
  fs.writeFileSync(
    path.join(planningDir, 'project.md'),
    '# Project\n**Name:** Test\n\n## What This Is\nA test project.\n\n## Core Value\nTesting.\n\n## Requirements\n- Req 1\n'
  );
  const phases = ['Setup', 'Build', 'Packaging', 'Release']
    .map((name, i) => `### Phase ${i + 1}: ${name}\n**Goal:** Test\n`).join('\n');
  fs.writeFileSync(path.join(planningDir, 'roadmap.md'), `# Roadmap v1.0 MVP\n\n## Phase Details\n\n${phases}`);
  fs.writeFileSync(
    path.join(planningDir, 'state.md'),
    `# Project State\n\n**Current Phase:** ${currentPhase}\n**Status:** Building\n**Total Phases:** 4\n`
  );
  fs.writeFileSync(path.join(planningDir, 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
  const names = ['01-setup', '02-build', '03-packaging', '04-release'];
  for (let i = 0; i < builtThrough; i++) {
    fs.mkdirSync(path.join(planningDir, 'phases', names[i]), { recursive: true });
  }
}

describe('unbuilt roadmap phases ahead of the current phase do not degrade health', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('a mid-project 4-phase roadmap with phase 1 built is healthy', () => {
    seedPartiallyBuiltRoadmap(tmpDir, { builtThrough: 1, currentPhase: '01' });

    const output = JSON.parse(runPanTools('validate health', tmpDir).output);

    assert.strictEqual(output.warnings.filter(w => w.code === 'W006').length, 0, 'no W006 for phases not reached yet');
    assert.strictEqual(output.status, 'healthy', `expected healthy, got ${output.status}: ${JSON.stringify(output.warnings)}`);
  });

  test('phases ahead of the current phase are reported as I002 info', () => {
    seedPartiallyBuiltRoadmap(tmpDir, { builtThrough: 1, currentPhase: '01' });

    const output = JSON.parse(runPanTools('validate health', tmpDir).output);
    const i002 = output.info.filter(i => i.code === 'I002');

    assert.strictEqual(i002.length, 3, 'phases 2, 3 and 4 are planned but not built');
    assert.ok(i002.every(i => i.repairable === false), 'I002 is not repairable');
  });

  test('a phase BEHIND the current phase with no directory still warns', () => {
    // Current phase 3, but phase 2 was never created — genuinely suspect.
    seedPartiallyBuiltRoadmap(tmpDir, { builtThrough: 1, currentPhase: '03' });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-packaging'), { recursive: true });

    const output = JSON.parse(runPanTools('validate health', tmpDir).output);
    const w006 = output.warnings.filter(w => w.code === 'W006');

    assert.strictEqual(w006.length, 1, 'missing phase 2 must still warn');
    assert.match(w006[0].message, /Phase 2/, 'the warning should name phase 2');
  });

  test('with no readable current phase, every missing phase still warns', () => {
    seedPartiallyBuiltRoadmap(tmpDir, { builtThrough: 1, currentPhase: '01' });
    // Strip the Current Phase field — we can no longer tell ahead from behind.
    const statePath = path.join(tmpDir, '.planning', 'state.md');
    fs.writeFileSync(statePath, '# Project State\n\n**Status:** Building\n');

    const output = JSON.parse(runPanTools('validate health', tmpDir).output);

    assert.strictEqual(output.warnings.filter(w => w.code === 'W006').length, 3, 'fall back to warning when position is unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Status must account for every check that can add an issue
// ─────────────────────────────────────────────────────────────────────────────

describe('health status reflects warnings added by optional checks', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('status is not computed before the last check runs', () => {
    seedPartiallyBuiltRoadmap(tmpDir, { builtThrough: 1, currentPhase: '01' });

    // --links and --drift append warnings after the core checks. Whatever they
    // find, the verdict must be consistent with the warnings actually returned.
    const output = JSON.parse(runPanTools('validate health --links --drift', tmpDir).output);
    const expected = output.errors.length > 0 ? 'broken' : output.warnings.length > 0 ? 'degraded' : 'healthy';

    assert.strictEqual(
      output.status,
      expected,
      `status "${output.status}" contradicts ${output.errors.length} errors / ${output.warnings.length} warnings`
    );
  });
});
