/**
 * Model-version drift lint (E2E audit 2026-08, model-agnostic phrasing sweep).
 *
 * PAN's shipped content and live docs used to gate features on hardcoded model
 * versions — "Opus 4.7 is required for single-shot mode", "Claude + Opus 4.8
 * only", "Opus 4.7 thinking-capable models only". Every one of those statements
 * went stale the moment the model lineup moved on (Opus 5 / Sonnet 5 / Fable 5
 * all carry the capabilities the prose claimed were exclusive to a 4.x model),
 * and a stale gate is worse than no gate: users on a NEWER, more capable model
 * read "Opus 4.7 only" and believe the feature is unavailable to them.
 *
 * Two of those claims were false twice over. The `/pan:map-codebase` single-shot
 * gate is PROSE-ONLY: `codebase.cjs` picks the mode from repo size alone
 * (`mode = totalTokens <= threshold ? 'single-shot' : 'sharded'`) with no model
 * check anywhere — so "Opus 4.7 is required, other models always take the
 * sharded path" named the wrong model AND invented a gate the code never had.
 * `--hierarchical` is the same shape: no model check exists anywhere in the
 * code, and its real constraint is the RUNTIME (native sub-agent spawning),
 * not a model version. `cache_control` is prompt-layer only.
 *
 * The fix was to phrase capability gates by CAPABILITY, never by version:
 *   - "a model with a 1M-context window", "thinking-capable models",
 *     "models that support prompt caching"
 *   - "the default Opus" / "Opus (reasoning)" when a tier must be named
 *   - name the RUNTIME when the runtime is the real constraint
 *   - PAN's own release history stays history ("shipped v2.10.0 — E-7")
 *
 * This lint keeps the class closed: it fails if a version-pinned Claude model
 * reference reappears in shipped runtime content or live user docs. It is the
 * same shape as tests/shipped-content-prefix.test.cjs, which permanently closed
 * the path-prefix class.
 *
 * NOT covered here, by design: code. `bin/install-lib.cjs`'s
 * `detectModelCapabilities()` and `cost.cjs`'s rate table legitimately enumerate
 * model IDs. Note what that function is and is not: a hand-maintained
 * model-substring table (`n.includes('opus-5')`, `'sonnet-4-6'`, …) with a
 * family-level fallback beneath it, so an unrecognized Claude ID degrades to its
 * family profile and only a name outside every family lands on the all-false
 * `tier: 'unknown'`. It is not a live capability probe, and its ONLY consumer is
 * the installer's advisory post-install warning — it gates no feature. Docs must
 * not describe it as a gate, and tests/ fixtures deliberately exercise its
 * version table.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Scan set: shipped runtime content (installed into all 5 runtimes) + the live
// user-facing docs. These are the surfaces a user reads as CURRENT truth.
// ---------------------------------------------------------------------------
const SCAN_DIRS = [
  'commands/pan',
  'agents',
  'pan-wizard-core/workflows',
  'pan-wizard-core/templates', // walked recursively (codebase/, research-project/)
  'pan-wizard-core/references',
  'docs', // walked recursively; historical subtrees are excluded below
  // package.json `files` ships pan-zcode, and pan-zcode/README.md +
  // KNOWN-BETA-RISKS.md are live user-facing docs for the preview subsystem.
  'pan-zcode',
];

// Root-level .md files are scanned too — every one of them is live (README,
// CONTRIBUTORS, SECURITY, CONTRIBUTING, ATTRIBUTION, CODE_OF_CONDUCT, CLAUDE).
// The root walk is non-recursive and enumerated, not enumerated-by-hand, so a
// NEW root doc cannot be missed by omission: SCAN_FILES = ['README.md'] is how
// CONTRIBUTORS.md's version-pinned lines went unscanned. Historical root docs
// (CHANGELOG.md) are excluded by name below, with the reason on record.

// Directory names never walked, wherever they appear under a scan root.
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist']);

// Excluded DIRECTORIES — each is a historical record, not a live instruction.
// Rewriting them would falsify the record, so they are exempt by design.
const EXCLUDED_DIRS = [
  { dir: 'docs/decisions', why: 'ADRs are dated decision records — "we adopted Opus 4.7 in v2.10.0" is the fact being recorded' },
  { dir: 'docs/specs', why: 'featureAI specs are point-in-time design docs written against the model of that day' },
  { dir: 'docs/audits', why: 'audit reports quote the code/docs as they were at audit time' },
  { dir: 'docs/archive', why: 'explicitly archived docs — retained verbatim, not maintained' },
];

// Excluded FILES — historical, with the reason each is exempt.
const EXCLUDED_FILES = [
  { file: 'CHANGELOG.md', why: 'per-release history — "added Opus 4.7 routing in v2.10.0" is a true, immutable fact' },
  { file: 'docs/IMPROVEMENT-TODO.md', why: 'backlog written against the then-current model lineup; items carry their own dates' },
  { file: 'docs/SKILLS-ENHANCEMENT-PLAN-V2.md', why: 'dated plan document, superseded by shipped work' },
];

// GENERATED files — never hand-edit; fix the source doc and regenerate. Exempt
// from the main scan, but NOT unguarded: the staleness backstop test below
// checks that every version-pinned line still exists verbatim in a source doc,
// which is what catches "source was fixed, generated copy was not".
const GENERATED_FILES = [
  { file: 'docs/SKILLS-FULL-TEXT.md', why: 'GENERATED from commands/ + agents/ by scripts/generate-skills-docs.py — embeds command bodies verbatim' },
  { file: 'docs/SKILLS-REFERENCE.md', why: 'GENERATED from commands/ + agents/ by scripts/generate-skills-docs.py — embeds command metadata' },
];
const GENERATOR_CMD = 'python scripts/generate-skills-docs.py';
// The generated files are assembled from these directories.
const GENERATED_SOURCE_DIRS = ['commands/pan', 'agents'];

// Excluded DATED REPORT FAMILIES — one entry covers every vintage. The date
// component is REQUIRED in the pattern: a plain `docs/FIELD-` prefix would
// silently exempt a future evergreen doc like docs/FIELD-GUIDE.md.
const EXCLUDED_DATED = [
  { re: /^docs\/ECOSYSTEM-REVIEW-\d{4}-\d{2}\.md$/, why: 'dated ecosystem snapshots — the model lineup AS OF that date is the whole point of the doc' },
  { re: /^docs\/FIELD-[\w-]*\d{4}-\d{2}\.md$/, why: 'dated field reports/harvests (FIELD-HARVEST-2026-07, FIELD-REPORT-army-2026-06) — observations recorded from real runs on a specific model' },
];

// `pan-wizard-core/learnings/**` is out of scope on purpose: those are factual
// run records ("rate limits not hit on Opus 4.7 at N=4") and rewriting them
// would destroy the measurement's meaning. It is not reachable from SCAN_DIRS
// today; the guard test asserts that stays true rather than leaving a dead
// exclusion branch in the walk.
const NEVER_SCANNED_SUBTREE = 'pan-wizard-core/learnings/';

// ---------------------------------------------------------------------------
// Patterns.
//
// `\d{1,2}\b` deliberately refuses 3+ digit runs so prose like "if Fable 400s
// on every call" (an HTTP status) is not read as a version.
//
// The separator is loose because drift arrives in every shape: "Opus 4.7",
// "Opus-4.7", "Opus4.7", "Opus v4.7", "Opus (4.7)", "opus-4.7". The
// parenthesised form REQUIRES its closing paren, so "Mission Control (Opus)
// delegates to 4 squads" and "Opus (4 squads)" stay clean; and the trailing
// `\b` keeps "Opus-2nd" / "Fable 400s" clean.
//
// ONE shape is genuinely ambiguous: a family name, a plain space, and a bare
// major. "Opus 5" is a real version — but "spawn Opus 4 agents in parallel",
// "Claude 5 runtimes are supported" and "Sonnet 3 shards" are COUNTS, and an
// earlier revision of this lint flagged all three. A count is a quantifier for
// the noun that follows it, so the bare-major-after-a-space branch (and only
// that branch) refuses a following countable noun. Every unambiguous shape —
// dotted minor ("Opus 4.7"), tight separator ("Opus-5", "Opus_5", "Opus5"), a
// `v` marker ("Opus v5"), the parenthesised form ("Opus (5)") — always matches,
// noun or not. Cost of the trade: count-shaped drift ("Opus 5 agents only")
// slips; the alternative was crying wolf on ordinary prose. Extend COUNT_NOUNS
// when a new false positive shows up — do not loosen the branch.
// ---------------------------------------------------------------------------
const COUNT_NOUNS = [
  'runtime', 'agent', 'subagent', 'squad', 'worker', 'bot', 'shard', 'phase',
  'step', 'file', 'doc', 'test', 'model', 'call', 'pass', 'wave', 'item',
  'task', 'command', 'hook', 'tier', 'profile', 'instance', 'session', 'lane',
  'slot', 'replica', 'retry', 'retries', 'time',
].map((n) => `${n}(?:s|es)?`).join('|');
const MAJOR = '\\d{1,2}';
const MINOR = '\\d{1,2}\\.\\d+';
const VER = `(?:${[
  `[\\s\\-_]?v?\\.?\\s?${MINOR}\\b`,             // Opus 4.7 / Opus-4.7 / Opus4.7 / Opus v4.7
  `[\\-_]v?\\.?${MAJOR}\\b`,                     // Opus-5 / Opus_5
  `${MAJOR}\\b`,                                 // Opus5
  `\\s?v\\.?\\s?${MAJOR}\\b`,                    // Opus v5
  `\\s${MAJOR}\\b(?!\\s+(?:${COUNT_NOUNS})\\b)`, // Opus 5 — but not "Opus 4 agents"
  `\\s?\\(v?\\.?\\s?${MAJOR}(?:\\.\\d+)?\\)`,    // Opus (4.7) / Opus (5)
].join('|')})`;
const MODEL_PATTERNS = [
  { re: new RegExp(`\\bOpus${VER}`, 'gi'), what: 'version-pinned Opus reference' },
  { re: new RegExp(`\\bSonnet${VER}`, 'gi'), what: 'version-pinned Sonnet reference' },
  { re: new RegExp(`\\bHaiku${VER}`, 'gi'), what: 'version-pinned Haiku reference' },
  { re: new RegExp(`\\b(?:Fable|Mythos)${VER}`, 'gi'), what: 'version-pinned Fable/Mythos reference' },
  { re: new RegExp(`\\bClaude${VER}`, 'gi'), what: 'version-pinned Claude reference' },
  // Concrete IDs, both orderings: family-then-digits (`claude-opus-4-8`) and the
  // legacy digits-then-family form (`claude-3-5-sonnet-20241022`, `claude-2.1`,
  // `claude-instant-1.2`). `claude-code-2` is NOT a model ID and is not matched.
  { re: /\bclaude-(?:(?:opus|sonnet|haiku|fable|mythos|instant)-)?\d[\w.-]*/gi, what: 'concrete model ID' },
];

