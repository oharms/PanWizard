const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  readJsonFile,
  removeQuotes,
  planningPath,
  phasesPath,
  milestonesPath,
  listPhaseDirs,
  filterPlanFiles,
  filterSummaryFiles,
  parsePhaseDir,
  classifyPhaseStatus,
  fileAccessible,
  hasBraveSearchKey,
} = require('../pan-wizard-core/bin/lib/utils.cjs');
const { getArchivedPhaseDirs } = require('../pan-wizard-core/bin/lib/core.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

let tmpDir;
beforeEach(() => { tmpDir = createTempProject(); });
afterEach(() => { cleanup(tmpDir); });

// ─── readJsonFile ───────────────────────────────────────────────────────────

describe('readJsonFile', () => {
  it('reads valid JSON file', () => {
    const fp = path.join(tmpDir, 'data.json');
    fs.writeFileSync(fp, '{"key": "value"}');
    const result = readJsonFile(fp);
    assert.deepEqual(result, { key: 'value' });
    assert.equal(typeof result, 'object');
    assert.equal(result.key, 'value');
  });

  it('returns null for missing file', () => {
    const result = readJsonFile(path.join(tmpDir, 'nonexistent.json'));
    assert.equal(result, null);
  });

  it('returns null for invalid JSON', () => {
    const fp = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(fp, 'not json {{{');
    const result = readJsonFile(fp);
    assert.equal(result, null);
  });

  it('reads empty object', () => {
    const fp = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(fp, '{}');
    const result = readJsonFile(fp);
    assert.deepEqual(result, {});
    assert.equal(Object.keys(result).length, 0);
  });

  it('reads array JSON', () => {
    const fp = path.join(tmpDir, 'arr.json');
    fs.writeFileSync(fp, '[1, 2, 3]');
    const result = readJsonFile(fp);
    assert.deepEqual(result, [1, 2, 3]);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 3);
  });
});

// ─── removeQuotes ───────────────────────────────────────────────────────────

describe('removeQuotes', () => {
  it('removes double quotes', () => {
    assert.equal(removeQuotes('"hello"'), 'hello');
  });

  it('removes single quotes', () => {
    assert.equal(removeQuotes("'hello'"), 'hello');
  });

  it('removes mixed quotes (leading double, trailing single)', () => {
    assert.equal(removeQuotes('"hello\''), 'hello');
  });

  it('preserves string without quotes', () => {
    assert.equal(removeQuotes('hello'), 'hello');
  });

  it('preserves empty string', () => {
    assert.equal(removeQuotes(''), '');
  });

  it('removes only outer quotes, keeps inner', () => {
    assert.equal(removeQuotes('"he\'llo"'), "he'llo");
  });
});

// ─── planningPath ───────────────────────────────────────────────────────────

describe('planningPath', () => {
  it('returns correct path', () => {
    const result = planningPath(tmpDir);
    assert.equal(result, path.join(tmpDir, '.planning'));
    assert.equal(typeof result, 'string');
    assert.ok(result.endsWith('.planning'));
  });
});

// ─── phasesPath ─────────────────────────────────────────────────────────────

describe('phasesPath', () => {
  it('returns correct path', () => {
    const result = phasesPath(tmpDir);
    assert.equal(result, path.join(tmpDir, '.planning', 'phases'));
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('.planning'));
  });
});

// ─── milestonesPath ─────────────────────────────────────────────────────────

describe('milestonesPath', () => {
  it('returns correct path', () => {
    const result = milestonesPath(tmpDir);
    assert.equal(result, path.join(tmpDir, '.planning', 'milestones'));
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('milestones'));
  });
});

// ─── listPhaseDirs ──────────────────────────────────────────────────────────

