# PAN Hook System

PAN includes 5 built-in Claude Code hooks that enhance the development experience. Hooks are JavaScript files that execute in response to Claude Code lifecycle events.

## Built-in Hooks

| Hook | Event Type | Purpose |
|------|-----------|---------|
| `pan-statusline.js` | `statusLine` | Displays context window usage in the status bar and writes metrics to a bridge file |
| `pan-context-monitor.js` | `PostToolUse` | Reads the bridge file and injects warnings into agent context when usage is high |
| `pan-check-update.js` | `SessionStart` | Checks for PAN updates in the background, caches result |
| `pan-cost-logger.js` (v3.4+) | `SubagentStop` | Appends per-spawn cost records to `.planning/metrics/tokens.jsonl` — consumed by `/pan:cost` |
| `pan-trace-logger.js` (v3.5+) | `SubagentStop` | Appends decision/error/redundancy events to `.planning/optimization/traces/<session>/trace.jsonl` — consumed by `/pan:learn` and `/pan:optimize`. Auto-creates a day-scoped session if no explicit `optimize trace init` is active. |

### pan-statusline.js

**Event:** `statusLine` (runs continuously to update the Claude Code status bar)

**What it does:**
1. Reads the session's context window metrics from Claude Code's environment
2. Formats a status line showing usage percentage
3. Writes metrics to a bridge file at `/tmp/claude-ctx-{session_id}.json`

The bridge file enables the context monitor to read metrics without coupling to the statusline's execution cycle.

**Bridge file format:**
```json
{
  "session_id": "abc123",
  "remaining_percentage": 28.5,
  "used_pct": 71,
  "timestamp": 1708200000
}
```

### pan-context-monitor.js

**Event:** `PostToolUse` (runs after every tool call)

**What it does:**
1. Reads the bridge file written by the statusline hook
2. Checks remaining context percentage against thresholds
3. If low, injects a warning as `additionalContext` that the agent sees

**Thresholds:**

| Level | Remaining | Agent behavior |
|-------|-----------|---------------|
| Normal | > 35% | No warning |
| WARNING | <= 35% | Wrap up current task, avoid starting new complex work |
| CRITICAL | <= 25% | Stop immediately, save state via `/pan:pause` |

**Debounce logic:**
- First warning fires immediately
- Subsequent warnings require 5 tool uses between them
- Severity escalation (WARNING → CRITICAL) bypasses debounce

**Safety:**
- Wrapped in try/catch — exits silently on error
- Never blocks tool execution
- Stale metrics (>60s old) are ignored
- Missing bridge files handled gracefully (subagents, fresh sessions)

### pan-check-update.js

**Event:** `SessionStart` (runs once per session at startup)

**What it does:**
1. Reads the installed PAN version from `VERSION` file (checks local first, then global)
2. Spawns a background process to query npm for the latest version
3. Caches the result to `~/.claude/cache/pan-update-check.json`
4. On subsequent runs, reads from cache to avoid repeated network calls

The update check runs once per session and doesn't block tool execution.

### pan-cost-logger.js (v3.4+)

**Event:** `SubagentStop` (runs when a Task-spawned sub-agent finishes)

**What it does:**
1. Parses the SubagentStop event payload on stdin
2. Extracts what Claude Code exposes: `agent_type`, `session_id`, `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`, `model`, `phase`
3. Appends a structured record to `.planning/metrics/tokens.jsonl` with `source: "hook"` to distinguish hook-sourced records from caller-appended ones
4. Silent on any error — never blocks the agent loop

**Record shape:**
```json
{
  "ts": "2026-04-19T12:34:56.789Z",
  "agent": "pan-executor",
  "command": null,
  "model": "claude-opus-4-7",
  "tier": null,
  "input_tokens": 5000,
  "output_tokens": 200,
  "cache_read_tokens": 8000,
  "cache_write_tokens": 500,
  "cost_usd": null,
  "phase": "07",
  "session": "abc-123",
  "source": "hook"
}
```

**Integration:** records flow into the existing `cost.cjs` aggregator; they appear in `/pan:cost report` without additional configuration. The `source: "hook"` field lets the aggregator distinguish automatic captures from `pan-tools cost append` caller-driven records. During a `/pan:army` campaign every squad agent fires `SubagentStop`, so this same per-spawn stream is what the `/pan:hud` dashboard aggregates into its per-squad telemetry — no army-specific instrumentation exists; the dashboard just reads `tokens.jsonl`.

