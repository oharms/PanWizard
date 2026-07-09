---
topic: audit-convergence
last_updated: 2026-07-09T14:21:24.883Z
patterns:
  - id: P-AUD-001
    summary: Stop an iterated audit on a convergence signal — top-severity count reaches zero AND confirmed findings collapse by an order of magnitude — not on "no findings at all"; escalate the model and taper the fan-out as the tree hardens
    promoted_at: 2026-07-09T14:21:24.883Z
    source_experiments: [lending-audit-rounds-3-4]
  - id: P-AUD-002
    summary: Rotate the audit LENS and its category taxonomy each round (honesty → correctness/completeness → cross-cutting depth), explicitly excluding scope already fixed in prior rounds — re-running the same lens finds the same things
    promoted_at: 2026-07-09T14:21:24.883Z
    source_experiments: [lending-audit-rounds-3-4]
---

# Audit Convergence (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-AUD-001 — Stop an iterated audit on a convergence signal — top-severity count reaches zero AND confirmed findings collapse by an order of magnitude — not on "no findings at all"; escalate the model and taper the fan-out as the tree hardens

**Evidence:** A four-round production audit stopped when round 3's 108 confirmed (9 HIGH) dropped to round 4's 16 confirmed (0 HIGH — a ~7x collapse), declaring "no new HIGH-severity defect survived a 4th pass on a hardened tree; the codebase is converging; this is likely the last productive audit round." Convergence was partly forced: the model was escalated to the strongest tier and the agent count tapered from 152 to 39 as findings thinned — the convergence claim is only meaningful against the strongest reviewer.

**Rule:** Define the stopping rule before the audit loop starts: stop when (a) zero findings at the top severity survive verification AND (b) the confirmed count collapses relative to the prior round (~5-10x). Never require literal zero findings — a long MED/LOW tail is normal residue. As rounds progress, escalate reviewer strength and shrink fan-out; a "converged" verdict from a weak reviewer at full fan-out proves nothing.

**Applies in:** Audit campaigns, review loops, focus-loop stop conditions, quality-gate design.

## P-AUD-002 — Rotate the audit LENS and its category taxonomy each round (honesty → correctness/completeness → cross-cutting depth), explicitly excluding scope already fixed in prior rounds — re-running the same lens finds the same things

**Evidence:** Round 1/2 audited fabrication (LIVE_FAKE_DATA, ALWAYS_GREEN, STUB_IN_PROD); round 3 switched to "a correctness/completeness/quality lens, distinct from the rounds-1/2 mock-fake honesty audit" (INCORRECT, RACE_OR_LEAK, DUPLICATION_DRIFT, MISSING_VALIDATION); round 4 went to cross-cutting depth ("atomicity, concurrency, authz depth, regulatory-math edges") plus a dedicated fix-regression pass. Each round explicitly excluded the previous rounds' fixed findings ("the 59 already-fixed mock/fake findings were explicitly excluded"), so every pass hit a genuinely different defect class.

**Rule:** Plan a repeated audit as a lens sequence, each with its own defect taxonomy: (1) honesty/fabrication, (2) correctness/completeness/error-handling, (3) cross-cutting depth (atomicity, concurrency, authorization, domain-math edges) + fix regressions. Feed each round the prior rounds' fixed-findings register as an explicit exclusion so auditors don't rediscover settled ground.

**Applies in:** Multi-round audit design, review campaign planning, quality-sweep scheduling.
