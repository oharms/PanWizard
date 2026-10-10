# Context Window Monitor

> **Note:** This page is a short summary. [HOOKS.md](HOOKS.md#pan-context-monitorjs) is the full, maintained description of the context monitor and of every other built-in hook.

`pan-context-monitor.js` is a `PostToolUse` hook. It tells the agent when the host will compact its context soon, so the agent can make sure `.planning/state.md` records where it is first.

- **What it measures:** the room left before the host compacts. The host compacts about 33K tokens short of its auto-compact window: `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, then `autoCompactWindow` in settings, else the model window. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` lowers that point when its share of the window is lower.
- **Where it reads it:** PAN's status line writes a bridge file, `<os-tmpdir>/pan-hooks-{uid}/claude-ctx-{session_id}.json`, and a main-thread call reads it while it is fresh. Without one (headless `claude -p`, or a status line that is not PAN's), the hook reads the session transcript the payload names. A call inside a subagent is measured on the subagent's own transcript.
- **What it says:** at 35% or less of that room left, a note asking for a checkpoint in `.planning/state.md` at the next natural stopping point; at 25% or less, a checkpoint before the next step (`/pan:pause` writes it). The note carries no countdown and asks the agent to keep working at full quality, because PAN restores the planning state after the compaction.
- **Where it runs:** Claude Code. Codex and Copilot CLI register it too but it stays silent there (on Copilot, PAN's own registration; see HOOKS.md for a project with both installs), and Gemini CLI and OpenCode do not run it (see [HOOKS.md](HOOKS.md#hook-runtime-support)).
- **Safety:** it fails open. Any error, a missing transcript or an unknown model window means no note, and it never blocks a tool call.

The installer registers it; [HOOKS.md](HOOKS.md#installation) shows the `settings.json` entries it writes.
