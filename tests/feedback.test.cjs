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

  test('a canary that is one of the report template\'s own words (an OS user called node) is skipped', () => {
    const r = FB.finalize('PAN 3.37.0 · claude · local · linux · node 22 · weeks 2026-W31 to 2026-W44', [{ kind: 'os_user', value: 'node' }, { kind: 'host', value: 'tests' }]);
    assert.deepEqual([r.ok, r.canaries_skipped], [true, 2], JSON.stringify(r));
    assert.ok(FB.templateWords().has('node') && FB.templateWords().has('phase'));
    const leak = FB.finalize('report for acme-billing', [{ kind: 'os_user', value: 'acme-billing' }]);
    assert.equal(leak.ok, false, 'a name that is not a template word still refuses');
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

  test('CLI: --days beyond the date range or infinite is refused, not printed as NaN', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-d-'));
    try {
      fs.mkdirSync(path.join(dir, '.planning'));
      for (const d of ['1e9', 'Infinity']) {
        const r = cli(dir, '--days', d);
        assert.equal(r.code, 1, `--days ${d}: ${r.out}`);
        assert.equal(JSON.parse(r.out).error, 'invalid_days');
      }
      const most = cli(dir, '--days', '100000');
      assert.equal(most.code, 0, most.out);
      assert.doesNotMatch(most.out, /NaN/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

/** A bare project: config, phase directories, and optional extra files. */
function bare(config, phases = [], extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-b-'));
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify(config));
  for (const p of phases) fs.mkdirSync(path.join(dir, '.planning', 'phases', p), { recursive: true });
  for (const [rel, text] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

describe('feedback report: settings never name a key the user chose', () => {
  test('x- keys and keys inside open sections are counted, not printed', () => {
    const dir = bare({ 'x-acmecorp': true, model_overrides: { acme_client_bot: true }, focus: { acme_area: true }, cache: { acme_cache: true }, commit_docs: true });
    try {
      const r = FB.buildReport(dir, {});
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.doesNotMatch(r.text, /acme/i);
      assert.equal(r.model.config.values.commit_docs, true, 'a closed PAN key is still reported');
      assert.equal(r.model.config.other_keys, 4);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('feedback report: a phase named like PAN\'s own words does not refuse the report', () => {
  const now = new Date().toISOString();
  const cases = [
    ['part of a printed key (model_profile)', { model_profile: 'balanced' }, ['03-profile'], {}],
    ['a config section the report prints (routing.strategy)', { routing: { strategy: 'static' } }, ['03-routing'], {}],
    ['a config section the report prints (hooks.guard)', { hooks: { guard: 'enforce' } }, ['04-hooks'], {}],
    ['part of a trace event type (memory_hit)', {}, ['05-memory'], { '.planning/optimization/traces/sess_1/trace.jsonl': JSON.stringify({ ts: now, type: 'memory_hit', category: 'context' }) + '\n' }],
    ['a finding class (partial)', {}, ['06-partial'], { '.planning/findings.jsonl': JSON.stringify({ kind: 'finding', ts: now, id: 'f_0000000001', phase: '06', agent: 'pan-verifier', class: 'partial', severity: 'medium' }) + '\n' }],
  ];
  for (const [name, config, phases, extra] of cases) {
    test(name, () => {
      const dir = bare(config, phases, extra);
      try {
        const r = FB.buildReport(dir, {});
        assert.equal(r.ok, true, JSON.stringify({ error: r.error, rules: r.rules }));
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }

  test('a phase name that is not PAN\'s still refuses when it leaks', () => {
    const r = FB.finalize('model_profile=balanced acme-billing', [{ kind: 'phase_name', value: 'acme-billing' }, { kind: 'phase_name', value: 'profile' }]);
    assert.deepEqual([r.ok, r.rules, r.canaries_skipped], [false, ['canary:phase_name'], 1]);
  });
});

describe('feedback report: the refusal blames --note only for what finalize matched', () => {
  test('a note holding a skipped canary is not blamed; one holding a path is', () => {
    const canaries = [{ kind: 'os_user', value: 'node' }];
    assert.equal(FB.noteRefused('node 22 crashed on review', canaries), false);
    assert.equal(FB.noteRefused(`see ${FB.ISSUE_URL}`, canaries), false);
    assert.equal(FB.noteRefused('it failed in C:\\Users\\jane\\acme', canaries), true);
    assert.equal(FB.noteRefused(null, canaries), false);
  });
});

describe('feedback report: the window applies to test runs, mutation reports and usage', () => {
  test('records older than --days are left out', () => {
    const old = '2020-01-06T10:00:00.000Z';
    const dir = bare({}, ['01-old'], {
      '.planning/phases/01-old/01-test-run.json': JSON.stringify({ status: 'failed', source: 'config', started_at: old }),
      '.planning/phases/01-old/01-mutation.json': JSON.stringify({ score: 0.9 }),
      '.planning/optimization/traces/sess_old/session.json': JSON.stringify({ session_id: 'sess_old', command: 'exec-phase', started_at: old, ended_at: null }),
      '.planning/optimization/traces/sess_old/trace.jsonl': '',
    });
    try {
      const mut = path.join(dir, '.planning', 'phases', '01-old', '01-mutation.json');
      fs.utimesSync(mut, new Date(old), new Date(old));
      const all = FB.collect(dir, { days: 100000 });
      assert.deepEqual([all.execution.test.runs, all.execution.mutation.reports, all.usage.commands_used], ['<3', '<3', ['exec-phase']]);
      const recent = FB.collect(dir, { days: 30 });
      assert.deepEqual([recent.execution.test.runs, recent.execution.mutation.reports, recent.usage.commands_used, recent.usage.commands_unfinished], [0, 0, [], []]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('feedback report: the install it runs from', () => {
  const make = (rel, files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-i-'));
    const dir = path.join(root, rel);
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), text);
    }
    return { root, dir };
  };
  const cases = [
    ['global Copilot (~/.copilot)', '.copilot', { 'pan-file-manifest.json': '{}', 'agents/pan-planner.agent.md': '' }, 'copilot'],
    ['global OpenCode (~/.config/opencode)', path.join('.config', 'opencode'), { 'pan-file-manifest.json': '{}', 'commands/pan-quick.md': '' }, 'opencode'],
    ['a --config-dir with any name (Gemini)', 'gemini-work', { 'pan-file-manifest.json': '{}', 'commands/pan/quick.toml': '' }, 'gemini'],
    ['a --config-dir with any name (Codex)', 'codex-work', { 'pan-file-manifest.json': '{}', 'config.toml': '' }, 'codex'],
  ];
  for (const [name, rel, files, runtime] of cases) {
    test(name, () => {
      const { root, dir } = make(rel, files);
      const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-p-'));
      try {
        const pan = FB.collectInstall(proj, dir);
        assert.deepEqual([pan.runtimes, pan.scope], [[runtime], 'global']);
      } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true }); }
    });
  }

  test('local when the install is inside the project, whatever the drive-letter case', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-p-'));
    try {
      fs.mkdirSync(path.join(proj, '.claude'));
      fs.writeFileSync(path.join(proj, '.claude', 'pan-file-manifest.json'), '{}');
      const flip = process.platform === 'win32' ? proj.replace(/^[a-z]/i, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())) : proj;
      const pan = FB.collectInstall(flip, path.join(proj, '.claude'));
      assert.deepEqual([pan.runtimes, pan.scope], [['claude'], 'local']);
    } finally { fs.rmSync(proj, { recursive: true, force: true }); }
  });

  test('a checkout with no manifest is the source', () => {
    assert.equal(FB.collectInstall(os.tmpdir(), path.join(__dirname, '..')).scope, 'source');
  });

  test('a project at a drive or filesystem root still has its install read as local', () => {
    // The root path already ends in a separator; a shared .agents core needs no manifest, so nothing is written.
    const fsRoot = path.parse(os.tmpdir()).root;
    assert.equal(FB.collectInstall(fsRoot, path.join(fsRoot, 'pan-fb-none', '.agents')).scope, 'local');
    assert.equal(FB.collectInstall(path.join(fsRoot, 'pan-fb-a'), path.join(fsRoot, 'pan-fb-ab', '.agents')).scope, 'global');
  });
});

describe('feedback report: the window, applied the same way everywhere', () => {
  const now = new Date().toISOString();
  const old = '2020-01-06T10:00:00.000Z';
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

  test('a finding raised before the window and dismissed inside it counts', () => {
    const dir = bare({}, [], {
      '.planning/findings.jsonl': jsonl([
        { kind: 'finding', ts: old, id: 'f_0000000001', phase: '01', agent: 'pan-reviewer', class: 'quality', severity: 'low' },
        { kind: 'verdict', ts: old, verdict_id: 'v_1', phase: '01', agent: 'pan-reviewer', outcome: 'fail', finding_ids: ['f_0000000001'] },
        { kind: 'disposition', ts: now, id: 'f_0000000001', disposition: 'dismissed', reason: 'noise' },
        { kind: 'finding', ts: old, id: 'f_0000000002', phase: '01', agent: 'pan-reviewer', class: 'defect', severity: 'low' },
      ]),
    });
    try {
      const j = FB.collect(dir, { days: 30 }).judges;
      assert.deepEqual(j['pan-reviewer'].by_class, { quality: { total: '<3', dismissed: '<3' } }, 'the untouched old finding stays out');
      assert.equal(j['pan-reviewer'].verdicts, 0, 'the old verdict stays out');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a timestamp that does not parse is kept by every section alike', () => {
    const bad = 'not-a-date';
    const dir = bare({}, [], {
      '.planning/findings.jsonl': jsonl([{ kind: 'finding', ts: bad, id: 'f_0000000003', phase: '01', agent: 'pan-reviewer', class: 'quality', severity: 'low' }]),
      '.planning/guard.jsonl': jsonl([{ ts: bad, rule: 'secret_write', action: 'denied' }]),
      '.planning/optimization/traces/sess_1/trace.jsonl': jsonl([{ ts: bad, type: 'error', category: 'tool_error' }]),
    });
    try {
      const m = FB.collect(dir, { days: 30 });
      assert.ok(m.judges['pan-reviewer'], 'findings');
      assert.ok(m.guard.secret_write, 'guard');
      assert.equal(m.trace.sessions, '<3', 'trace');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('phase budget and forecast count only phases that spent inside the window', () => {
    const dir = bare({}, ['01-old'], {
      '.planning/metrics/tokens.jsonl': jsonl([{ ts: old, agent: 'pan-executor', tier: 'mid', model: 'm', phase: '01', cost_usd: 4, output_tokens: 1 }]),
    });
    try {
      assert.equal(FB.collect(dir, { days: 100000 }).cost.budget.phases, '<3');
      assert.equal(FB.collect(dir, { days: 30 }).cost.budget.phases, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('feedback report: suggestions name PAN\'s judges and classes only', () => {
  test('no judge_noise for the other bucket, judge or class', () => {
    const many = { total: 12, dismissed: 10 };
    const s = FB.suggestions({ judges: { other: { by_class: { quality: many } }, 'pan-reviewer': { by_class: { other: many, quality: many } } } });
    assert.deepEqual(s.map((x) => [x.id, x.evidence.agent, x.evidence.class]), [['judge_noise', 'pan-reviewer', 'quality']]);
  });
});

describe('feedback report: CLI flags without their value are errors', () => {
  test('--note or --days with no value, or followed by another flag, and an unknown --format, exit 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fb-f-'));
    try {
      fs.mkdirSync(path.join(dir, '.planning'));
      for (const [args, error] of [[['--note'], 'invalid_note'], [['--note', '--tool-errors'], 'invalid_note'], [['--days'], 'invalid_days'], [['--days', '--tool-errors'], 'invalid_days'], [['--format', 'jsn'], 'invalid_format'], [['--format'], 'invalid_format']]) {
        const r = cli(dir, ...args);
        assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
        assert.equal(JSON.parse(r.out).error, error, args.join(' '));
      }
      assert.equal(cli(dir, '--format', 'md').code, 0);
      const dashed = cli(dir, '--note', '--force felt slow');
      assert.equal(dashed.code, 0, 'a note that starts with dashes is still a note');
      assert.match(dashed.out, /> --force felt slow/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('feedback command: the note never reaches the shell unquoted', () => {
  test('the prompt builds the command with the note in single quotes, not $ARGUMENTS', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'commands', 'pan', 'feedback.md'), 'utf-8');
    assert.doesNotMatch(md, /feedback \$ARGUMENTS/);
    assert.match(md, /single quotes/);
    assert.ok(md.includes(`'\\''`), 'says how to write an apostrophe inside the quotes');
    assert.ok(md.includes(`didn''t`), 'and how PowerShell writes one');
  });

  test('no example opts the user into --tool-errors: a model copying it would add data the user did not ask for', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'commands', 'pan', 'feedback.md'), 'utf-8');
    const commands = md.split('\n').filter((l) => /pan-tools\.cjs feedback/.test(l));
    assert.ok(commands.length >= 2);
    assert.ok(commands.some((l) => /feedback\s*$/.test(l)), 'the bare command is shown');
    for (const l of commands) assert.doesNotMatch(l, /--tool-errors/);
  });
});
