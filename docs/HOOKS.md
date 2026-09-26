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
| `pan-stop-guard.js` (v3.24+) | `Stop` (Gemini CLI: `AfterAgent`; Copilot CLI: `agentStop`) | Blocks a session stop **once** when the auto-advance chain dropped at a phase boundary — autonomy armed on disk (`workflow.auto_advance` or `mode: yolo`), no failure/gaps/blocker recorded in `state.md`, roadmap phases unbuilt — and tells the agent to continue the chain (P-1809/P-1810/P-1812). |
| `pan-state-reinject.js` | `SessionStart`, matcher `compact` (Claude Code, Codex) | After a context compaction, hands the model the phase, plan, status and stop point from `.planning/state.md` as `additionalContext`, so a summarised session resumes the work in flight instead of re-planning it. Silent without a current phase and an unbuilt roadmap phase; never writes a file. |

### pan-statusline.js

**Event:** `statusLine` (runs continuously to update the Claude Code status bar; Copilot CLI's experimental statusline too. Gemini CLI has no statusline command, so PAN writes none there.)

**What it does:**
1. Reads the session's context window metrics from the JSON payload Claude Code pipes to stdin
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

**Event:** `SessionStart` (registered without a matcher, so it runs at every session start the host reports — including the restart after a compaction — not only at startup)

**What it does:**
1. Reads the installed PAN version from a `VERSION` file: the project's install first, then the `pan-wizard-core/VERSION` beside the hook's own copy (how a plugin install finds its version), then the global install
2. Spawns a background process to query npm for the latest version
3. Caches the result to `~/.claude/cache/pan-update-check.json` (on other runtimes the installer swaps in that runtime's config directory: `~/.gemini`, `~/.codex`, `~/.copilot`)
4. The statusline reads the cached result for its update badge (on Gemini CLI and Codex, which run no PAN statusline, nothing displays it); the hook itself re-queries npm on every SessionStart, in a detached child, so the session is never blocked

The update check runs at each session start and doesn't block tool execution.

### pan-cost-logger.js (v3.4+)

**Event:** `SubagentStop` (runs when a Task-spawned sub-agent finishes)

**What it does:**
1. No-ops unless the project already has a planning tree (`.planning/`, or the tree `PAN_PLANNING_DIR` / `PAN_TRACK` selects). A local install marker alone does not count: a globally-installed hook fires in every repo the user opens, and telemetry fills a planning tree but never creates one
2. Parses the SubagentStop event payload on stdin and reads whichever of these the host supplies: `agent_type` / `subagent_type`, `agent_id`, `session_id`, `transcript_path`, `agent_transcript_path`, `cwd`, `usage.*`, `model`, `phase`, `command` (the trace logger also reads `exit_code`). Only the first few are reliably present — real payloads observed by PAN carried no `model` or `phase`, and `usage` is absent entirely in headless mode (see the transcript fallback below); the hook backfills `command`/`phase` from the active trace session (and, when no trace session is running, `phase` from state.md's current phase and `command` from the latest `/pan:*` or `/pan-*` command turn in the parent transcript) and derives `model`/`tier` from the transcript
3. Attributes tokens from the **subagent's own transcript** when the host names one — Claude Code's `transcript_path` is the *parent* session's file, and the subagent's conversation sits beside it as `<parent dir>/<session_id>/subagents/agent-<agent_id>.jsonl` — or, for a subagent the Workflow tool spawned (the native `/pan-*` scripts), one level down under its run: `subagents/workflows/<wf_id>/agent-<agent_id>.jsonl` — so `agent_id` (a documented common input field, present when the hook fires inside a subagent) resolves it; an explicit `agent_transcript_path` wins. Without an id it falls back to **this event's slice** of the parent transcript (the records past a per-transcript cursor) — see the per-agent transcripts note below; an id whose file is absent consumes nothing and records an unmeasured spawn (`token_source: "agent-transcript-missing"`, zeros). Within a slice, one API turn counts once: Claude Code writes a turn as one record per content block, each repeating the turn's `message.id` with a usage snapshot, and the last snapshot wins. Either slice's token axes are plausibility-clamped — above 500M cache-read or 10M output (the ceilings `aggregate()` quarantines on) or 20M input / 100M cache-write (hook-only sanity limits) a value is a session's cumulative usage, dropped to `0` with `clamped: true`. The span is written as measured; the reader quarantines a slice that ran longer than six hours
4. Appends a structured record to `.planning/metrics/tokens.jsonl` with `source: "hook"` to distinguish hook-sourced records from caller-appended ones, unless a [duplicate guard](#duplicate-and-re-fire-guards) drops it
5. Silent on any error — never blocks the agent loop

**Record shape** — the row as the hook writes it (values illustrative; the `v: 3` predecessor was a dump against a two-record transcript fixture):
```json
{
  "v": 4,
  "ts": "2026-08-06T10:21:22.465Z",
  "agent": "pan-executor",
  "agent_id": "a15f28b4fab5c68d1",
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
  "token_source": "agent-transcript",
  "clamped": false,
  "event_sig": "15235bf7d229360296873bf0fadeb5f3f79703d4"
}
```

Notes on the fields that are not self-evident:

- **`v`** — ledger row schema version, a literal in each hook (`SCHEMA_V`). Rows written before it existed carry no `v`; readers never inspect the field. Readers in `pan-wizard-core` take a row field by field rather than switching on the version, so added fields are additive: a mixed-shape ledger aggregates as one. `v: 4` added `agent_id` and the `agent-transcript` token source.
- **`agent_id`** — the host's per-spawn id, `null` where the host supplies none. It is what makes the agent's own transcript addressable, and it tells two same-type siblings apart without hashing the payload.
- **`tier`** — derived from `model` (reasoning / mid / fast), `null` for a model the hook can't classify, so `/pan:cost`'s by-tier view and the HUD tier panel are not blind on the hook path.
- **`cache_write_1h_tokens`** / **`cache_write_5m_tokens`** — the split of `cache_write_tokens` by cache lifetime (one-hour writes bill at a higher rate than five-minute ones), read from the `usage.cache_creation` block of the transcript (or of the payload's `usage` on the fallback path). Present only when the source carried that block; dropped when the write total was clamped.
- **`duration_ms`** — the span of this event's transcript slice, first record timestamp to last. `null` when either bound is missing, never a fabricated `0`.
- **`token_source`** — `"agent-transcript"` when the counts came from the subagent's own transcript, `"agent-transcript-missing"` when the host named an agent whose file was not there (an unmeasured spawn: zeros, excluded from `calls` by the reader), `"transcript"` when they came from a slice of the parent session transcript (the fallback when the host names no agent), `"usage-fallback"` when there was no transcript at all and the payload's own `usage` was used instead.
- **`clamped`** — `true` when a plausibility guard dropped a token value to `0`, on any transcript or fallback path, so a guarded zero is distinguishable from a genuine zero-token run. Until v3.29 only the `usage-fallback` path had a guard, which is why every oversum row in the field carried `clamped: false`. The span is never clamped: `duration_ms` is the measured first-to-last record span, and `cost.cjs` quarantines a parent-slice row whose span exceeds six hours (a row sliced from the agent's own transcript is exempt — it cannot carry anyone else's usage).
- **`event_sig`** — a SHA-1 of the SubagentStop payload as delivered on stdin: this spawn's identity. A dual-registration re-fire is the same bytes and so carries the same signature; a sibling whose payload differs in any field carries a different one. It is what lets the hook count two parallel siblings as two spawns while still suppressing a re-fire of one of them. `null` if the payload could not be serialized. [Duplicate and re-fire guards](#duplicate-and-re-fire-guards) below describes how it is used.

**Integration:** records flow into the existing `cost.cjs` aggregator; they appear in `/pan:cost report` without additional configuration. The `source: "hook"` field lets the aggregator distinguish automatic captures from `pan-tools cost append` caller-driven records. During a `/pan:army` campaign every squad agent fires `SubagentStop`, so this same per-spawn stream is what the `/pan:hud` dashboard aggregates into its per-squad telemetry — no army-specific instrumentation exists; the dashboard just reads `tokens.jsonl`.

**P-1805 transcript fallback (v3.7.8+):** Claude Code in **headless `claude -p` mode** does NOT include `data.usage` in the SubagentStop payload — it only ships `transcript_path`. When `data.usage` is missing/empty, the hook calls `readUsageFromTranscript(transcriptPath, sessionId)` which parses the JSONL transcript line-by-line, filters entries to the payload's `session_id` (the parent session's, so it does not isolate the subagent), and sums `usage` fields across all assistant messages. Falls back to zeros silently if the transcript is unreadable. Since then the order has reversed: `data.usage` proved to be a cumulative session counter, so the transcript is read whenever the payload names one, and `usage` is only the fallback when it names none (`token_source` `usage-fallback`). Since 2026-06 the same transcript pass also captures the assistant **model id** (`message.model`, last-seen wins) whenever the payload lacks one — `resolveRate()` prefix-matches versioned ids onto rate-table families so `/pan:cost` can price hook records. This was surfaced by the wookie autonomous build where every `tokens.jsonl` record showed zero tokens — per-agent cost attribution is now restored.

**Per-agent transcripts (v3.29):** the transcript fallback above slices the file `transcript_path` names — and on `SubagentStop` that file is the **parent session's** transcript, shared by the main thread and every subagent. Slicing it per event attributed whatever the session had done since the previous stop to whichever subagent happened to stop next; the first stop on a long-lived session (cursor `0`, or a cursor a ledger quarantine had deleted) booked the session's entire history to one row — 7.5 billion cache-read tokens over a ten-day "duration" was observed in a field ledger — and siblings that stopped before the parent grew produced the complementary all-zero rows (63% of that ledger). Claude Code writes each subagent's own conversation beside the parent transcript as `<parent dir>/<session_id>/subagents/agent-<agent_id>.jsonl` (Workflow-tool subagents one level down, under `subagents/workflows/<wf_id>/`), whose first record carries the same `agentId` and `sessionId`; both hooks now derive that path from the payload's `agent_id` (or take an explicit `agent_transcript_path`) and slice *it*, keyed by its own cursor so a resumed agent is charged only its new lines. The parent-slice path remains for hosts that supply no id, now clamped like the fallback. One consequence stated plainly: the parent slice had also been the only place the **main thread's** usage entered the ledger; with per-agent attribution the ledger records subagent spawns and nothing else, which is what `/pan:cost` always claimed to count.

**Runtime support:** Claude Code registers it via settings.json `SubagentStop`. Gemini CLI does not: it has no subagent-completion event, and it hands every hook the main session's transcript rather than the subagent's, so there is nothing to measure. (From v3.4 until `2026-09-23` PAN registered it there under `SubagentStop`, a key Gemini skips with an "Invalid hook event name" warning — it never ran.) Since 2026-06: Codex registers it in `.codex/hooks.json` (Claude-compatible `SubagentStop`) and Copilot CLI in `.github/hooks/pan.json` (`subagentStop`). PAN registers no hooks on OpenCode.

### pan-trace-logger.js (v3.5+)

**Event:** `SubagentStop` (runs alongside pan-cost-logger when a Task-spawned sub-agent finishes)

**What it does:**
1. No-ops unless the directory is a PAN project — same gate as the cost logger, for the same reason
2. Parses the SubagentStop event payload on stdin, reading the same fields with the same caveats, and attributes tokens from this event's transcript slice (it keeps its **own** cursor — the cost logger fires on the same event and the two must not consume each other's slice)
3. Calls `ensureSessionId()` — creates a day-scoped `sess_auto_YYYYMMDD` trace session if none active, so tracing is always-on with zero setup. A day-scoped auto-session from an earlier day is finalized and rolled over; an explicit session stays sticky while in use but is rolled over the same way once it has ended or gone quiet for a day
4. Builds these event types:
   - `decision:agent_completion` — per-agent record with input/output/cache tokens, agent name, phase
   - `redundancy:uncached_heavy_run` — fired when output > 3000 tokens with zero cache hits (signals repeated research the optimizer should flag)
5. Appends events to `.planning/optimization/traces/<session>/trace.jsonl`, unless a [duplicate guard](#duplicate-and-re-fire-guards) drops the batch
6. Silent on error — never blocks the agent loop

**Record shape** — the completion event as the hook writes it, for the same spawn as the cost row above (the two hooks fire on one event, so the `event_sig` matches; values illustrative):
```json
{
  "v": 4,
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
    "agent_id": "a15f28b4fab5c68d1",
    "input_tokens": 5120,
    "output_tokens": 240,
    "cache_read_tokens": 8000,
    "total_tokens": 5360,
    "duration_ms": 6789,
    "exit_code": 0,
    "token_source": "agent-transcript",
    "clamped": false,
    "event_sig": "15235bf7d229360296873bf0fadeb5f3f79703d4"
  },
  "impact": "trivial",
  "correction": null,
  "tokens_wasted": null
}
```

`v`, `agent_id`, `duration_ms`, `token_source`, `clamped`, and `event_sig` mean the same as on the cost row (see the field notes there); the trace event nests them under `context` and adds `total_tokens` (input + output). The trace logger resolves the agent transcript, dedupes block records by `message.id` and clamps the token axes exactly as the cost logger does, with its own cursor; a `clamped` completion never fires the `uncached_heavy_run` heuristic, since a guard-produced zero is not a cache miss. The `redundancy:uncached_heavy_run` event in the same batch carries the same `v`/`ts`/`session`/`agent`/`phase` envelope with a smaller `context` (`output_tokens`, `cache_read_tokens`) and `tokens_wasted` set.

**Integration:** events flow into the existing `optimize.cjs` analyzer; they're picked up by `/pan:learn` (single-session analysis) and `/pan:optimize` (cumulative reports + auto-apply memory entries). The circular optimization loop (trace → learn → optimize apply → next run smarter → repeat) makes PAN self-learning across cycles.

**P-1805 transcript fallback (v3.7.8+):** Same fix as `pan-cost-logger.js`, with the same later reversal: the transcript is read whenever the payload names one and `data.usage` is only the fallback when it names none. `readUsageFromTranscript()` parses the JSONL transcript at `data.transcript_path` and sums `usage` from assistant messages whose `session_id` matches the payload's (the parent session's). Trace events now carry real token counts during autonomous runs instead of zeros. There is no timing fallback: when neither `data.usage` nor the transcript is available, `duration_ms` stays `null` rather than a measured or fabricated span.

**Runtime support:** same surface as the cost logger — Claude via settings.json, Codex via `.codex/hooks.json`, Copilot via `.github/hooks/pan.json` (all on their SubagentStop-equivalent events; no-op on hosts that don't fire it). Not registered on Gemini CLI, for the cost logger's reason, or on OpenCode.

### Duplicate and re-fire guards

One `SubagentStop` can reach the hooks more than once. A project with **both** a global and a local PAN install registers two commands for the event (different paths, so the host runs both) and the two processes share one cursor file — the field's source of ~57% duplicate rows in 2026-07. At the same time PAN's own wave topology spawns **parallel siblings** that share the session transcript, so a legitimate second spawn can look a lot like a re-fire. Both hooks resolve this the same way, with two layers:

1. **The per-transcript seen-event marker** (in the cursor file, bounded by `MAX_SEEN_SIGS` per transcript and `MAX_SEEN_TRANSCRIPTS` overall, FIFO on both axes). An event that consumed no new transcript records is treated as a re-fire only when its `event_sig` was already seen for that transcript; otherwise it is a sibling or a first fire and gets recorded with zero tokens.
2. **The adjacent-row duplicate guard.** The new row / completion is compared against the **immediately preceding** ledger row (for the trace logger, the file's last `agent_completion`) across every field but `ts` — `event_sig` included. A true re-fire is the same bytes on stdin, so it produces the same row and matches; two siblings the payload can tell apart differ in their signature and both survive.

**What this guarantees, and what it does not.** A re-fire is suppressed while it is still *recognizable*: its signature sits in the marker window, or the row it duplicates sits immediately before it. Nothing further. A re-fire that arrives after its signature has been evicted from the marker window, and that is no longer adjacent to the row it duplicates, **is recorded** — a phantom row. The no-`transcript_path` path is a wider residual still: it has no transcript to key the marker layer by, so an interleaved dual registration there (A, B, A′, B′) leaves both re-fires out of adjacency reach and admits both. Each hook's suite pins the residual rather than asserting it away.

**Why the guard is not wider than that.** It was, briefly: the second layer scanned a tail of recent rows for an identical one and additionally treated a repeated `event_sig` as a re-fire whenever the candidate carried no tokens and no measured duration. Both halves delete real spawns. On the shared session transcript that PAN's own wave topology produces, sequential subagents of one type deliver byte-identical payloads — hence one signature — and identical rows whenever their slices happen to match; a run of five genuine spawns collapsed to two, and when those slices carried real usage the tokens went with them. The invariant the second condition rested on ("an event that consumed a real slice never looks contentless") is false as well: a slice of records carrying neither `usage` nor `timestamp` yields zeros and a `null` duration. Deleting real cost data is strictly worse than a phantom row, so the guard stays adjacent-only and the residual above is documented instead of engineered away. Each hook's suite carries the reproduction as a floor (`grep -n 'no genuine spawn' tests/cost-logger-hook.test.cjs tests/trace-logger.test.cjs`).

**One conditional worth knowing.** Two *concurrent same-type* siblings are admitted as two spawns only if the host puts some per-invocation field on the payload. PAN has confirmed that `agent_type`/`subagent_type` varies between siblings of different type, and that `session_id` and the transcript path are shared with the parent — but no field is confirmed to vary between two same-type siblings on any host. Where none does, their payloads are the same bytes, a new spawn and a re-fire are indistinguishable, and the second is suppressed. See the `eventSignature` comment in either hook for the full evidence trail.

### pan-state-reinject.js (market-ideas M10)

**Runtime support:** Claude Code (`SessionStart` with the `compact` matcher, in `settings.json` and the Claude plugin's `hooks/hooks.json`) and Codex (the same, in `.codex/hooks.json`, synchronous). Not registered for Gemini CLI, Copilot CLI or OpenCode: Gemini's `PreCompress` fires before the summary exists and Copilot's `preCompact` is notification-only, so neither can put text in front of the resumed model.

**Why `SessionStart` and not `PostCompact`:** both hosts document `PostCompact`, and both discard its output — Claude Code lists it under "no decision control", and Codex's `PostCompact` output schema has no `additionalContext`. What each host does after a compaction is start the session again with `source: "compact"` and honour `hookSpecificOutput.additionalContext` from `SessionStart` hooks that match it. The hook also checks `source` itself, so a registration without the matcher stays silent on every other start.

**What it injects:** a short block — current phase and name, plan `N of M`, status, the `Stopped At` line (or the last activity when there is none), the resume file, and the first unticked roadmap phase — followed by an instruction to re-read `state.md` and the current plan before the next step. Each field is truncated on its own and the block stays under 2,000 characters, well inside the host's 10,000-character limit. Template placeholders (`[X]`) and `None` are not treated as values.

**When it is silent:** no `state.md`, no `Current Phase`, no `roadmap.md`, or every roadmap phase already ticked. It reads the planning tree the payload's `cwd` names (honouring `PAN_PLANNING_DIR`/`PAN_TRACK` like every PAN hook) and writes nothing — the field sweep found hooks that scaffolded `.planning/` in projects that never ran PAN, and this one cannot.

**Failure posture:** fail-open — malformed stdin or an unreadable file exits 0 with no output.

### pan-stop-guard.js (v3.24+, P-1809)

**Runtime support:** Claude Code (`Stop` in `settings.json`, and in the Claude plugin's `hooks/hooks.json`), Codex (`Stop` in `.codex/hooks.json`, synchronous — an `async` handler cannot block), Copilot CLI (`agentStop` in `.github/hooks/pan.json`) and Gemini CLI (`AfterAgent` in `settings.json` — Gemini's end-of-turn event, which re-prompts the agent with the reason on a block exactly as Claude's `Stop` does). Codex and Copilot hand the hook `stop_hook_active` like Claude Code (Copilot keeps that one field snake_case inside its camelCase payload), accept the same `{"decision":"block","reason":…}` output, and turn a block into a continuation prompt; Copilot blocks only on that JSON form, not on exit code 2, and ends the turn itself after eight consecutive blocks. Gemini sets `stop_hook_active` only for a continuation the block started directly, not after one that used tools, so there the guard keeps its one-shot promise with a marker per session, project and target phase in the per-user `0700` hook directory; a second stop aimed at the same phase is allowed. Until `2026-09-23` PAN registered it on Gemini under `Stop`, which Gemini skips. Codex and Copilot gained it on `2026-09-26`; the Claude plugin build carried every hook but this one until the same date. Not registered for OpenCode.

**Event:** `Stop` on Claude Code and Codex, `agentStop` on Copilot CLI, `AfterAgent` on Gemini CLI (runs when the main session tries to end its turn)

**What it does:** catches the auto-advance boundary drop mechanically. Field runs showed autonomous chains ending between transition.md's state update and the next-phase Task spawn at a low, nondeterministic rate — a failure prose instructions can reduce but not eliminate. When the session stops, this hook blocks **once**, with a reason instructing the agent to spawn the next phase, if and only if the disk shows the exact drop fingerprint:

1. `.planning/config.json` shows an autonomy signal: `workflow.auto_advance: true` **or** `mode: "yolo"` (P-1810). The guard is **inert** in every other project. The chain's trigger is flag OR config OR yolo; a Stop hook cannot see the `--auto` flag, so every entry hop (discuss/plan/exec-phase) persists the flag into config — arming on config alone left the guard dark on a real flag-driven drop (PanLoop finding 7). transition.md's Route B clears `auto_advance` at the milestone boundary, which disarms that half at the true end of a chain.
2. `.planning/state.md` shows **no legitimate-stop marker** (gaps found, failed verification, a recorded blocker). This condition is deliberately inverted (P-1812): the guard originally required the status to read "Ready to plan", and one field batch produced four different phrasings for the same boundary — the only run with unbuilt phases was disarmed by wording alone. An unrecognised phrasing now **arms** the guard (fail-safe: at worst one extra continuation, bounded by the one-shot design) instead of disarming it (fail-open: silent truncation). Genuine gaps/verification/blocker stops still pass through.
3. `.planning/roadmap.md` still has unticked `- [ ] **Phase N:` checklist lines.

**Loop safety:** the host sets `stop_hook_active` on stop attempts that follow a stop-hook block, and the guard always allows those. It fires at most once per stop chain — a user who genuinely wants to stop is delayed by exactly one continuation, never trapped. To stop an armed chain deliberately, run `pan-tools config-set workflow.auto_advance false` first (the block reason says exactly this).

**Escape hatch:** `workflow.stop_guard: false` in `.planning/config.json` disables the guard without disarming auto-advance.

**Failure posture:** fail-open everywhere — missing `.planning/`, unparseable config/state/roadmap, or malformed stdin all allow the stop silently. A missed catch costs a re-run; a wrong block traps a session, so the guard never blocks on uncertainty.

## Architecture

```text
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

Session restarts after a compaction (Claude Code / Codex SessionStart, matcher compact)
    |
    v
State Re-inject (pan-state-reinject.js, SessionStart)
    | reads .planning/state.md + roadmap.md → additionalContext

Session stop (Claude Code / Codex Stop, Copilot agentStop, Gemini AfterAgent)
    |
    v
Stop Guard (pan-stop-guard.js, Stop / agentStop / AfterAgent)
    | at an auto-advance boundary: block once with a continue reason; otherwise allow
```

The hooks communicate through files rather than being directly coupled:
- Either hook can fail independently without breaking the others
- Bridge and log files are inspectable for debugging
- No shared memory or IPC needed

## Installation

Hooks are automatically installed and registered during `npx pan-wizard`. The block below is Claude Code's `settings.json` with the command paths shortened: a local install (the default) writes project-relative commands such as `node .claude/hooks/pan-check-update.js`, and a `--global` install writes the config directory's absolute path, quoted:

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
      },
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/pan-state-reinject.js"
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
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/pan-trace-logger.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/pan-stop-guard.js"
          }
        ]
      }
    ]
  }
}
```

## Build Pipeline

Hook sources live alongside the dist directory:

```text
hooks/
  pan-statusline.js         # Source
  pan-context-monitor.js    # Source
  pan-check-update.js       # Source
  pan-cost-logger.js        # Source (v3.4+)
  pan-trace-logger.js       # Source (v3.5+)
  pan-stop-guard.js         # Source (v3.24+)
  pan-state-reinject.js     # Source
  dist/                     # Copied output (installed to user's machine)
    pan-statusline.js
    pan-context-monitor.js
    pan-check-update.js
    pan-cost-logger.js
    pan-trace-logger.js
    pan-stop-guard.js
    pan-state-reinject.js
