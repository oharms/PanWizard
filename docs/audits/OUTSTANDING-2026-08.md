# Outstanding Work — E2E Audit Chain 2026-08

**As of:** 2026-08-06 · **Branch:** `fix/e2e-audit-highs-2026-08` · **Version:** v3.23.0 · **Sources:** [AUDIT-2026-08-e2e.md](AUDIT-2026-08-e2e.md) (137 findings), [AUDIT-2026-08-e2e-VERIFICATION.md](AUDIT-2026-08-e2e-VERIFICATION.md) (Rounds 1–5), [AUDIT-2026-08-e2e-ROADMAP.md](AUDIT-2026-08-e2e-ROADMAP.md)

> Point-in-time record. Line numbers were accurate at v3.23.0 and drift — locate by content. Counts here describe this document's own inventory and are exempt from the live-counts policy.

---

## Summary

**Nothing outstanding blocks a release.** All 137 original audit findings are resolved, no Critical was ever found in the chain, and no High is open. What remains is **16 items in two buckets**:

| Bucket | Items | Severity | Character |
|---|---|---|---|
| **A. Product defect** | 2 | 1 Medium, 1 Low | One mechanism, one decision closes both |
| **B. Consistency & hardening** | 14 | 3 Medium, 11 Low | Docs contradicting docs; lint edges; one missing test |

Bucket A is the only one where a user can observe wrong behavior (undercounted subagent spawns in `/pan:cost`). Bucket B is drift and cry-wolf risk: every item is a place where two surfaces describe one mechanism differently, or where a guard is weaker than it looks.

**Recommended sequencing:** A as one focused change with tests; B as a single sweep, because ten of the fourteen are one-line edits and four are in the same lint file. Do **not** parallelise B across agents by file — that is exactly how Rounds 2–5 produced doc-vs-doc contradictions.

---

## Bucket A — Product defect: the logger ledger row has no per-invocation discriminator

Two findings, one root cause. **Fix them together; fixing one alone leaves the other.**

### A1 · N26 — Same-type sibling rows collapse in the last-row dedup (Medium)

**Where:** `hooks/pan-cost-logger.js` (`isDuplicateOfLastRecord`, ~:426/:435) and `hooks/pan-trace-logger.js` (`isDuplicateCompletion`, ~:511/:520)

**What happens:** the Round-4 rework fixed the *marker* layer — two parallel subagents of the same type are now correctly admitted rather than suppressed as re-fires. But the row they produce is then dropped by a **pre-existing** guard: `agent_id` is hashed into the event signature yet never written into the ledger row, so two sibling rows are byte-identical modulo timestamp and the last-row dedup eats the second one.

**Reproduced** (both loggers, independently confirmed by an adversarial re-check): a verifier consumes the shared transcript, then two same-type events with distinct `agent_id`s fire — the second is marker-admitted (`__emptySlice: false`, completion event emitted) yet `appendRecord`/`appendTraceEvents` returns `false`. Result: **2 rows where 3 are correct**. A three-sibling wave yields 2 instead of 3.

**User-visible impact:** `/pan:cost` undercounts subagent spawns and therefore inflates per-agent averages. Worst on PAN's own core pattern — same-type executor/verifier waves.

**Fix:** write a per-invocation discriminator into the ledger row (the `agent_id` already available to the signature), and make the dedup consider it. This is a **ledger-row schema decision**, so decide once and apply to both loggers plus any consumer that reads the row shape (`cost.cjs` reporting, `/pan:cost`, trace consumers). Check whether existing ledgers need to tolerate rows without the field.

**Effort:** S–M · **Risk:** low, but touches a schema — grep every reader before landing.

### A2 · N29 — Byte-identical legitimate spawns stay suppressed (Low)

**Where:** `hooks/pan-cost-logger.js` ~:266 (the seen-signature guard)

**What happens:** the flip side of A1's trade-off. On a runtime whose `SubagentStop` payload carries no per-invocation field (only `session_id`/`transcript_path`/`cwd`/`agent_type`), a genuinely new spawn whose payload is byte-identical to an earlier one is indistinguishable from a re-fire, and the guard drops it. The old position-keyed guard happened to record it, because its key included the cursor position.

**Why it is Low and not a blocker:** cases (1) true re-fire → 1 row, (3) distinct sibling → 2 rows, and (5) M61 phantom → suppressed are **mutually contradictory on byte-identical input**. The guard deliberately fails toward suppression (undercount) rather than phantom rows (overcount), which is the safer error for cost reporting.

