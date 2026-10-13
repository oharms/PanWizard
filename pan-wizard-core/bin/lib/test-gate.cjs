'use strict';
/**
 * The engine-run test gate (program V2): the test suite is run by pan-tools, in any
 * language, and its result is a record on disk, not a sentence a model wrote.
 *
 * Until now the verifier ran `npm test` itself, read the counts with grep and wrote
 * `test_gate:` into its verification. That only worked for Node's own runner, and the
 * result was the model's word. Here:
 *
 *   command   `workflow.test_command` from config.json, else detected: package.json's
 *             `test` script, pytest, `go test ./...`, cargo, Maven or Gradle, `make test`
 *   run       `pan-tools test run --phase N [--baseline]` runs it and writes
 *             `{NN}-test-baseline.json` (before execution) or `{NN}-test-run.json`
 *   parse     the runner's own output, by its shape: Node's runner (spec, TAP, JUnit),
 *             jest, pytest, go, cargo, and JUnit XML reports (Maven, Gradle, any runner
 *             that writes them), into counts and the ids of the failing tests
 *   classify  passed · failed · skipped. A suite that exits non-zero and reports no
 *             failing test did not run, and that is `failed`, never `skipped`. With a
 *             baseline, a failure the baseline already had is pre-existing, not a
 *             regression; any new one fails the gate. `skipped` means there was nothing
 *             to run (no command, or a command that ran no tests)
 *
 * The verifier copies `test_gate` from the record, reconcile reports a verification
 * that disagrees with it, and the verdict recorder takes a failed run as a code fact
 * that lowers a pass (V9's two-key verdict).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findPhaseInternal, execGit, output, error, toPosix, safeReadFile } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');

const RECORD_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const OUTPUT_TAIL = 4000;
const MAX_IDS = 200;
// npm init's placeholder script: a test script that is not a test suite.
const NPM_PLACEHOLDER_RE = /no test specified/i;

const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
const toLf = (s) => String(s || '').replace(/\r\n?/g, '\n');
// A file in a test id, relative to the project and with forward slashes, whatever OS
// wrote the output and whatever OS reads it: ids must match between a baseline and a run.
const posixRel = (cwd, file) => {
  const f = String(file || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!f) return '';
  const root = cwd ? String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') : '';
  if (root && f.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return f.slice(root.length + 1);
  return f.replace(/^\.\//, '');
};
const xmlText = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
const num = (m) => (m ? Number(m) : 0);

// ─── Detection ───────────────────────────────────────────────────────────────

/** config.json as written (loadConfig flattens the workflow section away). */
function rawConfig(cwd) {
  try { return JSON.parse(fs.readFileSync(planningPath(cwd, 'config.json'), 'utf8')); } catch { return {}; }
}

/**
 * The project's test command.
 * @returns {{command: string|null, source: string|null, reason?: string}}
 */
