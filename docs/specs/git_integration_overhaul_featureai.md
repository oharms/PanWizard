# featureAI Spec: Git Integration Overhaul for PAN Wizard

**Date:** 2026-03-07
**Status:** Proposed
**Scope:** Focus system, build system, phase lifecycle, and commit infrastructure

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement
PAN Wizard's git integration is a facade — the reference docs (`git-integration.md`, `git-planning-commit.md`) describe a comprehensive per-task commit strategy, rollback snapshots, and git-aware lifecycle gates, but the code implements almost none of it. Focus-exec runs batches without checking git state. Phase completion doesn't create commits. The auto-runner accumulates cycles of uncommitted changes. The result: users' git history is a mess of manual afterthought commits instead of the clean, bisectable, per-task changelog PAN promises.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Internal audit (session 29) | Codebase analysis | 10 critical gaps: focus-exec ignores git, phase-complete doesn't commit, auto-runner has no git interaction, panmonty git gates are procedural-only |
| Competitor gap | Aider (gold standard) | Auto-commits per change + `/undo` = clean reversible history. PAN has neither. |
| Competitor gap | Copilot Workspace | Issue -> Plan -> Implement -> Validate -> PR flow. PAN's focus-exec does Plan -> Execute with no git bookends. |
| Architecture debt | git-integration.md vs code | Doc says "Task completed = YES commit" (line 20). Code: `cmdPhaseComplete()` never calls `cmdCommit()`. |

### 0.3 Success Criteria

```
SC-1: focus-exec checks git cleanliness before processing any batch item
SC-2: Phase completion creates an atomic commit with conventional message
SC-3: focus-auto creates checkpoint commits between cycles
SC-4: /commit skill handles all 7 scenarios (quick, selective, phase, amend, planning, wip, dry-run)
SC-5: execGit returns explicit 'not_a_git_repo' when .git doesn't exist
SC-6: No regression in 1557+ existing tests
SC-7: Works identically on Windows, Mac, Linux (CI matrix: 3 OS x 3 Node)
```

---

## Phase 1: Internal Reconnaissance — Current State

### What Works (keep)
| Capability | Location | Status |
|-----------|----------|--------|
| `execGit(cwd, args)` | core.cjs:217-232 | Solid — safe `execFileSync`, structured return |
| `isGitIgnored(cwd, path)` | core.cjs:199-209 | Works |
| `runCommitSafetyChecks()` | commands.cjs:318-356 | Good — deleted files, sensitive patterns |
| `cmdCommit()` | commands.cjs:358-409 | Works for `.planning/` commits |
| `cmdRollbackSnapshot()` | commands.cjs:851-886 | Works — tag-based rollback points |
| `cmdPreflight()` git_clean check | verify.cjs:1038-1050 | Works — counts uncommitted changes |
| `cmdVerifyCommits()` | verify.cjs:52-70 | Works — batch hash verification |

### What's Missing (the 10 gaps)

| Gap | Severity | Where It Should Be |
|-----|----------|-------------------|
| **G1: Focus-exec doesn't verify git cleanliness** | HIGH | `focus.cjs:cmdFocusExec()` |
| **G2: No git init for new projects** | MEDIUM | `init.cjs:cmdInitNewProject()` |
| **G3: Panmonty git checks are doc-only** | HIGH | No code enforces panmonty_protocol.md gates |
| **G4: Phase completion doesn't commit** | HIGH | `phase.cjs:cmdPhaseComplete()` |
| **G5: No push automation** | LOW | By design — keep manual |
| **G6: Focus-auto has no git interaction** | HIGH | `focus.cjs:focusAutoUpdate/Continue` |
| **G7: Preflight exists but exec doesn't call it** | HIGH | `focus.cjs:cmdFocusExec()` |
| **G8: No 'not_a_git_repo' explicit error** | MEDIUM | `commands.cjs:cmdCommit()` |
| **G9: No batch commit helper** | MEDIUM | Missing from `commands.cjs` |
| **G10: Milestone operations don't commit** | MEDIUM | `milestone.cjs:cmdMilestoneComplete()` |

---

## Phase 2: Competitive Intelligence Summary

### Gold Standards to Learn From

**Aider (per-change commits):**
- Auto-commit after every AI edit — git history = changelog
- `/undo` reverses last commit (`git reset`)
- `--dirty-commits` separates user changes from AI changes
- `--test-cmd` runs tests before committing, auto-fixes failures

**Copilot Workspace (workflow integration):**
- Issue -> Spec -> Plan -> Implement -> Validate -> PR
- Auto-branching per task, auto-linked PRs
- Cloud-based validation step before commit

