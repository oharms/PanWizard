// `pan-tools roadmap slice` — what work on one phase needs from roadmap.md and
// requirements.md (memory optimisation O2). The planner, checker and researcher
// were handed both whole files, and every plan's <context> named the whole
// roadmap, so executors read it too. On a 54-phase field project that was ~146k
// tokens re-read on every turn of every spawn; the slice was ~3k.

'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPanTools } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const { buildRoadmapSlice, phaseRequirementIds, phaseDependencies } = require(path.join(ROOT, 'pan-wizard-core', 'bin', 'lib', 'roadmap.cjs'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ROADMAP = [
  '# Roadmap', '',
  '## Phases', '',
  '- [x] **Phase 1: Base** — scaffolding',
  '- [x] **Phase 2: Auth** — sign-in',
  '- [~] **Phase 3: Payments** — cards',
  '- [ ] **Phase 4: Ship** — release', '',
  '## Phase Details', '',
  '### Phase 1: Base', '**Goal**: a running skeleton', '**Requirements**: BASE-01', '',
  '### Phase 2: Auth', '**Goal**: users can sign in', '**Depends on**: Phase 1', '**Requirements**: AUTH-01', '',
  '### Phase 3: Payments', '**Goal**: take card payments', '**Depends on**: Phase 1, Phase 2',
  '**Requirements**: PAY-01, PAY-02', '**Success Criteria**:', '  1. A card payment settles', '',
  '### Phase 4: Ship', '**Goal**: release', '**Depends on**: Phase 3', '**Requirements**: SHIP-01', '',
].join('\n');
const REQUIREMENTS = [
  '# Requirements', '',
  '- [x] **BASE-01**: the app starts',
  '- [x] **AUTH-01**: users sign in with email',
  '- [ ] **PAY-01**: a card payment settles',
  '  - settles within the nightly batch',
  '- [ ] **PAY-02**: refunds reverse a settlement',
  '- [ ] **SHIP-01**: the release is signed', '',
  '## Traceability', '',
  '| Requirement | Phase | Status |',
  '|-------------|-------|--------|',
  '| AUTH-01 | Phase 2 | Complete |',
  '| PAY-01 | Phase 3 | Pending |',
  '| PAY-02 | Phase 3 | Pending |', '',
].join('\n');

