/**
 * feedback.cjs — the learning report a user may share (`pan-tools feedback`).
 *
 * The project below plants a canary in every place PAN keeps free text: finding
 * summaries and locations, dismissal reasons, trace descriptions and contexts, test
 * output, the guard log's paths, a client name in a phase directory, custom config
 * keys and model ids, the git remote, branch and user. The report must count what
 * happened and carry none of them.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const FB = require('../pan-wizard-core/bin/lib/feedback.cjs');
const { TOOLS_PATH } = require('./helpers.cjs');

const CANARIES = [
  'sk-ant-api03-CANARYsecretTOKEN1234567890',
  'hunter2-canary-password',
  'jane.doe@acme-corp.example',
  'AcmeInvoiceExport',
  'acme-invoice-export',
  'acme-corp',
  'billing-engine',
  'git.acme.example',
  'client-feature-branch',
  'Jane Canary',
  'src/acme/secret-module.js',
  'acme-internal-llm-v7',
  'acmeCustomKey',
  'C:\\Users\\jane\\acme',
  '/home/jane/acme',
  '10.20.30.40',
];

function seed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-'));
  const P = (...p) => path.join(dir, '.planning', ...p);
  const w = (rel, text) => { fs.mkdirSync(path.dirname(rel), { recursive: true }); fs.writeFileSync(rel, text); };
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const ts = new Date().toISOString();

  w(P('config.json'), JSON.stringify({ model_profile: 'quality', commit_docs: true, workflow: { phase_gate: 'warn', verifier: true }, hooks: { guard: 'enforce' }, cost: { phase_budget_usd: 37, rates: { 'acme-internal-llm-v7': { input: 1, output: 2 } } }, acmeCustomKey: 'hunter2-canary-password' }));
  w(P('roadmap.md'), '# Roadmap\n\n- [ ] **Phase 1: AcmeInvoiceExport** - client work\n\n### Phase 1: AcmeInvoiceExport\n**Goal:** export for jane.doe@acme-corp.example\n');
  w(P('state.md'), '# State\n\n**Current Phase:** 1\n');
  w(P('phases', '01-acme-invoice-export', '01-01-plan.md'), '---\nphase: 01-acme-invoice-export\nplan: 01\n---\nUse sk-ant-api03-CANARYsecretTOKEN1234567890 at /home/jane/acme\n');
  w(P('phases', '01-acme-invoice-export', '01-test-run.json'), JSON.stringify({ status: 'failed', source: 'package.json', command: 'npm test -- C:\\Users\\jane\\acme', output_tail: 'AssertionError at src/acme/secret-module.js 10.20.30.40', regressions: ['acme test one'], preexisting: [], timed_out: false }));
  w(P('phases', '01-acme-invoice-export', '01-mutation.json'), JSON.stringify({ score: 0.62, survivors: [{ file: 'src/acme/secret-module.js' }] }));

  const findings = [];
  const ids = Array.from({ length: 12 }, (_, i) => `f_${String(i).padStart(10, '0')}`);
  ids.forEach((id, i) => findings.push({ kind: 'finding', ts, id, phase: '01', agent: 'pan-reviewer', class: 'quality', severity: 'low', where: `src/acme/secret-module.js:${i}`, summary: `Rename AcmeInvoiceExport helper ${i} hunter2-canary-password` }));
  findings.push({ kind: 'finding', ts, id: 'f_custom0000', phase: '01', agent: 'acme-private-judge', class: 'acme-class', severity: 'high', where: 'C:\\Users\\jane\\acme', summary: 'custom' });
  findings.push({ kind: 'verdict', ts, verdict_id: 'v_1', phase: '01', agent: 'pan-reviewer', outcome: 'fail', finding_ids: [...ids, 'f_custom0000'], suppressed: [{ id: 'f_0000000000', scope: 'candidate', summary: 'AcmeInvoiceExport' }], lowered_by: ['test_gate'] });
  ids.forEach((id, i) => findings.push({ kind: 'disposition', ts, id, disposition: i < 9 ? 'dismissed' : 'fixed', reason: 'jane.doe@acme-corp.example said so' }));
  w(P('findings.jsonl'), jsonl(findings) + 'not json at all /home/jane/acme\n');

  w(P('metrics', 'tokens.jsonl'), jsonl([
    { ts, agent: 'pan-executor', tier: 'mid', model: 'acme-internal-llm-v7', phase: '01', cost_usd: 6.4, output_tokens: 10, session: 'acme-corp' },
    { ts, agent: 'acme-private-judge', tier: 'reasoning', model: 'm', phase: '01', cost_usd: 1.2, output_tokens: 10 },
  ]));
  w(P('guard.jsonl'), jsonl([{ ts, rule: 'secret_write', path: 'src/acme/secret-module.js', action: 'denied', tool: 'Write' }, { ts, rule: 'acme_rule', path: 'x', action: 'reported' }]));
  w(P('optimization', 'traces', 'sess_1', 'session.json'), JSON.stringify({ session_id: 'sess_1', command: 'exec-phase', started_at: ts, ended_at: null, description: 'AcmeInvoiceExport' }));
  w(P('optimization', 'traces', 'sess_1', 'trace.jsonl'), jsonl([
    { ts, type: 'error', category: 'tool_error', agent: 'pan-executor', description: 'Bash failed in /home/jane/acme', context: { tool: 'Bash', error_class: 'exit_code', exit_code: 1, message: 'hunter2-canary-password', message_sig: 'abcdef012345', count: 4 } },
    { ts, type: 'decision', category: 'acme_secret_category', description: 'sk-ant-api03-CANARYsecretTOKEN1234567890' },
  ]));

  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'client-feature-branch');
  g('config', 'user.name', 'Jane Canary');
  g('config', 'user.email', 'jane.doe@acme-corp.example');
  g('remote', 'add', 'origin', 'git@git.acme.example:acme-corp/billing-engine.git');
  g('add', '-A');
  g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'AcmeInvoiceExport init');
  return dir;
}

function cli(dir, ...args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [TOOLS_PATH, 'feedback', ...args], { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') };
  }
}

describe('feedback report: what it says', () => {
  let dir;
  let r;
  before(() => { dir = seed(); r = FB.buildReport(dir, { toolErrors: true }); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('builds and passes its own scan', () => {
    assert.equal(r.ok, true, JSON.stringify({ error: r.error, rules: r.rules }));
    assert.match(r.text, /^## PAN learning report/);
    assert.match(r.text, /Nothing was sent/);
  });

  test('counts what the judges found and what the user did with it', () => {
    const rev = r.model.judges['pan-reviewer'];
    assert.deepEqual(rev.by_class.quality, { total: 12, dismissed: 9, fixed: 3 });
    assert.equal(rev.suppressed, '<3');
    assert.deepEqual(rev.lowered_by, { test_gate: '<3' });
    assert.ok(r.model.judges.other, 'an agent PAN does not ship is counted as other');
    assert.deepEqual(r.model.judges.other.by_class, { other: { total: '<3', open: '<3' } });
  });

  test('derives the suggested learnings from fixed rules', () => {
    const ids = r.model.suggestions.map((s) => s.id);
    assert.ok(ids.includes('judge_noise'), JSON.stringify(r.model.suggestions));
    assert.match(r.model.suggestions.find((s) => s.id === 'judge_noise').text, /pan-reviewer `quality` findings were dismissed 80% of the time/);
  });

  test('settings: PAN keys with known values, buckets for money, the rest counted', () => {
    const v = r.model.config.values;
    assert.equal(v.model_profile, 'quality');
    assert.equal(v['workflow.phase_gate'], 'warn');
    assert.equal(v['hooks.guard'], 'enforce');
    assert.equal(v['cost.phase_budget_usd'], '$20–50');
    assert.equal(v.commit_docs, true);
    assert.ok(r.model.config.other_keys, 'the custom key and the custom rate table are counted, not named');
  });

  test('tests, cost, guard, trace and tool errors are counted in their vocabularies', () => {
    assert.deepEqual(r.model.execution.test.by_status, { failed: '<3' });
    assert.deepEqual(r.model.execution.test.by_source, { 'package.json': '<3' });
    assert.deepEqual(r.model.execution.mutation.score, { '50–80%': '<3' });
    assert.equal(r.model.cost.by_agent['pan-executor'], '$5–10');
    assert.equal(r.model.cost.by_agent.other, '$1–2');
    assert.deepEqual(r.model.guard, { secret_write: { denied: '<3' }, other: { reported: '<3' } });
    assert.deepEqual(r.model.trace.by_category, { other: '<3', tool_error: '<3' });
    assert.deepEqual(r.model.trace.tool_errors, [{ tool: 'Bash', class: 'exit_code', exit_code: 1, sig: 'abcdef012345', count: 4 }]);
  });

  test('the machine block is the model, versioned', () => {
    const block = r.text.match(/```pan-feedback\n(.+)\n```/);
    assert.ok(block);
    const parsed = JSON.parse(block[1]);
    assert.equal(parsed.schema, 'pan-feedback/1');
    assert.deepEqual(parsed, JSON.parse(JSON.stringify(r.model)));
  });
});

describe('feedback report: what it never says', () => {
  let dir;
  let text;
  before(() => {
    dir = seed();
    const r = FB.buildReport(dir, { toolErrors: true });
    assert.equal(r.ok, true, JSON.stringify(r.rules));
    text = r.text;
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (const c of CANARIES) {
    test(`no ${c}`, () => assert.ok(!text.toLowerCase().includes(c.toLowerCase()), `${c} leaked`));
  }

  test('no phase number, no file name, no timestamp', () => {
    assert.ok(!/01-acme|secret-module|\d{4}-\d{2}-\d{2}T/.test(text));
  });
});

describe('feedback report: random free text never leaks (property)', () => {
  test('strings planted in every free-text field never appear, over 25 seeded projects', () => {
    let s = 7;
    const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const word = () => Array.from({ length: 6 + Math.floor(rand() * 6) }, () => 'qxzvkjwy'[Math.floor(rand() * 8)]).join('');
    for (let n = 0; n < 25; n++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-p-'));
      try {
        const planted = Array.from({ length: 6 }, word);
        const P = (...p) => path.join(dir, '.planning', ...p);
        fs.mkdirSync(P('phases', `01-${planted[0]}`), { recursive: true });
        fs.writeFileSync(P('findings.jsonl'), JSON.stringify({ kind: 'finding', ts: new Date().toISOString(), id: 'f_0000000001', phase: '01', agent: planted[1], class: planted[2], severity: 'low', where: planted[3], summary: planted[4] }) + '\n');
        fs.mkdirSync(P('metrics'), { recursive: true });
        fs.writeFileSync(P('metrics', 'tokens.jsonl'), JSON.stringify({ ts: new Date().toISOString(), agent: planted[5], tier: planted[2], model: 'm', cost_usd: 1, output_tokens: 1 }) + '\n');
        const r = FB.buildReport(dir, {});
        assert.equal(r.ok, true, JSON.stringify(r.rules));
        for (const p of planted) assert.ok(!r.text.includes(p), `run ${n}: ${p} leaked`);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
  });
});

describe('feedback report: fail closed', () => {
  test('a leak that gets past the vocabularies refuses the whole report, naming the rule only', () => {
    const r = FB.finalize('## PAN learning report\nsomething at /home/jane/acme and jane@x.example', [{ kind: 'project_dir', value: 'acme' }]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.rules.sort(), ['canary:project_dir', 'email', 'unix_path']);
  });

  test('a canary that is one of PAN\'s own words is skipped, not matched', () => {
    const r = FB.finalize('Commands used: `quick`', [{ kind: 'project_dir', value: 'quick' }], ['quick']);
    assert.deepEqual([r.ok, r.canaries_skipped], [true, 1]);
  });

  test('a note is printed when clean and refuses the report when it holds something private', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-n-'));
    try {
      fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
      const ok = FB.buildReport(dir, { note: 'The review step felt slow on big phases.' });
      assert.equal(ok.ok, true);
      assert.match(ok.text, /> The review step felt slow on big phases\./);
      const bad = FB.buildReport(dir, { note: 'my key is sk-ant-api03-abcdefghijklmnopqrst' });
      assert.deepEqual([bad.ok, bad.error], [false, 'feedback_refused']);
      assert.ok(bad.rules.includes('token'), JSON.stringify(bad.rules));
      assert.match(bad.reason, /--note/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('feedback report: edges and the CLI', () => {
  test('helpers: counts, money and weeks are coarse', () => {
    assert.deepEqual([FB.small(0), FB.small(2), FB.small(3)], [0, '<3', 3]);
    assert.deepEqual([FB.usdBucket(0), FB.usdBucket(0.4), FB.usdBucket(1.5), FB.usdBucket(7), FB.usdBucket(37), FB.usdBucket(120)], ['$0', '<$1', '$1–2', '$5–10', '$20–50', '$100–200']);
    assert.equal(FB.isoWeek(new Date('2026-10-30T12:00:00Z')), '2026-W44');
    assert.equal(FB.isoWeek(new Date('2027-01-01T00:00:00Z')), '2026-W53');
  });

  test('not a PAN project: a clear error and exit 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-e-'));
    try {
      const r = cli(dir);
      assert.equal(r.code, 1);
      assert.equal(JSON.parse(r.out).error, 'not_a_pan_project');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('an empty project prints the header and its machine block', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-e-'));
    try {
      fs.mkdirSync(path.join(dir, '.planning'));
      const r = cli(dir);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /## PAN learning report/);
      assert.match(r.out, /```pan-feedback\n/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI: --format json prints the model, --self-check the scan, --days must be positive', () => {
    const dir = seed();
    try {
      const j = cli(dir, '--format', 'json');
      assert.equal(j.code, 0, j.out);
      assert.equal(JSON.parse(j.out).schema, 'pan-feedback/1');
      const s = JSON.parse(cli(dir, '--self-check').out);
      assert.equal(s.ok, true);
      assert.ok(s.canaries_checked >= 6, JSON.stringify(s));
      assert.equal(cli(dir, '--days', '0').code, 1);
      const shortWindow = JSON.parse(cli(dir, '--format', 'json', '--days', '7').out);
      assert.equal(shortWindow.window.days, 7);
      const bad = cli(dir, '--note', 'reach me at jane@acme-corp.example');
      assert.equal(bad.code, 1);
      assert.ok(!bad.out.includes('jane@'), 'the refusal never repeats what it refused');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
