# Workflow State Consistency & Multi-Runtime Manifest Coverage — Feature Specification

**Generated:** 2026-03-09
**Version:** 1.0
**Status:** Proposed
**Source:** Deployment audit of d:\xxxx (PAN v2.8.0, 5 runtimes: Claude, Gemini, OpenCode, Codex, Copilot CLI)

---

## Problem Statement

A deployment audit of a completed 5-phase Rust project with all 5 PAN runtimes installed simultaneously revealed systemic gaps in state consistency and multi-runtime manifest coverage:

1. **Workflow state not auto-updated on phase/plan completion.** When phases execute and complete, REQUIREMENTS.md checkboxes and ROADMAP.md plan checkboxes/counts are not automatically updated. In the audited project, STATE.md correctly showed 42/42 requirements and 9/9 plans complete, yet REQUIREMENTS.md had 28/43 unchecked and ROADMAP.md had 6/9 plans unchecked with wrong counts ("0/0 plans complete"). This creates a trust gap — the project appears incomplete when it is actually done.

2. **Copilot CLI runtime has 42 orphaned files.** The `.github/` runtime installed 39 skill files and 3 hook scripts that are not tracked in `pan-file-manifest.json`. The manifest generator does not cover `.github/copilot-skills/` or `.github/hooks/` paths, making these files invisible to the upgrade, patch-save, and validation systems.

