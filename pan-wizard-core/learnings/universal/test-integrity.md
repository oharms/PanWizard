---
topic: test-integrity
last_updated: 2026-07-18T08:42:29.859Z
patterns:
  - id: P-TI-001
    summary: No dumbing down generated tests/evals: forbid hardcoded expected outputs, input==known shortcuts, and domain-shrinking to dodge bugs; if a real bug blocks the general case, file it — do not weaken the seed
    promoted_at: 2026-07-09T14:04:40.512Z
    source_experiments: [mph-factory]
  - id: P-FH-005
    summary: No vacuous PASS: a check that didn't actually run must report inconclusive, not success
    promoted_at: 2026-07-18T08:42:29.850Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-012
    summary: Guards and tests that skip when their target is missing rot into false assurance
    promoted_at: 2026-07-18T08:42:29.852Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-013
    summary: Stub fixtures returning empty defaults make tests vacuously pass
    promoted_at: 2026-07-18T08:42:29.853Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-030
    summary: When a coverage test surfaces a real bug, commit a skipped repro with intact assertions and report
    promoted_at: 2026-07-18T08:42:29.859Z
    source_experiments: [field-harvest-2026-07]
---

# Test Integrity (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-TI-001 — No dumbing down generated tests/evals: forbid hardcoded expected outputs, input==known shortcuts, and domain-shrinking to dodge bugs; if a real bug blocks the general case, file it — do not weaken the seed

**Evidence:** An autonomous test-factory for a compiler codified this after agents repeatedly weakened test seeds to get green runs: rules ban hardcoded outputs, if input==known {return known} shortcuts, algorithm-name/implementation mismatch, and shrinking the input domain to avoid a bug. Seeds must show proof-of-work (loops of meaningful depth, DP tables of real size, round-trips, or multi-case sweeps). When a genuine product bug blocked the general case, the required action was to file the bug and keep the seed intact.

**Rule:** When an agent authors tests or eval seeds: (1) no hardcoded expected outputs or special-cased known inputs; (2) no shrinking the input domain to route around a failure; (3) require proof-of-work in the seed (real loops, real data sizes, round-trips, or >=3-case sweeps); (4) if a real bug blocks the general case, file the bug and keep the strong seed — never weaken the test to pass.

**Applies in:** Test generation, eval-set authoring, autonomous build loops that write their own verification.

## P-FH-005 — No vacuous PASS: a check that didn't actually run must report inconclusive, not success

**Evidence:** A correctness sweep of monitoring oracles found several emitting 'pass' when their check had not run at all (e.g. a required stats sidecar absent, or too few samples). The fix reclassified these to 'inconclusive' with a reason string and added a post-mortem scan path, restoring the gate's signal-to-noise.

**Rule:** A gate, oracle, or monitor that cannot execute its check (missing input sidecar, insufficient samples, unwired dependency) must emit an explicit 'inconclusive' / 'skipped' verdict — never a default 'pass'. A silent default-pass on a non-executed check erodes the trustworthiness of the whole signal, because green then means either 'verified good' or 'never actually looked', indistinguishably. Add a post-mortem or explicit-skip path so absence of evidence is reported as such.

**Applies in:** gates, oracles, monitors; test doubles/fixtures; coverage & drift checks

## P-FH-012 — Guards and tests that skip when their target is missing rot into false assurance

**Evidence:** A schema-drift guard's target path was one directory level short; the harness silently skipped it, so the guard never ran while appearing to pass, until the precondition was asserted for existence.

**Rule:** A verification step (test, drift gate, contract check) that silently no-ops or skips when its target path/precondition is absent gives false confidence and can go inert unnoticed — e.g. a wrong relative path makes it never execute yet still report green. Replace the silent skip with an explicit existence assertion on the precondition so a missing target fails loudly instead of quietly disabling the check.

**Applies in:** gates, oracles, monitors; test doubles/fixtures; coverage & drift checks

## P-FH-013 — Stub fixtures returning empty defaults make tests vacuously pass

**Evidence:** A worklist stub served an empty lookup list, so a status resolution could never match; the test could not have genuinely passed as written until the stub returned the by-name values the path required.

**Rule:** A test double whose canned response is an empty collection or default value can make the branch under test unreachable — the assertion then passes without exercising anything, or the code silently no-ops. Stub fixtures must contain the specific data the assertion depends on, and the test should verify the double actually drove the branch being tested, not merely that the call returned.

**Applies in:** gates, oracles, monitors; test doubles/fixtures; coverage & drift checks

## P-FH-030 — When a coverage test surfaces a real bug, commit a skipped repro with intact assertions and report

**Evidence:** A new integration test exposed a latent multi-tenant identity-collision bug; the multi-tenant case was committed as a skip with assertions unchanged, root cause and one-line fix documented, and escalated for a decision, while the passing sub-case shipped as genuine new coverage.

**Rule:** If a newly written test reveals a genuine production bug rather than a test defect, do not weaken the assertion to make it green and do not autonomously patch production code outside the batch's mandate. Commit the failing case as an explicitly-skipped reproduction with its real assertions intact, document the root cause and proposed fix, and hand the fix decision back. This keeps the suite green while preserving an honest, un-weakened record of the defect.

**Applies in:** gates, oracles, monitors; test doubles/fixtures; coverage & drift checks
