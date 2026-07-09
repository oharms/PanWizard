---
name: pan:what-if
group: Foresight
description: Explore a phase's alternative approach in an isolated git worktree. Replays the scenario, compares to the original plan, writes a report.
argument-hint: "<phase-number> <scenario-text>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Task
---

<objective>
Safely explore "what if we had done X instead?" for a phase. Creates an isolated git worktree, spawns `pan-counterfactual` inside it, lets the agent experiment without touching the main tree, collects a structured comparison payload, writes `.planning/counterfactuals/<phase>-<slug>.md` in the main tree, and cleans up the worktree.

Unchanged from Spec B v1's X-9. Already narrow enough to stand alone.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/bin/lib/whatif.cjs
@~/.claude/agents/pan-counterfactual.md
</execution_context>

<invocation>

```
/pan:what-if 7 "Use Redis instead of Memcached"
/pan:what-if 4 "Skip the migration step entirely"
/pan:what-if 12 "What if we'd picked NoSQL at the start?"
```

**Requirements:**
- Main project must be a git repository (worktrees require git).
- Working tree can be dirty — worktree is based on current HEAD, your uncommitted changes stay in main.

</invocation>

<process>

### Stage 1 — Prepare

```
pan-tools whatif prepare <phase> "<scenario text>"
```

The CLI:
1. Validates the phase exists.
2. Slugifies the scenario (lowercase, alphanumerics + hyphens, ≤50 chars).
3. Creates a git worktree at `<parent-of-cwd>/pan-whatif-<phase>-<slug>-<ts>` on a fresh branch `pan-whatif/<phase>-<slug>-<ts>`.
4. Returns `{phase, phase_name, scenario, slug, plans, summaries, has_executed, worktree: {worktree_path, branch, base}}`.

If worktree creation fails (not a git repo, dirty tree blocking, etc.), abort with a clear error.

### Stage 2 — Spawn pan-counterfactual

Spawn the agent with its working directory set to `worktree_path`. Prompt includes:
- `<files_to_read>` — the phase plan, any existing summary, the main project's `CLAUDE.md` so the agent understands conventions.
- `<scenario>` — the user's scenario text verbatim.
- `<worktree_path>` — so the agent knows the safe boundary.
- `<time_budget>` — advisory (10-20 min of reasoning/file-ops).

The agent explores, then returns a JSON payload with `{summary, differences, recommendations, risks, verdict}`.

### Stage 3 — Write report in MAIN tree

Run (from main tree, NOT worktree):

```
pan-tools whatif report <phase> "<scenario>" --comparison '<agent-json>'
```

This writes `.planning/counterfactuals/<phase>-<slug>.md`. The file belongs to the main tree and survives worktree cleanup.

### Stage 4 — Cleanup

```
pan-tools whatif cleanup --worktree <path> --branch <name> --force
```

Removes the worktree directory and deletes the counterfactual branch. Best-effort: warnings are surfaced but don't block.

### Stage 5 — Confirm

Echo the report path and verdict to the user. Done.

</process>

<safety>

**Worktree isolation is the safety mechanism.** The agent can edit files freely inside the worktree without affecting the main tree. Git treats worktrees as independent checkouts sharing the same object store.

**The agent is instructed NOT to commit inside the worktree.** Commits would be wasted effort since the worktree is deleted after report generation. The agent contract calls this out explicitly.

**The agent is instructed NOT to push or merge.** No remote-affecting git operations.

**Cleanup is forced.** `--force` on worktree removal ensures even a worktree with uncommitted changes gets cleaned up. The report is the permanent artifact; the worktree is disposable.

**If cleanup fails**, the worktree and branch remain. Re-run `pan-tools whatif cleanup` with the same args, or clean up manually:

```
git worktree remove --force <worktree_path>
git branch -D <branch_name>
```

</safety>

<output_paths>

- `.planning/counterfactuals/<phase>-<slug>.md` — the comparison report (permanent)
- `<parent>/pan-whatif-<phase>-<slug>-<ts>/` — the worktree (temporary, deleted after report)
- branch `pan-whatif/<phase>-<slug>-<ts>` — the worktree's branch (deleted after report)

Filename + branch include a timestamp so running what-if multiple times on the same phase+scenario produces distinct reports without overwriting.

</output_paths>

<runtime_compatibility>

| Runtime | Support |
|---------|---------|
| Claude Code | Full — worktree + agent + report |
| OpenCode | Partial — worktree + report work; agent spawn depends on runtime's task support |
| Gemini CLI | Partial — same caveat |
| Codex CLI | Partial — same caveat |
| Copilot CLI | Partial — same caveat |

The worktree and report layers are pure Node.js + git and work everywhere git is available. The agent orchestration varies by runtime's task-spawning capabilities. On any runtime that can't spawn an agent, the user can manually explore in the worktree and run `pan-tools whatif report` with a handwritten comparison JSON.

</runtime_compatibility>

<when_to_use>

**Use `/pan:what-if` when:**
- You're debating a decision mid-milestone and want to sample the alternative without rebuilding
- A phase is complete and you want to retrospectively compare approaches
- A reviewer asks "why not X?" and you want a structured answer

**Skip `/pan:what-if` when:**
- The alternative is trivially decidable from reading the plan (don't spawn an agent)
- You're already committed and the exploration is sunk-cost sympathy
- The main tree has massive uncommitted changes you don't want reflected in the worktree's base

</when_to_use>