function detectTestCommand(cwd, config = rawConfig(cwd)) {
  const configured = config && config.workflow && typeof config.workflow.test_command === 'string' ? config.workflow.test_command.trim() : '';
  if (configured) return { command: configured, source: 'config' };
  const has = (f) => fs.existsSync(path.join(cwd, f));
  const read = (f) => safeReadFile(path.join(cwd, f)) || '';
  if (has('package.json')) {
    let pkg = null;
    try { pkg = JSON.parse(read('package.json')); } catch { /* unreadable reads as absent */ }
    const script = pkg && pkg.scripts && typeof pkg.scripts.test === 'string' ? pkg.scripts.test : '';
    if (script && !NPM_PLACEHOLDER_RE.test(script)) return { command: 'npm test', source: 'package.json' };
  }
  if (has('pytest.ini') || has('conftest.py') || /\[tool\.pytest/.test(read('pyproject.toml')) || /\[tool:pytest\]/.test(read('setup.cfg')) || /\[pytest\]/.test(read('tox.ini'))) {
    return { command: 'python -m pytest', source: 'pytest' };
  }
  if (has('go.mod')) return { command: 'go test ./...', source: 'go.mod' };
  if (has('Cargo.toml')) return { command: 'cargo test', source: 'Cargo.toml' };
  if (has('pom.xml')) return { command: 'mvn -q test', source: 'pom.xml' };
  if (has('build.gradle') || has('build.gradle.kts')) return { command: has('gradlew') ? './gradlew test' : 'gradle test', source: 'gradle' };
  if (/^test\s*:/m.test(read('Makefile'))) return { command: 'make test', source: 'Makefile' };
  return { command: null, source: null, reason: 'no test command: set workflow.test_command, or add a test script (package.json, pytest, go.mod, Cargo.toml, Maven, Gradle, Makefile)' };
}

/**
 * The command that runs one test file (V4, V5), or null with a reason. A configured
 * `workflow.test_file_command` with a `{file}` placeholder wins; otherwise it is derived
 * from the suite's runner: node's runner, jest, vitest, mocha, pytest, or go (the file's
 * package). Cargo, Maven, Gradle and make cannot target one file this way.
 */
function fileCommand(cwd, file, config = rawConfig(cwd)) {
  const quoted = JSON.stringify(String(file).replace(/\\/g, '/'));
  const configured = config && config.workflow && typeof config.workflow.test_file_command === 'string' ? config.workflow.test_file_command.trim() : '';
  if (configured) return configured.includes('{file}') ? { command: configured.split('{file}').join(quoted) } : { command: null, reason: 'workflow.test_file_command has no {file} placeholder' };
  const suite = detectTestCommand(cwd, config);
  let script = suite.command || '';
  if (script === 'npm test') {
    try { script = JSON.parse(safeReadFile(path.join(cwd, 'package.json')) || '{}').scripts.test || ''; } catch { script = ''; }
  }
  if (/\bnode\b[^&|;]*--test\b/.test(script)) return { command: `node --test ${quoted}` };
  if (/\bjest\b/.test(script)) return { command: `npx --no-install jest ${quoted}` };
  if (/\bvitest\b/.test(script)) return { command: `npx --no-install vitest run ${quoted}` };
  if (/\bmocha\b/.test(script)) return { command: `npx --no-install mocha ${quoted}` };
  if (/pytest/.test(script)) return { command: `python -m pytest ${quoted}` };
  if (/^go test\b/.test(script)) return { command: `go test ./${path.posix.dirname(String(file).replace(/\\/g, '/'))}` };
  return { command: null, reason: suite.command ? `no per-file command for "${suite.command}": set workflow.test_file_command with a {file} placeholder` : (suite.reason || 'no test command') };
}

/**
 * Run a shell command with the gate's environment; `{exit, timed_out, output}`.
 * NODE_TEST_CONTEXT is how node's runner marks its own children: a `node --test` that
 * inherits it skips every file and exits 0, so a gate run from inside a test process
 * would pass a suite that never ran.
 */
function runCommand(cwd, command, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const env = { ...process.env, CI: process.env.CI || '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env });
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  return { exit: typeof r.status === 'number' ? r.status : (timedOut ? null : 1), timed_out: timedOut, output: `${r.stdout || ''}\n${r.stderr || ''}` };
}

// ─── Parsers (each tested on real emitted output: tests/fixtures/test-runs/) ─

function result(runner, counts, failing, extra = {}) {
  const ids = [...new Set(failing)].slice(0, MAX_IDS);
  return { runner, parsed: true, total: counts.total ?? null, passed: counts.passed ?? null, failed: counts.failed ?? null, skipped: counts.skipped ?? null, failing: ids, ...extra };
}

/** Node's built-in runner, spec reporter. */
function parseNodeSpec(text, cwd) {
  const count = (k) => { const m = text.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')); return m ? Number(m[1]) : null; };
  const failing = [];
  const at = text.indexOf('✖ failing tests:');
  if (at !== -1) {
    let file = '';
    for (const line of text.slice(at).split('\n').slice(1)) {
      const loc = line.match(/^test at (.+?):\d+:\d+$/);
      if (loc) { file = posixRel(cwd, loc[1]); continue; }
      const name = line.match(/^✖ (.+?) \([\d.]+m?s\)$/);
      if (name) failing.push(file ? `${file} > ${name[1]}` : name[1]);
    }
  }
  return result('node', { total: count('tests'), passed: count('pass'), failed: (count('fail') || 0) + (count('cancelled') || 0), skipped: (count('skipped') || 0) + (count('todo') || 0) }, failing);
}

/** Node's built-in runner, TAP reporter (and any TAP 13 producer with node's summary). */
function parseTap(text, cwd) {
  const count = (k) => { const m = text.match(new RegExp(`^# ${k} (\\d+)`, 'm')); return m ? Number(m[1]) : null; };
  const lines = text.split('\n');
  const failing = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)not ok \d+ - (.+?)(?: # .*)?$/);
    if (!m) continue;
    // A suite is reported `not ok` when a child fails; only leaf tests are failures.
    let type = 'test';
    let file = '';
    for (let j = i + 1; j < lines.length && !/^\s*\.\.\.\s*$/.test(lines[j]); j++) {
      const t = lines[j].match(/^\s*type: '(\w+)'/);
      if (t) type = t[1];
      const loc = lines[j].match(/^\s*location: '(.+?):\d+:\d+'/);
      if (loc) file = posixRel(cwd, loc[1].replace(/\\\\/g, '\\'));
      if (/^\s*(not )?ok \d+/.test(lines[j])) break;
    }
    if (type === 'suite') continue;
    failing.push(file ? `${file} > ${m[2]}` : m[2]);
  }
  return result('node-tap', { total: count('tests'), passed: count('pass'), failed: (count('fail') || 0) + (count('cancelled') || 0), skipped: (count('skipped') || 0) + (count('todo') || 0) }, failing);
}

/** jest (Windows and POSIX glyphs; ANSI already stripped). */
function parseJest(text) {
  const testsLine = (text.match(/^Tests:\s+(.+)$/m) || [])[1] || '';
  const pick = (line, k) => { const m = line.match(new RegExp(`(\\d+) ${k}`)); return m ? Number(m[1]) : 0; };
  const failing = [];
  let file = '';
  let crashes = 0;
  for (const line of text.split('\n')) {
    const f = line.match(/^(?:FAIL|PASS)\s+(\S+)/);
    if (f) { file = toPosix(f[1]); continue; }
    const b = line.match(/^\s+● (.+)$/);
    if (!b) continue;
    if (/^Test suite failed to run$/.test(b[1].trim())) { crashes++; failing.push(`${file} (suite failed to run)`); continue; }
    failing.push(`${file} > ${b[1].trim()}`);
  }
  // A suite that failed to run counts as one failure: its tests never reached the total.
  return result('jest', { total: pick(testsLine, 'total'), passed: pick(testsLine, 'passed'), failed: pick(testsLine, 'failed') + crashes, skipped: pick(testsLine, 'skipped') + pick(testsLine, 'todo') }, failing, crashes ? { crashed: true } : {});
}

/** pytest. */
function parsePytest(text) {
  const summary = [...text.matchAll(/^=+ (.+?) in [\d.]+s(?: \([^)]*\))? =+$/gm)].pop();
  const s = summary ? summary[1] : '';
  const pick = (k) => { const m = s.match(new RegExp(`(\\d+) ${k}\\b`)); return m ? Number(m[1]) : 0; };
  const failed = pick('failed');
  const errors = pick('errors') + pick('error');
  const passed = pick('passed');
  const skipped = pick('skipped') + pick('xfailed') + pick('deselected');
  const failing = [...text.matchAll(/^(?:FAILED|ERROR) (\S+)/gm)].map((m) => m[1]);
  const crashed = /error(s)? during collection/.test(text) || (errors > 0 && failed === 0 && passed === 0);
  return result('pytest', { total: passed + failed + errors + skipped + pick('xpassed'), passed, failed: failed + errors, skipped }, failing, crashed ? { crashed: true } : {});
}

/** go test (plain or -v). */
function parseGo(text) {
  const failing = [];
  let pending = [];
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;
  let crashed = false;
  let verbose = false;
  for (const line of text.split('\n')) {
    const t = line.match(/^\s*--- (FAIL|PASS|SKIP): (\S+)/);
    if (t) {
      if (t[1] === 'FAIL') { pending.push(t[2]); failCount++; } else if (t[1] === 'PASS') { passCount++; verbose = true; } else skipCount++;
      continue;
    }
    const pkg = line.match(/^(ok|FAIL)\s+(\S+)(?:\s+\[([^\]]+)\])?/);
    if (pkg && pkg[2] !== '') {
      if (pkg[1] === 'FAIL' && pkg[3]) { crashed = true; failing.push(`${pkg[2]} [${pkg[3]}]`); }
      if (pkg[1] === 'FAIL') failing.push(...pending.map((n) => `${pkg[2]} > ${n}`));
      pending = [];
    }
  }
  failing.push(...pending);
  return result('go', { total: verbose ? passCount + failCount + skipCount : null, passed: verbose ? passCount : null, failed: failCount, skipped: skipCount }, failing, crashed ? { crashed: true } : {});
}

