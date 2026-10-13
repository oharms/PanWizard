'use strict';
/**
 * Test integrity (program V3): did this phase weaken the tests that judge it?
 *
 * An agent that cannot make a test pass can make the test stop failing instead:
 * delete it, skip it, drop its assertions, rewrite its expectation or snapshot, or
 * add an assertion that cannot fail. ImpossibleBench measured agents doing this on a
 * large share of impossible tasks, and a stated way out (stop and report the
 * conflict) cut it sharply. This is the check in code; the executor's way out is
 * the `BLOCKED_SPEC_CONFLICT` return.
 *
 * It walks the phase's own plan commits (the `{type}({phase}-{plan}):` subjects that
 * verify-scope reads) one at a time and reads each test file's diff:
 *
 *   errors    test_deleted · skip_marker_added · assertions_dropped ·
 *             undeclared_test_edit (an existing assertion changed in a test no plan
 *             declared) · snapshot_rewritten (undeclared) · always_true_assert
 *   warnings  test_renamed
 *
 * A file a plan declares in `files_modified` may be edited freely, except that an
 * added skip marker or an always-true assertion is an error anywhere.
 */
const fs = require('fs');
const path = require('path');
const { execGit, findPhaseInternal, safeReadFile, output, error, toPosix } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { isPlanFile } = require('./constants.cjs');
const { committedFiles, TEST_PATH_RE, TEST_FILE_RE } = require('./verify-scope.cjs');

const TEST_NAME_RE = /(^|\/)(test_[^/]+\.py|[^/]+_test\.(py|go)|[^/]+Tests?\.(java|kt|cs))$/;
// A snapshot directory anywhere in the path, or a `.snap` file: two patterns, so neither
// alternative's anchoring reads as the other's.
const SNAPSHOT_DIR_RE = /(?:^|\/)(?:__snapshots__|snapshots)\//;
const SNAPSHOT_EXT_RE = /\.snap$/;

