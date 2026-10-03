'use strict';
/**
 * Verify scope — the mechanical half of the unrequested-work check (market item M11,
 * evidence loop spec D12). Re-exported by verify.cjs, like the other verify-* modules.
 *
 * It answers one question in code: which files did this phase change that none of
 * its plans declared? The verifier judges each candidate. Tests for a declared file
 * or a config change the feature needs are supporting work; anything else it
 * records as `unrequested:` in verification.md. A candidate is a lead, not a
 * finding: code cannot tell scope creep from necessary glue.
 *
 *   declared = the union of the phase plans' `files_modified`
 *   changed  = files touched by the phase's plan commits (subject `{type}({phase}-{plan}):`,
 *              the executor's convention), plus the summaries' `key-files`
 *   excluded = the planning tree, lockfiles, and PAN's own runtime directories
 */
const fs = require('fs');
const path = require('path');
const { safeReadFile, execGit, findPhaseInternal, toPosix, output, escapeRegex } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { isPlanFile, isSummaryFile, isVerificationFile } = require('./constants.cjs');
const { planningRel } = require('./utils.cjs');

const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'Pipfile.lock', 'uv.lock', 'composer.lock', 'Gemfile.lock', 'mix.lock', 'pubspec.lock',
]);
// PAN's own installed trees: a phase commit that touches them is PAN bookkeeping,
// never the project's scope (pan-reviewer skips them for the same reason).
const PAN_OWNED_PREFIXES = ['.claude/', '.codex/', '.gemini/', '.opencode/', '.agents/', '.github/pan-wizard-core/', '.github/agents/', '.github/prompts/', '.github/skills/'];
const PAN_OWNED_FILES = new Set(['.github/copilot-instructions.md', '.github/hooks/pan.json']);
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|specs?)\//i;
const TEST_FILE_RE = /\.(test|spec)\.[a-z0-9]+$/i;
const COMMIT_SCAN_LIMIT = 2000;

function normalisePath(p) {
  return toPosix(String(p || '').trim()).replace(/^\.\/+/, '').replace(/\\/g, '/');
}

function asList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

/** A file's stem without directory, a test/spec infix, or extension: `src/auth.ts` → `auth`. */
function stem(p) {
  return path.posix.basename(p).replace(/\.(test|spec)(?=\.)/i, '').replace(/\.[^.]+$/, '').toLowerCase();
}

function isDeclared(file, declared) {
  for (const d of declared) {
    if (d === file) return true;
    if (d.endsWith('/') && file.startsWith(d)) return true;
  }
  return false;
}

function exclusionReason(file, planningPrefix) {
  if (file === planningPrefix || file.startsWith(planningPrefix + '/')) return 'planning tree';
  if (LOCKFILES.has(path.posix.basename(file))) return 'lockfile';
  if (PAN_OWNED_FILES.has(file) || PAN_OWNED_PREFIXES.some((p) => file.startsWith(p))) return 'PAN runtime directory';
  return null;
}

/**
 * Files the phase's plan commits touched, paths relative to `cwd` (git's --relative).
 * @returns {{git: boolean, commits: number, files: Set<string>}}
 */
function committedFiles(cwd, phaseNumber) {
  const r = execGit(cwd, ['-c', 'core.quotepath=off', 'log', '--no-merges', '-n', String(COMMIT_SCAN_LIMIT), '--relative', '--name-only', '--format=@@%H%x09%s']);
  if (r.exitCode !== 0) return { git: false, commits: 0, files: new Set() };
  // `{type}({phase}-{plan}):` with the phase's zero padding optional ("feat(03-01):", "fix(3-02)!:").
  const unpadded = String(phaseNumber).replace(/^0+(?=\d)/, '');
  const subjectRe = new RegExp(`^[a-z]+\\(0*${escapeRegex(unpadded)}-[0-9]+\\)!?:`);
  const files = new Set();
  let commits = 0;
  let inPhase = false;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('@@')) {
      const subject = line.slice(2).split('\t').slice(1).join('\t');
      inPhase = subjectRe.test(subject);
      if (inPhase) commits++;
      continue;
    }
    if (inPhase && line.trim()) files.add(normalisePath(line));
  }
  return { git: true, commits, files };
}

/**
 * The scope check for one phase.
 * @returns {Object} `{phase, directory, declared, changed, candidates, excluded, git, commits}` or `{error}`
 */
function scopePhase(cwd, phase) {
  const info = findPhaseInternal(cwd, phase);
  if (!info) return { error: 'phase_not_found', reason: `no phase directory for phase ${phase}` };
  const dir = path.join(cwd, info.directory);
  const declared = new Set();
  for (const f of info.plans.filter(isPlanFile)) {
    const fm = extractFrontmatter(safeReadFile(path.join(dir, f)) || '');
    for (const p of asList(fm.files_modified || fm['files-modified'])) {
      const n = normalisePath(p);
      if (n) declared.add(n);
    }
  }
  const sources = new Map();
  const note = (file, source) => {
    if (!file) return;
    if (!sources.has(file)) sources.set(file, new Set());
    sources.get(file).add(source);
  };
  for (const f of info.summaries.filter(isSummaryFile)) {
    const fm = extractFrontmatter(safeReadFile(path.join(dir, f)) || '');
    const kf = fm['key-files'] || fm.key_files || {};
    for (const p of [...asList(kf.created), ...asList(kf.modified)]) note(normalisePath(p), 'summary');
  }
  const git = committedFiles(cwd, info.phase_number);
  for (const p of git.files) note(p, 'commit');

  const planningPrefix = normalisePath(planningRel());
  const declaredList = [...declared].sort();
  const declaredStems = new Set(declaredList.filter((d) => !d.endsWith('/')).map(stem));
  const changed = [...sources.keys()].sort();
  const candidates = [];
  const excluded = [];
  for (const file of changed) {
    const why = exclusionReason(file, planningPrefix);
    if (why) { excluded.push({ path: file, reason: why }); continue; }
    if (isDeclared(file, declared)) continue;
    const isTest = TEST_PATH_RE.test(file) || TEST_FILE_RE.test(file);
    candidates.push({
      path: file,
      hint: isTest && declaredStems.has(stem(file)) ? 'test_for_declared' : null,
      sources: [...sources.get(file)].sort(),
    });
  }
  return {
    phase: info.phase_number,
    directory: info.directory,
    declared: declaredList,
    changed,
    candidates,
    excluded,
    git: git.git,
    commits: git.commits,
  };
}

