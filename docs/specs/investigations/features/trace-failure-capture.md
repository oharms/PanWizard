# Failure capture in the trace hook, not in agent prompts

| | |
|---|---|
| Verdict | ENHANCE |
| Priority | P2 (this release cycle) |
| Size | M 4 points |
| Area | learnings/optimize/experiment · hooks |
| Runtimes | Claude first (per-agent transcripts are proven there); Codex and Copilot also fire a subagent-stop event (`HOOK_EVENT_MAP` in `bin/install-lib.cjs`) but their transcript shape is unverified; Gemini and OpenCode register no subagent-stop hook |
| First seen | `2026-09-28` — [digest](../digests/2026-09-28.md) |
| Ledger | — |
| Status | FILED `MI-060` |

## Source trail
- `2026-09-28` — Growing Harness (arXiv:2609.26760 v2): an agent program improves from task feedback only when each failure is recorded by the runtime as an execution trace (function calls, model and tool calls, errors) and tied to the code it passed through. Removing that function-level localisation halved final success in their ablation (36% → 18%, one run, 50 tasks). The paper's thesis is that recurring control belongs in code, not in model context (source: arXiv:2609.26760, via the LLM brief of `2026-09-28`).

## Why it matters for PAN
PAN's optimisation loop (`optimize trace` → `/pan:learn` → `optimize apply`) exists to learn from failures, but its failure signal is **delegated to the model**: the workflows instruct agents to run `pan-tools optimize trace log --type error …` at fixed points, and agents do not. This is the exact pattern the paper argues against: recurring control that the model is asked to redo every run. The field sweep of September 2026 measured the result: across the D-drive projects, trace events were almost all `decision/agent_completion`, and **zero** errors, gaps or corrections were ever recorded (project memory `field-telemetry-2026-09`, finding 4). The loop runs, but it has nothing to learn from. That also blocks the [optimize-apply regression gate](optimize-apply-regression-gate.md), which needs a failure signal to compare.

Thesis fit: it moves an observation that can be made mechanically out of the prompt and into code, the "deterministic orchestration where control flow is knowable pre-run" pillar.

## Current state (evidence)
- `hooks/pan-trace-logger.js:830`: the SubagentStop hook writes one `type: 'decision', category: 'agent_completion'` event per spawn (tokens, duration, `exit_code`, model, command). **SOURCE**
- `hooks/pan-trace-logger.js:880`: its only other event is a `redundancy` heuristic (same agent type twice with similar tokens). **SOURCE**
- The hook already reads the per-agent transcript for token counts (v4 rows, per-agent `subagents/agent-<id>.jsonl`), and already walks `tool_result` records, but only to skip them when finding typed user turns (`hooks/pan-trace-logger.js:274`). **SOURCE**
- Error, gap and correction events come only from `optimize trace log` calls written into workflow prose: `exec-phase.md`, `plan-phase.md`, `verify-phase.md`, `discuss-phase.md` and `optimize.md` all carry the instruction (`grep -c "optimize trace log" pan-wizard-core/workflows/*.md`). **SOURCE**
- The field result (zero error events ever) is recorded in project memory, not re-measured today. **DOC**

## Proposal
Have the trace hook derive failure events from the subagent's own transcript, deterministically, when the spawn completes:

- **`error / tool_error`**: a `tool_result` block with `is_error: true`, carrying the tool name and a normalised, truncated error line. One event per distinct (tool, first line) pair per spawn, so a retry loop does not flood the trace.
- **`error / verdict_failed`**: the agent's final message carries a verdict PAN's own agents emit (the verifier's gaps verdict, the plan-checker's issues verdict). Match on the agent's own transcript, not on the parent's framed copy (Claude Code frames and indents subagent results since 2.1.277).
- **`correction / retry`**: the same agent type re-spawned in the same phase after a `verdict_failed`. That is the escalation path MI-029 shipped (`resolve-model --attempt`), so the attempt number is the localisation.

The localisation is `(command, phase, agent, tool)`, PAN's counterpart of the paper's "function the failure passed through". Keep the prompt-side `optimize trace log` instructions for what only the model can know (a knowledge gap, a surprise), and drop them where the hook now sees the event, so the prose shrinks.

## Implementation sketch
| Layer | Change |
|---|---|
| Core module (`pan-wizard-core/bin/lib/`) | `optimize.cjs`: accept the new categories in `generateLocalReport`'s error/gap grouping (`EVENT_TYPES` already has `error` and `correction`) |
| Dispatcher (`pan-tools.cjs`) | none |
| Installer / per-runtime (`bin/install-lib.cjs`) | none. The hook is already registered wherever `subagentStop` is non-null |
| Commands / agents / workflows (markdown) | remove the `optimize trace log --type error` instructions the hook now covers; keep gap/surprise |
| Hooks / MCP | `hooks/pan-trace-logger.js`: a pure `extractFailureEvents(transcriptRecords, agent)` beside the token reader; same dedupe signature scheme as the completion event |
| Tests | fixture transcripts **emitted by a real run** (the fixture-from-emitted-output rule), one with a failing Bash tool call and one with a gaps verdict; assert events appear; show the test fails on the current hook; hook payload fixtures in `tests/` alongside the hooks-e2e suite |
| Harness | a tier-0 scenario is not enough (no model step); a tier-1 scenario whose seed makes a test fail, asserting `optimize stats` shows a non-zero error count |
| Docs / ADR | `docs/HOOKS.md` trace-logger section; no ADR (it restores the loop's stated design) |

## Gate
A tier-1 harness run on a seed with a deliberately failing test records at least one `error` event in `.planning/optimization/traces/*/trace.jsonl` without any agent calling `optimize trace log`, and the unit test built from that run's transcript fails against the pre-change hook.

## Effort & risk
- Transcript formats move. Claude's per-agent transcript is proven (the cost rebuild depends on it); Codex and Copilot payloads need a live probe before the extractor claims them. Ship Claude-only first and say so.
- Noise: an `is_error` tool result is often a normal step (a grep with no match, a test run expected to fail in TDD). Categorise it rather than dropping it, and let `optimize learn` weigh repeats across spawns.
- Privacy: error lines can carry paths or secrets. Truncate and redact with the same rules the cost ledger uses; everything stays in the project's `.planning/`.

## Open questions for the owner
- Keep or delete the workflow-prose `optimize trace log` calls the hook makes redundant?
- Is the verdict match stable enough across PAN's agents, or should the verifier and plan-checker emit a machine line (for example a fenced JSON verdict) that the hook reads?

## Outcome (`2026-09-28`)

Built on `feat/evidence-loop`, designed in [evidence_loop_featureai.md](../../evidence_loop_featureai.md) (ADR-0049).
- **Premise re-measured first.** No field project had ever recorded an error event, while subagent transcripts held 869 failed tool calls across 1,969 spawns. The write-up's claim that agents never call `optimize trace log` was only half right: they did, on success branches, and never on error branches.
- **Verdicts.** Both open questions are answered in the spec. The judges emit a `pan-verdict` block, and a verb (`findings record`) reads it rather than the hook, because the verb works on every runtime and the workflow needs the answer. The verdict-path prose calls were removed.
- **Tool failures.** The hook records them from per-agent transcripts on Claude Code, redacted, and `execution.error_pattern_learning: false` turns it off.
- **Runtimes.** Codex and Copilot were checked: Copilot's documented payload has no per-subagent transcript, and its field names are now read.
- **Gate met.** The tier-1 harness run `tool-error-capture` captured a real subagent's failing `npm test` through the installed hook ($0.50); the unit test built on the real record shape fails against the pre-change hook.
