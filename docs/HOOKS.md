# PAN Hook System

PAN ships a small set of built-in Claude Code hooks that enhance the development experience — the ones in the table below, which is the whole set (`ls hooks/*.js`). Hooks are JavaScript files that execute in response to Claude Code lifecycle events.

## Built-in Hooks

| Hook | Event Type | Purpose |
|------|-----------|---------|
| `pan-statusline.js` | `statusLine` | Displays context window usage in the status bar and writes metrics to a bridge file |
| `pan-context-monitor.js` | `PostToolUse` | Reads the bridge file and injects warnings into agent context when usage is high |
| `pan-check-update.js` | `SessionStart` | Checks for PAN updates in the background, caches result |
| `pan-cost-logger.js` (v3.4+) | `SubagentStop` | Appends per-spawn cost records to `.planning/metrics/tokens.jsonl` — consumed by `/pan:cost` |
| `pan-trace-logger.js` (v3.5+) | `SubagentStop` | Appends decision/error/redundancy events to `.planning/optimization/traces/<session>/trace.jsonl` — consumed by `/pan:learn` and `/pan:optimize`. Auto-creates a day-scoped session if no explicit `optimize trace init` is active. |
| `pan-stop-guard.js` (v3.23+) | `Stop` | Blocks a session stop **once** when the auto-advance chain dropped at a phase boundary — autonomy armed on disk (`workflow.auto_advance` or `mode: yolo`), `state.md` "Ready to plan", roadmap phases unbuilt — and tells the agent to spawn the next phase (P-1809/P-1810). |

### pan-statusline.js

**Event:** `statusLine` (runs continuously to update the Claude Code status bar)

**What it does:**
1. Reads the session's context window metrics from Claude Code's environment
2. Formats a status line showing usage percentage
3. Writes metrics to a bridge file at `<os-tmpdir>/pan-hooks-<uid>/claude-ctx-{session_id}.json` — a per-user `0700` subdirectory of the OS temp dir (`os.tmpdir()`), not literally `/tmp` on non-POSIX hosts such as Windows

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

