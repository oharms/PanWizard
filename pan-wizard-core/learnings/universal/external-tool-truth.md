---
topic: external-tool-truth
last_updated: 2026-07-09T14:04:40.517Z
patterns:
  - id: P-XTT-001
    summary: Judge external CLI success by the artifact it was supposed to produce, not by its exit code — tools return non-zero for cosmetic reasons while the real work succeeded
    promoted_at: 2026-07-09T14:04:40.517Z
    source_experiments: [compliance-army-v1.1]
---

# External Tool Truth (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-XTT-001 — Judge external CLI success by the artifact it was supposed to produce, not by its exit code — tools return non-zero for cosmetic reasons while the real work succeeded

**Evidence:** A cloud container build (az acr build) exited non-zero because the console (cp1252 codepage) crashed printing a Unicode check-mark glyph from the build output — while the image build itself had succeeded in the cloud. Automation keyed on the exit code declared the deploy broken; the reliable signal was whether the image digest resolved in the registry.

**Rule:** For external tools whose job is to produce an artifact (image, package, file, release), verify the artifact exists and resolves — digest lookup, file hash, registry query — instead of trusting the process exit code alone. Exit codes conflate the tool's own console/plumbing failures with the outcome of the work.

**Applies in:** Deploy steps, build pipelines, cloud CLIs, Windows consoles with non-UTF8 codepages.
