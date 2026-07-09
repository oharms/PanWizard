---
topic: loop-design
last_updated: 2026-05-03T05:00:00.000Z
patterns:
  - id: P-1303
    summary: Exercising PAN's actual surfaces (autonomous run) produces orders-of-magnitude more PAN-relevant signal than building parallel tools — even when shorter
    promoted_at: 2026-04-27T11:21:36.814Z
    source_experiments: [panloop]
  - id: P-1403
    summary: Track wall-clock-per-commit and tokens-per-commit as autonomous-overhead metrics
    promoted_at: 2026-04-27T12:01:14.269Z
    source_experiments: [panloop]
---

# Loop Design (PAN-internal)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Internal-scope patterns are PAN-specific and stay in the source repo (stripped at install). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1303 — Exercising PAN's actual surfaces (autonomous run) produces orders-of-magnitude more PAN-relevant signal than building parallel tools — even when shorter

**Evidence:** Single 25-second autonomous run (panloop) surfaced 2 critical real PAN bugs (P-1301 AskUserQuestion gap, P-1302 runner permissions gap). Compare: 8 prior hand-built mock experiments (whoocsv, whoojson, whooemoji, whoocron, whoohash, whoouuid, whoodag, whoofreq) totaling many hours produced 0 PAN-internal findings — only generic engineering patterns. The autonomous loop validates its own design hypothesis: hitting real surfaces > simulating them.

**Rule:** When designing self-improvement loops or eval frameworks, the experiments must EXERCISE the system being optimized, not BUILD PARALLEL artifacts. A 25-second real run beats hours of mock work for surfacing system-internal bugs. For PAN specifically: future experiments should run /pan:new-project, /pan:plan-phase, /pan:exec-phase, /pan:focus-* against fresh test projects via the runner, not build standalone CLIs alongside. The mock builds have value for promoting GENERIC patterns; only autonomous runs surface PAN-INTERNAL ones.

**Applies in:** self-improvement loop design (ADR-0026 update); v3.8+ planning; promote-step heuristics

## P-1403 — Track wall-clock-per-commit and tokens-per-commit as autonomous-overhead metrics

**Evidence:** panloop: 25 commits in 29 min = 1.16 min/commit. Cost $12.84 / 25 commits = $0.51/commit. Useful baseline for future optimization.

**Rule:** PAN's /pan:learn report should compute and surface (a) commits_per_minute, (b) cost_usd_per_commit, (c) cost_usd_per_phase, (d) cost_usd_per_test, by reading harvest.json + git log + harvested cost data. Trend over experiments shows whether autonomous overhead is improving as patterns saturate.

**Applies in:** v3.8+ pan-optimizer agent prompt; harvest.json schema extension
