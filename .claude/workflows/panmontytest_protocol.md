# PanMontyTest Protocol: 9-Phase Test Engineering Workflow

**Tracker File:** `panmontytest_status.md` (Create this file at the start of Phase 0)

---

## Phase 0: Initialization (Agent: System)
**Goal:** Setup the workspace and tracking for the test session.

- [ ] **Step 0.1:** Create `panmontytest_status.md` in the root workspace.
    - Copy the "Tracker Template" at the bottom of this protocol.
    - Fill in "Scope/Feature", "Target Files/Folders", and "Start Date".
- [ ] **Step 0.2:** Read `.claude/commands/test.md` to ensure testing context is fresh.
    - **IMPORTANT:** Pay attention to:
      - Current test runner: `node --test tests/*.test.cjs`
      - Expected baseline: 123 tests, 24 suites, 0 failures
      - Test framework: `node:test` + `node:assert`
- [ ] **Step 0.3:** Check git status.
    - **GATE:** If git is dirty, ask user: "Git is dirty. Stash, Commit, or Continue anyway?"

---

## Phase 1: Analysis & Discovery
**Goal:** Understand the current state of tests for the target scope.

- [ ] **Step 1.1:** Locate all related test files (`.test.cjs`).
    - *If specific files provided in args:* Use those as the primary target list.
    - *If module provided:* Find `tests/<module>.test.cjs`.
- [ ] **Step 1.2:** Run the specific tests for this scope to establish a baseline.
    - Record which pass and which fail in `panmontytest_status.md`.
- [ ] **Step 1.3:** Gap Analysis: Compare implemented features vs. existing tests.
    - Are "Happy paths" covered?
    - Are "Error cases" covered (invalid args, missing files)?
    - Are "Edge cases" covered (empty, max, special chars, cross-platform paths)?

---

## Phase 2: Planning & Strategy
**Goal:** Define the test workload.

- [ ] **Step 2.1:** List tests that need **FIXING** (currently failing).
- [ ] **Step 2.2:** List tests that need **AUDITING** (suspected low quality/false positives).
- [ ] **Step 2.3:** List tests that must be **CREATED** (to fill gaps from Step 1.3).
- [ ] **GATE:** Pause and ask User: "Test plan ready in status file. Proceed?"

---

## Phase 3: Test Validation Audit
**Goal:** Ensure existing tests are valid (not asserting trivially true things).

- [ ] **Step 3.1:** For the "tests to audit" list:
    - Check assertions: Do they verify actual output? Or just "no error thrown"?
    - Check `strictEqual` / `deepStrictEqual` usage vs vague checks.
- [ ] **Step 3.2:** **Crucial:** Verify they fail if the feature is broken (Mental mutation testing).
- [ ] **Step 3.3:** Flag invalid tests for rewrite in the status file.

---

## Phase 4: Fix Implementation
**Goal:** Repair confirmed broken tests or code.

- [ ] **Step 4.1:** Analyze root cause of failures (Test logic vs Library logic).
    - **Known pitfalls:** Check `.claude/memory/error_patterns.md` first.
    - Common: path separators (use `toPosix()`), shell expansion (`$` in args → use `--text-file`).
- [ ] **Step 4.2:** Apply fixes to `tests/` OR `pan-wizard-core/bin/lib/`.
- [ ] **Step 4.3:** **Loop:** Verification loop (Run test → Fix → Run test).
- [ ] **Step 4.4:** Mark fixed items in `panmontytest_status.md`.

---

## Phase 5: Coverage Expansion
**Goal:** Write new tests to fill gaps.

- [ ] **Step 5.1:** Add tests to existing `.test.cjs` files where appropriate.
- [ ] **Step 5.2:** Create new `.test.cjs` files for new modules if needed.
    - Use `node:test` (`describe`, `it`) and `node:assert`.
    - Use `helpers.cjs` utilities: `runPanTools()`, `createTempProject()`, `cleanup()`.
- [ ] **Step 5.3:** Ensure new tests follow existing patterns:
    - Cross-platform paths (forward slashes in assertions)
    - File-based input for shell-sensitive content
    - Temp project setup/teardown

---

## Phase 6: Verification Loop
**Goal:** Ensure the specific scope is Green.

**Loop Logic (Max 5 iterations):**
1. **Targeted Test:** Run ONLY the tests in scope.
    - `node --test tests/<file>.test.cjs`
    - *If Failure:* Fix and Repeat.
2. **Smoke Test:** Run `npm test` (full suite).
    - *If Failure:* You broke something else. Revert/Fix.

- [ ] **Step 6.1:** Enter Loop.
- [ ] **Step 6.2:** **GATE:** Target Scope PASS and Full Suite PASS.

---

## Phase 7: Documentation
**Goal:** Update records.

- [ ] **Step 7.1:** Update test counts in `.claude/commands/test.md` and `.claude/commands/quick.md`.
- [ ] **Step 7.2:** Update `.claude/memory/error_patterns.md` if new pitfalls discovered.

---

## Phase 8: Cleanup
**Goal:** Leave no trash.

- [ ] **Step 8.1:** Remove temporary test files and `console.log` debug statements.
- [ ] **Step 8.2:** Verify consistent test style with existing tests.

---

## Phase 9: Summary
**Goal:** Report results.

Display:
- Tests Fixed: [N]
- Tests Added: [N]
- Tests Audited: [N]
- Full Suite Status: [PASS/FAIL]
- Test Baseline: [old] → [new]

---

## Tracker Template (Copy to panmontytest_status.md)

```markdown
# PanMontyTest Status Tracker
**Scope:** [Feature/Scope Name]
**Target Files:** [List of specific .test.cjs files or modules]
**Status:** In Progress
**Current Phase:** 0

## Phase Checklist
- [ ] Phase 0: Init
- [ ] Phase 1: Analysis
- [ ] Phase 2: Planning
- [ ] Phase 3: Audit (Validation)
- [ ] Phase 4: Fixes
- [ ] Phase 5: Expansion
- [ ] Phase 6: Verification
- [ ] Phase 7: Docs
- [ ] Phase 8: Cleanup
- [ ] Phase 9: Summary

## Analysis Results
- **Broken Tests:**
    - [ ] (none identified yet)
- **Coverage Gaps:**
    - [ ] (none identified yet)
- **Review Items:**
    - [ ] (none identified yet)

## Current Plan
- [ ] Task 1...

## Test Logs
- Target Test Result: [Pending]
- Full Suite Result: [Pending]
```
