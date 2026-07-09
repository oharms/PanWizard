---
name: pan:review-deep
group: Review
description: Security audit + cross-reviewer check. OWASP/STRIDE pass by pan-hardener, then pan-meta-reviewer catches what the first pass missed. Writes consolidated deep-review.md.
argument-hint: "<phase-number>"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
---

<objective>
Run a deeper review pass on a phase than `pan-reviewer` alone provides. Two new agents:

1. **pan-hardener** — OWASP Top 10 (2025) + STRIDE threat model on files changed in the phase.
2. **pan-meta-reviewer** — reads both the reviewer's and hardener's output, flags things both missed, disputes overstated severities.

Outputs are merged by `review-deep.cjs` into a single `.planning/reviews/<phase>/deep-review.md` with verdict, coverage stats, and conflict table. An audit entry is published to the `review-handoff` bus channel for traceability.

Consolidates Spec B v1's X-4 (self-review) + X-12 (harden) into a single command.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/bin/lib/review-deep.cjs
@~/.claude/pan-wizard-core/bin/lib/bus.cjs
@~/.claude/agents/pan-hardener.md
@~/.claude/agents/pan-meta-reviewer.md
</execution_context>

<invocation_modes>

### Standalone

```
/pan:review-deep 07
```

Run after `/pan:exec-phase 07` completes. Requires `pan-reviewer` to have already written its review to `.planning/phases/07/review.md` (exec-phase does this automatically).

### Integrated with exec-phase

```
/pan:exec-phase 07 --deep-review
```

Runs the normal exec → reviewer pipeline, then auto-invokes this command. Recommended for phases touching auth, payment, PII, migrations, or public APIs.

### Integrated with focus-exec

```
/pan:focus-exec --deep-review
```

Per-item deep review during focus campaigns. Useful for high-stakes batches.

</invocation_modes>

<process>

1. **Load reviewer output** — read `.planning/phases/<N>/review.md` written by the earlier `pan-reviewer` step. If missing, warn and offer to run `pan-reviewer` first.

2. **Spawn pan-hardener** (parallel-safe with step 3 isolation below, but recommended sequential for audit clarity):
   - Prompt includes: `<files_to_read>` with phase plan + diff + reviewer output; `<output_path>` = `.planning/reviews/<N>/hardener.md`; `<framework_scope>` block reminding of OWASP/STRIDE coverage.
   - Agent writes its findings to the output path, returns confirmation.

3. **Spawn pan-meta-reviewer**:
   - Prompt includes: `<files_to_read>` with both reviewer.md AND hardener.md (and representative diff snippets); `<output_path>` = `.planning/reviews/<N>/meta.md`.
   - Agent reads both first-pass reports, identifies missed patterns, disputes overstated severities, writes to output path.

4. **Merge** — call:
   ```
   pan-tools review-deep merge <N> \
     --reviewer-file .planning/phases/<N>/review.md \
     --hardener-file .planning/reviews/<N>/hardener.md \
     --meta-file .planning/reviews/<N>/meta.md
   ```
   The merger parses all three, sorts by severity, computes verdict (`ok` | `ok_with_minor` | `fix_before_merge` | `review_required` | `block`), writes `.planning/reviews/<N>/deep-review.md`, and publishes an audit record to the `review-handoff` bus channel.

5. **Report back** — echo verdict + finding count + conflict count. If verdict is `block` or `review_required`, recommend the user review `deep-review.md` before proceeding.

</process>

<verdict_semantics>

| Verdict | Meaning | Action |
|---------|---------|--------|
| `ok` | No findings at any severity | Merge freely |
| `ok_with_minor` | Only low/info findings | Merge with noted follow-ups |
| `fix_before_merge` | Medium findings present | Fix or document before merge |
| `review_required` | High findings present | Human sign-off required |
| `block` | At least one critical | Do not merge |

Verdict is driven by the highest-severity finding across all three sources. Meta-reviewer disputes can downgrade severity on specific findings but don't change the headline verdict — the merger trusts the consensus of the explicit severity labels.

</verdict_semantics>

<output_files>

- `.planning/phases/<N>/review.md` — pan-reviewer output (written earlier by exec-phase)
- `.planning/reviews/<N>/hardener.md` — pan-hardener output (new)
- `.planning/reviews/<N>/meta.md` — pan-meta-reviewer output (new)
- `.planning/reviews/<N>/deep-review.md` — merged consolidated report (final deliverable)
- `.planning/bus/review-handoff.jsonl` — audit trail entry (append-only)

</output_files>

<runtime_compatibility>

| Runtime | hardener | meta-reviewer | merge |
|---------|----------|---------------|-------|
| Claude Code | Full, thinking enabled (6000/4000 budget) | Full | Full |
| OpenCode | Prose "think step-by-step" preamble substitutes for thinking | Same | Full (runtime-agnostic CLI) |
| Gemini | Same | Same | Full |
| Codex | Same | Same | Full |
| Copilot | Same | Same | Full |

The merger CLI (`pan-tools review-deep merge`) is pure Node.js and works identically across runtimes. Only the *quality* of the hardener and meta-reviewer outputs varies with model capability — Opus 4.7 with extended thinking produces the richest findings.

</runtime_compatibility>

<calibration_note>

Deep review is opt-in for a reason: it costs roughly 3× a normal review (hardener + meta + merge adds two agent spawns per phase). Use it for high-stakes phases, not every phase. `--deep-review` gating by phase tags is a v3.4 candidate enhancement.

</calibration_note>
