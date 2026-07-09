/**
 * Tests for knowledge.cjs — Y-3 ask/discuss/playbook (v3.2).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  ask,
  loadSession,
  appendTurn,
  buildPlaybook,
  writePlaybook,
  scoreRelevance,
  categorizeEntry,
  PLAYBOOK_FILE,
  CONVERSATIONS_DIR,
} = require('../pan-wizard-core/bin/lib/knowledge.cjs');
const { appendMemory } = require('../pan-wizard-core/bin/lib/memory.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─── ask --recall-cue (ADR-0036 FW-1 minimal) ──────────────────────────────

describe('knowledge — ask --recall-cue', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('sources keep {file,score,bytes} shape (no recall_score leak) and no recall_sources without a cue', () => {
    fs.writeFileSync(path.join(tmp, 'README.md'), 'postgres bulk writes\n');
    const r = ask(tmp, 'postgres', {});
    assert.ok(r.sources.every(s => 'file' in s && 'score' in s && 'bytes' in s && !('recall_score' in s)));
    assert.equal(r.recall_sources, undefined);
    assert.equal(r.recall_cue, undefined);
  });

  test('--recall-cue returns a tighter recall_sources slice scored on the cue', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'project.md'), '# p\nauth login flow\n');
    fs.writeFileSync(path.join(tmp, 'README.md'), 'postgres indexing and bulk writes\n');
    const r = ask(tmp, 'auth login', { recall_cue: 'postgres' });
    assert.equal(r.recall_cue, 'postgres');
    assert.ok(Array.isArray(r.recall_sources));
    assert.ok(r.recall_sources.some(s => /README/.test(s.file)), 'the postgres cue surfaces README');
    assert.ok(r.recall_sources.every(s => s.recall_score > 0));
  });
});

// ─── scoreRelevance ─────────────────────────────────────────────────────────

describe('knowledge — scoreRelevance', () => {
  test('empty content yields zero', () => {
    assert.equal(scoreRelevance('postgres', ''), 0);
    assert.equal(scoreRelevance('postgres', null), 0);
  });

  test('single keyword match scores 1+', () => {
    assert.ok(scoreRelevance('postgres', 'We use postgres for storage.') >= 1);
  });

  test('multiple occurrences accumulate', () => {
    const s1 = scoreRelevance('postgres', 'postgres');
    const s2 = scoreRelevance('postgres', 'postgres postgres postgres');
    assert.ok(s2 > s1);
  });

  test('ignores stopwords/short terms', () => {
    // "of" is 2 chars, below the 3-char threshold.
    assert.equal(scoreRelevance('of', 'of of of'), 0);
  });

  test('is case-insensitive', () => {
    assert.ok(scoreRelevance('Postgres', 'we use POSTGRES') >= 1);
  });

  test('word boundaries prevent partial matches', () => {
    // "dog" should not match "dogma".
    assert.equal(scoreRelevance('dog', 'dogma surrounds dogmatic'), 0);
  });
});

// ─── ask ────────────────────────────────────────────────────────────────────

describe('knowledge — ask', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for empty question', () => {
    const r = ask(tmpDir, '');
    assert.ok(r.error);
  });

  test('returns sources ranked by keyword match', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'),
      'We use postgres postgres for everything.');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'requirements.md'),
      'Only light mention of postgres.');
    const r = ask(tmpDir, 'postgres');
    assert.ok(r.sources.length >= 2);
    const project = r.sources.find(s => s.file.endsWith('project.md'));
    const reqs = r.sources.find(s => s.file.endsWith('requirements.md'));
    assert.ok(project.score >= reqs.score);
  });

  test('always includes project.md / requirements.md even with zero score', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), 'unrelated content');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'requirements.md'), 'unrelated content');
    const r = ask(tmpDir, 'postgres');
    const files = r.sources.map(s => s.file);
    assert.ok(files.some(f => f.endsWith('project.md')));
    assert.ok(files.some(f => f.endsWith('requirements.md')));
  });

  test('max_sources caps the returned list', () => {
    // Seed 5 docs with the keyword.
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(tmpDir, '.planning', `file${i}.md`), 'postgres database');
    }
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), 'postgres');
    const r = ask(tmpDir, 'postgres', { max_sources: 2 });
    assert.ok(r.sources.length <= 2);
  });

  test('empty project still returns (possibly empty) array', () => {
    const r = ask(tmpDir, 'anything');
    assert.ok(Array.isArray(r.sources));
  });
});

// ─── discuss: loadSession + appendTurn ──────────────────────────────────────

describe('knowledge — discuss', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('loadSession returns empty session for new phase', () => {
    const s = loadSession(tmpDir, '07');
    assert.equal(s.phase, '07');
    assert.deepEqual(s.turns, []);
    assert.ok(s.created);
  });

  test('appendTurn persists to disk', () => {
    const r = appendTurn(tmpDir, '08', { role: 'user', content: 'Why Redis?' });
    assert.equal(r.appended, true);
    assert.equal(r.turn_count, 1);
    const session = loadSession(tmpDir, '08');
    assert.equal(session.turns.length, 1);
    assert.equal(session.turns[0].content, 'Why Redis?');
  });

  test('appendTurn rejects invalid role', () => {
    const r = appendTurn(tmpDir, '09', { role: 'bot', content: 'hi' });
    assert.ok(r.error);
  });

  test('appendTurn stores cites as array', () => {
    appendTurn(tmpDir, '10', { role: 'agent', content: 'answer', cites: ['project.md', 'ADR-0015'] });
    const session = loadSession(tmpDir, '10');
    assert.deepEqual(session.turns[0].cites, ['project.md', 'ADR-0015']);
  });

  test('multiple turns accumulate in order', () => {
    appendTurn(tmpDir, '11', { role: 'user', content: 'q1' });
    appendTurn(tmpDir, '11', { role: 'agent', content: 'a1' });
    appendTurn(tmpDir, '11', { role: 'user', content: 'q2' });
    const session = loadSession(tmpDir, '11');
    assert.equal(session.turns.length, 3);
    assert.equal(session.turns[0].content, 'q1');
    assert.equal(session.turns[2].content, 'q2');
  });

  test('rejects missing phaseNum', () => {
    const r = appendTurn(tmpDir, null, { role: 'user', content: 'hi' });
    assert.ok(r.error);
  });

  test('session file lives under conversations/<phase>/', () => {
    appendTurn(tmpDir, '12', { role: 'user', content: 'hi' });
    const p = path.join(tmpDir, '.planning', CONVERSATIONS_DIR, '12', 'session.json');
    assert.ok(fs.existsSync(p));
  });
});

// ─── categorizeEntry ────────────────────────────────────────────────────────

describe('knowledge — categorizeEntry', () => {
  test('classifies convention-like entries', () => {
    assert.equal(categorizeEntry('Prefer camelCase for variable names'), 'Conventions');
    assert.equal(categorizeEntry('Naming convention: kebab-case for files'), 'Conventions');
  });

  test('classifies gotcha-like entries', () => {
    assert.equal(categorizeEntry('Gotcha: Postgres returns bigint for count()'), 'Gotchas');
    assert.equal(categorizeEntry('Edge case: empty array breaks the pipeline'), 'Gotchas');
  });

  test('classifies decision-like entries', () => {
    assert.equal(categorizeEntry('Decided on Redis over Memcached for persistence'), 'Decisions');
  });

  test('classifies anti-pattern entries', () => {
    assert.equal(categorizeEntry('Avoid nested ternaries'), 'Anti-patterns');
    assert.equal(categorizeEntry("Don't use deep imports from lodash"), 'Anti-patterns');
  });

  test('uncategorized falls into General', () => {
    assert.equal(categorizeEntry('Just a random observation'), 'General');
  });

  test('recurring gap pattern classifies as Recurring gaps', () => {
    assert.equal(categorizeEntry('Recurring plan gap: missing wiring between API and UI'), 'Recurring gaps');
  });
});

// ─── buildPlaybook + writePlaybook ──────────────────────────────────────────

describe('knowledge — playbook', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('empty memory produces empty playbook', () => {
    const p = buildPlaybook(tmpDir);
    assert.equal(p.agent_count, 0);
    assert.equal(p.entry_count, 0);
    assert.deepEqual(p.sections, {});
  });

  test('clusters memory entries into categories', () => {
    appendMemory(tmpDir, 'pan-planner', 'Prefer bulk Postgres writes over per-row commits');
    appendMemory(tmpDir, 'pan-planner', 'Decided on Redis for session cache');
    appendMemory(tmpDir, 'pan-verifier', 'Gotcha: async iterators finalize on throw');
    const p = buildPlaybook(tmpDir);
    assert.equal(p.agent_count, 2);
    assert.equal(p.entry_count, 3);
    // Categorization via keyword detection — conventions keyword "prefer" → Conventions.
    assert.ok(p.sections['Conventions']);
    assert.ok(p.sections['Decisions']);
    assert.ok(p.sections['Gotchas']);
  });

  test('writePlaybook emits PLAYBOOK.md with frontmatter + sections', () => {
    appendMemory(tmpDir, 'pan-planner', 'Decided on Redis for caching');
    const p = buildPlaybook(tmpDir);
    const r = writePlaybook(tmpDir, p);
    assert.equal(r.written, true);
    const content = fs.readFileSync(path.join(tmpDir, '.planning', PLAYBOOK_FILE), 'utf-8');
    assert.match(content, /^---\ntype: playbook/);
    assert.match(content, /# PAN Playbook/);
    assert.match(content, /## Decisions/);
    assert.match(content, /from `pan-planner`/);
  });

  test('playbook attribution tags each entry', () => {
    appendMemory(tmpDir, 'pan-verifier', 'Avoid flaky timing assertions');
    const p = buildPlaybook(tmpDir);
    writePlaybook(tmpDir, p);
    const content = fs.readFileSync(path.join(tmpDir, '.planning', PLAYBOOK_FILE), 'utf-8');
    assert.match(content, /— from `pan-verifier`/);
  });
});

// ─── CLI dispatch ───────────────────────────────────────────────────────────

describe('knowledge — CLI dispatch', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('knowledge ask via CLI returns ranked sources', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'),
      'Postgres is our main database.');
    const r = runPanTools('knowledge ask postgres', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.question, 'postgres');
    assert.ok(json.sources.length >= 1);
  });

  test('knowledge discuss --subcmd read returns empty for new phase', () => {
    const r = runPanTools('knowledge discuss 05 --subcmd read', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.phase, '05');
    assert.deepEqual(json.turns, []);
  });

  test('knowledge discuss append + read round-trip via CLI', () => {
    const a = runPanTools('knowledge discuss 06 --subcmd append --role user --content hello', tmpDir);
    assert.ok(a.success, a.error);
    const aJson = JSON.parse(a.output);
    assert.equal(aJson.appended, true);

    const r = runPanTools('knowledge discuss 06 --subcmd read', tmpDir);
    const rJson = JSON.parse(r.output);
    assert.equal(rJson.turns.length, 1);
    assert.equal(rJson.turns[0].content, 'hello');
  });

  test('knowledge playbook writes PLAYBOOK.md', () => {
    runPanTools('memory append pan-planner Prefer-Redis-for-session-cache', tmpDir);
    const r = runPanTools('knowledge playbook', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.written, true);
    assert.equal(json.entry_count, 1);
  });

  test('knowledge playbook --preview does NOT write file', () => {
    runPanTools('memory append pan-x lesson-one', tmpDir);
    const r = runPanTools('knowledge playbook --preview', tmpDir);
    assert.ok(r.success, r.error);
    assert.equal(fs.existsSync(path.join(tmpDir, '.planning', PLAYBOOK_FILE)), false);
  });
});