/** cargo test (every `test result:` line summed). */
function parseCargo(text) {
  const totals = { passed: 0, failed: 0, skipped: 0 };
  for (const m of text.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored;/gm)) {
    totals.passed += Number(m[1]); totals.failed += Number(m[2]); totals.skipped += Number(m[3]);
  }
  const failing = [...text.matchAll(/^test (\S+) \.\.\. FAILED$/gm)].map((m) => m[1]);
  return result('cargo', { total: totals.passed + totals.failed + totals.skipped, ...totals }, failing);
}

/** JUnit XML: one report, or several concatenated (Maven, Gradle, pytest --junitxml, node --test-reporter=junit). */
function parseJUnit(text, cwd) {
  let total = 0; let failed = 0; let skipped = 0;
  const failing = [];
  for (const m of text.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    total++;
    const attr = (k) => { const a = m[1].match(new RegExp(`\\b${k}="([^"]*)"`)); return a ? xmlText(a[1]) : ''; };
    const body = m[3] || '';
    if (/<skipped\b/.test(body)) { skipped++; continue; }
    if (/<(failure|error)\b/.test(body) || /\bfailure="/.test(m[1])) {
      failed++;
      const where = attr('file') ? posixRel(cwd, attr('file')) : attr('classname');
      failing.push(where ? `${where} > ${attr('name')}` : attr('name'));
    }
  }
  return result('junit', { total, passed: total - failed - skipped, failed, skipped }, failing);
}

