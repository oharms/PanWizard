---
name: focus-plan
group: Focus
description: Create capacity-budgeted work batch with spec coverage verification and 4 execution modes
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
---

# /pan:focus-plan — Capacity-Budgeted Work Batch Planner with Spec Coverage Verification

Create a capacity-budgeted work batch from focus-scan results **with mandatory verification that planned work covers all relevant spec and ADR requirements.** $ARGUMENTS

**Goal:** Select a right-sized batch of work items that (a) fits within the session's point budget, (b) is ordered for maximum impact with minimum risk, and (c) demonstrably covers the requirements from any associated specs, ADRs, and success criteria — flagging coverage gaps BEFORE execution begins.

---

## CRITICAL: Project Scope Boundary

This command plans work batches for the **host project** — NOT for PAN Wizard's own infrastructure.

**NEVER include items targeting these PAN directories:**
- `.claude/`, `.github/copilot-instructions.md`, `.opencode/`, `.gemini/`, `.codex/` — PAN runtime directories
- Any `pan-wizard-core/`, `pan-tools`, agent `.md`, or command `.md` files within PAN runtime directories

If a scan item points to a PAN infrastructure file, DROP it from the batch. PAN's files are not the project's responsibility.

---

## MANDATORY: Run focus-scan first

If no recent scan exists, run `/pan:focus-scan` automatically before proceeding.

**Flags:**
- `--budget N` — Override capacity budget in points (default: 50, min: 5, max: 100)
- `--mode MODE` — Execution mode. Default: `balanced`
  - `bugfix` — P0->P1->smallest-first, no feature work (40 pts)
  - `balanced` — **Default.** Mix of stability fixes + feature development, 60/40 split (50 pts)
  - `features` — Feature-focused: 80% budget on P3-P5, P0 crashes still mandatory (50 pts)
  - `full` — Full-spectrum: enhanced budget, all priorities equally weighted (60 pts)
- `--priority P0-P6` — Only pick items from these priority tiers
- `--lean` — Apply RS filtering: exclude items with RS < 1.5
- `--no-spec-check` — Skip spec coverage verification (NOT recommended — use only for pure bugfix batches)

---

## Phase 1: Spec & ADR Discovery (MANDATORY)

> *Before planning work, understand what has been designed and promised.*

### 1.1 Scan for Specifications
Search the project for feature specifications and design documents:
- `docs/specs/*.md` or `docs/specs/**/*.md`
- `.planning/specs/` or `.planning/designs/`
- Any `*_featureai.md`, `*_spec.md`, `*_design.md` files
- README sections describing planned features

For each spec found, extract:

| Spec File | Feature Name | Status | Requirements Count | Success Criteria Count |
|-----------|-------------|--------|-------------------|----------------------|
| [path] | [name] | Proposed/In Progress/Complete | [N] | [N] |

### 1.2 Scan for ADRs
Search for Architecture Decision Records:
- `docs/decisions/ADR-*.md`
- `.planning/decisions/`

For each ADR, extract:

| ADR | Decision | Status | Success Criteria | Implementation Tasks |
|-----|----------|--------|-----------------|---------------------|
| [ADR-NNNN] | [summary] | Proposed/Accepted/Implemented | [count or "none defined"] | [count or "none defined"] |

### 1.3 Extract Requirement Inventory
From every spec and ADR found, build a **master requirements list**:

| Req ID | Source | Requirement | Type | Implemented? |
|--------|--------|-------------|------|-------------|
| SC-1 | ADR-0015 | JWT auth with 4-role RBAC | Feature | Yes/No/Partial |
| SC-2 | spec/extraction.md | Image extraction for JPG/PNG | Feature | Yes/No/Partial |
| T-3 | ADR-0018 §Task 6 | Unmatched description table | Task | Yes/No/Partial |
| BRK-1 | ADR-0018 §Breaking | Hierarchy roll-up for backward compat | Migration | Yes/No/Partial |

**Verification method for "Implemented?":**
- Search the codebase for files, classes, functions, routes, or tests matching each requirement
- Check if tests exist that verify the requirement
- Mark as `Partial` if code exists but tests don't, or if the feature is stubbed

### 1.4 Identify Unimplemented Requirements
Filter the master list to requirements where `Implemented? = No` or `Partial`:

