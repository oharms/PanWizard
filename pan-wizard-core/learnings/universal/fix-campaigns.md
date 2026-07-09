---
topic: fix-campaigns
last_updated: 2026-07-09T14:21:24.885Z
patterns:
  - id: P-FIX-001
    summary: Hand a large findings register to fixers as defect-CLASS clusters with an explicit fix order ranked by real risk — "fix the class once, apply everywhere" — not as N independent tickets
    promoted_at: 2026-07-09T14:21:24.884Z
    source_experiments: [lending-audit-rounds-3-4]
  - id: P-FIX-002
    summary: Treat the audit's own suggested fixes as UNTRUSTED input — the fix campaign's quality gate must adversarially review the guidance itself, reject flawed suggestions, and preserve the original text for the audit trail
    promoted_at: 2026-07-09T14:21:24.884Z
    source_experiments: [lending-audit-rounds-3-4]
  - id: P-FIX-003
    summary: After any fix campaign, run a dedicated FIX-REGRESSION lens: hunt fixes that are inert (read the wrong path), half-wired, or that broke a sibling — distinct from generic regression testing
    promoted_at: 2026-07-09T14:21:24.885Z
    source_experiments: [lending-audit-rounds-3-4]
---

# Fix Campaigns (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-FIX-001 — Hand a large findings register to fixers as defect-CLASS clusters with an explicit fix order ranked by real risk — "fix the class once, apply everywhere" — not as N independent tickets

**Evidence:** A 108-finding audit register was compressed into 8 shared-defect-class clusters for the fix campaign ("Many findings are the same defect class repeated — fix the class once, apply everywhere"), ordered by consequence with idempotency/duplicate-financial-writes first ("highest real-money risk"). Fixers repaired the pattern once per class instead of patching 108 sites independently, which also made per-class regression review tractable.

**Rule:** Before spawning fixers on a big findings register: cluster findings by shared defect class (same root pattern, not same file), rank clusters by real-world consequence, and hand each fixer one class with all its instances. The fix contract is "repair the class everywhere", and review happens per class — never fan out one-ticket-per-finding on a register with repeated patterns.

**Applies in:** Fix campaign planning, gap-closure batching, remediation handovers after audits.

## P-FIX-002 — Treat the audit's own suggested fixes as UNTRUSTED input — the fix campaign's quality gate must adversarially review the guidance itself, reject flawed suggestions, and preserve the original text for the audit trail

**Evidence:** A findings register's suggestedFix for an nginx routing defect "literally recommended the broken proxy_pass form; the campaign rejected that flawed guidance in favour of the rewrite-strip. The suggestedFix text is left as-authored for the audit trail." The same round's adversarial quality reviewer also caught a fix that itself dropped a required prefix-strip (BLOCK verdict) — both the auditor's advice and the fixer's change needed independent review.

**Rule:** Auditor-suggested fixes are hypotheses, not instructions: the fixer must validate the suggestion against the real system (does the API exist? does the config form parse?) and the quality gate must review the applied change independently of the suggestion. When guidance is rejected, keep the original suggestion text unmodified in the register — the divergence is part of the audit trail.

**Applies in:** Fix campaigns consuming audit registers, remediation quality gates, handover contracts.

## P-FIX-003 — After any fix campaign, run a dedicated FIX-REGRESSION lens: hunt fixes that are inert (read the wrong path), half-wired, or that broke a sibling — distinct from generic regression testing

**Evidence:** A round-4 audit carried a dedicated fix-regression category and found three: a round-3 "resume is amount-honest" fix that "reads the resumed amount from the wrong JSON path — the fix is inert, the blind-book MED is re-opened on Live"; a checker leg reading a field the writer never sets; and a deploy-script fix that broke plan idempotency. Ordinary test suites stayed green through all three — the fixes compiled, passed, and did nothing.

**Rule:** The audit round after a fix campaign must include an explicit fix-regression lens over the fixed sites: (1) INERT — does the fix actually execute on the live path, reading the real data shape? (2) HALF-WIRED — is every leg of the fix threaded through (writer AND reader)? (3) SIBLING BREAKAGE — did the fix change behavior a neighboring consumer depended on? Green tests do not clear a fix; re-verify the original finding's failing input now behaves.

**Applies in:** Post-fix verification rounds, gap-closure follow-ups, re-audit scheduling.