**Fix:** A1's discriminator closes this too — once the row carries per-invocation identity, byte-identical payloads stop being the only signal. If a runtime supplies no such field at all, document that residual explicitly in the hook rather than pretending it is solved.

**Effort:** none beyond A1 · **Verify:** the five-case behavior matrix already in `tests/cost-logger-hook.test.cjs` and `tests/trace-logger.test.cjs` — extend it with an "identical payload, distinct spawn" case and state which assertion fails on revert.

---

## Bucket B — Consistency & hardening

### B1 · Docs contradicting docs (3 Medium, 1 Low)

These are the class the audit chain kept re-creating: parallel edits describing one mechanism differently. **Sweep them in one pass, one author.**

#### B1.1 — `docs/USER-GUIDE.md` contradicts itself about the conductor's model (Medium)

`USER-GUIDE.md:882` ("an Opus **Mission Control** plans the mission") and `:886` ("Mission Control (the Opus conductor, in campaign mode)") survived a sweep that rewrote `commands/pan/army.md` and `docs/SKILLS-REFERENCE.md` to "the reasoning-tier conductor". `USER-GUIDE.md:911` — 25 lines later — correctly says *"no model gate exists, and Mission Control runs on whatever model you launched with."* `docs/ARCHITECTURE.md:106` carries the same stale claim ("pan-conductor in campaign mode (Opus, delegation-only)").

**Ground truth:** `pan-conductor` ships no `model:` frontmatter → resolves `reasoning` → `inherit` → runs on the session model.

**Why the lint misses it:** `tests/model-version-drift.test.cjs` matches version-pinned references, not a bare family name. Consider whether a bare-family rule is worth adding for gate sentences specifically (risk: high false-positive rate — see B2.2).

**Fix:** three sentences. **Effort:** XS.

#### B1.2 — Squad tier tables read as contradicting the profile story (Medium)

`docs/AGENTS.md:95-96`, `commands/pan/army.md:31-32`, their `SKILLS-FULL-TEXT` copies, and `pan-tools squad list` output all publish the Quality and Release squads as `mid` tier — which is what `squads.cjs` `SQUADS.quality.tier` / `SQUADS.release.tier` genuinely say. But the MODEL_PROFILES matrix ~500 lines later **in the same file** (`AGENTS.md:619-644`) gives every one of those agents `reasoning | reasoning | fast`, and `:649` states quality and balanced both inherit. Three Quality agents additionally pin `model: opus`. So under the default profile, no Quality-squad agent actually runs mid.

**This is a wording problem, not a number problem** — do not "fix" the tier values. Add one sentence distinguishing **squad tier** (a `squads.cjs` grouping/priority attribute) from **profile tier** (what actually resolves the model). `army.md`'s existing "Reading the Model-tier column" note hedges without saying the values don't describe what runs.

**Effort:** S (one clarifying sentence, applied to both tables + the note).

#### B1.3 — `docs/ARCHITECTURE.md:72` undercounts model-name readers (Medium)

The parenthetical says "**Two** places do read a model name for non-gating reasons" (installer advisory + `cost.cjs` `resolveRate()`). A third exists in shipped runtime code: `hooks/pan-cost-logger.js:57-62` `tierForModel()` matches `/opus|fable|mythos/i` → `reasoning`, `/sonnet/i` → `mid`, `/haiku/i` → `fast`, and `buildCostRecord` writes the result into every ledger row (~:302). A fourth if display counts (`hooks/pan-statusline.js:28` reads `data.model.display_name`).

The surrounding claim — *no module gates a **feature** on the model name* — is true and verified. Only the count is wrong, in the very paragraph Round 4 rewrote to remove an over-claim. **Drop the count** ("a small number of places … including the cost hook's tier label") rather than maintaining a tally.

**Effort:** XS. **Note:** this is the third time an absolute/counted claim in this file has been wrong. Prefer non-enumerating phrasing here permanently.

#### B1.4 — Exhaustive "only … `unknown`" claim is false for synthetic ids (Low)

`docs/ARCHITECTURE.md:84` and the header of `tests/model-version-drift.test.cjs` (~:36-42) both say only an id matching *no* family-and-release pair lands on the all-false `unknown`. Probed counterexamples that **do** parse a family and release and still return `unknown`: `claude-opus-0/1/2/3`, `claude-sonnet-2/3`, `claude-haiku-2/3` — at or below the legacy threshold, so no fallback fires, and they match no explicit branch (`claude-3` needs that literal substring, which family-first names lack).