| Req ID | Source | Requirement | Gap Type | Estimated Effort |
|--------|--------|-------------|----------|-----------------|
| SC-2 | ADR-0018 | Keyword count >= 500 | Not started | M |
| T-6 | ADR-0018 | Unmatched description table | Not started | M |
| BRK-1 | ADR-0018 | Hierarchy roll-up | Partial (code, no tests) | S |

This becomes the **spec gap backlog** — items that specs/ADRs promised but the codebase doesn't deliver yet.

---

## Phase 2: Capacity Budget System

| Size | Points | Per Session | Meaning |
|------|--------|-------------|---------|
| **XS** | 1 | Up to 40 | Config tweak, typo fix |
| **S** | 2 | Up to 20 | Single-file bug fix, add tests |
| **M** | 4 | Up to 10 | Multi-file feature, new test suite |
| **L** | 10 | Up to 4 | Multi-module change, new command |
| **XL** | 20 | Up to 2 | New subsystem, major refactor |

---

## Phase 3: Execution Modes & Batch Selection

### `bugfix` — Stability-First
- **Budget:** 40 pts
- **Algorithm:** P0 mandatory -> P1 -> P2-P4 smallest-first
- **Feature allocation:** None
- **Spec coverage:** Verify P0/P1 items close spec gaps where applicable

### `balanced` — Mix of Fixes + Features (DEFAULT)
- **Budget:** 50 pts
- **Stability pass (60%):** 30 pts for P0-P2
- **Feature pass (40%):** 20 pts for P3-P6
- **Spec coverage:** Cross-reference feature items against spec gap backlog — prefer items that close gaps

### `features` — Feature-Focused Sprint
- **Budget:** 50 pts
- **Mandatory pass:** All P0 items
- **Feature pass (80%):** 40 pts for P3-P5
- **Stability pass (20%):** 10 pts for P1-P2 quick wins
- **Spec coverage:** Feature items MUST map to spec requirements — reject unspecified feature work

### `full` — Full-Spectrum Marathon
- **Budget:** 60 pts
- **All priorities weighted equally, largest-impact-first**
- **Spec coverage:** Full traceability — every item maps to a spec/ADR requirement or is flagged as unspecified

### Batch Selection Algorithm
1. Build candidate list from focus-scan results
2. **For each candidate, attempt to map it to a spec/ADR requirement** (by keyword match, file overlap, or feature area)
3. Score candidates: `impact_score = base_priority_score + spec_coverage_bonus`
   - Items that close spec gaps get +2 priority bonus
   - Items that close success criteria get +3 priority bonus
   - Items with no spec mapping get +0 (no penalty, but no bonus)
4. Apply mode-specific budget allocation
5. Select items greedily by score until budget exhausted

---

## Phase 4: Spec Coverage Analysis (MANDATORY unless `--no-spec-check`)

> *The most important output of focus-plan: does the batch actually deliver against what was designed?*

### 4.1 Coverage Matrix
For each spec/ADR requirement, show whether the batch covers it:

| Req ID | Source | Requirement | Batch Item | Coverage |
|--------|--------|-------------|-----------|----------|
| SC-1 | ADR-0018 | Category count >= 65 | #3: Expand categories | COVERED |
| SC-2 | ADR-0018 | Keyword count >= 500 | #4: Expand keywords | COVERED |
| SC-3 | ADR-0018 | Unmatched queue API | — | **GAP** |
| SC-4 | ADR-0018 | NCA affordability output | — | **GAP (deferred to v1)** |
| SC-5 | ADR-0018 | No regression | #1: Run existing tests | COVERED |

### 4.2 Coverage Score
```
Spec Coverage: X / Y requirements covered (Z%)
├── Fully covered:    N items
├── Partially covered: N items (code but no tests, or tests but incomplete)
├── Gaps:             N items (not in batch)
└── Deferred:         N items (explicitly deferred to future version)
```

### 4.3 Gap Analysis & Justification
For every **GAP** in the coverage matrix, provide:

| Gap | Requirement | Why Not In This Batch | When Will It Be Addressed |
|-----|------------|----------------------|--------------------------|
| SC-3 | Unmatched queue API | Exceeds budget (M=4pts, only 2pts remaining) | Next batch (features mode) |
| SC-4 | NCA affordability | Depends on SC-1 + SC-2 (must complete first) | After category expansion |

**CRITICAL:** If the coverage score is < 50% for a spec that has `Status: In Progress`, flag this prominently:
```
⚠️ WARNING: Batch covers only X% of [spec name] requirements.
   Y requirements remain unaddressed. Consider:
   - Increasing budget (--budget N)
   - Switching to features mode (--mode features)
   - Breaking spec into smaller milestones
```