/**
 * Parse a runner's output by its shape. `parsed: false` when no known shape is found.
 * @param {string} raw - stdout and stderr together
 * @param {string} [cwd] - for making absolute file paths in ids relative
 */
function parseTestOutput(raw, cwd) {
  const text = toLf(stripAnsi(raw));
  if (/<testcase\b/.test(text)) return parseJUnit(text, cwd);
  if (/^# tests \d+/m.test(text) && /^\s*(not )?ok \d+/m.test(text)) return parseTap(text, cwd);
  if (/^ℹ tests \d+/m.test(text)) return parseNodeSpec(text, cwd);
  if (/^Tests:\s+.*\d+ total/m.test(text)) return parseJest(text);
  if (/^=+ .*\b(passed|failed|errors?|skipped|no tests ran)\b.* in [\d.]+s.*=+$/m.test(text)) return parsePytest(text);
  if (/^test result: /m.test(text)) return parseCargo(text);
  if (/^(ok|FAIL)\s+\S+/m.test(text) || /^\s*--- (FAIL|PASS):/m.test(text)) return parseGo(text);
  return { runner: null, parsed: false, total: null, passed: null, failed: null, skipped: null, failing: [] };
}

/** JUnit XML reports a Maven or Gradle run leaves behind, read after the run. */
function junitReports(cwd) {
  const dirs = ['target/surefire-reports', 'target/failsafe-reports', 'build/test-results/test'];
  const out = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(path.join(cwd, d)).filter((n) => /\.xml$/i.test(n)); } catch { continue; }
    for (const n of names) out.push(safeReadFile(path.join(cwd, d, n)) || '');
  }
  return out.join('\n');
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * passed · failed · skipped, from one run and an optional baseline. Pure.
 * @param {{command: string|null, exit: number|null, timed_out?: boolean, parse: Object, reason?: string}} run
 * @param {Object|null} baseline - an earlier record of the same command
 */
