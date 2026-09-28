# ADR-0049: Machine verdicts and the findings ledger

## Status

Proposed — 2026-09-28. Implemented on `feat/evidence-loop` (spec `docs/specs/evidence_loop_featureai.md`, plan `docs/specs/evidence-loop-plan.md`); the maintainer accepts or amends it at release review. The decisions below were made in `/featureAI` on the maintainer's instruction to design, plan and build the evidence loop from the 2026-09-28 investigation and the September market-ideas queue.

## Context

PAN's judges already decide whether work passed. The plan checker gates plans, the reviewer gates code, the design checker gates designs, and the verifier gates phases. What PAN did not have is a record of those decisions. Measured on 2026-09-28 (aggregate counts only, spec §1.1):

- **Verdicts were prose that each workflow parsed its own way.**
  - exec-phase grepped `status:` from the verification frontmatter.
  - plan-phase matched headings.
  - The review step read an error count from a shell variable nothing set.
- **The reviewer's report was never saved.** `/pan:review-deep` read a `review.md` that no step wrote, from a path no phase directory has. Its parser also wanted bullet findings, while the reviewer writes tables. The reviewer half of every deep review therefore merged as zero findings.
- **Nothing recorded a decision about a finding.** No record said a finding had been deferred, dismissed or fixed, or why. Milestone audits reconstructed tech debt from prose.
- **The optimisation loop saw no failures in the field.**
  - Across 14 field projects: 3,968 trace events, zero `error`, `gap` or `correction` events.
  - Across 1,969 subagent transcripts on the same machine: 869 failed tool calls, 23.5% of spawns affected.
  - The failure signal depended on agents choosing to call `optimize trace log`. They did on success branches and never on error branches.
- **`optimize apply` could not be undone.** Running it twice on one report appended everything twice.

Two peers converged on the verification side (market ideas MI-030 and MI-031):
- Spec Kit's convergence classes: missing, partial, contradicts, unrequested.
- BMAD's review triage: every finding ends as patch, defer, dismiss-with-reason or decision, and never silently.

The Growing Harness paper (arXiv:2609.26760) supports runtime-recorded, localised failures and revertible changes.

## Decision

**D1: Verdict capture is a verb the workflow needs, not a hook.** `pan-tools findings record` reads a judge's report and prints the verdict the workflow branches on. That replaces the greps and heading matches, and the verdict gets recorded because the workflow needs the answer. It works on all five runtimes; per-agent transcripts exist on one. There is one writer per verdict.

**D2: One machine block for the judges that return text; the verifier keeps its frontmatter.**
- The plan checker, reviewer and design checker end their report with a fenced `pan-verdict` JSON block: `contract` `"1.0"`, agent, the agent's own verdict word, outcome `pass`/`fail`/`needs_human`, and findings, each with a class, severity, location and summary.
- The last block in a report wins.
- The verifier's verification.md frontmatter already is a machine contract, the one `/pan:plan-phase --gaps` consumes. A frontmatter adapter reads it, rather than asking the verifier for a second block that could disagree with it. The frontmatter gains `unrequested:` (M11).

**D3: Reports are saved in the phase directory by the orchestrator.** The judges stay read-only. The orchestrator writes the returned text verbatim to `NN-review.md`, `NN-plan-check.md` or `NN-design-check.md`.

**D4: An append-only project ledger, folded on read.** `.planning/findings.jsonl` holds verdict, finding and disposition rows.
- Status is derived, never stored: the latest disposition wins, and `fixed` gives way to `open` when a newer verdict reports the finding again.
- One file per project, because phase numbers continue across milestones; each row also records its milestone.
- It is the same append-only pattern as the cost and trace ledgers.

**D5: Deterministic identities.**
- A recorded artifact is identified by its line-ending-normalised content hash, so recording it twice is a no-op.
- A finding's id hashes its phase, agent, class, location and normalised summary.
- `attempt` counts one agent's verdicts on one phase.

**D6: Automatic status changes only where the evidence supports them.**
- A new verdict closes the same agent's earlier open findings on that phase that it no longer reports. That is how a gap-closure round closes gaps.
- `human` and `unrequested` findings are exempt, because a re-run does not re-check them.
- Deliberate dispositions are never overridden by a later report.

