---
topic: golden-sets
last_updated: 2026-07-09T14:04:40.518Z
patterns:
  - id: P-GLD-001
    summary: "Verified" requires human-verified golden sets plus live execution checks — public benchmarks are defective at scale, and an LLM judge is only usable after calibration against human labels
    promoted_at: 2026-07-09T14:04:40.518Z
    source_experiments: [spec-factory]
  - id: P-GLD-002
    summary: Execution-gate corpus curation: admit only samples that compile AND run clean on the shipped toolchain, record every exclusion with a reason code, and regenerate by script — never hand-edit the corpus
    promoted_at: 2026-07-09T14:04:40.518Z
    source_experiments: [montyhall-learning-corpus]
---

# Golden Sets (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-GLD-001 — "Verified" requires human-verified golden sets plus live execution checks — public benchmarks are defective at scale, and an LLM judge is only usable after calibration against human labels

**Evidence:** A spec-factory evaluation standard was built on the finding that naive automated eval misjudges correct work (68.3% of original SWE-bench samples were defective). Its gates: a multi-reviewer golden set anchored to facts confirmed against ground truth; read-only execution checks against the live system; LLM-as-judge admitted only after calibration against those human labels; retrieval recall@N (leave-one-out) tracked as a health metric, not a per-case blocker.

**Rule:** Build eval golden sets from human-verified, ground-truth-confirmed cases — never trust public benchmark labels or a raw LLM judge. Add live execution checks where feasible (does it build, run, resolve). Calibrate any LLM judge against the human labels before it gates anything. Track statistical health metrics (recall@N) as trends, not per-case pass/fail.

**Applies in:** Eval pipelines, golden-set curation, LLM-as-judge deployments, agent-quality gates.

## P-GLD-002 — Execution-gate corpus curation: admit only samples that compile AND run clean on the shipped toolchain, record every exclusion with a reason code, and regenerate by script — never hand-edit the corpus

**Evidence:** A 6,332-program language-training corpus was built with a hard gate (compiles + runs exit-0 on the shipped compiler) and a full audit trail: 4,204 rejected candidates recorded with reason codes (compile_fail, run_nonzero, duplicate_of, env_dependent, ffi_dependent, secret). The corpus regenerates from a script; hand-editing is banned so the manifest, dataset, and exclusion log can never diverge.

**Rule:** When curating a training/eval corpus: (1) gate admission on real execution against the shipped toolchain, not on inspection; (2) log every exclusion with a machine-readable reason code — the reject histogram is itself a quality signal; (3) make regeneration scripted and idempotent; never hand-edit corpus files, so manifest and content cannot diverge.

**Applies in:** Training-data curation, golden corpora, conformance suites, fixture harvesting.