describe('buildRoadmapSlice', () => {
  const slice = buildRoadmapSlice({ roadmap: ROADMAP, requirements: REQUIREMENTS, phase: '03' });

  test('every phase in one line, whatever its box, with this phase marked', () => {
    assert.match(slice.content, /- \[x\] \*\*Phase 1: Base\*\* — scaffolding\n/);
    assert.match(slice.content, /- \[~\] \*\*Phase 3: Payments\*\* — cards {2}← this phase\n/);
    assert.match(slice.content, /- \[ \] \*\*Phase 4: Ship\*\* — release\n/);
  });

  test("this phase's section whole, the padded number finding the unpadded heading", () => {
    assert.equal(slice.found, true);
    assert.equal(slice.phase_number, '3');
    assert.match(slice.content, /## This phase\n\n### Phase 3: Payments\n\*\*Goal\*\*: take card payments[\s\S]*1\. A card payment settles\n/);
    assert.doesNotMatch(slice.content, /### Phase 4: Ship/, 'no other phase section');
  });

  test('the goals of the phases it depends on', () => {
    assert.deepEqual(slice.depends_on, ['1', '2']);
    assert.match(slice.content, /- \*\*Phase 1: Base\*\* — a running skeleton\n- \*\*Phase 2: Auth\*\* — users can sign in\n/);
  });

  test('its requirement lines with their detail, and its traceability rows under the table header', () => {
    assert.deepEqual(slice.requirement_ids, ['PAY-01', 'PAY-02']);
    assert.match(slice.content, /- \[ \] \*\*PAY-01\*\*: a card payment settles\n {2}- settles within the nightly batch\n- \[ \] \*\*PAY-02\*\*/);
    assert.match(slice.content, /\| Requirement \| Phase \| Status \|\n\|-+\|-+\|-+\|\n\| PAY-01 \| Phase 3 \| Pending \|\n\| PAY-02 \| Phase 3 \| Pending \|/);
    assert.doesNotMatch(slice.content, /AUTH-01|SHIP-01|BASE-01/, "no other phase's requirements");
  });

  test('much smaller than the whole files on a long roadmap', () => {
    const phases = Array.from({ length: 40 }, (_, i) => i + 1);
    const long = ['# Roadmap', '', ...phases.map((n) => `- [ ] **Phase ${n}: Part ${n}** — work`), '',
      ...phases.flatMap((n) => [`### Phase ${n}: Part ${n}`, `**Goal**: deliver part ${n}`, `**Requirements**: P-${n}`,
        ...Array.from({ length: 12 }, (_, k) => `- detail ${k} of part ${n}, written out at the length a field roadmap carries`), ''])].join('\n');
    const s = buildRoadmapSlice({ roadmap: long, requirements: phases.map((n) => `- [ ] **P-${n}**: part ${n} works`).join('\n'), phase: '20' });
    assert.ok(s.tokens < s.whole_tokens / 10, `${s.tokens} vs ${s.whole_tokens}`);
  });

  test('a phase the roadmap does not detail is not found', () => {
    assert.deepEqual(buildRoadmapSlice({ roadmap: ROADMAP, requirements: REQUIREMENTS, phase: '9' }), { found: false, phase_number: '9' });
  });

  test('no requirements.md, or a phase that names no ids, says so', () => {
    assert.match(buildRoadmapSlice({ roadmap: ROADMAP, requirements: null, phase: '3' }).content, /_There is no `\.planning\/requirements\.md`\._/);
    const none = ROADMAP.replace('**Requirements**: PAY-01, PAY-02', '**Requirements**: TBD');
    assert.match(buildRoadmapSlice({ roadmap: none, requirements: REQUIREMENTS, phase: '3' }).content, /_The roadmap names no requirement ids for this phase\._/);
  });

  test('an id the requirements file lacks is reported', () => {
    const s = buildRoadmapSlice({ roadmap: ROADMAP.replace('PAY-01, PAY-02', 'PAY-01, PAY-09'), requirements: REQUIREMENTS, phase: '3' });
    assert.deepEqual(s.missing_requirement_ids, ['PAY-09']);
    assert.match(s.content, /_Not found in requirements\.md: PAY-09\._/);
  });

  test('a CRLF roadmap slices the same as an LF one', () => {
    const crlf = buildRoadmapSlice({ roadmap: ROADMAP.replace(/\n/g, '\r\n'), requirements: REQUIREMENTS.replace(/\n/g, '\r\n'), phase: '3' });
    assert.equal(crlf.content, slice.content);
  });
});

describe('requirement ids and dependencies are read by shape', () => {
  test('ids come from a prose Requirements line, not from splitting it on commas', () => {
    // Field roadmaps write prose there; the comma split took the prose for ids.
    assert.deepEqual(phaseRequirementIds("**Requirements**: none of its own; pulled forward from v6.0's Phase 45 (`CI-01`) by the owner's ruling"), ['CI-01']);
    assert.deepEqual(phaseRequirementIds('**Requirements**: seeding (replace the seed), TEST-01 (invariants), OPS-07 (deploy)'), ['TEST-01', 'OPS-07']);
    assert.deepEqual(phaseRequirementIds('**Requirements**: [AUTH-01, AUTH-02]'), ['AUTH-01', 'AUTH-02']);
    assert.deepEqual(phaseRequirementIds('**Requirements**: R1, R2'), ['R1', 'R2']);
    assert.deepEqual(phaseRequirementIds('**Requirements**: TBD'), []);
  });

  test('dependencies are the phase numbers on the Depends on line', () => {
    assert.deepEqual(phaseDependencies('**Depends on**: Phase 2, Phase 2.1'), ['2', '2.1']);
    assert.deepEqual(phaseDependencies('**Depends on:** Phase 7 (needs a clean module boundary)'), ['7']);
    assert.deepEqual(phaseDependencies('**Depends on**: Nothing (first phase)'), []);
  });
});

describe('pan-tools roadmap slice --write', () => {
  const made = [];
  after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
  function project({ phaseDir = true, eol = '\n' } = {}) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-slice-'));
    made.push(d);
    fs.mkdirSync(path.join(d, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(d, '.planning', 'roadmap.md'), ROADMAP.replace(/\n/g, eol));
    fs.writeFileSync(path.join(d, '.planning', 'requirements.md'), REQUIREMENTS.replace(/\n/g, eol));
    if (phaseDir) fs.mkdirSync(path.join(d, '.planning', 'phases', '03-payments'), { recursive: true });
    return d;
  }

  test('writes the slice into the phase directory and prints its path', () => {
    const d = project();
    const r = runPanTools('roadmap slice 3 --write --raw', d);
    assert.ok(r.success, r.error);
    assert.equal(r.output, '.planning/phases/03-payments/03-roadmap-slice.md');
    const written = fs.readFileSync(path.join(d, r.output), 'utf8');
    assert.match(written, /^# Roadmap slice — Phase 3: Payments\n/);
    assert.equal(written, buildRoadmapSlice({ roadmap: ROADMAP, requirements: REQUIREMENTS, phase: '3' }).content);
  });

  test('a second run with nothing changed leaves the file alone', () => {
    const d = project();
    runPanTools('roadmap slice 3 --write', d);
    const r = runPanTools('roadmap slice 3 --write', d);
    assert.ok(r.success, r.error);
    const out = JSON.parse(r.output);
    assert.equal(out.written, true);
    assert.equal(out.changed, false);
  });

  test('keeps the line ending a checkout gave the slice', () => {
    const d = project({ eol: '\r\n' });
    const rel = '.planning/phases/03-payments/03-roadmap-slice.md';
    runPanTools('roadmap slice 3 --write', d);
    fs.writeFileSync(path.join(d, rel), fs.readFileSync(path.join(d, rel), 'utf8').replace(/\n/g, '\r\n'));
    const out = JSON.parse(runPanTools('roadmap slice 3 --write', d).output);
    assert.equal(out.changed, false, 'a CRLF copy of the same slice is not rewritten as LF');
  });

  test('without a phase directory it writes nothing and prints no path, so the workflow falls back', () => {
    const d = project({ phaseDir: false });
    const r = runPanTools('roadmap slice 3 --write --raw', d);
    assert.ok(r.success, r.error);
    assert.equal(r.output, '');
    assert.equal(fs.existsSync(path.join(d, '.planning', 'phases')), false);
  });

  test('without --write it prints the slice and its sizes', () => {
    const out = JSON.parse(runPanTools('roadmap slice 3', project()).output);
    assert.equal(out.found, true);
    assert.ok(out.tokens > 0 && out.tokens < out.whole_tokens, JSON.stringify(out));
    assert.match(out.content, /← this phase/);
  });
});

describe('the prompts read the slice, not the whole files', () => {
  // The blocks themselves: tags on their own line, not a prose mention of the tag.
  const filesToRead = (text) => [...text.matchAll(/^[ \t]*<files_to_read>[ \t]*$([\s\S]*?)^[ \t]*<\/files_to_read>/gm)].map((m) => m[1]).join('\n');

  test('no plan template or example plan names the whole roadmap in its <context>', () => {
    for (const rel of ['pan-wizard-core/templates/phase-prompt.md', 'pan-wizard-core/templates/planner-subagent-prompt.md', 'agents/pan-planner.md']) {
      assert.doesNotMatch(read(rel), /^@\.planning\/roadmap\.md$/m, rel);
    }
    assert.match(read('pan-wizard-core/templates/phase-prompt.md'), /^@\.planning\/phases\/XX-name\/\{phase\}-roadmap-slice\.md$/m);
  });

  test('plan-phase hands its researcher, planner and checker the slice', () => {
    const wf = read('pan-wizard-core/workflows/plan-phase.md');
    assert.match(wf, /roadmap slice "\$\{PHASE\}" --write --raw/);
    const blocks = filesToRead(wf);
    assert.doesNotMatch(blocks, /\{roadmap_path\}|\{requirements_path\}/);
    assert.equal((blocks.match(/\{slice_path\}/g) || []).length, 3);
  });

  test('the researcher reads the slice in both research entry points', () => {
    for (const rel of ['pan-wizard-core/workflows/research-phase.md', 'commands/pan/research-phase.md']) {
      const text = read(rel);
      assert.match(text, /roadmap slice "\$\{(PHASE|phase_number)\}" --write --raw/, rel);
      assert.doesNotMatch(filesToRead(text), /^- \{requirements_path\}/m, rel);
    }
  });

  test('exec-phase writes the slice and points executors of older plans at it', () => {
    const wf = read('pan-wizard-core/workflows/exec-phase.md');
    assert.match(wf, /roadmap slice "\$\{phase_number\}" --write --raw/);
    assert.match(wf, /names `@\.planning\/roadmap\.md`, read `\{slice_path\}` in its place/);
    assert.match(read('agents/pan-executor.md'), /names `@\.planning\/roadmap\.md`[\s\S]{0,200}read the slice in its place/);
  });

  test('the verifier works from get-phase and the slice, and an executor does not repair a no-op by hand', () => {
    // Found by harness markdown-exec-phase-chain on 2026-10-04: the verifier cat'ed
    // roadmap.md and requirements.md whole, and an executor read both to debug a
    // `mark-complete` that changed nothing.
    const vp = read('pan-wizard-core/workflows/verify-phase.md');
    assert.match(vp, /roadmap slice "\$\{phase_number\}" --write --raw/);
    assert.doesNotMatch(vp, /Extract \*\*phase goal\*\* from roadmap\.md/);
    assert.match(read('pan-wizard-core/workflows/exec-phase.md'), /Roadmap slice: \{slice_path\}[^\n]*Read it instead of roadmap\.md and requirements\.md\.\nCheck must_haves[^\n]*\nCross-reference requirement IDs from PLAN frontmatter against the slice's requirement lines/);
    const verifier = read('agents/pan-verifier.md');
    assert.doesNotMatch(verifier, /Extract phase goal from roadmap\.md|Find its full description in requirements\.md/);
    assert.match(verifier, /Do not read roadmap\.md or requirements\.md whole/);
    assert.match(read('agents/pan-executor.md'), /changes nothing[\s\S]{0,200}Do not read or hand-edit the whole roadmap\.md or requirements\.md/);
  });

  test('the planner never prints the whole roadmap to find its phase', () => {
    assert.doesNotMatch(read('agents/pan-planner.md'), /cat \.planning\/roadmap\.md/);
  });

  test('no shipped prompt @-imports the whole roadmap (a command import inlines it into the session)', () => {
    const dirs = ['commands/pan', 'agents', 'pan-wizard-core/workflows', 'pan-wizard-core/templates'];
    const offenders = [];
    for (const dir of dirs) {
      for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith('.md'))) {
        if (/^@\.planning\/roadmap\.md\s*$/m.test(read(`${dir}/${f}`))) offenders.push(`${dir}/${f}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('no shipped prompt "primes the cache" by handing subagents the whole planning set (ADR-0023, amended)', () => {
    // The old <cache_priming> step told the orchestrator to put project, requirements,
    // roadmap, state and standards in every executor's context, and claimed a CLI call
    // could mark another agent's prompt for caching. It could not; it only loaded more.
    const dirs = ['commands/pan', 'agents', 'pan-wizard-core/workflows', 'pan-wizard-core/templates', 'pan-wizard-core/references'];
    const offenders = [];
    for (const dir of dirs) {
      for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith('.md'))) {
        if (/<cache_priming>|cache prime|cache_control|prime (the )?(prompt )?cache/i.test(read(`${dir}/${f}`))) offenders.push(`${dir}/${f}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