**P-1805 transcript fallback (v3.7.8+):** Claude Code in **headless `claude -p` mode** does NOT include `data.usage` in the SubagentStop payload — it only ships `transcript_path`. When `data.usage` is missing/empty, the hook calls `readUsageFromTranscript(transcriptPath, sessionId)` which parses the JSONL transcript line-by-line, filters entries to the subagent's `session_id`, and sums `usage` fields across all assistant messages. Falls back to zeros silently if the transcript is unreadable. Interactive Claude Code path (where `data.usage` is populated) is unchanged. Since 2026-06 the same transcript pass also captures the assistant **model id** (`message.model`, last-seen wins) whenever the payload lacks one — `resolveRate()` prefix-matches versioned ids onto rate-table families so `/pan:cost` can price hook records. This was surfaced by the wookie autonomous build where every `tokens.jsonl` record showed zero tokens — per-agent cost attribution is now restored.

**Runtime support:** Claude Code and Gemini register it via settings.json `SubagentStop` (hosts that don't fire the event treat it as a no-op). Since 2026-06: Codex registers it in `.codex/hooks.json` (Claude-compatible `SubagentStop`) and Copilot CLI in `.github/hooks/pan.json` (`subagentStop`). OpenCode has no hook system.

### pan-trace-logger.js (v3.5+)

**Event:** `SubagentStop` (runs alongside pan-cost-logger when a Task-spawned sub-agent finishes)

**What it does:**
1. Parses the SubagentStop event payload on stdin
2. Calls `ensureSessionId()` — creates a day-scoped `sess_auto_YYYYMMDD` trace session if none active, so tracing is always-on with zero setup
3. Builds two event types:
   - `decision:agent_completion` — per-agent record with input/output/cache tokens, agent name, phase
   - `redundancy:uncached_heavy_run` — fired when output > 3000 tokens with zero cache hits (signals repeated research the optimizer should flag)
4. Appends events to `.planning/optimization/traces/<session>/trace.jsonl`
5. Silent on error — never blocks the agent loop

**Record shape:**
```json
{
  "ts": "2026-04-22T07:56:14.123Z",
  "session": "sess_20260422T075614",
  "agent": "pan-executor",
  "phase": "03",
  "type": "decision",
  "category": "agent_completion",
  "description": "pan-executor completed",
  "context": { "input_tokens": 5000, "output_tokens": 200, "cache_read_tokens": 8000 },
  "impact": "trivial"
}
```

**Integration:** events flow into the existing `optimize.cjs` analyzer; they're picked up by `/pan:learn` (single-session analysis) and `/pan:optimize` (cumulative reports + auto-apply memory entries). The circular optimization loop (trace → learn → optimize apply → next run smarter → repeat) makes PAN self-learning across cycles.

**P-1805 transcript fallback (v3.7.8+):** Same fix as `pan-cost-logger.js` — when `data.usage` is missing/empty (Claude Code headless mode), `readUsageFromTranscript()` parses the JSONL transcript at `data.transcript_path` and sums `usage` from assistant messages whose `session_id` matches the subagent. Trace events now carry real token counts during autonomous runs instead of zeros. Wall-clock timing fallback still kicks in only when *both* `data.usage` AND the transcript are unavailable.

**Runtime support:** same surface as the cost logger — Claude/Gemini via settings.json, Codex via `.codex/hooks.json`, Copilot via `.github/hooks/pan.json` (all on their SubagentStop-equivalent events; no-op on hosts that don't fire it). OpenCode has no hook system.

## Architecture

```
Statusline Hook (pan-statusline.js)
    | writes
    v
/tmp/claude-ctx-{session_id}.json     (bridge file)
    ^ reads
    |
Context Monitor (pan-context-monitor.js, PostToolUse)
    | injects
    v
additionalContext → Agent sees warning → /pan:pause

SessionStart
    |
    v
Check Update (pan-check-update.js)
    | writes cache
    v
~/.claude/cache/pan-update-check.json

Sub-agent finishes
    |
    +--> Cost Logger (pan-cost-logger.js, SubagentStop)
    |        | appends record
    |        v
    |    .planning/metrics/tokens.jsonl ← consumed by /pan:cost
    |
    +--> Trace Logger (pan-trace-logger.js, SubagentStop, v3.5)
             | appends decision/redundancy events
             v
         .planning/optimization/traces/<session>/trace.jsonl ← consumed by /pan:learn, /pan:optimize
```

The hooks communicate through files rather than being directly coupled:
- Either hook can fail independently without breaking the others
- Bridge and log files are inspectable for debugging
- No shared memory or IPC needed

## Installation

Hooks are automatically installed and registered during `npx pan-wizard`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/hooks/pan-statusline.js"
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/pan-check-update.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/pan-context-monitor.js"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/pan-cost-logger.js"
          },
          {
            "type": "command",
            "command": "node ~/.claude/hooks/pan-trace-logger.js"
          }
        ]
      }
    ]
  }
}
```

## Build Pipeline

Hook sources live alongside the dist directory:

```
hooks/
  pan-statusline.js         # Source
  pan-context-monitor.js    # Source
  pan-check-update.js       # Source
  pan-cost-logger.js        # Source (v3.4+)
  pan-trace-logger.js       # Source (v3.5+)
  dist/                     # Copied output (installed to user's machine)
    pan-statusline.js
    pan-context-monitor.js
    pan-check-update.js
    pan-cost-logger.js
    pan-trace-logger.js
