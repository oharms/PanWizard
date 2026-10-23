# Seed: review-target

A one-phase shop library whose phase is **executed but not yet reviewed**. The seed itself is
the base commit: a price list (`src/prices.js`) with its test, and phase 1's plan. The phase's
work is not in the seed: `harness/scripts/apply-overlay.cjs` applies
`harness/overlays/review-target-phase1/` as two more commits, `feat(01-01): …` (the code and
its test) and `docs(01-01): …` (the summary), so `pan-tools review scope 1` finds a base and a
non-empty diff. A single-commit seed would give a reviewer a prompt with no `diff --git` in it.

The change carries two real defects that the phase's own tests do not catch:

- the bulk discount starts above ten items, where REQ-02 says ten or more;
- an unknown discount code makes the total `NaN`, where REQ-03 says it throws an Error that names the code.

Used by `review-churn-live` (V6: the reviewer's findings across five repeated reviews of the
same diff) and `review-cross-family-copilot` (R4: the cross-family lane on Copilot CLI).
