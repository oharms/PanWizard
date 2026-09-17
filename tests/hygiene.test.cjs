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
  checkCachedContext,
  checkStaleReports,
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

  test('small or genuinely clean ledgers are not flagged', () => {
    writeLedger(Array.from({ length: 10 }, poisoned)); // below min-records
    assert.equal(checkCostLedger(tmp).findings.length, 0);

    // Clean on BOTH axes: few suspect rows AND those rows hold a minority of
    // the token mass. `lowMassSuspect` trips the output-oversum rule rather
    // than the cache-read rule, so a suspect row can exist without dominating.
    const lowMassSuspect = () => ({ ts: '2026-07-01T00:00:00Z', agent: 'x', input_tokens: 0, output_tokens: 1.1e7, cache_read_tokens: 0 });
    const heavyGood = () => ({ ts: '2026-07-01T00:00:00Z', agent: 'x', input_tokens: 1000, output_tokens: 500, cache_read_tokens: 5e6 });
    writeLedger([...Array.from({ length: 5 }, lowMassSuspect), ...Array.from({ length: 20 }, heavyGood)]);
    assert.equal(checkCostLedger(tmp).findings.length, 0,
      'below the ratio on count AND on mass — nothing to report');
  });

  test('a ledger that passes on count but is dominated by suspect MASS is flagged', () => {
    // The field case this gate exists for: 5 of 25 rows (20%, under the 50%
    // count gate) carrying essentially all of the token mass. A count-only gate
    // called this healthy while every aggregate read off it was wrong by orders
    // of magnitude.
    writeLedger([...Array.from({ length: 5 }, poisoned), ...Array.from({ length: 20 }, good)]);
    const r = checkCostLedger(tmp);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].severity, 'critical');
    assert.match(r.findings[0].detail, /tripped on token mass/);
    assert.match(r.findings[0].detail, /5\/25 records suspect \(20% of rows/);
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

// ─── Multi-track scanning ───────────────────────────────────────────────────

/**
 * Regression cover for the "false clean" defect: `hygiene scan` resolved
 * `.planning/` relative to the cwd with no way to target another tree, so a
 * repo whose real work lived in `.planning/tracks/*` got a clean bill of health
 * while a sibling track sat far over its trace retention. The command did not
 * fail — it succeeded against the wrong directory.
 */
describe('hygiene — multi-track', () => {
  let tmp;

  /** Give a directory a planning spine so it registers as a track. */
  function makeTrack(name) {
    const abs = path.join(tmp, '.planning', 'tracks', name);
    fs.mkdirSync(path.join(abs, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(abs, 'state.md'), '# State\n');
    return abs;
  }

  /** Age `count` trace sessions past retention inside a planning tree. */
  function addStaleTraces(treeAbs, count) {
    const traces = path.join(treeAbs, 'optimization', 'traces');
    fs.mkdirSync(traces, { recursive: true });
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000);
    for (let i = 0; i < count; i++) {
      const dir = path.join(traces, `session-${String(i).padStart(2, '0')}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'trace.json'), '{}');
      fs.utimesSync(dir, old, old);
    }
    return traces;
  }

  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('the default scan reports which tree it read', () => {
    const r = runPanTools('hygiene scan', tmp);
    assert.ok(r.success, r.error);
    const j = JSON.parse(r.output);
    assert.equal(j.planning_root, '.planning');
    assert.equal(j.planning_root_source, 'default');
    assert.equal(j.all_tracks, false);
    assert.deepEqual(j.roots_scanned.map(x => x.planning_root), ['.planning'],
      'a clean verdict must always name the tree it was reached from');
  });

  test('--track targets a sibling tree the default scan cannot see', () => {
    addStaleTraces(makeTrack('verify'), 18);

    const rootScan = JSON.parse(runPanTools('hygiene scan', tmp).output);
    assert.equal(rootScan.summary.total, 0, 'root tree is genuinely clean');

    const trackScan = JSON.parse(runPanTools('hygiene scan --track verify', tmp).output);
    assert.equal(trackScan.planning_root, '.planning/tracks/verify');
    assert.equal(trackScan.planning_root_source, 'flag:--track');
    assert.ok(trackScan.summary.by_check['stale-traces'] > 0,
      'the track over its trace retention must be reachable');
    assert.ok(trackScan.findings.every(f => f.track === 'verify'),
      'findings must be attributed to the track they came from');
  });

  test('--all-tracks sweeps the root tree and every track', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), '# State\n');
    makeTrack('core');
    addStaleTraces(makeTrack('verify'), 18);

    const j = JSON.parse(runPanTools('hygiene scan --all-tracks', tmp).output);
    assert.equal(j.all_tracks, true);
    assert.deepEqual(j.roots_scanned.map(x => x.track), [null, 'core', 'verify']);
    assert.ok(j.summary.by_track.verify > 0);
    assert.equal(j.summary.by_track.core, undefined, 'a clean track contributes no findings');
  });

  test('version drift is counted once, not once per track', () => {
    writeManifest(tmp, '.claude', '0.0.1');
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), '# State\n');
    makeTrack('core');
    makeTrack('verify');

    const j = JSON.parse(runPanTools('hygiene scan --all-tracks', tmp).output);
    const drift = j.findings.filter(f => f.check === 'version-alignment');
    assert.equal(drift.length, 1,
      'version alignment is a project property — sweeping N trees must not report it N times');
  });

  test('--all-tracks --apply prunes the offending track and leaves the others alone', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), '# State\n');
    const coreAbs = makeTrack('core');
    const verifyAbs = makeTrack('verify');
    const verifyTraces = addStaleTraces(verifyAbs, 18);

    const r = runPanTools('hygiene clean --all-tracks --apply', tmp);
    assert.ok(r.success, r.error);

    assert.equal(fs.readdirSync(verifyTraces).length, 5, 'keeps the newest sessions only');
    assert.ok(fs.existsSync(path.join(coreAbs, 'state.md')), 'untouched track still intact');
    assert.ok(fs.existsSync(path.join(tmp, '.planning', 'state.md')), 'root tree still intact');
  });

  test('a track name that escapes the project root is rejected', () => {
    const r = runPanTools('hygiene scan --track ../../etc', tmp);
    assert.equal(r.success, false);
    assert.match(r.error, /not a valid track name/);
  });

  test('a targeted track that does not exist is reported as missing', () => {
    const j = JSON.parse(runPanTools('hygiene scan --track ghost', tmp).output);
    assert.equal(j.planning_root_exists, false,
      'a typo in --track must be visible, not read as a clean project');
    assert.equal(j.summary.total, 0);
  });
});

// ─── Cached context + optimization reports ──────────────────────────────────

/**
 * The cached context block is re-read into EVERY agent call, so it is the
 * dominant recurring cost of a PAN project. Nothing watched it before: the size
 * was measured and reported with no threshold, so a block that had grown to
 * ~28k tokens of mostly closed history looked exactly like a healthy one.
 */
describe('hygiene — cached context', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  const write = (name, kb) => fs.writeFileSync(
    path.join(tmp, '.planning', name), 'x'.repeat(Math.round(kb * 1024)) + '\n');

  test('a small cached block is not flagged', () => {
    write('project.md', 1);
    assert.deepEqual(checkCachedContext(tmp).findings, []);
  });

  test('a block past the warn threshold is a warning', () => {
    write('state.md', 62); // ~15.9k tokens — over warn (15k), under critical (25k)
    const block = checkCachedContext(tmp).findings.find(x => x.path === '.planning');
    assert.equal(block.severity, 'warn');
  });

  test('an oversized block is critical and names the largest file', () => {
    // Real sections, not filler: the compaction remedy is only offered when
    // there is genuinely something to archive.
    const bulk = Array.from({ length: 2000 }, (_, i) => `settled narrative line ${i} recording work that is finished and no longer actionable.`).join('\n');
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'),
      `---\nv: 1\n---\n\n## Phase 1 closure\n\n${bulk}\n\n## Next Action\n\ngo\n`);

    const f = checkCachedContext(tmp).findings;
    const block = f.find(x => x.path === '.planning');
    assert.equal(block.severity, 'critical');
    assert.match(block.detail, /re-read on every agent call/);

    const file = f.find(x => x.path.endsWith('state.md'));
    assert.equal(file.severity, 'warn');
    assert.equal(file.fix.action, 'compact-state', 'state.md gets the compaction remedy');
  });

  test('token counts are formatted without a locale-dependent separator', () => {
    write('state.md', 110);
    const block = checkCachedContext(tmp).findings.find(x => x.path === '.planning');
    assert.match(block.detail, /~[\d,]+ tokens/, 'commas only — never a locale space');
    assert.ok(!/\u00a0|\u202f/.test(block.detail), 'no non-breaking space in the finding');
  });

  test('planning docs with nothing cacheable is reported as no caching at all', () => {
    fs.mkdirSync(path.join(tmp, '.planning', 'research'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.planning', 'research', 'spec.md'), '# spec\n');
    const f = checkCachedContext(tmp).findings;
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, 'info');
    assert.match(f[0].detail, /none are cacheable/);
  });

  test('a bare scaffold with no docs yet is silent', () => {
    // A freshly created .planning/phases/ has nothing to cache — saying so on
    // every new project would be noise, not signal.
    assert.deepEqual(checkCachedContext(tmp).findings, []);
  });

  test('config cache.extra_files brings a focus-model project back into cache', () => {
    fs.mkdirSync(path.join(tmp, '.planning', 'research'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.planning', 'research', 'spec.md'), '# spec\n');
    fs.writeFileSync(path.join(tmp, '.planning', 'config.json'),
      JSON.stringify({ cache: { extra_files: ['research/spec.md'] } }));
    assert.deepEqual(checkCachedContext(tmp).findings, [], 'now cached — nothing to report');
  });
});

describe('hygiene — stale optimization reports', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  function writeReports(count, ageDays) {
    const dir = path.join(tmp, '.planning', 'optimization', 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const when = new Date(Date.now() - ageDays * 24 * 3600 * 1000);
    for (let i = 0; i < count; i++) {
      const p = path.join(dir, `sess-${String(i).padStart(2, '0')}-report.md`);
      fs.writeFileSync(p, '# report\n');
      fs.utimesSync(p, when, when);
    }
  }

  test('reports past retention beyond the keep-min are prunable', () => {
    writeReports(9, 200);
    const f = checkStaleReports(tmp, {}).findings;
    assert.equal(f.length, 4, 'keeps the newest 5');
    assert.equal(f[0].fix.action, 'delete');
  });

  test('recent reports are never flagged', () => {
    writeReports(9, 1);
    assert.deepEqual(checkStaleReports(tmp, {}).findings, []);
  });

  test('no reports directory is not an error', () => {
    assert.deepEqual(checkStaleReports(tmp, {}).findings, []);
  });
});

// ─── Convergence: clean must actually finish the job ────────────────────────

/**
 * A project must reach a settled state. Three defects broke that:
 *   - `cache-context` advertised `compact-state` even after everything
 *     archivable was gone, so `clean --apply` reported a permanent `failed: 1`
 *   - each quarantine left a dated ledger behind and nothing ever removed them
 *   - the cost cursor survived quarantine, pointing into a ledger that had moved
 */
describe('hygiene — clean converges', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  const metrics = () => path.join(tmp, '.planning', 'metrics');

  function writePoisonedLedger() {
    fs.mkdirSync(metrics(), { recursive: true });
    const rows = Array.from({ length: 25 }, () => JSON.stringify({
      ts: '2026-07-01T00:00:00Z', agent: 'x', input_tokens: 1, output_tokens: 1, cache_read_tokens: 9e8,
    }));
    fs.writeFileSync(path.join(metrics(), 'tokens.jsonl'), rows.join('\n') + '\n');
  }

  function writeCompactableState() {
    const bulk = Array.from({ length: 400 }, (_, i) => `settled narrative line ${i} that no longer drives a decision.`).join('\n');
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'),
      `---\nv: 1\n---\n\n## Phase 1 closure\n\n${bulk}\n\n## Next Action\n\ngo\n`);
  }

  test('state.md keeps its compact-state fix only while there is something to archive', () => {
    writeCompactableState();
    const before = checkCachedContext(tmp).findings.find(f => f.path.endsWith('state.md'));
    assert.equal(before.fix.action, 'compact-state', 'archivable history — offer the fix');

    cleanHygiene(tmp, { apply: true });

    const after = checkCachedContext(tmp).findings.find(f => f.path.endsWith('state.md'));
    if (after) {
      assert.equal(after.fixable, false,
        'nothing left to archive — must not advertise a fix that would no-op');
      assert.match(after.detail, /already compacted/);
    }
  });

  test('a second clean --apply is a clean no-op, never a failure', () => {
    writePoisonedLedger();
    writeCompactableState();

    const first = cleanHygiene(tmp, { apply: true });
    assert.equal(first.summary.failed, 0);
    assert.ok(first.summary.executed > 0);

    const second = cleanHygiene(tmp, { apply: true });
    assert.equal(second.summary.executed, 0, 'nothing left to do');
    assert.equal(second.summary.failed, 0,
      'a settled project must not report failures forever');
    assert.equal(second.summary.fixable, 0);
  });

  test('quarantining prunes superseded quarantines and leaves the transcript cursor alone', () => {
    writePoisonedLedger();
    fs.writeFileSync(path.join(metrics(), 'tokens.jsonl.quarantined-2026-01-01'), 'old\n');
    fs.writeFileSync(path.join(metrics(), 'tokens.jsonl.quarantined-2026-02-01'), 'older\n');
    fs.writeFileSync(path.join(metrics(), '.cost-cursor.json'), '{"/t":5}');

    cleanHygiene(tmp, { apply: true });

    const left = fs.readdirSync(metrics()).filter(f => f.includes('quarantined'));
    assert.equal(left.length, 1, 'only the newest quarantine survives');
    // The cursor is a high-water mark into each session TRANSCRIPT, not a position
    // in the ledger. Deleting it here made the next SubagentStop re-sum the whole
    // transcript from line 0 — a fresh oversum row the day after every quarantine
    // (field, 2026-08-25 → 08-26) — so quarantine and poison were a loop.
    assert.equal(fs.readFileSync(path.join(metrics(), '.cost-cursor.json'), 'utf8'), '{"/t":5}',
      'the transcript cursor survives a ledger quarantine');
  });

  test('the poisoned ledger itself is renamed, never deleted', () => {
    writePoisonedLedger();
    const original = fs.readFileSync(path.join(metrics(), 'tokens.jsonl'), 'utf8');
    cleanHygiene(tmp, { apply: true });
    const quarantined = fs.readdirSync(metrics()).find(f => f.includes('quarantined'));
    assert.ok(quarantined, 'evidence preserved');
    assert.equal(fs.readFileSync(path.join(metrics(), quarantined), 'utf8'), original);
  });
});

// ─── cache-context: prompt-cache lifetime recommendation (ADR-0046 D5) ──────

describe('hygiene — cache-context lifetime recommendation', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  const row = (min) => JSON.stringify({
    ts: new Date(Date.UTC(2026, 8, 10, 0, min, 0)).toISOString(),
    agent: 'pan-executor', input_tokens: 100, output_tokens: 50, cache_write_tokens: 8000,
  });
  const seed = (rows) => {
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), '# State\n');
    fs.mkdirSync(path.join(tmp, '.planning', 'metrics'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.planning', 'metrics', 'tokens.jsonl'), rows.join('\n') + '\n');
  };

  test('recommends subagentPromptCacheTtl when the ledger shows repeated writes after short idle gaps', () => {
    seed([row(0), row(20), row(45)]);
    const f = checkCachedContext(tmp).findings.find(x => /subagentPromptCacheTtl/.test(x.detail));
    assert.ok(f, 'expected the lifetime recommendation');
    assert.equal(f.severity, 'info', 'a cost trade the user weighs — informational');
    assert.equal(f.fixable, false, 'never advertised as auto-fixable: the remedy is a Claude Code setting');
    assert.match(f.path, /tokens\.jsonl$/);
  });

  test('stays silent for a burst that never idles, and for a project with no ledger', () => {
    seed([row(0), row(1), row(3)]);
    assert.equal(checkCachedContext(tmp).findings.some(x => /subagentPromptCacheTtl/.test(x.detail)), false);
    fs.rmSync(path.join(tmp, '.planning', 'metrics'), { recursive: true, force: true });
    assert.equal(checkCachedContext(tmp).findings.some(x => /subagentPromptCacheTtl/.test(x.detail)), false);
  });
});