```

Build command:
```bash
npm run build:hooks    # Copies hooks from hooks/ to hooks/dist/
```

The build script (`scripts/build-hooks.js`) simply copies files — no bundling or transpilation needed since hooks are pure Node.js with zero dependencies.

## Hook Runtime Support

| Runtime | Hooks supported | Notes |
|---------|----------------|-------|
| Claude Code | Yes | Full support via settings.json hook registration |
| Copilot CLI | Yes | `.github/hooks/pan.json` (version 1 schema: sessionStart, postToolUse, subagentStop) |
| OpenCode | No | No hook system available |
| Gemini CLI | Yes | Same settings.json format as Claude Code (SessionStart, PostToolUse) |
| Codex | Yes | `.codex/hooks.json` since 2026-06 (Claude-compatible PascalCase events; loads once the project is trusted) |

Hooks are supported by Claude Code, Gemini CLI, Codex, and Copilot CLI. OpenCode has no hook system.

## Developing Custom Hooks

### Hook Input

Hooks receive JSON on stdin with context about the event:

**PostToolUse:**
```json
{
  "session_id": "abc123",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" }
}
```

### Hook Output

Hooks can return JSON on stdout:

```json
{
  "additionalContext": "Warning: context usage at 72%"
}
```

The `additionalContext` field injects text into the agent's conversation — this is how the context monitor communicates warnings.

### Worked Example: Phase Completion Logger

A simple PostToolUse hook that detects phase completions and logs them.

**1. Create the hook** (`hooks/my-phase-logger.js`):

```javascript
#!/usr/bin/env node
'use strict';

try {
  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    const data = JSON.parse(input);

    // Only care about Bash tool calls that look like phase-complete
    if (data.tool_name !== 'Bash') return;
    const cmd = (data.tool_input && data.tool_input.command) || '';
    if (!cmd.includes('phase complete')) return;

    // Log to a file (hooks can't write to the agent's output directly)
    const fs = require('fs');
    const timestamp = new Date().toISOString();
    fs.appendFileSync('/tmp/pan-phase-log.txt',
      `${timestamp} | Phase completed | ${cmd}\n`
    );

    // Optionally inject context back to the agent
    const result = { additionalContext: 'Phase completion logged.' };
    process.stdout.write(JSON.stringify(result));
  });
} catch (e) {
  // Silent exit — never break the agent
  process.exit(0);
}
```

**2. Test locally:**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"phase complete 3"}}' | node hooks/my-phase-logger.js
# Should output: {"additionalContext":"Phase completion logged."}
```

**3. Register in settings.json:**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/my-phase-logger.js"
          }
        ]
      }
    ]
  }
}
```

**4. Copy to install location:**

```bash
cp hooks/my-phase-logger.js ~/.claude/hooks/
```

**Debugging tips:**
- Use `process.stderr.write()` for debug logging (stderr doesn't affect hook output)
- Check `/tmp/` for bridge files if your hook writes there
- Test with `echo '{}' | node your-hook.js` to verify it handles empty input gracefully

### Best Practices

1. **Always wrap in try/catch** — A broken hook should never break the agent's workflow
2. **Exit quickly** — Hooks run synchronously before/after tool calls. Keep execution fast.
3. **No side effects on failure** — If your hook can't read its data, exit silently
4. **Use the bridge file pattern** — For hooks that need to share data, write to `/tmp/` and read from there
5. **Test independently** — Hooks are standalone Node.js scripts. Test with `echo '{}' | node your-hook.js`
