# /featureAI - Feature Investigation, Design & Specification

Research, design, and specify a new PAN Wizard feature: $ARGUMENTS

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Feature design work happens here.
The feature must work across all 5 runtimes (claude, codex, gemini, opencode, github).

---

## MANDATORY: Complete All Phases Without Asking

Execute ALL phases automatically. Do NOT stop between phases.

**Flags:**
- `--gate` — Pause after Phase 3 for user review before proceeding
- `--quick` — Skip Phases 2 and 5 (for small features)

---

## Phase 0: Problem Framing

### 0.1 Problem Statement
One paragraph: What user pain does this address? Why now?

### 0.2 Scope
| In Scope | Out of Scope |
|----------|--------------|

### 0.3 Success Criteria (Measurable)
```
SC-1: [Feature works for all 5 runtimes]
SC-2: [Unit tests cover happy path + edge cases]
SC-3: [Installer handles the feature correctly]
SC-4: [Documentation updated]
SC-5: [No regression in existing tests]
```

### 0.4 User Stories
```
As a [PAN Wizard user], I want [feature],
so that [benefit], instead of [current workaround].
```

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Capabilities
Read and understand what PAN Wizard already has:
- `CLAUDE.md` — Project structure and rules
- `bin/install.js` — Installer logic
- `bin/install-lib.cjs` — Pure helper functions
- `pan-wizard-core/bin/lib/*.cjs` — Core modules
- `commands/pan/*.md` — Existing commands
- `agents/*.md` — Existing agents
- `docs/ARCHITECTURE.md` — System design

### 1.2 Codebase Search
Search for related implementations:

| Target | Where to Look |
|--------|---------------|
| Installer logic | `bin/install.js`, `bin/install-lib.cjs` |
| Core modules | `pan-wizard-core/bin/lib/*.cjs` |
| CLI dispatcher | `pan-wizard-core/bin/pan-tools.cjs` |
| Command patterns | `commands/pan/*.md` |
| Agent patterns | `agents/*.md` |
| Test patterns | `tests/*.test.cjs` |

### 1.3 Runtime Compatibility
Check if the feature needs runtime-specific handling:
- Claude Code: `.claude/` directory structure
- Codex: `.codex/` directory structure
- Gemini CLI: `.gemini/` directory structure
- OpenCode: `.opencode/` directory structure
- GitHub Copilot: `.github/` directory structure

---

## Phase 2: Competitive Analysis (skip with --quick)

How do similar tools handle this?
- Check existing PAN alternatives mentioned in `docs/COMPARISON.md`
- Identify best practices from comparable workflow tools
- Note differentiation opportunities

---

## Phase 3: Design

### Architecture Decision
- Which files need to change?
- New files needed?
- How does this integrate with the installer?
- Does this affect the manifest (`pan-file-manifest.json`)?

### Implementation Plan
```
1. [File to modify/create] — [what changes]
2. [Test file] — [what to test]
3. [Doc file] — [what to document]
```

### Test Plan
- Unit tests in `tests/<feature>.test.cjs`
- Scenario tests if installer-related
- Minimum 10 test cases: 3+ happy path, 3+ edge cases, 2+ error cases, 2+ runtime-specific

---

## Phase 4: Specification Output

Produce a ready-to-implement spec:
```
## Feature: <name>

### Files to Create/Modify
- ...

### Implementation Steps
1. ...

### Tests Required
- ...

### Documentation Updates
- ...

### Runtime Matrix
| Runtime | Supported | Notes |
|---------|-----------|-------|
| Claude | ✅ | ... |
| Codex | ✅ | ... |
| Gemini | ✅ | ... |
| OpenCode | ✅ | ... |
| GitHub | ✅ | ... |
```

---

## Phase 5: Risk Assessment (skip with --quick)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaks existing installs | High | Backward compat tests |
| Runtime-specific edge case | Medium | Test all 5 runtimes |
| Performance regression | Low | Benchmark installer time |
