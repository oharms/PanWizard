/**
 * Tests for hygiene.cjs — project cleanup + version alignment.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  scanHygiene,
  cleanHygiene,
  checkVersionAlignment,
  checkLegacyUppercase,
  checkTmpOrphans,
  checkMemoryLogs,
  checkCostLedger,
  checkStaleTraces,
  checkPlanningFragment,
  compareVersions,
} = require('../pan-wizard-core/bin/lib/hygiene.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const OWN_VERSION = require('../package.json').version;

function writeManifest(tmp, dir, version) {
  fs.mkdirSync(path.join(tmp, dir), { recursive: true });
  fs.writeFileSync(path.join(tmp, dir, 'pan-file-manifest.json'),
    JSON.stringify({ version, timestamp: '2026-01-01T00:00:00Z', files: {} }));
}

// ─── compareVersions ────────────────────────────────────────────────────────

describe('hygiene — compareVersions', () => {
  test('orders dotted versions numerically', () => {
    assert.equal(compareVersions('3.12.5', '3.13.0'), -1);
    assert.equal(compareVersions('3.13.0', '3.12.5'), 1);
    assert.equal(compareVersions('3.13.0', '3.13.0'), 0);
    assert.equal(compareVersions('3.9.0', '3.10.0'), -1, 'numeric, not lexicographic');
  });

  test('tolerates missing segments and junk', () => {
    assert.equal(compareVersions('3.13', '3.13.0'), 0);
    assert.equal(compareVersions(null, '0'), 0);
  });
});

// ─── version alignment ──────────────────────────────────────────────────────

describe('hygiene — checkVersionAlignment', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('outdated runtime install is flagged with the latest version named', () => {
    writeManifest(tmp, '.claude', '3.12.0');
    const r = checkVersionAlignment(tmp);
    assert.equal(r.latest_version, OWN_VERSION);
    const f = r.findings.find(x => x.check === 'version-alignment');
    assert.ok(f, 'outdated install flagged');
    assert.match(f.detail, /3\.12\.0/);
    assert.equal(f.fixable, false, 'installer re-run is never auto-applied');
  });

  test('aligned install produces no findings', () => {
    writeManifest(tmp, '.claude', OWN_VERSION);
    const r = checkVersionAlignment(tmp);
    assert.equal(r.findings.length, 0);
    assert.deepEqual(r.installs.map(i => i.runtime), ['claude']);
  });

  test('pan-wizard-core without a manifest is an untracked install', () => {
    fs.mkdirSync(path.join(tmp, '.codex', 'pan-wizard-core'), { recursive: true });
    const r = checkVersionAlignment(tmp);
    const f = r.findings.find(x => x.detail.includes('untracked'));
    assert.ok(f);
  });

  test('multiple runtimes each compared independently', () => {
    writeManifest(tmp, '.claude', OWN_VERSION);
    writeManifest(tmp, '.gemini', '3.11.0');
    const r = checkVersionAlignment(tmp);
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0].detail, /gemini/);
  });
});

// ─── legacy filenames ───────────────────────────────────────────────────────

describe('hygiene — checkLegacyUppercase', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('legacy uppercase file yields a fixable rename finding', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'STATE.md'), '# state\n');
    const r = checkLegacyUppercase(tmp);
    const f = r.findings.find(x => x.check === 'legacy-filenames');
    assert.ok(f);
    assert.equal(f.fix.action, 'rename-lowercase');
    assert.equal(f.fix.to, 'state.md');
  });

  test('clean lowercase layout yields nothing', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), '# state\n');
    assert.equal(checkLegacyUppercase(tmp).findings.length, 0);
  });

  test('clean --apply renames the legacy file to lowercase', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'STATE.md'), '# state\n');
    const r = cleanHygiene(tmp, { apply: true });
    const applied = r.applied.find(a => a.action === 'rename-lowercase');
    assert.ok(applied && applied.applied, JSON.stringify(r.applied));
    const entries = fs.readdirSync(path.join(tmp, '.planning'));
    assert.ok(entries.includes('state.md'), 'lowercase name present after rename');
    assert.ok(!entries.includes('STATE.md'), 'uppercase name gone');
  });
});

// ─── tmp orphans ────────────────────────────────────────────────────────────

describe('hygiene — checkTmpOrphans', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('aged .tmp is flagged, fresh .tmp is not', () => {
    const oldTmp = path.join(tmp, '.planning', 'state.md.tmp');
    const freshTmp = path.join(tmp, '.planning', 'roadmap.md.tmp');
    fs.writeFileSync(oldTmp, 'x');
    fs.writeFileSync(freshTmp, 'x');
    const past = (Date.now() - 3 * 3600 * 1000) / 1000;
    fs.utimesSync(oldTmp, past, past);
    const r = checkTmpOrphans(tmp);
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0].path, /state\.md\.tmp/);
  });

  test('clean --apply deletes the orphan', () => {
    const orphan = path.join(tmp, '.planning', 'state.md.tmp');
    fs.writeFileSync(orphan, 'x');
    const past = (Date.now() - 3 * 3600 * 1000) / 1000;
    fs.utimesSync(orphan, past, past);
    cleanHygiene(tmp, { apply: true });
    assert.throws(() => fs.statSync(orphan), 'orphan removed');
  });
});

// ─── memory bloat ───────────────────────────────────────────────────────────

describe('hygiene — checkMemoryLogs', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  function writeMemoryLog(agent, count) {
    const dir = path.join(tmp, '.planning', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    const bullets = Array.from({ length: count }, (_, i) => `- 2026-07-01: lesson number ${i}`);
    fs.writeFileSync(path.join(dir, `${agent}.md`),
      `---\nagent: ${agent}\ncreated: 2026-07-01\n---\n\n## Entries\n\n${bullets.join('\n')}\n`);
  }

  test('log over the cap is flagged with a compaction fix', () => {
    writeMemoryLog('pan-executor', 510);
    const r = checkMemoryLogs(tmp);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].fix.action, 'compact-memory');
  });

  test('log under the cap is not flagged', () => {
    writeMemoryLog('pan-planner', 50);
    assert.equal(checkMemoryLogs(tmp).findings.length, 0);
  });

  test('clean --apply compacts the oversized log', () => {
    writeMemoryLog('pan-executor', 510);
    const r = cleanHygiene(tmp, { apply: true });
    const applied = r.applied.find(a => a.action === 'compact-memory');
    assert.ok(applied && applied.applied, JSON.stringify(r.applied));
    assert.equal(checkMemoryLogs(tmp).findings.length, 0, 'no longer over cap');
  });
});

// ─── poisoned ledger ────────────────────────────────────────────────────────

describe('hygiene — checkCostLedger', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  function writeLedger(records) {
    const dir = path.join(tmp, '.planning', 'metrics');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tokens.jsonl'),
      records.map(r => JSON.stringify(r)).join('\n') + '\n');
  }
  const good = () => ({ ts: '2026-07-01T00:00:00Z', agent: 'x', input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0 });
  const poisoned = () => ({ ts: '2026-07-01T00:00:00Z', agent: 'x', input_tokens: 1000, output_tokens: 500, cache_read_tokens: 9e8 });

  test('mostly-suspect ledger is critical and fixable', () => {
    writeLedger([...Array.from({ length: 20 }, poisoned), ...Array.from({ length: 5 }, good)]);
    const r = checkCostLedger(tmp);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].severity, 'critical');
    assert.equal(r.findings[0].fix.action, 'quarantine-ledger');
  });

  test('small or mostly-clean ledgers are not flagged', () => {
    writeLedger(Array.from({ length: 10 }, poisoned)); // below min-records
    assert.equal(checkCostLedger(tmp).findings.length, 0);
    writeLedger([...Array.from({ length: 5 }, poisoned), ...Array.from({ length: 20 }, good)]); // below ratio
    assert.equal(checkCostLedger(tmp).findings.length, 0);
  });

  test('clean --apply quarantines by rename, never deletes', () => {
    writeLedger(Array.from({ length: 25 }, poisoned));
    const r = cleanHygiene(tmp, { apply: true });
    const applied = r.applied.find(a => a.action === 'quarantine-ledger');
    assert.ok(applied && applied.applied, JSON.stringify(r.applied));
    const dir = path.join(tmp, '.planning', 'metrics');
    const entries = fs.readdirSync(dir);
    assert.ok(!entries.includes('tokens.jsonl'), 'live ledger name freed');
    assert.ok(entries.some(e => e.startsWith('tokens.jsonl.quarantined-')), 'content preserved under quarantine name');
  });
});

// ─── stale traces ───────────────────────────────────────────────────────────

describe('hygiene — checkStaleTraces', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  function makeSessions(n) {
    const traces = path.join(tmp, '.planning', 'optimization', 'traces');
    for (let i = 0; i < n; i++) {
      const dir = path.join(traces, `sess_${i}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'trace.jsonl'), '{}\n');
      const t = (Date.now() - i * 60000) / 1000; // sess_0 newest, distinct mtimes
      fs.utimesSync(dir, t, t);
    }
  }

  test('keeps newest 5 regardless of age, flags older-than-retention beyond them', () => {
    makeSessions(7);
    const future = Date.now() + 40 * 24 * 3600 * 1000; // everything now "40 days old"
    const r = checkStaleTraces(tmp, {}, future);
    assert.equal(r.findings.length, 2, 'only the 2 beyond keep-min are flagged');
    assert.ok(r.findings.every(f => f.fix.action === 'delete-dir'));
  });

  test('within retention nothing is flagged even beyond keep-min', () => {
    makeSessions(7);
    const r = checkStaleTraces(tmp, {}, Date.now());
    assert.equal(r.findings.length, 0);
  });
});

// ─── fragment + scan/clean plumbing ─────────────────────────────────────────

describe('hygiene — fragment detection and scan/clean', () => {
  test('artifacts-only .planning is a fragment; focus-model and phase-model are not', () => {
    const frag = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-hyg-frag-'));
    fs.mkdirSync(path.join(frag, '.planning', 'codebase'), { recursive: true });
    fs.writeFileSync(path.join(frag, '.planning', 'codebase', 'stack.md'), '# stack\n');
    try {
      const r = checkPlanningFragment(frag);
      assert.equal(r.findings.length, 1);
      assert.equal(r.findings[0].fixable, false, 'fragment removal is manual');

      fs.mkdirSync(path.join(frag, '.planning', 'focus'), { recursive: true });
      assert.equal(checkPlanningFragment(frag).findings.length, 0, 'focus model is a spine');
    } finally {
      cleanup(frag);
    }
  });

  test('scanHygiene aggregates findings with summary counts', () => {
    const tmp = createTempProject();
    try {
      fs.writeFileSync(path.join(tmp, '.planning', 'STATE.md'), '# s\n');
      writeManifest(tmp, '.claude', '3.0.0');
      const r = scanHygiene(tmp);
      assert.ok(r.summary.total >= 2);
      assert.ok(r.summary.by_check['legacy-filenames'] >= 1);
      assert.ok(r.summary.by_check['version-alignment'] >= 1);
      assert.equal(r.summary.fixable, r.findings.filter(f => f.fixable).length);
    } finally {
      cleanup(tmp);
    }
  });

  test('cleanHygiene defaults to dry-run — nothing changes on disk', () => {
    const tmp = createTempProject();
    try {
      fs.writeFileSync(path.join(tmp, '.planning', 'STATE.md'), '# s\n');
      const r = cleanHygiene(tmp, {});
      assert.equal(r.dry_run, true);
      assert.ok(r.applied.every(a => a.applied === false));
      assert.ok(fs.readdirSync(path.join(tmp, '.planning')).includes('STATE.md'), 'file untouched');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── CLI dispatch ───────────────────────────────────────────────────────────

describe('hygiene — CLI (hygiene scan|clean)', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('hygiene scan returns findings JSON', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'ROADMAP.md'), '# r\n');
    const r = runPanTools('hygiene scan', tmp);
    assert.ok(r.success, r.error);
    const j = JSON.parse(r.output);
    assert.ok(j.summary.by_check['legacy-filenames'] >= 1);
  });

  test('hygiene clean is dry-run without --apply, applies with it', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'ROADMAP.md'), '# r\n');
    const dry = runPanTools('hygiene clean', tmp);
    assert.ok(dry.success, dry.error);
    assert.equal(JSON.parse(dry.output).dry_run, true);

    const wet = runPanTools('hygiene clean --apply', tmp);
    assert.ok(wet.success, wet.error);
    const j = JSON.parse(wet.output);
    assert.equal(j.dry_run, false);
    assert.equal(j.summary.executed, 1);
    assert.ok(fs.readdirSync(path.join(tmp, '.planning')).includes('roadmap.md'));
  });

  test('unknown hygiene subcommand errors', () => {
    const r = runPanTools('hygiene bogus', tmp);
    assert.equal(r.success, false);
    assert.match(r.error, /Unknown hygiene subcommand/);
  });
});
