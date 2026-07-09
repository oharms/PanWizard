---
name: pan:preview
group: Foresight
description: Preview what will happen — phase blast radius, phase dependency graph, or milestone ETA
argument-hint: "phase <N> | phases | milestone"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

<objective>
Read-only foresight. Given a phase, a set of phases, or a milestone, produce a structured forecast: what files get touched, which tests might break, which phases can parallelize, when the milestone will actually finish.

Consolidates Spec B v1's architect + simulate + predict-milestone into one entry point with three modes. The data layer (`pan-tools preview …`) extracts structured inputs from `.planning/`; the `pan-previewer` agent analyzes and writes the report. No source code is modified.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/bin/lib/preview.cjs
@~/.claude/pan-wizard-core/templates/preview-report.md
</execution_context>

<modes>

### `phase <N>` — Blast radius of one phase

```
/pan:preview phase 7
```

**What it does:**
1. `pan-tools preview phase <N>` returns `{files_mentioned, test_files_mentioned, risk_signals, risk_score, plans[], status}`.
2. Spawn `pan-previewer` with the payload as `<preview_input>`.
3. Agent writes `.planning/phases/<N>/preview.md` with files touched / tests at risk / migration steps / risk assessment / bottom line.

**Output:** `.planning/phases/<N>/preview.md`

### `phases` — Cross-phase dependency graph

```
/pan:preview phases
```

**What it does:**
1. `pan-tools preview phases` returns `{phases[], parallel_batches, mermaid, hidden_coupling_count}`.
2. Spawn `pan-previewer` with `mode: phases` in the payload.
3. Agent writes `.planning/architecture/dependency-graph.md` with mermaid DAG + parallel batches + hidden-coupling flags.

**Output:** `.planning/architecture/dependency-graph.md`

**Opus 4.7 1M-context bonus:** when the full repo fits in a single agent window, the agent cross-references plan text with actual source imports to catch coupling the frontmatter missed. On smaller-context models, the agent relies on data-layer output alone.

### `milestone` — Completion ETA

```
/pan:preview milestone
```

**What it does:**
1. `pan-tools preview milestone` returns `{phases_total, completed, remaining, avg_phase_duration_days, eta_date, confidence_pct, bottleneck, sample_size}`.
2. Spawn `pan-previewer` with `mode: milestone`.
3. Agent writes `.planning/milestones/preview-<today>.md` with ETA + confidence + bottleneck + caveats + bottom line.

**Output:** `.planning/milestones/preview-YYYY-MM-DD.md`

</modes>

<workflow>

**Before committing to a phase:** run `/pan:preview phase <N>` to see blast radius. A `risk_score ≥ 7` or a migration signal on auth files should prompt a review before `/pan:exec-phase`.

**Before committing to a milestone date externally:** run `/pan:preview milestone`. Look at `confidence_pct` and `sample_size`. If sample is <3, don't promise a date.

**Before running phases in parallel:** run `/pan:preview phases`. Parallel batches from the data layer are based on declared `depends_on` only; `hidden_coupling_count > 0` means there are cross-phase references the author should promote to explicit deps before parallelizing.

</workflow>

<process>

For all modes:

1. Run the corresponding `pan-tools preview <mode>` subcommand.
2. Parse its JSON output.
3. Spawn `pan-previewer` with a prompt that includes:
   - `<preview_input>` block carrying the full JSON payload (mode field set explicitly)
   - `<output_path>` block with the target file path
   - `<files_to_read>` block with any phase context files the agent should load
4. Agent writes the report file and returns a short confirmation.
5. Echo the output path to the user.

The agent does not need workflow context beyond what the data layer provides. Keep spawned-agent prompts lean — the agent's context budget is for reasoning about the structured input, not for loading the whole project.

</process>

<output_contract>
The command returns the path to the generated preview document. Never paste the report back into conversation output — the file is the deliverable; reference it by path.
</output_contract>

<runtime_compatibility>

| Runtime | phase | phases | milestone |
|---------|-------|--------|-----------|
| Claude Code | Full, thinking enabled | Full, 1M-ctx bonus on Opus 4.7 | Full |
| OpenCode | Full | Data-layer + simple report | Full |
| Gemini CLI | Full | Data-layer + simple report | Full |
| Codex CLI | Full | Data-layer + simple report | Full |
| Copilot CLI | Full | Data-layer + simple report | Full |

The data layer (`pan-tools preview …`) works identically on all runtimes. What varies is the quality of the agent's synthesis — Opus 4.7 with thinking catches subtler risks than smaller models.

</runtime_compatibility>
