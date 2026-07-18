---
topic: empirical-spike
last_updated: 2026-05-03T03:29:14.814Z
patterns:
  - id: P-NPRS-001
    summary: Lock undocumented system flag/API behavior with a committed measurable spike before shipping production code that depends on it
    promoted_at: 2026-05-03T03:29:14.814Z
    source_experiments: [notepadrs]
---

# Empirical Spike (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-NPRS-001 — Lock undocumented system flag/API behavior with a committed measurable spike before shipping production code that depends on it

**Evidence:** notepadrs Plan 05-01: EM_SETTARGETDEVICE word-wrap polarity is undocumented in MSDN; spike measured EM_POSFROMCHAR Y-coordinate at lParam=0 (y=170, wrapped) vs lParam=1 (x=3993 off-screen). Spike committed at examples/wordwrap_spike.rs and result at 05-01-spike-result.md. Production constants WRAP_ON_LPARAM=0 and WRAP_OFF_LPARAM=1 doc-comment references the spike artifact.

**Rule:** When a system flag, API constant, or external library has undocumented or contradictory semantics, write a Wave-0 spike test that PROGRAMMATICALLY measures the actual behavior (not visual inspection), commit the spike as a permanent reproducer (e.g. examples/<feature>_spike.rs), commit the measurement record as a phase artifact, and have production constants doc-comment the spike artifact path. Cost: 1 small spike per flag. Payoff: future maintainers can re-validate after OS/library upgrades; the constants are no longer 'magic numbers' — they're empirically locked.

**Applies in:** system-level integrations with undocumented behavior (Win32 messages, mobile native flags, browser quirks, kernel flags, undocumented vendor APIs, version-specific framework behaviors)
