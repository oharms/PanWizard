// Field report after 3.42.0 (items 1-5):
//   1. PAN could only tick a requirement; reopening one meant editing the checkbox
//      and the traceability row by hand. `requirements reopen` does both and says why.
//   2. `phase complete` ticked every requirement its roadmap line names, even one
//      ruled to stay open or moved to another phase. A Held / Reopened Status now
//      outranks the roadmap line, in `phase complete`, in `requirements
//      mark-complete` (the executor calls it after every plan) and in the health
//      repair that ticks boxes.
//   3. state.md recorded completed_phases above total_phases; health now names that
//      and its repair recounts.
//   4. `pan-tools test run --help` started the test suite.
//   5. A 3.27.0 patch backup was reported on every install since.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPanTools, createTempProject, cleanup, gateOff } = require('./helpers.cjs');
const ms = require('../pan-wizard-core/bin/lib/milestone.cjs');
const lib = require('../bin/install-lib.cjs');

const ROADMAP = [
  '# Roadmap', '',
  '## Phases', '',
  '- [ ] **Phase 5: Pay** - payments',
  '- [ ] **Phase 7: Data** - data', '',
  '## Phase Details', '',
  '### Phase 5: Pay',
  '**Goal:** Users can pay',
  '**Requirements:** PAY-01, PAY-02, PAY-03',
  '**Plans:** 1 plans', '',
  '### Phase 7: Data',
  '**Goal:** Real data',
  '**Requirements:** None',
  '**Plans:** 1 plans', '',
].join('\n');

const REQUIREMENTS = [
  '# Requirements', '',
  '- [x] **PAY-01**: pay one',
  '- [ ] **PAY-02**: pay two',
  '- [ ] **PAY-03**: pay three', '',
  '## Traceability', '',
  '| Requirement | Phase | Status |',
  '|-------------|-------|--------|',
  '| PAY-01 | Phase 5 | Complete |',
  '| PAY-02 | Phase 5 | Pending |',
  '| PAY-03 | Phase 5 | Pending |', '',
].join('\n');

function write(tmp, rel, text) {
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), text);
}
const read = (tmp, rel) => fs.readFileSync(path.join(tmp, rel), 'utf8');

function seed(tmp) {
  write(tmp, '.planning/roadmap.md', ROADMAP);
  write(tmp, '.planning/requirements.md', REQUIREMENTS);
  write(tmp, '.planning/state.md', '# State\n\n**Current Phase:** 5\n');
  for (const n of ['05-pay', '07-data']) {
    const p = n.slice(0, 2);
    write(tmp, `.planning/phases/${n}/${p}-01-plan.md`, `---\nphase: ${n}\nplan: 01\n---\n# Plan\n`);
    write(tmp, `.planning/phases/${n}/${p}-01-summary.md`, `---\nphase: ${n}\nplan: 01\n---\n# Summary\n`);
  }
}

