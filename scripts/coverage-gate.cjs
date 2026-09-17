#!/usr/bin/env node
'use strict';
/**
 * coverage-gate.cjs — did the shipped code actually run under the tests?
 *
 * Runs the whole suite under Node's own coverage instrumentation (no dependency:
 * `node --test --experimental-test-coverage`, lcov reporter; the child processes
 * the tests spawn — pan-tools, the installer, the hooks — are captured through the
 * inherited NODE_V8_COVERAGE), then enforces:
 *   - line and function floors overall and per module group (tests/fixtures/
 *     coverage-policy.json — a floor sits a point below the measured baseline, so
 *     a real regression fails and normal churn does not);
 *   - every dispatcher `case` arm executed at least once — the binary rule that
 *     catches "a verb no test dispatches", which a percentage hides. An arm may be
 *     allowlisted in the policy with a reason (interactive, network, a P2 item).
 * The never-called functions are printed, ranked, so a gap has a name.
 *
 *   node scripts/coverage-gate.cjs             run the suite, evaluate, exit 1 on a violation
 *   node scripts/coverage-gate.cjs --lcov f    evaluate an existing lcov file (no run)
 *   node scripts/coverage-gate.cjs --json      machine-readable result
 *
 * Node < 22 lacks the coverage include/exclude flags: the gate reports "skipped"
 * and exits 0 there, so the 18/20 CI jobs stay green and the 22 job carries it.
 * Wired as release-check Gate 9 and as an advisory CI step on the Node 22 job.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseCaseArms } = require('./test-surface.cjs');

const ROOT = path.resolve(__dirname, '..');
const POLICY_REL = path.join('tests', 'fixtures', 'coverage-policy.json');
const DISPATCHER_REL = 'pan-wizard-core/bin/pan-tools.cjs';
const TEST_DIRS = ['tests', 'tests/scenarios'];
const INCLUDE = ['pan-wizard-core/**/*.cjs', 'pan-wizard-core/**/*.js', 'bin/**', 'hooks/*.js', 'scripts/**'];
const EXCLUDE = ['tests/**', '**/node_modules/**'];
const MIN_NODE_MAJOR = 22;

const DEFAULT_POLICY = Object.freeze({
  floors: { overall_lines: 92, overall_functions: 93, groups: { lib: 92, installer: 90, hooks: 90, mcp: 95 } },
  arms_allow: [],
});

// ─── lcov ───────────────────────────────────────────────────────────────────

/** Parse lcov text into [{ path, lines: Map(line→hits), fn: Map(name→line), fnda: Map(name→hits), lf, lh, brf, brh }]. */
function parseLcov(text) {
  const files = [];
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const ci = raw.indexOf(':');
    const k = ci >= 0 ? raw.slice(0, ci) : raw;
    const v = ci >= 0 ? raw.slice(ci + 1) : '';
    if (k === 'SF') { cur = { path: v.split('\\').join('/'), lines: new Map(), fn: new Map(), fnda: new Map(), lf: 0, lh: 0, brf: 0, brh: 0 }; continue; }
    if (!cur) continue;
    if (k === 'DA') { const [ln, c] = v.split(',').map(Number); cur.lines.set(ln, c); }
    else if (k === 'FN') { const i = v.indexOf(','); cur.fn.set(v.slice(i + 1), Number(v.slice(0, i))); }
    else if (k === 'FNDA') { const i = v.indexOf(','); cur.fnda.set(v.slice(i + 1), Number(v.slice(0, i))); }
    else if (k === 'LF') cur.lf = Number(v); else if (k === 'LH') cur.lh = Number(v);
    else if (k === 'BRF') cur.brf = Number(v); else if (k === 'BRH') cur.brh = Number(v);
    else if (raw === 'end_of_record') { files.push(cur); cur = null; }
  }
  return files;
}

