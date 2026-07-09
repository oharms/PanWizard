# PanMonty Protocol: 10-Phase Feature Implementation

**Tracker File:** `panmonty_status.md` (Create this file at the start of Phase 0)

---

## Phase -1: Batch Planning
**Goal:** Size all items, assign workflow tiers, and plan the batch before executing.

**When to use:** Always. Even for a single item, quickly size it to choose the right workflow tier.

### Quick Mode (`/panmonty --quick`)

**For trivial XS/S tasks, skip the full workflow entirely:**

```
Quick Mode Workflow:
1. Implement change
2. Run `npm test` for smoke test
3. Archive 3-line summary to sessionHistory.md
```

**Auto-detect quick mode:** If ALL items in a batch are XS/S AND change category is DOCS_ONLY or TESTS_ONLY, auto-suggest quick mode: "All items are XS/S docs/tests changes — use quick mode? [Y/n]"

**No status file needed.** No tracker. Just do the work and confirm done.

---

### Step -1.1: List & Size All Items

For each item the user wants processed, estimate effort:

| Size | Time | Example |
|------|------|---------|
| **XS** | <5 min | Config change, typo fix, doc update |
| **S** | <15 min | Bug fix in single file, add 1-2 tests |
| **M** | <30 min | Feature addition (1-3 files), new test suite, refactor |
| **L** | <60 min | Multi-file feature, new command, complex bug investigation |
| **XL** | Multi-session | New subsystem, major refactor (split required) |

### Step -1.2: Assign Workflow Tier Per Item

| Tier | Sizes | Phases Used | Tracker |
|------|-------|-------------|---------|
| **MICRO** | XS, S | Implement → Quick verify → Done | None (inline summary) |
| **STANDARD** | M | Phase 0 → 3 → 4 → 5 → 8 → 10 | Compact (20 lines) |
| **FULL** | L, XL | All 10 phases (0-10) | Full template |

**Rules:**
- MICRO items: No status file. Implement, run a quick test, confirm done. Move on.
- STANDARD items: Skip deep diagnosis (7) and polish (9) unless relevant.
- FULL items: Run the complete 10-phase workflow.
- XL items: Flag for splitting into multiple L/M items across sessions.

### Step -1.2b: Phase Selection by Change Category

For STANDARD and FULL tier items, further narrow the phase list based on what's changing:

| Change Category | Phases | Description |
|-----------------|--------|-------------|
| **DOCS_ONLY** | 0 → 3 → 8 → 10 | Documentation, markdown, commands only |
| **TESTS_ONLY** | 0 → 3 → 5 → 10 | Test files only, no core lib changes |
| **LIB_CHANGE** | 0 → 3 → 4 → 5 → 6 → 8 → 10 | Core library .cjs module changes |
| **HOOK_CHANGE** | 0 → 3 → 4 → 5 → 6 → 8 → 10 | Hooks source changes (requires build) |
| **FULL_FEATURE** | All (0-10) | New command/workflow touching all layers |

**How to assign:** Look at the files the item will touch:
- Only `.md` files → DOCS_ONLY
- Only `tests/` files → TESTS_ONLY
- `pan-wizard-core/bin/lib/*.cjs` files → LIB_CHANGE
- `hooks/src/*.js` files → HOOK_CHANGE
- Unsure or cross-cutting → FULL_FEATURE

### Step -1.3: Batch & Sequence

1. Group **independent items** that touch different files (can be done in any order)
2. Sequence **dependent items** (e.g., implement feature before writing tests for it)
3. Do MICRO items first (quick wins, build momentum)
4. Estimate capacity: **Target 5-10 items per session** (mix of sizes)

### Step -1.3b: Parallel Processing Rules

**For independent XS/S items (MICRO tier):**
When a batch contains 3+ independent MICRO items touching different files:
1. **Implement ALL** in sequence (no individual verification between them)
2. **Verify ALL at once** with a single `npm test` after all implementations
3. **Single documentation pass** — batch all doc updates together
4. This saves ~40% overhead vs individual cycles per item.