describe('requirements reopen', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); seed(tmp); gateOff(tmp); });
  afterEach(() => cleanup(tmp));

  test('--phase unticks the box, records the reason, moves the Phase cell and lists the id under the new phase', () => {
    const r = runPanTools('requirements reopen PAY-01 --phase 7 --reason "needs real data"', tmp);
    assert.ok(r.success, r.error);
    const out = JSON.parse(r.output);
    assert.deepEqual(out.reopened, ['PAY-01']);
    assert.deepEqual(out.unchecked, ['PAY-01']);
    assert.deepEqual(out.roadmap_updated, ['PAY-01']);
    const req = read(tmp, '.planning/requirements.md');
    assert.match(req, /^- \[ \] \*\*PAY-01\*\*/m);
    assert.match(req, /^\| PAY-01 \| Phase 7 \| Reopened: needs real data \|$/m);
    const roadmap = read(tmp, '.planning/roadmap.md');
    assert.match(roadmap, /### Phase 7: Data\n\*\*Goal:\*\* Real data\n\*\*Requirements:\*\* PAY-01\n/);
    assert.match(roadmap, /\*\*Requirements:\*\* PAY-01, PAY-02, PAY-03/, 'phase 5\'s line is history and stays');
  });

  test('--hold records Held, and a pipe in the reason cannot break the table', () => {
    const r = runPanTools('requirements reopen PAY-02 --hold --reason "client | ruling"', tmp);
    assert.ok(r.success, r.error);
    assert.match(read(tmp, '.planning/requirements.md'), /^\| PAY-02 \| Phase 5 \| Held: client \/ ruling \|$/m);
  });

  test('without --reason it refuses and writes nothing', () => {
    const r = runPanTools('requirements reopen PAY-01 --phase 7', tmp);
    assert.equal(r.success, false);
    assert.match(r.error, /--reason is required/);
    assert.equal(read(tmp, '.planning/requirements.md'), REQUIREMENTS);
    assert.equal(read(tmp, '.planning/roadmap.md'), ROADMAP);
  });

  test('an unknown id exits non-zero with requirement_not_found', () => {
    const r = runPanTools('requirements reopen NOPE-9 --reason x', tmp);
    assert.equal(r.success, false);
    assert.equal(JSON.parse(r.output).error, 'requirement_not_found');
    assert.equal(read(tmp, '.planning/requirements.md'), REQUIREMENTS);
  });

  test('a phase with no roadmap section is a warning, not a silent success', () => {
    const r = runPanTools('requirements reopen PAY-01 --phase 9 --reason later', tmp);
    assert.ok(r.success, r.error);
    const out = JSON.parse(r.output);
    assert.deepEqual(out.roadmap_updated, []);
    assert.ok(out.warnings.some((w) => /phase 9 has no section/.test(w)), out.warnings.join('\n'));
  });
});

describe('phase complete respects a hold or a move', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); seed(tmp); gateOff(tmp); });
  afterEach(() => cleanup(tmp));

  test('a Held requirement stays open and is reported; the others are ticked', () => {
    assert.ok(runPanTools('requirements reopen PAY-02 --hold --reason "client ruling"', tmp).success);
    const r = runPanTools('phase complete 5 --no-commit', tmp);
    assert.ok(r.success, r.error);
    const out = JSON.parse(r.output);
    assert.deepEqual(out.requirements_held.map((h) => [h.id, h.status]), [['PAY-02', 'on_hold']]);
    const req = read(tmp, '.planning/requirements.md');
    assert.match(req, /^- \[ \] \*\*PAY-02\*\*/m);
    assert.match(req, /^\| PAY-02 \| Phase 5 \| Held: client ruling \|$/m);
    assert.match(req, /^- \[x\] \*\*PAY-03\*\*/m);
  });

  test('a requirement reopened onto phase 7 is not ticked by phase 5, and is by phase 7', () => {
    assert.ok(runPanTools('requirements reopen PAY-03 --phase 7 --reason "needs data"', tmp).success);
    const five = JSON.parse(runPanTools('phase complete 5 --no-commit', tmp).output);
    assert.deepEqual(five.requirements_held.map((h) => [h.id, h.status]), [['PAY-03', 'moved']]);
    assert.match(read(tmp, '.planning/requirements.md'), /^- \[ \] \*\*PAY-03\*\*/m);
    const seven = runPanTools('phase complete 7 --no-commit', tmp);
    assert.ok(seven.success, seven.error);
    const req = read(tmp, '.planning/requirements.md');
    assert.match(req, /^- \[x\] \*\*PAY-03\*\*/m);
    assert.match(req, /^\| PAY-03 \| Phase 7 \| Complete +\|$/m);
  });

  test('completing the phase a reopened id moved to ticks it even when its roadmap line does not name it', () => {
    write(tmp, '.planning/requirements.md', REQUIREMENTS.replace('| PAY-03 | Phase 5 | Pending |', '| PAY-03 | Phase 7 | Reopened: by hand |'));
    assert.ok(runPanTools('phase complete 7 --no-commit', tmp).success);
    assert.match(read(tmp, '.planning/requirements.md'), /^- \[x\] \*\*PAY-03\*\*/m);
  });
});

