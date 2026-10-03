/**
 * PAN Tools Tests - Verify
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const { reconcilePhase, scanStubs } = require('../pan-wizard-core/bin/lib/verify.cjs');

describe('verify stubs — fake-implementation scanner (anti-fake, ADR-0036)', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });
  const write = (rel, body) => { fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), body); };

  test('flags "not implemented" and throw-stub as high-severity (blocking)', () => {
    write('src/a.js', "function pay(){ throw new Error('not implemented'); }\n");
    write('src/b.js', "function q(){ return NotImplementedError; }\n");
    const r = scanStubs(tmp, { files: ['src/a.js', 'src/b.js'] });
    assert.ok(r.blocking >= 2, `expected >=2 blocking, got ${r.blocking}`);
    assert.ok(r.findings.some(f => f.marker === 'not-implemented' || f.marker === 'throw-stub'));
  });

  test('flags a hardcoded fake return {ok:true} (medium, non-blocking)', () => {
    write('src/charge.js', "function chargeCard(){\n  return {ok:true}\n}\n");
    const r = scanStubs(tmp, { files: ['src/charge.js'] });
    assert.ok(r.findings.some(f => f.marker === 'fake-ok-return'));
    assert.equal(r.blocking, 0, 'fake-ok-return is medium, not a hard block');
  });

  test('TODO markers are low-severity, not blocking', () => {
    write('src/c.js', "// TODO: wire this up\nfunction f(){ return 1; }\n");
    const r = scanStubs(tmp, { files: ['src/c.js'] });
    assert.ok(r.findings.some(f => f.marker === 'todo-marker'));
    assert.equal(r.blocking, 0);
  });

  test('clean real code produces no findings', () => {
    write('src/ok.js', "function add(a,b){ return a+b; }\nmodule.exports={add};\n");
    const r = scanStubs(tmp, { files: ['src/ok.js'] });
    assert.equal(r.total, 0);
  });

  test('non-code files are not scanned', () => {
    write('README.md', "This feature is not implemented yet.\n");
    const r = scanStubs(tmp, { files: ['README.md'] });
    assert.equal(r.scanned, 0);
    assert.equal(r.total, 0);
  });
});

// N5/M30: the CLI exit code (not just scanStubs) is what gates a handoff. output()
// used to hard-exit 0 before the gate check, so `verify stubs --gate` never gated;
// these lock the CLI-level exit contract so a future revert to output(r, raw, ...)
// re-breaks a test instead of shipping silently.
describe('verify stubs --gate — CLI exit code (N5/M30 regression)', () => {
  let tmp;
  const { execFileSync } = require('child_process');
  const gitInit = (dir) => {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, 'README.md'), '# baseline\n');
    execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  };
  const stage = (rel, body) => {
    fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), body);
    execFileSync('git', ['add', rel], { cwd: tmp, stdio: 'pipe' });
  };
  beforeEach(() => { tmp = createTempProject(); gitInit(tmp); });
  afterEach(() => { cleanup(tmp); });

  test('exits NON-ZERO on a blocking stub finding in the changed set', () => {
    stage('src/pay.js', "function pay(){ throw new Error('not implemented'); }\n");
    const r = runPanTools('verify stubs --gate --raw', tmp);
    assert.equal(r.success, false, 'a blocking stub must gate the handoff (exit non-zero)');
    assert.match(`${r.output || ''}${r.error || ''}`, /invalid/);
  });

  test('exits ZERO when the changed set is clean', () => {
    stage('src/ok.js', "function add(a,b){ return a+b; }\nmodule.exports={add};\n");
    const r = runPanTools('verify stubs --gate --raw', tmp);
    assert.equal(r.success, true, 'a clean changed set must not gate');
  });

  test('without --gate, a blocking stub still exits ZERO (report-only)', () => {
    stage('src/pay.js', "function pay(){ throw new Error('not implemented'); }\n");
    const r = runPanTools('verify stubs --raw', tmp);
    assert.equal(r.success, true, '--gate is what turns findings into a non-zero exit');
  });
});

describe('verify reconcile — verdict vs mechanical signals (anti-rubber-stamp, ADR-0036)', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  function scaffold(phaseDir, planFrontmatter, verificationStatus, artifactBody) {
    const dir = path.join(tmp, '.planning', 'phases', phaseDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-plan.md'), `---\n${planFrontmatter}\n---\n# Plan\n`);
    fs.writeFileSync(path.join(dir, '01-verification.md'), `---\nstatus: ${verificationStatus}\n---\n# Verification\n`);
    if (artifactBody !== undefined) {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'charge.js'), artifactBody);
    }
    return dir;
  }

  // parseMustHavesBlock requires exactly 4-space block indent + 6-space items.
  const planWith = (minLines) =>
    ['must_haves:', '    artifacts:', '      - path: src/charge.js', `        min_lines: ${minLines}`, '        exports: chargeCard'].join('\n');

  test('rubber stamp: status "passed" but the artifact is a stub -> reconciled:false with a contradiction', () => {
    scaffold('01-pay', planWith(30), 'passed', "function chargeCard(){ return {ok:true} } // 1 line stub\nmodule.exports={chargeCard};\n");
    const r = reconcilePhase(tmp, '01');
    assert.equal(r.found, true);
    assert.equal(r.claims_pass, true);
    assert.equal(r.reconciled, false, 'a passed verdict over a stub artifact must be flagged');
    assert.ok(r.contradictions.length >= 1);
    assert.match(r.contradictions[0], /artifact substance check/);
  });

  test('honest pass: status "passed" and the artifact meets its contract -> reconciled:true', () => {
    const body = Array.from({ length: 40 }, (_, i) => `// line ${i}`).join('\n') + '\nfunction chargeCard(){/*real*/}\nmodule.exports={chargeCard};\n';
    scaffold('01-pay', planWith(30), 'passed', body);
    const r = reconcilePhase(tmp, '01');
    assert.equal(r.reconciled, true);
    assert.equal(r.contradictions.length, 0);
  });

  // H3: the CLI exit code (not just the pure function) gates exec-phase's
  // auto-advance. output() used to hard-code exit 0, so a rubber stamp advanced.
  test('CLI: reconcile exits NON-ZERO on a rubber-stamped pass (H3 — un-deadens the gate)', () => {
    scaffold('01-pay', planWith(30), 'passed', "function chargeCard(){ return {ok:true} }\nmodule.exports={chargeCard};\n");
    const r = runPanTools('verify reconcile 01 --raw', tmp);
    assert.equal(r.success, false, 'contradiction must exit non-zero so auto-advance stops');
    assert.match(`${r.output || ''}${r.error || ''}`, /invalid/);
  });

  test('CLI: reconcile exits ZERO on an honest pass (H3)', () => {
    const body = Array.from({ length: 40 }, (_, i) => `// line ${i}`).join('\n') + '\nfunction chargeCard(){}\nmodule.exports={chargeCard};\n';
    scaffold('01-pay', planWith(30), 'passed', body);
    const r = runPanTools('verify reconcile 01 --raw', tmp);
    assert.equal(r.success, true, 'honest pass must exit zero');
  });

  test('not a pass claim: status "gaps_found" with a failing artifact is NOT a contradiction', () => {
    scaffold('01-pay', planWith(30), 'gaps_found', 'function chargeCard(){}\n');
    const r = reconcilePhase(tmp, '01');
    assert.equal(r.claims_pass, false);
    assert.equal(r.reconciled, true, 'reconcile only contradicts a claimed PASS');
  });

  test('no must_haves declared: nothing to reconcile -> reconciled:true with a note', () => {
    const dir = path.join(tmp, '.planning', 'phases', '02-docs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-plan.md'), '---\nphase: 02\n---\n# Plan\n');
    fs.writeFileSync(path.join(dir, '01-verification.md'), '---\nstatus: passed\n---\n');
    const r = reconcilePhase(tmp, '02');
    assert.equal(r.reconciled, true);
    assert.equal(r.mechanical_signals, 0);
    assert.match(r.note, /mechanical reconciliation unavailable/);
  });

  test('missing phase / verification: does not throw, passes through', () => {
    assert.equal(reconcilePhase(tmp, '99').reconciled, true);
  });
});

