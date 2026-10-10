---
description: End a PAN Wizard development session by verifying state and preserving context
---

# Session End

## Current State

### Uncommitted Changes
!`git -C D:/PanWizard status --short`
!`git -C D:/PanWizard diff --stat --stat-count=4`

### Commits This Session
!`git -C D:/PanWizard log --oneline --since="8 hours ago" -n 10`

---

## Session Wrap-up Protocol

### 1. Handle Uncommitted Work

**If uncommitted changes exist:**

Option A — Ready to commit:
```powershell
npm test
# If passing:
git add -A
git commit -m "<type>: <description>"
```

Option B — Work in progress:
```powershell
git stash push -m "session-end-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
```

Option C — WIP commit:
```powershell
git add -A
git commit -m "wip: session checkpoint - [brief description]"
```

### 2. Verify Clean State

```powershell
# Tests still passing?
npm test

# Any forgotten files?
git status
```

### 3. Generate Session Summary

Analyze this session:

**What Was Accomplished**
- Tasks completed
- Features implemented
- Bugs fixed
- Tests added/fixed

**Key Decisions Made**
- Technical choices
- Trade-offs decided

**Files Modified**
- Significant changes
- New files created

### 4. Report to User

```
Session Complete

Duration: [time]
Commits: [count]
Files changed: [count]

Test Status: [pass count] / [total] passing

Work Status: [All committed / Stashed / WIP commit]

Next Steps:
- [What to do next time]

Resume with: /session-start
```

---

## ⛔ Self-Protection Reminder

Before ending, verify no self-install artifacts were accidentally created:
```powershell
# These should NOT exist in source repo
Test-Path d:\PanWizard\.claude\pan-wizard-core
Test-Path d:\PanWizard\.claude\pan-file-manifest.json
Test-Path d:\PanWizard\.codex
Test-Path d:\PanWizard\.gemini
Test-Path d:\PanWizard\.opencode
Test-Path d:\PanWizard\AGENTS.md
Test-Path d:\PanWizard\.mcp.json
Test-Path d:\PanWizard\.agents\skills
Test-Path d:\PanWizard\.claude\workflows\pan-*.js
Test-Path d:\PanWizard\.github\mcp.json
Test-Path d:\PanWizard\.github\copilot
```

If any return True, clean them up before committing.
