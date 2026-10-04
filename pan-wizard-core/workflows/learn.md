# Workflow: /pan:learn

Analyze the most recent trace session and generate a circular optimization report.

## Prerequisites

- A trace session must exist in `.planning/optimization/traces/`
- If no session exists, instruct the user to start one first:
  ```
  /pan:optimize trace init --description "what you're building"
  [run your build: /pan:exec-phase N or /pan:focus-exec]
  /pan:learn
  ```

## Step 1 — Identify the session

Run:
```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace current
```

If no active session, run:
```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace list
```
Use the most recent session unless `--session <id>` was specified.

If `--session <id>` was specified, use that session ID.

## Step 2 — Generate local analysis

Run:
```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize learn [--session <id> | --sessions <n>]
```

This produces `.planning/optimization/reports/{session}-analysis.json`. With `--sessions <n>` it pools the last n sessions into `pooled-<n>-{session}-analysis.json`: a recommendation should explain failures that recur across runs, not one run's accident.

Read the output and note:
- `summary.errors` — how many error events
- `summary.gaps` — how many gap events
- `summary.memory_misses` — how many times an agent logged missing knowledge (`memory_miss` events)
- `summary.wasted_tokens` — tokens wasted on redundancies
- `top_error_patterns` — most frequent error categories
- `top_tool_error_patterns` — failed tool calls captured from the subagents' own transcripts, ranked by how many spawns hit them
- `verdict_stats` — each judge's pass/fail counts, retries, and the retries that resolved a failure
- `top_memory_misses` — the topics most often logged as missing

## Step 3 — Invoke pan-optimizer agent

Spawn the `pan-optimizer` agent with this instruction:

> Read the analysis at `.planning/optimization/reports/{session}-analysis.json` and the raw trace at `.planning/optimization/traces/{session}/trace.jsonl`. Produce a full optimization report at `.planning/optimization/reports/{session}-opt-report.md` following the format in your agent definition.

Wait for the agent to complete. It will write the report to `.planning/optimization/reports/`.

## Step 4 — Present the summary

Read `.planning/optimization/reports/{session}-opt-report.md`.

Present to the user:
1. **Score** — the circular optimization score (0–100)
2. **Top 3 findings** — the most impactful recommendations
3. **Lessons** — how many, and where each belongs: the project's instructions (CLAUDE.md or AGENTS.md, outside PAN's section), a test, or a comment at the cited code
4. **Prompt and workflow changes** — how many, for human review
5. **Next step** — `/pan:optimize apply` records the suggestions in `.planning/optimization/suggestions.md`; a person makes the changes, because nothing in the report reaches an agent until it is written where the agents read

## Step 5 — Auto-apply (if --apply flag)

If the `--apply` flag was passed, immediately run:
```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize apply
```

Show what was recorded and where each suggestion belongs.

## Step 6 — Update the circular score baseline

After applying, tell the user what to watch in the next run:
- Which lessons they wrote into the project's instructions, tests or code (the next trace should show fewer of those gaps and `memory_miss` events)
- Which error patterns a prompt or workflow change addressed
- Prompt/workflow changes still to consider

## Edge cases

**No events in trace:**
- Tell the user the trace session is empty. They may need to ensure the `pan-trace-logger` hook is registered in `~/.claude/settings.json`.

**Too few events (< 5):**
- The optimizer can still run but note the small sample size.

**Analysis fails:**
- Check that `.planning/optimization/traces/{session}/trace.jsonl` exists and is valid JSONL.