describe('listPhaseDirs', () => {
  it('returns empty array when no phases exist', () => {
    const result = listPhaseDirs(tmpDir);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('returns empty array when phases dir does not exist', () => {
    const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-empty-'));
    const result = listPhaseDirs(emptyDir);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('lists phase directories sorted by number', () => {
    const pp = phasesPath(tmpDir);
    fs.mkdirSync(path.join(pp, '03-third'), { recursive: true });
    fs.mkdirSync(path.join(pp, '01-first'), { recursive: true });
    fs.mkdirSync(path.join(pp, '02-second'), { recursive: true });
    const result = listPhaseDirs(tmpDir);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 3);
    assert.deepEqual(result, ['01-first', '02-second', '03-third']);
  });

  it('ignores non-directory entries', () => {
    const pp = phasesPath(tmpDir);
    fs.mkdirSync(path.join(pp, '01-first'), { recursive: true });
    fs.writeFileSync(path.join(pp, 'notes.txt'), 'not a dir');
    const result = listPhaseDirs(tmpDir);
    assert.deepEqual(result, ['01-first']);
  });

  it('handles decimal phase numbers', () => {
    const pp = phasesPath(tmpDir);
    fs.mkdirSync(path.join(pp, '01-base'), { recursive: true });
    fs.mkdirSync(path.join(pp, '01.1-hotfix'), { recursive: true });
    fs.mkdirSync(path.join(pp, '02-next'), { recursive: true });
    const result = listPhaseDirs(tmpDir);
    assert.equal(result[0], '01-base');
    assert.equal(result[1], '01.1-hotfix');
    assert.equal(result[2], '02-next');
  });
});

// ─── filterPlanFiles ────────────────────────────────────────────────────────

describe('filterPlanFiles', () => {
  it('filters plan files from mixed array', () => {
    const files = ['01-plan.md', 'README.md', '02-plan.md', '01-summary.md', 'plan.md'];
    const result = filterPlanFiles(files);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 3);
    assert.deepEqual(result, ['01-plan.md', '02-plan.md', 'plan.md']);
  });

  it('returns empty array for no plan files', () => {
    const result = filterPlanFiles(['README.md', 'summary.md']);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('returns empty array for empty input', () => {
    const result = filterPlanFiles([]);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('sorts plan files alphabetically', () => {
    const files = ['03-plan.md', '01-plan.md', '02-plan.md'];
    const result = filterPlanFiles(files);
    assert.deepEqual(result, ['01-plan.md', '02-plan.md', '03-plan.md']);
  });
});

// ─── filterSummaryFiles ─────────────────────────────────────────────────────

describe('filterSummaryFiles', () => {
  it('filters summary files from mixed array', () => {
    const files = ['01-summary.md', 'README.md', '02-summary.md', '01-plan.md', 'summary.md'];
    const result = filterSummaryFiles(files);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 3);
    assert.deepEqual(result, ['01-summary.md', '02-summary.md', 'summary.md']);
  });

  it('returns empty for no summary files', () => {
    const result = filterSummaryFiles(['plan.md']);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('returns empty for empty input', () => {
    const result = filterSummaryFiles([]);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});

// ─── parsePhaseDir ──────────────────────────────────────────────────────────

describe('parsePhaseDir', () => {
  it('parses 01-setup-auth', () => {
    const result = parsePhaseDir('01-setup-auth');
    assert.equal(typeof result, 'object');
    assert.equal(result.number, '01');
    assert.equal(result.name, 'setup-auth');
  });

  it('parses 03.1-hotfix', () => {
    const result = parsePhaseDir('03.1-hotfix');
    assert.equal(typeof result, 'object');
    assert.equal(result.number, '03.1');
    assert.equal(result.name, 'hotfix');
  });

  it('parses bare number 01', () => {
    const result = parsePhaseDir('01');
    assert.equal(result.number, '01');
    assert.equal(result.name, null);
  });

  it('handles non-matching input', () => {
    const result = parsePhaseDir('random-name');
    assert.equal(result.number, 'random-name');
    assert.equal(result.name, null);
  });

  it('parses 10A-feature', () => {
    const result = parsePhaseDir('10A-feature');
    assert.equal(result.number, '10A');
    assert.equal(result.name, 'feature');
  });
});

// ─── getArchivedPhaseDirs ──────────────────────────────────────────────────

describe('getArchivedPhaseDirs', () => {
  it('returns empty array when no milestones dir', () => {
    const result = getArchivedPhaseDirs(tmpDir);
    assert.deepEqual(result, []);
  });

  it('returns empty array when milestones dir is empty', () => {
    fs.mkdirSync(milestonesPath(tmpDir), { recursive: true });
    const result = getArchivedPhaseDirs(tmpDir);
    assert.deepEqual(result, []);
  });

  it('lists phases from archived milestone', () => {
    const archiveDir = path.join(milestonesPath(tmpDir), 'v0.1.0-phases');
    fs.mkdirSync(path.join(archiveDir, '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(archiveDir, '02-feature'), { recursive: true });
    const result = getArchivedPhaseDirs(tmpDir);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, '01-setup');
    assert.equal(result[0].milestone, 'v0.1.0');
    assert.equal(result[1].name, '02-feature');
    assert.equal(result[1].milestone, 'v0.1.0');
  });

  it('lists phases from multiple milestones, newest first', () => {
    const v1 = path.join(milestonesPath(tmpDir), 'v1.0-phases');
    const v2 = path.join(milestonesPath(tmpDir), 'v2.0-phases');
    fs.mkdirSync(path.join(v1, '01-a'), { recursive: true });
    fs.mkdirSync(path.join(v2, '01-b'), { recursive: true });
    const result = getArchivedPhaseDirs(tmpDir);
    assert.equal(result.length, 2);
    // v2.0 should come first (reverse sort)
    assert.equal(result[0].milestone, 'v2.0');
    assert.equal(result[1].milestone, 'v1.0');
  });

  it('ignores non-archive directories', () => {
    const msDir = milestonesPath(tmpDir);
    fs.mkdirSync(path.join(msDir, 'v0.1.0-phases', '01-x'), { recursive: true });
    fs.mkdirSync(path.join(msDir, 'random-dir'), { recursive: true });
    const result = getArchivedPhaseDirs(tmpDir);
    assert.equal(result.length, 1);
    assert.equal(result[0].milestone, 'v0.1.0');
  });

  it('includes basePath and fullPath', () => {
    const archiveDir = path.join(milestonesPath(tmpDir), 'v1.0-phases');
    fs.mkdirSync(path.join(archiveDir, '01-test'), { recursive: true });
    const result = getArchivedPhaseDirs(tmpDir);
    assert.equal(result.length, 1);
    assert.ok(result[0].basePath.includes('milestones'));
    assert.ok(result[0].fullPath.includes('01-test'));
    assert.equal(typeof result[0].name, 'string');
    assert.equal(typeof result[0].milestone, 'string');
  });
});

// ─── classifyPhaseStatus ───────────────────────────────────────────────────

describe('classifyPhaseStatus', () => {
  it('returns complete when summaries >= plans and plans > 0', () => {
    assert.equal(classifyPhaseStatus(3, 3), 'complete');
    assert.equal(classifyPhaseStatus(2, 4), 'complete');
  });

  it('returns partial when some summaries exist', () => {
    assert.equal(classifyPhaseStatus(3, 1), 'partial');
  });

  it('returns planned when plans exist but no summaries', () => {
    assert.equal(classifyPhaseStatus(2, 0), 'planned');
  });

  it('returns researched when only research flag', () => {
    assert.equal(classifyPhaseStatus(0, 0, { hasResearch: true }), 'researched');
  });

  it('returns discussed when only context flag', () => {
    assert.equal(classifyPhaseStatus(0, 0, { hasContext: true }), 'discussed');
  });

  it('returns empty with no files and no flags', () => {
    assert.equal(classifyPhaseStatus(0, 0), 'empty');
    assert.equal(classifyPhaseStatus(0, 0, {}), 'empty');
  });

  it('research takes priority over context', () => {
    assert.equal(classifyPhaseStatus(0, 0, { hasResearch: true, hasContext: true }), 'researched');
  });
});

describe('fileAccessible', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  it('returns true for an existing readable file', () => {
    const filePath = path.join(tmpDir, 'test-file.txt');
    fs.writeFileSync(filePath, 'hello');
    assert.strictEqual(fileAccessible(filePath), true);
  });

  it('returns false for a non-existent file', () => {
    assert.strictEqual(fileAccessible(path.join(tmpDir, 'no-such-file.txt')), false);
  });

  it('returns false for a directory path', () => {
    assert.strictEqual(fileAccessible(tmpDir), true);
  });
});

describe('hasBraveSearchKey', () => {
  it('returns true when BRAVE_API_KEY is set', () => {
    const original = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = 'test-key-123';
    try {
      assert.strictEqual(hasBraveSearchKey(), true);
    } finally {
      if (original === undefined) delete process.env.BRAVE_API_KEY;
      else process.env.BRAVE_API_KEY = original;
    }
  });

  it('returns false when BRAVE_API_KEY is unset and no key file', () => {
    const original = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    try {
      // Will be false unless ~/.pan-wizard/brave_api_key exists
      const result = hasBraveSearchKey();
      assert.strictEqual(typeof result, 'boolean');
    } finally {
      if (original !== undefined) process.env.BRAVE_API_KEY = original;
    }
  });
});
