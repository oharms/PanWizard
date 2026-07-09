# Field Harvest — d:\ drive sweep, 2026-07-09

A systematic sweep of every project directory on the dev drive for harvestable training material from past PAN-driven work. Method: four parallel read-only scouts over 22 directories, consolidated against the pre-sweep library (32 topics / 66 patterns), curated through the manual promote gate (`learn promote`), linted strict (L-001..L-005, zero warnings).

**Outcome (pass 1): 20 new patterns across 13 new universal topics + 1 internal addition.**
**Outcome (pass 2, same day — deep-mine of the lending project audit rounds, follow-up 2): 7 more patterns across 2 new topics (`audit-convergence`, `fix-campaigns`) plus 2 additions to `adversarial-verification`. Library now 47 topics / 93 patterns.**

This doc is repo-only (docs/ is not shipped); it records exact evidence paths — the shipped pattern files deliberately describe sources qualitatively so user machine paths don't leak into installs.

## Directory verdicts

| Directory | Verdict | Yield |
|---|---|---|
| `<lending-project>` | PAN (focus/orchestration model) | **Richest single source.** Mock/fake-code audit + round-2 fix plan → P-HON-001/002, P-ADV-001 |
| `<platform-project>` (nested!) | PAN (full phase model) | v2.0 milestone audit → P-INT-001/002; dispatch postmortem → P-SSOT-001 |
| `<compliance-project>` | PAN + army campaign v1.1 | mission-F NO-GO → P-MIG-001; concerns.md → P-XTT-001; deep reviews → P-SVC-001 |
| `<spec-factory>` | PAN-adjacent spec factory | FACTORY_ROADMAP/EVAL-STANDARD/MCP-STANDARD/SOP → P-GLD-001, P-MCP-001, P-HON-003, P-RES-008 |
| `d:\mph_factory` | Autonomous harness (non-PAN) | RULES.md R1–R7 → P-TI-001; frozen-artifact isolation → P-ISO-001 |
| `d:\mph_factory_limits` | Autonomous harness (non-PAN) | RULES.md L1–L9 → P-FLK-002, P-WKC-001, P-ISO-001 |
| `d:\montyhall_Door_One` | PAN (focus model) | cycle-close flaky finding → P-FLK-001 |
| `d:\montyhall_learning_corpus` | Training-corpus build | manifest + exclusion audit → P-GLD-002 |
| `d:\tmp\wt-worktree-smoke` | PAN (full campaign run) | campaign.md M6 post-mortem → P-SSOT-002 |
| `<forecasting-project>` | PAN (phase model) | Verification-report corpus; P-1605 already harvested; no net-new |
| `<external-tooling-repo>` | External (external monorepo) | Worktree-aware-tools design — recorded below, not promoted |
| `<compliance-project>-worktrees` | Duplicate snapshot of the compliance project | none (dedupe) |
| `d:\.planning` (drive root) | Stray codebase-map run, mixes two projects | junk — safe to delete |
| `<forecasting-design-docs>`, `<business-docs>{, Archive}` | Design/business docs, not agent-workflow | none |
| `<misc-project-a>`, `<misc-project-b>`, `d:\temp`, `d:\tools`, `d:\Base` | Empty / SQL dacpac / scratch / k8s CLIs / Fineract upstream | none |

## Promoted patterns → exact evidence