function relPath(p, root = ROOT) {
  const r = root.split('\\').join('/');
  const i = p.indexOf(r);
  return i >= 0 ? p.slice(i + r.length).replace(/^\//, '') : p;
}

function groupOf(rel) {
  if (/^pan-wizard-core\/bin\/lib\//.test(rel)) return 'lib';
  if (/^pan-wizard-core\/mcp\//.test(rel)) return 'mcp';
  if (/^pan-wizard-core\/bin\//.test(rel)) return 'cli';
  if (/^pan-wizard-core\/workflows\//.test(rel)) return 'native-workflows';
  if (/^bin\//.test(rel)) return 'installer';
  if (/^hooks\//.test(rel)) return 'hooks';
  if (/^scripts\//.test(rel)) return 'scripts';
  return 'other';
}

/**
 * Which case arms executed. An arm is executed when the first instrumented line
 * after its label (before the next arm at the same or a shallower indent) ran; a
 * label immediately followed by another label shares that arm's body (fallthrough).
 */
function armCoverage(dispatcherSrc, dispatcherFile) {
  const arms = parseCaseArms(dispatcherSrc);
  const byLine = new Map(arms.map((a) => [a.line, a]));
  const lines = dispatcherSrc.split(/\r?\n/);
  const da = dispatcherFile ? dispatcherFile.lines : new Map();
  const result = [];
  for (const a of arms) {
    let verdict = null;
    for (let ln = a.line + 1; ln <= lines.length; ln++) {
      const nxt = byLine.get(ln);
      if (nxt && nxt.indent <= a.indent) {
        if (nxt.indent === a.indent && /^\s*case\s+'/.test(lines[ln - 1])) verdict = 'fallthrough';
        break;
      }
      if (da.has(ln)) { verdict = da.get(ln) > 0; break; }
    }
    result.push({ id: a.parent ? `${a.parent} > ${a.label}` : a.label, line: a.line, verdict });
  }
  // A fallthrough label takes the verdict of the arm it shares.
  for (let i = 0; i < result.length; i++) {
    if (result[i].verdict === 'fallthrough') {
      let j = i + 1;
      while (j < result.length && result[j].verdict === 'fallthrough') j++;
      result[i].verdict = j < result.length ? result[j].verdict : null;
    }
  }
  return result;
}

function validatePolicy(policy) {
  const errors = [];
  for (const a of policy.arms_allow || []) {
    if (!a || typeof a.arm !== 'string') errors.push(`arms_allow entry without an arm: ${JSON.stringify(a)}`);
    else if (!a.reason || !String(a.reason).trim()) errors.push(`arms_allow entry "${a.arm}" has no reason`);
  }
  return errors;
}

/**
 * Evaluate parsed lcov against the policy and the dispatcher source.
 * Pure. Returns { ok, violations[], groups, overall, arms, never_called, policy_errors }.
 */
function evaluateCoverage(lcovFiles, { dispatcherSrc, policy = DEFAULT_POLICY, root = ROOT } = {}) {
  const violations = [];
  const policyErrors = validatePolicy(policy);
  violations.push(...policyErrors.map((e) => `policy: ${e}`));
  if (!lcovFiles.length) violations.push('lcov parsed no files — malformed or empty coverage output (failing closed)');

  const groups = {};
  const overall = { lf: 0, lh: 0, ff: 0, fh: 0 };
  const neverCalled = [];
  let dispatcherFile = null;
  for (const f of lcovFiles) {
    const rel = relPath(f.path, root);
    if (rel.endsWith(DISPATCHER_REL) || rel === DISPATCHER_REL) dispatcherFile = f;
    const g = groupOf(rel);
    const fns = [...f.fn.keys()];
    const fh = fns.filter((n) => (f.fnda.get(n) || 0) > 0).length;
    const acc = groups[g] = groups[g] || { files: 0, lf: 0, lh: 0, ff: 0, fh: 0 };
    acc.files++; acc.lf += f.lf; acc.lh += f.lh; acc.ff += fns.length; acc.fh += fh;
    overall.lf += f.lf; overall.lh += f.lh; overall.ff += fns.length; overall.fh += fh;
    for (const n of fns) if (!((f.fnda.get(n) || 0) > 0)) neverCalled.push(`${rel}:${f.fn.get(n)} ${n || '(anonymous)'}`);
  }
  const pct = (h, t) => (t ? Math.round((h / t) * 1000) / 10 : 100);
  const overallPct = { lines: pct(overall.lh, overall.lf), functions: pct(overall.fh, overall.ff) };
  const floors = policy.floors || DEFAULT_POLICY.floors;
  if (lcovFiles.length) {
    if (overallPct.lines < floors.overall_lines) violations.push(`overall line coverage ${overallPct.lines}% is below the floor ${floors.overall_lines}%`);
    if (overallPct.functions < floors.overall_functions) violations.push(`overall function coverage ${overallPct.functions}% is below the floor ${floors.overall_functions}%`);
    for (const [g, floor] of Object.entries(floors.groups || {})) {
      const acc = groups[g];
      if (!acc) { violations.push(`group "${g}" has no files under coverage — include globs or layout changed`); continue; }
      const p = pct(acc.lh, acc.lf);
      if (p < floor) violations.push(`${g} line coverage ${p}% is below the floor ${floor}%`);
    }
  }

  let arms = [];
  if (dispatcherSrc) {
    arms = armCoverage(dispatcherSrc, dispatcherFile);
    const allow = new Map((policy.arms_allow || []).map((a) => [a.arm, a.reason]));
    if (!dispatcherFile && lcovFiles.length) violations.push('the dispatcher was not in the coverage output — no test ran pan-tools.cjs?');
    for (const a of arms) {
      if (a.verdict === true) continue;
      if (allow.has(a.id)) { a.allowlisted = allow.get(a.id); continue; }
      violations.push(`dispatcher arm never executed: ${a.id} (line ${a.line}) — add a test that dispatches it, or allowlist it in ${POLICY_REL} with a reason`);
    }
    for (const [arm] of allow) if (!arms.some((a) => a.id === arm)) violations.push(`policy: arms_allow names an arm that no longer exists: ${arm}`);
    for (const [arm, reason] of allow) { const a = arms.find((x) => x.id === arm); if (a && a.verdict === true) violations.push(`policy: arm "${arm}" is executed now — remove its allowlist entry (${reason})`); }
  }

  const groupTable = Object.fromEntries(Object.entries(groups).map(([g, a]) => [g, { files: a.files, lines: pct(a.lh, a.lf), functions: pct(a.fh, a.ff) }]));
  return { ok: violations.length === 0, violations, overall: overallPct, groups: groupTable, arms, never_called: neverCalled.sort(), policy_errors: policyErrors };
}

// ─── Running the suite ──────────────────────────────────────────────────────

function expandTestFiles(root = ROOT, dirs = TEST_DIRS) {
  const files = [];
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    let entries = [];
    try { entries = fs.readdirSync(abs); } catch { continue; }
    for (const f of entries) if (f.endsWith('.test.cjs')) files.push(path.join(abs, f));
  }
  return files.sort();
}

function runSuiteWithCoverage(root = ROOT, lcovPath) {
  const specLog = lcovPath + '.spec.log';
  const args = ['--test', '--experimental-test-coverage'];
  for (const g of INCLUDE) args.push(`--test-coverage-include=${g}`);
  for (const g of EXCLUDE) args.push(`--test-coverage-exclude=${g}`);
  args.push('--test-reporter=lcov', `--test-reporter-destination=${lcovPath}`, '--test-reporter=spec', `--test-reporter-destination=${specLog}`);
  args.push(...expandTestFiles(root));
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, specLog, stderr: r.stderr || '' };
}

function loadPolicy(root = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, POLICY_REL), 'utf8')); } catch { return DEFAULT_POLICY; }
}

function render(result) {
  const lines = [];
  lines.push(`coverage gate — ${result.ok ? 'OK' : 'FAIL'}`);
  lines.push(`  overall: lines ${result.overall.lines}% · functions ${result.overall.functions}%`);
  for (const [g, a] of Object.entries(result.groups).sort()) lines.push(`  ${g.padEnd(18)} files ${String(a.files).padStart(3)}  lines ${String(a.lines).padStart(5)}%  functions ${String(a.functions).padStart(5)}%`);
  const executed = result.arms.filter((a) => a.verdict === true).length;
  const allowed = result.arms.filter((a) => a.allowlisted).length;
  lines.push(`  dispatcher arms: ${executed}/${result.arms.length} executed${allowed ? `, ${allowed} allowlisted` : ''}`);
  if (result.never_called.length) {
    lines.push(`  never-called functions: ${result.never_called.length} (first 12)`);
    for (const n of result.never_called.slice(0, 12)) lines.push(`    ${n}`);
  }
  for (const v of result.violations) lines.push(`  ✖ ${v}`);
  return lines.join('\n');
}

function main(argv) {
  const major = Number(process.versions.node.split('.')[0]);
  const lcovArg = argv.includes('--lcov') ? argv[argv.indexOf('--lcov') + 1] : null;
  if (!lcovArg && major < MIN_NODE_MAJOR) {
    console.log(`coverage gate — skipped on Node ${process.versions.node} (needs ${MIN_NODE_MAJOR}+ for coverage include/exclude flags)`);
    return 0;
  }
  let lcovPath = lcovArg;
  let tmp = null;
  if (!lcovPath) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-coverage-'));
    lcovPath = path.join(tmp, 'coverage.lcov');
    const r = runSuiteWithCoverage(ROOT, lcovPath);
    if (r.status !== 0) {
      console.error(`coverage gate — the suite itself failed (exit ${r.status}); see ${r.specLog}`);
      return 1;
    }
  }
  let text = '';
  try { text = fs.readFileSync(lcovPath, 'utf8'); } catch (e) { console.error(`coverage gate — cannot read ${lcovPath}: ${e.message}`); return 1; }
  const result = evaluateCoverage(parseLcov(text), { dispatcherSrc: fs.readFileSync(path.join(ROOT, DISPATCHER_REL), 'utf8'), policy: loadPolicy(ROOT), root: ROOT });
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log(render(result));
  if (tmp && !argv.includes('--keep')) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ } }
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { parseLcov, groupOf, armCoverage, evaluateCoverage, validatePolicy, expandTestFiles, render, DEFAULT_POLICY, POLICY_REL, INCLUDE, EXCLUDE, MIN_NODE_MAJOR };