### 4.4 Dependency Verification
Check that batch items respect dependency ordering from specs:

| Batch Item | Depends On | Dependency In Batch? | Order Correct? |
|-----------|-----------|---------------------|----------------|
| #4: Keywords | #3: Categories | Yes | Yes (#3 before #4) |
| #6: Suggestions | #5: Unmatched API | No — #5 not in batch | **BLOCKED** |

**If any item is BLOCKED:** Either add the dependency to the batch (if budget allows) or remove the blocked item and flag it.

### 4.5 Success Criteria Verification Plan
For each success criterion in the batch, specify HOW it will be verified after execution:

| SC ID | Criterion | Verification Command | Expected Result |
|-------|-----------|---------------------|-----------------|
| SC-1 | Category count >= 65 | `SELECT COUNT(*) FROM stx_category` | >= 65 |
| SC-2 | Keywords >= 500 | `SELECT COUNT(*) FROM stx_keyword` | >= 500 |
| SC-5 | No regression | `dotnet test` | All pass, count >= N |

This becomes the post-execution checklist for `/pan:focus-exec`.

---

## Phase 5: Output

Produce a batch file at `.planning/focus/batch-<YYYY-MM-DD>.json` via `pan-tools focus plan`:

```markdown
## Focus Batch — <date>
**Mode:** balanced | **Budget:** 50 pts | **Allocated:** N pts
**Specs referenced:** N specs, M ADRs
**Spec coverage:** X/Y requirements (Z%)

### Batch Items

| # | ID | Title | Priority | Size | Pts | Tier | Track | Spec Req |
|---|----|-------|----------|------|-----|------|-------|----------|
| 1 | P0-1 | Fix crash in state cmd | P0 | S | 2 | MICRO | Stability | ADR-0005 SC-3 |
| 2 | P2-3 | Add tests for milestone | P2 | M | 4 | STANDARD | Stability | — |
| 3 | P3-1 | Expand category taxonomy | P3 | M | 4 | STANDARD | Feature | ADR-0018 SC-1 |

### Spec Coverage Summary

| Source | Total Reqs | Covered | Gaps | Deferred |
|--------|-----------|---------|------|----------|
| ADR-0018 | 7 | 3 | 2 | 2 |
| spec/extraction.md | 5 | 5 | 0 | 0 |
| **Total** | **12** | **8 (67%)** | **2** | **2** |

### Uncovered Requirements (Gaps)

| Req | Source | Reason | Next Batch? |
|-----|--------|--------|-------------|
| Unmatched queue API | ADR-0018 SC-3 | Budget exceeded | Yes — features mode |
| NCA affordability | ADR-0018 SC-4 | Blocked by SC-1, SC-2 | After this batch |

### Dependency Order
```
#1 (P0 crash fix) → independent
#3 (categories) → #4 (keywords) → #5 (match types)
#2 (tests) → independent
```

### Post-Execution Verification Checklist
- [ ] SC-1: Category count >= 65 → `SELECT COUNT(*) FROM stx_category`
- [ ] SC-2: Keywords >= 500 → `SELECT COUNT(*) FROM stx_keyword`
- [ ] SC-5: All existing tests pass → `dotnet test`

Execution Order: MICRO first, then STANDARD, then FULL
```

Ready for `/pan:focus-exec`.

---

## NEVER DO

- Plan a batch without checking specs and ADRs for coverage gaps
- Include a feature item that contradicts or conflicts with an accepted ADR
- Ignore dependency ordering defined in specs (Task A before Task B)
- Claim 100% spec coverage without actually verifying each requirement against the codebase
- Include blocked items (items whose dependencies are not in the batch and not yet implemented)
- Silently drop spec requirements — every gap must be justified and scheduled
- Plan implementation tasks that aren't traceable to a spec, ADR, scan finding, or user request
- Exceed the capacity budget (hard limit — not "approximately")

## ALWAYS DO

- Discover ALL specs and ADRs before selecting batch items
- Cross-reference every batch item against spec requirements where applicable
- Flag coverage gaps prominently with justification and scheduling
- Verify dependency ordering matches spec-defined task dependencies
- Include a post-execution verification checklist with concrete commands
- Prefer items that close spec gaps over items with no spec mapping (when priority is equal)
- State the coverage score as a percentage in the batch header
- Report unimplemented success criteria that aren't addressed by this batch
