---
name: pan:cost
group: Observability
description: Show token usage and estimated cost across PAN commands and agents
argument-hint: "[report|append|clear|rebuild] [--format json|table|chart] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--apply] [--no-main-thread]"
allowed-tools:
  - Read
  - Bash
---

<objective>
Report token usage and estimated cost across all PAN invocations in this project.

Reads `.planning/metrics/tokens.jsonl` — an append-only log where each line is one call (agent or command) with token counts and model. Cost is computed from a built-in rate table (overridable via `.planning/config.json` → `cost.rates`).

Default output is JSON for piping. Use `--format table` for human-readable tables or `--format chart` for an ASCII bar chart of daily spend.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/bin/lib/cost.cjs
</execution_context>

<subcommands>

### `report` (default)

Aggregate all records into totals + breakdowns by agent, command, tier, and day.

```
pan-tools cost report [--format json|table|chart] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
```

**Flags:**
- `--format` — `json` (default, for tools) | `table` (aligned text columns) | `chart` (per-day ASCII bars).
- `--since` — ISO date lower bound (inclusive). Records without `ts` always pass.
- `--until` — ISO date upper bound (inclusive).

**JSON output shape:**
```json
{
  "totals": {
    "calls": 42,
    "input_tokens": 123456,
    "output_tokens": 4567,
    "cache_read_tokens": 50000,
    "cache_write_tokens": 5000,
    "cost_usd": 2.1234,
    "cost_unknown": 0,
    "suspect_excluded": 0,
    "empty_excluded": 0,
    "malformed_skipped": 0
  },
  "cache_hit_rate_pct": 40.5,
  "by_agent": { "pan-planner": { "calls": 8, "input": 50000, ... } },
  "by_command": { ... },
  "by_tier": { ... },
  "by_day": { "2026-04-18": { ... } },
  "window": { "since": null, "until": null }
}
```

### `append`

Append a single cost record. Normally called by instrumented agent spawns; users rarely invoke directly.

```
pan-tools cost append \
  [--agent <name>] [--command <name>] [--model <id>] [--tier reasoning|mid|fast] \
  [--input-tokens N] [--output-tokens N] \
  [--cache-read-tokens N] [--cache-write-tokens N] \
  [--phase <num>] [--session <id>]
```

Missing fields are stored as `null` / `0`. Cost is auto-computed when `model` or `tier` resolves to a known rate.

### `clear`

Delete the cost log. Useful at the start of a billing cycle.

```
pan-tools cost clear
```

### `rebuild`

Rebuild the ledger from Claude Code's own transcripts (session file plus the per-agent files under `<session>/subagents/`, Workflow-tool subagents one level down). Rows written by hooks before v3.29 booked a slice of the parent session to whichever subagent stopped and counted turns once per content block; the rebuild replaces them with one exact row per agent transcript, typed from the main thread's `Agent` calls, plus one row per session for the main thread's own usage (`--no-main-thread` omits it). Rows whose session transcript is gone, and caller-appended rows, are kept. Dry-run by default — show the user the per-session before → after (and any `warnings`), then apply only on their say-so; the previous ledger is kept beside the new one as `tokens.jsonl.rebuilt-<date>` (a later copy never overwrites an earlier one). Run it **before** `/pan:hygiene --apply` on a poisoned ledger: quarantine moves the whole file aside, and a rebuild afterwards has no rows left to keep. The main-thread row is dated to the session's last record, so `--since`/`--until` windows and the per-day view see a session's own usage on its final day.

```
pan-tools cost rebuild              # dry run
pan-tools cost rebuild --apply      # write the rebuilt ledger
```

</subcommands>

<rate_table>
PAN ships a built-in rate table (USD per million tokens) covering the current Claude, GPT and Gemini families, with a per-tier fallback for anything it doesn't recognize. Override it in `.planning/config.json` — key on a PAN tier (`reasoning` / `mid` / `fast`), on a model family (longest-prefix match, so a family key also covers the dated ids the hooks record), or on an exact model id:

```json
{
  "cost": {
    "rates": {
      "reasoning": { "input": 5.0, "output": 25.0, "cache_read": 0.5, "cache_write": 6.25 },
      "my-custom-model": { "input": 1.0, "output": 2.0, "cache_read": 0.1, "cache_write": 1.25 }
    }
  }
}
```

When a record has neither a known model nor a known tier, its cost is `null` and it counts toward `totals.cost_unknown`.
</rate_table>

<workflow>

**Daily check:** run `/pan:cost --format chart` at the end of a working day to see the spend shape.

**Before shipping:** run `/pan:cost --since 2026-04-01 --format table` to get a total for the billing period.

**After an expensive run:** check `by_agent` and `by_command` to see which stage drove the spend.

**To reconcile with provider bill:** providers report total tokens; PAN's log is append-only and in ISO-8601, so `--since / --until` should match the provider's billing window.

</workflow>

<instrumentation_note>

Token records are written by any caller that knows its usage — typically the host runtime or a wrapper. PAN ships the log format, this aggregator, and the `pan-cost-logger` capture hook, which the installer registers on Claude Code, Codex and Copilot CLI. Elsewhere, records can be appended manually via `pan-tools cost append` or by external scripts reading the provider API.

If `.planning/metrics/tokens.jsonl` is empty, `/pan:cost` returns zero totals — the feature is inert, not broken.

</instrumentation_note>

<runtime_compatibility>

| Runtime | Support |
|---------|---------|
| Claude Code | Full — data format + aggregation + all output formats |
| OpenCode | Full aggregator; PAN registers no hooks on OpenCode, so records come from `pan-tools cost append` or an external script |
| Gemini | Full aggregator; PAN registers no cost hook on Gemini CLI (no subagent-completion event), so records come from `pan-tools cost append` or an external script |
| Codex | Full — `pan-cost-logger` registered on `SubagentStop` in `.codex/hooks.json` |
| Copilot CLI | Full aggregator; `pan-cost-logger` registered on `subagentStop` in `.github/hooks/pan.json` (token counts depend on what the payload carries) |

The aggregator is runtime-agnostic. What varies across runtimes is how records *get into* `tokens.jsonl` in the first place.

</runtime_compatibility>
