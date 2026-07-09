---
name: focus-scan
group: Focus
description: Deep-dive strategic work scan with prioritized items and Reality Score filtering
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

# /pan:focus-scan — Deep-Dive Strategic Work Scan

Survey the project for prioritized work items with evidence-based scoring. $ARGUMENTS

**Goal:** Produce a comprehensive, evidence-based prioritized work list by deep-diving into ALL project files, code, and test results. Every item must link to source files and be actionable.

---

## Project Scope Boundary

This command scans the **host project's source code** for work items — not PAN Wizard's own infrastructure.

**Exclude these directories from scanning:**
- `.claude/`, `.github/copilot-instructions.md`, `.opencode/`, `.gemini/`, `.codex/` — PAN runtime directories
- `.planning/` — PAN planning state (read for context, but never report PAN planning files as "issues")
- Any `pan-wizard-core/`, `pan-tools`, agent `.md`, or command `.md` files within PAN runtime directories

**These directories are PAN's own tooling installed into the project.** Do not report TODO/FIXME items found in PAN files. Do not flag PAN files as lacking test coverage. Do not suggest improvements to PAN's agents, commands, or core modules.

If a scan finding points to a file inside `.claude/`, `.github/`, `.opencode/`, `.gemini/`, or `.codex/` — DROP IT. It is not the project's responsibility.

---

## Tool Selection Priority

Use the simplest sufficient tool for each scanning operation:
1. **Grep** — for finding patterns (TODO, FIXME, error-prone code) across the codebase
2. **Glob** — for discovering files by name pattern (test files, config files, modules)
3. **Read** — for examining specific files identified by Grep/Glob
4. **Bash** — only for commands that dedicated tools cannot do (git log, test runners)

Do not read entire files when Grep can find the relevant lines. Do not use Bash for searches that Grep handles.

---

## Execute All Phases Automatically

When `/pan:focus-scan` is invoked, execute all phases without stopping. Do not ask questions between phases or skip phases. The output is a prioritized work list with Reality Score filtering.

**Flags:**
- `--focus <area>` — Weight items toward a specific area (e.g., `--focus commands`, `--focus hooks`, `--focus tests`)
- `--quick` — Skip Phase 2 (strategic context) and Phase 6 (validation protocol)
- `--refresh` — Force re-read all files even if recently cached
- `--lean` — Apply aggressive Reality Score filtering: DROP items with RS < 1.5, DEFER items with RS < 3.0

---

## Phase 0: Orientation & Baseline Snapshot

**Circular optimization — init trace:**
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace init \
  --description "focus-scan" --command "focus-scan" 2>/dev/null || true
