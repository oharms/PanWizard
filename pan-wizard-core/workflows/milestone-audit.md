<purpose>
Verify milestone achieved its definition of done by aggregating phase verifications, checking cross-phase integration, and assessing requirements coverage. Reads existing verification.md files (phases already verified during execute-phase), aggregates tech debt and deferred gaps, then spawns integration checker for cross-phase wiring.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

## 0. Initialize Milestone Context

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init milestone-op)
```

Extract from init JSON: `milestone_version`, `milestone_name`, `phase_count`, `completed_phases`, `commit_docs`. `{version}` below is the version without its leading `v` (the argument, else `milestone_version` with the `v` removed: `v1.0` → `1.0`), so `v{version}-milestone-audit.md` names the `v1.0-milestone-audit.md` that `/pan:milestone-done` looks for.

**Also extract `planning_root` and `track`, and use `$PLANNING_ROOT` for every planning path in this workflow** — the project may hold several planning trees, and auditing the wrong one produces a confident, plausible, wrong report:

```bash
PLANNING_ROOT=$(printf '%s' "$INIT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).planning_root))")
```

### 0a. Which tree am I auditing?

**Always state the resolved `planning_root` at the top of the audit report.** If `planning_root_exists` is `false`, STOP — that is a mistyped `--track`, not an empty milestone.

To audit a specific tree, add `--track <name>` to every `pan-tools` call in this workflow (each call resolves its own planning root). To see every tree's milestone state before choosing:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init milestone-op --all-tracks
```

That returns `{track_count, ambiguous_tracks, tracks[]}`, one entry per planning tree, each with its own `planning_root`, `milestone_version`, `milestone_name`, and `milestone_basis`.

### 0b. Refuse to audit an unresolvable milestone

The init payload carries how the milestone was decided:

- `milestone_basis` — `marked-current` (a `(current)` / 🚧 marker), `first-unshipped`, `last-shipped`, `state` (state.md's `milestone:`), `no-milestone-heading`, or `default` (no roadmap.md)
- `milestone_ambiguous` — **`true` means the roadmap marks more than one milestone current**

**If `milestone_ambiguous` is `true`, STOP and report the planning-state error.** Do not audit. Two milestones marked current is a roadmap defect the owner must resolve; picking one silently is how an audit ends up describing a milestone that does not exist.

If `milestone_basis` is `no-milestone-heading` (no milestone heading, none recorded in state.md) or `default` (no roadmap.md), say so rather than auditing `v1.0 milestone`; `state` means the version came from state.md's `milestone:`.

Resolve integration checker model:
```bash
CHECKER_MODEL=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs resolve-model pan-integration-checker --raw)
```

## 1. Determine Milestone Scope

```bash
# Get phases in milestone (sorted numerically, handles decimals)
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phases list
```

- Parse version from arguments or detect current from roadmap.md
- Identify all phase directories in scope
- Extract milestone definition of done from roadmap.md
- Extract requirements mapped to this milestone from requirements.md

## 2. Read All Phase Verifications

For each phase directory, read the verification.md:

```bash
# For each phase, find-phase resolves its directory under phases/ (zero-padding handled; archived milestones are not searched)
PHASE_DIR=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs find-phase 01 --raw)
# --raw prints the directory itself (empty when not found); read verification.md from it
# Repeat for each phase number from roadmap.md
```

From each verification.md, extract:
- **Status:** passed | gaps_found
- **Critical gaps:** (if any — these are blockers)
- **Non-critical gaps:** tech debt, deferred items, warnings
- **Anti-patterns found:** TODOs, stubs, placeholders
- **Requirements coverage:** which requirements satisfied/blocked

If a phase is missing verification.md, flag it as "unverified phase" — this is a blocker.

### 2b. Read the Recorded Findings

What the judges found in this milestone, and what was decided about each finding, is on record. Read it rather than reconstructing it from prose:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs findings debt --milestone "{version}"   # with or without the leading v
```

- **`deferred`** findings were continued past on purpose, and each carries the reason recorded at the time. They are the milestone's tech debt: put every one in `tech_debt`, with its id and reason.
- **`open`** findings were never disposed (no fix, deferral, dismissal or decision). List them under "Undisposed findings" in the report. They are not blockers by themselves: the verification gate handles blockers. They do mean the milestone cannot be `passed`, so the status is at least `tech_debt`.
- A dismissal or decision is settled and not debt. `findings list --milestone "{version}" --status dismissed` shows the dismissals and their reasons when the report needs them.

## 3. Spawn Integration Checker

With phase context collected:

Extract `MILESTONE_REQ_IDS` from requirements.md traceability table — all REQ-IDs assigned to phases in this milestone.

```
Task(
  prompt="Check cross-phase integration and E2E flows.

Phases: {phase_dirs}
Phase exports: {from SUMMARYs}
API routes: {routes created}

Milestone Requirements:
{MILESTONE_REQ_IDS — list each REQ-ID with description and assigned phase}

MUST map each integration finding to affected requirement IDs where applicable.

Verify cross-phase wiring and E2E user flows.",
  subagent_type="pan-integration-checker",
  model="{CHECKER_MODEL}"
)
```

## 4. Collect Results

Combine:
- Phase-level gaps and tech debt (from step 2)
- Integration checker's report (wiring gaps, broken flows)

## 5. Check Requirements Coverage (3-Source Cross-Reference)

MUST cross-reference three independent sources for each requirement:

### 5a. Parse requirements.md Traceability Table

Extract all REQ-IDs mapped to milestone phases from the traceability table:
- Requirement ID, description, assigned phase, current status, checked-off state (`[x]` vs `[ ]`)

### 5b. Parse Phase verification.md Requirements Tables

For each phase's verification.md, extract the expanded requirements table:
- Requirement | Source Plan | Description | Status | Evidence
- Map each entry back to its REQ-ID

### 5c. Extract summary.md Frontmatter Cross-Check

For each phase's summary.md, extract `requirements-completed` from YAML frontmatter:
```bash
for summary in "$PLANNING_ROOT"/phases/*-*/*-summary.md; do
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs frontmatter get "$summary" --field requirements-completed --raw
done
```

### 5d. Status Determination Matrix

For each REQ-ID, determine status using all three sources:

| verification.md Status | SUMMARY Frontmatter | requirements.md | → Final Status |
|------------------------|---------------------|-----------------|----------------|
| passed                 | listed              | `[x]`           | **satisfied**  |
| passed                 | listed              | `[ ]`           | **satisfied** (update checkbox) |
| passed                 | missing             | any             | **partial** (verify manually) |
| gaps_found             | any                 | any             | **unsatisfied** |
| missing                | listed              | any             | **partial** (verification gap) |
| missing                | missing             | any             | **unsatisfied** |

### 5e. FAIL Gate and Orphan Detection

**REQUIRED:** Any `unsatisfied` requirement MUST force `gaps_found` status on the milestone audit.

**Orphan detection:** Requirements present in requirements.md traceability table but absent from ALL phase verification.md files MUST be flagged as orphaned. Orphaned requirements are treated as `unsatisfied` — they were assigned but never verified by any phase.

## 6. Aggregate into v{version}-milestone-audit.md

Create `{planning_root}/v{version}-milestone-audit.md` with:

```yaml
---
milestone: {version}
audited: {timestamp}
status: passed | gaps_found | tech_debt
scores:
  requirements: N/M
  phases: N/M
  integration: N/M
  flows: N/M
gaps:  # Critical blockers
  requirements:
    - id: "{REQ-ID}"
      status: "unsatisfied | partial | orphaned"
      phase: "{assigned phase}"
      claimed_by_plans: ["{plan files that reference this requirement}"]
      completed_by_plans: ["{plan files whose SUMMARY marks it complete}"]
      verification_status: "passed | gaps_found | missing | orphaned"
      evidence: "{specific evidence or lack thereof}"
  integration: [...]
  flows: [...]
tech_debt:  # Non-critical, deferred — from `findings debt` (step 2b) plus anything the verifications list
  - phase: 01-auth
    items:
      - "[f_81ab3c9d20] no password strength validation — deferred: accepted at review: PASS_WITH_WARNINGS"
      - "TODO: add rate limiting"
  - phase: 03-dashboard
    items:
      - "Deferred: mobile responsive layout"
---
```

Plus full markdown report with tables for requirements, phases, integration, tech debt.

**Status values:**
- `passed` — all requirements met, no critical gaps, minimal tech debt
- `gaps_found` — critical blockers exist
- `tech_debt` — no blockers but accumulated deferred items need review, or recorded findings were never disposed

## 7. Present Results

Route by status (see `<offer_next>`).

</process>

<offer_next>
Output this markdown directly (not as a code block). Route based on status:

---

**If passed:**

## ✓ Milestone {version} — Audit Passed

**Score:** {N}/{M} requirements satisfied
**Report:** {planning_root}/v{version}-milestone-audit.md

All requirements covered. Cross-phase integration verified. E2E flows complete.

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Complete milestone** — archive and tag

/pan:milestone-done {version}

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

---

**If gaps_found:**

## ⚠ Milestone {version} — Gaps Found

**Score:** {N}/{M} requirements satisfied
**Report:** {planning_root}/v{version}-milestone-audit.md

### Unsatisfied Requirements

{For each unsatisfied requirement:}
- **{REQ-ID}: {description}** (Phase {X})
  - {reason}

### Cross-Phase Issues

{For each integration gap:}
- **{from} → {to}:** {issue}

### Broken Flows

{For each flow gap:}
- **{flow name}:** breaks at {step}

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Plan gap closure** — create phases to complete milestone

/pan:milestone-gaps

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

**Also available:**
- cat {planning_root}/v{version}-milestone-audit.md — see full report
- /pan:milestone-done {version} — proceed anyway (accept tech debt)

───────────────────────────────────────────────────────────────

---

**If tech_debt (no blockers but accumulated debt):**

## ⚡ Milestone {version} — Tech Debt Review

**Score:** {N}/{M} requirements satisfied
**Report:** {planning_root}/v{version}-milestone-audit.md

All requirements met. No critical blockers. Accumulated tech debt needs review.

### Tech Debt by Phase

{For each phase with debt:}
**Phase {X}: {name}**
- {item 1}
- {item 2}

### Total: {N} items across {M} phases

───────────────────────────────────────────────────────────────

## ▶ Options

**A. Complete milestone** — accept debt, track in backlog

/pan:milestone-done {version}

**B. Plan cleanup phase** — address debt before completing

/pan:milestone-gaps

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────
</offer_next>

<success_criteria>
- [ ] Milestone scope identified
- [ ] All phase verification.md files read
- [ ] summary.md `requirements-completed` frontmatter extracted for each phase
- [ ] requirements.md traceability table parsed for all milestone REQ-IDs
- [ ] 3-source cross-reference completed (VERIFICATION + SUMMARY + traceability)
- [ ] Orphaned requirements detected (in traceability but absent from all VERIFICATIONs)
- [ ] Tech debt and deferred gaps aggregated
- [ ] Integration checker spawned with milestone requirement IDs
- [ ] v{version}-milestone-audit.md created with structured requirement gap objects
- [ ] FAIL gate enforced — any unsatisfied requirement forces gaps_found status
- [ ] Results presented with actionable next steps
</success_criteria>
