#!/usr/bin/env node
/**
 * local-ci.cjs — run the GitHub CI gates on this machine (`npm run ci:local`).
 *
 * Runs in parallel, each gate with its own log and temp directory (whole-suite runs are
 * staged so they do not starve each other: containers first, then the host runs one at a time):
 *
 *   host-node<N>    the unit + scenario suite on the host, once per Node version fnm
 *                  has installed (18, 20, 22); without fnm, once on the current Node
 *                  and the other versions are reported skipped
 *   linux-node<N>  the suite under Node 18, 20 and 22 in node:<N>-bookworm containers,
 *                  the repo mounted read-only and copied in (needs Docker)
 *   harness        the PAN Harness at tier 0 with --no-ledger
 *   gitleaks       secret scan of the history with .gitleaks.toml
 *   audit          npm audit --omit=dev --audit-level=high
 *   links          pan-tools links validate
 *   surface        scripts/test-surface.cjs --check (the suite checks it too; this
 *                  names the failure)
 *   coverage       scripts/coverage-gate.cjs
 *   codescan       Semgrep in Docker or the CodeQL CLI, only with --codescan
 *   clean-tree     after every other gate: the working tree is as it was before the
 *                  run (the local form of CI's `git diff --exit-code`, which tolerates
 *                  uncommitted work you started with)
 *
 * A tool that is not installed is reported SKIP, never PASS. Any FAIL exits 1;
 * --strict makes a SKIP fail too. The report goes to .ci-local/report.json.
 *
 * Usage:
 *   node scripts/local-ci.cjs                     every gate
 *   node scripts/local-ci.cjs --fast              the pre-push subset: host suite on the
 *                                                 current Node, harness, gitleaks
 *   node scripts/local-ci.cjs --only host,gitleaks gates whose id starts with a listed name
 *   node scripts/local-ci.cjs --codescan          add code scanning (semgrep, the default,
 *                                                 or --codescan=codeql); changed files
 *                                                 against main, or all with --codescan-all
 *   node scripts/local-ci.cjs --no-docker         skip the container gates
 *   node scripts/local-ci.cjs --jobs 4            at most 4 light gates at once (default 6)
 *   node scripts/local-ci.cjs --root <dir>        run against another checkout
 *   node scripts/local-ci.cjs --strict            a skipped gate fails the run
 */

'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const NODE_VERSIONS = ['18', '20', '22'];
// Pinned like the CI actions are: a moving tag would change the scan under you.
const SEMGREP_IMAGE = process.env.PAN_CI_SEMGREP_IMAGE || 'semgrep/semgrep:1.90.0';
const CODE_EXT = /\.(c?js|mjs)$/;
const GATE_TIMEOUT_MS = 30 * 60 * 1000;
const FAST_IDS = ['host-current', 'harness', 'gitleaks'];