describe('a Held ruling survives the executor and the health repair', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); seed(tmp); gateOff(tmp); });
  afterEach(() => cleanup(tmp));

  test('requirements mark-complete skips a Held id and --release ticks it', () => {
    assert.ok(runPanTools('requirements reopen PAY-02 --hold --reason wait', tmp).success);
    const skipped = JSON.parse(runPanTools('requirements mark-complete PAY-02,PAY-03', tmp).output);
    assert.deepEqual(skipped.marked_complete, ['PAY-03']);
    assert.deepEqual(skipped.held.map((h) => h.id), ['PAY-02']);
    assert.match(read(tmp, '.planning/requirements.md'), /^- \[ \] \*\*PAY-02\*\*/m);
    const released = JSON.parse(runPanTools('requirements mark-complete PAY-02 --release', tmp).output);
    assert.deepEqual(released.marked_complete, ['PAY-02']);
    assert.match(read(tmp, '.planning/requirements.md'), /^\| PAY-02 \| Phase 5 \| Complete +\|$/m);
  });

  test('the --repair requirements sync never ticks over a hold', () => {
    const { syncRequirementCheckboxes } = require('../pan-wizard-core/bin/lib/verify.cjs');
    assert.ok(runPanTools('requirements reopen PAY-02 --hold --reason wait', tmp).success);
    write(tmp, '.planning/roadmap.md', ROADMAP.replace('- [ ] **Phase 5: Pay**', '- [x] **Phase 5: Pay**'));
    assert.equal(syncRequirementCheckboxes(tmp).fixed, 1);
    const req = read(tmp, '.planning/requirements.md');
    assert.match(req, /^- \[ \] \*\*PAY-02\*\*/m);
    assert.match(req, /^- \[x\] \*\*PAY-03\*\*/m);
  });
});

describe('hold rules (pure)', () => {
  const table = (rows) => ['| Requirement | Phase | Status |', '|---|---|---|', ...rows].join('\n');

  test('Held, On hold, Deferred and Blocked all hold, in any case', () => {
    for (const s of ['Held: x', 'on hold', 'Deferred to v2', 'BLOCKED']) {
      const h = ms.requirementHolds(table([`| A-1 | Phase 3 | ${s} |`]));
      assert.equal(ms.completionHold(h, 'a-1', '3').reason, 'on_hold', s);
    }
  });

  test('Pending and Complete are not rulings', () => {
    const h = ms.requirementHolds(table(['| A-1 | Phase 3 | Pending |', '| A-2 | Phase 3 | Complete |']));
    assert.equal(h.size, 0);
  });

  test('a reopened row naming a range is never read as a move', () => {
    const h = ms.requirementHolds(table(['| A-1 | Phase 3-5 | Reopened: x |']));
    assert.equal(ms.completionHold(h, 'A-1', '03'), null);
  });

  test('padded and decimal phase numbers compare as numbers', () => {
    const h = ms.requirementHolds(table(['| A-1 | Phase 07 | Reopened: x |', '| A-2 | 29.4 | Moved |']));
    assert.equal(ms.completionHold(h, 'A-1', '7'), null);
    assert.equal(ms.completionHold(h, 'A-1', '6').reason, 'moved');
    assert.deepEqual(ms.reopenedForPhase(h, '29.4'), ['A-2']);
  });
});

describe('impossible progress counts in state.md', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); seed(tmp); });
  afterEach(() => cleanup(tmp));

  const STATE = [
    '---', 'pan_state_version: \'1.0\'', 'progress:', '  total_phases: 6', '  completed_phases: 51',
    '  total_plans: 2', '  completed_plans: 2', '  percent: 99', 'notes: keep me', '---', '', '# State', '',
    '**Current Phase:** 5', '**Progress:** [##########] 99%', '',
  ].join('\n');

  test('health names STATE_PROGRESS_IMPOSSIBLE and its repair recounts only progress.*', () => {
    write(tmp, '.planning/state.md', STATE);
    const before = JSON.parse(runPanTools('validate health', tmp).output);
    assert.ok(before.warnings.some((w) => w.code === 'STATE_PROGRESS_IMPOSSIBLE'), JSON.stringify(before.warnings));
    assert.ok(before.repairs_available.includes('recountProgress'));
    runPanTools('validate health --repair --only recountProgress', tmp);
    const after = read(tmp, '.planning/state.md');
    assert.match(after, /total_phases: 2\b/);
    assert.match(after, /completed_phases: 2\b/);
    assert.match(after, /notes: keep me/);
    assert.match(after, /\*\*Progress:\*\* \[##########\] 99%/, 'the body is not rewritten');
  });
});

