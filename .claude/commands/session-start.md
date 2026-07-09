---
description: Start a PAN Wizard development session by loading project context and checking status
---

# Session Start

## Project Context Loading...

### Current State
!`cd d:\PanWizard && git log --oneline -1 --format="%H %ci" 2>/dev/null`
!`cd d:\PanWizard && git branch --show-current 2>/dev/null`
!`cd d:\PanWizard && git status --short 2>/dev/null`

---

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY (`d:\PanWizard`).
- Unit/scenario tests run here: `npm test`, `npm run test:all`
- Installation testing goes to `d:\pantesting`
- NEVER run installer from source directory

---

## Session Initialization Protocol

### 1. Load Essential Context

1. **Read CLAUDE.md** — development rules, project structure, test commands
2. **Check package.json** — current version
3. **Check git status** — branch, uncommitted changes, recent commits

### 2. Quick Health Check

```powershell
# Version
(Get-Content d:\PanWizard\package.json | ConvertFrom-Json).version

# Recent commits
git log --oneline -5

# Uncommitted changes
git status --short

# Quick test count
npm test 2>&1 | Select-String "pass|fail" | Select-Object -Last 3
```

### 3. State Summary

Report to user:
```
Session Started

Project: PAN Wizard v<version>
Branch: <current branch>
Uncommitted Changes: <Yes/No>
Recent commits: <last 3 commits>
Test baseline: <X tests, Y suites>

Key paths:
  Source: d:\PanWizard
  Test target: d:\pantesting
  Tests: npm test / npm run test:all

Ready to continue.
```

### 4. Suggest Next Actions

Based on context:
- Continue last session's work?
- Any uncommitted changes to handle?
- Run tests to verify clean state?
- Start new feature/fix?

---

## Quick Actions

| Action | Command |
|--------|---------|
| Run tests | `npm test` |
| Build hooks | `npm run build:hooks` |
| Test install | `cd d:\pantesting && node d:\PanWizard\bin\install.js --all --local` |
| Check changes | `git diff --stat` |
| Start fresh | "What would you like to work on?" |

---

**Tip**: End sessions with `/session-end` to preserve context.