### What PAN Should NOT Copy
- Auto-commit on every file change (too noisy for PAN's batch model)
- Auto-branching (PAN users work on single branch, feature branches are user choice)
- Cloud validation (PAN is zero-dep, local-only)

### What PAN Should CREATE (Blue Ocean)
- **Batch-aware commits**: One commit per focus-exec item, with phase-scoped messages
- **Lifecycle git gates**: Preflight before execution, commit after completion, tag at milestones
- **WIP checkpoints**: Auto-runner creates `wip:` commits between cycles
- **Commit-or-warn paradigm**: Never silently accumulate uncommitted work

---

## Phase 3: Strategic Design

### Architecture: Git Integration Layers

```
Layer 4: Skills (.claude/commands/commit.md)        ← User-facing, AI-interpreted
Layer 3: Orchestrators (focus-exec, panmonty, etc.) ← Call Layer 2 at lifecycle points
Layer 2: Commands (cmdCommit, cmdRollbackSnapshot)   ← High-level git operations
Layer 1: Primitives (execGit, isGitIgnored)          ← Safe git execution
```

**Principle: Git logic lives in Layer 2-3, never Layer 4 alone.** The current commit.md (Layer 4) describes git checks that should be ENFORCED in code (Layer 2-3), not just suggested to an AI.

### Implementation Plan: 8 Work Items

---

### Item 1: `isGitRepo(cwd)` helper + explicit error in cmdCommit
**Size:** XS (1 pt) | **Priority:** P1 | **Track:** stability
**Files:** `core.cjs`, `commands.cjs`

Add to `core.cjs`:
```javascript
function isGitRepo(cwd) {
  const result = execGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return result.exitCode === 0;
}
```

Update `cmdCommit()` to return `{ committed: false, reason: 'not_a_git_repo' }` explicitly when `isGitRepo()` returns false. Currently it returns a vague `commit_failed`.

Export `isGitRepo` for use by other modules.

**Tests:** 3 unit (isGitRepo true/false/non-dir), 2 integration (cmdCommit in non-git dir)

---

### Item 2: Git cleanliness gate in focus-exec
**Size:** S (3 pts) | **Priority:** P1 | **Track:** stability
**Files:** `focus.cjs`

Before `cmdFocusExec()` processes any batch item, check:
```javascript
const { execGit } = require('./core.cjs');
const status = execGit(cwd, ['status', '--porcelain']);
if (status.exitCode === 0 && status.stdout) {
  // Dirty working tree
  return output({ error: 'dirty_working_tree', uncommitted_count: status.stdout.split('\n').filter(Boolean).length, hint: 'Commit or stash changes before running focus-exec' }, raw, 'blocked');
}
```

Add `--force` flag to bypass (for users who know what they're doing).

**Tests:** 4 unit (clean/dirty/non-git/force-override), 2 integration

---

### Item 3: Phase completion auto-commit
**Size:** S (3 pts) | **Priority:** P1 | **Track:** feature
**Files:** `phase.cjs`, `commands.cjs`

When `cmdPhaseComplete()` succeeds (roadmap + state updated), call `cmdCommit()` internally:
```javascript
// After roadmap/state updates succeed:
const commitMsg = `docs(${phaseId}): complete phase — ${phaseName}`;
cmdCommit(cwd, commitMsg, [PLANNING_DIR + '/'], false, false, { type: 'docs' });
```

This only commits `.planning/` files (metadata). Code commits are the user's responsibility during task execution.

Add `--no-commit` flag to skip if user doesn't want auto-commit.

**Tests:** 3 unit (commit created, no-commit flag, non-git graceful), 2 integration

---

### Item 4: Milestone completion auto-commit + tag
**Size:** S (2 pts) | **Priority:** P2 | **Track:** feature
**Files:** `milestone.cjs`, `commands.cjs`

When `cmdMilestoneComplete()` succeeds:
1. Commit `.planning/` with `docs: milestone vX.Y complete`
2. Create tag: `milestone-vX.Y`

**Tests:** 3 unit, 1 integration

---

### Item 5: Focus-auto cycle checkpoint commits
**Size:** M (5 pts) | **Priority:** P2 | **Track:** feature
**Files:** `focus.cjs`

After each auto-runner cycle completes (`focusAutoUpdate`):
1. Check if there are uncommitted `.planning/` changes
2. If yes, create: `docs: focus-auto cycle N — processed M items`
3. Update auto-run.json with last_commit_hash

This prevents multi-cycle runs from accumulating unbounded uncommitted metadata.

Add config option `focus.auto_commit: true|false` (default: true).

**Tests:** 4 unit (commit-per-cycle, no-change skip, config disable, non-git), 2 integration

---

### Item 6: Batch commit helper for focus-exec results
**Size:** S (3 pts) | **Priority:** P2 | **Track:** feature
**Files:** `commands.cjs`

New function `cmdBatchCommit(cwd, items, raw)`:
- Takes array of completed batch items
- Creates single commit: `docs: focus-exec batch — N items completed`
- Body lists item titles
- Only commits `.planning/` metadata, not code

This is called by orchestrators (focus-exec, execplan) after processing a batch, not by users directly.

**Tests:** 3 unit, 2 integration

---

### Item 7: `git init` in new project initialization
**Size:** XS (1 pt) | **Priority:** P3 | **Track:** stability
**Files:** `init.cjs`

In `cmdInitNewProject()`, after creating `.planning/` structure:
```javascript
if (!isGitRepo(cwd)) {
  execGit(cwd, ['init']);
  // Don't fail if git init fails — it's a convenience, not a requirement
}
```

Match what `git-integration.md` line 32 promises: "PAN projects always get their own repo."

**Tests:** 2 unit (init creates repo, existing repo untouched)

---

### Item 8: Build/check skills git status integration
**Size:** XS (1 pt) | **Priority:** P3 | **Track:** quality
**Files:** `.claude/commands/check.md`, `.claude/commands/build.md`

Update `/check` to include git status in health report:
```
Git: main (clean) | 3 ahead, 0 behind
```

Update `/build` to warn if building with uncommitted changes.

These are skill-level changes only (Layer 4) — no code changes needed.

**Tests:** None (skill files, not code)

---

## Implementation Order & Dependencies

```
Item 1: isGitRepo helper (no deps)
  ├─→ Item 2: focus-exec git gate (needs isGitRepo)
  ├─→ Item 3: phase-complete auto-commit (needs isGitRepo)
  ├─→ Item 4: milestone-complete auto-commit (needs isGitRepo)
  └─→ Item 7: git init in new project (needs isGitRepo)

Item 6: batch commit helper (no deps)
  └─→ Item 5: focus-auto cycle commits (needs batch commit)

Item 8: skill updates (no deps, no code)
```

**Wave 1 (P1, parallel):** Items 1 + 6 + 8
**Wave 2 (P1, needs Wave 1):** Items 2 + 3
**Wave 3 (P2):** Items 4 + 5
**Wave 4 (P3):** Item 7

### Effort Summary
| Wave | Items | Points | Tests |
|------|-------|--------|-------|
| 1 | 1, 6, 8 | 4 pts | 10 |
| 2 | 2, 3 | 6 pts | 11 |
| 3 | 4, 5 | 7 pts | 10 |
| 4 | 7 | 1 pt | 2 |
| **Total** | **8 items** | **18 pts** | **33 tests** |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Auto-commits annoy users | Medium | Medium | All auto-commits have `--no-commit` bypass + config toggle |
| Non-git repos break | Low | High | `isGitRepo()` gate on every git path; graceful fallback |
| Focus-exec git gate blocks CI | Low | Medium | `--force` flag bypasses; CI can set config |
| Phase-complete commit fails (disk) | Low | Medium | try-catch, surface warning, don't fail the phase completion |
| Windows path issues in git add | Low | Medium | Already using `execFileSync('git', args)` — no shell interpolation |

---

## What This Does NOT Include (Intentionally)

- **Auto-branching / PR creation** — Out of scope. PAN is branch-agnostic by design.
- **Push automation** — Intentionally manual. Too dangerous to automate.
- **Merge conflict resolution** — No AI tool does this well. Leave to user.
- **Undo/rollback command** — `cmdRollbackSnapshot()` already exists. Could be enhanced later.
- **Per-task commits during execution** — This is the EXECUTOR agent's responsibility, not infrastructure. The reference doc (`git-integration.md`) guides the agent.

---

## ADR: Git Lifecycle Gates in PAN Wizard

### Status
Proposed

### Context
PAN Wizard's documentation describes comprehensive git integration (per-task commits, git cleanliness gates, rollback snapshots), but the code only implements the primitives (`execGit`, `cmdCommit`). Orchestrators (focus-exec, auto-runner, phase lifecycle) have zero git awareness. This creates a gap where users follow PAN's workflow but end up with messy git history because the system never enforces its own git strategy.

### Decision
Add git lifecycle gates at orchestrator boundaries (before/after focus-exec, on phase/milestone completion, between auto-runner cycles). Keep gates soft (bypassable with flags/config) but default to enforcing clean git discipline.

### Consequences
**Positive:**
- Git history reflects PAN's per-task commit philosophy automatically
- Focus-exec won't silently accumulate uncommitted work
- Phase/milestone completions are tracked in git, not just STATE.md

**Negative:**
- Users with non-git workflows will see warnings (mitigated by `--force` + config)
- Slight overhead on each orchestrator call (one `git status` check)

**Neutral:**
- Existing `cmdCommit()` API unchanged — new callers added, not new API