describe('validate consistency command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('passes for consistent project', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: A\n### Phase 2: B\n### Phase 3: C\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-b'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-c'), { recursive: true });

    const result = runPanTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, true, 'should pass');
    assert.strictEqual(output.warning_count, 0, 'no warnings');
    assert.ok(Array.isArray(output.warnings), 'warnings should be array');
    assert.strictEqual(output.warnings.length, 0, 'warnings array should be empty');
    assert.ok(Array.isArray(output.errors), 'errors should be array');
  });

  test('warns about phase on disk but not in roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: A\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-orphan'), { recursive: true });

    const result = runPanTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warning_count > 0, 'should have warnings');
    assert.ok(Array.isArray(output.warnings), 'warnings should be array');
    assert.ok(
      output.warnings.some(w => w.includes('disk but not in roadmap')),
      'should warn about orphan directory'
    );
  });

  test('warns about gaps in phase numbering', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: A\n### Phase 3: C\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-c'), { recursive: true });

    const result = runPanTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.includes('Gap in phase numbering')),
      'should warn about gap'
    );
  });
});

describe('verify references command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for missing file', () => {
    const result = runPanTools('verify references nonexistent.md', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');
    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have error field');
    assert.ok(output.error.includes('not found'), 'should say not found');
  });

  test('reports found and missing references', () => {
    const docPath = path.join(tmpDir, '.planning', 'test-refs.md');
    fs.writeFileSync(docPath, 'See `nonexistent/file.txt` for details');
    const result = runPanTools('verify references .planning/test-refs.md', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.found, 'number', 'should have found count');
    assert.ok(Array.isArray(output.missing), 'should have missing array');
    assert.ok(output.missing.length > 0, 'should have at least one missing ref');
    assert.ok(!output.error, 'should not have error field on success');
    assert.ok(output.missing.some(m => m.includes('nonexistent')), 'missing should include the nonexistent ref');
  });
});

