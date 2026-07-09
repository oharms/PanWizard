---
name: focus-exec
group: Focus
description: Automated batch execution pipeline with 6 stages, 9 behavioral rules, 3 execution tiers
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
---

# /pan:focus-exec — Automated Batch Execution Pipeline

Execute items from the current focus batch with capacity-based sizing, full session lifecycle, and verification. $ARGUMENTS

**Goal:** One-command pipeline that starts a session, loads the planned batch, implements items with tier-based execution protocols, verifies the work, syncs documentation, and closes the session cleanly.

<completion_contract>
Execution is complete when ALL conditions are met:
1. All batch items processed (each marked DONE or FAILED with reason)
2. Full test suite passes with count >= Stage 1 baseline
3. Stage 6 pre-commit checklist passes (all 6 checks)
4. Commit created listing only VERIFIED items
5. Session recorded with before/after test counts and budget usage
6. Active scan file updated with item statuses

Execution FAILS if: test baseline cannot be established (Stage 1), or test count drops below baseline after all reverts.
</completion_contract>

---

## Pipeline Overview

```
/pan:focus-exec

  Stage 1: SESSION START
    - Check project status, record baseline

  Stage 2: BATCH LOADING + VALIDATION
    - Read batch file, validate items, confirm budget

  Stage 3: EXECUTION (tier-based)
    - Implement items with read->understand->code
    - Build + test cadence per tier

  Stage 4: VERIFICATION
    - Verify all implemented items actually work
    - Full test suite must pass

  Stage 5: DOCUMENTATION SYNC
    - Update docs, README, CHANGELOG

  Stage 6: SESSION END
    - Commit, record session, generate summary
```

<action_gating>
Each stage has a restricted set of appropriate actions. Using the wrong tool at the wrong stage causes regressions.

| Stage | Read | Grep/Glob | Edit/Write | Bash (tests) | Bash (git) |
|-------|------|-----------|------------|--------------|------------|
| 1. Session Start | YES | YES | NO | YES | YES |
| 2. Batch Loading | YES | YES | NO | NO | NO |
| 3. Execution | YES | YES | YES | YES | NO |
| 4. Verification | YES | YES | NO | YES | NO |
| 5. Doc Sync | YES | YES | YES | NO | NO |
| 6. Session End | YES | NO | YES | NO | YES |

**Key constraints:**
- Stage 1: NO Edit/Write — you are establishing baseline, not changing code
- Stage 2: Read-only — validating the batch, not modifying anything
- Stage 4: NO Edit/Write — you are verifying work, not doing more work. If tests fail, go back to Stage 3 to fix.
- Stage 5: Edit docs only — no code changes during doc sync
- Stage 6: Git operations + session recording only — all work must be done
</action_gating>

---

## Project Scope Boundary

This command executes work on the **host project's source code** — not on PAN Wizard's own infrastructure.

**Do not read, modify, or fix files in these PAN directories:**
- `.claude/`, `.github/copilot-instructions.md`, `.opencode/`, `.gemini/`, `.codex/` — PAN runtime directories
- Any `pan-wizard-core/`, `pan-tools`, agent `.md`, or command `.md` files within PAN runtime directories

**These directories are PAN's own tooling installed into the project.** If a batch item targets a PAN infrastructure file, SKIP it with reason "PAN infrastructure — out of scope." Never modify PAN's agents, commands, core modules, or dispatcher as part of project work.

---

## Execute All Stages Sequentially

When `/pan:focus-exec` is invoked, run all 6 stages in order. Do not skip stages or stop between them unless tests regress.

