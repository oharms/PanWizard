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
const { extractFrontmatter, parseMustHavesBlock } = require('./frontmatter.cjs');
const { isPlanFile, isSummaryFile, isVerificationFile } = require('./constants.cjs');
const { planningRel } = require('./utils.cjs');

const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'Pipfile.lock', 'uv.lock', 'composer.lock', 'Gemfile.lock', 'mix.lock', 'pubspec.lock',
]);
// PAN's own installed trees: a phase commit that touches them is PAN bookkeeping,
// never the project's scope (pan-reviewer skips them for the same reason).
// A Copilot install shares `.github/` with the project: only what the installer writes as
// its own is listed, so the project's workflows, hooks and Copilot instructions stay in scope,
// and so do the files PAN merges into (`mcp.json`, `copilot/settings.json`).
const PAN_OWNED_PREFIXES = ['.claude/', '.codex/', '.gemini/', '.opencode/', '.agents/', '.github/pan-wizard-core/', '.github/pan-local-patches/', '.github/agents/pan-', '.github/skills/pan-', '.github/hooks/pan-'];
const PAN_OWNED_FILES = new Set(['.github/hooks/pan.json', '.github/package.json', '.github/pan-file-manifest.json']);
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

// Set only inside withCommitLogCache: one `git log` per project for every phase it checks.
let logCache = null;

function commitLog(cwd) {
  if (logCache && logCache.has(cwd)) return logCache.get(cwd);
  const r = execGit(cwd, ['-c', 'core.quotepath=off', 'log', '--no-merges', '-n', String(COMMIT_SCAN_LIMIT), '--relative', '--name-only', '--format=@@%H%x09%s']);
  if (logCache) logCache.set(cwd, r);
  return r;
}

/**
 * Run `fn` with the commit log read once per project (a report that gates many phases).
 * Nested calls share the outer cache; it ends when the outermost call returns.
 */
function withCommitLogCache(fn) {
  const outer = logCache;
  logCache = outer || new Map();
  try { return fn(); } finally { logCache = outer; }
}

/**
 * Files the phase's plan commits touched, paths relative to `cwd` (git's --relative).
 * @returns {{git: boolean, commits: number, files: Set<string>, hashes: string[]}} hashes newest first
 */
function committedFiles(cwd, phaseNumber) {
  const r = commitLog(cwd);
  if (r.exitCode !== 0) return { git: false, commits: 0, files: new Set(), hashes: [] };
  // `{type}({phase}-{plan}):` with the phase's zero padding optional ("feat(03-01):", "fix(3-02)!:").
  const unpadded = String(phaseNumber).replace(/^0+(?=\d)/, '');
  const subjectRe = new RegExp(`^[a-z]+\\(0*${escapeRegex(unpadded)}-[0-9]+\\)!?:`);
  const files = new Set();
  const hashes = [];
  let commits = 0;
  let inPhase = false;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('@@')) {
      const subject = line.slice(2).split('\t').slice(1).join('\t');
      inPhase = subjectRe.test(subject);
      if (inPhase) { commits++; hashes.push(line.slice(2).split('\t')[0]); }
      continue;
    }
    if (inPhase && line.trim()) files.add(normalisePath(line));
  }
  return { git: true, commits, files, hashes };
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

// ─── Review scope (program R1) ───────────────────────────────────────────────
// The reviewer used to get the summaries' key-files: what the executor said it touched.
// A file the executor changed and did not list was never reviewed. The review scope is
// the diff instead (the phase's plan commits, plus work not yet committed), with the
// intent the code is judged against: each plan's objective, must_haves and Review Focus,
// and the text of the requirements the plans claim.

/** Files modified, staged or untracked in the working tree, relative to cwd. */
function workingTreeFiles(cwd) {
  // Porcelain v2 with -z: each entry starts with its type (`1`, `2`, `u`, `?`), never a
  // space, and paths come unquoted. v1 starts an unstaged edit with a space (" M a.js"),
  // which execGit's trim() cut off the first line, and the path lost its first letter.
  const r = execGit(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', '.']);
  if (r.exitCode !== 0) return { git: false, uncommitted: [], untracked: [] };
  const top = execGit(cwd, ['rev-parse', '--show-prefix']);
  const prefix = top.exitCode === 0 ? normalisePath(top.stdout.trim()) : '';
  const rel = (p) => { const n = normalisePath(p); return prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n; };
  const uncommitted = [];
  const untracked = [];
  const entries = r.stdout.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    const f = e.split(' ');
    if (e[0] === '?') untracked.push(rel(e.slice(2)));
    else if (e[0] === '1') { if (!f[1].includes('D')) uncommitted.push(rel(f.slice(8).join(' '))); }
    else if (e[0] === '2') { if (!f[1].includes('D')) uncommitted.push(rel(f.slice(9).join(' '))); i++; } // the next entry is the old path
    else if (e[0] === 'u') uncommitted.push(rel(f.slice(10).join(' ')));
  }
  return { git: true, uncommitted, untracked };
}

