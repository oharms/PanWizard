# Outstanding Work — E2E Audit Chain 2026-08

**As of:** 2026-08-06 · **Branch:** `fix/e2e-audit-highs-2026-08` · **Version:** v3.23.0 · **Sources:** [AUDIT-2026-08-e2e.md](AUDIT-2026-08-e2e.md) (137 findings), [AUDIT-2026-08-e2e-VERIFICATION.md](AUDIT-2026-08-e2e-VERIFICATION.md) (Rounds 1–5), [AUDIT-2026-08-e2e-ROADMAP.md](AUDIT-2026-08-e2e-ROADMAP.md)

> **What "closed" means here: an uncommitted working-tree change set.** When this record was written, `git rev-parse HEAD` was `1d4e209` ("release(v3.23.0)") and the index was empty — every fix described below existed only as unstaged modifications in the files `git status --porcelain` listed. The work targets the next patch release. So do not read "closed" as "committed", and do not treat this document as evidence of where the work lives. Establish that yourself:
>
> ```bash
> git rev-parse HEAD && git status --porcelain && git diff --stat
> ```
>
> If the change set has since been committed, that is the expected end state, not a contradiction of this note.

> Point-in-time record. Line numbers were accurate when written and drift — **locate by content, never by line**.
>
> **This document carries no counts about code.** Not surfaces, not readers, not files, not test cases, not corpus entries — and no "the one place" / "every reader" / "only X" absolutes about code structure. Where a claim has members, the class is named and a command that enumerates it is given. A written total is a claim someone has to maintain, and this chain kept finding ones that had not been (see [the process lesson](#process-lesson-worth-keeping)). This is the repo's own counts doctrine — CLAUDE.md: *delete the number rather than chase the drift* — applied to prose about code.
>
> Counts describing **this document's own inventory** (buckets, items) are inventory labels rather than measurements and stay, as do the item ids (A1, B1.1, L1 …), which are stable labels.

---

## Summary

The items this document tracked were executed as a single fix pass. Every one was then re-verified against the working tree rather than against the pass's own account of itself, and that re-verification is what produced the live ledger below.

| Bucket | Disposition |
|---|---|
| **A. Product defect** (2 items) | **Both closed.** The ledger-row discriminator landed in both loggers with a behavior matrix and a backward-compatibility test. A defect in the layer beneath them surfaced during re-verification — **L3** — and the guard first written for it was later **reverted as a net regression**; the entry now records an accepted residual instead of a fix. |
| **B. Consistency & hardening** (14 items) | **All closed but B6**, which is deferred by design (**L2**). Both residuals a closed item left behind — **B1.1 → L1** and **B2.2 → L4** — have since been closed too, verified by their own stated closure checks rather than by a claim. |

Three ledger entries were **not** tracked items — **L3** (found while re-verifying bucket A), **L5** (a lint regression the pass introduced), and **L6** (a recurrence this document's own process lesson had predicted). L3's disposition changed twice; read its entry rather than this row.

**A status in this table is a snapshot, and this record has now watched three entries change under it.** Ledger statuses were re-derived from the tree on each pass, not carried forward: L1 and L4 were open when first written and their own closure checks pass now, and L3 went open → fixed → *reverted*. Re-derive before relying on any of them.

**Release posture.** `node scripts/release-check.js` runs the release gates (read the script for the current set — do not trust a list written here). **The tree moved under this record while it was being written**, which is the honest headline: `tests/model-version-drift.test.cjs` was red mid-pass and release-blocking (L5), and green again by the end. So verify rather than believe any posture sentence, this one included. Re-run clean at the end of this pass: `node --test tests/doc-lint.test.cjs`, `node --test tests/model-version-drift.test.cjs`, `node --test tests/hud.test.cjs tests/squads.test.cjs tests/e2e-install.test.cjs`, both hook suites, and `node pan-wizard-core/bin/pan-tools.cjs links validate` (`status: pass`, zero errors, only pre-existing `B-002` warnings about ADR backlink density, unrelated to this chain). What remains open is stale prose and one accepted, documented residual in the hooks — not broken behavior — so **nothing in the ledger blocks a release as this closes.**

---

## Live ledger

**L2 and L6 are open. L1, L4 and L5 are closed. L3 is closed as an *accepted residual*, not as a fix** — the guard written for it was reverted. Closed entries are retained with their evidence: an entry that was real and got fixed is worth more here than a deleted one, because the next pass needs to know the failure mode existed — and L3 is the sharper case, where knowing what was *tried and withdrawn* is the whole value.

### L1 · The bare-family model claim for Mission Control survives in the *generated* skills docs (Medium — closed)

**Status:** **closed**, and closed by running L1's own two stated checks rather than by inspecting the fix. Both pass now: `docs/SKILLS-REFERENCE.md`'s `**Lines:** 182` for `/pan:army` equals `wc -l < commands/pan/army.md`, and the "Squad tier is not profile tier" paragraph in `docs/SKILLS-FULL-TEXT.md` was byte-identical to the one in `commands/pan/army.md` when this status was set. The generator had been run; the copies were no longer stale.

> **It did not stay closed, and that is recorded as L6, not hidden here.** A later pass in this same chain edited `commands/pan/army.md` again (the tier table) *without* being able to touch the generated copies, so the content divergence returned immediately. The `**Lines:**` check still passes because that edit deliberately held the file's line count — which is worth knowing about that check: **it is a weak staleness signal, satisfied by an equal line count regardless of content.** The paragraph comparison is the real one. See **L6** below.

**B1.1 itself is closed** — every location that item named now says "the reasoning-tier conductor" / "elevated to campaign scope", and the sources it did *not* name were swept in the same pass (`README.md`, which gained an explicit "**Mission Control runs on your session's model**" sentence, and `commands/pan/army.md`, whose pipeline block now reads `Mission Control (session model, xhigh effort)` and whose ALWAYS-DO line now reads "Plan on the session model Mission Control inherits").

**What was wrong:** `docs/SKILLS-FULL-TEXT.md` is **generated** from `commands/pan/*.md` + `agents/*.md`, and it had not been regenerated after those source edits, so it still asserted the claim the sources dropped. Never hand-edit it — regenerate:

```bash
python scripts/generate-skills-docs.py
git diff --stat docs/SKILLS-FULL-TEXT.md docs/SKILLS-REFERENCE.md   # non-empty ⇒ the copies were stale
```

Two checks establish staleness rather than suspect it, and both survive as checks: compare `docs/SKILLS-REFERENCE.md`'s `**Lines:**` metadata for `/pan:army` against `wc -l < commands/pan/army.md`, and compare the "Squad tier is not profile tier" paragraph in `docs/SKILLS-FULL-TEXT.md` against the same paragraph in `commands/pan/army.md`. Both disagreed when the item was written and both agreed when it was closed. **Weight them differently from here on:** the line-count check is satisfied by any edit that preserves the count, so it can pass over a fully divergent file; the paragraph comparison is the check that actually detects content drift, and it is the one that caught the recurrence in L6.

**Ground truth (re-verified against code, not against another doc):** `agents/pan-conductor.md` frontmatter carries `tools: Read, Write, Bash, Glob, Grep, Task` and `effort: xhigh` and **no `model:` field** → it resolves `reasoning` → `inherit` → it runs on whatever model launched the session. `squads.cjs`'s own header states it is "a registry + resolver only — it modifies no agent and changes no execution path", so nothing there strips the conductor's tools or picks its model either. Any sentence naming a family as the model Mission Control runs on asserts a selection PAN does not make.

**Enumerating the class instead of listing instances.** The class is *any sentence that names a model family as the model a specific PAN role runs on*. Two commands find its members; read each hit and judge it, because a family name is legitimate when it illustrates a **tier mapping** or a **model class** and wrong only when it claims what PAN selects:

```bash
# (a) the role-claim shape — a family name in the same line as the role
grep -rniE 'mission control|conductor' --include='*.md' README.md commands agents docs pan-wizard-core \
  | grep -iE '\b(opus|sonnet|haiku|fable|mythos)\b' \
  | grep -vE '^docs/(audits|decisions|specs|archive)/'

# (b) the whole bare-family class — a family name carrying no version digit
grep -rniE '\b(opus|sonnet|haiku|fable|mythos)\b' --include='*.md' README.md CONTRIBUTORS.md commands agents docs pan-wizard-core \
  | grep -viE '(opus|sonnet|haiku|fable|mythos)[ ._/-]?[0-9]' \
  | grep -vE '^docs/(audits|decisions|specs|archive)/' | grep -v 'model: opus'
```

Grep (a) is tighter but blind to a role-free phrasing — "Plan on Opus" carries no role noun — which is exactly why (b) exists. The item is closed when (a) and (b) return only tier-mapping and model-class prose. Neither grep reaches the exempt historical records discussed below: their path exclusions mirror the lint's, and a version-pinned attribution is filtered out by (b)'s digit test anyway.

**Why no guard catches this, confirmed by reading the lint.** `tests/model-version-drift.test.cjs` scans `README.md` and the shipped content explicitly, but every entry in `MODEL_PATTERNS` requires a digit — `MAJOR = '\\d{1,2}'`, and the concrete-ID branch needs `\d` after the family. A bare `Opus` carries no digit, so the lint is **structurally blind** to the whole class. It is blind twice over: the *staleness backstop* for generated files (`generated skills docs are not stale`) only examines lines that `modelMatches()` already reports, so a stale generated line whose only model reference is a bare family name is skipped there too. That is precisely how the L1 residual survived a pass that fixed both its sources. This is the risk B1.1 flagged ("the lint matches version-pinned references, not a bare family name") and deliberately declined to fix, citing false-positive rate.

**Two further blind spots, found by this chain the hard way — both outside the greps above, not just outside the lint.** Greps (a) and (b) pass `--include='*.md'`, so neither reaches anything but Markdown, and the lint excludes code by design. That left two surfaces where the same claim class shipped unseen, and a later pass found a live instance on each:

- **Rendered strings in `.cjs`.** `hud.cjs`'s Mission Control strap was a hardcoded template literal reading `· opus · reasoning · delegation-only` — a *user-facing* assertion of both retired claims, on a surface users read as authoritative. No `.md` grep and no doc lint could ever have seen it. When checking this class, grep the renderers too: `grep -rniE '\b(opus|sonnet|haiku|fable|mythos)\b|delegation-only' pan-wizard-core/bin/lib hooks`.
- **The shipped learnings store.** `pan-wizard-core/learnings/**` is `NEVER_SCANNED_SUBTREE` in the lint — correctly, since those are factual run records whose model versions are the measurement. But the exemption is a *subtree* exemption, so it also exempts the store's **prescriptive** prose, and `learnings/universal/autonomous-loop.md` shipped "a delegation-only coordinator (never codes)" plus a rule step making the same claim. That content installs into user projects and is loaded by agents. The exemption is still right for the run-record lines; what it hides is rule prose. Check it by hand — `grep -rn 'delegation-only\|never codes' pan-wizard-core/learnings/` — because nothing else will.

**The standing question B1.1 left open, still open:** whether a bare-family rule is worth adding *for role-claim sentences specifically*. Any such rule must not fire on records that legitimately name the model of their era, and the exemption mechanisms differ per record — verify the mechanism before relying on it:

- `CHANGELOG.md` (v3.x army entry, "Mission Control (Opus conductor)") — excluded **by name**, in `EXCLUDED_FILES`.
- `docs/decisions/ADR-0033-army-campaign.md` ("the conductor (Opus, delegation-only, capped)") — **not** excluded by name; covered by the `docs/decisions` **directory** exclusion in `EXCLUDED_DIRS`, which exempts every ADR.
- `CONTRIBUTORS.md`'s historical attribution — deliberately **scanned**, with its version-pinned lines carried as `ALLOWLIST` entries (a guard test asserts the file stays in the scan set precisely so those lines are allowlisted rather than ignored).

Rewriting any of them would falsify the record. **Effort:** the skills-docs regeneration is done (and undone again — L6); S–M remains for a rule that does not cry wolf.

### L2 · `docs/branding/` drafts still say "200K" (Low — the number is deferred by design; the files were *not* untouched)

**The "200K" deferral is unchanged and intentional.** The drafts and `.dc.html` mockups under `docs/branding/` still carry the bare context number that was removed from the live doc set. Enumerate with `grep -rn "200K" docs/branding/` rather than trusting a description of which files and how many places — the directory is not maintained, so any list written here would be wrong first. They are marketing drafts retained by that directory's own keep-list and were scoped out of the sweep; the audit record's claim was narrowed to the live docs rather than de-numbering the drafts. **Revisit only if a draft is promoted to a live doc.**

**Correction to this entry's earlier wording.** It previously said "no action was taken and none is intended", and the first half was false: `git diff --stat docs/branding/` shows both copies of `README-brand-draft.md` (the top-level one and the `handoff/` duplicate) *were* edited in this chain. Not for the context number — for the bare-family and enforced-delegation claims, which had to be dropped wherever they shipped, drafts included: "an Opus **Mission Control**" became a Mission Control "running on the model you launched with", and the table cell `delegation-only (never codes)` became `delegation-first (instructed, not tool-enforced)`. **Two lessons, both cheap:**

- **A "deferred" entry is about a specific defect, not a lease on the file.** Another item's sweep can legitimately touch the same file, and this entry's absolute swallowed that.
- **`docs/branding/handoff/README-brand-draft.md` is a byte-duplicate of its parent** and was edited in lockstep by hand. Nothing enforces that; the next editor of one will silently diverge from the other. Check with `diff docs/branding/README-brand-draft.md docs/branding/handoff/README-brand-draft.md` before assuming they agree.

### L3 · The evicted-marker phantom (Low — closed as an ACCEPTED RESIDUAL; the guard written for it was reverted)

**Status:** **closed, but not by a fix.** The phantom is real, it is bounded, and it is now a **documented, accepted residual**. The widened dedup guard that had briefly closed it was **reverted as a net regression** by a later pass in this chain, after an adversarial verifier proved it destroyed real data. Read the whole entry before re-attempting anything here — this is the one entry in the ledger whose value is knowing what was tried and withdrawn.

**How it was found and what it was.** Surfaced while re-verifying A1/A2, and outside their scope: those items added the per-invocation discriminator to the *row*, while this was a property of the *marker* layer beneath it. A re-fire whose signature had aged out of the per-transcript FIFO (`MAX_SEEN_SIGS`) was re-admitted as a row. Reproduced rather than inferred: firing one slice-consuming event plus a wave of distinct empty-slice siblings wider than that window on a single transcript, then re-firing the *oldest* sibling's exact payload, appended an extra ledger row — while re-firing the *newest* sibling's payload was still suppressed.

**What was tried.** The file-tail dedup was widened from "compare against the immediately preceding row" to "scan a window of recent rows" (`MAX_DEDUP_LOOKBACK`), with a second prong: a repeated non-null `event_sig` suppresses a record that is *contentless* — no tokens on any axis, no measured duration. Restricting prong 2 to contentless records was believed to be what stopped it eating two sequential subagents on a shared growing transcript. Both hooks carried it and both suites were green.

**Why it was reverted — a verifier proved it deletes real cost data.** Green suites did not mean correct:

- **Prong 1 (the window) collapses genuine spawns.** Five real spawns on a shared transcript in the pattern X, Y, X, Y, X reduce to two ledger rows, because each row after the first two finds an identical earlier row *inside the window* that the old single-row comparison would never have reached. Real token counts vanish from the ledger. This was verified by running the identical input against `git show HEAD:hooks/*.js` and diffing the resulting ledgers — not reasoned about.
- **Prong 2's justifying invariant is false.** It rested on "an event that consumed a real transcript slice never looks contentless"; the verifier produced counterexamples. A record with real work behind it *can* present with no tokens on any axis and no measured duration, so restricting the prong to contentless records does not bound it to phantoms.
- **The trade is strictly bad.** The guard prevented an occasional phantom row by risking silent deletion of real spend. A phantom row is visible, over-counts, and can be reconciled against the transcript; a deleted row is invisible and unrecoverable. **Deleting real cost data is worse than the phantom it was preventing.** Note where the dial bottoms out: a window of 1 *is* the simple design, so "tune the window down until it is safe" converges on the revert rather than on a better guard. Anything above 1 reintroduces the collapse; the question was never the size.

**The accepted residual, stated rather than engineered away.** The dedup is back to the simple design: compare the new record against the immediately preceding row only. Therefore **a re-fire whose marker has aged out of the per-transcript FIFO (`MAX_SEEN_SIGS`) and is not the immediately preceding row is recorded as an extra row.** That is the phantom, undisguised. It requires a sibling wave wider than the marker window *plus* a re-fire of a non-adjacent member of that wave — the reproduction above. **The phantom's direction is over-count** — it adds a row that duplicates one already present, so it can inflate reported spend but cannot hide any. Do not read that as "the hooks never under-count". Two *separate* residuals bias the other way, on different layers, and all three must be kept apart when reasoning about any of them:

1. **N29, marker layer** — two *concurrent* same-type siblings whose payloads are byte-identical are indistinguishable from a re-fire, so the second is suppressed. Accepted by design.
2. **The adjacent-dedup under-count** — two *sequential* genuine spawns whose rows coincide in every field but `ts` (same agent, same tokens, same span) collapse to one row, losing the second's real tokens. Found while verifying this revert, reproduced on the real-slice path, and **identical in the pre-`event_sig` code**, so it is pre-existing rather than introduced. It is inherent to any adjacent whole-row dedup; removing the dedup instead reinstates the duplicate-row field bug the dedup was added for. Both hooks now state it in prose — that was the fix, since the defect was that the comments denied it. Both hooks state their own in prose, and `docs/HOOKS.md` documents the bound where a user reads it, which still discharges the "the bound is documented nowhere a user reads" half of this entry.

**Before touching this again**, note that the two directions are mutually exclusive on identical input, so any new guard is choosing a failure direction, not eliminating failure. State which direction you are choosing and why, and prove the change against real payloads by diffing ledgers against the pre-change hooks rather than by adding a test that passes. The current, deliberate choice is: **bias toward an over-count you can see.**

**The comment that caused it is gone.** `hooks/pan-cost-logger.js` had argued the marker window was "ample" because dual-registration re-fires arrive within the same dispatch — the exact reasoning the phantom falsified, and a claim its own later guard comment had come to contradict. Worth noting as a pattern: the wrong comment survived the first fix and was caught only by re-reading the file rather than the diff. **Check:** `grep -n 'is ample' hooks/*.js` returns nothing.

**Verify the hooks' current prose against the hooks, not against this paragraph.** The revert changed which explanation is correct, so a comment written for the widened guard is now itself a wrong comment — the same failure mode this entry already recorded once. Both checks are one line each and either can be run in isolation:

```bash
grep -n 'MAX_DEDUP_LOOKBACK' hooks/*.js                    # expect nothing after the revert
grep -n 'is ample' hooks/*.js                              # expect nothing (the original wrong comment)
grep -rn 'MAX_DEDUP_LOOKBACK' docs/HOOKS.md tests/         # any hit still describes the reverted design
```

If the first or third returns anything, the revert is incomplete or a doc/test still documents a guard that no longer exists — treat that as the open item, not as evidence this entry is wrong.

### L4 · B2.2's record of what it verified is broader than what was verified (Low — closed)

**Status:** **closed**, by running L4's own stated closure check: read the comment above the second block of `COUNT_NOUNS` and the corpus block in the false-positive test, and confirm neither claims universality. Neither does now, and `node --test tests/model-version-drift.test.cjs` is green.

**What it was.** The false-positive corpus B2.2 added carried a comment asserting that **every** string in it was reported as a version pin before being listed. Not so: a string whose noun was already in `COUNT_NOUNS` before B2.2 touched the list was already passing. The same code block then contradicted its own assertion, correctly noting that the unhyphenated spelling "was already exempt while the hyphenated spelling PAN's own docs use was not".

**What both comments say now.** The `COUNT_NOUNS` comment scopes its claim to the second block explicitly and then names the exception in the first block outright — that `sub-?agent` replaced an already-present `subagent`, so the unhyphenated spelling was never reported. The corpus comment carries the same exception as a `WITH ONE EXCEPTION` clause naming the exact entry, and keeps that entry deliberately, as the clean twin of the sharp case. Note the surviving universal ("Every noun in THIS block…") is now *true and checkable*: no noun in that block was in `COUNT_NOUNS` beforehand, so the pre-extension patterns reported all of them.

**Reproduce the distinction** by reverting only the `COUNT_NOUNS` additions and re-running `node --test tests/model-version-drift.test.cjs`, reading the *false-positive corpus* test specifically: the strings that fail there are the ones the extension actually fixed; the ones that still pass were never broken.

### L6 · The generated skills docs went stale again — the recurrence this document's own lesson 2 predicted (Medium)

**Status:** open. Not a new defect class: **the same one as L1**, recurring for exactly the reason [process lesson 2](#process-lesson-worth-keeping) gives — a source was edited by a pass whose file scope did not include the generated copies, and no source edit updates them.

**What happened.** L1 was closed by regenerating `docs/SKILLS-FULL-TEXT.md` / `docs/SKILLS-REFERENCE.md`, verified by both of its checks. A later pass in this chain then edited `commands/pan/army.md` — the tier table's Architecture and Quality membership cells, the Workers Model-tier cell, and the "Squad tier is not profile tier" paragraph — and could not touch the generated copies. So the copies now carry the superseded table.

**Why the line-count check does not catch it.** That pass deliberately preserved `army.md`'s line count, so `**Lines:** 182` in `docs/SKILLS-REFERENCE.md` still matches `wc -l < commands/pan/army.md`. The content check is the one that fires:

```bash
diff <(grep -F 'Squad tier is not profile tier' commands/pan/army.md) \
     <(grep -F 'Squad tier is not profile tier' docs/SKILLS-FULL-TEXT.md)   # non-empty ⇒ stale
python scripts/generate-skills-docs.py                                      # the fix; never hand-edit
```

**Fix:** run the generator. **Effort:** XS. **The durable fix is not the generator run** — it is a staleness guard that compares generated content to its sources without going through `modelMatches()` (the existing backstop only inspects lines the model lint already reports, which is why it sees neither this nor L1). Until that exists, treat "did I edit a `commands/` or `agents/` file?" as "regenerate before finishing".

### L5 · A snippet-pinned lint exemption went stale when `docs/HOOKS.md` was improved (was release-blocking; closed mid-pass)

**Status:** found during this pass with the lint suite **red**, then **fixed by a concurrent pass and re-verified green**. Retained on the record because the failure mode is the reusable part, not because anything is outstanding.

**What broke.** The HOOKS.md pass replaced illustrative record shapes with real dumped rows — a genuine improvement — and the dumped rows carried a newer model id than that file's `ALLOWLIST` entry was pinned to. Two tests failed together:

- `shipped content and live docs gate features by capability, never by model version` — the newer id, present in both the ledger-row and trace-completion sample payloads, was unexempt.
- `the allowlist has no stale entries (every exemption still suppresses a real match)` — the entry's pinned snippet no longer occurred anywhere in the file, so it suppressed nothing.

Because that suite runs inside `npm run test:all`, `node scripts/release-check.js` failed with it: for a window during the pass, a release was blocked.

**How it was resolved, and the invariant to keep.** The sample ids were restored to agreement with the pinned snippet. Re-pointing the pin at the newer id would have been equally correct — a concrete id inside a sample payload is exactly the case the lint's own failure message calls acceptable ("a selectable VALUE … sample payload"). Either direction satisfies the same rule: **the doc's id and the allowlist snippet must match character-for-character.** `node --test tests/model-version-drift.test.cjs` was green when this was written; run it rather than trusting that sentence.

**Why it stays here.** B2.5 documents this same failure mode for a different entry: a snippet-pinned exemption goes stale the instant the doc it pins is reworded, and it fails **closed** — noise, never a silent hole. That fail-closed design is the only reason a doc improvement did not quietly carry an unexempt version pin into a release.

---

## Closed record — the fix pass (targeting the next patch)

Every entry below was verified against the working tree, not against the pass's account of itself. Where a fix is load-bearing, the assertion that fails on revert is named — some tests carry an explicit `REVERT CHECK` comment for this purpose (`grep -rn 'REVERT CHECK' tests/`).

### Bucket A — Product defect: ledger row had no per-invocation discriminator (both closed)

**A1 (Medium) + A2 (Low) — closed together, as the item required.** Both loggers now hash the event signature **once** per invocation and persist it as `event_sig` — `pan-cost-logger.js` in the ledger row, `pan-trace-logger.js` in the completion's `context`. Both dedup guards compare it, so two parallel same-type siblings no longer collapse, while a re-fire carries the same signature and is still suppressed. `SCHEMA_V` is 3 in both hooks. **The residual in the layer beneath is L3.**

- **Schema decision discharged.** The item required grepping every reader before landing. Verified against code rather than asserted: `grep -rn 'SCHEMA_V' pan-wizard-core/` returns nothing, so no constant there mirrors the hooks' version; and the readers reached by `grep -rn "require('./cost.cjs')" pan-wizard-core/bin/lib` (plus `cost.cjs` itself, which owns `readRecords`/`aggregate`) take a row **field by field** — none of them branches on a row's `v`, which `grep -rnE '\.v\b|\bv\b\s*(===|!==|[<>]=?)\s*[0-9]'` over those files confirms. An added field is therefore purely additive for all of them. The old hook comment claiming the constant was "kept in sync with cost.cjs" was itself wrong and has been corrected.
- **Backward compatibility asserted, not assumed.** A test writes genuine pre-fix `v: 2` rows with no `event_sig` and asserts `aggregate()` still counts and still prices them.
- **A2's residual documented rather than papered over**, which is what the item asked for: the `eventSignature` comment in both hooks now states that on a runtime whose `SubagentStop` payload carries no per-invocation field at all, a new spawn and a re-fire are the same bytes and remain indistinguishable — and that the bias toward an undercount over a phantom row is deliberate.
- **Coverage:** a behavior matrix in `tests/cost-logger-hook.test.cjs` and `tests/trace-logger.test.cjs` covering a true re-fire, a re-fire with no `transcript_path`, interleaved dual registration, two same-type siblings, a wider same-type wave, a first fire with an unreadable transcript, and the M61 phantom still suppressed *by the marker layer* (pinned separately so the fix cannot silently shift that case onto the dedup). The no-`transcript_path` case guards the opposite failure — that the discriminator stay payload-derived, never a nonce or counter. *(The `describe` titles in both files name a case total that does not match the cases they contain; see [reported, not fixed by the pass that found it](#reported-not-fixed-by-the-pass-that-found-it).)*

### Bucket B1 — Docs contradicting docs

- **B1.1 (Medium) — closed as scoped, plus the sources the item never named.** The generated copies it left stale were regenerated (**L1**, closed) and then re-staled by a later `army.md` edit (**L6**, open). Two surfaces the item's greps could never have reached were also found and fixed later in the chain, both outside Markdown: `hud.cjs`'s rendered Mission Control strap and the shipped `learnings/universal/autonomous-loop.md` — see the blind-spot list under L1.
- **B1.2 (Medium) — closed.** A "**Squad tier is not profile tier**" paragraph now sits under the squad table in `docs/AGENTS.md` and replaces the hedging note in `commands/pan/army.md`, stating plainly that the tier column is a `squads.cjs` grouping attribute, that `quality` and `balanced` resolve `reasoning` for every agent, and that the `mid` on the Quality and Release rows therefore does not describe what those agents run. Verified against code rather than against the paragraph: `pan-tools squad list --raw` prints the squads `squads.cjs` defines with the tiers the doc shows, and `MODEL_PROFILES` in `core.cjs` has `quality` identical to `balanced` and equal to `reasoning` for every registered agent. Tier **values** were correctly left alone, as the item insisted. `army.md` also replaced its list of model-pinned agents with `grep -l '^model: opus' agents/*.md`, which is the same doctrine this document follows.
- **B1.3 (Medium) — closed, and the count was dropped rather than corrected.** `docs/ARCHITECTURE.md` now reads "A small number of places do read a model name for non-gating reasons", naming the installer advisory, `cost.cjs`'s `resolveRate()`, and `hooks/pan-cost-logger.js`'s `tierForModel()`, then characterises all of them as "reporting and display reads, not behavior". This honours the item's standing instruction to prefer non-enumerating phrasing in that file permanently.
- **B1.4 (Low) — closed, with the limit of the fix stated.** The over-broad "only … `unknown`" claim is gone from `docs/ARCHITECTURE.md`, which now says an unseen family, or a Claude name with no parsable release number, reads as `unknown` — a true statement that no longer claims to be exhaustive. It is not exhaustive, and that matters: probing `detectModelCapabilities` directly shows the all-false `tier: 'unknown'` result is also reached by ids that *do* parse a family and a release but sit at or below that family's reduced-capability threshold while matching no explicit branch (`claude-opus-0` through `claude-opus-3`, `claude-sonnet-2/3`, `claude-haiku-2/3`), as well as by a bare family name, an unknown vendor, junk, and the empty string. Probe it yourself before writing any sentence about when it occurs. The header of `tests/model-version-drift.test.cjs` records this counterexample class outright and instructs future readers to **never phrase that result as exhaustive**.

### Bucket B2 — Anti-drift lint hardening (all closed; every change is in `tests/model-version-drift.test.cjs`)

- **B2.1 — closed by removing the row.** The `pan-zcode` floor is gone from `MIN_SCANNED`, with a comment explaining that a floor there could never prove recursion (flat and recursive counts are equal) and that the explicit `targets.includes(...)` assertions are the stronger check. The file's "today's count minus churn headroom" claim now holds for the rows that remain.
- **B2.2 — closed.** `subagent` → `sub-?agent` (the hyphenated spelling PAN's own docs use was the sharp case), plus a second block of nouns PAN routinely counts. A comment documents that entries are regex fragments taking an auto-appended plural, so an irregular plural needs its own entry. The corpus comment overstated what was verified; that was **L4**, now closed.
- **B2.3 — closed.** The concrete-ID regex widened to accept `_` as well as `-` on both separators, removing the asymmetry with the family-name branches that already accepted `[\s\-_]`. The must-catch corpus gained the underscore forms plus `anthropic/claude-…` and `us.anthropic.…-v1:0` gateway/Bedrock spellings.
- **B2.4 — closed.** `SKIP_DIR_NAMES` is now derived from a `SKIP_DIRS` table where each entry carries a `why`, and `NEVER_SCANNED_SUBTREE` became an object with a `why` instead of a bare string with a comment. Both are now covered by the rationale test. The `dist` entry records the risk the item raised in full: it hides generated `.md` copies under `dist/pan-wizard-plugin/`, harmless while `dist/` is gitignored and absent from `package.json` `files`, with the explicit instruction to scan the built copies instead of skipping them if plugin output is ever published. *(A stale `dist/` tree in a working copy does carry old model claims — it is build output, so rebuild rather than edit.)*
- **B2.5 — closed.** The `model-profiles` allowlist lookbehind now carries a "CONSTRAINT ON THE DOC, not just on this regex" comment: the Class cell must stay backtick-free, the failure mode is fail-closed noise rather than a silent hole, and widening that cell to `[^|]*` is named as the hole it would open. It directs a future editor to re-anchor on the Class column rather than relax the exclusion.

### Bucket B3 — Test coverage gap (closed)

- **B3.1 — closed.** A new `E-9 model-capability advisory (installer stdout)` suite in `tests/e2e-install.test.cjs` asserts on the installer's real stdout: the notice **prints** for `claude-3-haiku-20240307`, **stays silent** under `--skip-warnings`, and **does not fire** for a capability-rich `claude-opus-5` (the false-positive direction). Each case also asserts the installer preserved the `model` field, so the notice can never pass by being silenced for the wrong reason, and a further case asserts a `--local` install writes nothing into a redirected `HOME`/`USERPROFILE`. The suite names `assert.ok(out.includes(NOTICE_LEAD), …)` as the assertion that fails if the M5 shape (a throw swallowed by the block's bare `catch {}`) returns, and states why absence-only coverage never caught M5. It deliberately does **not** pin the recommended model ids — that would re-create the drift B4.1's constant exists to prevent — and instead matches a shape to assert the advice still names *some* concrete model.

### Bucket B4 — Version-pinned strings

- **B4.1 — closed.** The stale `E-9: Opus 4.7 capability detection` comment now reads `E-9 Model-capability integration`, matching the name the docs use. The printed recommendation leads with the **capability** ("a 1M-token context window and extended thinking") and draws its example ids from a `RECOMMENDED_MODELS` constant at the top of `bin/install.js`, so the next lineup move is one edit. The constant's comment records that this string has already had to be re-pointed as the lineup moved and that nothing in PAN gates on its values. A test guards that the advice still names a concrete model — tier-only wording would stop telling the user what to do.
- **B4.2 — closed as informational, and it survived a scare.** `CONTRIBUTORS.md`'s historical attribution and `docs/HOOKS.md`'s sample-payload `model` field remain as deliberate, reasoned lint allowlist entries; both re-verified present and still allowlisted at the end of this pass. Note that the HOOKS.md one was briefly re-pointed to a newer id mid-pass, which broke its allowlist entry and the whole suite (**L5**) before being restored. Recorded so a future reader does not mistake either file for drift — and does not edit the sample id without re-pointing the pin.

### Bucket B5 — Repo hygiene (closed)

- **B5.1 — closed in the snippet and in the test.** CLAUDE.md's refresh snippet and `tests/claude-md-counts.test.cjs` both now count the hook **sources**, matching the row label, so a fresh clone no longer throws `ENOENT` / returns `-1` and trips the test's own "filesystem path not found" assertion. The test comment records that the old `hooks/dist` reading agreed on the number only because CI runs `build:hooks` before `npm test`, and that the `.js` filter skips the `dist` subdirectory. Verified: the number is identical either way, and the guard test passes.

### Out-of-ledger fixes made in the same pass

Not tracked as items here. **This list does not account for the whole diff, and an earlier revision of this section claimed it did.** It was wrong when written — files changed in the pass appeared nowhere in this document at all — and it would go wrong again anyway, because concurrent passes keep changing the tree. So the list below is a set of notes on *particular* fixes, and the authority on what changed is the command, not the list:

```bash
git status --porcelain && git diff --name-only
# then, for anything you don't recognise from this record:
git diff <path>
```

The claim this section *can* honestly make is about the classes, not the files: everything in the diff that is not accounted for by a ledger entry or a bucket above falls into the **bare-family model claim** sweep, the **enforced-vs-instructed delegation** sweep, or the **profile-parity** sweep (`quality` and `balanced` resolving identically). If you find a changed file matching none of those three, that is a finding — record it rather than assuming it belongs to one.

- `docs/CLI-REFERENCE.md` — `progress health`'s `context` block now states the same fixed-budget denominator caveat as `context-budget`, and `context-budget` no longer claims to be "the only place PAN commits to a window size" (it is not — `progress health` divides by the same constant). Its `squads.cjs` module row was later brought into line with `docs/ARCHITECTURE.md`, which had been changed to call the `access` contract **advisory** while this twin sentence still said "least-privilege access contract".
- `pan-wizard-core/workflows/settings.md` and `new-project.md` — the `Quality` profile option no longer advertises "highest cost"; both now say it is identical to balanced, so switching between them changes nothing. Consistent with `pan-tools estimate-cost`, which reports quality and balanced at the same multiplier.
- `CLAUDE.md` — the counts table's test/suite totals were refreshed for the tests this pass added.
- **Files swept for the delegation/model claims that this document never listed** — `docs/USER-GUIDE.md`, `docs/FAQ.md`, `docs/TROUBLESHOOTING.md`, `docs/DEVELOPMENT.md`, `pan-wizard-core/references/model-profiles.md`, and both copies of `docs/branding/README-brand-draft.md` (see L2). Named here because their absence was the concrete falsification of the "fully accounted for" claim; `git diff --name-only` remains the authority, not this list.
- **Code and shipped-content surfaces swept later in the chain** — `pan-wizard-core/bin/lib/hud.cjs` (the rendered Mission Control strap, plus a tooltip saying the squad `tier`/`access` badges are advisory), `pan-wizard-core/bin/lib/squads.cjs` (comments only — no `access` value and no behaviour changed; the header now states outright that both labels are advisory metadata, which is what several live docs already quote it as saying), `pan-wizard-core/learnings/universal/autonomous-loop.md` (the shipped "delegation-only coordinator (never codes)" rule), `docs/AGENTS.md` (`pan-release`'s "Never codes; never merges" absolute, softened to instructed-not-enforced beside its own `Bash` grant), and `commands/pan/army.md` (tier-table cells that had drifted from `squads.cjs`).

---

## What is explicitly *not* outstanding

So a future audit doesn't re-litigate settled ground:

- **All 137 original findings** are resolved and independently verified. No Critical was ever found anywhere in the chain, and no High is open.
- **N21, N23, N28** were record errors, not product defects — corrected inside the audit documents. N28's false "statusline-guard coverage" claim also sits in an immutable commit message, which is why Round 3 flagged rather than closed it.
- **The durable guards** this chain added or hardened now make whole classes unable to regress silently: `tests/shipped-content-prefix.test.cjs` (runtime path-prefix), `tests/statusline-guard.test.cjs` (a branch that regressed more than once), `tests/model-version-drift.test.cjs` (model-version pins — note its blind spots, recorded under L1: bare family names, generated-file staleness, code, and the learnings subtree), and the E-9 advisory suite in `tests/e2e-install.test.cjs` (a print path that was unreachable for a release).
- **The `.gitignore` secrets path** (`!experiments/**` undoing every blanket rule above it) is fixed and verified in both directions. Method note for future checks: `git check-ignore -v` prints the matching pattern **even when that pattern is a negation**, so a not-ignored path looks identical to an ignored one — test by exit code (`-q`).
- **Byte-identical same-type sibling payloads** are an irreducible ambiguity, not a bug: re-fire suppression and sibling admission are mutually contradictory on identical input, so any guard here picks a failure direction rather than removing one. The marker layer picks undercount deliberately, and both hooks say so in prose. The *other* direction is bounded but not eliminated: a re-fire that has aged out of the marker window and is not the immediately preceding row is recorded. **That is now an accepted, documented residual, not an open defect** — the guard that briefly closed it was reverted for destroying real ledger rows. Read L3 before proposing anything here; "widen the dedup" has been tried and withdrawn with evidence.

---

## Reported, not fixed by the pass that found it

Found while verifying this record. **The earlier framing of this section — "outside the file this pass was allowed to edit" — was wrong**, and wrong in the direction that matters: it read as *nobody* could touch these, when in fact every file the three bullets named was already in that pass's own `git diff --name-only`: `tests/cost-logger-hook.test.cjs`, `tests/trace-logger.test.cjs`, `tests/model-version-drift.test.cjs`, and the generated skills docs. Two of the three bullets are still listed below as unfixed despite that; the third was in fact fixed by the same pass, which is the clearest sign the framing was about scheduling rather than about reachability. A per-agent file assignment is not a property of the repo, and writing it into the record as one converted a scheduling detail into a permanent-looking exemption. State whose scope, and check the diff before claiming a file was untouchable.

- **Still open.** The discriminator suites in `tests/cost-logger-hook.test.cjs` and `tests/trace-logger.test.cjs` carry `describe` titles naming a case total ("six-case behavior matrix") that does not match the cases inside them — verified by counting the `test(` calls in each block, which is also why the corrected total is not written here. Same defect class as everything in the process lesson below: **drop the total from the titles rather than correct it.** Both files were in the reporting pass's own diff, so the honest note is that it was not assigned them, not that they were unreachable.
- **Closed.** `docs/SKILLS-FULL-TEXT.md` / `docs/SKILLS-REFERENCE.md` were regenerated (**L1**) — and re-staled by a later `army.md` edit (**L6**, open). They are generated: run the generator, never hand-edit.
- **Closed.** `tests/model-version-drift.test.cjs`'s false-positive corpus comment no longer claims more than was verified (**L4**).

---

## Process lesson worth keeping

Every round of this chain found that the **previous** fix pass had introduced something new — including commit messages that claimed tests which were not in the diff, more than once, and, in the last round, a guard that passed its suites while destroying real ledger data. The rules, in the order the chain earned them:

1. **Verify fix claims against the working tree and `git diff`, never against a commit message, a sibling doc, or the record you are updating.** Re-derive the VCS state too: this document's own header once claimed the fixes were committed while `HEAD` was still the release tag and the index was empty. And re-verify at the *end*, not only at the start — when passes run concurrently the tree moves underneath the record, which is how L3 and L5 both went from open to closed inside one writing session. A finding stated as "X is broken" ages badly; a finding stated as "X was broken, here is the command that says whether it still is" does not.
2. **Do not parallelise prose edits about one mechanism across agents.** Every doc-vs-doc contradiction in Rounds 2–5 came from two agents writing about the same gate from different files. Bucket B1 existed because of exactly this. Its corollary, learned in the final round: when sources are edited, **generated copies are a second surface** that no source edit updates and that the staleness guard may not cover.
3. **An item's enumerated locations are a starting point, not the boundary of the defect.** B1.1 named its instances and every one was fixed correctly — while the same false claim sat on further surfaces, including the README, because nobody re-grepped for the *class* after fixing the *instances*. When closing a "docs contradict docs" item, grep the repo for the claim before marking it done, and check whether the guard that should have caught it structurally can.
4. **A snippet-pinned exemption is a claim about another file, and it rots when that file is improved.** L5 is the shape: a doc was made *better* (illustrative payloads replaced with real dumped ones) and the lint entry pinned to its old text went stale in the same edit. When you reword a line that an allowlist pins, re-point the pin in the same change — and be glad the exemption fails closed, because that is the only reason anyone found out.
5. **Enumerable claims in the record were themselves this chain's most reliable generator of new findings.** "Two places read a model name", "three surfaces", "every reader", "all eleven strings", "the one place" — each was written in good faith, each drifted or was already wrong, each produced a finding in a later round. Counting is a maintenance debt that nothing enforces, and prose about code is where it goes unpaid. So this document states the **class and the command that enumerates it** instead of a total, and if you catch yourself typing a number about code structure, replace it with the grep that finds the members. That is CLAUDE.md's counts doctrine — *delete the number rather than chase the drift* — applied past the counts table to prose.
6. **A clever guard whose failure mode is silent data loss is worse than a simple guard with a documented residual.** This is the lesson L3 cost the most to learn. The widened dedup was a genuine improvement on the metric it was aimed at — it closed the phantom, and both hook suites went green — while quietly deleting real ledger rows for five ordinary spawns on a shared transcript. Green tests certified it because the tests encoded the phantom, not the loss. Three rules fall out of it:
   - **Compare failure modes before comparing failure rates.** A visible over-count can be reconciled against the transcript; a deleted row cannot be recovered or even noticed. Rarer is not safer when the rare outcome is silent and irreversible. Ask what a *wrong* answer costs in each direction before choosing which one to make rarer.
   - **A guard justified by an invariant is only as good as the invariant, so try to break it.** Prong 2 rested on "an event that consumed a real transcript slice never looks contentless" — plausible, load-bearing, and false, with counterexamples. Any absolute stated in a comment to justify a branch is a claim to attack, not a premise to build on. The absolutes this chain kept deleting from *prose* are the same species as the ones it should have been attacking in *code*.
   - **Verify a behaviour change by diffing behaviour against the old code, not by adding a passing test.** The regression was proved by running the same payloads through `git show HEAD:hooks/*.js` and diffing the resulting ledgers. A new test written by the same reasoning that produced the change inherits the blind spot; the previous implementation is an oracle that does not.

   Then **write the residual down instead of engineering it away.** L3 now states its phantom in plain terms, in the hooks and in `docs/HOOKS.md`, and names the direction of the bias as deliberate. A documented residual is a decision a future reader can re-open with full information; a clever guard is one they will trust.

