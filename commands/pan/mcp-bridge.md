---
name: pan:mcp-bridge
group: External tools
description: Discover available MCP tools and recommend which ones apply to a phase. Discovery-only; auto-invocation deferred.
argument-hint: "list | recommend <phase> | cache [--servers <json>] [--runtime <name>]"
allowed-tools:
  - Read
  - Bash
  - Write
---

<objective>
Surface Model Context Protocol (MCP) tools visible to the host runtime and recommend which ones might apply to a specific phase plan.

Reduced scope from Spec B v1's X-7: **discovery and recommendation only**. Auto-injection of MCP tools into planner context and auto-invocation from executor agents are deliberately deferred (likely Wave 5+ or v3.5). This keeps v3.3 narrow and avoids coupling PAN to Claude Code's MCP schema stability.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/bin/lib/bridge.cjs
</execution_context>

<subcommands>

### `list`

Show cached MCP tools with server grouping and schemas.

```
/pan:mcp-bridge list
```

**Output (JSON):**
```json
{
  "cached_at": "2026-04-18T12:34:56Z",
  "runtime": "claude",
  "server_count": 3,
  "tool_count": 12,
  "tools": [
    { "server": "linear", "name": "linear.updateTicket", "description": "...", "schema": {...} },
    ...
  ],
  "source": "cache" | "empty"
}
```

When `source: "empty"`, either no MCP servers are configured or the host runtime hasn't populated the cache yet. See the `cache` subcommand for manual seeding.

### `recommend <phase>`

Given a phase number, match cached MCP tools against the phase's plan text and return tools ranked by keyword relevance.

```
/pan:mcp-bridge recommend 7
/pan:mcp-bridge recommend 12 --max 5 --min-score 2
```

**Flags:**
- `--max N` — cap recommendations (default 10)
- `--min-score N` — minimum keyword hit count (default 1)

**Output (JSON):**
```json
{
  "phase": "7",
  "phase_name": "API refactor",
  "runtime": "claude",
  "total_candidates": 12,
  "recommendations": [
    {
      "server": "linear",
      "name": "linear.updateTicket",
      "description": "Update a Linear issue",
      "score": 3,
      "hits": ["linear", "ticket", "update"]
    }
  ]
}
```

Scoring is naive keyword frequency with word boundaries — not semantic embeddings. A tool's name and description are tokenized into keywords (≥3 chars); each match in the phase plan text scores 1 point.

### `cache`

Write or inspect the MCP tools cache at `.planning/bridge/available-tools.json`.

```
# Inspect current cache (same as `list` but raw)
/pan:mcp-bridge cache

# Seed cache from scripted discovery (for testing or external pipeline)
/pan:mcp-bridge cache --runtime claude --servers '[{"name":"linear","tools":[{"name":"linear.updateTicket","description":"Update ticket"}]}]'
```

Normally the host runtime writes this file. The CLI path exists for test fixtures and external-script integration.

</subcommands>

<workflow>

**New to a project with MCP tools?** Run `/pan:mcp-bridge list` to see what's available. If empty, check the host runtime's MCP config — `.claude/settings.json` for Claude Code, or the runtime's equivalent.

**Planning a phase that might touch external systems?** Run `/pan:mcp-bridge recommend <phase>` to get a ranked shortlist. Copy relevant tool names into the phase plan's "External tools" section so the executor knows to invoke them.

**Pre-milestone review:** walk through each remaining phase with `/pan:mcp-bridge recommend` to catch "we should have automated this via Linear/Slack/etc." realizations before shipping.

</workflow>

<caveats>

**Discovery is a cache, not a live probe.** The host runtime owns populating `.planning/bridge/available-tools.json`. PAN does not query MCP servers directly — that would require runtime-specific HTTP or IPC integration this command deliberately avoids.

**Keyword scoring is crude.** "Postgres" and "PostgreSQL" are different tokens; `postgresql` in a plan won't match a `postgres.query` tool unless the plan also says "postgres." Tune your plan language or expand tool descriptions to improve matches.

**Claude Code is the primary target.** MCP is a Claude-first protocol. Other runtimes may have their own tool-discovery mechanisms; the cache schema is intentionally generic so a future Codex/Gemini equivalent could populate the same file.

**No automatic invocation.** This command never calls MCP tools. It tells you what's available and what might apply. The actual invocation happens via the host runtime's normal tool-use flow (Claude Code's tool calls, etc.) when the executor agent decides to use a recommended tool.

</caveats>

<runtime_compatibility>

| Runtime | list | recommend | cache |
|---------|------|-----------|-------|
| Claude Code | Full | Full | Full (host-populated) |
| OpenCode | Stub (empty cache returns gracefully) | Stub | CLI write works |
| Gemini CLI | Stub | Stub | CLI write works |
| Codex CLI | Stub | Stub | CLI write works |
| Copilot CLI | Stub | Stub | CLI write works |

On non-Claude runtimes, the aggregator and recommendation logic still work — they just report zero tools until something populates the cache.

</runtime_compatibility>

<future_scope>

Explicitly deferred from v3.3 (documented in ADR-0023 / Spec B v2 notes):

1. **Auto-inject recommended tools into planner context** — requires a stable MCP schema contract and a plan-template extension. Candidate for v3.5.
2. **Auto-invoke MCP tools from executor agent** — requires permission-gating and per-tool safety review. Candidate for v3.5+.
3. **Cross-runtime tool discovery** — generic MCP-like protocol for non-Claude runtimes. No timeline; needs ecosystem signal.

Until those land, this command is the minimum viable integration: you see what's there, you get suggestions, you decide manually.

</future_scope>