/** A markdown section's body, from its `## <title>` heading to the next heading of the same or higher level. */
function sectionBody(text, title) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const re = new RegExp(`^(#{1,6})\\s+${escapeRegex(title)}\\s*$`, 'i');
  const at = lines.findIndex((l) => re.test(l.trim()));
  if (at === -1) return null;
  const level = lines[at].trim().match(/^#+/)[0].length;
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s/);
    if (h && h[1].length <= level) break;
    out.push(lines[i]);
  }
  const body = out.join('\n').trim();
  return body || null;
}

/** The text between `<tag>` and `</tag>`, trimmed, or null. */
function tagBody(text, tag) {
  const m = String(text || '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m && m[1].trim() ? m[1].trim() : null;
}

/**
 * What a reviewer of one phase reads: the diff and the intent.
 * @returns {Object} `{phase, directory, base, files: [{path, sources, listed}], unlisted, excluded,
 *   intent: {plans: [{plan, objective, must_haves, review_focus, requirements}], requirements: [{id, text}], missing_requirements}, git, commits}`
 *   or `{error, reason}`. `sources` is any of commit · summary · uncommitted · untracked;
 *   `listed` is whether a summary's key-files names it; `unlisted` lists the files that are not.
 */
function reviewScope(cwd, phase) {
  const info = findPhaseInternal(cwd, phase);
  if (!info) return { error: 'phase_not_found', reason: `no phase directory for phase ${phase}` };
  const dir = path.join(cwd, info.directory);
  const sources = new Map();
  const note = (file, source) => {
    if (!file) return;
    if (!sources.has(file)) sources.set(file, new Set());
    sources.get(file).add(source);
  };
  const listed = new Set();
  for (const f of info.summaries.filter(isSummaryFile)) {
    const fm = extractFrontmatter(safeReadFile(path.join(dir, f)) || '');
    const kf = fm['key-files'] || fm.key_files || {};
    for (const p of [...asList(kf.created), ...asList(kf.modified)]) { const n = normalisePath(p); if (n) { listed.add(n); note(n, 'summary'); } }
  }
  const git = committedFiles(cwd, info.phase_number);
  for (const p of git.files) note(p, 'commit');
  const wt = workingTreeFiles(cwd);
  for (const p of wt.uncommitted) note(p, 'uncommitted');
  for (const p of wt.untracked) note(p, 'untracked');

  const planningPrefix = normalisePath(planningRel());
  const files = [];
  const excluded = [];
  for (const file of [...sources.keys()].sort()) {
    const why = exclusionReason(file, planningPrefix);
    if (why) { excluded.push({ path: file, reason: why }); continue; }
    // A file deleted by the phase has nothing left to read.
    if (!fs.existsSync(path.join(cwd, file))) continue;
    files.push({ path: file, sources: [...sources.get(file)].sort(), listed: listed.has(file) });
  }

  const plans = [];
  const reqIds = new Set();
  for (const f of info.plans.filter(isPlanFile).sort()) {
    const text = safeReadFile(path.join(dir, f)) || '';
    const fm = extractFrontmatter(text);
    const requirements = asList(fm.requirements).map((s) => s.trim()).filter(Boolean);
    for (const id of requirements) reqIds.add(id);
    const mh = fm.must_haves && typeof fm.must_haves === 'object' ? fm.must_haves : {};
    plans.push({
      plan: f,
      objective: tagBody(text, 'objective'),
      must_haves: { truths: asList(mh.truths), artifacts: parseMustHavesBlock(text, 'artifacts'), key_links: parseMustHavesBlock(text, 'key_links') },
      review_focus: sectionBody(text, 'Review Focus'),
      requirements,
    });
  }
  const { requirementLines } = require('./roadmap.cjs');
  const reqText = safeReadFile(path.join(cwd, planningRel(), 'requirements.md')) || '';
  const ids = [...reqIds].sort();
  const requirements = ids.map((id) => ({ id, text: requirementLines(reqText, [id]).lines.join('\n').trim() || null }));

  let base = null;
  if (git.hashes.length) {
    const r = execGit(cwd, ['rev-parse', '--verify', '-q', `${git.hashes[git.hashes.length - 1]}^`]);
    if (r.exitCode === 0 && r.stdout) base = r.stdout.trim();
  }
  return {
    phase: info.phase_number,
    directory: info.directory,
    base,
    files,
    unlisted: files.filter((f) => !f.listed).map((f) => f.path),
    excluded,
    intent: { plans, requirements, missing_requirements: requirements.filter((r) => !r.text).map((r) => r.id) },
    git: git.git,
    commits: git.commits,
  };
}

/** `pan-tools review scope <phase>`: the JSON scope; `--raw` prints the file paths, one per line. */
function cmdReviewScope(cwd, phase, raw) {
  if (!phase) { output({ error: 'phase_required', reason: 'Usage: review scope <phase>' }, raw); return; }
  const r = reviewScope(cwd, phase);
  output(r, raw, r.error ? undefined : r.files.map((f) => f.path).join('\n'));
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

// ─── Comment-only refresh (field report on 3.42.1, item 2) ──────────────────
// A one-word comment fix made a passing verification stale, and the only way past
// the gate was editing `verified_commit` by hand. `verify refresh` moves it to HEAD
// when every line that changed since the verified commit is a comment or blank, and
// records the old commit and the reason. Anything else still needs /pan:verify-phase.

const SLASH = { line: ['//'], block: true };
const HASH = { line: ['#'] };
const COMMENT_SYNTAX = {
  ...Object.fromEntries(['js', 'cjs', 'mjs', 'jsx', 'ts', 'cts', 'mts', 'tsx', 'go', 'java', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'rs', 'kt', 'kts', 'swift', 'scala', 'dart', 'groovy', 'gradle', 'proto', 'zig', 'v', 'sol'].map((e) => [e, SLASH])),
  php: { line: ['//', '#'], block: true },
  css: { line: [], block: true }, scss: SLASH, less: SLASH,
  ...Object.fromEntries(['py', 'pyi', 'sh', 'bash', 'zsh', 'fish', 'rb', 'pl', 'pm', 'r', 'ps1', 'psm1', 'yaml', 'yml', 'toml', 'tf', 'hcl', 'cmake', 'nix', 'ex', 'exs', 'jl', 'cr', 'nim', 'conf', 'cfg'].map((e) => [e, HASH])),
  ...Object.fromEntries(['sql', 'lua', 'hs', 'elm', 'ada'].map((e) => [e, { line: ['--'] }])),
  ini: { line: [';', '#'] }, clj: { line: [';'] }, lisp: { line: [';'] }, el: { line: [';'] }, asm: { line: [';'] },
  tex: { line: ['%'] }, erl: { line: ['%'] },
  vim: { line: ['"'] },
};
const COMMENT_SYNTAX_BY_NAME = { makefile: HASH, dockerfile: HASH, 'cmakelists.txt': HASH, gemfile: HASH, rakefile: HASH };

function commentSyntax(file) {
  const base = path.posix.basename(String(file)).toLowerCase();
  if (COMMENT_SYNTAX_BY_NAME[base]) return COMMENT_SYNTAX_BY_NAME[base];
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return COMMENT_SYNTAX[ext] || null;
}

/**
 * The code left on a line once its comment is cut off. A line-comment token counts
 * at the start or after whitespace (so `http://` is code); a C-family line that
 * opens with `/*`, or with `*` followed by a space, `/` or nothing, is a
 * block-comment line. A `#` or `//` inside a string literal after a space is read as
 * a comment: the reason `verify refresh` records is the check on that. Pure.
 */
function codeOfLine(line, syntax) {
  const t = String(line).trim();
  if (!t) return '';
  // ` * text` and ` */` continue a block comment; `*p++` is code.
  if (syntax.block && (/^\/\*/.test(t) || /^\*(?:\s|\/|$)/.test(t))) {
    const close = t.indexOf('*/');
    return close === -1 ? '' : t.slice(close + 2).trim();
  }
  let cut = t.length;
  for (const tok of syntax.line) {
    const re = new RegExp(`(^|\\s)${tok.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`);
    const m = re.exec(t);
    if (m && m.index + m[1].length < cut) cut = m.index + m[1].length;
  }
  if (syntax.block) {
    const m = /(^|\s)\/\*.*?\*\/\s*$/.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  return t.slice(0, cut).trim();
}

/**
 * Whether a `git diff -U0` changes only comments and blank lines. Per hunk, the code
 * left on the removed lines must equal the code left on the added lines, in order.
 * A file with no known comment syntax, a binary file, a rename or a mode change is
 * never comment-only. Pure.
 * @returns {{ok: boolean, files: string[], code_changes: Array<{file, reason}>}}
 */
function commentOnlyDiff(diffText) {
  const files = [];
  const codeChanges = [];
  let file = null; let syntax = null; let removed = []; let added = []; let flagged = false;
  const flush = () => {
    if (!file || flagged) { removed = []; added = []; return; }
    const a = removed.map((l) => codeOfLine(l, syntax)).filter(Boolean);
    const b = added.map((l) => codeOfLine(l, syntax)).filter(Boolean);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) { codeChanges.push({ file, reason: 'a line of code changed' }); flagged = true; }
    removed = []; added = [];
  };
  const flag = (reason) => { if (file && !flagged) { codeChanges.push({ file, reason }); flagged = true; } };
  for (const line of String(diffText || '').replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      file = m ? m[2] : line.slice(11); flagged = false;
      files.push(file);
      syntax = commentSyntax(file);
      if (!syntax) flag('no known comment syntax for this file type');
      continue;
    }
    if (!file) continue;
    if (/^(new|deleted) file mode|^rename (from|to)|^old mode|^new mode|^Binary files/.test(line)) { flag('added, deleted, renamed, binary or mode change'); continue; }
    if (line.startsWith('@@')) { flush(); continue; }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')) continue;
    if (line.startsWith('-')) removed.push(line.slice(1));
    else if (line.startsWith('+')) added.push(line.slice(1));
  }
  flush();
  return { ok: files.length > 0 && codeChanges.length === 0, files, code_changes: codeChanges };
}

/**
 * `verify refresh <phase> --reason R`: re-point a stale verification at HEAD when
 * the changes since its commit are comments only. Refuses uncommitted changes (the
 * new commit must hold them) and any change to code.
 */
function refreshVerification(cwd, phase, opts = {}) {
  const reason = String(opts.reason || '').trim();
  if (!reason) return { error: 'reason_required', reason: 'Usage: verify refresh <phase> --reason "<what changed>"' };
  const info = findPhaseInternal(cwd, phase);
  if (!info) return { error: 'phase_not_found', reason: `no phase directory for phase ${phase}` };
  const fresh = verificationFreshness(cwd, phase, info);
  if (fresh.state === 'fresh') return { phase: fresh.phase, refreshed: false, state: 'fresh', verified_commit: fresh.verified_commit, reason: 'the verification already describes the code' };
  if (fresh.state !== 'stale') return { error: `verification_${fresh.state}`, reason: fresh.reason || 'the phase has no verification; run /pan:verify-phase' };
  const head = execGit(cwd, ['rev-parse', 'HEAD']);
  if (head.exitCode !== 0) return { error: 'no_head', reason: 'git rev-parse HEAD failed' };
  const headSha = head.stdout.trim();
  const dirty = execGit(cwd, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--relative', 'HEAD', '--', ...fresh.changed_since]);
  const uncommitted = dirty.stdout.split('\n').map(normalisePath).filter(Boolean);
  if (uncommitted.length) return { error: 'uncommitted_changes', reason: `commit these first, then refresh: ${uncommitted.join(', ')}`, files: uncommitted };
  const diff = execGit(cwd, ['-c', 'core.quotepath=off', 'diff', '-U0', '--no-color', '--no-ext-diff', '--relative', fresh.verified_commit, headSha, '--', ...fresh.changed_since]);
  if (diff.exitCode !== 0) return { error: 'diff_failed', reason: 'git diff failed' };
  const check = commentOnlyDiff(diff.stdout);
  if (!check.ok) {
    return { error: 'code_changed', reason: 'more than comments changed since the verified commit; run /pan:verify-phase', phase: fresh.phase, verified_commit: fresh.verified_commit, code_changes: check.code_changes };
  }
  const file = path.join(cwd, fresh.verification);
  const { patchFrontmatter } = require('./frontmatter.cjs');
  const text = safeReadFile(file) || '';
  fs.writeFileSync(file, patchFrontmatter(text, { set: { verified_commit: headSha, refreshed_from: fresh.verified_commit, refresh_reason: reason } }), 'utf-8');
  try {
    require('./optimize.cjs').logTraceEvent(cwd, {
      type: 'decision', category: 'verification_refreshed', agent: 'orchestrator', phase: fresh.phase,
      description: `phase ${fresh.phase} verification moved from ${fresh.verified_commit.slice(0, 7)} to ${headSha.slice(0, 7)} (comment-only changes): ${reason}`,
      impact: 'minor', context: { files: check.files, reason },
    });
  } catch { /* telemetry is best effort */ }
  return { phase: fresh.phase, refreshed: true, verification: fresh.verification, refreshed_from: fresh.verified_commit, verified_commit: headSha, files: check.files, reason };
}

function cmdVerifyRefresh(cwd, phase, opts, raw) {
  if (!phase) { output({ error: 'phase_required', reason: 'Usage: verify refresh <phase> --reason "<what changed>"' }, raw); return; }
  const r = refreshVerification(cwd, phase, opts);
  output(r, raw, r.error ? r.error : (r.refreshed ? 'refreshed' : r.state));
}

module.exports = { scopePhase, cmdVerifyScope, reviewScope, cmdReviewScope, workingTreeFiles, sectionBody, verificationFreshness, cmdVerifyStale, coveredFiles, committedFiles, withCommitLogCache, LOCKFILES, TEST_PATH_RE, TEST_FILE_RE, commentOnlyDiff, codeOfLine, commentSyntax, refreshVerification, cmdVerifyRefresh };