describe('verify artifacts command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for missing plan file', () => {
    const result = runPanTools('verify artifacts nonexistent.md', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');
    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have error field');
    assert.ok(output.error.includes('not found') || output.error.includes('No such'), 'error should mention file missing');
  });

  test('returns error when no artifacts block in frontmatter', () => {
    const planPath = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(planPath, { recursive: true });
    const planFile = path.join(planPath, 'PLAN-01.md');
    fs.writeFileSync(planFile, '---\nphase_id: 01-setup\n---\n# Plan\n');
    const result = runPanTools('verify artifacts .planning/phases/01-setup/PLAN-01.md', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(output.error && output.error.includes('artifacts'), 'should mention artifacts');
    assert.strictEqual(typeof output.error, 'string', 'error should be a string');
  });
});

describe('verify key-links command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for missing plan file', () => {
    const result = runPanTools('verify key-links nonexistent.md', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');
    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have error field');
    assert.ok(output.error.includes('not found') || output.error.includes('No such'), 'error should mention file missing');
  });

  test('returns error when no key_links block in frontmatter', () => {
    const planPath = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(planPath, { recursive: true });
    const planFile = path.join(planPath, 'PLAN-01.md');
    fs.writeFileSync(planFile, '---\nphase_id: 01-setup\n---\n# Plan\n');
    const result = runPanTools('verify key-links .planning/phases/01-setup/PLAN-01.md', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(output.error && output.error.includes('key_links'), 'should mention key_links');
    assert.strictEqual(typeof output.error, 'string', 'error should be a string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-summary command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-summary command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns not found for missing summary', () => {
    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, false);
    assert.strictEqual(output.checks.summary_exists, false);
    assert.ok(output.errors.length > 0);
  });

  test('passes for summary with no file references', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary\n\nWork completed successfully.\n');

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, true);
    assert.strictEqual(output.checks.summary_exists, true);
  });

  test('detects missing referenced files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      '# Summary\n\nCreated: `src/missing-file.js`\n'
    );

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, false);
    assert.ok(output.checks.files_created.missing.length > 0);
  });

  test('detects self-check section with pass indicator', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      '# Summary\n\nDone.\n\n## Self-Check\nAll pass\n'
    );

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.checks.self_check, 'passed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify plan-structure command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify plan-structure command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for missing file', () => {
    const result = runPanTools('verify plan-structure nonexistent.md', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');
    const output = JSON.parse(result.output);
    assert.ok(output.error);
  });

  test('reports missing frontmatter fields', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-01-plan.md'),
      '---\nphase: 01\nplan: 01\n---\n# Plan\n'
    );

    const result = runPanTools('verify plan-structure .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false);
    assert.ok(output.errors.some(e => e.includes('Missing required frontmatter')));
    assert.strictEqual(typeof output.task_count, 'number');
  });

  test('validates well-formed plan with tasks', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    const planContent = [
      '---',
      'phase: 01',
      'plan: 01',
      'type: implementation',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/main.js]',
      'autonomous: true',
      'must_haves:',
      '  artifacts: []',
      '---',
      '# Plan',
      '<task>',
      '<name>Setup project</name>',
      '<action>Initialize the project</action>',
      '<verify>Check files exist</verify>',
      '<done>Project initialized</done>',
      '<files>src/main.js</files>',
      '</task>',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('verify plan-structure .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.task_count, 1);
    assert.strictEqual(output.errors.length, 0);
  });

  // ── Checkpoint tasks (market-ideas M22) ──────────────────────────────────────
  // Auto mode used to take a decision's FIRST option, so safety depended on the
  // order the planner listed options in. A decision now names its default with
  // `auto_select`, or auto mode stops for a human. These plans use the documented
  // shapes from references/checkpoints.md, inside the `<tasks>` wrapper real plans
  // have — until 2026-10-03 the checker validated checkpoints as auto tasks and
  // read the wrapper as the first task.
  const checkpointPlan = (decisionAttrs, extra = '') => [
    '---', 'phase: 01', 'plan: 01', 'type: execute', 'wave: 1', 'depends_on: []',
    'files_modified: [src/auth.ts]', 'autonomous: false', 'must_haves:', '  truths: []', '---',
    '<tasks>',
    '<task type="auto">', '  <name>Build login form</name>', '  <files>src/login.tsx</files>',
    '  <action>Create the form</action>', '  <verify>npm test</verify>', '  <done>Form renders</done>', '</task>',
    `<task type="checkpoint:decision" gate="blocking"${decisionAttrs}>`,
    '  <decision>Select session storage</decision>', '  <context>Sessions need a store.</context>',
    '  <options>',
    '    <option id="cookie"><name>Signed cookie</name><pros>No server state</pros><cons>Size cap</cons></option>',
    '    <option id="redis"><name>Redis</name><pros>Revocable</pros><cons>New service</cons></option>',
    '  </options>',
    '  <resume-signal>Select: cookie or redis</resume-signal>',
    '</task>',
    extra,
    '</tasks>',
  ].join('\n');

  const checkPlan = (content) => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), content);
    const result = runPanTools('verify plan-structure .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    return JSON.parse(result.output);
  };

  test('a decision whose auto_select names one of its options is valid', () => {
    const out = checkPlan(checkpointPlan(' auto_select="cookie"'));
    assert.deepEqual(out.errors, []);
    assert.ok(!out.warnings.some(w => w.includes('auto_select')), out.warnings.join('\n'));
    const decision = out.tasks.find(t => t.type === 'checkpoint:decision');
    assert.equal(decision.auto_select, 'cookie');
    assert.equal(decision.name, 'Select session storage');
  });

  test('an auto_select that names no option fails the plan', () => {
    const out = checkPlan(checkpointPlan(' auto_select="postgres"'));
    assert.equal(out.valid, false);
    assert.ok(out.errors.some(e => e.includes('auto_select="postgres" names no option') && e.includes('cookie, redis')), out.errors.join('\n'));
  });

  test('a decision without auto_select is valid but warns that auto mode will stop there', () => {
    const out = checkPlan(checkpointPlan(''));
    assert.equal(out.valid, true, out.errors.join('\n'));
    assert.ok(out.warnings.some(w => w.includes('no auto_select') && w.includes('stops here for a human')), out.warnings.join('\n'));
    assert.equal(out.tasks.find(t => t.type === 'checkpoint:decision').auto_select, null);
  });

  test('checkpoints are checked against their own shape, not the auto-task one, and the <tasks> wrapper is not a task', () => {
    const verify = ['<task type="checkpoint:human-verify" gate="blocking">',
      '  <what-built>Login page at /login</what-built>', '  <how-to-verify>Visit /login</how-to-verify>', '</task>'].join('\n');
    const out = checkPlan(checkpointPlan(' auto_select="cookie"', verify));
    assert.deepEqual(out.errors, []);
    assert.ok(!out.warnings.some(w => /missing <(files|verify|done)>/.test(w)), out.warnings.join('\n'));
    assert.deepEqual(out.tasks.map(t => [t.name, t.type]), [
      ['Build login form', 'auto'],
      ['Select session storage', 'checkpoint:decision'],
      ['Login page at /login', 'checkpoint:human-verify'],
    ]);
  });

  test('a checkpoint missing its own elements is reported by name', () => {
    const broken = ['<task type="checkpoint:human-verify" gate="blocking">',
      '  <what-built>Dashboard</what-built>', '</task>'].join('\n');
    const out = checkPlan(checkpointPlan(' auto_select="cookie"', broken));
    assert.equal(out.valid, false);
    assert.ok(out.errors.includes("Checkpoint 'Dashboard' missing <how-to-verify>"), out.errors.join('\n'));
  });

  test('no shipped prose still tells auto mode to take the first option', () => {
    const ROOT = path.join(__dirname, '..');
    const files = ['agents/pan-executor.md', 'agents/pan-planner.md', 'pan-wizard-core/workflows/exec-phase.md',
      'pan-wizard-core/references/checkpoints.md', 'docs/USER-GUIDE.md', 'docs/TROUBLESHOOTING.md', 'docs/INTERNALS.md'];
    for (const rel of files) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.ok(!/auto-?selects? (the )?first option|first option (auto-selected|from checkpoint details)/i.test(text), `${rel} still describes first-option auto-select`);
    }
    for (const rel of ['agents/pan-executor.md', 'pan-wizard-core/workflows/exec-phase.md', 'pan-wizard-core/references/checkpoints.md']) {
      assert.ok(fs.readFileSync(path.join(ROOT, rel), 'utf8').includes('auto_select'), `${rel} must describe auto_select`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify phase-completeness command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify phase-completeness command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('reports complete when all plans have summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary');

    const result = runPanTools('verify phase-completeness 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.complete, true);
    assert.strictEqual(output.plan_count, 1);
    assert.strictEqual(output.summary_count, 1);
    assert.strictEqual(output.incomplete_plans.length, 0);
  });

  test('reports incomplete when plans lack summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), '# Plan 2');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary');

    const result = runPanTools('verify phase-completeness 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.complete, false);
    assert.strictEqual(output.plan_count, 2);
    assert.strictEqual(output.summary_count, 1);
    assert.ok(output.incomplete_plans.includes('01-02'));
  });

  test('returns error for non-existent phase', () => {
    const result = runPanTools('verify phase-completeness 99', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');
    const output = JSON.parse(result.output);
    assert.ok(output.error);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify commits command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify commits command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Initialize git repo for commit verification
    const { execSync } = require('child_process');
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');
    execSync('git add test.txt', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });
  });

  afterEach(() => { cleanup(tmpDir); });

  test('validates real commit hash', () => {
    const { execSync } = require('child_process');
    const hash = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();

    const result = runPanTools(`verify commits ${hash.slice(0, 7)}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_valid, true);
    assert.strictEqual(output.valid.length, 1);
    assert.strictEqual(output.invalid.length, 0);
  });

  test('reports invalid for fake hash', () => {
    const result = runPanTools('verify commits 0000000', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_valid, false);
    assert.ok(output.invalid.length > 0);
  });

  test('handles mix of valid and invalid hashes', () => {
    const { execSync } = require('child_process');
    const hash = execSync('git rev-parse --short HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();
    const result = runPanTools(`verify commits ${hash} badhash`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_valid, false);
    assert.strictEqual(output.valid.length, 1);
    assert.strictEqual(output.invalid.length, 1);
    assert.strictEqual(output.total, 2);
  });

  test('requires at least one hash', () => {
    const result = runPanTools('verify commits', tmpDir);
    assert.strictEqual(result.success, false, 'should fail without hashes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health command
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns healthy for well-structured project', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'),
      '# Project\n\n## What This Is\nA test project\n\n## Core Value\nTesting\n\n## Requirements\n- REQ-01\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '# Roadmap');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '# State\n**Status:** In progress\n**Last Activity:** 2026-01-01\n**Last Activity Description:** Working\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{"model_profile":"balanced"}');

    const result = runPanTools('validate health', tmpDir);
    assert.equal(result.success, JSON.parse(result.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'healthy');
    assert.strictEqual(output.errors.length, 0);
  });

  test('reports broken when planning dir missing', () => {
    // Remove the .planning directory
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });

    const result = runPanTools('validate health', tmpDir);
    assert.equal(result.success, JSON.parse(result.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'broken');
    assert.ok(output.errors.length > 0);
  });

  test('reports degraded when optional files missing', () => {
    // Only .planning/ exists (from createTempProject) but no project.md etc.
    const result = runPanTools('validate health', tmpDir);
    assert.equal(result.success, JSON.parse(result.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const output = JSON.parse(result.output);
    assert.ok(output.status === 'degraded' || output.status === 'broken', 'should not be healthy');
    assert.strictEqual(typeof output.repairable_count, 'number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health --full
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health --full', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('default (no --full) omits test_status and build_status', () => {
    const result = runPanTools('validate health', tmpDir);
    assert.equal(result.success, JSON.parse(result.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const output = JSON.parse(result.output);
    assert.strictEqual(output.test_status, undefined);
    assert.strictEqual(output.build_status, undefined);
  });

  test('--full includes test_status and build_status fields', () => {
    // Create a minimal package.json so it's a valid project
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', scripts: {} }));
    const result = runPanTools('validate health --full', tmpDir);
    assert.equal(result.success, JSON.parse(result.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const output = JSON.parse(result.output);
    assert.ok('test_status' in output, 'should have test_status');
    assert.ok('build_status' in output, 'should have build_status');
    assert.strictEqual(typeof output.test_status.pass, 'boolean');
    // build_status should be skipped (no build:hooks script)
    assert.strictEqual(output.build_status.skipped, true);
  });

  test('--full reports test failure for non-test project', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));
    const result = runPanTools('validate health --full', tmpDir);
    assert.equal(result.success, JSON.parse(result.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const output = JSON.parse(result.output);
    // node --test in a dir with no test files will either pass with 0 tests or fail
    assert.ok(output.test_status !== undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health --drift
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health --drift', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Init git for drift-check
    const { execFileSync } = require('child_process');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('default (no --drift) omits drift_status', () => {
    const result = runPanTools('validate health', tmpDir);
    assert.equal(result.success, JSON.parse(result.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const data = JSON.parse(result.output);
    assert.equal(data.drift_status, undefined);
  });

  test('--drift includes drift_status with score and verdict', () => {
    const result = runPanTools('validate health --drift', tmpDir);
    assert.equal(result.success, JSON.parse(result.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const data = JSON.parse(result.output);
    assert.ok(data.drift_status, 'should include drift_status');
    assert.ok('drift_score' in data.drift_status);
    assert.ok('verdict' in data.drift_status);
    assert.ok('violation_count' in data.drift_status);
    assert.ok('files_checked' in data.drift_status);
  });

  test('--drift with violations adds warning to health', () => {
    // Create a .cjs file with console.log
    fs.writeFileSync(path.join(tmpDir, 'bad.cjs'), 'console.log("drift");\n');
    const { execFileSync } = require('child_process');
    execFileSync('git', ['add', 'bad.cjs'], { cwd: tmpDir, stdio: 'pipe' });

    const result = runPanTools('validate health --drift', tmpDir);
    assert.equal(result.success, JSON.parse(result.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const data = JSON.parse(result.output);
    assert.ok(data.drift_status);
    assert.ok(data.drift_status.violation_count > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retro command
// ─────────────────────────────────────────────────────────────────────────────

describe('retro command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns error when no roadmap exists', () => {
    const { success, output } = runPanTools('retro', tmpDir);
    assert.equal(success, false, 'an error payload must exit non-zero');
    const json = JSON.parse(output);
    assert.equal(json.error, 'roadmap.md not found');
  });

  test('returns zeroes for empty project with roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [ ] Phase 1: Setup\n- [ ] Phase 2: Build\n'
    );
    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.phases_planned, 2);
    assert.equal(json.phases_completed, 0);
    assert.equal(json.phases_decimal, 0);
    assert.equal(json.estimation_accuracy_pct, 100);
    assert.equal(json.verifications_total, 0);
    assert.equal(json.first_try_rate_pct, null);
    assert.ok(Array.isArray(json.common_gap_patterns));
  });

  test('counts completed phases correctly', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n- [x] Phase 2: Build\n- [ ] Phase 3: Polish\n'
    );
    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.phases_planned, 3);
    assert.equal(json.phases_completed, 2);
  });

  test('detects decimal (gap closure) phases', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n- [x] Phase 1.1: Gap Fix\n- [x] Phase 2: Build\n'
    );
    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.phases_planned, 3);
    assert.equal(json.phases_decimal, 1);
    assert.ok(json.estimation_accuracy_pct < 100);
  });

  test('reads verification files and computes stats', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n- [x] Phase 2: Build\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'), '---\nstatus: passed\n---\nAll good.');

    const phaseDir2 = path.join(tmpDir, '.planning', 'phases', '02-build');
    fs.mkdirSync(phaseDir2, { recursive: true });
    fs.writeFileSync(path.join(phaseDir2, '02-verification.md'), '---\nstatus: gaps_found\n---\n## Gaps\n- Missing wiring between API and UI\n- Stub detected in handler\n');

    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.verifications_total, 2);
    assert.equal(json.verifications_passed_first_try, 1);
    assert.equal(json.verifications_gaps_found, 1);
    assert.equal(json.first_try_rate_pct, 50);
    assert.ok(json.common_gap_patterns.length > 0);
  });

  test('raw output includes summary text', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n'
    );
    const { success, output } = runPanTools('retro --raw', tmpDir);
    assert.ok(success);
    assert.ok(output.includes('Phases:'));
    assert.ok(output.includes('Estimation accuracy:'));
  });

  test('--write-memory appends gap-pattern lessons to pan-planner memory', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n- [x] Phase 2: Build\n'
    );
    const phaseDir2 = path.join(tmpDir, '.planning', 'phases', '02-build');
    fs.mkdirSync(phaseDir2, { recursive: true });
    fs.writeFileSync(path.join(phaseDir2, '02-verification.md'),
      '---\nstatus: gaps_found\n---\n## Gaps\n- Missing wiring between API and UI\n- Stub detected in handler\n');

    const { success, output } = runPanTools('retro --write-memory', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.ok(json.memory, 'memory field present');
    assert.ok(json.memory.wrote['pan-planner'] >= 1, 'wrote at least one planner lesson');

    // Verify the memory file was actually created.
    const mem = fs.readFileSync(path.join(tmpDir, '.planning', 'memory', 'pan-planner.md'), 'utf-8');
    assert.ok(mem.includes('Recurring plan gap'));
  });

  test('--write-memory respects --max N to cap lessons', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    // Many distinct patterns → many gap groups.
    const gaps = Array.from({ length: 6 }, (_, i) => `- Unique pattern ${i} causing verification failure\n`).join('');
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'),
      `---\nstatus: gaps_found\n---\n## Gaps\n${gaps}`);

    const { success, output } = runPanTools('retro --write-memory --max 2', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.memory.max, 2);
    assert.ok(json.memory.wrote['pan-planner'] <= 2);
  });

  test('without --write-memory, no memory writes happen', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'),
      '---\nstatus: gaps_found\n---\n## Gaps\n- Some gap\n');

    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.memory, undefined, 'no memory field when flag not set');
    assert.equal(fs.existsSync(path.join(tmpDir, '.planning', 'memory')), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retro helper functions (unit tests)
// ─────────────────────────────────────────────────────────────────────────────

const { collectVerificationStats, countRoadmapPhases, groupGapPatterns } = require('../pan-wizard-core/bin/lib/verify.cjs');

describe('countRoadmapPhases', () => {
  test('counts empty roadmap', () => {
    const r = countRoadmapPhases('# Roadmap\nNo phases yet.');
    assert.equal(r.planned, 0);
    assert.equal(r.completed, 0);
    assert.equal(r.decimal_phases, 0);
  });

  test('counts mixed checkboxes', () => {
    const r = countRoadmapPhases('- [x] Phase 1: A\n- [ ] Phase 2: B\n- [x] Phase 3: C\n');
    assert.equal(r.planned, 3);
    assert.equal(r.completed, 2);
  });

  test('counts bold phase names', () => {
    const r = countRoadmapPhases('- [x] **Phase 1: Setup**\n- [ ] **Phase 2: Build**\n');
    assert.equal(r.planned, 2);
    assert.equal(r.completed, 1);
  });

  test('counts decimal phases', () => {
    const r = countRoadmapPhases('- [x] Phase 1: A\n- [x] Phase 1.1: Gap\n- [x] Phase 2: B\n');
    assert.equal(r.decimal_phases, 1);
    assert.equal(r.planned, 3);
  });
});

describe('groupGapPatterns', () => {
  test('returns empty for no patterns', () => {
    const r = groupGapPatterns([]);
    assert.equal(r.length, 0);
  });

  test('groups similar patterns', () => {
    const r = groupGapPatterns([
      'Missing wiring between API and UI',
      'Missing wiring between DB and API',
      'Stub detected in handler',
    ]);
    assert.ok(r.length > 0);
    assert.ok(r[0].count >= 1);
    assert.ok(typeof r[0].pattern === 'string');
  });

  test('limits to 10 groups max', () => {
    const patterns = [];
    for (let i = 0; i < 20; i++) patterns.push(`Unique pattern ${i} is different`);
    const r = groupGapPatterns(patterns);
    assert.ok(r.length <= 10);
  });
});

describe('collectVerificationStats', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns zeroes for empty phases dir', () => {
    const r = collectVerificationStats(path.join(tmpDir, '.planning', 'phases'));
    assert.equal(r.total, 0);
    assert.equal(r.passed, 0);
  });

  test('returns zeroes for nonexistent dir', () => {
    const r = collectVerificationStats(path.join(tmpDir, 'nonexistent'));
    assert.equal(r.total, 0);
  });

  test('collects stats from verification files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'), '---\nstatus: passed\n---\nDone.');
    const r = collectVerificationStats(path.join(tmpDir, '.planning', 'phases'));
    assert.equal(r.total, 1);
    assert.equal(r.passed, 1);
    assert.equal(r.gaps_found, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate deployment
// ─────────────────────────────────────────────────────────────────────────────

describe('validate deployment command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns error when no PAN installation found', () => {
    const result = runPanTools('validate deployment', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');
    const data = JSON.parse(result.output);
    assert.ok(data.error);
    assert.ok(data.error.includes('No PAN installations'));
  });

  test('detects a clean Claude installation', () => {
    // Create minimal Claude PAN installation with manifest
    const claudeDir = path.join(tmpDir, '.claude');
    const coreDir = path.join(claudeDir, 'pan-wizard-core', 'bin', 'lib');
    fs.mkdirSync(coreDir, { recursive: true });
    const testFile = 'pan-wizard-core/bin/lib/test.cjs';
    const content = 'module.exports = {};';
    fs.writeFileSync(path.join(claudeDir, testFile), content);
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    fs.writeFileSync(path.join(claudeDir, 'pan-file-manifest.json'), JSON.stringify({
      version: '2.8.1',
      files: { [testFile]: hash }
    }));

    const result = runPanTools('validate deployment', tmpDir);
    assert.ok(result.success);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.status, 'clean');
    assert.strictEqual(data.runtimes_found, 1);
    assert.strictEqual(data.runtimes.claude.status, 'clean');
    assert.strictEqual(data.runtimes.claude.total_files, 1);
    assert.strictEqual(data.runtimes.claude.missing.length, 0);
  });

  test('detects missing files as broken', () => {
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'pan-file-manifest.json'), JSON.stringify({
      version: '2.8.1',
      files: { 'missing-file.cjs': 'abc123' }
    }));

    const result = runPanTools('validate deployment', tmpDir);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.status, 'broken');
    assert.strictEqual(data.runtimes.claude.status, 'broken');
    assert.strictEqual(data.runtimes.claude.missing.length, 1);
    assert.ok(data.runtimes.claude.missing[0].includes('missing-file'));
  });

  test('detects modified files', () => {
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const file = 'test.cjs';
    fs.writeFileSync(path.join(claudeDir, file), 'original content');
    // Manifest has hash of different content
    fs.writeFileSync(path.join(claudeDir, 'pan-file-manifest.json'), JSON.stringify({
      version: '2.8.1',
      files: { [file]: 'aaaa' }
    }));

    const result = runPanTools('validate deployment', tmpDir);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.runtimes.claude.status, 'modified');
    assert.strictEqual(data.runtimes.claude.modified.length, 1);
  });

  // M29: the hook-path integrity check must descend into the NESTED Claude hook
  // shape ({ matcher, hooks: [{ command }] }). Previously it only read the outer
  // group.command (undefined there) so it validated nothing — a broken hook path
  // was reported as clean.
  test('validates hook paths nested under group.hooks[] (settings integrity)', () => {
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'pan-file-manifest.json'), JSON.stringify({
      version: '3.0.0',
      files: {},
    }));
    // Nested shape with a command pointing at a hook .js file that does NOT exist.
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        PostToolUse: [
          { matcher: 'Write', hooks: [{ type: 'command', command: 'node .claude/hooks/dist/missing.js' }] },
        ],
      },
    }));

    const result = runPanTools('validate deployment', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.runtimes.claude.settings_ok, false, 'nested broken hook path must be caught');
    assert.ok(
      data.runtimes.claude.settings_issues.some(s => s.includes('missing.js')),
      `expected a hook-path issue for missing.js, got ${JSON.stringify(data.runtimes.claude.settings_issues)}`
    );
  });

  test('detects multiple runtimes', () => {
    // Create two minimal installations
    for (const dir of ['.claude', '.codex']) {
      const d = path.join(tmpDir, dir);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'pan-file-manifest.json'), JSON.stringify({
        version: '2.8.1', files: {}
      }));
    }

    const result = runPanTools('validate deployment', tmpDir);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.runtimes_found, 2);
    assert.ok('claude' in data.runtimes);
    assert.ok('codex' in data.runtimes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// progress command
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// Plans record decisions, not code (market-ideas M32)
// Superpowers v6.4.2 found its planner implementing whole features while planning.
// PAN's planner had no rule against it; `verify plan-structure` now warns on an
// implementation body in a task's <action>, and the planner and checker carry the rule.
// ─────────────────────────────────────────────────────────────────────────────

describe('verify plan-structure — decisions, not code (M32)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  const FENCE = '`'.repeat(3);
  const planWith = (action, extra = '') => [
    '---', 'phase: 01', 'plan: 01', 'type: execute', 'wave: 1', 'depends_on: []', 'files_modified: [src/parse.ts]',
    'autonomous: true', 'must_haves:', '  truths: []', '---', extra, '<tasks>', '<task type="auto">', '<name>Build the parser</name>',
    '<files>src/parse.ts</files>', `<action>${action}</action>`, '<verify>npm test</verify>', '<done>parse() returns tokens</done>', '</task>', '</tasks>',
  ].join('\n');
  const check = (content) => {
    const dir = path.join(tmpDir, '.planning', 'phases', '01-parse');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-01-plan.md'), content);
    return JSON.parse(runPanTools('verify plan-structure .planning/phases/01-parse/01-01-plan.md', tmpDir).output);
  };
  const body = Array.from({ length: 24 }, (_, i) => `  const t${i} = next();`).join('\n');

  test('an implementation body in <action> is a warning that names the size', () => {
    const out = check(planWith(`Create parse().\n${FENCE}ts\nexport function parse(src: string): Token[] {\n${body}\n}\n${FENCE}\n`));
    assert.strictEqual(out.valid, true, 'a warning, not an error');
    assert.ok(out.warnings.some((w) => /embeds a 26-line code block in <action>/.test(w) && /decisions/.test(w)), out.warnings.join('\n'));
  });

  test('a signature, a type or a short snippet is a decision and passes', () => {
    const out = check(planWith(`Create parse() with this signature:\n${FENCE}ts\nexport function parse(src: string): Token[]\n${FENCE}\nRejects input over 1 MB with RangeError.`));
    assert.ok(!out.warnings.some((w) => /code block/.test(w)), out.warnings.join('\n'));
  });

  test('a long block outside the <action> (an interfaces section) is not the planner writing the code', () => {
    const iface = `<interfaces>\n${FENCE}ts\n${body}\n${FENCE}\n</interfaces>`;
    const out = check(planWith('Implement parse() against the interface above.', iface));
    assert.ok(!out.warnings.some((w) => /code block/.test(w)), out.warnings.join('\n'));
  });

  test('the planner and the checker carry the rule', () => {
    const root = path.join(__dirname, '..');
    const planner = fs.readFileSync(path.join(root, 'agents', 'pan-planner.md'), 'utf8');
    assert.match(planner, /## Decisions, Not Code/);
    assert.match(planner, /Planning is not building/);
    const checker = fs.readFileSync(path.join(root, 'agents', 'pan-plan-checker.md'), 'utf8');
    assert.match(checker, /Code instead of decisions/);
    assert.match(checker, /long code block in `<action>`.*scope_sanity/);
  });
});
