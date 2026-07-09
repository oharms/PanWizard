---
name: pan:audit-deployment
group: System
description: Audit a PAN Wizard deployment — verify installation integrity, project health, and draft enhancement specs
argument-hint: <target-directory> [--enhancements] [--repair]
allowed-tools:
  - Read
  - Bash
  - Write
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Audit a directory where PAN Wizard was installed and a project was run. Verify installation integrity, validate project artifacts, assess workflow execution quality, and optionally produce a featureAI-format enhancement spec that superplan.md can consume for development planning.
</objective>

<execution_context>
This command operates on a TARGET directory (not the PAN source repo). The target must be provided as the first argument.
</execution_context>

<process>

<step name="parse_args">
**Parse arguments:**

Extract target directory path from the first argument. It is REQUIRED.

```
TARGET_DIR = first positional argument
ENHANCEMENTS_FLAG = "--enhancements" present?
REPAIR_FLAG = "--repair" present?
```

If no target directory is provided, ask the user:
> Which directory should I audit? Provide the full path to the folder where PAN Wizard was installed and a project was run.

Validate the directory exists before proceeding.
</step>

<investigate_before_judging>
Never report a file as missing, broken, or misconfigured without reading it first.
For every audit check: read the actual file, verify its contents, then state the finding with evidence.
Do not speculate about file contents based on filenames alone.
</investigate_before_judging>

<step name="installation_audit">
**Phase 1 — Installation Integrity Audit**

Check the PAN Wizard installation artifacts in the target directory. Determine which runtime was used (Claude, Gemini, OpenCode, Codex, Copilot) by checking for config directories:

```
Claude:   <target>/.claude/
Gemini:   <target>/.gemini/
OpenCode: <target>/.opencode/
Codex:    <target>/.codex/
Copilot:  <target>/.copilot/ (or ~/.copilot/)
GitHub:   <target>/.github/
```

For the detected runtime config directory (CONFIG_DIR), audit ALL of the following:

**1.1 Core Files (CRITICAL)**
- [ ] `CONFIG_DIR/pan-wizard-core/VERSION` exists — read and record version
- [ ] `CONFIG_DIR/pan-wizard-core/CHANGELOG.md` exists
- [ ] `CONFIG_DIR/pan-file-manifest.json` exists — parse and validate JSON
- [ ] `CONFIG_DIR/package.json` exists — should contain `{"type":"commonjs"}`

**1.2 Core Modules**
- [ ] `CONFIG_DIR/pan-wizard-core/bin/pan-tools.cjs` exists (CLI dispatcher)
- [ ] `CONFIG_DIR/pan-wizard-core/bin/lib/` directory exists
- Every `bin/lib/*.cjs` file listed in `pan-file-manifest.json` exists on disk (the manifest is the authoritative expected set — never hardcode a module count)

**1.3 Workflows, Templates, References**
- [ ] `CONFIG_DIR/pan-wizard-core/workflows/` — non-empty, every manifest-listed workflow present
- [ ] `CONFIG_DIR/pan-wizard-core/templates/` — non-empty, every manifest-listed template present
- [ ] `CONFIG_DIR/pan-wizard-core/references/` — non-empty, every manifest-listed reference present

**1.4 Commands**
- For Claude/Gemini: `CONFIG_DIR/commands/pan/` — every manifest-listed command `.md` present
- For OpenCode: `CONFIG_DIR/command/` — every manifest-listed `pan-*.md` present
- For Codex/Copilot: `CONFIG_DIR/skills/pan-*/SKILL.md` — every manifest-listed skill directory present

**1.5 Agents**
- [ ] `CONFIG_DIR/agents/` — every manifest-listed agent file present
- Verify key agents exist: pan-planner, pan-executor, pan-verifier, pan-debugger

**1.6 Hooks**
- [ ] `CONFIG_DIR/hooks/pan-statusline.js` exists
- [ ] `CONFIG_DIR/hooks/pan-check-update.js` exists
- [ ] `CONFIG_DIR/hooks/pan-context-monitor.js` exists

**1.7 Settings/Config**
- [ ] Settings file exists (settings.json / opencode.json / config.json)
- [ ] Hooks are registered in settings (SessionStart, PostToolUse, statusLine)
- [ ] Hook commands point to existing files