> Note: `used_pct` is rescaled so 80% real usage displays as 100% — it will not equal `100 − remaining_percentage`.

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
1. No-ops unless the directory is a PAN project (a `.planning/` tree, or a local install marker under a runtime config dir) — a globally-installed hook fires in every repo the user opens and must not create `.planning/` artifacts in unrelated ones
2. Parses the SubagentStop event payload on stdin and reads whichever of these the host supplies: `agent_type` / `subagent_type`, `session_id`, `transcript_path`, `cwd`, `usage.*`, `model`, `phase`, `command`, `exit_code`. Only the first few are reliably present — real payloads observed by PAN carried no `model` or `phase`, and `usage` is absent entirely in headless mode (see the transcript fallback below); the hook backfills `command`/`phase` from the active trace session and derives `model`/`tier` from the transcript
3. Attributes tokens from **this event's slice** of the transcript (the records past a per-transcript cursor), not the whole transcript — see the transcript fallback below
4. Appends a structured record to `.planning/metrics/tokens.jsonl` with `source: "hook"` to distinguish hook-sourced records from caller-appended ones, unless a [duplicate guard](#duplicate-and-re-fire-guards) drops it
5. Silent on any error — never blocks the agent loop

**Record shape** — a real row, dumped by piping a `SubagentStop` payload into the hook against a two-record transcript fixture:
```json
{
  "v": 3,
  "ts": "2026-08-06T10:21:22.465Z",
  "agent": "pan-executor",
  "command": null,
  "model": "claude-opus-4-7",
  "tier": "reasoning",
  "input_tokens": 5120,
  "output_tokens": 240,
  "cache_read_tokens": 8000,
  "cache_write_tokens": 500,
  "cost_usd": null,
  "duration_ms": 6789,
  "phase": "07",
  "session": "abc-123",
  "source": "hook",
  "token_source": "transcript",
  "clamped": false,
  "event_sig": "15235bf7d229360296873bf0fadeb5f3f79703d4"
}
```

Notes on the fields that are not self-evident:

- **`v`** — ledger row schema version, a literal in each hook (`SCHEMA_V`). Rows written before it existed read as v1. Readers in `pan-wizard-core` take a row field by field rather than switching on the version, so added fields are additive: a mixed-shape ledger aggregates as one.
- **`tier`** — derived from `model` (reasoning / mid / fast), `null` for a model the hook can't classify, so `/pan:cost`'s by-tier view and the HUD tier panel are not blind on the hook path.
- **`duration_ms`** — the span of this event's transcript slice, first record timestamp to last. `null` when either bound is missing, never a fabricated `0`.
- **`token_source`** — `"transcript"` when the counts came from the transcript slice, `"usage-fallback"` when there was no `transcript_path` and the payload's own `usage` was used instead.
- **`clamped`** — `true` when the plausibility guard dropped a value to `0` on the fallback path, so a guarded zero is distinguishable from a genuine zero-token run.
- **`event_sig`** — a SHA-1 of the SubagentStop payload as delivered on stdin: this spawn's identity. A dual-registration re-fire is the same bytes and so carries the same signature; a sibling whose payload differs in any field carries a different one. It is what lets the hook count two parallel siblings as two spawns while still suppressing a re-fire of one of them. `null` if the payload could not be serialized. [Duplicate and re-fire guards](#duplicate-and-re-fire-guards) below describes how it is used.

**Integration:** records flow into the existing `cost.cjs` aggregator; they appear in `/pan:cost report` without additional configuration. The `source: "hook"` field lets the aggregator distinguish automatic captures from `pan-tools cost append` caller-driven records. During a `/pan:army` campaign every squad agent fires `SubagentStop`, so this same per-spawn stream is what the `/pan:hud` dashboard aggregates into its per-squad telemetry — no army-specific instrumentation exists; the dashboard just reads `tokens.jsonl`.

**P-1805 transcript fallback (v3.7.8+):** Claude Code in **headless `claude -p` mode** does NOT include `data.usage` in the SubagentStop payload — it only ships `transcript_path`. When `data.usage` is missing/empty, the hook calls `readUsageFromTranscript(transcriptPath, sessionId)` which parses the JSONL transcript line-by-line, filters entries to the subagent's `session_id`, and sums `usage` fields across all assistant messages. Falls back to zeros silently if the transcript is unreadable. Interactive Claude Code path (where `data.usage` is populated) is unchanged. Since 2026-06 the same transcript pass also captures the assistant **model id** (`message.model`, last-seen wins) whenever the payload lacks one — `resolveRate()` prefix-matches versioned ids onto rate-table families so `/pan:cost` can price hook records. This was surfaced by the wookie autonomous build where every `tokens.jsonl` record showed zero tokens — per-agent cost attribution is now restored.

**Runtime support:** Claude Code and Gemini register it via settings.json `SubagentStop` (hosts that don't fire the event treat it as a no-op). Since 2026-06: Codex registers it in `.codex/hooks.json` (Claude-compatible `SubagentStop`) and Copilot CLI in `.github/hooks/pan.json` (`subagentStop`). OpenCode has no hook system.

### pan-trace-logger.js (v3.5+)

**Event:** `SubagentStop` (runs alongside pan-cost-logger when a Task-spawned sub-agent finishes)

**What it does:**
1. No-ops unless the directory is a PAN project — same gate as the cost logger, for the same reason
2. Parses the SubagentStop event payload on stdin, reading the same fields with the same caveats, and attributes tokens from this event's transcript slice (it keeps its **own** cursor — the cost logger fires on the same event and the two must not consume each other's slice)
3. Calls `ensureSessionId()` — creates a day-scoped `sess_auto_YYYYMMDD` trace session if none active, so tracing is always-on with zero setup. A stale day-scoped auto-session is finalized and rolled over; an explicit session stays sticky
4. Builds these event types:
   - `decision:agent_completion` — per-agent record with input/output/cache tokens, agent name, phase
   - `redundancy:uncached_heavy_run` — fired when output > 3000 tokens with zero cache hits (signals repeated research the optimizer should flag)
5. Appends events to `.planning/optimization/traces/<session>/trace.jsonl`, unless a [duplicate guard](#duplicate-and-re-fire-guards) drops the batch
6. Silent on error — never blocks the agent loop

**Record shape** — a real completion event, from the same fixture run as the cost row above (the two hooks fire on one event, so the `event_sig` matches):
```json
{
  "v": 3,
  "ts": "2026-08-06T10:21:22.554Z",
  "session": "sess_auto_20260806",
  "agent": "pan-executor",
  "phase": "07",
  "type": "decision",
  "category": "agent_completion",
  "description": "pan-executor completed",
  "context": {
    "model": "claude-opus-4-7",
    "command": null,
    "input_tokens": 5120,
    "output_tokens": 240,
    "cache_read_tokens": 8000,
    "total_tokens": 5360,
    "duration_ms": 6789,
    "exit_code": 0,
    "token_source": "transcript",
    "clamped": false,
    "event_sig": "15235bf7d229360296873bf0fadeb5f3f79703d4"
  },
  "impact": "trivial",
  "correction": null,
  "tokens_wasted": null
}
```

`v`, `duration_ms`, `token_source`, `clamped`, and `event_sig` mean the same as on the cost row (see the field notes there); the trace event nests them under `context` and adds `total_tokens` (input + output). The `redundancy:uncached_heavy_run` event in the same batch carries the same `v`/`ts`/`session`/`agent`/`phase` envelope with a smaller `context` (`output_tokens`, `cache_read_tokens`) and `tokens_wasted` set.

**Integration:** events flow into the existing `optimize.cjs` analyzer; they're picked up by `/pan:learn` (single-session analysis) and `/pan:optimize` (cumulative reports + auto-apply memory entries). The circular optimization loop (trace → learn → optimize apply → next run smarter → repeat) makes PAN self-learning across cycles.

**P-1805 transcript fallback (v3.7.8+):** Same fix as `pan-cost-logger.js` — when `data.usage` is missing/empty (Claude Code headless mode), `readUsageFromTranscript()` parses the JSONL transcript at `data.transcript_path` and sums `usage` from assistant messages whose `session_id` matches the subagent. Trace events now carry real token counts during autonomous runs instead of zeros. Wall-clock timing fallback still kicks in only when *both* `data.usage` AND the transcript are unavailable.

**Runtime support:** same surface as the cost logger — Claude/Gemini via settings.json, Codex via `.codex/hooks.json`, Copilot via `.github/hooks/pan.json` (all on their SubagentStop-equivalent events; no-op on hosts that don't fire it). OpenCode has no hook system.

### Duplicate and re-fire guards

One `SubagentStop` can reach the hooks more than once. A project with **both** a global and a local PAN install registers two commands for the event (different paths, so the host runs both) and the two processes share one cursor file — the field's source of ~57% duplicate rows in 2026-07. At the same time PAN's own wave topology spawns **parallel siblings** that share the session transcript, so a legitimate second spawn can look a lot like a re-fire. Both hooks resolve this the same way, with two layers:

1. **The per-transcript seen-event marker** (in the cursor file, bounded by `MAX_SEEN_SIGS` per transcript and `MAX_SEEN_TRANSCRIPTS` overall, FIFO on both axes). An event that consumed no new transcript records is treated as a re-fire only when its `event_sig` was already seen for that transcript; otherwise it is a sibling or a first fire and gets recorded with zero tokens.
2. **The adjacent-row duplicate guard.** The new row / completion is compared against the **immediately preceding** ledger row (for the trace logger, the file's last `agent_completion`) across every field but `ts` — `event_sig` included. A true re-fire is the same bytes on stdin, so it produces the same row and matches; two siblings the payload can tell apart differ in their signature and both survive.

**What this guarantees, and what it does not.** A re-fire is suppressed while it is still *recognizable*: its signature sits in the marker window, or the row it duplicates sits immediately before it. Nothing further. A re-fire that arrives after its signature has been evicted from the marker window, and that is no longer adjacent to the row it duplicates, **is recorded** — a phantom row. The no-`transcript_path` path is a wider residual still: it has no transcript to key the marker layer by, so an interleaved dual registration there (A, B, A′, B′) leaves both re-fires out of adjacency reach and admits both. Each hook's suite pins the residual rather than asserting it away.

**Why the guard is not wider than that.** It was, briefly: the second layer scanned a tail of recent rows for an identical one and additionally treated a repeated `event_sig` as a re-fire whenever the candidate carried no tokens and no measured duration. Both halves delete real spawns. On the shared session transcript that PAN's own wave topology produces, sequential subagents of one type deliver byte-identical payloads — hence one signature — and identical rows whenever their slices happen to match; a run of five genuine spawns collapsed to two, and when those slices carried real usage the tokens went with them. The invariant the second condition rested on ("an event that consumed a real slice never looks contentless") is false as well: a slice of records carrying neither `usage` nor `timestamp` yields zeros and a `null` duration. Deleting real cost data is strictly worse than a phantom row, so the guard stays adjacent-only and the residual above is documented instead of engineered away. Each hook's suite carries the reproduction as a floor (`grep -n 'no genuine spawn' tests/cost-logger-hook.test.cjs tests/trace-logger.test.cjs`).

**One conditional worth knowing.** Two *concurrent same-type* siblings are admitted as two spawns only if the host puts some per-invocation field on the payload. PAN has confirmed that `agent_type`/`subagent_type` varies between siblings of different type, and that `session_id` and the transcript path are shared with the parent — but no field is confirmed to vary between two same-type siblings on any host. Where none does, their payloads are the same bytes, a new spawn and a re-fire are indistinguishable, and the second is suppressed. See the `eventSignature` comment in either hook for the full evidence trail.

### pan-stop-guard.js (v3.23+, P-1809)

**Event:** `Stop` (runs when the main session tries to end its turn)

**What it does:** catches the auto-advance boundary drop mechanically. Field runs showed autonomous chains ending between transition.md's state update and the next-phase Task spawn at a low, nondeterministic rate — a failure prose instructions can reduce but not eliminate. When the session stops, this hook blocks **once**, with a reason instructing the agent to spawn the next phase, if and only if the disk shows the exact drop fingerprint:

1. `.planning/config.json` shows an autonomy signal: `workflow.auto_advance: true` **or** `mode: "yolo"` (P-1810). The guard is **inert** in every other project. The chain's trigger is flag OR config OR yolo; a Stop hook cannot see the `--auto` flag, so every entry hop (discuss/plan/exec-phase) persists the flag into config — arming on config alone left the guard dark on a real flag-driven drop (PanLoop finding 7). transition.md's Route B clears `auto_advance` at the milestone boundary, which disarms that half at the true end of a chain.
2. `.planning/state.md` carries the post-transition status ("Ready to plan" / "ready to plan Phase N"). A stop after failed verification or gaps does **not** carry it — those stops are legitimate and pass through.
3. `.planning/roadmap.md` still has unticked `- [ ] **Phase N:` checklist lines.

**Loop safety:** the host sets `stop_hook_active` on stop attempts that follow a stop-hook block, and the guard always allows those. It fires at most once per stop chain — a user who genuinely wants to stop is delayed by exactly one continuation, never trapped. To stop an armed chain deliberately, run `pan-tools config-set workflow.auto_advance false` first (the block reason says exactly this).

**Escape hatch:** `workflow.stop_guard: false` in `.planning/config.json` disables the guard without disarming auto-advance.

**Failure posture:** fail-open everywhere — missing `.planning/`, unparseable config/state/roadmap, or malformed stdin all allow the stop silently. A missed catch costs a re-run; a wrong block traps a session, so the guard never blocks on uncertainty.

## Architecture

```
Statusline Hook (pan-statusline.js)
    | writes
    v
<os-tmpdir>/pan-hooks-<uid>/claude-ctx-{session_id}.json  (bridge file — not literally /tmp)
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

Hooks can return JSON on stdout. For `PostToolUse`, the payload is a nested envelope:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Warning: context usage at 72%"
  }
}
```

The `additionalContext` field (nested under `hookSpecificOutput`) injects text into the agent's conversation — this is the exact shape the context monitor emits to communicate warnings.

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
