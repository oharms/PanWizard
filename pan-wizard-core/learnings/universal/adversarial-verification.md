---
topic: adversarial-verification
last_updated: 2026-07-18T08:42:29.851Z
patterns:
  - id: P-ADV-001
    summary: Two-stage audit: fan out cheap read-only finders, then one independent verifier per finding whose default stance is refute — expect a third to a half of raw findings to die, and action only survivors
    promoted_at: 2026-07-09T14:04:40.513Z
    source_experiments: [lending-fake-code-audit]
  - id: P-ADV-002
    summary: Anti-double-jeopardy: a verifier's first duty in a repeated audit is git-provenance against the prior findings register — refute anything byte-identical to already-adjudicated code, and confirm only with an explicit "not a re-report" clause naming the prior lines checked
    promoted_at: 2026-07-09T14:21:24.881Z
    source_experiments: [lending-audit-rounds-3-4]
  - id: P-ADV-003
    summary: Confirmation requires a REACHABLE trigger on the deployed surface, and severity is calibrated against named prior-round precedents — the recurring false-positive shapes are: unreachable fallback, value nothing consumes, happy-path-only proof, inverted causal mechanism, and code mirroring an authoritative sibling's intended semantics
    promoted_at: 2026-07-09T14:21:24.882Z
    source_experiments: [lending-audit-rounds-3-4]
  - id: P-FH-007
    summary: Reproduce the bug with a failing test before building the fix; non-reproduction means stop
    promoted_at: 2026-07-18T08:42:29.851Z
    source_experiments: [field-harvest-2026-07]
---

# Adversarial Verification (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-ADV-001 — Two-stage audit: fan out cheap read-only finders, then one independent verifier per finding whose default stance is refute — expect a third to a half of raw findings to die, and action only survivors

**Evidence:** A production fake-code audit ran 12 read-only slice auditors and then one adversarial verifier per finding (default stance: refute). Round 1: 80 raw findings -> 36 confirmed / 44 refuted. Round 2: 34 raw -> 23 confirmed / 11 refuted. Acting on raw finder output would have wasted roughly half the remediation effort on plausible-but-wrong findings.

**Rule:** Never action raw finder output. Structure audits as: (1) parallel read-only finders raise candidate findings cheaply; (2) an independent verifier per finding, prompted to REFUTE it, with fresh context; (3) only findings that survive refutation are confirmed and actioned. Budget for a 30-55% refutation rate — if nothing is being refuted, the verifiers are rubber-stamping.

**Applies in:** Code audits, security sweeps, review pipelines, multi-agent verification stages.

## P-ADV-002 — Anti-double-jeopardy: a verifier's first duty in a repeated audit is git-provenance against the prior findings register — refute anything byte-identical to already-adjudicated code, and confirm only with an explicit "not a re-report" clause naming the prior lines checked

**Evidence:** In a four-round production audit, every confirmed finding's verdict carried a provenance clause ("NOT a round-1 re-report — the register's only adjacent item was CONFIRMED LOW; the hunk was untouched by the remediation commits c1d1d569/acf0e03c") and refutations were proven with git ("byte-identical to the round-1 baseline; git diff shows no hunk touches these lines"). Without this, later rounds re-litigate settled findings and burn fix cycles on double-jeopardy.

**Rule:** In any repeated audit, give the verifier the prior findings register and the prior audit baseline commit. Confirmation requires an explicit statement that the finding is new or on changed code (cite the register entries checked and the commits since baseline). Refute re-reports of unchanged, already-adjudicated code — including re-litigations of already-fixed findings at a lower bar.

**Applies in:** Repeated audit rounds, review campaigns, any finder/verifier loop that runs more than once on the same tree.

## P-ADV-003 — Confirmation requires a REACHABLE trigger on the deployed surface, and severity is calibrated against named prior-round precedents — the recurring false-positive shapes are: unreachable fallback, value nothing consumes, happy-path-only proof, inverted causal mechanism, and code mirroring an authoritative sibling's intended semantics

**Evidence:** The refutation taxonomy from a 340-line verified findings register: a parser fallback that "exists exactly as cited but is unreachable on every rendered path"; a fabricated field where "no one is shown this field — the only consumer parses another key and silently drops it"; an ALWAYS_GREEN claim whose "mechanism is inverted"; and code that "byte-for-byte mirrors the owning monitor, whose designed semantics" it inherits. Confirmed findings calibrated severity to precedent: "MED matches the round-1 precedent (arrears failed-read-as-benign-data was MED)".

**Rule:** A finding is confirmed only with a concrete failing input/state that is reachable on the deployed surface. Check the five false-positive shapes before confirming: (1) is the flagged code reachable? (2) does anything consume the value? (3) is the proof happy-path-only? (4) is the causal mechanism actually as described? (5) does the code intentionally mirror an authoritative sibling? Assign severity by citing a comparable prior finding, not freehand.

**Applies in:** Verifier prompts, audit verdict schemas, severity rubrics for multi-round reviews.

## P-FH-007 — Reproduce the bug with a failing test before building the fix; non-reproduction means stop

**Evidence:** A planned ABI/concurrency fix was authored to eliminate a corruption bug; the first task wrote an aggressive reproduction test, but it passed across hundreds of thousands of iterations because earlier stacked fixes already covered the shape. The premise was formally rejected and the multi-task fix abandoned, with the repro retained as documentation.

**Rule:** Before implementing a fix for a reported bug, first write a test that actually reproduces it on the current tree and confirm it fails. If the bug will not reproduce — because prior stacked fixes already cover that exact shape — the premise is resolved: mark the planned fix superseded and abandon it rather than building speculative machinery for a bug that no longer exists. Keep the (now-passing) repro test as documentation.

**Applies in:** bug-fix workflows; regression triage