**1.8 Manifest Integrity**
- Read `pan-file-manifest.json`
- For each file in the manifest, verify it exists on disk
- Flag any MISSING files (manifest says exists, disk says no)
- Flag any MODIFIED files (hash mismatch) — these are user customizations, not errors
- Flag any ORPHANED files (on disk but not in manifest)

Record all findings with severity: CRITICAL (missing core), WARNING (missing optional), INFO (modifications).
</step>

<step name="project_audit">
**Phase 2 — Project Artifacts Audit**

Check `.planning/` directory in the target:

**2.1 Core Planning Files**
- [ ] `.planning/config.json` — exists, valid JSON, has required keys (mode, depth, model_profile, workflow)
- [ ] `.planning/project.md` — exists, has "What This Is", "Core Value", "Requirements" sections
- [ ] `.planning/state.md` — exists, has "Current Position", "Performance Metrics" sections
- [ ] `.planning/roadmap.md` — exists, has phase table
- [ ] `.planning/requirements.md` — exists if project used requirements tracking

**2.2 Phase Directories**
- Scan for `phase_*` or `*-*` numbered directories
- For each phase directory:
  - [ ] PLAN.md exists (phase summary)
  - [ ] At least one plan_*.md file exists
  - [ ] verification.md exists (phase was verified)
- Count: total phases, phases with plans, phases verified, phases with gaps

**2.3 Research Artifacts** (if brownfield/research was enabled)
- [ ] `.planning/research/` directory exists
- Check for stack.md, features.md, architecture.md, pitfalls.md
- [ ] `.planning/codebase/` directory exists (brownfield)

**2.4 State Consistency**
- Parse state.md "Current Position" — extract phase number
- Count actual phase directories — do they match?
- Check roadmap.md phase count vs actual directories
- Verify no orphaned .continue-here-*.md files (paused but not resumed)

**2.5 Config Sanity**
- Validate config.json values are within expected ranges
- mode: "yolo" | "interactive"
- depth: "quick" | "standard" | "comprehensive"
- model_profile: "quality" | "balanced" | "budget"
- workflow agents: all boolean
</step>

<step name="workflow_quality_audit">
**Phase 3 — Workflow Execution Quality**

Assess how well the project workflow was followed:

**3.1 Planning Quality**
For each phase with a PLAN.md:
- Does it have clear objectives?
- Does it reference requirements?
- Are plans sequential with dependencies noted?
- Grade: Complete / Partial / Stub

**3.2 Verification Coverage**
- Count phases with verification.md vs total phases
- Check if verifications have pass/fail outcomes
- Flag phases that were executed but never verified

**3.3 Commit History** (if git repo)
- Check if `.planning/` is tracked in git (config.json commit_docs)
- Look for atomic commit patterns (one commit per plan)
- Check for PAN-style commit messages

**3.4 Session Continuity**
- Check for .continue-here-*.md files (indicates paused sessions)
- Check state.md session logs for gaps
- Look for evidence of context loss (repeated work, contradictory decisions)

**3.5 Todo Management**
- Check `.planning/todos/` directory
- Count pending vs completed
- Flag stale todos (captured but never addressed)
</step>

<step name="report">
**Phase 4 — Generate Audit Report**

Format findings as a structured report:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN Deployment Audit
 Target: <target-directory>
 Date: <YYYY-MM-DD>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Summary

| Category               | Status   | Score |
|------------------------|----------|-------|
| Installation Integrity | ✓/⚠/✗   | N/N   |
| Project Artifacts      | ✓/⚠/✗   | N/N   |
| Workflow Quality        | ✓/⚠/✗   | N/N   |
| Overall                | HEALTHY / DEGRADED / BROKEN | N% |

Runtime: <detected runtime>
PAN Version: <version from VERSION file>
Phases: <completed>/<total>
Verification Coverage: <N>%

## Installation Integrity

### Critical Issues
- [I-C01] <description> — <fix>

### Warnings
- [I-W01] <description> — <suggestion>

### Info
- [I-I01] <description>

### Modified Files (User Customizations)
- <file> — hash mismatch (expected: abc..., actual: def...)

## Project Artifacts

### Critical Issues
- [P-C01] <description> — <fix>

### Warnings
- [P-W01] <description> — <suggestion>