describe('<command> --help runs nothing', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); seed(tmp); });
  afterEach(() => cleanup(tmp));

  test('test run --help prints the usage and starts no test run', () => {
    write(tmp, 'package.json', JSON.stringify({ scripts: { test: 'node -e "require(\'fs\').writeFileSync(\'RAN\', \'1\')"' } }));
    const r = runPanTools('test run --phase 5 --help', tmp);
    assert.ok(r.success, r.error);
    assert.match(r.output, /Usage \(pan-tools test run\)/);
    assert.match(r.output, /Nothing was run/);
    assert.equal(fs.existsSync(path.join(tmp, 'RAN')), false);
    assert.deepEqual(fs.readdirSync(path.join(tmp, '.planning', 'phases', '05-pay')).sort(), ['05-01-plan.md', '05-01-summary.md']);
  });

  test('a writer given --help writes nothing', () => {
    const r = runPanTools('requirements reopen PAY-01 --reason x --help', tmp);
    assert.ok(r.success, r.error);
    assert.match(r.output, /requirements reopen <ids> --reason R/);
    assert.equal(read(tmp, '.planning/requirements.md'), REQUIREMENTS);
  });
});

describe('patch backups (classifyPatchBackups)', () => {
  const bufs = (map) => (rel) => (rel in map ? Buffer.from(map[rel]) : null);

  test('a backup the installed version already matches, line endings aside, is resolved', () => {
    const meta = { files: ['commands/pan/a.md', 'agents/b.md'] };
    const r = lib.classifyPatchBackups(meta,
      bufs({ 'commands/pan/a.md': 'x\r\ny\r\n', 'agents/b.md': 'mine' }),
      bufs({ 'commands/pan/a.md': 'x\ny\n', 'agents/b.md': 'upstream' }), { savedThisRun: false });
    assert.deepEqual(r, { resolved: ['commands/pan/a.md'], pending: ['agents/b.md'], stale: true });
  });

  test('a backup made by this run is not stale; an external file is read through external_files', () => {
    const meta = { files: ['../.agents/skills/s.md'], external_files: { '../.agents/skills/s.md': '_external/.agents/skills/s.md' } };
    const r = lib.classifyPatchBackups(meta,
      bufs({ '_external/.agents/skills/s.md': 'mine' }), bufs({ '../.agents/skills/s.md': 'new' }), { savedThisRun: true });
    assert.deepEqual(r, { resolved: [], pending: ['../.agents/skills/s.md'], stale: false });
  });
});

describe('installer: an old patch backup', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-patches-')); });
  afterEach(() => cleanup(dir));

  const install = () => require('child_process').execFileSync(process.execPath,
    [path.join(__dirname, '..', 'bin', 'install.js'), '--claude', '--local'],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PAN_NO_UPDATE_CHECK: '1' } });

  test('is cleared when its changes are already in this version, and reported as old when they are not', () => {
    install();
    const patches = path.join(dir, '.claude', 'pan-local-patches');
    const installed = (rel) => fs.readFileSync(path.join(dir, '.claude', rel));
    fs.mkdirSync(path.join(patches, 'commands', 'pan'), { recursive: true });
    fs.writeFileSync(path.join(patches, 'commands', 'pan', 'help.md'), installed('commands/pan/help.md'));
    fs.writeFileSync(path.join(patches, 'commands', 'pan', 'patches.md'), 'an edit from long ago\n');
    fs.writeFileSync(path.join(patches, 'backup-meta.json'), JSON.stringify({
      backed_up_at: '2026-06-01T00:00:00.000Z', from_version: '3.27.0', files: ['commands/pan/help.md', 'commands/pan/patches.md'],
    }));

    const out = install();
    assert.match(out, /Old patch backup/);
    assert.doesNotMatch(out, /Run \S*\/pan:patches\S* to merge them/);
    const meta = JSON.parse(fs.readFileSync(path.join(patches, 'backup-meta.json'), 'utf8'));
    assert.deepEqual(meta.files, ['commands/pan/patches.md']);
    assert.equal(meta.stale, true);
    assert.equal(fs.existsSync(path.join(patches, 'commands', 'pan', 'help.md')), false);

    fs.writeFileSync(path.join(patches, 'commands', 'pan', 'patches.md'), installed('commands/pan/patches.md'));
    const out2 = install();
    assert.match(out2, /Cleared the patch backup from v3\.27\.0/);
    assert.equal(fs.existsSync(patches), false);
  });
});