// ---------------------------------------------------------------------------
// ALLOWLIST — the narrow set of legitimately concrete model references.
//
// Two kinds qualify, and ONLY these two:
//   (a) a selectable VALUE or a quote of the code's own version table: a model
//       ID the user types into config, a CLI flag, a payload field the runtime
//       emits, or the substrings `detectModelCapabilities()` matches on. The ID
//       is data, not a gate.
//   (b) a true HISTORICAL statement: "Opus 4.7 integration in v2.10" — the
//       provenance is the fact; it does not tell the reader what they need now.
//
// A statement that tells the reader a feature REQUIRES / is LIMITED TO a model
// version is never allowlisted — reword it instead. Every entry carries a
// `reason` (enforced by a test below), and matching is MATCH-SCOPED, not
// line-scoped: an entry exempts only the span of text it actually matches
// (`snippet` = that literal substring, `re` = that regex's match). A version
// reference elsewhere on the same line — another cell of an allowlisted table
// row, a clause appended to an allowlisted sentence — is still reported.
// Line-scoped exemption used to let a real gate ride along on an allowlisted
// line.
//
// Corollary, and the reason two entries below use lookbehind: an exempted span
// must never have an UNBOUNDED INTERIOR. `/^\|[^|]+\|…`claude-…`/` scoped the
// match to one row, but its first cell was free text, so "| Opus 4.7 | …" hid a
// real version pin INSIDE the span. Put the surrounding context in a zero-width
// lookbehind and let the match itself be only the token that is legitimately
// version-bearing (the backticked ID). Then no prose is ever inside a span.
// ---------------------------------------------------------------------------
const ALLOWLIST = [
  // (a) selectable values / quotes of the code's own table ------------------
  {
    file: 'pan-wizard-core/references/model-profiles.md',
    // Exempts ONLY a backticked ID token, and only in the SECOND cell of a table
    // row: the lookbehind walks from line start over cell 1 (`[^|`]*` — no pipes,
    // no backticks) and into cell 2 (`[^|]*` — cannot cross the next pipe). The
    // class cell and every capability cell after cell 2 stay fully scanned, so a
    // version pin anywhere in the row is still reported.
    re: /(?<=^\|[^|`]*\|[^|]*)`claude-[a-z0-9.-]+`/i,
    reason: '(a) "Choosing a Reasoning-Tier Model" table — the ID cells are EXAMPLE selectable values for each class, and the doc says so explicitly ("not an exhaustive or only-valid list"). The table is keyed by CLASS (Fable/Mythos, Opus), so it does not gate on a version.',
  },
  {
    file: 'docs/ARCHITECTURE.md',
    // Exempts ONLY a backticked `<family>-<digits>` fragment, and only inside the
    // parenthesised sample that follows "substring table" (`[^)]*` in the
    // lookbehind cannot cross the closing paren). The prose around and between
    // the fragments — including the paren interior — is still scanned.
    re: /(?<=substring table[^(]*\([^)]*)`(?:opus|sonnet|haiku|fable|mythos)-\d[\d-]*`/i,
    reason: "(a) quotes the substrings `detectModelCapabilities()` itself matches on — documenting the code's hand-maintained table, which the same paragraph correctly describes as advisory-only (\"It gates no feature\"). Code is out of this lint's scope; a faithful quote of it must be too.",
  },
  {
    file: 'docs/CLI-REFERENCE.md',
    snippet: '`{ "claude-opus-4-8": { "input"',
    reason: '(a) `cost.rates` override example in the config table — the model ID is the JSON KEY the user writes to override a rate. A generic placeholder would not show the key shape.',
  },
  {
    file: 'docs/HOOKS.md',
    snippet: '"model": "claude-opus-4-7"',
    reason: '(a) sample hook payload — shows the shape of the `model` field the runtime emits; a real ID makes the example readable.',
  },
  // (b) true historical provenance ----------------------------------------
  {
    file: 'CONTRIBUTORS.md',
    // Bullet shape, so a version bump in the attribution keeps working.
    re: /^- \*\*Claude Opus [\d.]+\*\* \(Anthropic/i,
    reason: '(b) AI-contributor attribution — the model version that actually co-authored the commits is the historical fact being recorded, exactly like a human contributor\'s name. It tells the reader nothing about what they need to run PAN.',
  },
  {
    file: 'CONTRIBUTORS.md',
    snippet: 'Opus 4.7 integration',
    reason: '(b) ancestor-project history — "introduced … Opus 4.7 integration (extended thinking, prompt caching, cross-phase agent memory in v2.10)" records what was built in v2.10 and for which model. Provenance, not a requirement.',
  },
  // Model-specific SAFETY behavior ----------------------------------------
  // Not a capability gate: the cyber-classifier refusal is a property of one
  // named model. There is no capability phrasing for it, and hedging it into
  // "some models" would strip the actionable detail. Kept, but hedged in prose.
  {
    file: 'commands/pan/focus-auto.md',
    snippet: 'notably Claude Fable 5',
    reason: 'names the specific model whose INPUT SAFETY CLASSIFIER can refuse defensive security review — a factual per-model behavior (already hedged with "Some session models — notably"), not a capability gate.',
  },
];

function* mdFiles(dir) {
  const abs = path.join(ROOT, dir);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (SKIP_DIR_NAMES.has(e.name)) continue;
      if (EXCLUDED_DIRS.some((x) => x.dir === rel)) continue;
      yield* mdFiles(rel);
    } else if (e.name.endsWith('.md')) {
      yield rel;
    }
  }
}

function rootMdFiles() {
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name);
}

function isExempt(rel) {
  if (EXCLUDED_FILES.some((x) => x.file === rel)) return true;
  if (GENERATED_FILES.some((x) => x.file === rel)) return true;
  return EXCLUDED_DATED.some(({ re }) => re.test(rel));
}

/** Every scanned file, repo-relative with forward slashes. */
function scanTargets() {
  const out = [];
  for (const dir of SCAN_DIRS) for (const rel of mdFiles(dir)) out.push(rel);
  out.push(...rootMdFiles());
  return out.filter((rel) => !isExempt(rel));
}

const lines = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').split(/\r?\n/);

/**
 * Every version-pinned match on a line, as {what, text, start, end}. A match
 * fully contained in a longer one is dropped, so `claude-opus-4-8` is reported
 * once rather than also as the `opus-4` inside it.
 */
function modelMatches(line) {
  const found = [];
  for (const { re, what } of MODEL_PATTERNS) {
    for (const m of line.matchAll(re)) found.push({ what, text: m[0], start: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const m of found) if (!kept.some((k) => k.start <= m.start && m.end <= k.end)) kept.push(m);
  return kept;
}

/** The [start,end) spans of `line` that this file's allowlist entries exempt. */
function allowlistSpans(entries, line) {
  const spans = [];
  for (const a of entries) {
    if (a.snippet) {
      for (let i = line.indexOf(a.snippet); i !== -1; i = line.indexOf(a.snippet, i + 1)) {
        spans.push({ entry: a, start: i, end: i + a.snippet.length });
      }
    } else {
      const g = a.re.flags.includes('g') ? a.re : new RegExp(a.re.source, `${a.re.flags}g`);
      for (const m of line.matchAll(g)) spans.push({ entry: a, start: m.index, end: m.index + m[0].length });
    }
  }
  return spans;
}

/**
 * Single pass over the scan set. Returns the violations and the allowlist
 * entries that actually suppressed a match (an entry that suppressed nothing is
 * stale — see the second test).
 */
function scanAll() {
  const violations = [];
  const suppressed = new Set();
  for (const rel of scanTargets()) {
    const entries = ALLOWLIST.filter((a) => a.file === rel);
    lines(rel).forEach((line, i) => {
      const matches = modelMatches(line);
      if (matches.length === 0) return;
      const spans = entries.length > 0 ? allowlistSpans(entries, line) : [];
      for (const m of matches) {
        const cover = spans.find((s) => s.start <= m.start && m.end <= s.end);
        if (cover) { suppressed.add(cover.entry); continue; }
        violations.push(`${rel}:${i + 1} — ${m.what}: "${m.text}"\n    ${line.trim()}`);
      }
    });
  }
  return { violations, suppressed };
}

describe('model-version drift lint (capability-based phrasing — audit 2026-08)', () => {
  test('shipped content and live docs gate features by capability, never by model version', () => {
    const { violations } = scanAll();
    assert.equal(violations.length, 0,
      'Hardcoded Claude model version in shipped content / live docs:\n' +
      `${violations.join('\n')}\n\n` +
      "Use capability-based phrasing (e.g. 'a model with a 1M-context window', " +
      "'thinking-capable models', 'the default Opus') — or name the RUNTIME when the " +
      'runtime is the real constraint. See tests/model-version-drift.test.cjs for the ' +
      'allowlist mechanism.\n' +
      'A version number is only acceptable for a selectable VALUE (config key, CLI arg, ' +
      'sample payload, a quote of the code\'s own model table) or a true historical ' +
      'statement ("shipped in v2.10.0"). Never for a requirement: state the capability. ' +
      'Do NOT point the reader at detectModelCapabilities() as a gate either — it is a ' +
      "hand-maintained substring table whose only consumer is the installer's advisory " +
      'warning, and it gates no feature.');
  });

  test('the allowlist has no stale entries (every exemption still suppresses a real match)', () => {
    const { suppressed } = scanAll();
    const stale = ALLOWLIST.filter((a) => !suppressed.has(a))
      .map((a) => `${a.file} — ${a.snippet ? `snippet ${JSON.stringify(a.snippet)}` : `re ${a.re}`}`);
    assert.equal(stale.length, 0,
      'Allowlist entries that no longer suppress anything (the line was reworded or ' +
      `removed — delete the entry so the allowlist stays honest):\n${stale.join('\n')}`);
  });

  // Every exemption in this file is only defensible with its rationale attached
  // — that is what lets the next reader tell "quotes the code's own table" from
  // "someone wanted the test to pass". The header says every entry carries one;
  // until now nothing checked, so a `reason`-less entry would have sailed
  // through review. ALLOWLIST uses `reason`; the exclusion tables use `why`.
  test('every exemption and allowlist entry carries a non-empty rationale', () => {
    const groups = [
      ['EXCLUDED_DIRS', EXCLUDED_DIRS, 'why', (e) => e.dir],
      ['EXCLUDED_FILES', EXCLUDED_FILES, 'why', (e) => e.file],
      ['GENERATED_FILES', GENERATED_FILES, 'why', (e) => e.file],
      ['EXCLUDED_DATED', EXCLUDED_DATED, 'why', (e) => String(e.re)],
      ['ALLOWLIST', ALLOWLIST, 'reason', (e) => `${e.file} ${e.snippet ? JSON.stringify(e.snippet) : String(e.re)}`],
    ];
    const missing = [];
    for (const [name, entries, field, label] of groups) {
      assert.ok(entries.length > 0, `${name} is empty — the rationale check would be vacuous`);
      for (const e of entries) {
        const v = e[field];
        // A one-word "historical" is not a rationale; require a real sentence.
        if (typeof v !== 'string' || v.trim().length < 20) {
          missing.push(`${name}: ${label(e)} — ${field} is ${v === undefined ? 'absent' : JSON.stringify(v)}`);
        }
      }
    }
    assert.deepEqual(missing, [],
      'Every exemption must say WHY it is exempt, in prose, on the entry itself:\n' +
      `${missing.join('\n')}`);
  });

  // -------------------------------------------------------------------------
  // Anti-regression guard. The verifier's finding: a per-root "some file starts
  // with <dir>/" assertion is satisfied by a single TOP-LEVEL file, so deleting
  // the recursive branch of the walk silently dropped 19 nested files with every
  // test still green. Recursion is now pinned two ways: named nested files, and
  // per-root floors set ABOVE the count a non-recursive walk would produce.
  // -------------------------------------------------------------------------
  const NESTED_MUST_SCAN = [
    // Shipped templates that only exist in subdirectories — if the walk stops
    // recursing, these disappear. If any is legitimately renamed, replace it
    // with another file at the same depth; never delete the assertion.
    'pan-wizard-core/templates/codebase/architecture.md',
    'pan-wizard-core/templates/research-project/summary.md',
    // docs/ has exactly one nested subtree (docs/branding/, incl. handoff/), so
    // the docs floor alone cannot prove the docs walk recursed. This file sits
    // TWO levels down, which pins both levels at once.
    'docs/branding/handoff/IMPLEMENTATION.md',
  ];

  // Floors, not exact counts (exact counts belong in CLAUDE.md and drift). Each
  // number is derived from today's RECURSIVE count minus a little churn
  // headroom, and must stay clear of the count a NON-recursive walk produces —
  // otherwise adding top-level files silently re-enables the broken walk:
  //   pan-wizard-core/templates — 42 recursive / 28 flat → floor 38 (10 clear)
  //   docs (after exemptions)   — 19 recursive / 14 flat → floor 17 (3 clear)
  // The docs margin is the tight one; NESTED_MUST_SCAN above is its real guard.
  // If a floor legitimately fails because content was archived, lower it and
  // update the comment — do not delete the assertion.
  const MIN_SCANNED = [
    { dir: 'commands/pan', min: 50 },              // 59 today
    { dir: 'agents', min: 20 },                    // 24 today
    { dir: 'pan-wizard-core/workflows', min: 28 }, // 33 today
    { dir: 'pan-wizard-core/templates', min: 38 }, // 42 today (14 of them nested)
    { dir: 'pan-wizard-core/references', min: 13 }, // 16 today
    { dir: 'docs', min: 17 },                      // 19 today after exemptions (5 nested)
    { dir: 'pan-zcode', min: 2 },                  // README.md + KNOWN-BETA-RISKS.md
  ];

  test('the lint actually scans the surfaces it claims to (guards a broken or non-recursive walk)', () => {
    const targets = scanTargets();
    for (const { dir, min } of MIN_SCANNED) {
      const n = targets.filter((rel) => rel.startsWith(`${dir}/`)).length;
      assert.ok(n >= min, `scan produced only ${n} .md files under ${dir}/ (expected >= ${min}) — the walk is broken or no longer recursive`);
    }
    for (const rel of NESTED_MUST_SCAN) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is missing — update NESTED_MUST_SCAN with another nested file`);
      assert.ok(targets.includes(rel), `nested file ${rel} is not scanned — the walk stopped recursing`);
    }
    // Root-level live docs.
    assert.ok(targets.includes('README.md'), 'README.md must be scanned');
    assert.ok(targets.includes('CONTRIBUTORS.md'), 'CONTRIBUTORS.md must be scanned (its version-pinned attribution is allowlisted, not ignored)');
    assert.ok(targets.includes('pan-zcode/README.md'), 'pan-zcode/README.md is shipped by package.json `files` and must be scanned');
    assert.ok(targets.includes('pan-zcode/KNOWN-BETA-RISKS.md'), 'pan-zcode/KNOWN-BETA-RISKS.md must be scanned');
    // Exclusions must actually exclude.
    for (const { dir } of EXCLUDED_DIRS) {
      assert.ok(!targets.some((rel) => rel.startsWith(`${dir}/`)), `${dir}/ must be excluded`);
    }
    for (const { file } of [...EXCLUDED_FILES, ...GENERATED_FILES]) {
      assert.ok(!targets.includes(file), `${file} must be excluded`);
    }
    assert.ok(!targets.some((rel) => rel.startsWith(NEVER_SCANNED_SUBTREE)),
      `${NEVER_SCANNED_SUBTREE} holds factual run records and must never be scanned`);
    // The dated-family exemptions must require their date component: an
    // evergreen doc in the same namespace must NOT inherit the exemption.
    assert.ok(isExempt('docs/ECOSYSTEM-REVIEW-2026-06.md'), 'dated ecosystem reviews must be excluded');
    assert.ok(isExempt('docs/FIELD-HARVEST-2026-07.md'), 'dated field harvests must be excluded');
    assert.ok(isExempt('docs/FIELD-REPORT-army-2026-06.md'), 'dated field reports must be excluded');
    assert.ok(!isExempt('docs/FIELD-GUIDE.md'), 'an undated docs/FIELD-*.md is a live doc and must NOT inherit the dated-report exemption');
    assert.ok(!isExempt('docs/ECOSYSTEM-REVIEW.md'), 'an undated ecosystem review must NOT inherit the dated-report exemption');
  });

  // -------------------------------------------------------------------------
  // The lint's own teeth. Every string below was verified against the real
  // pre-sweep content or is a shape the first version of these patterns missed.
  // -------------------------------------------------------------------------
  test('the patterns bite: every known drift shape is caught', () => {
    const mustCatch = [
      // The real pre-sweep line (commands/pan/map-codebase.md @ 05e8f5b:64).
      'Opus 4.7 is required for single-shot mode (only model with a 1M context window). Other models always take the sharded path regardless of size.',
      '- **`mode: "single-shot"`** — repo is small enough (≤700K tokens) for one Opus 4.7 agent to ingest the whole thing.',
      // Separator variants the space-only pattern missed.
      'requires Opus-4.7 or newer',
      'requires Opus4.7 or newer',
      'requires Opus v4.7 or newer',
      'requires Opus (4.7) or newer',
      'set the model to opus-4.7 first',
      'Opus_4.7 only',
      // Other families.
      'Claude 4.8 only',
      'Sonnet 4.6 and up',
      'Haiku 4.5 is too small',
      'thinking works on Fable 5 only',
      'Mythos 5 required',
      // Bare majors survived the count-noun tightening (see COUNT_NOUNS): the
      // noun-refusing branch must not swallow real version pins.
      'Opus 5 is required for single-shot mode',
      'Opus 5 has a 1M context window',
      'use Opus-5 for planning',
      'Some session models — notably Claude Fable 5 — run a cyber classifier',
      // Concrete IDs, both orderings.
      'pin the agent to claude-opus-4-8',
      'legacy default was claude-3-5-sonnet-20241022',
      'legacy default was claude-3-opus-20240229',
      'legacy default was claude-instant-1.2',
      'legacy default was claude-2.1',
    ];
    const missed = mustCatch.filter((s) => modelMatches(s).length === 0);
    assert.deepEqual(missed, [], `these version-pinned strings slipped through MODEL_PATTERNS:\n${missed.join('\n')}`);

    const mustPass = [
      // The approved phrasings the sweep moved everything to.
      'runs on the default Opus model regardless of your session model',
      'Opus (reasoning) handles planning; budget steps down to Sonnet/Haiku',
      'thinking-capable models emit an extended-thinking block',
      'assumes a model with a 1M-context window',
      'Opus-class models only — no version implied',
      'Mission Control (Opus) delegates to 4 squads',
      'Opus (4 squads) is not a version',
      'the real constraint is the runtime: native sub-agent spawning',
      // PAN's own release history stays history.
      'shipped v2.10.0 — E-7',
      'see ADR-0023 for the adoption decision',
      'Claude Code strips the frontmatter for the other four runtimes',
      // Numbers that are not versions.
      'if Fable 400s on every call, back off and retry',
      'repos <= 700K tokens go single-shot',
      'Opus-2nd pass over the diff',
      'claude-code-2 is not a model ID',
      // A family name followed by a COUNT is not a version. All of these were
      // live false positives of the earlier `\s?\d{1,2}` branch — none of them
      // pins a model, and an author writing any of them deserves silence.
      'Claude 5 runtimes are supported',
      'Claude 3 runtimes',
      'spawn Opus 4 agents in parallel',
      'Opus 2 workers per squad',
      'Sonnet 3 shards, one pass each',
      'Haiku 8 passes over the diff',
      'Fable 2 sessions ran overnight',
    ];
    const falsePositives = mustPass
      .map((s) => [s, modelMatches(s)])
      .filter(([, m]) => m.length > 0)
      .map(([s, m]) => `"${s}" → matched ${JSON.stringify(m.map((x) => x.text))}`);
    assert.deepEqual(falsePositives, [], `MODEL_PATTERNS false-positived on approved phrasing:\n${falsePositives.join('\n')}`);
  });

  // -------------------------------------------------------------------------
  // Backstop for the GENERATED exemption. SKILLS-FULL-TEXT.md / -REFERENCE.md
  // are exempt because the fix belongs in the source doc — but nothing forced a
  // regeneration, so a swept source could sit next to a stale copy that still
  // reads "Opus 4.7 is required". These files embed source lines VERBATIM, so:
  // every version-pinned line in a generated file must still exist, trimmed and
  // character-for-character, in one of its sources. If it does not, the copy is
  // stale. (If the source line itself is a violation, the first test reports it
  // there — this test is only about the copy being out of date.)
  // -------------------------------------------------------------------------
  test('generated skills docs are not stale (every version-pinned line still exists in a source doc)', () => {
    const sourceLines = new Set();
    for (const dir of GENERATED_SOURCE_DIRS) {
      for (const rel of mdFiles(dir)) for (const line of lines(rel)) sourceLines.add(line.trim());
    }
    assert.ok(sourceLines.size > 1000, `only ${sourceLines.size} source lines indexed — GENERATED_SOURCE_DIRS is wrong`);

    const stale = [];
    for (const { file } of GENERATED_FILES) {
      if (!fs.existsSync(path.join(ROOT, file))) continue;
      lines(file).forEach((line, i) => {
        const matches = modelMatches(line);
        if (matches.length === 0) return;
        if (sourceLines.has(line.trim())) return; // still verbatim in a source doc
        stale.push(`${file}:${i + 1} — ${matches.map((m) => `"${m.text}"`).join(', ')}\n    ${line.trim()}`);
      });
    }
    assert.equal(stale.length, 0,
      'Generated skills docs carry version-pinned lines that no longer exist in any source ' +
      `doc — the source was fixed and the generated copy was not regenerated:\n${stale.join('\n')}\n\n` +
      `Run \`${GENERATOR_CMD}\` and commit the result. Never hand-edit the generated files.`);
  });
});