<stage_dependencies>
Stage 1 → Stage 2: Baseline MUST exist before batch loads (regression detection requires it)
Stage 2 → Stage 3: Batch MUST be validated before execution begins (prevents working on stale/empty batches)
Stage 3 → Stage 4: All items MUST be processed before verification (partial verification produces false confidence)
Stage 4 → Stage 5: Tests MUST pass before doc sync (don't document broken code)
Stage 5 → Stage 6: Docs MUST be updated before commit (commit captures the complete state)

HARD STOP conditions (do not proceed to next stage):
- Stage 1: Test suite fails → fix tests before proceeding
- Stage 2: No batch file found → tell user to run /pan:focus-plan
- Stage 4: Test count below baseline → revert last changes, re-verify
</stage_dependencies>

**Flags:**
- `--budget N` — Override capacity budget in points (default: 50, min: 5, max: 100)
- `--mode MODE` — Execution mode (bugfix/balanced/features/full)
- `--priority P0-P6` — Only pick items from these priority tiers
- `--dry-run` — Run Stages 1-2 only (show what WOULD be executed)
- `--no-commit` — Skip the commit step in Stage 6
- `--continue` — Resume a previously interrupted execution
- `--deep-review` (v3.4+) — After each high-stakes item's execution, run `/pan:review-deep` for that item (pan-hardener + pan-meta-reviewer security + cross-check). Slows the campaign by roughly 3× per item that triggers the deep pass; use for batches touching auth/payment/migrations.

---

## Capacity Budget System

| Size | Points | Per Session | Meaning |
|------|--------|-------------|---------|
| **XS** | 1 | Up to 40 | Config tweak, typo fix |
| **S** | 2 | Up to 20 | Single-file bug fix, add tests |
| **M** | 4 | Up to 10 | Multi-file feature, new test suite |
| **L** | 10 | Up to 4 | Multi-module change, new command |
| **XL** | 20 | Up to 2 | New subsystem, major refactor |

---

## AI Behavioral Rules

### Rule 1: Read Before You Write
Before changing any file, read it first. Understand context, callers, and invariants.

**Violation example:**
```
BAD:  Rename parameter `opts` → `options` in utils.cjs without reading callers
      → 3 callers in api.cjs, workers.cjs break silently
GOOD: Grep for "utils\." → read all 3 callers → confirm param name is safe to change → edit
```

### Rule 2: Understand the Root Cause
Do not apply surface-level patches. Trace the code path, identify the actual defect.

**Violation example:**
```
BAD:  Test fails with "Cannot read property 'name' of undefined"
      → Add `if (!obj) return null` at the crash site
      → Root cause: caller passes wrong argument order — still broken
GOOD: Trace the call chain → find caller passes (id, name) but function expects (name, id) → fix caller
```

### Rule 3: One Change, One Test
Every code change must be tested before moving to the next item.

Test cadence by tier:
- **MICRO (XS/S):** Run specific test after implementing. Batch up to 3 independent items before smoke.
- **STANDARD (M):** Full test suite after each item.
- **FULL (L/XL):** Build hooks + full test suite after each item.

### Rule 4: Don't Invent — Follow the Plan
Implement exactly what the batch says. Do not:
- Add features not in the batch item
- Refactor surrounding code that isn't broken
- Add comments or docstrings to unchanged files
- Create abstractions for one-time operations
- Add error handling for scenarios that cannot happen

### Rule 5: Cross-Platform Awareness
- Use platform-agnostic path APIs (no hardcoded separators)
- Follow the project's module format conventions (discover from existing code)
- Use file-based input for shell-sensitive content when needed

### Rule 6: Revert Fast, Don't Dig Deep
If a fix doesn't work within 5 minutes, revert and move on. Failed items carry forward.

### Rule 7: Verify Understanding Before Coding
For M/L/XL items, state your understanding before writing code:
```
Item P2-3 — Add tests for billing module
Understanding: billing module has 3 exported functions. Need to test
generateInvoice, processPayment, and getBalance edge cases.
Files: billing.ts, tests/billing.test.ts
Confidence: HIGH
```

### Rule 8: Preserve Existing Test Expectations
Never change an existing test's expected output to match broken code.

### Rule 9: Commit Messages Must Be Accurate
List only items that are verified (passed tests). Include actual test counts.

### Rule 10: Vary Approach for Similar Items
When a batch contains 3+ items of the same type (e.g., "add null check to X", "add null check to Y"), deliberately vary your approach to avoid tunnel vision:
- Item 1: Fix as planned
- Item 2: Before fixing, re-read the module's error handling pattern — does the same fix apply or does this module handle errors differently?
- Item 3+: Check if the first fixes introduced a pattern that should be extracted (shared helper) or if each case is genuinely independent

This catches emergent interactions: 5 "add try-catch" fixes might reveal the module needs a centralized error boundary, not 5 scattered try-catches.

---

## Stage 1: Session Start

1. **Check Project Status** — git status, recent commits
2. **Test Baseline** — run test suite, record current counts
3. **Create rollback snapshot** — git tag for safety
4. **Prime prompt cache** — `pan-tools cache prime --summary` (once; all sub-agents in the next 5 min hit cached context)
5. **Report** — Output session start summary

**Circular optimization — init trace:**
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace init \
  --description "focus-exec session" --command "focus-exec" 2>/dev/null || true
```

**Record baseline:**
```
baseline_version: <from package.json>
baseline_tests: <N/N passing>
baseline_build: <pass/fail>
baseline_commit: <current HEAD>
```

**Failure Gate:** If tests fail, STOP. Fix tests before proceeding.

---

## Stage 2: Batch Loading + Validation

### 2.1 Find Active Batch
Search for: `.planning/focus/batch-*.json`
Pick the newest. If none exists, tell user to run `/pan:focus-plan` first.

### 2.2 Read and Validate the Batch
Extract all items: ID, Title, Priority, Effort, Points, Tier, Files.
Verify total points within budget.

### 2.3 Show Batch Table
Display the execution batch to user, then continue automatically.

---

## Stage 3: Execution

### 3.0 Pre-Execution Setup
1. Cache project facts — do NOT re-read later
2. Create/update progress tracker with the batch table
3. Classify stages for parallel tool use:
   ```
   pan-tools focus classify-stages --raw
   ```
   The CLI reads the latest batch and returns `{waves, parallelism_hint}`. When `parallelism_hint` is `emit-micro-in-parallel` or `emit-standard-in-parallel`, all reads and greps for items in the current wave SHOULD be emitted in a single assistant turn (parallel tool calls). Opus 4.7 is markedly better at emitting parallel tool calls than earlier models; use that to collapse Stage 3 latency on MICRO-heavy batches.

   Serialize on `FULL` tier items — each is its own wave.

### 3.1 Process Items by Tier

#### MICRO Items (XS/S)
```
1. READ target file(s)
2. IMPLEMENT the fix
3. TEST — run specific test file
4. CONFIRM — pass -> DONE | fail -> one fix attempt -> REVERT -> FAILED
```

#### STANDARD Items (M)
```
1. STATE UNDERSTANDING (Rule 7)
2. READ target files + test files
3. STATE INTENT — "I will modify [files], adding [what], to achieve [goal]"
4. IMPLEMENT across necessary files
5. TEST — full test suite
6. CONFIRM — pass -> DONE | regresses -> REVERT -> FAILED
```

#### FULL Items (L/XL)
```
1. STATE UNDERSTANDING (detailed)
2. READ WIDELY — target files, callers, tests, related code
3. DESIGN — outline approach before coding
4. STATE INTENT — "I will modify [files]. Risk: [what could break]"
5. IMPLEMENT in logical chunks
6. BUILD — build hooks if hooks changed
7. TEST — full test suite
8. CONFIRM — all pass -> DONE | fail -> investigate (15 min max) -> REVERT -> FAILED
```

### 3.2 Failure Handling

Classify every error before acting. The classification determines the recovery protocol.

**RECOVERABLE (retry with analysis, max 3 attempts):**
- Test failure after code change — read the error output, fix the root cause, re-test
- File not found — search for moved/renamed paths via Grep/Glob
- Build failure from syntax error — fix the typo, rebuild
- Merge conflict in a non-critical file — attempt auto-resolution

**UNRECOVERABLE (halt the item, mark FAILED, move to next):**
- Same test failure persists after 3 fix attempts — revert all changes for this item
- Permission or auth error on a critical path — cannot proceed without user action
- State corruption (malformed JSON in planning files) — stop, report to user
- Persistent build failure unrelated to current item — stop execution, report
- Test regression in unrelated code — revert, flag for investigation

**Never let a failed item block other items.** Mark it FAILED with the error classification and move on.

### 3.3 Failure Pattern Detection
When marking an item FAILED, check if its error matches a previous failure in this batch:
- Same error type or root cause category
- Same file or module involved

If a pattern repeats (2+ items fail the same way), log it in the session record:
```
FAILURE PATTERN: {description} — Items {ID1}, {ID2} — Root cause: {cause}
Suggested avoidance: {what to check before similar items}
```
Before executing remaining items, check if they match the pattern. If so, skip with reason "matches known failure pattern" rather than burning budget on predictable failures.

### 3.4 Progress Tracking
Update progress tracker after each item with status and budget tracking.

**Attention anchor — emit after each item completes:**
```
Item {N}/{total} {DONE|FAILED} | Budget: {used}/{budget} pts | Tests: {baseline} → {current}
Remaining: {count} items [{IDs with sizes}]
Next: {next item ID} — {title} ({tier})
```
This prevents lost-in-the-middle drift in large batches where the agent forgets budget limits or remaining items.

---

## Stage 4: Verification

### 4.1 Full Suite Verification
Run full test suite. All tests must pass. Compare against Stage 1 baseline.

### 4.2 Build Verification (if applicable)
Build hooks or compile step if applicable. All must pass.

### 4.3 Verification Report
```markdown
## Verification Report

### Item Results
| # | ID | Title | Tests | Verdict |
|---|----|-------|-------|---------|
| 1 | P0-1 | Fix crash | pass | VERIFIED |
| 2 | P2-3 | Add tests | pass | VERIFIED |

### Regression Check
| Test Suite | Before | After | Delta |
|------------|--------|-------|-------|
| Tests | N/N | M/M | +K |
| Build | pass | pass | -- |
```

---

## Stage 5: Documentation Sync

### 5.1 Update Docs
- Update README.md if public API changed
- Update CHANGELOG.md with new entries
- Update command/workflow files if behavior changed

### 5.2 Update Scan
Edit the active scan file:
- Mark completed items with completed status
- Mark failed items with failed status and reason

---

## Stage 6: Session End

### 6.1 Pre-Commit Verification Checklist

Before committing, run through ALL checks. Do not commit until every check passes.

1. Every modified file was read before editing (no blind writes)
2. `git diff --stat` contains only files related to batch items (no stray changes)
3. Full test suite passes — count matches or exceeds baseline from Stage 1
4. No `TODO`, `FIXME`, or `HACK` introduced without a matching batch item tracking it
5. Commit message lists only items that are VERIFIED (tests ran, tests passed)
6. No secrets, credentials, or `.env` files staged

If any check fails: fix the issue and re-run all checks. Only proceed to commit when all 6 pass.

### 6.2 Commit Changes
Unless `--no-commit`:
1. Stage modified files (specific paths, not `git add -A`)
2. Create commit with accurate message listing verified items
3. Verify commit succeeded

### 6.3 Record Session
- Record session summary (items completed, tests before/after, budget used)
- Append error patterns if any failures occurred

### 6.3.5 Circular optimization — end trace
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace end 2>/dev/null || true
```

### 6.4 Final Report

```markdown
## /pan:focus-exec Complete

| Stage | Status |
|-------|--------|
| 1. Session Start | Baseline: N/N tests |
| 2. Batch Loading | Mode: balanced, N items |
| 3. Execution | N/M items completed |
| 4. Verification | All verified |
| 5. Doc Sync | Updated N docs |
| 6. Session End | Committed |

### Results
- **Budget:** X/50 points used
- **Items completed:** N (X pts)
- **Items failed:** K (Y pts returned)
- **Tests:** Before N -> After M (+K new)

### Resume
Run `/pan:focus-exec --continue` for remaining items.
Run `/pan:focus-scan` to regenerate the scan.
```

---

## NEVER DO

- Skip reading files before editing them — blind edits break callers, miss invariants, and create regressions (Rule 1)
- Apply symptom patches instead of root cause fixes — surface patches recur and erode trust in the codebase (Rule 2)
- Batch implement without testing between items — a silent failure in item 2 corrupts items 3-5 before you detect it (Rule 3)
- Expand scope beyond the batch item — unplanned changes bypass the budget system and risk compounding failures (Rule 4)
- Ignore cross-platform path issues — hardcoded separators break on Windows or vice versa (Rule 5)
- Spend more than 5 minutes debugging a single failure — diminishing returns; revert preserves budget for remaining items (Rule 6)
- Start coding without stating understanding for M+ items — misunderstanding the problem wastes the entire implementation (Rule 7)
- Change test expectations to match broken code — this hides bugs instead of fixing them (Rule 8)
- Claim items are fixed without running tests — unverified claims erode the entire verification pipeline (Rule 9)

## ALWAYS DO

- Read before write, understand before implement
- Test after every item
- Stay within budget and plan scope
- Use platform-agnostic paths, file-based input for shell-sensitive content
- Revert fast when stuck
- Record baseline test counts BEFORE making changes
- Save progress after each item
- Record session at end
- Report results with before/after comparison and budget usage