function classifyRun(run, baseline) {
  if (!run.command) return { status: 'skipped', reason: run.reason || 'no test command', regressions: [], preexisting: [] };
  const p = run.parse || { parsed: false, failing: [] };
  if (run.timed_out) return { status: 'failed', reason: 'the suite timed out', regressions: [], preexisting: [] };
  if (run.exit === 0) {
    if (p.parsed && p.failed > 0) return { status: 'failed', reason: `the runner exited 0 but reported ${p.failed} failure(s)`, regressions: p.failing, preexisting: [] };
    if (p.parsed && p.total === 0) return { status: 'skipped', reason: 'the test command ran no tests', regressions: [], preexisting: [] };
    return { status: 'passed', reason: null, regressions: [], preexisting: [] };
  }
  // pytest's "no tests collected" exit code.
  if (run.exit === 5 && p.runner === 'pytest' && !p.failing.length) return { status: 'skipped', reason: 'the test command ran no tests', regressions: [], preexisting: [] };
  if (!p.parsed || !p.failing.length || p.crashed) {
    return { status: 'failed', reason: `suite did not run: exit ${run.exit}${p.parsed ? '' : ', no test result in its output'}`, regressions: p.failing, preexisting: [] };
  }
  const base = baseline && baseline.command === run.command && Array.isArray(baseline.failing) && baseline.parsed !== false ? new Set(baseline.failing) : null;
  if (!base) return { status: 'failed', reason: `${p.failing.length} failing test(s)`, regressions: p.failing, preexisting: [] };
  const regressions = p.failing.filter((id) => !base.has(id));
  const preexisting = p.failing.filter((id) => base.has(id));
  if (regressions.length) return { status: 'failed', reason: `${regressions.length} regression(s): failing now, passing at the baseline`, regressions, preexisting };
  return { status: 'passed', reason: `${preexisting.length} failure(s) already failing at the baseline (not regressions)`, regressions: [], preexisting };
}

// ─── Running ─────────────────────────────────────────────────────────────────

