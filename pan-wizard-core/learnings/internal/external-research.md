---
topic: external-research
last_updated: 2026-07-09T14:04:40.520Z
patterns:
  - id: P-RES-001
    summary: ACE (Zhang et al, arXiv:2510.04618, Oct 2025): summary-based context chains have brevity bias and context collapse. Treat memory as append-and-curate playbook, not paraphrase chain
    promoted_at: 2026-05-02T18:15:25.976Z
    source_experiments: [external]
  - id: P-RES-002
    summary: Chroma context-rot (July 2025): a single semantically-similar-but-irrelevant distractor degrades performance even at modest context sizes. Distractor density matters more than token count
    promoted_at: 2026-05-02T18:15:32.003Z
    source_experiments: [external]
  - id: P-RES-003
    summary: Cognition (June 2025) anti-multi-agent argument: parallel sub-agents fail because every action carries unstated decisions; downstream agents reconcile contradictions blindly when they only see artifacts
    promoted_at: 2026-05-02T18:15:39.391Z
    source_experiments: [external]
  - id: P-RES-004
    summary: Specification Gap paper (arXiv:2603.24284, early 2026): two-agent integration accuracy collapses 58 to 25 percent as spec detail is removed; coordination is quadratically sensitive to spec completeness
    promoted_at: 2026-05-02T18:15:50.213Z
    source_experiments: [external]
  - id: P-RES-005
    summary: GitHub PR audit (arXiv:2601.15195, Jan 2026): agent PRs fail mostly from spec/intent mismatch, design fit, and repo-norm violation — not buggy code. Code that compiles and tests still gets rejected
    promoted_at: 2026-05-02T18:15:58.959Z
    source_experiments: [external]
  - id: P-RES-006
    summary: S2R / RLVR (ACL 2025): naive self-critique is largely ineffective; verification gains come from FRESH-CONTEXT RESTART and FILE-MEDIATED STRUCTURE forcing re-reading, not from the judging itself. Verbose self-review can hurt via overthinking
    promoted_at: 2026-05-02T18:16:09.893Z
    source_experiments: [external]
  - id: P-RES-007
    summary: Sakana DGM (2025): in self-improvement loops, AGENT-DESIGN changes generalize across models and languages; PROMPT-FRAGMENT tweaks do not. Promote structural changes, not phrasing tweaks
    promoted_at: 2026-05-02T18:16:19.459Z
    source_experiments: [external]
  - id: P-RES-008
    summary: Enterprise "train on our data" asks are retrieval problems, not fine-tuning problems: schema/context LINKING is the bottleneck (BEAVER: SOTA ~10.8% on real enterprise schemas vs 80%+ on public benchmarks, ~68% of failures are schema-linking), and plain BM25 RAG beats fine-tuning alone (Tencent 160k-file study: 53.8% vs 44.2% EM; FT alone caused catastrophic forgetting; FT+RAG best at 57.4%)
    promoted_at: 2026-07-09T14:04:40.520Z
    source_experiments: [spec-factory]
---

# External Research (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-RES-001 — ACE (Zhang et al, arXiv:2510.04618, Oct 2025): summary-based context chains have brevity bias and context collapse. Treat memory as append-and-curate playbook, not paraphrase chain

**Evidence:** https://arxiv.org/abs/2510.04618 — ACE: Agentic Context Engineering. Empirical: iterative summarization monotonically loses detail on agent and finance benchmarks; structured playbook curation outperforms across runs.

**Rule:** Reframe memory/<agent>.md and per-phase summary.md as a structured DELTA-LOG (curated by an explicit reviewer step) rather than a paraphrase of the prior phase. Each entry is an addition or amendment to a structured field, not a fresh re-summarization. Curation is its own step, distinct from generation. The pan-optimizer's accrual model should be re-examined under this lens — does it append signal, or summarize away signal?

**Applies in:** pan-optimizer accrual loop, memory.cjs, summary.md template design, retro --write-memory

