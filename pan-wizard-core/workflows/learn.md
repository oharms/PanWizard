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
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize trace current
```

If no active session, run:
```
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize trace list
```
Use the most recent session unless `--session <id>` was specified.

If `--session <id>` was specified, use that session ID.

## Step 2 — Generate local analysis

Run:
```
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize learn [--session <id>]
```

This produces `.planning/optimization/reports/{session}-analysis.json`.

Read the output and note:
- `summary.errors` — how many error events
- `summary.gaps` — how many gap events
- `summary.memory_misses` — how many memory miss events
- `summary.wasted_tokens` — tokens wasted on redundancies
- `top_error_patterns` — most frequent error categories
- `top_memory_misses` — most frequent memory miss topics

## Step 3 — Invoke pan-optimizer agent

Spawn the `pan-optimizer` agent with this instruction:

> Read the analysis at `.planning/optimization/reports/{session}-analysis.json` and the raw trace at `.planning/optimization/traces/{session}/trace.jsonl`. Also read any existing memory at `.planning/memory/*.md` to understand what's already known. Produce a full optimization report at `.planning/optimization/reports/{session}-opt-report.md` following the format in your agent definition.

Wait for the agent to complete. It will write the report to `.planning/optimization/reports/`.

## Step 4 — Present the summary

Read `.planning/optimization/reports/{session}-opt-report.md`.

Present to the user:
1. **Score** — the circular optimization score (0–100)
2. **Top 3 findings** — the most impactful recommendations
3. **Auto-applicable count** — how many items `/pan:optimize apply` can handle automatically
4. **Review required count** — how many prompt/workflow suggestions need human review
5. **Next step** — suggest running `/pan:optimize apply` to apply safe optimizations

## Step 5 — Auto-apply (if --apply flag)

If the `--apply` flag was passed, immediately run:
```
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize apply
```

Show what was applied and what still needs review.

## Step 6 — Update the circular score baseline

After applying, tell the user what to watch in the next run:
- Which memory gaps were filled (will reduce `memory_miss` events)
- Which error patterns were documented (will reduce repeat errors if agent reads memory)
- Prompt/workflow changes to consider applying manually

## Edge cases

**No events in trace:**
- Tell the user the trace session is empty. They may need to ensure the `pan-trace-logger` hook is registered in `.claude/settings.json`.

**Too few events (< 5):**
- The optimizer can still run but note the small sample size.

**Analysis fails:**
- Check that `.planning/optimization/traces/{session}/trace.jsonl` exists and is valid JSONL.
