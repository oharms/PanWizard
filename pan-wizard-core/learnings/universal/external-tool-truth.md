---
topic: external-tool-truth
last_updated: 2026-07-18T08:42:29.854Z
patterns:
  - id: P-XTT-001
    summary: Judge external CLI success by the artifact it was supposed to produce, not by its exit code — tools return non-zero for cosmetic reasons while the real work succeeded
    promoted_at: 2026-07-09T14:04:40.517Z
    source_experiments: [compliance-army-v1.1]
  - id: P-FH-006
    summary: Derive a verdict from the authoritative contract signal, not from re-parsing output content
    promoted_at: 2026-07-18T08:42:29.850Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-014
    summary: Take authoritative business time from the system of record, not the local clock
    promoted_at: 2026-07-18T08:42:29.854Z
    source_experiments: [field-harvest-2026-07]
---

# External Tool Truth (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-XTT-001 — Judge external CLI success by the artifact it was supposed to produce, not by its exit code — tools return non-zero for cosmetic reasons while the real work succeeded

**Evidence:** A cloud container build (az acr build) exited non-zero because the console (cp1252 codepage) crashed printing a Unicode check-mark glyph from the build output — while the image build itself had succeeded in the cloud. Automation keyed on the exit code declared the deploy broken; the reliable signal was whether the image digest resolved in the registry.

**Rule:** For external tools whose job is to produce an artifact (image, package, file, release), verify the artifact exists and resolves — digest lookup, file hash, registry query — instead of trusting the process exit code alone. Exit codes conflate the tool's own console/plumbing failures with the outcome of the work.

**Applies in:** Deploy steps, build pipelines, cloud CLIs, Windows consoles with non-UTF8 codepages.

## P-FH-006 — Derive a verdict from the authoritative contract signal, not from re-parsing output content

**Evidence:** A report generator reclassified probe results by matching output text rather than the probe's documented exit-code contract; after an unrelated change routed a passing probe's output through an empty path, its rendered status flipped to 'in progress' despite exit 0 and an unchanged underlying verdict — a presentation-layer defect, not a code regression.

**Rule:** When a producer already emits an authoritative pass/fail signal (an exit code or declared contract), derive downstream verdicts from that signal — do not re-judge the result by heuristically matching the human-readable output content. Content-based re-derivation double-judges and drifts: an unrelated change that reroutes output (e.g. success now produces empty output) flips the rendered verdict even though the authoritative signal is unchanged.

**Applies in:** consuming external tool/CLI output; deriving pass/fail verdicts; business time

## P-FH-014 — Take authoritative business time from the system of record, not the local clock

**Evidence:** Multiple UI and service write paths stamped timestamps and a business date from the local clock instead of the managed engine's date, capturing wall-clock values that diverged from the engine under reseed and time-advance.

**Rule:** Deriving business-critical temporal values (the current business date, 'today') from the local wall clock produces wrong results whenever the authoritative system runs on a different date — under time-travel testing, nightly reseeds, batch cutovers, or timezone skew. Fetch such values from the system of record once at an authenticated bootstrap and reuse them; keep a local-clock read only as an explicit, clearly-labelled pre-auth fallback.

**Applies in:** consuming external tool/CLI output; deriving pass/fail verdicts; business time