**Behavior is fine** (no real Anthropic id has this shape; `claude-3-opus` resolves). Two sentences are over-broad. `pan-wizard-core/references/model-profiles.md:37` and `USER-GUIDE.md:127` already phrase it correctly — copy their wording.

**Effort:** XS.

### B2 · Anti-drift lint hardening (5 Low, all in `tests/model-version-drift.test.cjs`)

Do these as one edit to one file.

#### B2.1 — `pan-zcode` floor is an exact pin, not a floor
`MIN_SCANNED` has `{ dir: 'pan-zcode', min: 2 }` against a recursive count of exactly 2, so retiring or renaming either doc fails the floor — and two explicit `targets.includes('pan-zcode/…')` assertions already cover the same ground more strongly. Either drop the row or label it as an exact pin. The file's own comment claims each number is "today's recursive count minus churn headroom", which isn't true here. (The `docs` floor is tight at +2 and does acknowledge it.)

#### B2.2 — `COUNT_NOUNS` will cry wolf on PAN's own vocabulary
The bare-major branch exempts only the 30 listed nouns. These all currently **match** and would be reported as version pins: `Opus 4 sub-agents`, `Opus 4 reviewers`, `Opus 4 checkers`, `Opus 4 rounds`, `Opus 4 tokens`, `Opus 4 windows`, `Sonnet 4 batches`, `Haiku 4 summaries`. `sub-agents` is the sharp one — `subagent` **is** listed but the hyphenated spelling PAN's own docs use is not. No live false positive today. Cheapest fix: allow an optional hyphen (`sub-?agent`) and add `reviewer|checker|round|iteration|batch|token|window|thread|summary`.

#### B2.3 — Underscore-separated ids unmatched
The concrete-id regex accepts hyphens only after `claude`, so `claude_opus_4_7` scans clean while `claude-opus-4-7`, `claude-opus-4.7`, `anthropic/claude-opus-4-7` and `us.anthropic.claude-opus-4-7-v1:0` all match. Not a real Anthropic form, but the family-name branches already accept `[\s\-_]`, so this is an asymmetry rather than a choice. Widen the first separator to `[-_]`.

#### B2.4 — `SKIP_DIR_NAMES` has no rationale and is not asserted
The rationale test covers `EXCLUDED_DIRS`, `EXCLUDED_FILES`, `GENERATED_FILES`, `EXCLUDED_DATED` and `ALLOWLIST`, but `SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist'])` is a bare Set — a fourth entry could be added with no justification and no test would notice, against the file's own stated invariant. Its `dist` entry currently hides ~220 generated `.md` copies under `dist/pan-wizard-plugin/` (full copies of `commands/pan/`, `agents/`, learnings). **Harmless today** — verified `dist/` is gitignored, is not in `package.json` `files`, and carries no version pins — but if plugin build output is ever shipped, stale pins would ship unscanned. Give the entries a `why` and include them in the rationale groups; same for `NEVER_SCANNED_SUBTREE`, whose rationale is a comment rather than a field.

#### B2.5 — `model-profiles` allowlist regex is fragile to a formatting edit
Its lookbehind forbids backticks in table cell 1, so `| Fable | \`claude-fable-5\` | … |` is correctly exempt but `| \`Fable\` | \`claude-fable-5\` | … |` yields zero spans — a routine edit that backticks the class name turns a legitimate id cell into a reported violation. **Fails closed**, so it is not a hole, but the exclusion is load-bearing and undocumented. Note it cannot simply be relaxed (`[^|]*` in cell 1 would let a backticked id in cell 1 satisfy the lookbehind). Add a one-line comment, or anchor on the class-name column explicitly.

### B3 · Test coverage gap (1 Low)

#### B3.1 — The capability table's only consumer has no test
~20 cases pin `detectModelCapabilities` as a pure function (forward majors, point releases, date-suffix guard, legacy over-reach, non-Claude), but nothing asserts the behavior a user experiences: that `bin/install.js:2601-2624` **prints** the advisory notice for a capability-poor model and **stays silent** under `--skip-warnings`.

**Why this matters specifically:** that path is exactly where the original M5 defect lived — an out-of-scope `targetDir` `ReferenceError` swallowed by a bare `catch {}`, making the warning permanently unreachable while the suite stayed green (see [AUDIT-2026-08-e2e.md](AUDIT-2026-08-e2e.md), M5). Every existing installer test passes `--skip-warnings`, so the branch is never exercised. Re-introducing that shape today would again go unnoticed.