```

### 0.1 Read Current State
Read these files to establish baseline:

**Core Status:**
- `package.json` — Version, description, entry points
- `README.md` — Public documentation

**Project Structure:**
- All core modules in the project's source directories
- All command definitions
- All agent definitions
- All workflow definitions
- All hook source files

**Planning State:**
- `.planning/state.md` — Current state
- `.planning/roadmap.md` — Phase progress
- `.planning/config.json` — Project configuration
- `.planning/patterns.md` — Known error patterns (if exists)

### 0.2 Scan for Real Issues
Run targeted code searches to find actual problems:

```
Search for: "TODO", "FIXME", "HACK", "STUB", "stub"
In: source directories, hooks, tests
```

Cross-reference found issues with documented items — flag any UNDOCUMENTED issues as new findings.

### 0.3 Check Test Results
```bash
npm test 2>&1
```
Record: total tests, passing, failing, suites.

### 0.4 Baseline Snapshot Table

```markdown
| Metric | Value | Notes |
|--------|-------|-------|
| Version | X.Y.Z | |
| Tests | N/N | M suites |
| Build | OK/FAIL | |
| Commands | N | |
| Phases | N total, M incomplete | |
| TODOs Found | N | |
| Error Patterns | N | |
```

---

## Phase 1: Priority Classification

### Priority Framework (STRICT ORDER)

| Priority | Focus | Criteria |
|----------|-------|----------|
| **P0: CRASH/ERROR** | Runtime errors, uncaught exceptions | Any command that throws or produces wrong output |
| **P1: WRONG RESULTS** | Silent data corruption, incorrect output | Commands that succeed but produce bad data |
| **P2: TEST GAPS** | Missing test coverage | Features without tests or low assertion density |
| **P3: INCOMPLETE FEATURES** | Partially implemented commands or workflows | Commands that exist but lack full functionality |
| **P4: NEW FEATURES** | Net-new functionality from roadmap | Features not yet started |
| **P5: TOOLING** | Developer experience improvements | Hooks, CLI UX, error messages |
| **P6: DOCUMENTATION** | Docs sync, reference updates | Documentation-only changes |

### Classification Rules
- **Crashes before correctness** — A thrown error is always higher priority than wrong output
- **Correctness before coverage** — Wrong results are worse than missing tests
- **Quick wins first within each tier** — S-effort items before L-effort items

---

## Phase 2: Strategic Context (skip with --quick)

### 2.1 Read Strategy Documents
- `README.md` — What's the public-facing story?
- User guide / docs — What's documented for users?
- `CHANGELOG.md` — What's the recent trajectory?

### 2.2 Strategic Alignment Check
For each P4+ item, note whether it:
- Is on the critical path to the next milestone
- Enables other high-value work (dependency unblocking)
- Has been deferred multiple times

---

## Phase 2.5: Feature Reality Check (Market-Fit Scoring)

Every feature-tier item (P3-P6) must pass a reality check.

### Reality Score (RS)

```
RS = (User Value + Time Criticality + Risk Reduction) / Job Size
```

#### User Value (UV): 1-5
| Score | Meaning |
|-------|---------|
| 5 | Core workflow feature — every user needs this |
| 4 | Common usage — most projects need it |
| 3 | Significant audience — power users need it |
| 2 | Niche audience — specific use case |
| 1 | Academic / completion-only |

#### Time Criticality (TC): 1-5
| Score | Meaning |
|-------|---------|
| 5 | Blocks users from adopting the tool |
| 4 | Competitive table-stakes — other tools have it |
| 3 | Unlocks a significant new use case |
| 2 | Nice to have, users can work around |
| 1 | No urgency |

#### Risk Reduction (RR): 1-5
| Score | Meaning |
|-------|---------|
| 5 | Removes a crash or correctness bug |
| 4 | Unblocks 3+ downstream features |
| 3 | Unblocks 1-2 features |
| 2 | Incremental improvement |
| 1 | Polish / docs |

#### Job Size (JS)
| Effort | JS Value |
|--------|----------|
| XS | 1 |
| S | 2 |
| M | 3 |
| L | 5 |
| XL | 8 |

```
RS >= 3.0  ->  DO       — Include in next sessions
RS 1.5-2.9 ->  DEFER    — Include as deferred
RS < 1.5   ->  BACKLOG  — Move to backlog appendix
```

---

## Phase 3: Item Collection & Deduplication

### 3.1 Collect ALL Items
Gather items from:

1. **Test failures** — each failure = 1 item
2. **TODO/FIXME scan** — each finding = 1 item
3. **Missing test coverage** — each uncovered module = 1 item
4. **Incomplete commands** — each gap = 1 item
5. **Missing features** — from roadmap/README promises
6. **Documentation gaps** — each stale/missing doc = 1 item
7. **Error pattern prevention** — from patterns.md

### 3.2 Deduplicate
- Same file + same issue = same item
- Same feature described differently = same item

---

## Phase 4: Effort Estimation

| Size | Time | Lines Changed | Files |
|------|------|---------------|-------|
| XS | < 15 min | < 20 | 1 |
| S | 15-60 min | 20-100 | 1-2 |
| M | 1-4 hours | 100-500 | 2-5 |
| L | 4-8 hours | 500-2000 | 5-10 |
| XL | 8+ hours | 2000+ | 10+ |

---

## Phase 5: Scan Assembly

### 5.1 Output
Return JSON via `pan-tools focus scan` with all items, or write to `.planning/focus/` for persistence.

### 5.2 Document Structure

The scan output includes:
- Status Snapshot table
- Items grouped by priority tier (P0-P6)
- Each item: ID, title, symptom, root cause, fix guidance, files, effort
- Summary statistics (items by priority x effort)
- Recommended execution order (quick wins -> core fixes -> feature work)
- Feature Reality Check table (RS scores for P3-P6 items)
- Deferred items with rationale

---

## Phase 6: Validation Protocol (skip with --quick)

### 6.1 Cross-Check Completeness
Verify the scan covers:
- [ ] All failing tests (if any)
- [ ] All TODO/FIXME items from code scan
- [ ] All modules without test coverage
- [ ] All commands listed in README but not implemented
- [ ] All error patterns that need prevention

### 6.2 Sanity Check
- No item should appear twice
- Every P0-P2 item should have a specific file path
- Deferred items should have clear "revisit when" criteria

---

## NEVER DO

- Skip reading source files — the scan must be evidence-based
- List items without file paths (for code items)
- Create items with vague descriptions
- Include items that are already complete
- Include P3-P6 feature items without an RS score

## ALWAYS DO

- Deep-dive into actual code (grep for TODOs, read modules)
- Cross-reference tests against implementations
- Link every item to its source file
- Provide specific fix guidance
- Score every P3-P6 item with the RS formula
- Sort the Feature Reality Check table by RS descending
