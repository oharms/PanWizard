---
topic: empirical-spike
last_updated: 2026-07-18T08:42:29.847Z
patterns:
  - id: P-NPRS-001
    summary: Lock undocumented system flag/API behavior with a committed measurable spike before shipping production code that depends on it
    promoted_at: 2026-05-03T03:29:14.814Z
    source_experiments: [notepadrs]
  - id: P-FH-001
    summary: Diagnose performance gaps from generated code and measurement, not source reading
    promoted_at: 2026-07-18T08:42:29.847Z
    source_experiments: [field-harvest-2026-07]
---

# Empirical Spike (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-NPRS-001 — Lock undocumented system flag/API behavior with a committed measurable spike before shipping production code that depends on it

**Evidence:** notepadrs Plan 05-01: EM_SETTARGETDEVICE word-wrap polarity is undocumented in MSDN; spike measured EM_POSFROMCHAR Y-coordinate at lParam=0 (y=170, wrapped) vs lParam=1 (x=3993 off-screen). Spike committed at examples/wordwrap_spike.rs and result at 05-01-spike-result.md. Production constants WRAP_ON_LPARAM=0 and WRAP_OFF_LPARAM=1 doc-comment references the spike artifact.

**Rule:** When a system flag, API constant, or external library has undocumented or contradictory semantics, write a Wave-0 spike test that PROGRAMMATICALLY measures the actual behavior (not visual inspection), commit the spike as a permanent reproducer (e.g. examples/<feature>_spike.rs), commit the measurement record as a phase artifact, and have production constants doc-comment the spike artifact path. Cost: 1 small spike per flag. Payoff: future maintainers can re-validate after OS/library upgrades; the constants are no longer 'magic numbers' — they're empirically locked.

**Applies in:** system-level integrations with undocumented behavior (Win32 messages, mobile native flags, browser quirks, kernel flags, undocumented vendor APIs, version-specific framework behaviors)

## P-FH-001 — Diagnose performance gaps from generated code and measurement, not source reading

**Evidence:** A performance re-triage found that 3 of 3 prior class diagnoses reasoned purely from source reading were all falsified once the emitted low-level code was actually inspected and timed; subsequent design passes adopted a standing 'Root Cause — Measured, Not Assumed' rule, emitting IR/asm for the single hot seed and grepping for actual call/alloc instructions before proposing any fix.

**Rule:** When investigating a performance regression, do not conclude a root cause by reading source and reasoning about what 'should' be slow. Inspect the compiler's actual generated low-level output (intermediate representation / assembly) for the exact hot path and A/B-time the change, because source-level performance hypotheses are frequently falsified once the real emitted code is examined (e.g. an operation you 'know' calls out to a runtime helper turns out to already be inlined, or vice versa). Treat any source-only perf hypothesis as unverified until confirmed against the emitted artifact plus a measurement.

**Applies in:** performance investigations; undocumented API/flag behavior; compiler/codegen work