### Step -1.3c: Group Documentation

When multiple items complete in a session:
- **Batch all Phase 8 (doc updates)** into ONE pass at the end
- **Single Phase 10 archive** covering all items
- **One sessionHistory entry** summarizing the full batch

### Step -1.4: Show Batch Plan to User

```
## Batch Plan: <Session Description>

| # | Item | Size | Tier | Category | Phases | Est. |
|---|------|------|------|----------|--------|------|
| 1 | Fix typo in README | XS | MICRO | — | — | 2m |
| 2 | Add new test for roadmap | S | MICRO | — | — | 5m |
| 3 | Add --verbose flag to state cmd | M | STANDARD | LIB_CHANGE | 0→3→4→5→6→8→10 | 25m |
| 4 | New /pan:health command | L | FULL | FULL_FEATURE | All | 45m |

**Total:** 4 items | **Proceed?**
```

**GATE:** User confirms batch plan (or modifies) → Proceed to Phase 0 for first item.

---

## Phase 0: Initialization
**Goal:** Setup the workspace and tracking for the new feature.

- [ ] **Step 0.0:** **RESUME CHECK:** If `panmonty_status.md` already exists:
    - Read its `## Last Checkpoint` section
    - If status is "In Progress" with a valid checkpoint: **Skip to that phase** (don't restart from Phase 0)
    - If status is "INTERRUPTED": Resume from last completed step + 1
    - If status is "Complete": This is old — archive it first, then create new one
- [ ] **Step 0.1:** Create `panmonty_status.md` in the root workspace.
    - Copy the "Tracker Template" at the bottom of this protocol.
    - Fill in "Feature Name" and "Start Date".
- [ ] **Step 0.2:** Cache project facts.
    - **📋 CACHE EXTRACTION (Read-Once Policy):** Store these key facts in the status file header:
      ```
      ## Cached Facts
      - VERSION: 0.1.0
      - TEST_CMD: npm test
      - BUILD_CMD: npm run build:hooks
      - TEST_BASELINE: 123 tests, 24 suites, 0 failures
      - HOOKS: 3 (pan-check-update, pan-context-monitor, pan-statusline)
      ```
    - **⚠️ DO NOT re-read these in later phases.** Use cached facts above instead.
- [ ] **Step 0.3:** **MEMORY BANK FRESHNESS CHECK:**
    - Read `.claude/memory/context.md` — check version matches package.json.
    - If version mismatch: update context.md immediately.
    - **GATE:** Memory bank must be current before proceeding.
- [ ] **Step 0.4:** Check git status.
    - **GATE:** If git is dirty, ask user: "Git is dirty. Stash, Commit, or Continue anyway?"
- [ ] **Step 0.5:** **ROLLBACK SNAPSHOT:**
    - Create a lightweight git tag as a rollback point:
      ```
      git tag panmonty-snapshot-{YYYYMMDD-HHMMSS}
      ```
    - Record the tag name in `panmonty_status.md` under `## Rollback`.
    - If tag creation fails, note "No rollback snapshot" and continue.

---

## Phase 1: Requirements & Analysis
**Goal:** Deeply understand what needs to be built.

- [ ] **Step 1.1:** Specify the feature request clearly.
- [ ] **Step 1.2:** Search for existing code/patterns in the PAN Wizard codebase.
    - Check `pan-wizard-core/bin/lib/` for existing implementations
    - Check `commands/pan/` for related commands
    - Check `pan-wizard-core/workflows/` for related workflows
- [ ] **Step 1.3:** Identification of affected files and new files needed.
- [ ] **Step 1.4:** Update `panmonty_status.md` with:
    - User Requirements Summary.
    - Implementation Plan (rough draft).
    - Affected files list.

---

## Phase 2: Design & Planning
**Goal:** Detailed plan approval.

- [ ] **Step 2.1:** Write detailed plan in `panmonty_status.md`.
- [ ] **Step 2.2:** Define the explicit list of tasks.
- [ ] **GATE:** Pause and ask User: "Plan ready in status file. Proceed to implementation?"

---

## Phase 3: Implementation
**Goal:** Write the code.

**⚠️ QUALITY STANDARDS (MANDATORY):**
- **No shortcuts, no half-baked solutions.** Every fix must be complete and production-ready.
- **Root cause resolutions ONLY.** Do not apply workarounds or band-aids.
- **Cross-platform paths:** Always use `toPosix()` from core.cjs for paths in JSON output.
- **Shell safety:** Use `--text-file` / `--summary-file` flags for content with dollar signs or special chars.
- **CommonJS only:** All modules use `.cjs` extension with `require()` / `module.exports`.

### Key Files Reference

| Layer | Location | Files |
|-------|----------|-------|
| **CLI Router** | `pan-wizard-core/bin/` | `pan-tools.cjs` |
| **Core Library** | `pan-wizard-core/bin/lib/` | `core.cjs`, `config.cjs`, `frontmatter.cjs`, `template.cjs` |
| **Domain Modules** | `pan-wizard-core/bin/lib/` | `commands.cjs`, `init.cjs`, `milestone.cjs`, `phase.cjs`, `roadmap.cjs`, `state.cjs`, `verify.cjs` |
| **Commands** | `commands/pan/` | 31 `.md` command files |
| **Agents** | `agents/` | Agent definition `.md` files |
| **Workflows** | `pan-wizard-core/workflows/` | Workflow orchestration `.md` files |
| **Hooks** | `hooks/src/` → `hooks/dist/` | 3 compiled hooks |
| **Tests** | `tests/` | 7 `.test.cjs` files |

### Steps

- [ ] **Step 3.1:** Create necessary files and directory entries.
- [ ] **Step 3.2:** Implement core logic in appropriate `.cjs` module.
- [ ] **Step 3.3:** Wire into CLI router (`pan-tools.cjs`) if adding a new command.
- [ ] **Step 3.4:** Create/update command `.md` file if user-facing.
- [ ] **Step 3.5:** Mark completed tasks in `panmonty_status.md` as you go.

---

## Phase 4: Test Creation
**Goal:** Ensure high quality test coverage for the new feature.

### Test Location Guide

| Test Type | Location | Runner |
|-----------|----------|--------|
| **Unit/Integration** | `tests/<module>.test.cjs` | `node --test tests/<name>.test.cjs` |
| **Full Suite** | `tests/*.test.cjs` | `npm test` |

### Test Files Reference

| File | Focus |
|------|-------|
| `commands.test.cjs` | history-digest, summary-extract, progress, scaffold |
| `init.test.cjs` | init plan-phase, execute-phase, phase-op |
| `milestone.test.cjs` | milestone complete, archive |
| `phase.test.cjs` | phase list, add, insert, remove, complete |
| `roadmap.test.cjs` | roadmap get-phase, analyze |
| `state.test.cjs` | state snapshot, mutation, JSON, frontmatter |
| `verify.test.cjs` | validate consistency |

### Steps

- [ ] **Step 4.1:** Add tests to appropriate existing `.test.cjs` file, OR create a new test file.
- [ ] **Step 4.2:** Use `node:test` (`describe`, `it`) and `node:assert` (`strictEqual`, `deepStrictEqual`).
- [ ] **Step 4.3:** Ensure at least 5 assertions covering happy path + edge cases.
- [ ] **Step 4.3a:** **TEST QUALITY AUDIT:** Before proceeding, verify each new test:
    - Does each test use real assertions (not just "no error thrown")?
    - Would the test FAIL if the feature were broken?
    - **Cross-platform:** Do path assertions use forward slashes?
    - **Shell safety:** Do arguments with `$` use file-based input?
- [ ] **Step 4.4:** Run new tests in isolation: `node --test tests/<file>.test.cjs`

---

## Phase 5: Feature Verification Loop
**Goal:** The new feature must work (Green Tests).

**Loop Logic (Max 3 iterations):**
1. **Build (if hooks changed):** `npm run build:hooks`
2. **Test New Feature:** `node --test tests/<file>.test.cjs`
    - *If Failure:* Fix → Repeat Step 1.
3. **Smoke Test:** `npm test` (full suite)
    - *If Failure:* Fix regression → Repeat Step 1.

- [ ] **Step 5.1:** Enter Loop.
- [ ] **Step 5.2:** **GATE:** New Feature Tests PASS and Full Suite PASS (123+ tests, 0 failures).

---

## Phase 6: Integration Testing
**Goal:** Verify nothing is broken across the project.

### Change Impact Analysis

| Impact Level | File Patterns | Test Strategy |
|--------------|---------------|---------------|
| **DOCS_ONLY** | `*.md`, `commands/pan/*.md` | Skip tests |
| **TESTS_ONLY** | `tests/*.test.cjs` | Run changed tests only |
| **LIB_CHANGE** | `pan-wizard-core/bin/lib/*.cjs` | Full `npm test` |
| **HOOK_CHANGE** | `hooks/src/*.js` | Build hooks + `npm test` |
| **FULL_FEATURE** | Multiple layers | Build + Full `npm test` |

### Steps

- [ ] **Step 6.1:** Determine Impact Level from changed files.
- [ ] **Step 6.2:** Execute appropriate test strategy.
- [ ] **Step 6.3:** **GATE:** All tests PASS. If FAIL → Phase 7 (Deep Diagnosis).

---

## Phase 7: Deep Diagnosis
**Goal:** Handle stubborn failures or loop exhaustion.

**⚠️ ROOT CAUSE ONLY:** Do not apply quick fixes or workarounds.

- [ ] **Step 7.1:** Analyze complex failure (why did loops fail?).
- [ ] **Step 7.2:** Perform deep fix (ROOT CAUSE resolution - no shortcuts).
- [ ] **Step 7.3:** **Capture Error Pattern:** If this was a recurring or non-obvious mistake, append it to `.claude/memory/error_patterns.md`:
    ```markdown
    ### EP-NNN: <short description>
    - **Wrong:** <what was tried>
    - **Right:** <correct approach>
    - **Root cause:** <why it happened>
    - **Found in:** <session/date>
    ```
- [ ] **Step 7.4:** **ROLLBACK CHECK:** If this is the **3rd entry** into Phase 7:
    - Ask user: "Fix loop exhausted. Rollback to snapshot? (Yes/No/Continue)"
- [ ] **Step 7.5:** **GOTO Phase 5** (Restart verification loop).

---

## Phase 8: Documentation
**Goal:** Sync all documentation with implementation.

- [ ] **Step 8.1:** Update `README.md` if public API changed.
- [ ] **Step 8.2:** Update command `.md` files to reflect new behavior.
- [ ] **Step 8.3:** Update `docs/USER-GUIDE.md` if applicable.
- [ ] **Step 8.4:** Update `CHANGELOG.md` with new entry.

---

## Phase 9: Polish
**Goal:** Clean up.

- [ ] **Step 9.1:** Remove debug `console.log` statements.
- [ ] **Step 9.2:** Check for "TODO" comments left behind.
- [ ] **Step 9.3:** Verify consistent code style with existing modules.

---

## Phase 10: Shipping & Archive
**Goal:** Finalize and preserve context for AI Memory.

- [ ] **Step 10.1:** Display completion summary.
    - Use format: `PanMonty ✅ | <Feature> | Files: N | Tests: M new | All PASS`
- [ ] **Step 10.1b:** **TEST BASELINE VALIDATION:** If test counts changed:
    - Run `npm test` to get actual counts
    - Update cached test baseline in status file
- [ ] **Step 10.2:** **ARCHIVE (2 steps only):**
    1. **Move status file:** `panmonty_status.md` → `.claude/memory/archive/panmonty/<YYYY-MM-DD>_<feature_slug>.md`
    2. **Append 3-line summary** to `.claude/memory/sessionHistory.md`:
       ```markdown
       ### <YYYY-MM-DD> — <Feature Name>
       - **Result:** PASS | Files: N | Tests: M
       - **Key:** <one-sentence summary of what was done>
       ```
       Keep last 10 entries. Trim oldest if >10.
- [ ] **Step 10.3:** **PRE-COMMIT QUALITY GATE:**
    - Run `git status` — verify only expected files are staged
    - Check for unintended deletions
    - **Auto-generate commit message** from status file:
      ```
      <type>(<scope>): <description>

      - Files modified: N
      - Tests: M new/modified
      ```
    - Offer: "Commit with this message? [Y/n/edit]"
- [ ] **Step 10.4:** Git commit (use auto-generated message, or `/commit` for manual).

---

## Tracker Templates

### MICRO Tier — No Tracker

For XS/S items, skip the status file entirely. Just:
1. Implement the change
2. Run `npm test`
3. Confirm done

---

### STANDARD Tier Template (Copy to panmonty_status.md)

```markdown
# PanMonty Status Tracker
**Feature:** [Feature Name]
**Tier:** STANDARD
**Status:** In Progress
**Phase:** [0-10]
**Start Date:** [YYYY-MM-DD]

## Cached Facts
- VERSION: 0.1.0
- TEST_CMD: npm test
- BUILD_CMD: npm run build:hooks
- TEST_BASELINE: 123 tests, 24 suites

## Phase Progress
[−1:✅ 0:✅ 3:🔵 4:⬜ 5:⬜ 8:⬜ 10:⬜]

## Last Checkpoint
- **Last Completed Step:** [None]
- **Current File:** [None]
- **Next Action:** [Start Phase 3]

## Impact Level
[ ] DOCS_ONLY / [ ] TESTS_ONLY / [ ] LIB_CHANGE / [ ] HOOK_CHANGE / [ ] FULL_FEATURE

## Current Plan
- [ ] Task 1...

## Files Changed
(git diff --name-only)

## Test Results
- Suite: [Pending]
```

---

### FULL Tier Template (Copy to panmonty_status.md)

```markdown
# PanMonty Status Tracker
**Feature:** [Feature Name]
**Tier:** FULL
**Status:** In Progress
**Phase:** [0-10]
**Start Date:** [YYYY-MM-DD]

## Cached Facts
- VERSION: 0.1.0
- TEST_CMD: npm test
- BUILD_CMD: npm run build:hooks
- TEST_BASELINE: 123 tests, 24 suites

## Phase Progress
[−1:✅ 0:✅ 1:⬜ 2:⬜ 3:⬜ 4:⬜ 5:⬜ 6:⬜ 7:⬜ 8:⬜ 9:⬜ 10:⬜]

## Rollback
- **Snapshot Tag:** [None]

## Last Checkpoint
- **Last Completed Step:** [None]
- **Current File:** [None]
- **Next Action:** [Start Phase 1]

## Impact Level
[ ] DOCS_ONLY / [ ] TESTS_ONLY / [ ] LIB_CHANGE / [ ] HOOK_CHANGE / [ ] FULL_FEATURE

## Requirements
(from Phase 1)

## Implementation Plan
(from Phase 2)

## Current Plan
- [ ] Task 1...

## Files Changed
(git diff --name-only)

## Build State
- **Last Build:** [None]
- **Build Count:** 0

## Test Results
- Suite: [Pending]

## Key Decisions
(record important decisions and rationale)
```