**Fix:** a temp-dir install with `{"model": "claude-3-haiku-20240307"}` in `settings.json` asserting the notice text appears, plus the same run with `--skip-warnings` asserting it does not. **Effort:** S.

### B4 · Version-pinned strings that survived by design (2 Low)

#### B4.1 — Installer code comment and its printed recommendation
`bin/install.js:2599` still labels the block "E-9: Opus 4.7 capability detection" while `docs/ARCHITECTURE.md` renamed the mechanism to "Model-capability integration" and CLI-REFERENCE renamed §20.1. More consequentially, `:2616-2618` **prints to the user**: "select `claude-fable-5` … or an Opus-tier model (`claude-opus-5` / `claude-opus-4-8`)" — the last user-visible surface hardcoding specific ids, which will name superseded models on the next lineup move. Per `docs/ECOSYSTEM-REVIEW-2026-06.md:62` this string has already been re-pointed twice.

**Fix:** rename the comment; make the recommendation tier-based, or derive the names from one constant so the next move is a one-line edit. Code is deliberately outside the lint's scope, but this is the lint's own subject matter.

#### B4.2 — Remaining live-prose `4.7` mentions (informational, no action needed)
`CONTRIBUTORS.md:19` ("Opus 4.7 integration") and `docs/HOOKS.md:94` (`"model": "claude-opus-4-7"`) survive as **deliberate, reasoned allowlist entries** in the lint — historical attribution and a config example. Recorded so a future reader doesn't mistake them for drift.

### B5 · Repo hygiene (1 Low)

#### B5.1 — Counts SSoT reads gitignored build output
CLAUDE.md's documented refresh snippet uses `ls('hooks/dist', /\.js$/)` and `tests/claude-md-counts.test.cjs:48` maps the row labelled ``Hooks (`hooks/*.js`)`` to `hooks/dist`. `hooks/dist/` is gitignored, so on a **fresh clone** the snippet throws `ENOENT` and the test's helper returns `-1`, tripping its own "filesystem path not found" assertion. CI is unaffected (`ci.yml` runs `npm run build:hooks` before `npm test`), and the number is identical either way. **Fix:** point both at `hooks` to match the label and survive a clean checkout.

### B6 · Deliberately deferred

**`docs/branding/` drafts still say "200K".** `docs/branding/README-brand-draft.md:42,:53` and the identical pair under `docs/branding/handoff/` carry the bare number that was removed from the live doc set. They are marketing drafts, retained by that directory's own keep-list, and were scoped out of the sweep. The audit record's claim was narrowed to the live docs rather than de-numbering the drafts. **Revisit only if a draft is promoted to a live doc.**

---

## What is explicitly *not* outstanding

So a future audit doesn't re-litigate settled ground:

- **All 137 original findings** are resolved and independently verified. No Critical was ever found.
- **N21, N23, N28** were record errors, not product defects — corrected inside the audit documents. N28's false "statusline-guard coverage" claim also sits in an immutable commit message, which is why Round 3 flagged rather than closed it.
- **Three durable guards** now make whole classes unable to regress silently: `tests/shipped-content-prefix.test.cjs` (runtime path-prefix), `tests/statusline-guard.test.cjs` (a branch that regressed twice), `tests/model-version-drift.test.cjs` (model-version pins).
- **The `.gitignore` secrets path** (`!experiments/**` undoing every blanket rule above it) is fixed and verified in both directions. Method note for future checks: `git check-ignore -v` prints the matching pattern **even when that pattern is a negation**, so a not-ignored path looks identical to an ignored one — test by exit code (`-q`).
- **Byte-identical same-type sibling payloads** are an irreducible ambiguity, not a bug: re-fire suppression and sibling admission are mutually contradictory on identical input. The guard fails toward undercount deliberately.

---

## Process lesson worth keeping

Every round of this chain but the last found that the **previous** fix pass had introduced something new — including commit messages that claimed tests which were not in the diff (twice). Two rules earned the hard way:

1. **Verify fix claims against `git diff`, never against the commit message.**
2. **Do not parallelise prose edits about one mechanism across agents.** Every doc-vs-doc contradiction in Rounds 2–5 came from two agents writing about the same gate from different files. Bucket B1 exists because of exactly this.
