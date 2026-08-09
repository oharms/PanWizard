/**
 * PAN Tools Tests — auto-advance stop guard hook (P-1809)
 *
 * The Stop hook is the mechanical answer to the P-1801/P-1807 boundary drop:
 * prose gates got the autonomous chain from 0/5 to 6/7 complete builds, and the
 * residual failure is the orchestrator ending its turn between transition.md's
 * state update and the Route A Task spawn. This hook blocks that stop once,
 * with instructions, when the disk carries the exact drop fingerprint.
 *
 * The decision matrix is tested on the exported pure function; two spawn tests
 * pin the stdin wiring and the fail-open contract end to end.
 *
 * Fixture doctrine: the roadmap checklist lines below are copied from
 * pan-wizard-core/templates/roadmap.md's emitted shape (`- [ ] **Phase N: ...`),
 * and a template-shape test pins the hook's regex against the SHIPPED template
 * so the two cannot drift apart silently.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildStopDecision, UNTICKED_PHASE_RE } = require('../hooks/pan-stop-guard.js');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'pan-stop-guard.js');
const TEMPLATE_ROADMAP = path.join(__dirname, '..', 'pan-wizard-core', 'templates', 'roadmap.md');

// ─── Canonical fixtures (shapes from the shipped templates) ─────────────────

const ARMED_CONFIG = { mode: 'interactive', workflow: { auto_advance: true } };

const READY_STATE = [
  '# Project State',
  '',
  '**Current Phase:** 02',
  '**Status:** Ready to plan',
  '**Total Phases:** 3',
  '',
  'Stopped at: Phase 1 complete, ready to plan Phase 2',
  '',
].join('\n');

const PARTIAL_ROADMAP = [
  '# Roadmap v1.0 MVP',
  '',
  '- [x] **Phase 1: Scaffold** - Package skeleton',
  '- [ ] **Phase 2: Core** - The real work',
  '- [ ] **Phase 3: Polish** - Docs and types',
  '',
].join('\n');

const COMPLETE_ROADMAP = PARTIAL_ROADMAP.replace(/- \[ \]/g, '- [x]');

function decide(overrides = {}) {
  return buildStopDecision({
    stopHookActive: false,
    config: ARMED_CONFIG,
    stateContent: READY_STATE,
    roadmapContent: PARTIAL_ROADMAP,
    ...overrides,
  });
}

describe('buildStopDecision — the boundary-drop fingerprint blocks, everything else allows', () => {
  test('armed config + ready state + unbuilt phases → block, naming the next phase', () => {
    // REVERT CHECK: this is the hook's reason to exist — the exact disk state
    // every dropped run left behind (PanLoop findings, 2026-08).
    const d = decide();
    assert.ok(d, 'expected a block decision');
    assert.equal(d.decision, 'block');
    assert.match(d.reason, /Phase 2/, 'reason should name the next unbuilt phase');
    assert.match(d.reason, /Task/, 'reason should instruct a Task spawn');
    assert.match(d.reason, /auto_advance false/, 'reason should give the opt-out for a deliberate stop');
  });

  test('stop_hook_active → allow (one-shot: a post-block stop is never re-blocked)', () => {
    assert.equal(decide({ stopHookActive: true }), null);
  });

  test('no autonomy signal on disk → allow', () => {
    assert.equal(decide({ config: { workflow: { auto_advance: false } } }), null);
    assert.equal(decide({ config: { workflow: {} } }), null);
    assert.equal(decide({ config: { mode: 'interactive', workflow: { auto_advance: false } } }), null);
    assert.equal(decide({ config: { workflow: { auto_advance: 'true' } } }), null, 'strict boolean only');
  });

  test('mode: yolo arms the guard even with auto_advance false (P-1810)', () => {
    // REVERT CHECK — PanLoop finding 7: base64url dropped at the boundary with
    // mode yolo + auto_advance false, and the config-only arming left the
    // guard dark on the exact failure it was built for. Yolo is a disk-visible
    // autonomy signal and must arm.
    const d = decide({ config: { mode: 'yolo', workflow: { auto_advance: false } } });
    assert.ok(d, 'yolo must arm the guard');
    assert.equal(d.decision, 'block');

    const noWorkflow = decide({ config: { mode: 'yolo' } });
    assert.ok(noWorkflow, 'yolo arms even when config has no workflow object');
  });

  test('workflow.stop_guard false → allow (escape hatch beats every arming signal)', () => {
    assert.equal(
      decide({ config: { workflow: { auto_advance: true, stop_guard: false } } }),
      null
    );
    assert.equal(
      decide({ config: { mode: 'yolo', workflow: { stop_guard: false } } }),
      null,
      'the escape hatch must also beat yolo arming'
    );
  });

  test('a completed-but-unticked earlier phase does not misdirect the reason (finding 8 interaction)', () => {
    // Phase 1 is DONE but its checkbox was missed; state says plan Phase 2.
    // First-unticked would name Phase 1 — the reason must follow state.
    const staleRoadmap = [
      '- [ ] **Phase 1: Scaffold** - done but the tick was lost',
      '- [ ] **Phase 2: Core** - not built',
    ].join('\n');
    const d = decide({ roadmapContent: staleRoadmap });
    assert.ok(d, 'guard still arms — unticked lines exist');
    assert.match(d.reason, /Phase 2/, 'state.md names the target, not the stale first-unticked line');
  });

  test('a legitimate-stop marker in state → allow (gaps, failed verification, blockers)', () => {
    // P-1812 inverted condition 2: the guard lets a stop through only when
    // state records a real reason to stop. High-precision list, behavioral.
    for (const marker of [
      'Phase 2 verification found gaps',
      'Verification failed on STOR-03',
      'BLOCKED: waiting on user decision about the schema',
      'Gaps found — see 02-verification.md',
    ]) {
      const stopped = READY_STATE
        .replace('**Status:** Ready to plan', '**Status:** In progress')
        .replace('ready to plan Phase 2', marker);
      assert.equal(decide({ stateContent: stopped }), null, `"${marker}" must allow the stop`);
    }
  });

  test('the four REAL field status phrasings decide by substance, not wording (P-1812, finding 9)', () => {
    // REVERT CHECK — PanLoop finding 9: condition 2 required the status line
    // to begin "Ready to plan"; one batch wrote four different phrasings and
    // the only run with unbuilt phases was disarmed BY WORDING ALONE
    // (semver-compare: both arming conditions satisfied, stopped at 1 of 4).
    // These are the four values verbatim from that batch, each paired with
    // the roadmap state its run actually had.
    const statusLine = (s) => READY_STATE.replace('**Status:** Ready to plan', `**Status:** ${s}`)
      .replace('Stopped at: Phase 1 complete, ready to plan Phase 2', 'Stopped at: see status');

    // Three runs completed — their roadmaps were fully ticked, so condition 3
    // excludes them regardless of phrasing.
    for (const done of ['Ready to execute', 'ALL PHASES COMPLETE', 'Milestone complete — all 27 v1 requirements delivered']) {
      assert.equal(
        decide({ stateContent: statusLine(done), roadmapContent: COMPLETE_ROADMAP }),
        null,
        `"${done}" with a ticked roadmap must allow`
      );
    }

    // semver-compare: unrecognised phrasing + three unbuilt phases. This is
    // the exact disk state that was wrongly allowed before P-1812.
    const d = decide({
      stateContent: statusLine('Phase 1 complete and verified; Phase 2 planning pending'),
    });
    assert.ok(d, 'an unrecognised status with unbuilt phases must ARM the guard (fail-safe)');
    assert.equal(d.decision, 'block');
    assert.match(d.reason, /Phase 2/, 'first unticked phase names the target when state has no ready-to-plan capture');
  });

  test('every phase ticked → allow (the chain finished; Route B also clears auto_advance)', () => {
    assert.equal(decide({ roadmapContent: COMPLETE_ROADMAP }), null);
  });

  test('missing config, state, or roadmap → allow (fail open outside PAN projects)', () => {
    assert.equal(decide({ config: null }), null);
    assert.equal(decide({ stateContent: null }), null);
    assert.equal(decide({ roadmapContent: null }), null);
  });

  test('decimal insert phases (01.1) are recognized as unbuilt work', () => {
    // State and roadmap agree on the decimal phase — both the roadmap detector
    // and the state-derived phase extraction must handle "1.1".
    const withDecimal = '- [x] **Phase 1: A** - x\n- [ ] **Phase 1.1: Hotfix** - y\n';
    const decimalState = READY_STATE
      .replace('**Current Phase:** 02', '**Current Phase:** 01.1')
      .replace('**Status:** Ready to plan', '**Status:** Ready to plan')
      .replace('ready to plan Phase 2', 'ready to plan Phase 1.1');
    const d = decide({ roadmapContent: withDecimal, stateContent: decimalState });
    assert.ok(d, 'decimal phase should still block');
    assert.match(d.reason, /Phase 1\.1/);
  });
});

describe('the unticked-phase regex matches the SHIPPED template shape', () => {
  test('templates/roadmap.md checklist lines are matched as-is', () => {
    // Fixture-from-emitted-output rule: if the template's checklist shape ever
    // changes, this fails before the hook silently goes blind in the field.
    const template = fs.readFileSync(TEMPLATE_ROADMAP, 'utf8');
    assert.match(
      template,
      UNTICKED_PHASE_RE,
      'the shipped roadmap template must contain a line the stop guard recognizes as an unbuilt phase'
    );
  });
});

describe('hook process end to end', () => {
  function runHook(payload, cwd) {
    return spawnSync(process.execPath, [HOOK_PATH], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      cwd,
      encoding: 'utf8',
      timeout: 15000,
    });
  }

  function seedProject(root) {
    const planning = path.join(root, '.planning');
    fs.mkdirSync(planning, { recursive: true });
    fs.writeFileSync(path.join(planning, 'config.json'), JSON.stringify(ARMED_CONFIG));
    fs.writeFileSync(path.join(planning, 'state.md'), READY_STATE);
    fs.writeFileSync(path.join(planning, 'roadmap.md'), PARTIAL_ROADMAP);
  }

  test('blocks via stdout JSON on the fingerprint, exit 0', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-stop-guard-'));
    try {
      seedProject(tmp);
      const res = runHook({ session_id: 's1', stop_hook_active: false, cwd: tmp }, tmp);
      assert.equal(res.status, 0, `hook must exit 0, got ${res.status}: ${res.stderr}`);
      const out = JSON.parse(res.stdout);
      assert.equal(out.decision, 'block');
      assert.match(out.reason, /Phase 2/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('fail-open contract: garbage stdin, and no .planning, both allow silently', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-stop-guard-'));
    try {
      // No .planning at all — a stop in a non-PAN directory.
      let res = runHook({ stop_hook_active: false, cwd: tmp }, tmp);
      assert.equal(res.status, 0);
      assert.equal(res.stdout, '', 'no decision output means the stop proceeds');

      // Unparseable stdin in a project that WOULD block — still exit 0; the
      // payload cwd is unknown so behavior must never be a crash.
      seedProject(tmp);
      res = runHook('not json{{{', tmp);
      assert.equal(res.status, 0, 'bad stdin must never crash the stop');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('stop_hook_active in the payload suppresses the block end to end', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-stop-guard-'));
    try {
      seedProject(tmp);
      const res = runHook({ stop_hook_active: true, cwd: tmp }, tmp);
      assert.equal(res.status, 0);
      assert.equal(res.stdout, '', 'second stop in the chain must pass through');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
