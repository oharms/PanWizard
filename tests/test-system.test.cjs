/**
 * The test system's own tests: the surface extractor, the static map, the coverage
 * gate's evaluator and the quality lint (spec §3.3). Everything runs against strings
 * and temp directories; nothing here runs the suite or reads the developer's HOME.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const surfaceMod = require('../scripts/test-surface.cjs');
const gate = require('../scripts/coverage-gate.cjs');
const lint = require('../scripts/test-quality-lint.cjs');

const { ROOT, SOURCES, extractSurface, surfaceRows, mapSurface, diffSurface, scaffold, parseInstallerFlags, parseCaseArms, hookMatrix } = surfaceMod;

describe('test system — surface extractor', () => {
  test('finds the known surface and does not invent one', () => {
    const s = extractSurface(ROOT);
    assert.ok(s.subcommands.includes('state snapshot'), 'the subcommand parse is live');
    assert.ok(s.verbs.includes('state'));
    assert.ok(s.case_arms.includes('cost'));
    assert.ok(s.installer_flags.every((f) => /^--[a-z][a-z-]*$/.test(f)));
  });

  test('--check semantics: an added subcommand or arm in the dispatcher shows up as registry drift', () => {
    const committed = extractSurface(ROOT);
    const src = fs.readFileSync(path.join(ROOT, SOURCES.dispatcher), 'utf8')
      .replace("error('Unknown cost subcommand. Available: report, append, clear, rebuild');",
        "error('Unknown cost subcommand. Available: report, append, clear, rebuild, frobnicate');")
      .replace("case 'cost': {", "case 'frob': {\n      break;\n    }\n    case 'cost': {");
    const fresh = extractSurface(ROOT, { [SOURCES.dispatcher]: src });
    const d = diffSurface(committed, fresh);
    assert.ok(d.added.includes('sub:cost frobnicate'), JSON.stringify(d));
    assert.ok(d.added.includes('arm:frob'));
    assert.deepEqual(d.removed, []);
    assert.deepEqual(diffSurface(committed, committed), { added: [], removed: [] });
  });

  test('a flag literal and its --flag=value spelling are one row; case arms nest by indentation', () => {
    assert.deepEqual(parseInstallerFlags("args.includes('--x'); const v = eq.slice('--x='.length); '--y'"), ['--x', '--y']);
    const arms = parseCaseArms("switch (a) {\n  case 'outer': {\n    switch (b) {\n      case 'inner':\n        go();\n    }\n  }\n  case 'other':\n}");
    assert.deepEqual(arms.map((a) => [a.label, a.parent]), [['outer', null], ['inner', 'outer'], ['other', null]]);
  });

  test('the hook matrix follows HOOK_EVENT_MAP: a runtime with no hook system contributes nothing', () => {
    const rows = hookMatrix({ claude: { surface: 'settings.json', sessionStart: 'SessionStart', postToolUse: 'PostToolUse', subagentStop: 'SubagentStop' }, opencode: null });
    assert.ok(rows.some((r) => r.runtime === 'claude' && r.hook === 'pan-trace-logger.js' && r.event === 'SubagentStop'));
    assert.ok(!rows.some((r) => r.runtime === 'opencode'));
    assert.ok(rows.some((r) => r.runtime === 'claude' && r.hook === 'pan-stop-guard.js'), 'the Stop guard rows come from the installer, not the map');
  });
});

describe('test system — static map and scaffold', () => {
  const rows = [
    { id: 'sub:state snapshot', kind: 'sub', verb: 'state', sub: 'snapshot' },
    { id: 'sub:state nonexistent', kind: 'sub', verb: 'state', sub: 'nonexistent' },
    { id: 'flag:--claude', kind: 'flag', flag: '--claude' },
    { id: 'hook:codex/pan-cost-logger.js', kind: 'hook', runtime: 'codex', hook: 'pan-cost-logger.js' },
    { id: 'config:budget.enforce', kind: 'config', key: 'budget.enforce' },
    { id: 'content:commands/pan', kind: 'content', dir: 'commands/pan' },
  ];
  const sources = [
    { file: 'a.test.cjs', src: "runPanTools('state snapshot', tmp); execSync(`install.js --claude --local`)" },
    { file: 'b.test.cjs', src: "const s = fs.readFileSync(path.join(tmp, '.codex', 'hooks.json')); assert.ok(s.includes('pan-cost-logger'))" },
    { file: 'c.test.cjs', src: "writeConfig({ budget: { enforce: true } }); fs.readdirSync(path.join(root, 'commands', 'pan'))" },
  ];

  test('a named row is found, an unnamed one is missing, hooks need the runtime and the hook together', () => {
    const mapped = mapSurface(rows, sources);
    const hits = Object.fromEntries(mapped.map((r) => [r.id, r.hits]));
    assert.deepEqual(hits['sub:state snapshot'], ['a.test.cjs']);
    assert.deepEqual(hits['sub:state nonexistent'], []);
    assert.deepEqual(hits['flag:--claude'], ['a.test.cjs']);
    assert.deepEqual(hits['hook:codex/pan-cost-logger.js'], ['b.test.cjs']);
    assert.deepEqual(hits['config:budget.enforce'], ['c.test.cjs']);
    assert.deepEqual(hits['content:commands/pan'], ['c.test.cjs']);
  });

  test('scaffold writes one todo stub per missing row, carrying the row id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-scaffold-'));
    try {
      const missing = mapSurface(rows, sources).filter((r) => !r.hits.length);
      const written = scaffold(missing, dir);
      assert.equal(written.length, 1);
      const src = fs.readFileSync(written[0], 'utf8');
      assert.match(src, /sub:state nonexistent/);
      assert.match(src, /test\.todo\(/);
      assert.ok(lint.lintTestSource(src).some((f) => f.rule === 'Q8'), 'a stub fails the quality lint until it is filled');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('test system — coverage gate evaluator', () => {
  const root = 'D:/repo';
  const lcov = (files) => files.map((f) => [
    `SF:${root}/${f.path}`,
    ...(f.fns || []).map(([name, line, hits]) => `FN:${line},${name}\nFNDA:${hits},${name}`),
    ...Object.entries(f.da || {}).map(([ln, c]) => `DA:${ln},${c}`),
    `LF:${f.lf}`, `LH:${f.lh}`, 'end_of_record',
  ].join('\n')).join('\n');
  const dispatcher = "switch (v) {\n  case 'a':\n    one();\n    break;\n  case 'b':\n  case 'c':\n    shared();\n    break;\n  case 'd':\n    never();\n    break;\n}";
  const good = () => gate.parseLcov(lcov([
    { path: 'pan-wizard-core/bin/lib/x.cjs', lf: 100, lh: 96, fns: [['f', 1, 3], ['g', 5, 1]] },
    { path: 'pan-wizard-core/mcp/server.cjs', lf: 50, lh: 49, fns: [['h', 1, 2]] },
    { path: 'bin/install.js', lf: 200, lh: 186, fns: [['i', 1, 1]] },
    { path: 'hooks/pan-cost-logger.js', lf: 80, lh: 75, fns: [['j', 1, 1]] },
    { path: 'pan-wizard-core/bin/pan-tools.cjs', lf: 12, lh: 10, fns: [['main', 1, 1]], da: { 3: 5, 7: 2, 10: 0 } },
  ]));

  test('passes above every floor when every arm ran or is allowlisted; fallthrough labels share the next arm', () => {
    const r = gate.evaluateCoverage(good(), { dispatcherSrc: dispatcher, root, policy: { ...gate.DEFAULT_POLICY, arms_allow: [{ arm: 'd', reason: 'P2 dispatcher-arms test' }] } });
    assert.deepEqual(r.violations, []);
    assert.equal(r.ok, true);
    const byId = Object.fromEntries(r.arms.map((a) => [a.id, a.verdict]));
    assert.equal(byId.a, true);
    assert.equal(byId.b, true, 'the fallthrough label takes the shared arm\'s verdict');
    assert.equal(byId.c, true);
    assert.equal(byId.d, false);
    assert.equal(r.groups.lib.lines, 96);
    assert.equal(r.overall.functions, 100);
  });

  test('fails on an unexecuted arm, on a floor breach, on an allowlist entry without a reason, and on a stale entry', () => {
    const noAllow = gate.evaluateCoverage(good(), { dispatcherSrc: dispatcher, root });
    assert.ok(noAllow.violations.some((v) => /arm never executed: d \(line 9\)/.test(v)), noAllow.violations.join('\n'));
    const lowLib = gate.parseLcov(lcov([{ path: 'pan-wizard-core/bin/lib/x.cjs', lf: 100, lh: 50, fns: [['f', 1, 1]] }]));
    const r = gate.evaluateCoverage(lowLib, { root, policy: gate.DEFAULT_POLICY });
    assert.ok(r.violations.some((v) => /lib line coverage 50% is below the floor 92%/.test(v)));
    assert.ok(r.violations.some((v) => /overall line coverage 50%/.test(v)));
    const noReason = gate.evaluateCoverage(good(), { dispatcherSrc: dispatcher, root, policy: { ...gate.DEFAULT_POLICY, arms_allow: [{ arm: 'd' }] } });
    assert.ok(noReason.violations.some((v) => /has no reason/.test(v)));
    const stale = gate.evaluateCoverage(good(), { dispatcherSrc: dispatcher, root, policy: { ...gate.DEFAULT_POLICY, arms_allow: [{ arm: 'a', reason: 'old' }, { arm: 'd', reason: 'ok' }] } });
    assert.ok(stale.violations.some((v) => /arm "a" is executed now/.test(v)));
  });

  test('fails closed on malformed or empty lcov, and when the dispatcher is missing from the output', () => {
    const empty = gate.evaluateCoverage(gate.parseLcov('this is not lcov'), { dispatcherSrc: dispatcher, root });
    assert.equal(empty.ok, false);
    assert.ok(empty.violations.some((v) => /parsed no files/.test(v)));
    const noDispatcher = gate.evaluateCoverage(gate.parseLcov(lcov([{ path: 'pan-wizard-core/bin/lib/x.cjs', lf: 10, lh: 10, fns: [['f', 1, 1]] }])), { dispatcherSrc: dispatcher, root, policy: { floors: { overall_lines: 0, overall_functions: 0, groups: {} }, arms_allow: [] } });
    assert.ok(noDispatcher.violations.some((v) => /dispatcher was not in the coverage output/.test(v)));
  });

  test('groups files by path and lists never-called functions with their location', () => {
    assert.equal(gate.groupOf('pan-wizard-core/bin/lib/cost.cjs'), 'lib');
    assert.equal(gate.groupOf('pan-wizard-core/bin/pan-tools.cjs'), 'cli');
    assert.equal(gate.groupOf('hooks/pan-cost-logger.js'), 'hooks');
    assert.equal(gate.groupOf('bin/install-lib.cjs'), 'installer');
    const r = gate.evaluateCoverage(gate.parseLcov(lcov([{ path: 'pan-wizard-core/bin/lib/x.cjs', lf: 10, lh: 10, fns: [['used', 1, 4], ['unused', 7, 0]] }])), { root, policy: { floors: { overall_lines: 0, overall_functions: 0, groups: {} }, arms_allow: [] } });
    assert.deepEqual(r.never_called, ['pan-wizard-core/bin/lib/x.cjs:7 unused']);
  });
});

describe('test system — quality lint', () => {
  const findingsOf = (src) => lint.lintTestSource(src, 'x.test.cjs').map((f) => f.rule);

  test('Q1 flags OR-shaped liveness asserts, including multi-line ones; either-format and parsed-payload asserts pass', () => {
    assert.deepEqual(findingsOf("assert.ok(result.output.length > 0 || result.error.length > 0, 'some output');"), ['Q1', 'Q4']);
    assert.deepEqual(findingsOf("assert.ok(\n  parsed.error || parsed.state,\n  'either');"), ['Q1']);
    assert.deepEqual(findingsOf("assert.ok(!result.success || result.output, 'should produce output or proper error');"), ['Q1']);
    assert.deepEqual(findingsOf("assert.ok(r.success || r.error || r.output === '', 'should not crash');"), ['Q1']);
    assert.deepEqual(findingsOf("const r = runPanTools('state json', tmp);\nassert.equal(r.success, true);\nconst j = JSON.parse(r.output);\nassert.equal(j.status, 'ok');"), []);
    assert.deepEqual(findingsOf("assert.ok(content.includes('graph LR') || content.includes('graph TD'), 'either directive');"), [], 'an either-format content check is legitimate');
    assert.deepEqual(findingsOf("assert.ok(a || b);"), [], 'two plain names are not result-status fields');
    assert.deepEqual(findingsOf("assert.equal(a, b || 'default');"), [], 'an OR inside a value expression of assert.equal is not a liveness assert');
  });

  test('Q2 flags an in-process cmd* call and not a destructuring import; Q3 and Q8 flag their shapes', () => {
    assert.deepEqual(findingsOf("cmdCostRebuild(tmp, { apply: true }, false);"), ['Q2']);
    assert.deepEqual(findingsOf("const { cmdCostRebuild } = require('../x.cjs');"), []);
    assert.deepEqual(findingsOf("// cmdFoo( in a comment is fine"), []);
    assert.deepEqual(findingsOf("/**\n * collectHudData() is pure; cmdHud() writes\n */"), [], 'block comment bodies are ignored');
    assert.deepEqual(findingsOf("assert.ok(true, 'reached');"), ['Q3']);
    assert.deepEqual(findingsOf("test.todo('later');"), ['Q8']);
  });

  test('Q5 flags a bare platform return but not t.skip; Q6 flags a tight wall-clock bound; Q7 flags a real HOME read', () => {
    assert.deepEqual(findingsOf("if (process.platform !== 'linux') return;"), ['Q5']);
    assert.deepEqual(findingsOf("if (process.platform !== 'linux') {\n  return;\n}"), ['Q5']);
    assert.deepEqual(findingsOf("if (process.platform !== 'linux') { t.skip('case-sensitive fs only'); return; }"), []);
    assert.deepEqual(findingsOf("assert.ok(elapsed < 1500, 'fast');"), ['Q6']);
    assert.deepEqual(findingsOf("assert.ok(Date.now() - t0 < 15000, 'generous');"), []);
    assert.deepEqual(findingsOf("const home = os.homedir();"), ['Q7']);
    assert.deepEqual(findingsOf("env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome }"), [], 'setting a fake HOME is not a read');
  });

  test('the allowlist is a debt register: counts are exact, reasons are required, stale entries fail', () => {
    const findings = [
      { rule: 'Q1', file: 'a.test.cjs', line: 1 }, { rule: 'Q1', file: 'a.test.cjs', line: 9 }, { rule: 'Q3', file: 'b.test.cjs', line: 2 },
    ];
    let r = lint.applyAllowlist(findings, [{ file: 'a.test.cjs', rule: 'Q1', count: 2, reason: 'legacy scenario asserts, P2' }]);
    assert.deepEqual(r.remaining.map((f) => f.file + f.rule), ['b.test.cjsQ3']);
    assert.deepEqual(r.stale, []);
    r = lint.applyAllowlist(findings, [{ file: 'a.test.cjs', rule: 'Q1', count: 1, reason: 'one only' }]);
    assert.equal(r.remaining.filter((f) => f.file === 'a.test.cjs').length, 1, 'the second occurrence is not covered');
    r = lint.applyAllowlist(findings, [{ file: 'a.test.cjs', rule: 'Q1', count: 5, reason: 'too many' }]);
    assert.ok(r.stale.some((s) => /lower the count/.test(s.why)));
    r = lint.applyAllowlist(findings, [{ file: 'gone.test.cjs', rule: 'Q1', count: 1, reason: 'was here' }]);
    assert.ok(r.stale.some((s) => /remove the entry/.test(s.why)));
    r = lint.applyAllowlist(findings, [{ file: 'a.test.cjs', rule: 'Q1', count: 2 }]);
    assert.ok(r.stale.some((s) => /no reason/.test(s.why)));
  });
});