function parseArgs(argv) {
  const a = { fast: false, only: null, codescan: null, codescanAll: false, docker: true, jobs: 6, root: path.resolve(__dirname, '..'), strict: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--fast') a.fast = true;
    else if (k === '--only') a.only = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--codescan') a.codescan = 'semgrep';
    else if (k.startsWith('--codescan=')) a.codescan = k.slice('--codescan='.length);
    else if (k === '--codescan-all') { a.codescanAll = true; a.codescan = a.codescan || 'semgrep'; }
    else if (k === '--no-docker') a.docker = false;
    else if (k === '--jobs') a.jobs = Math.max(1, Number(argv[++i]) || 1);
    else if (k === '--root') a.root = path.resolve(argv[++i] || '.');
    else if (k === '--strict') a.strict = true;
    else if (k === '--json') a.json = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown option: ${k}`);
  }
  if (a.codescan && !['semgrep', 'codeql'].includes(a.codescan)) throw new Error(`--codescan takes semgrep or codeql, got ${a.codescan}`);
  return a;
}

// PATH lookup without a shell, honouring PATHEXT on Windows. Returns the full path or null.
function which(cmd, env = process.env) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['', ...String(env.PATHEXT || '.EXE;.CMD;.BAT').toLowerCase().split(';')] : [''];
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, cmd + e);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

function quick(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, windowsHide: true, ...opts });
  return { status: r.error ? null : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Majors fnm has installed, e.g. ['18', '22']. `fnm list` prints "* v18.20.4 default".
function fnmMajors(fnm, env) {
  const r = quick(fnm, ['list'], { env });
  if (r.status !== 0) return [];
  return [...new Set([...r.stdout.matchAll(/v(\d+)\.\d+\.\d+/g)].map(m => m[1]))];
}

function dockerUp(docker, env) {
  return !!docker && quick(docker, ['info', '--format', '{{.ServerVersion}}'], { env }).status === 0;
}

// Fingerprint of the working tree: tracked changes plus untracked, non-ignored files.
function treeState(root, env) {
  const st = quick('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, env, maxBuffer: 64 * 1024 * 1024 });
  if (st.status !== 0) return null;
  const diff = quick('git', ['diff', 'HEAD', '--binary'], { cwd: root, env, maxBuffer: 256 * 1024 * 1024 });
  return { lines: st.stdout.split('\n').filter(Boolean), hash: crypto.createHash('sha256').update(st.stdout + '\0' + diff.stdout).digest('hex') };
}

function changedCodeFiles(root, env) {
  const base = quick('git', ['merge-base', 'HEAD', 'main'], { cwd: root, env }).stdout.trim();
  const tracked = base ? quick('git', ['diff', '--name-only', '--diff-filter=ACMR', base], { cwd: root, env }).stdout : '';
  const untracked = quick('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, env }).stdout;
  return [...new Set((tracked + '\n' + untracked).split('\n').map(s => s.trim()).filter(f => CODE_EXT.test(f) && fs.existsSync(path.join(root, f))))];
}

// Every gate is { id, title, cmd, args, opts, skip?, interpret? }. A gate with `skip` set is
// reported SKIP with that reason and never runs. `interpret(result)` may turn an exit-0 run
// into a skip (coverage on old Node) or add a detail line.
function planGates(o, env = process.env) {
  const root = o.root;
  const node = process.execPath;
  const cur = process.versions.node.split('.')[0];
  const suite = ['scripts/run-tests.cjs', 'tests', 'tests/scenarios'];
  const gates = [];
  const want = (id) => {
    if (o.fast) return FAST_IDS.some(f => id === f || (f === 'host-current' && id === `host-node${cur}`));
    if (!o.only) return true;
    return o.only.some(p => id.startsWith(p));
  };
  const shell = process.platform === 'win32';

  // Host suite, per Node version.
  const fnm = which('fnm', env);
  const majors = fnm ? fnmMajors(fnm, env) : [];
  if (o.fast || !fnm) {
    gates.push({ id: `host-node${cur}`, title: `${process.platform} suite · node ${process.versions.node} (current${fnm ? '' : '; fnm not installed'})`, cmd: node, args: suite });
    if (!o.fast) for (const v of NODE_VERSIONS) {
      if (v !== cur) gates.push({ id: `host-node${v}`, title: `${process.platform} suite · node ${v}`, skip: 'fnm not installed — winget install Schniz.fnm, then fnm install ' + v });
    }
  } else {
    for (const v of NODE_VERSIONS) {
      gates.push(majors.includes(v)
        ? { id: `host-node${v}`, title: `${process.platform} suite · node ${v} (fnm)`, cmd: fnm, args: ['exec', `--using=${v}`, 'node', ...suite] }
        : { id: `host-node${v}`, title: `${process.platform} suite · node ${v}`, skip: `fnm has no Node ${v} — fnm install ${v}` });
    }
  }

  // Linux suite in containers.
  const docker = which('docker', env);
  const haveDocker = o.docker && !o.fast && NODE_VERSIONS.some(v => want(`linux-node${v}`)) && dockerUp(docker, env);
  for (const v of NODE_VERSIONS) {
    const id = `linux-node${v}`;
    if (!o.docker) { gates.push({ id, title: `linux suite · node ${v}`, skip: '--no-docker' }); continue; }
    if (!haveDocker) { gates.push({ id, title: `linux suite · node ${v}`, skip: docker ? 'Docker is not running' : 'Docker not installed' }); continue; }
    // Copy without node_modules and .git (a worktree's .git is a Windows path), give the copy
    // its own one-commit repo so git-reading tests see a checkout, then do what ci.yml does.
    // As the image's unprivileged `node` user, like a CI runner: as root, the tests that make
    // a file read-only to force a failed write see the write succeed.
    const script = [
      'set -e',
      'mkdir -p ~/work',
      'tar -C /src --exclude=./node_modules --exclude=./.git --exclude=./.ci-local --exclude=./hooks/dist -cf - . | tar -C ~/work -xf -',
      'cd ~/work',
      'git init -q && git add -A && git -c user.email=ci@local -c user.name=local-ci commit -qm snapshot',
      'npm ci --no-audit --no-fund',
      'npm run build:hooks',
      'npm run test:all',
    ].join(' && ').replace('set -e && ', 'set -e; ');
    gates.push({
      id, title: `linux suite · node ${v} (node:${v}-bookworm)`, cmd: docker,
      args: ['run', '--rm', '-u', 'node', '-e', 'HOME=/home/node', '-v', `${root}:/src:ro`, `node:${v}-bookworm`, 'bash', '-c', script],
    });
  }

  gates.push({ id: 'harness', title: 'PAN Harness · tier 0', cmd: node, args: ['harness/src/run.cjs', '--tier', '0', '--no-ledger'] });

  const gitleaks = which('gitleaks', env);
  const leakArgs = ['detect', '--no-banner', '--redact', '--verbose', '--source', '.'];
  if (fs.existsSync(path.join(root, '.gitleaks.toml'))) leakArgs.push('--config', '.gitleaks.toml');
  gates.push(gitleaks
    ? { id: 'gitleaks', title: 'gitleaks · history', cmd: gitleaks, args: leakArgs }
    : { id: 'gitleaks', title: 'gitleaks · history', skip: 'gitleaks not installed — winget install gitleaks.gitleaks' });

  gates.push({ id: 'audit', title: 'npm audit · production, high+', cmd: shell ? 'npm audit --omit=dev --audit-level=high' : 'npm', args: shell ? [] : ['audit', '--omit=dev', '--audit-level=high'], opts: { shell } });
  gates.push({ id: 'links', title: 'links validate', cmd: node, args: ['pan-wizard-core/bin/pan-tools.cjs', 'links', 'validate', '--raw'] });
  gates.push({ id: 'surface', title: 'surface registry', cmd: node, args: ['scripts/test-surface.cjs', '--check'] });
  gates.push({
    id: 'coverage', title: 'coverage gate', cmd: node, args: ['scripts/coverage-gate.cjs'],
    interpret: (r) => /coverage gate — skipped/.test(r.output) ? { status: 'skip', detail: 'needs Node 22+' } : null,
  });

  if (o.codescan === 'semgrep') {
    const files = o.codescanAll ? [] : changedCodeFiles(root, env);
    const base = { id: 'codescan', title: `semgrep · ${o.codescanAll ? 'whole repo' : 'changed files'}` };
    if (!dockerUp(docker, env)) gates.push({ ...base, skip: docker ? 'Docker is not running' : 'Docker not installed' });
    else if (!o.codescanAll && files.length === 0) gates.push({ ...base, skip: 'no changed JS files against main' });
    else gates.push({
      ...base, cmd: docker,
      args: ['run', '--rm', '-v', `${root}:/src:ro`, '-w', '/src', '-e', 'HOME=/tmp', SEMGREP_IMAGE,
        'semgrep', 'scan', '--config', 'p/javascript', '--config', 'p/nodejs', '--error', '--metrics=off', '--disable-version-check',
        ...(o.codescanAll ? ['.'] : files.map(f => f.replace(/\\/g, '/')))],
    });
  } else if (o.codescan === 'codeql') {
    const codeql = which('codeql', env);
    const base = { id: 'codescan', title: 'CodeQL · security-extended' };
    if (!codeql) gates.push({ ...base, skip: 'codeql CLI not installed — github.com/github/codeql-action/releases' });
    else {
      const db = path.join(os.tmpdir(), `pan-local-ci-codeql-${process.pid}`);
      const sarif = path.join(root, '.ci-local', 'codeql.sarif');
      gates.push({
        ...base, cmd: codeql,
        args: ['database', 'create', db, '--language=javascript', `--source-root=${root}`, '--overwrite'],
        then: { cmd: codeql, args: ['database', 'analyze', db, 'codeql/javascript-queries:codeql-suites/javascript-security-extended.qls', '--format=sarif-latest', `--output=${sarif}`, '--download'] },
        interpret: () => {
          let results = [];
          try { results = JSON.parse(fs.readFileSync(sarif, 'utf8')).runs.flatMap(r => r.results || []); } catch { return { status: 'fail', detail: 'no SARIF written' }; }
          const errors = results.filter(r => r.level === 'error').length;
          return { status: errors ? 'fail' : 'pass', detail: `${results.length} result(s), ${errors} at error level — ${path.relative(root, sarif)}` };
        },
      });
    }
  }

  return gates.filter(g => want(g.id));
}

function fmtMs(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function runOne(cmd, args, opts, logStream) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { ...opts, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      logStream.write(`spawn failed: ${e.message}\n`);
      return resolve({ code: null, error: e.message });
    }
    let tail = '';
    const keep = (d) => { logStream.write(d); tail = (tail + d.toString()).slice(-16000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { keep(`\n[local-ci] timed out after ${fmtMs(GATE_TIMEOUT_MS)}\n`); child.kill(); }, GATE_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); keep(`\n[local-ci] ${e.message}\n`); resolve({ code: null, error: e.message, tail }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, tail }); });
  });
}

// Last line that says something, for the one-line detail of a failed gate.
function lastSignal(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const hit = [...lines].reverse().find(l => /(^ℹ fail|not ok|error|fail|leaks found|stale|drift|vulnerabilit)/i.test(l));
  return (hit || lines[lines.length - 1] || '').slice(0, 160);
}

async function runGate(g, o, env, logDir) {
  const started = Date.now();
  if (g.skip) return { id: g.id, title: g.title, status: 'skip', detail: g.skip, durationMs: 0 };
  const log = path.join(logDir, `${g.id}.log`);
  const stream = fs.createWriteStream(log);
  // Its own temp directory: tests that use a fixed name under os.tmpdir() must not meet
  // another gate's run of the same test.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `pan-lci-${g.id}-`));
  const opts = { cwd: o.root, env: { ...env, TEMP: tmp, TMP: tmp, TMPDIR: tmp }, ...(g.opts || {}) };
  stream.write(`$ ${[g.cmd, ...g.args].join(' ')}\n\n`);
  let r = await runOne(g.cmd, g.args, opts, stream);
  if (r.code === 0 && g.then) {
    stream.write(`\n$ ${[g.then.cmd, ...g.then.args].join(' ')}\n\n`);
    r = await runOne(g.then.cmd, g.then.args, opts, stream);
  }
  await new Promise(res => stream.end(res));
  // Kept on failure: a gate's own logs (the coverage gate's spec log) may live there.
  if (r.code === 0) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort: a child may still hold a file */ }
  let output = r.tail || '';
  try { output = fs.readFileSync(log, 'utf8'); } catch { /* the tail is enough for a verdict */ }
  let status = r.code === 0 ? 'pass' : 'fail';
  let detail = r.code === 0 ? '' : (r.error ? r.error : `exit ${r.code} — ${lastSignal(r.tail || output)}`);
  if (g.interpret && (r.code === 0 || g.then)) {
    const v = g.interpret({ output, code: r.code });
    if (v) { status = v.status; detail = v.detail; }
  }
  return { id: g.id, title: g.title, status, detail, durationMs: Date.now() - started, command: [g.cmd, ...g.args].join(' '), log: path.relative(o.root, log).replace(/\\/g, '/') };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

function summary(report) {
  const mark = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' };
  const w = Math.max(...report.gates.map(g => g.id.length), 8);
  const lines = [`local CI — ${report.head || 'no git'} · node ${report.node} · ${process.platform}`, ''];
  for (const g of report.gates) {
    lines.push(`  ${mark[g.status]}  ${g.id.padEnd(w)}  ${(g.status === 'skip' ? '' : fmtMs(g.durationMs)).padStart(6)}  ${g.detail || g.title}`);
  }
  const c = report.counts;
  lines.push('', `${report.status === 'pass' ? 'PASSED' : 'FAILED'} — ${c.pass} passed, ${c.fail} failed, ${c.skip} skipped in ${fmtMs(report.durationMs)}${c.skip && report.status === 'pass' ? ' (skipped gates did not run: they are not a pass)' : ''}`);
  lines.push(`report: ${path.join('.ci-local', 'report.json')}  logs: ${path.join('.ci-local', 'logs')}`);
  return lines.join('\n');
}

async function main(argv, env = process.env) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`local-ci: ${e.message}`); return 2; }
  if (o.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, '')); return 0; }
  // Run from inside a node --test process, a gate's own `node --test` would see the parent's
  // context and report to it instead of running its files: the gates start from a clean slate.
  env = { ...env };
  delete env.NODE_TEST_CONTEXT;

  const outDir = path.join(o.root, '.ci-local');
  const logDir = path.join(outDir, 'logs');
  // One run per checkout: a second one would wipe the logs the first is writing.
  const lock = path.join(outDir, 'run.lock');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  } catch {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* stale lock */ }
    if (alive && pid !== process.pid) { console.error(`local-ci: another run (pid ${pid}) is using ${path.relative(o.root, outDir)} — wait for it, or delete ${path.relative(o.root, lock)} if it is gone`); return 2; }
    fs.writeFileSync(lock, String(process.pid));
  }
  try {
    return await runAll(o, env, outDir, logDir);
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

async function runAll(o, env, outDir, logDir) {
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.mkdirSync(logDir, { recursive: true });

  const started = Date.now();
  const before = treeState(o.root, env);
  const gates = planGates(o, env);
  const wantsClean = !o.only || o.only.some(p => 'clean-tree'.startsWith(p));
  if (gates.length === 0 && !wantsClean) { console.error('local-ci: no gate matches --only'); return 2; }

  // The suite and the harness read hooks/dist (gitignored), as CI's build:hooks step provides.
  const needsHooks = gates.some(g => !g.skip && /^(host-|harness|coverage)/.test(g.id));
  const results = [];
  if (needsHooks && fs.existsSync(path.join(o.root, 'scripts', 'build-hooks.js'))) {
    const b = await runGate({ id: 'build-hooks', title: 'build:hooks', cmd: process.execPath, args: ['scripts/build-hooks.js'] }, o, env, logDir);
    if (b.status === 'fail') results.push(b);
  }
  if (!o.json) process.stderr.write(`local-ci: ${gates.filter(g => !g.skip).length} gate(s), ${o.jobs} at a time — logs in .ci-local/logs/\n`);
  // Whole-suite runs are heavy. Measured here: a host suite run beside another host suite, or
  // beside the three containers, times its 30-second setup hooks out; beside the harness alone
  // it is fine. So the containers go first, together, and the host suite runs (one per Node
  // version, then the coverage gate's) follow one at a time. The harness and the light gates
  // run beside all of it.
  const one = async (g) => {
    const r = await runGate(g, o, env, logDir);
    if (!o.json && r.status !== 'skip') process.stderr.write(`  ${r.status === 'pass' ? 'pass' : r.status} ${r.id} (${fmtMs(r.durationMs)})\n`);
    return r;
  };
  const byGate = new Map();
  const containers = gates.filter(g => !g.skip && g.id.startsWith('linux-'));
  const lane = gates.filter(g => !g.skip && (g.id.startsWith('host-') || g.id === 'coverage'));
  const heavy = async () => {
    await Promise.all(containers.map(async g => byGate.set(g, await one(g))));
    for (const g of lane) byGate.set(g, await one(g));
  };
  const rest = gates.filter(g => !containers.includes(g) && !lane.includes(g));
  await Promise.all([heavy(), pool(rest, Math.max(1, o.jobs - 1), async g => byGate.set(g, await one(g)))]);
  results.push(...gates.map(g => byGate.get(g)));

  if (wantsClean) {
    const after = treeState(o.root, env);
    if (!before || !after) results.push({ id: 'clean-tree', title: 'working tree unchanged', status: 'skip', detail: 'not a git checkout', durationMs: 0 });
    else {
      const changed = [...new Set([...after.lines.filter(l => !before.lines.includes(l)), ...before.lines.filter(l => !after.lines.includes(l))])];
      const ok = before.hash === after.hash;
      results.push({ id: 'clean-tree', title: 'working tree unchanged', status: ok ? 'pass' : 'fail', durationMs: 0,
        detail: ok ? (before.lines.length ? `unchanged (${before.lines.length} path(s) were already modified before the run)` : 'clean') : `the run changed the tree: ${changed.slice(0, 5).join('; ') || 'content of already-modified files'}` });
    }
  }

  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const r of results) counts[r.status]++;
  const failed = counts.fail > 0 || (o.strict && counts.skip > 0);
  const head = quick('git', ['rev-parse', '--short', 'HEAD'], { cwd: o.root, env }).stdout.trim();
  const report = {
    status: failed ? 'fail' : 'pass', startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
    root: o.root, head, node: process.versions.node, platform: process.platform,
    options: { fast: o.fast, only: o.only, codescan: o.codescan, docker: o.docker, strict: o.strict, jobs: o.jobs },
    counts, gates: results,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(o.json ? JSON.stringify(report, null, 2) : summary(report));
  return failed ? 1 : 0;
}

module.exports = { parseArgs, planGates, which, treeState, lastSignal, main };

if (require.main === module) main(process.argv.slice(2)).then(code => process.exit(code));