```

Build command:
```bash
npm run build:hooks    # Copies hooks from hooks/ to hooks/dist/
```

The build script (`scripts/build-hooks.js`) simply copies files — no bundling or transpilation needed since hooks are pure Node.js with zero dependencies.

## Hook Runtime Support

| Runtime | Hooks supported | Notes |
|---------|----------------|-------|
| Claude Code | Yes | Full support via settings.json hook registration, including the state re-injection on `SessionStart` with the `compact` matcher |
| Copilot CLI | Yes | `.github/hooks/pan.json` (version 1 schema: sessionStart, postToolUse, subagentStop, agentStop). Copilot also runs the hooks in the project's `.claude/settings.json`, so in a project with both installs the Copilot copy of each hook steps aside for the Claude registration and each runs once. Headless (`copilot -p`) Copilot loads repository hooks only in a trusted folder, or with `COPILOT_ALLOW_ALL=true` or `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` — see TROUBLESHOOTING |
| OpenCode | No | PAN registers no hooks there; OpenCode's plugin API (`.opencode/plugins/*.js`) is not used yet |
| Gemini CLI | Partly | settings.json, in Gemini's own event names: `SessionStart` runs the update check and `AfterAgent` the stop guard. No context monitor (no Gemini hook payload or setting carries context-window usage, and Gemini has no statusline command) and no cost or trace logger (no subagent-completion event) or state re-injection (`PreCompress` fires before the summary exists). Until `2026-09-23` PAN wrote Claude's names here — `PostToolUse`, `SubagentStop`, `Stop` — which Gemini skips, with an "Invalid hook event name" warning, whenever it loads the settings |
| Codex | Yes | `.codex/hooks.json` since 2026-06 (Claude-compatible PascalCase events; loads once the project is trusted). PAN registers these hooks there — update check, context monitor, cost and trace loggers, the stop guard on `Stop`, and the state re-injection on `SessionStart` with the `compact` matcher; the observers (update check, cost and trace loggers) carry `async: true` (Codex CLI 0.148+) while the context monitor, the stop guard and the re-injection stay synchronous, because an async handler's output is deferred to a later turn and it cannot block. Codex runs a non-managed hook only after you trust it, and records that trust against a hash of the hook, so a new or changed PAN hook is skipped until you review it in `/hooks` — see TROUBLESHOOTING. No statusline, and the context monitor reads only the bridge file `pan-statusline.js` writes, so on Codex it finds none and never warns |

PAN registers hooks on Claude Code, Gemini CLI, Codex, and Copilot CLI. It registers none on OpenCode, whose plugin API it does not use yet.

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
    let data; try { data = JSON.parse(input); } catch { process.exit(0); }

    // Only care about Bash tool calls that look like phase-complete
    if (data.tool_name !== 'Bash') return;
    const cmd = (data.tool_input && data.tool_input.command) || '';
    if (!cmd.includes('phase complete')) return;

    // Log to a file (hooks can't write to the agent's output directly)
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(path.join(os.tmpdir(), 'pan-phase-log.txt'),
      `${timestamp} | Phase completed | ${cmd}\n`
    );

    // Optionally inject context back to the agent
    const result = { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Phase completion logged.' } };
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
# Should output: {"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Phase completion logged."}}
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
- Check `<os-tmpdir>/pan-hooks-<uid>/` for bridge files if your hook writes there
- Test with `echo '{}' | node your-hook.js` to verify it handles empty input gracefully

### Best Practices

1. **Always wrap in try/catch** — A broken hook should never break the agent's workflow
2. **Exit quickly** — Hooks run synchronously before/after tool calls. Keep execution fast.
3. **No side effects on failure** — If your hook can't read its data, exit silently
4. **Use the bridge file pattern** — For hooks that need to share data, write to a per-user directory under `os.tmpdir()` (PAN uses `pan-hooks-<uid>`, mode 0700) and read from there
5. **Test independently** — Hooks are standalone Node.js scripts. Test with `echo '{}' | node your-hook.js`
