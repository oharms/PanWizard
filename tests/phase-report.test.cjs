/**
 * Tests for phase-report.cjs — per-phase HTML reports + project timeline index
 * (M1 of the phase-report design). collectPhaseData/collectIndexData and the
 * render* functions are pure given a fixed `now`; cmdReport writes files and is
 * exercised via the dispatcher. Mirrors hud.test.cjs conventions.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pr = require('../pan-wizard-core/bin/lib/phase-report.cjs');
const { runPanTools } = require('./helpers.cjs');

const NOW = new Date('2026-07-12T12:00:00Z');

let cwd;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-report-')); });
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

function W(rel, content) {
  const p = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

// A realistic project exercising every artifact form: prefixed ids, bare
// plan.md/summary.md, slug plans, verification with gaps, and thin phases.
function scaffold() {
  W('package.json', JSON.stringify({ name: 'acme-platform', version: '0.4.0' }));
  W('.planning/roadmap.md', [
    '# Roadmap', '',
    '### Phase 01: Scaffold', '**Goal:** Stand up the skeleton.', '',
    '### Phase 02: Data Layer', '**Goal:** Persist entities.', '',
    '### Phase 03: Auth & Sessions',
    '**Goal:** Password + OAuth sign-in.',
    '**Success Criteria**:',
    '1. Sign-in works',
    '2. Sessions persist',
    '', '### Phase 04: API', '**Goal:** REST surface.', '',
    '### Phase 05: UI', '**Goal:** Screens.', '',
  ].join('\n'));
  // 01 complete, prefixed multi-segment ids
  W('.planning/phases/01-scaffold/01-01-plan.md', '---\nwave: 1\nrequirements: [R1, R2]\n---\n# p');
  W('.planning/phases/01-scaffold/01-01-summary.md', '---\nsubsystem: scaffold\nkey-files:\n  created: [src/index.ts]\nrequirements-completed: [R1, R2]\nduration: 1.2h\n---\n# s');
  // 02 complete, BARE plan.md / summary.md
  W('.planning/phases/02-data-layer/plan.md', '---\nrequirements: [R3]\n---\n# p');
  W('.planning/phases/02-data-layer/summary.md', '---\nsubsystem: data\nkey-files:\n  created: [src/db.ts]\n  modified: [src/index.ts]\nrequirements-completed: [R3]\n---\n# s');
  // 03 complete by counts but verification found gaps + one open requirement
  W('.planning/phases/03-auth-sessions/03-01-plan.md', '---\nwave: 1\nrequirements: [R4, R5, R6]\n---\n# p');
  W('.planning/phases/03-auth-sessions/03-01-summary.md', '---\nsubsystem: auth\nkey-files:\n  created: [src/auth/session.ts]\nkey-decisions:\n  - Argon2id\nrequirements-completed: [R4, R5]\nduration: 2.4h\n---\n# s');
  W('.planning/phases/03-auth-sessions/03-verification.md', [
    '---', 'status: gaps_found', '---', '# Verification',
    'TEST_TOTAL: 128', 'TEST_PASSED: 127', 'TEST_FAILED: 1', 'score: 82',
    '', '## Gaps', '- Rate limiting missing', '', '## Anti-patterns', '- none',
  ].join('\n'));
  // 04 planned only (slug plan), 05 researched only
  W('.planning/phases/04-api/04-rest-surface-plan.md', '---\nrequirements: [R7]\n---\n# p');
  W('.planning/phases/05-ui/05-research.md', '# research');
}

describe('phase-report — collectPhaseData', () => {
  test('reads prefixed, bare, and slug artifact forms; derives per-phase data', () => {
    scaffold();
    const d1 = pr.collectPhaseData(cwd, '1', { now: NOW });
    assert.equal(d1.phase.number, '01');
    assert.equal(d1.phase.slug, '01-scaffold');
    assert.equal(d1.counts.plans, 1);
    assert.equal(d1.counts.plansDone, 1);
    assert.equal(d1.status, 'complete');

    const d2 = pr.collectPhaseData(cwd, '2', { now: NOW });
    assert.equal(d2.counts.plans, 1, 'bare plan.md counted');
    assert.equal(d2.counts.summaries, 1, 'bare summary.md counted');
    assert.equal(d2.status, 'complete');

    const d4 = pr.collectPhaseData(cwd, '4', { now: NOW });
    assert.equal(d4.counts.plans, 1, 'slug plan counted');
    assert.equal(d4.status, 'planned');
    assert.equal(d4.pipeline.stage, 'queued');
  });

  test('per-phase requirements are DERIVED from plan + summary frontmatter (not the global count)', () => {
    scaffold();
    const d3 = pr.collectPhaseData(cwd, '3', { now: NOW });
    const byId = Object.fromEntries(d3.requirements.map(r => [r.id, r.done]));
    assert.deepEqual(byId, { R4: true, R5: true, R6: false }, 'R6 declared but not completed → open');
  });

  test('status/stage snapshot cases (complete after summaries; researched with zero plans)', () => {
    scaffold();
    assert.equal(pr.collectPhaseData(cwd, '5', { now: NOW }).status, 'researched');
    assert.equal(pr.collectPhaseData(cwd, '5', { now: NOW }).pipeline.stage, 'plan');
    // plansDone never exceeds plans
    const d3 = pr.collectPhaseData(cwd, '3', { now: NOW });
    assert.ok(d3.counts.plansDone <= d3.counts.plans);
  });

  test('verification is detected PER DIRECTORY, not last-wins across phases', () => {
    scaffold();
    // Only phase 03 has a verification.md — phase 01 must report none.
    assert.equal(pr.collectPhaseData(cwd, '1', { now: NOW }).verification, null, 'phase 1 has no verification');
    const v3 = pr.collectPhaseData(cwd, '3', { now: NOW }).verification;
    assert.equal(v3.status, 'gaps_found');
    assert.equal(v3.test_gate.total, 128);
    assert.equal(v3.test_gate.failed, 1);
    assert.equal(v3.score, 82);
    assert.deepEqual(v3.gaps, ['Rate limiting missing']);
  });

  test('missing phase → null; empty phase does not throw', () => {
    scaffold();
    assert.equal(pr.collectPhaseData(cwd, '99', { now: NOW }), null);
    W('.planning/phases/06-empty/.keep', '');
    const d6 = pr.collectPhaseData(cwd, '6', { now: NOW });
    assert.equal(d6.status, 'empty');
    assert.doesNotThrow(() => pr.renderPhaseHtml(d6));
  });
});

describe('phase-report — renderPhaseHtml', () => {
  test('self-contained document — no network, no external assets', () => {
    scaffold();
    const html = pr.renderPhaseHtml(pr.collectPhaseData(cwd, '3', { now: NOW }));
    assert.match(html, /^<!DOCTYPE html>/);
    assert.ok(!/https?:\/\//.test(html), 'no absolute URLs');
    assert.ok(!/<script/i.test(html), 'no scripts');
    assert.ok(!/\ssrc=/.test(html), 'no external src=');
    assert.match(html, /self-contained snapshot/);
  });

  test('shows the reconcile verdict BESIDE the self-reported status (never status alone)', () => {
    scaffold();
    const html = pr.renderPhaseHtml(pr.collectPhaseData(cwd, '3', { now: NOW }));
    assert.match(html, /Self-reported/);
    assert.match(html, /gaps_found/);
    assert.match(html, /verify reconcile/);
  });

  test('escapes project-derived text (XSS-safe) in goal, subsystem, and gaps', () => {
    scaffold();
    W('.planning/roadmap.md', fs.readFileSync(path.join(cwd, '.planning/roadmap.md'), 'utf-8')
      .replace('Password + OAuth sign-in.', 'Ship <img src=x onerror=alert(1)> auth'));
    W('.planning/phases/03-auth-sessions/03-01-summary.md',
      fs.readFileSync(path.join(cwd, '.planning/phases/03-auth-sessions/03-01-summary.md'), 'utf-8')
        .replace('subsystem: auth', 'subsystem: "auth<script>bad</script>"'));
    const html = pr.renderPhaseHtml(pr.collectPhaseData(cwd, '3', { now: NOW }));
    assert.ok(!/<img src=x onerror/.test(html), 'goal payload not raw');
    assert.match(html, /&lt;img src=x onerror/);
    assert.ok(!/<script>bad<\/script>/.test(html), 'subsystem payload not raw');
  });

  test('a phase with no verification renders an honest "not verified yet"', () => {
    scaffold();
    const html = pr.renderPhaseHtml(pr.collectPhaseData(cwd, '1', { now: NOW }));
    assert.match(html, /Not verified yet/);
  });
});

describe('phase-report — collectIndexData + renderIndexHtml', () => {
  test('index aggregates phases and gates spend through ledgerReliability', () => {
    scaffold();
    const d = pr.collectIndexData(cwd, { now: NOW });
    assert.equal(d.aggregate.total, 5);
    assert.equal(d.aggregate.complete, 3);
    assert.ok(d.aggregate.in_flight >= 1);
    const html = pr.renderIndexHtml(d);
    assert.match(html, /acme-platform/);
    assert.equal((html.match(/class="tcard"/g) || []).length, 5, 'one timeline row per phase');
    // empty ledger → spend reliable but $0.00 is genuine here (no records). Ensure no crash + a $ or —.
    assert.ok(/Spend/.test(html));
  });

  test('unreliable ledger shows — not a fabricated $0 in the index', () => {
    scaffold();
    // poison the ledger: all records unpriced (unknown model) → cost_unknown === calls
    const recs = [];
    for (let i = 0; i < 4; i++) recs.push(JSON.stringify({ ts: '2026-07-01T00:00:00Z', agent: 'pan-planner', model: 'mystery-x', input_tokens: 1000, output_tokens: 200 }));
    W('.planning/metrics/tokens.jsonl', recs.join('\n') + '\n');
    const d = pr.collectIndexData(cwd, { now: NOW });
    assert.equal(d.aggregate.spend.reliable, false);
    const html = pr.renderIndexHtml(d);
    assert.match(html, /ledger n\/a/);
    assert.ok(!/\$0\.00/.test(html), 'no fake $0.00 spend');
  });

  test('phase-less project → collectIndexData returns null', () => {
    W('.planning/focus/design-1.md', '# d'); // focus-auto layout, no phases
    assert.equal(pr.collectIndexData(cwd, { now: NOW }), null);
  });
});

describe('phase-report — determinism (no-op writes)', () => {
  test('renderPhaseHtml differs only by the timestamp; stripVolatile makes it stable', () => {
    scaffold();
    const a = pr.renderPhaseHtml(pr.collectPhaseData(cwd, '3', { now: new Date('2026-07-12T12:00:00Z') }));
    const b = pr.renderPhaseHtml(pr.collectPhaseData(cwd, '3', { now: new Date('2026-08-01T09:30:00Z') }));
    assert.notEqual(a, b, 'raw output carries the timestamp');
    assert.equal(pr.stripVolatile(a), pr.stripVolatile(b), 'timestamp-free bodies are identical');
  });
});

describe('phase-report — cmdReport via dispatcher', () => {
  test('report phase <N> writes NN-report.html as a sibling of verification.md', () => {
    scaffold();
    const r = runPanTools('report phase 3', cwd);
    assert.equal(r.success, true, r.error);
    const out = path.join(cwd, '.planning', 'phases', '03-auth-sessions', '03-report.html');
    assert.ok(fs.existsSync(out), 'NN-report.html written');
    assert.match(fs.readFileSync(out, 'utf-8'), /<!DOCTYPE html>/);
    assert.match(r.output, /03-report\.html/);
  });

  test('report phase --stdout prints HTML and writes nothing', () => {
    scaffold();
    const r = runPanTools('report phase 3 --stdout', cwd);
    assert.equal(r.success, true, r.error);
    assert.match(r.output, /<!DOCTYPE html>/);
    assert.ok(!fs.existsSync(path.join(cwd, '.planning', 'phases', '03-auth-sessions', '03-report.html')));
  });

  test('report phase --out writes to a custom path', () => {
    scaffold();
    const r = runPanTools('report phase 1 --out reports/p1.html', cwd);
    assert.equal(r.success, true, r.error);
    assert.ok(fs.existsSync(path.join(cwd, 'reports', 'p1.html')));
  });

  test('report index writes report-index.html with a link to every phase report', () => {
    scaffold();
    const r = runPanTools('report index', cwd);
    assert.equal(r.success, true, r.error);
    const out = path.join(cwd, '.planning', 'report-index.html');
    assert.ok(fs.existsSync(out));
    assert.match(fs.readFileSync(out, 'utf-8'), /phases\/03-auth-sessions\/03-report\.html/);
  });

  test('report all generates every phase report + index, and all index links resolve on disk', () => {
    scaffold();
    const r = runPanTools('report all', cwd);
    assert.equal(r.success, true, r.error);
    const index = fs.readFileSync(path.join(cwd, '.planning', 'report-index.html'), 'utf-8');
    const hrefs = [...index.matchAll(/href="(phases\/[^"]+\.html)"/g)].map(m => m[1]);
    assert.ok(hrefs.length >= 4, 'index links to the phase reports');
    for (const href of hrefs) {
      const target = path.join(cwd, '.planning', decodeURIComponent(href));
      assert.ok(fs.existsSync(target), `index link resolves: ${href}`);
    }
  });

  test('re-running report phase does not rewrite unchanged output (deterministic)', () => {
    scaffold();
    runPanTools('report phase 3', cwd);
    const out = path.join(cwd, '.planning', 'phases', '03-auth-sessions', '03-report.html');
    const mtime1 = fs.statSync(out).mtimeMs;
    const r = runPanTools('report phase 3', cwd);
    assert.equal(r.success, true, r.error);
    assert.match(r.output, /"written":\s*false/);
    assert.equal(fs.statSync(out).mtimeMs, mtime1, 'file not rewritten when data unchanged');
  });

  test('report index on a phase-less project exits with a helpful message', () => {
    W('.planning/focus/design-1.md', '# d');
    const r = runPanTools('report index', cwd);
    assert.equal(r.success, false);
    assert.match(r.error + r.output, /phase-less|focus-auto|hud/i);
  });

  test('report phase for a missing phase errors clearly', () => {
    scaffold();
    const r = runPanTools('report phase 99', cwd);
    assert.equal(r.success, false);
    assert.match(r.error + r.output, /not found/i);
  });
});

describe('phase-report — security barrier parity with hud.cjs', () => {
  test('openInBrowser allowlist regex is byte-identical to hud.cjs (CodeQL barrier must not diverge)', () => {
    const hudSrc = fs.readFileSync(path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib', 'hud.cjs'), 'utf-8');
    const prSrc = fs.readFileSync(path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib', 'phase-report.cjs'), 'utf-8');
    const RE = /if \(!\/\^\[A-Za-z0-9 _\.:\\\\\/\(\)-\]\+\$\/\.test\(resolved\)\) return false;/;
    assert.ok(RE.test(hudSrc), 'allowlist barrier present in hud.cjs');
    assert.ok(RE.test(prSrc), 'allowlist barrier present, byte-identical, in phase-report.cjs');
    // and the same shell-free opener invocation
    assert.ok(hudSrc.includes("execFileSync('cmd', ['/c', 'start', '', resolved]"), 'hud uses shell-free opener');
    assert.ok(prSrc.includes("execFileSync('cmd', ['/c', 'start', '', resolved]"), 'phase-report uses shell-free opener');
  });
});