### Phase Health
| Phase | PLAN.md | Plans | Verified | Status |
|-------|---------|-------|----------|--------|
| 01    | ✓       | 3     | ✓        | Complete |
| 02    | ✓       | 5     | ✗        | Unverified |

## Workflow Quality

### Observations
- Planning quality: <grade>
- Verification coverage: <N>%
- Commit discipline: <grade>
- Session continuity: <grade>

### Recommendations
1. <actionable recommendation>
2. <actionable recommendation>
```

If `--repair` flag was provided, attempt auto-fixes for repairable issues:
- Regenerate missing settings.json with default hook config
- Create missing .planning/config.json with defaults
- Remove orphaned .continue-here-*.md files

Report repairs performed.
</step>

<step name="enhancements">
**Phase 5 — Enhancement Spec Generation** (only if `--enhancements` flag)

Based on audit findings, generate a featureAI-format enhancement spec at `docs/specs/deployment_audit_findings_featureai.md` in the PAN SOURCE repository (NOT the target directory).

The spec MUST follow this exact format to be consumable by superplan.md:

```markdown
# [Enhancement Title] — Feature Specification

**Generated:** <YYYY-MM-DD>
**Version:** 1.0
**Status:** Proposed
**Source:** Deployment audit of <target-directory>

---

## Problem Statement

[Describe the problems discovered during the audit. What is broken, missing, or suboptimal in PAN Wizard based on real-world deployment evidence?]

## Demand Evidence

| Evidence Type | Source | Finding |
|---|---|---|
| Deployment audit | <target-dir> | <specific finding> |
| ... | ... | ... |

## Success Criteria

```
SC-1: <measurable criterion>
SC-2: <measurable criterion>
```

## Design

[Proposed changes to PAN Wizard to address the findings]

### Architecture

[How the fix/enhancement integrates with existing PAN architecture]

## Feature Ladder

| Version | Scope | Value | Effort |
|---|---|---|---|
| **v0 (MVP)** | <scope> | <value> | <effort> |
| **v1** | <scope> | <value> | <effort> |

## Implementation Tasks

| # | ID | Title | Files | Effort | Pts | Priority |
|---|---|---|---|---|---|---|
| 1 | A.1 | <task> | <files> | S/M/L | N | P1-P4 |

### Dependency Graph

```
A.1 ──> A.2 ──> A.3
```

## Test Plan

| Level | Count | What It Catches |
|---|---|---|
| Unit | N+ | <description> |
| Integration | N+ | <description> |

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| <risk> | Low/Med/High | Low/Med/High | <mitigation> |

---

*Generated by /pan:audit-deployment — <YYYY-MM-DD>*
```

Group findings into logical enhancement categories:
1. **Installer gaps** — Missing files, broken hooks, manifest issues
2. **Workflow gaps** — Missing verification, planning quality
3. **Template gaps** — Templates that don't match real-world needs
4. **Documentation gaps** — Unclear processes discovered during audit
5. **Tooling gaps** — Features PAN should have but doesn't

For each category with findings, generate a separate featureAI spec OR consolidate into one spec if findings are cohesive.

Ask the user before writing specs:
> The audit found N enhancement opportunities across M categories. Should I generate featureAI specs for superplan.md to plan development? [Yes/No]
</step>

<step name="final_summary">
**Final Summary**

Display a concise summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Audit Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Score: N% (HEALTHY / DEGRADED / BROKEN)
Critical: N | Warnings: N | Info: N

Installation: <status>
Project: <status>
Workflow: <status>

Enhancements drafted: N specs → docs/specs/
```

If enhancements were generated:
> Enhancement specs written. Run superplan.md or /pan:milestone-new to plan development work.

If repairs were performed:
> N issues auto-repaired. Re-run /pan:audit-deployment to verify.
</step>

</process>

<constraints>
- NEVER modify the target directory's .planning/ content unless --repair is explicitly passed
- NEVER modify the target directory's PAN installation files (read-only audit)
- Enhancement specs are written to the PAN SOURCE repo docs/specs/, NOT the target directory
- If the target directory IS the PAN source repo, refuse with: "Cannot audit the PAN source repository. Use a separate deployment directory."
- All file reads are defensive — missing files are findings, not crashes
- Do not expose file hashes, absolute paths, or credentials in the report
</constraints>