| Pattern | Topic | Evidence source |
|---|---|---|
| P-HON-001 fabrication on live paths | live-path-honesty | `<lending-project>\docs\specs\mock-fake-code-audit-2026-07-02.md` (H1, H2, M9, M12) |
| P-HON-002 honest-empty + demo gating | live-path-honesty | same audit (H3: enabled-unless-literal-`'false'`); `<lending-project>\.planning\orchestration\round2-fix-plan.md:29` |
| P-HON-003 scaffold ≠ deliverable | live-path-honesty | `<spec-factory>\SOP\procedures.md:75-84`; `eval\conformance_eval.py` (`code_unimplemented`) |
| P-TI-001 no dumbing down tests | test-integrity | `d:\mph_factory\RULES.md` R1–R6 (user standing instruction at line 84) |
| P-ADV-001 adversarial verify per finding | adversarial-verification | `mock-fake-code-audit-2026-07-02.md:4-7` (80→36; 34→23); `<lending-project>\.planning\orchestration\{army-campaign.json,round2-findings.json}` |
| P-INT-001 intra-phase PASS ≠ integrated | integration-verification | `<platform-project>\.planning\v2.0-milestone-audit.md` (FR-114, FR-110, NFR-036) |
| P-INT-002 regenerate derived artifacts | integration-verification | same audit, NFR-052 (stale traceability matrix) |
| P-SSOT-001 one classification predicate | single-source-of-truth | `<platform-project>\.planning\debug\dispatch-transient-no-redelivery.md:96-145` |
| P-SSOT-002 re-sync parallel truth copies | single-source-of-truth | `d:\tmp\wt-worktree-smoke\.planning\orchestration\campaign.md` (M6) |
| P-MIG-001 no unattended destructive DDL | migration-safety | `<compliance-project>\.planning\orchestration\mission-F-decision.md:11-13,24` |
| P-FLK-001 isolated re-run triage | flaky-triage | `d:\montyhall_Door_One\.planning\cycle-close\FLAKY-GCConcurrentMarkTests-2026-05-31.md` |
| P-FLK-002 windowed stats + 2-of-3 | flaky-triage | `d:\mph_factory_limits\RULES.md` L3/L4 |
| P-XTT-001 artifact over exit code | external-tool-truth | `<compliance-project>\.planning\codebase\concerns.md:75-78` (az acr build / cp1252) |
| P-GLD-001 human-verified golden sets | golden-sets | `<spec-factory>\eval\EVAL-STANDARD.md:5-41`; `FACTORY_ROADMAP.md:32` |
| P-GLD-002 execution-gated curation | golden-sets | `d:\montyhall_learning_corpus\{manifest.json,README.md,excluded.jsonl}` (6,332 gated / 4,204 excluded w/ reasons) |
| P-ISO-001 frozen-artifact isolation | harness-isolation | `d:\mph_factory\README.md`; `d:\mph_factory_limits\RULES.md` L1 |
| P-WKC-001 workaround catalog | workaround-catalog | `d:\mph_factory_limits\RULES.md` L9 (LIMFAC-009 5-day gap); `docs\env_overlay_catalog.md` |
| P-SVC-001 authed-CRUD security spine | service-security | `<compliance-project>\.planning\reviews\04\deep-review.md:26-57`; `reviews\07-11-milestone\deep-review.md:29-34` |
| P-MCP-001 MCP surface = injection channel | mcp-security | `<spec-factory>\FACTORY_ROADMAP.md:24-30`; `mcp\MCP-SECURITY-STANDARD.md` |
| P-RES-008 retrieval-first over fine-tune (internal) | external-research | `<spec-factory>\FACTORY_ROADMAP.md:9-22` (BEAVER ~10.8%; Tencent 53.8 vs 44.2 EM) |

## Candidates found but NOT promoted (with reasons)

