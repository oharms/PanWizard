<div align="center">
<img src="../assets/pan-avatar.png" alt="PanWizard" width="90" />
</div>

# Frequently Asked Questions

## General

### What runtimes does PAN support?

| Runtime | Command prefix | Config location | Status |
|---------|---------------|-----------------|--------|
| Claude Code | `/pan:*` | `~/.claude/` or `./.claude/` | Full support |
| OpenCode | `/pan-*` | `~/.config/opencode/` | Full support |
| Gemini CLI | `/pan:*` | `~/.gemini/` | Full support |
| Codex | `$pan-*` | `~/.codex/` or `./.codex/` | Skills-based |
| Copilot CLI | `/pan-*` | `~/.copilot/` | Skills-based |

### How much does PAN cost?

PAN itself is free and open source. Token costs depend on your Claude/model usage:

| Profile | Typical per-phase cost | Best for |
|---------|----------------------|----------|
| `quality` | Higher (Opus for most agents) | Critical architecture work |
| `balanced` | Moderate (Opus for planning, Sonnet for execution) | Normal development |
| `budget` | Lower (Sonnet + Haiku) | High-volume work, prototyping |

Reduce costs further by disabling optional agents:
```
/pan:settings
```
Toggle off `research`, `plan_check`, or `verifier` for familiar domains.

### How do I estimate token costs for a phase?

Each phase goes through several agent stages. Approximate token usage per stage:

| Stage | Agents spawned | Approximate tokens | Skippable? |
|-------|---------------|-------------------|------------|
| Research (new-project) | 4 parallel researchers + synthesizer | 30-50K total | Yes (`--skip-research`) |
| Research (plan-phase) | 1 phase researcher | 10-20K | Yes (`--skip-research`) |
| Planning | 1 planner + 1 plan-checker (up to 3 iterations) | 20-40K | Checker skippable (`plan_check: false`) |
| Execution | 1 executor per plan (fresh context each) | 20-80K per plan | No |
| Verification | 1 verifier | 10-20K | Yes (`verifier: false`) |

**Profile multiplier:** `quality` uses Opus for most agents (~2x cost of Sonnet). `budget` uses Haiku for research/verification (~0.3x cost of Sonnet).

**Optimization tips:**
- Skip research for familiar domains: `/pan:plan-phase N --skip-research`
- Disable plan-checker for trusted plans: `workflow.plan_check: false`
- Disable verifier for prototyping: `workflow.verifier: false`
- Use `budget` profile for high-volume phases: `/pan:profile budget`
- Use `--prd <file>` to skip discuss-phase when you have specs ready

### Can PAN search the web?

Yes. PAN research agents can use Brave Search API for domain research. Setup:

1. Get a free API key from the [Brave Search API](https://brave.com/search/api/)
2. Set `BRAVE_API_KEY` environment variable, OR save the key to `~/.pan-wizard/brave_api_key`
3. Set `brave_search: true` in `/pan:settings`

When enabled, researchers use web search to investigate technologies, libraries, and best practices during the research phase.

### Is my code sent anywhere?

No. PAN runs entirely within your local Claude Code (or other runtime) session. It uses standard tool calls — no external servers, no telemetry, no data collection. Your code stays on your machine and in your Claude session.

### How do I uninstall PAN?

```bash
# Global installs
npx pan-wizard --claude --global --uninstall
npx pan-wizard --opencode --global --uninstall
npx pan-wizard --gemini --global --uninstall
npx pan-wizard --codex --global --uninstall
npx pan-wizard --copilot --global --uninstall

# Local installs
npx pan-wizard --claude --local --uninstall
npx pan-wizard --opencode --local --uninstall
npx pan-wizard --gemini --local --uninstall
npx pan-wizard --codex --local --uninstall
npx pan-wizard --copilot --local --uninstall
```

This removes all PAN commands, agents, hooks, and settings while preserving your other configurations.

## Workflow

### Can I use PAN with an existing project?

Yes. Run `/pan:map-codebase` first — it spawns parallel agents to analyze your stack, architecture, conventions, and concerns. Then `/pan:new-project` will focus questions on what you're *adding* rather than what already exists.

### Does PAN commit to git automatically?

Yes. Each task gets its own atomic commit immediately after completion. Commit messages follow conventional format with phase numbers (e.g., `feat(03-02): add login endpoint`).

To disable: set `planning.commit_docs: false` in `/pan:settings` and add `.planning/` to `.gitignore`.

### What happens when context runs out?

PAN has a built-in context window monitor:
- At **35% remaining**: WARNING — the agent wraps up current work
- At **25% remaining**: CRITICAL — the agent saves state via `/pan:pause`

Between sessions, use `/pan:resume` to restore full context.

### Can I skip steps in the workflow?

Yes. The full workflow is `discuss → plan → execute → verify`, but:
- Skip `discuss-phase` if you're fine with Claude's defaults
- Skip `verify-phase` if automated verification is sufficient
- Use `/pan:quick` for one-off tasks that don't need full planning
- Disable research with `/pan:plan-phase --skip-research`

### How do I fix a plan that doesn't match my vision?

Run `/pan:discuss-phase [N]` before planning. Most misalignment comes from Claude making assumptions that your preferences (captured in context.md) would prevent.

You can also run `/pan:assumptions [N]` to preview Claude's intended approach before committing to a plan.

### Can I use PAN without `--dangerously-skip-permissions`?

Yes. Add granular permissions to `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(date:*)", "Bash(echo:*)", "Bash(cat:*)", "Bash(ls:*)",
      "Bash(mkdir:*)", "Bash(wc:*)", "Bash(head:*)", "Bash(tail:*)",
      "Bash(sort:*)", "Bash(grep:*)", "Bash(git add:*)",
      "Bash(git commit:*)", "Bash(git status:*)", "Bash(git log:*)",
      "Bash(git diff:*)", "Bash(git tag:*)"
    ]
  }
}
```

Note: you'll be prompted to approve agent spawning and other operations, which can slow down automated workflows.

## Spec B v2 Features (v3.0-v3.4)

### How do I see what PAN is costing me?

Run `/pan:cost report`. Since v3.4, a SubagentStop hook auto-captures every sub-agent completion into `.planning/metrics/tokens.jsonl` — so `/pan:cost` works without any manual instrumentation. Use `--format table` for human-readable output, `--format chart` for a daily bar chart, or `--since YYYY-MM-DD --until YYYY-MM-DD` to scope to a billing window.

### What's the difference between `pan-reviewer` and `/pan:review-deep`?

`pan-reviewer` is always-on during `/pan:exec-phase` — it flags convention, style, and basic quality issues on changed files. `/pan:review-deep` is opt-in (run standalone or with `--deep-review`) and adds two more agents: `pan-hardener` runs an OWASP Top 10 + STRIDE security audit, and `pan-meta-reviewer` cross-checks the reviewer + hardener output for missed issues or overstated severities. Costs roughly 3× a normal review; recommended for auth/payment/PII/migration phases.

### When should I use `/pan:exec-phase --hierarchical`?

Only when the phase has ≥4 autonomous plans that genuinely parallelize and the total work is large enough to amortize the ~20-30% orchestration overhead. `pan-conductor` spawns sub-agents in waves with a strict safety harness (2-level nesting cap, 12-spawn cap, budget ceiling, `.planning/orchestration/abort` kill-switch). Claude + Opus only; other runtimes silently fall back to flat exec. For single-plan or checkpoint-heavy phases, skip the flag — flat exec is cheaper and more predictable.

### What is `/pan:army` and how is it different from a normal phase?

**It's the difference between building a feature and shipping a project.** `/pan:army` (v3.11) runs a whole-project goal as a coordinated bot army, where `/pan:exec-phase` runs one phase. The Opus conductor becomes Mission Control — it plans and delegates, never codes — handing work to four role-scoped squads: Architecture (read-only design), Build (read/write code, one `army/<task>` git worktree per agent so parallel builders never collide), Quality (read-only adversarial), and Release (`pan-release`, always-ask). Each cycle is plan → delegate → execute → review → integrate → learn, looping until the goal ships or a stop condition fires. Nothing reaches a protected branch without green checks and a human's approval; recovery is `git revert` / previous tag. It runs under the same safety harness as hierarchical exec and is likewise Claude + Opus only. Inspect the roster with `pan-tools squad list`; start with `/pan:army "<goal>" --dry-run` to preview the plan and delegation before anything runs.

### Can the army run on a schedule / unattended?

Within a run, yes — it self-drives the loop. Across days, `/pan:army --schedule daily --daily-budget 200` (v3.12) arms a self-resuming campaign. PAN isn't a daemon, so it doesn't wake itself: it writes a schedule descriptor and you point an external trigger at it — a host scheduler (Claude Code routines / cron / scheduled tasks), a `/loop`, or the next-open nudge — which polls `pan-tools campaign due` and runs `/pan:army --continue` when due. Each day's run is capped by `--daily-budget` and resumes the next day; `pan-tools campaign status` shows where it stands. Crucially, scheduling changes nothing about safety: the merge to a protected branch is still an `always-ask` human gate, so a scheduled campaign burns the backlog down to staged, reviewed, green PRs and waits for you at every merge.

### Is `/pan:army` safe to let loose on my repo?

It's bounded by design, but treat it like hierarchical exec with a longer leash. The enforced rails: Mission Control can't write code (delegation-only tools), squad agents can't spawn further agents (depth cap), per-cycle spawn and budget ceilings stop runaway fan-out, the `.planning/orchestration/abort` file is an instant kill-switch, and **a human — not a bot — merges to a protected branch** (the Release agent only ever surfaces an `always-ask` request). Parallel builders are isolated in separate git worktrees, and recovery is always revert / previous tag — never a force-push or history rewrite. Set protected-branch rules on your repo and configure `build` / `verification` in `.planning/config.json` so the release gate runs your real checks. Live multi-agent battle-testing on a real project is still recommended before relying on it unattended.

### How do I watch what the army is doing?

Run `/pan:hud` (or its alias `/pan:dashboard`) — it renders a single self-contained HTML page at `.planning/hud.html` and opens it with `/pan:hud --open`. The dashboard is a *view*, not a new source of truth: every panel aggregates state PAN already tracks. Army campaigns light up extra panels — a command stack (Mission Control over the four squads with per-squad token/call drill-down), the campaign cadence + daily-budget bar, the safety harness (merge gate, abort switch, active worktrees), and the live `army/*` worktree list — alongside the always-present roadmap, telemetry, requirements, and recent-commits panels. The army panels appear only when a campaign is scheduled or army worktrees exist; a plain project still gets a complete page. The file has no server, network, or external dependencies, so you can send `.planning/hud.html` to anyone. Re-run after each cycle for a fresh snapshot. Added in v3.12 (ADR-0035).

### How do I ask PAN a question about my project?

Run `/pan:knowledge ask "why does phase 4 have a race condition fix?"`. The command retrieves candidate files from `.planning/` + `docs/` + top-level docs, scores them by keyword frequency, and the `pan-knowledge` agent answers with inline citations. For multi-turn design discussions, use `/pan:knowledge discuss <phase> "topic"` — session state persists to `.planning/conversations/<phase>/session.json`.

### Can I preview a phase before running it?

Yes. `/pan:preview phase <N>` analyzes the phase's plan files, extracts mentioned file paths, checks for risk keywords (drop / delete / migrate / rename / breaking / auth), and scores the phase 1-10. For cross-phase planning, `/pan:preview phases` emits a mermaid dependency graph + parallelizable-batches recommendation. For milestone-level forecasting, `/pan:preview milestone` projects an ETA with confidence interval from historical phase durations.

### What are MCP tools and how does PAN use them?

MCP (Model Context Protocol) tools are external integrations the host runtime provides — e.g. Linear, Slack, databases. In v3.3, `/pan:mcp-bridge list` shows which tools Claude Code has discovered, and `/pan:mcp-bridge recommend <phase>` suggests which apply to a phase plan based on keyword matching. This is **discovery-only** through v3.5 — PAN doesn't auto-invoke MCP tools. You see the recommendations and reference them in the phase plan; the executor agent uses them via Claude Code's normal tool-use flow. Auto-injection + auto-invocation remain on the roadmap.

## v3.5 Features

### How does the circular optimization loop work?

`/pan:learn` and `/pan:optimize` form a self-improvement cycle. The `pan-trace-logger.js` SubagentStop hook (v3.5+) auto-captures every sub-agent completion into `.planning/optimization/traces/<session>/trace.jsonl` with zero setup — it creates day-scoped sessions automatically. After a phase or campaign, run `/pan:learn` to invoke the `pan-optimizer` agent which clusters error/gap/redundancy patterns and produces a structured report at `.planning/optimization/reports/`. Run `/pan:optimize apply` to write the auto-applicable findings as memory entries. Next session, those memory entries get loaded into executor context (W2 fix), so PAN avoids repeating the same mistakes. The exec-phase workflow also logs `reviewer_correction` events when the reviewer issues a fix commit (W1 fix), so the optimizer can track real quality signal — not just "tasks completed."

### What does `/pan:focus-auto --category distill` do?

The `distill` focus-auto category targets **AI-generated code bloat** via a 5-pass pipeline (deterministic-first, LLM-on-narrow-spans). Pass 1 deterministically catches phantom try/catch (try around JSON.parse), unused imports, magic numbers, long functions, wide param lists. Pass 2 detects single-instance factory classes and deep nesting via AST-style analysis. Pass 3 finds repeated 5+ line blocks and unreferenced exports across files. Pass 4 spawns the `pan-distiller` agent with **only the flagged spans** (not full files) — it validates each pattern, refines safety tier (safe/review/risky), and proposes a minimal diff. Pass 5 writes findings to `.planning/memory/distill-patterns.md` so next session detects regressed patterns ("we already fixed this"). A bloat-budget gate (touched_LOC / essential_LOC, default 2.0×) prevents runaway code growth.

### What does `/pan:git` give me that raw `git` doesn't?

Phase-aware naming + safety guardrails matching the project's `.claude/commands/commit.md` quality bar. `/pan:git commit --type feat --message "..."` runs deleted-file detection and sensitive-file pattern checks (env, key, secret, token, credentials) before allowing the commit. `/pan:git branch create --phase 3` auto-names the branch `pan/phase-3`. `/pan:git push` validates the remote exists and requires explicit `--force` for force-push. `/pan:git rollback` lists `pan-rollback-*` snapshot tags created by exec-phase and resets to one (with `--dry-run` preview). Subcommands: commit, branch, push, status, log, stash, diff, rollback, tag, sync. Works on any git repo regardless of whether `.planning/` exists.

## Customization

### Can I customize agent behavior?

Yes. Agent files are Markdown in `~/.claude/agents/` (global) or `.claude/agents/` (local). Edit them directly. Changes take effect on next agent spawn.

After a PAN update, your local modifications may be overwritten. Use `/pan:patches` to restore them.

### Can I add my own commands?

Yes. Create a `.md` file in `commands/pan/` following the existing pattern. The filename becomes the slash command. Commands should be thin orchestrators — read state via `pan-tools.cjs`, spawn agents for heavy work.

### How do I change which model each agent uses?

Switch profiles globally:
```
/pan:profile budget
```

Or override specific agents in `.planning/config.json`:
```json
{
  "model_profile": "balanced",
  "model_overrides": {
    "pan-executor": "opus",
    "pan-planner": "haiku"
  }
}
```

## Troubleshooting

### Commands not found after install

1. Restart your runtime to reload commands
2. Verify files exist in `~/.claude/commands/pan/` (global) or `.claude/commands/pan/` (local)
3. For Codex, check `~/.codex/skills/pan-*/SKILL.md`
4. Re-run `npx pan-wizard` to reinstall

### Context degradation during long sessions

Clear context between major commands: `/clear` in Claude Code. PAN is designed around fresh contexts — every subagent gets a clean 200K window. Use `/pan:resume` or `/pan:progress` to restore state after clearing.

### Docker or containerized environments

If file reads fail with tilde paths, set `CLAUDE_CONFIG_DIR` before installing:
```bash
CLAUDE_CONFIG_DIR=/home/youruser/.claude npx pan-wizard --global
```
