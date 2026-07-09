# Documentation Alignment & Cleanup — Feature AI Specification

**Mode:** `--spike` (internal cleanup, no competitive research needed)
**Date:** 2026-03-02

---

## Phase 0: Problem Statement & Scope

PAN Wizard v1.0.0 has accumulated stale counts and orphaned artifacts across 21 development sessions. Documentation references 33 workflows (actual: 30), 1012 tests (actual: 1065), and 875 tests in the ship spec (actual: 1065). Three runtime installation directories (.codex/, .gemini/, .opencode/) are untracked 5MB of clutter. Two completed batch files should be archived. FAQ.md is missing Copilot CLI from the runtime table.

### Scope

| In Scope | Out of Scope |
|----------|-------------|
| Fix stale counts in DEVELOPMENT.md | Rewriting spec content (historical docs) |
| Fix FAQ.md missing Copilot CLI | Adding new documentation |
| Archive completed batch files | Changing any code |
| Add runtime dirs to .gitignore | Modifying the installer |
| Update production_readiness spec counts | CI/CD changes |
| Fix ADR-0009 workflow count reference | |

---

## Phase 4: Design — Task List

### CRITICAL (P1)

**Task 1: Fix DEVELOPMENT.md stale counts**
- Line 33: workflow count 33 → 30
- Line 45: test count "1012 tests, 206 suites" → "1065 tests, 218 suites"
- Line 56: "Run all 1012 tests" → "Run all 1065 tests"
Files: docs/DEVELOPMENT.md

**Task 2: Fix FAQ.md missing Copilot CLI**
- Add Copilot CLI row to runtime table
Files: docs/FAQ.md

### HIGH (P2)

**Task 3: Fix production_readiness_ship_v1 spec stale counts**
- Replace "33 test files, 875 tests" with "37 test files, 1065 tests" (4 locations)
Files: docs/specs/production_readiness_ship_v1_featureai.md

**Task 4: Fix ADR-0009 workflow count**
- "33 workflows when 31 exist" → "33 workflows when 30 exist"
Files: docs/decisions/ADR-0009-production-deployment-checklist.md

### MEDIUM (P3)

**Task 5: Add runtime install dirs to .gitignore**
- Add .codex/, .gemini/, .opencode/ to .gitignore
Files: .gitignore

**Task 6: Archive completed batch files**
- Move batch-2026-03-01-c.json to .planning/focus/archive/
- Move batch-2026-03-02.json to .planning/focus/archive/
Files: .planning/focus/

### LOW (P6)

**Task 7: Fix stale counts in historical specs (optional)**
- copilot_cli_runtime_featureai.md: "32 workflow commands" → updated to 37
- industry_comparison_and_feature_gaps_featureai.md: "4 runtimes" → updated to 5
Files: docs/specs/

---

## Total: 7 tasks, all XS size, ~10 minutes