**D7: Dispositions need reasons, and workflows dispose what they continue past.** The vocabulary is `fixed`, `deferred`, `dismissed`, `decision`. The last three require a reason, and the verb refuses without one. Workflows record the reason whenever a phase moves on with findings open:
- warnings accepted at review;
- "continue anyway" at `NEEDS_FIXES`;
- "force proceed" after the plan revision limit;
- design caveats after the design revision limit.

Milestone audits read `findings debt`.

**D8: The trace hook captures the failures only it can see.** On the agent-transcript path only, the hook records failed tool calls as `error/tool_error` events:
- grouped per spawn, at most 10 events;
- redacted before they are written, because some projects commit their traces;
- `execution.error_pattern_learning: false` turns capture off; the key was reserved until now.

Verdicts do not go through the hook (D1).

**D9: Every optimizer apply is recorded, and a revert refuses what it cannot undo safely.**
- An `apply_id` with per-action records makes `optimize revert` exact.
- A revert refuses hand-edited files, and reverts are last-in, first-out per file.
- Applying the same report twice writes nothing the second time.
- The advisory before/after `optimize verdict` is deferred until the loop is used: one apply run existed in 14 field projects. Trigger: apply runs in three or more projects.

**D10: `contract` versions the machine-readable outputs.** `"1.0"` appears on the verdict block, on the `findings` outputs, and on `state`, `state json`, `progress` and their MCP resources (M17). The rule is additive within a major version; readers ignore unknown fields.

## Rejected alternatives

- **The hook parses verdicts from transcripts.** It works on one runtime of five, and it would make a second writer beside the workflow, with ambiguous deduplication.
- **Keep the prose `optimize trace log` calls for verdicts.** Measured: in the field they fired on success branches and never on error branches.
- **A `pan-verdict` block in verification.md too.** Two sources of truth in one file. The frontmatter is already the contract `plan-phase --gaps` reads.
- **Parse each judge's prose format.** The reviewer-table versus deep-review-bullet mismatch is the failure mode. One contract, one parser.
- **Dispositions in the verification template.** The status would live in files the model rewrites. The verb enforces the reason at the write, and the ledger keeps the history.
- **A per-phase findings file.** It would need phase-directory resolution in every writer, and milestone audits read across phases anyway.
- **Automatic revert on regression.** A PAN project has no fixed held-out task set, so any regression signal is advisory. Revert stays a user decision.

## Consequences

- **Positive.**
  - Workflows branch on one parsed verdict per judge, with the old reads kept as fallbacks.
  - Milestone audits get tech debt with the reasons recorded at the time.
  - Gap-closure rounds show what they resolved.
  - `/pan:review-deep` finally merges the reviewer's findings.
  - The optimiser sees failures and ranks them by recurrence.
  - An apply can be undone.
- **Negative, accepted.**
  - A finding reworded between attempts appears as fixed and re-opened under a new id. The open count stays right.
  - The judges' reports gain a block of JSON at the end.
  - The phase directory gains up to three report files.
- **Negative, mitigated.**
  - Captured error text could hold secrets. It is redacted and capped, with an off switch.
  - An unparseable block leaves the verdict unrecorded, so every workflow keeps its previous parse as the `||` fallback.
- **Runtime reach.** Verdicts, findings, dispositions, revert and `contract` work on all five runtimes. Tool-failure capture is Claude-only: it needs per-agent transcripts.
  - Copilot's documented camelCase payload is now read by both loggers, so its spawns carry their agent name. There are still no failures, because Copilot has no per-subagent transcript.
  - Gemini has no subagent-completion event, and OpenCode registers no hooks.

## Verification

- Unit suites for the contract, the ledger, the scope check, the hook capture (fixture shaped from real transcript records), revert, and the workflow drift. Each fix was revert-proven against the committed code.
- Tier-0 harness scenario `evidence-loop`: the whole loop runs green through a deployed install.
- Tier-1 `tool-error-capture`, first run 2026-09-28 ($0.50): a real subagent's failed `npm test` was captured from its own transcript by the installed hook.