function headOf(cwd) {
  const r = execGit(cwd, ['rev-parse', 'HEAD']);
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

/** Record paths for a phase. */
function recordPaths(cwd, info) {
  const dir = path.join(cwd, info.directory);
  const prefix = String(info.phase_number).split('.').map((p, i) => (i === 0 ? p.padStart(2, '0') : p)).join('.');
  return { dir, run: path.join(dir, `${prefix}-test-run.json`), baseline: path.join(dir, `${prefix}-test-baseline.json`) };
}

function readRecord(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Run the project's test command and classify the result.
 * @param {string} cwd
 * @param {{command?: string, timeoutMs?: number, baseline?: Object|null, kind?: 'run'|'baseline', phase?: string}} [opts]
 * @returns {Object} the record
 */
function runTests(cwd, opts = {}) {
  const detected = opts.command ? { command: opts.command, source: 'flag' } : detectTestCommand(cwd);
  const started = Date.now();
  const rec = {
    version: RECORD_VERSION, kind: opts.kind || 'run', phase: opts.phase || null,
    command: detected.command, source: detected.source, head: headOf(cwd), started_at: new Date(started).toISOString(),
  };
  if (!detected.command) {
    const c = classifyRun({ command: null, reason: detected.reason });
    return { ...rec, exit: null, duration_ms: 0, runner: null, parsed: false, total: null, passed: null, failed: null, skipped: null, failing: [], status: c.status, reason: c.reason, regressions: [], preexisting_failures: [] };
  }
  const r = runCommand(cwd, detected.command, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  const raw = r.output;
  const timedOut = r.timed_out;
  let parse = parseTestOutput(raw, cwd);
  if (!parse.parsed && /^(mvn|gradle|\.\/gradlew)\b/.test(detected.command)) {
    const reports = junitReports(cwd);
    if (reports) parse = parseJUnit(toLf(reports), cwd);
  }
  const exit = r.exit;
  const c = classifyRun({ command: detected.command, exit, timed_out: timedOut, parse }, opts.baseline || null);
  return {
    ...rec, exit, timed_out: timedOut || undefined, duration_ms: Date.now() - started,
    runner: parse.runner, parsed: parse.parsed, total: parse.total, passed: parse.passed, failed: parse.failed, skipped: parse.skipped,
    failing: parse.failing, status: c.status, reason: c.reason, regressions: c.regressions, preexisting_failures: c.preexisting,
    baseline: opts.baseline ? { head: opts.baseline.head, status: opts.baseline.status, failing: (opts.baseline.failing || []).length } : undefined,
    output_tail: toLf(stripAnsi(raw)).slice(-OUTPUT_TAIL),
  };
}

/** The phase's latest test-run record, or null. */
function readTestRun(cwd, phase) {
  const info = findPhaseInternal(cwd, phase);
  if (!info) return null;
  return readRecord(recordPaths(cwd, info).run);
}

/**
 * The code fact a phase's test run gives the verdict recorder (V9): a failed run lowers a
 * pass. None when the phase has no run record.
 */
function testRunFacts(cwd, phase) {
  const r = readTestRun(cwd, phase);
  if (!r || !r.status) return [];
  if (r.status === 'failed') return [{ fact: 'test_run', ok: false, summary: `The engine's test run failed: ${r.reason || 'see the test-run record'}` }];
  if (r.status === 'passed') return [{ fact: 'test_run', ok: true, summary: 'the engine\'s test run passed' }];
  return [];
}

/**
 * `pan-tools test run [--phase N] [--baseline] [--command "<cmd>"] [--timeout <ms>]`.
 * With --phase, the record is written to the phase directory; a run (not a baseline)
 * is compared with the phase's baseline when there is one.
 */
function cmdTestRun(cwd, opts, raw) {
  let paths = null;
  let baseline = null;
  if (opts.phase) {
    const info = findPhaseInternal(cwd, opts.phase);
    if (!info) error(`phase ${opts.phase} not found`);
    paths = recordPaths(cwd, info);
    if (!opts.baseline) baseline = readRecord(paths.baseline);
    // A baseline is the phase's starting point. A resumed run or a gaps-only round that
    // re-baselined would excuse the regressions of the first round, so the first one is
    // kept unless --rebaseline asks otherwise.
    const existing = opts.baseline && !opts.rebaseline ? readRecord(paths.baseline) : null;
    if (existing) {
      output({ ...existing, kept_existing: true, record: toPosix(path.relative(cwd, paths.baseline)) }, raw, existing.status);
      return;
    }
  }
  const timeoutMs = opts.timeout ? Number(opts.timeout) : undefined;
  const rec = runTests(cwd, { command: opts.command, timeoutMs, baseline, kind: opts.baseline ? 'baseline' : 'run', phase: opts.phase || null });
  if (paths) {
    const file = opts.baseline ? paths.baseline : paths.run;
    fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
    rec.record = toPosix(path.relative(cwd, file));
  }
  output(rec, raw, rec.status);
}

/** `pan-tools test detect`: the command the gate would run, and why. */
function cmdTestDetect(cwd, raw) {
  const d = detectTestCommand(cwd);
  output(d, raw, d.command || '');
}

module.exports = {
  detectTestCommand, parseTestOutput, parseNodeSpec, parseTap, parseJest, parsePytest, parseGo, parseCargo, parseJUnit,
  classifyRun, runTests, readTestRun, testRunFacts, recordPaths, cmdTestRun, cmdTestDetect, stripAnsi,
  fileCommand, runCommand, rawConfig,
};