/** Markers that stop a test from running, per ecosystem. */
const SKIP_RE = [
  /\b(?:it|test|describe|suite|context)\.(?:skip|only|todo)\s*\(/, // jest / mocha / vitest / node:test
  /\bx(?:it|test|describe)\s*\(/, // jasmine / mocha
  /\b(?:skip|only|todo)\s*:\s*(?:true|['"`])/, // node:test options
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/,
  /\bpytest\.skip\s*\(/,
  /@unittest\.skip\w*\b/,
  /\bt\.Skip(?:Now|f)?\s*\(/, // go
  /#\[ignore\]/, // rust
  /@(?:Disabled|Ignore)\b/, // junit
];

/** Lines that assert, per ecosystem. */
const ASSERT_RE = [
  /\bassert(?:\.\w+)?\s*\(/,
  /\bassert(?:_eq|_ne)?!\s*\(/,
  /\bexpect\s*\(/,
  /\.should\b/,
  /\bself\.assert\w+\s*\(/,
  /^\s*assert\s+\S/,
  /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(/,
  /\b(?:require|assert)\.\w+\s*\(\s*t\b/, // testify
  /\bAssert\.\w+\s*\(/,
];

/** Assertions that cannot fail. */
const ALWAYS_TRUE_RE = [
  /\bassert(?:\.ok)?\s*\(\s*true\s*[,)]/,
  /\bexpect\s*\(\s*true\s*\)\s*\.\s*(?:toBe|toEqual|toBeTruthy)\s*\(\s*(?:true)?\s*\)/,
  /^\s*assert\s+True\s*(?:#.*)?$/,
  /^\s*assert\s+(\d+)\s*==\s*\1\s*(?:#.*)?$/,
  /\bself\.assertTrue\s*\(\s*True\s*\)/,
  /\bassert!\s*\(\s*true\s*\)/,
  /\bassertTrue\s*\(\s*true\s*\)/,
];

const isTestFile = (f) => TEST_PATH_RE.test(f) || TEST_FILE_RE.test(f) || TEST_NAME_RE.test(f);
const isSnapshot = (f) => SNAPSHOT_DIR_RE.test(f) || SNAPSHOT_EXT_RE.test(f);
const any = (res, line) => res.some((re) => re.test(line));
const norm = (p) => toPosix(String(p || '').trim()).replace(/^\.\/+/, '');

/** A Rust source file that holds its own unit tests (`#[test]`) at this commit. */
function hasInlineTests(cwd, hash, file) {
  if (!file.endsWith('.rs')) return false;
  const r = execGit(cwd, ['show', `${hash}:${file}`]);
  return r.exitCode === 0 && /#\[(?:test|cfg\(test\))\]/.test(r.stdout);
}

/** The union of the phase plans' `files_modified`. */
function declaredFiles(cwd, info) {
  const dir = path.join(cwd, info.directory);
  const out = new Set();
  for (const f of info.plans.filter(isPlanFile)) {
    const fm = extractFrontmatter(safeReadFile(path.join(dir, f)) || '');
    const raw = fm.files_modified || fm['files-modified'];
    for (const p of Array.isArray(raw) ? raw : (raw ? [raw] : [])) if (norm(p)) out.add(norm(p));
  }
  return out;
}

function isDeclared(file, declared) {
  for (const d of declared) if (d === file || (d.endsWith('/') && file.startsWith(d))) return true;
  return false;
}

/** One commit's file changes: `[{status, file, from?}]`, renames detected. */
function commitChanges(cwd, hash) {
  const r = execGit(cwd, ['-c', 'core.quotepath=off', 'show', '--relative', '-M', '--name-status', '--format=', hash]);
  if (r.exitCode !== 0) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split('\t');
    const status = parts[0][0];
    return status === 'R' || status === 'C'
      ? { status, from: norm(parts[1]), file: norm(parts[2]) }
      : { status, file: norm(parts[1]) };
  });
}

/** One file's added and removed lines in one commit. */
function fileDiff(cwd, hash, file) {
  const r = execGit(cwd, ['-c', 'core.quotepath=off', 'show', '--relative', '--format=', '-U0', '--no-color', hash, '--', file]);
  const added = [];
  const removed = [];
  if (r.exitCode !== 0) return { added, removed };
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added, removed };
}

/**
 * The integrity check for one phase.
 * @returns {{phase, checked: boolean, ok: boolean, reason?: string, commits: number, violations: Array, warnings: Array}|{error, reason}}
 */
function checkTestIntegrity(cwd, phase) {
  const info = findPhaseInternal(cwd, phase);
  if (!info || !info.found) return { error: 'phase_not_found', reason: `no phase directory for phase ${phase}` };
  const git = committedFiles(cwd, info.phase_number);
  const base = { phase: info.phase_number, commits: git.commits, violations: [], warnings: [] };
  if (!git.git) return { ...base, checked: false, ok: true, reason: 'git is unavailable or this is not a repository' };
  if (!git.commits) return { ...base, checked: false, ok: true, reason: 'no plan commits for this phase (subjects like "feat(03-01): …")' };

  const declared = declaredFiles(cwd, info);
  const violations = [];
  const warnings = [];
  const add = (list, code, file, commit, detail) => list.push({ code, file, commit: commit.slice(0, 12), detail });

  for (const hash of [...git.hashes].reverse()) { // oldest first
    for (const ch of commitChanges(cwd, hash)) {
      const { file } = ch;
      if (ch.status === 'D' && isTestFile(file)) { add(violations, 'test_deleted', file, hash, `${file} was deleted`); continue; }
      if (ch.status === 'R' && isTestFile(ch.from)) add(warnings, 'test_renamed', file, hash, `${ch.from} was renamed to ${file}`);
      if (isSnapshot(file) && (ch.status === 'M' || ch.status === 'D') && !isDeclared(file, declared)) {
        add(violations, 'snapshot_rewritten', file, hash, `snapshot ${file} was ${ch.status === 'D' ? 'deleted' : 'rewritten'} and no plan declares it`);
        continue;
      }
      if (ch.status === 'D' || !(isTestFile(file) || hasInlineTests(cwd, hash, file))) continue;
      const { added, removed } = fileDiff(cwd, hash, file);
      const skipsAdded = added.filter((l) => any(SKIP_RE, l)).length - removed.filter((l) => any(SKIP_RE, l)).length;
      if (skipsAdded > 0) add(violations, 'skip_marker_added', file, hash, `${skipsAdded} skip/only marker(s) added`);
      const trivial = added.filter((l) => any(ALWAYS_TRUE_RE, l));
      if (trivial.length) add(violations, 'always_true_assert', file, hash, `an assertion that cannot fail: ${trivial[0].trim().slice(0, 120)}`);
      const assertsAdded = added.filter((l) => any(ASSERT_RE, l) && !any(ALWAYS_TRUE_RE, l)).length;
      const assertsRemoved = removed.filter((l) => any(ASSERT_RE, l)).length;
      if (assertsRemoved > assertsAdded) {
        add(violations, 'assertions_dropped', file, hash, `${assertsRemoved} assertion line(s) removed, ${assertsAdded} added`);
      } else if (assertsRemoved > 0 && ch.status === 'M' && !isDeclared(file, declared)) {
        add(violations, 'undeclared_test_edit', file, hash, `${assertsRemoved} existing assertion(s) changed in a test no plan declares`);
      }
    }
  }
  return { ...base, checked: true, ok: violations.length === 0, violations, warnings };
}

function cmdVerifyTestIntegrity(cwd, phase, raw) {
  if (!phase) error('Usage: verify test-integrity <phase>');
  const r = checkTestIntegrity(cwd, phase);
  if (r.error) { output(r, raw); return; }
  const word = !r.checked ? 'not_checked' : (r.ok ? 'clean' : 'violated');
  output(r, raw, word, r.ok ? 0 : 1);
}

module.exports = { checkTestIntegrity, cmdVerifyTestIntegrity, isTestFile, SKIP_RE, ASSERT_RE, ALWAYS_TRUE_RE };