3. **Hook files not tracked across any runtime.** The 3 hook scripts (`pan-check-update.js`, `pan-context-monitor.js`, `pan-statusline.js`) are absent from the manifest in all 5 runtimes (#154 files tracked, 0 hooks). User modifications to hooks are silently overwritten during `pan-update`.

4. **OpenCode runtime missing hook registration.** The `opencode.json` configuration file contains permissions but no hook registration entries. Context-monitor, status-line, and update-check hooks may not fire in the OpenCode runtime, degrading the user experience silently.

5. **Phase/plan naming inconsistency.** Phases 1-3 use `NN-PLAN-MM-slug.md` naming (e.g., `01-PLAN-01-cli-connection.md`) while Phases 4-5 use `NN-MM-PLAN.md` (e.g., `04-01-PLAN.md`). PAN's state-tracking code must handle both patterns, but the inconsistency suggests plan creation doesn't enforce a canonical format.

## Demand Evidence

| Evidence Type | Source | Finding |
|---|---|---|
| Deployment audit | d:\xxxx REQUIREMENTS.md | 28/43 requirement checkboxes unchecked despite all code implemented |
| Deployment audit | d:\xxxx ROADMAP.md | 6/9 plan checkboxes unchecked, plan counts showed "0/0" for completed phases |
| Deployment audit | d:\xxxx STATE.md | Correctly showed 42/42 requirements, 5/5 phases — inconsistent with REQUIREMENTS.md |
| Manifest scan | .github/pan-file-manifest.json | 154 entries; 39 skills + 3 hooks in `.github/` not tracked |
| Manifest scan | .claude/pan-file-manifest.json | 154 entries; 3 hooks not tracked (same as all runtimes) |
| Config review | .opencode/opencode.json | No hook registration section; only permissions present |
| File listing | .planning/phase-*/ | Plans 1-3 use `NN-PLAN-MM-slug` format; Plans 4-5 use `NN-MM-PLAN` format |
| Code review | install-lib.cjs `generateManifest()` | Skips `hooks/` directory and runtime-specific skill paths |

## Success Criteria

```
SC-1: Phase completion auto-updates REQUIREMENTS.md checkboxes for mapped requirements
SC-2: Phase completion auto-updates ROADMAP.md plan checkboxes and X/Y counts
SC-3: All installed files (hooks, skills, agents, commands, core) tracked in manifest across all 5 runtimes
SC-4: OpenCode runtime registers hooks in opencode.json during installation
SC-5: Plan creation enforces a single canonical naming format
SC-6: No regression in existing 1622+ tests
SC-7: STATE.md ↔ REQUIREMENTS.md ↔ ROADMAP.md consistency is verifiable via /pan:health
```

## Competitive Landscape

No competing AI workflow tool maintains cross-document state consistency or multi-runtime manifest tracking at this level.

| Tool | State Auto-Sync | Manifest Tracking | Multi-Runtime | Cross-Doc Validation |
|---|---|---|---|---|
| **PAN Wizard** | STATE.md only | Partial (no hooks) | 5 runtimes | None |
| **Aider** | N/A (no state) | None | 1 (CLI) | N/A |
| **Cursor** | N/A | None | 1 (editor) | N/A |
| **Cline** | N/A | None | 1 (editor) | N/A |

## Design

### Architecture

```
┌─────────────────────────────────────┐
│        Phase Execution Flow         │
│  (pan-executor completes a plan)    │
└──────────────┬──────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│   State Sync Module (NEW)            │
│  ┌────────────────────────────────┐  │
│  │ syncRequirements(phase, plans) │  │ ← Check requirement boxes mapped to completed phase
│  │ syncRoadmap(phase, plans)      │  │ ← Check plan boxes + update X/Y counts
│  │ validateConsistency()          │  │ ← Cross-check STATE ↔ REQ ↔ ROADMAP
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘

┌─────────────────────────────────────┐
│     Manifest Generator (ENHANCED)   │
│  generateManifest() now covers:     │
│  - pan-wizard-core/   ✓ (existing)  │
│  - commands/           ✓ (existing)  │
│  - agents/             ✓ (existing)  │
│  - hooks/              ★ (NEW)       │
│  - copilot-skills/     ★ (NEW)       │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│     OpenCode Installer (ENHANCED)   │
│  writeOpenCodeConfig() now adds:    │
│  - hook registration entries  ★ NEW  │
└─────────────────────────────────────┘
```

### Key Design Decisions

1. **State sync runs post-plan, not post-phase.** Each plan knows its parent phase and requirement mappings. Syncing after each plan gives incremental progress visibility rather than a batch update at phase end.
2. **Cross-doc validation added to /pan:health.** The `validate health` route gains a `state-consistency` check that compares STATE.md counts against REQUIREMENTS.md checkboxes and ROADMAP.md plan checkboxes.
3. **Manifest generation is additive.** Hooks and skills are added to the existing manifest structure — no schema change needed, just expanding the file walker's include paths.

## Feature Ladder

| Priority | Feature | Effort | Impact | Dependency |
|---|---|---|---|---|
| P0 | B.1 Manifest covers hooks in all runtimes | S | High | None |
| P0 | B.2 Manifest covers Copilot skills | S | High | None |
| P0 | B.3 OpenCode hook registration | S | Medium | None |
| P1 | B.4 State sync: REQUIREMENTS.md auto-update | M | High | None |
| P1 | B.5 State sync: ROADMAP.md auto-update | M | High | B.4 |
| P1 | B.6 Cross-doc consistency check in /pan:health | M | High | B.4, B.5 |
| P2 | B.7 Canonical plan naming enforcement | S | Low | None |
| P2 | B.8 Plan summary enforcement (all plans get SUMMARY.md) | S | Low | None |

## Implementation Tasks

| ID | Task | Points | Dependencies | Priority |
|---|---|---|---|---|
| B.1 | Add hooks/ to `generateManifest()` file walker in install-lib.cjs | 2 | — | P0 |
| B.2 | Add `.github/copilot-skills/` to manifest walker for Copilot runtime | 2 | — | P0 |
| B.3 | Add hook registration to `writeOpenCodeConfig()` in install.js | 2 | — | P0 |
| B.4 | Create `syncRequirements()` in state-mutations or new state-sync module | 5 | — | P1 |
| B.5 | Create `syncRoadmap()` — update plan checkboxes and X/Y counters | 5 | B.4 | P1 |
| B.6 | Add `state-consistency` check to `validate health` route | 3 | B.4, B.5 | P1 |
| B.7 | Enforce canonical `NN-PLAN-MM-slug.md` format in plan creation | 2 | — | P2 |
| B.8 | Check for missing SUMMARY.md on completed plans in health check | 2 | — | P2 |
| B.9 | Tests for B.1-B.3 (manifest and config) | 3 | B.1, B.2, B.3 | P0 |
| B.10 | Tests for B.4-B.6 (state sync and health) | 5 | B.4, B.5, B.6 | P1 |
| **Total** | | **31** | | |

### Dependency Graph

```
B.1 ──┐
B.2 ──┼── B.9 (tests)
B.3 ──┘
B.4 ──── B.5 ──┐
                ├── B.6 ──── B.10 (tests)
                │
B.7 (independent)
B.8 (independent)
```

## Test Plan

### Unit Tests
- `generateManifest()` includes hooks/ entries with correct SHA256
- `generateManifest()` includes `.github/copilot-skills/` for Copilot runtime
- `writeOpenCodeConfig()` produces valid JSON with hook registrations
- `syncRequirements()` checks boxes for specified requirement IDs
- `syncRoadmap()` checks plan boxes and updates count strings
- `validateConsistency()` returns mismatch list when STATE ↔ REQ diverge

### Integration Tests
- Full install + audit cycle: install all 5 runtimes → verify manifest covers all files
- Phase execution → verify REQUIREMENTS.md + ROADMAP.md updated
- `/pan:health` reports state inconsistency when manually introduced

### Acceptance Criteria
- Audit of a completed multi-phase project shows 0 state inconsistencies
- Audit of a multi-runtime install shows 0 orphaned files

## Security Considerations

- Manifest SHA256 hashes prevent undetected file tampering
- No user input enters file paths (all paths derived from known install prefixes)

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| State sync corrupts REQUIREMENTS.md | Medium | High | Write atomically (temp + rename); validate markdown structure before write |
| Regex-based checkbox update mismatches | Medium | Medium | Unit tests with diverse markdown formatting; match requirement IDs exactly |
| OpenCode hook format changes | Low | Medium | Pin to known opencode.json schema; test against current version |
| Plan naming migration breaks existing projects | Low | Medium | Enforce only on new plans; add migration command for existing projects |

## Sources

- Deployment audit of d:\xxxx (2026-03-09): 5-runtime install, completed Rust project
- Deployment audit of d:\pantesting (2026-03-09): fresh Claude single-runtime install
- PAN Wizard source: install-lib.cjs `generateManifest()`, install.js `writeOpenCodeConfig()`
- PAN executor agent: pan-executor.md phase completion flow