- **Merge-base diff for parallel branches** (the compliance project missions.md) — duplicate of shipped **P-350**.
- **Plan-cheap/build-strong + worktree-per-agent + human-gated merge** (bot-army.md, round2-fix-plan.md) — duplicate of **P-330/P-340**.
- **Telemetry capture/sanity** — duplicate of **P-360**.
- **Produce-not-apply posture** (FACTORY.md) — corroborates existing army human-gate doctrine; no new rule content.
- **Reality-Score triage** `RS=(UV+TC+RR)/JS` (`<lending-project>\.planning\focus\scan-2026-06-17-delta.md:63`) — promising prioritization heuristic but single-project, no outcome data yet. Revisit if a second project adopts it.
- **Two-source observability agreement / oracle_disagreement** (`mph_factory_limits\RULES.md` L2/L7) — sound but niche; fold into flaky-triage later if it recurs.
- **Worktree-aware agent tools** (`<external-tooling-repo>'s worktree-awareness design spec`) — a design spec, not a validated lesson. **Actionable elsewhere:** informs `worktree.cjs`/army — treat a worktree as a project *variant* (two-phase resolution, per-worktree state namespace). Candidate ADR input, not a learning.
- **EP-ledger mechanism** (`montyhall_Door_One\.claude\memory\error_patterns.md`) — mechanism already exists as PAN's memory layer; contents are language-specific.
- **PAN verify-report format refinements** (the forecasting project `08-verification.md`, Door_One cc25 verification) — already canonical in templates/workflows; diff for template polish someday, not a pattern.

## Follow-ups — all implemented 2026-07-09 (same day)

1. **`d:\.planning` stray** — backed up to session scratchpad; deletion outside the repo sandbox was blocked, so removal is a one-liner for the operator: `Remove-Item -Recurse -Force d:\.planning`. The general case is now automated: `hygiene scan` detects fragment `.planning/` dirs (artifacts present, no workflow spine).
2. **Second-pass deep-mine — DONE.** Both code-quality audits and the full `round2-findings.json` were mined; 7 novel workflow patterns promoted (below).
3. **the spec-factory project suspect telemetry — VERIFIED.** `isSuspectRecord` (v3.12.4) flags all 119/119 records (max cache_read 835M). Aggregates were already protected; the missing piece — cleaning up the poisoned file itself — is now `hygiene clean`'s `quarantine-ledger` fix (rename in place, never delete). Live test: `the lending project` ledger is 1,195/1,509 (79%) suspect.
4. **the external tooling repo worktree-awareness — RECORDED** as ADR-0039 (worktree = project variant; two-phase resolution; per-variant state namespace). Design rule, binding on the first feature that keys mutable state off a project path.

Additionally, follow-ups 1 and 3 generalized into the **hygiene system** (`hygiene.cjs`, `pan-tools hygiene scan|clean`, `/pan:hygiene`): version alignment across runtime installs, legacy uppercase filenames, .tmp orphans, memory-log bloat, poisoned ledgers, stale trace sessions, fragment planning dirs.

## Pass 2 — promoted patterns → exact evidence

| Pattern | Topic | Evidence source |
|---|---|---|
| P-ADV-002 anti-double-jeopardy git provenance | adversarial-verification | `<lending-project>\.planning\orchestration\round2-findings.json` (confirm clause at :169, refute at :267) |
| P-ADV-003 reachable trigger + precedent severity + false-positive taxonomy | adversarial-verification | same register (:180, :316); `code-quality-audit-2026-07-02.md:4` (confirmation bar) |
| P-AUD-001 convergence stopping rule + model escalation | audit-convergence | `code-quality-audit-round4-2026-07-02.md:9-10` (108/9-HIGH → 16/0-HIGH; fable-5→opus-4-8; fan-out tapered 152→39) |
| P-AUD-002 lens rotation with prior-scope exclusion | audit-convergence | `code-quality-audit-2026-07-02.md:3,8`; `…round4…md:3` |
| P-FIX-001 defect-class handover clustering | fix-campaigns | `code-quality-audit-2026-07-02.md:156` (8 clusters from 108 findings, "fix the class once") |
| P-FIX-002 suggestedFix is untrusted | fix-campaigns | `code-quality-audit-round4-2026-07-02.md:63-67` (broken nginx guidance rejected; BLOCK on a bad fix) |
| P-FIX-003 fix-regression lens (inert/half-wired/sibling) | fix-campaigns | `…round4…md:18` (inert "amount-honest" fix re-opened a MED on Live; 3 total fix-regressions) |

Pass-2 non-promoted: fix-by-sibling-convergence (folded conceptually into `single-source-of-truth`), model-escalation-as-lever (folded into P-AUD-001).