## P-RES-002 — Chroma context-rot (July 2025): a single semantically-similar-but-irrelevant distractor degrades performance even at modest context sizes. Distractor density matters more than token count

**Evidence:** https://www.trychroma.com/research/context-rot — Hong & Huber, July 2025. Single-distractor experiments showed degradation begins well before 200K, and is non-linear with arrangement and similarity.

**Rule:** Per-phase context budgets currently track tokens. Add a notion of distractor density: how much of context.md / research.md is plausibly-related-but-off-topic. Codebase mapper and phase researcher should optimize for relevance ratio, not coverage. The phase-budget command should warn when the relevance ratio is low even if token count is healthy.

**Applies in:** phase-budget, codebase scan filtering, research agent guidance

## P-RES-003 — Cognition (June 2025) anti-multi-agent argument: parallel sub-agents fail because every action carries unstated decisions; downstream agents reconcile contradictions blindly when they only see artifacts

**Evidence:** https://cognition.ai/blog/dont-build-multi-agents — Walden Yan, Cognition. Contrast https://www.anthropic.com/engineering/multi-agent-research-system which argues breadth-first reads parallelize fine but writes/decisions need a single coherent trace.

**Rule:** PAN's serial pipeline (planner -> researcher -> executor -> verifier) is what Cognition endorses, but file-mediated handoff passes only OUTPUTS, not reasoning traces. Consider: should plan.md include an explicit decisions-and-rationale section that the executor reads, beyond just the task list? Should summary.md include a deviations log that the verifier reads? The signal is: when an agent is briefed for a downstream phase, the upstream agent's reasoning trace should be available, not just the artifacts.

**Applies in:** plan.md template, summary.md template, executor briefing, conductor briefing

## P-RES-004 — Specification Gap paper (arXiv:2603.24284, early 2026): two-agent integration accuracy collapses 58 to 25 percent as spec detail is removed; coordination is quadratically sensitive to spec completeness

**Evidence:** https://arxiv.org/abs/2603.24284v1 — The Specification Gap. Two-agent integration: 58 percent accuracy with full spec, 25 percent with stripped spec. Single-agent baseline: 89 to 56 percent. Coordination cost of incomplete specs is quadratic.

**Rule:** pan-plan-checker currently verifies plan COHERENCE across 8 dimensions. Add a 9th: spec-sufficiency-for-handoff. Question to answer: does this plan contain enough detail that the executor cannot make a divergent decision in the implicit space the plan does not constrain. The check is not is-the-plan-good but is-the-plan-complete-enough-to-survive-the-context-boundary. Specifically: every task has explicit Files, explicit Action, explicit Verify, explicit Done; every architectural choice is locked vs flexible; every assumption is named.

**Applies in:** agents/pan-plan-checker.md (existing 8 verification dimensions), plan.md template (forcing locked-vs-flexible markers)

## P-RES-005 — GitHub PR audit (arXiv:2601.15195, Jan 2026): agent PRs fail mostly from spec/intent mismatch, design fit, and repo-norm violation — not buggy code. Code that compiles and tests still gets rejected

**Evidence:** https://arxiv.org/abs/2601.15195 — Where Do AI Coding Agents Fail. 33K-PR audit. Primary failure modes: spec/intent mismatch (32 percent), design fit (24 percent), repo-norm violation (19 percent). Buggy code is a minority cause of rejection.

**Rule:** pan-verifier currently checks code-against-plan. The dominant external-world failure is fit-against-repo-norms (style, naming, prior-PR conventions, framework idioms). Verifier should treat codebase/CONVENTIONS.md and codebase/STRUCTURE.md (when they exist from /pan:map-codebase) as first-class verification inputs, not advisory context. project.md and requirements.md may need a Norms section the verifier explicitly tests against. The verification dimensions should add: does this code follow the conventions evident in adjacent files.

**Applies in:** agents/pan-verifier.md, agents/pan-reviewer.md, codebase/CONVENTIONS.md consumption, project.md template

