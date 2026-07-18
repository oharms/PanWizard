---
topic: harness-isolation
last_updated: 2026-07-18T08:42:29.860Z
patterns:
  - id: P-ISO-001
    summary: Autonomous observers/fuzzers/eval harnesses must run against a SHA-locked frozen copy of the product with a path guard, and stay strictly read-only against the live workspace
    promoted_at: 2026-07-09T14:04:40.519Z
    source_experiments: [mph-factory, mph-factory-limits]
  - id: P-FH-004
    summary: Repeated in-process invocation leaks residual state a fresh subprocess doesn't
    promoted_at: 2026-07-18T08:42:29.850Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-033
    summary: Shared collection test harness: throwaway DB for destructive ops; assert only on keys you created
    promoted_at: 2026-07-18T08:42:29.860Z
    source_experiments: [field-harvest-2026-07]
---

# Harness Isolation (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-ISO-001 — Autonomous observers/fuzzers/eval harnesses must run against a SHA-locked frozen copy of the product with a path guard, and stay strictly read-only against the live workspace

**Evidence:** Two autonomous harnesses (an optimization factory and an endurance/limits factory) both froze the compiler under test to a SHA-locked installed copy and refused to start if the binary resolved outside the frozen directory — never referencing the live workspace build tree. This kept findings attributable to a known version and made the loop safe to run unattended alongside active development.

**Rule:** An autonomous loop that observes or stresses a product must: (1) pin the product to a SHA-locked frozen artifact; (2) guard at startup that the binary under test resolves inside the frozen path, refusing to run otherwise; (3) be read-only against the live source/workspace. Findings from an unpinned target are unattributable and the loop can corrupt in-progress work.

**Applies in:** Fuzzers, eval harnesses, perf factories, CI observers running beside active development.

## P-FH-004 — Repeated in-process invocation leaks residual state a fresh subprocess doesn't

**Evidence:** One test failed deterministically only when the build entrypoint was called repeatedly in-process within one long-lived runner on one OS; the identical command in a fresh subprocess, the prebuilt binary, and the other OS all passed. It was correctly classified as an in-process link-state/handle artifact, not a compiler regression.

**Rule:** When a build/compile/tool step fails only inside a long-lived host process that invokes a heavy subsystem repeatedly in-process, but passes as a fresh subprocess, as a prebuilt artifact, and on other platforms, suspect accumulated in-process residual state (temp-file handles, working directory, backend pass residue) rather than a real code defect. Reproduce the exact command in a clean subprocess to separate a harness/in-process-reuse artifact from a genuine regression before spending fix budget.

**Applies in:** long-lived host processes invoking heavy subsystems in-process; shared-DB test harnesses

## P-FH-033 — Shared collection test harness: throwaway DB for destructive ops; assert only on keys you created

**Evidence:** A migration-down test was deferred because running it on the shared collection harness would drop shared roles/functions; a monitoring test that ran against a partitioned, never-truncated table asserted exclusively by its own unique tenant identifiers and picked a current-partition timestamp.

**Rule:** In a shared-database test harness reused across many tests, (a) run destructive or irreversible operations (schema drop, migration rollback) against a dedicated disposable database, never the shared one, since they remove roles/objects other tests depend on; and (b) when the harness does not truncate a given table between tests, scope every assertion to the unique keys the current test inserted (and choose timestamps that land in provisioned partitions), rather than asserting on global row counts.

**Applies in:** long-lived host processes invoking heavy subsystems in-process; shared-DB test harnesses