function cmdVerifyScope(cwd, phase, raw) {
  if (!phase) { output({ error: 'phase_required', reason: 'Usage: verify scope <phase>' }, raw); return; }
  const r = scopePhase(cwd, phase);
  output(r, raw, r.error ? undefined : String(r.candidates.length));
}

// ─── Stale verification (market-ideas M27) ───────────────────────────────────
// A verification describes the code at one commit. Until 2026-10-03 nothing tied it
// to that commit, so a phase edited after it passed still read as verified. The
// verifier now records `verified_commit`; any file the phase covers that changed
// since then, committed or not, makes the verification stale.

const SHA_RE = /^[0-9a-f]{7,40}$/i;

/**
 * The files a phase's verification covered: the plans' declared `files_modified` and
 * the summaries' `key-files`, minus the planning tree, lockfiles and PAN's runtime
 * directories. No git log scan, so `progress` can afford it for every phase.
 */
function coveredFiles(cwd, info) {
  const dir = path.join(cwd, info.directory);
  const files = new Set();
  for (const f of info.plans.filter(isPlanFile)) {
    const fm = extractFrontmatter(safeReadFile(path.join(dir, f)) || '');
    for (const p of asList(fm.files_modified || fm['files-modified'])) files.add(normalisePath(p));
  }
  for (const f of info.summaries.filter(isSummaryFile)) {
    const fm = extractFrontmatter(safeReadFile(path.join(dir, f)) || '');
    const kf = fm['key-files'] || fm.key_files || {};
    for (const p of [...asList(kf.created), ...asList(kf.modified)]) files.add(normalisePath(p));
  }
  const planningPrefix = normalisePath(planningRel());
  return [...files].filter((f) => f && !exclusionReason(f, planningPrefix)).sort();
}

/**
 * Whether a phase's verification still describes the code.
 * @param {string} cwd
 * @param {string} phase
 * @param {Object} [info] - findPhaseInternal's result, when the caller already has it
 * @returns {Object} `{phase, state, verified_commit, verification, changed_since, reason?}` or `{error, reason}`.
 *   state: `fresh` · `stale` (covered files changed since the verified commit) ·
 *   `unverified` (no verification file) · `unknown` (no usable verified_commit, or no git)
 */
function verificationFreshness(cwd, phase, info) {
  info = info || findPhaseInternal(cwd, phase);
  if (!info) return { error: 'phase_not_found', reason: `no phase directory for phase ${phase}` };
  const dir = path.join(cwd, info.directory);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* unreadable: no verification */ }
  const verification = names.filter(isVerificationFile).sort().pop() || null;
  const base = { phase: info.phase_number, state: 'unverified', verified_commit: null, verification: verification ? toPosix(path.join(info.directory, verification)) : null, changed_since: [] };
  if (!verification) return base;
  const fm = extractFrontmatter(safeReadFile(path.join(dir, verification)) || '');
  const sha = String(fm.verified_commit || '').trim();
  if (!SHA_RE.test(sha)) return { ...base, state: 'unknown', reason: 'the verification records no verified_commit' };
  const known = execGit(cwd, ['cat-file', '-e', `${sha}^{commit}`]);
  if (known.exitCode !== 0) return { ...base, state: 'unknown', verified_commit: sha, reason: 'the verified commit is not in this repository (rebased, squashed, or no git)' };
  const covered = coveredFiles(cwd, info);
  if (!covered.length) return { ...base, state: 'unknown', verified_commit: sha, reason: 'the phase declares no files to compare' };
  // Against the working tree, not HEAD: an uncommitted edit makes the pass stale too.
  const diff = execGit(cwd, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--relative', sha, '--', ...covered]);
  if (diff.exitCode !== 0) return { ...base, state: 'unknown', verified_commit: sha, reason: 'git diff failed' };
  const changed = diff.stdout.split('\n').map(normalisePath).filter(Boolean).sort();
  return { ...base, state: changed.length ? 'stale' : 'fresh', verified_commit: sha, changed_since: changed };
}

function cmdVerifyStale(cwd, phase, raw) {
  if (!phase) { output({ error: 'phase_required', reason: 'Usage: verify stale <phase>' }, raw); return; }
  const r = verificationFreshness(cwd, phase);
  output(r, raw, r.error ? undefined : r.state);
}

module.exports = { scopePhase, cmdVerifyScope, verificationFreshness, cmdVerifyStale, coveredFiles, LOCKFILES };