## P-RES-006 — S2R / RLVR (ACL 2025): naive self-critique is largely ineffective; verification gains come from FRESH-CONTEXT RESTART and FILE-MEDIATED STRUCTURE forcing re-reading, not from the judging itself. Verbose self-review can hurt via overthinking

**Evidence:** https://aclanthology.org/2025.acl-long.1104.pdf — S2R. https://magazine.sebastianraschka.com/p/state-of-llms-2025 — Raschka summary. Untrained self-critique provides little gain on reasoning; verification helps when verifier has training or runs against verifiable rewards.

**Rule:** PAN has multiple judgment-style verification roles: pan-plan-checker (judges plan coherence), pan-meta-reviewer (judges other reviewers), pan-hardener (judges security risk by inspection). The S2R finding suggests these roles' value is mostly the FRESH-CONTEXT structural reset, not the judgment per se. Implication: lean these agents harder on VERIFIABLE signals (test cmd, lint cmd, schema check, type check, dep cycle scan, regex anti-pattern detection) and reduce prose-only verdicts. Where a verifiable check exists, use it instead of prose review. Where one doesn't, ask whether the role earns its compute.

**Applies in:** agents/pan-plan-checker.md, agents/pan-verifier.md, agents/pan-reviewer.md, agents/pan-meta-reviewer.md, agents/pan-hardener.md, references/verification-patterns.md

## P-RES-007 — Sakana DGM (2025): in self-improvement loops, AGENT-DESIGN changes generalize across models and languages; PROMPT-FRAGMENT tweaks do not. Promote structural changes, not phrasing tweaks

**Evidence:** https://sakana.ai/dgm/ — Darwin Godel Machine. Population-based self-improvement showed structural changes transferred across models; specific prompt tweaks did not. The same generalization curve likely holds for human-mediated promote gates.

**Rule:** When pan-tools learn promote runs (manual gate today, possibly auto-promote in v3.8+), the promote criterion should distinguish: 1) STRUCTURAL pattern (a new agent role, a new file in .planning/, a new verification gate, a new tool-use idiom, an architectural decision) vs 2) PROMPT-FRAGMENT (specific phrasing, a worded instruction, a stylistic preference). Universal scope should be reserved for structural patterns. Prompt fragments belong in internal scope at most — they don't generalize across models or languages, so shipping them to all 5 runtimes is a bet that won't pay.

**Applies in:** pan-tools learn promote --scope universal gate, optimize.cjs promotePattern criteria, future auto-promote rules

## P-RES-008 — Enterprise "train on our data" asks are retrieval problems, not fine-tuning problems: schema/context LINKING is the bottleneck (BEAVER: SOTA ~10.8% on real enterprise schemas vs 80%+ on public benchmarks, ~68% of failures are schema-linking), and plain BM25 RAG beats fine-tuning alone (Tencent 160k-file study: 53.8% vs 44.2% EM; FT alone caused catastrophic forgetting; FT+RAG best at 57.4%)

**Evidence:** The the tech-spec factory tech-spec factory research roadmap (adversarially verified, with citations) synthesized: on BEAVER (real enterprise schemas) SOTA agents collapse to ~10.8%; roughly 68% of failures are schema-linking, not generation. The Tencent 160k-file study showed plain BM25 retrieval beating fine-tuning alone (53.8 vs 44.2 EM) with fine-tuning alone causing catastrophic forgetting. Design consequence adopted there: never dump a full schema into context — decompose into semantic units, hybrid-retrieve a small candidate set (~50), then resolve to physical names.

**Rule:** When a project asks to "train the model on our data/schema": default to retrieval-first (decompose corpus into semantic units, hybrid lexical+semantic retrieval of a small candidate set, then resolve). Treat fine-tuning as an additive step at most, never the substitute. Size context by retrieved candidates, not by dumping the schema. Expect public-benchmark performance claims to overstate enterprise reality by up to an order of magnitude.

**Applies in:** Research/planning phases for RAG or fine-tune decisions, enterprise schema tooling, context-budget design.
