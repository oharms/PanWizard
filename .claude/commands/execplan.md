# /execplan — Execute Work Plan Items

Execute items from the current work plan with capacity budgeting. $ARGUMENTS

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY.
- Unit tests run here: `npm test`, `npm run test:all`
- Installation testing MUST go to `d:\pantesting`
- NEVER run installer from this directory

---

## MANDATORY: Execute ALL Stages Sequentially

**Flags:**
- `--budget N` — Override point budget (default: 40, min: 5, max: 100)
- `--dry-run` — Show what would be executed, then stop
- `--no-commit` — Skip commit step
- `--continue` — Resume interrupted plan

---

## Pipeline

```
Stage 1: SESSION START → Load context, check status
Stage 2: PLAN LOADING → Find active plan, select items by budget
Stage 3: EXECUTION → Implement with read→understand→code→test cadence
Stage 4: VERIFICATION → Run full test suite
Stage 5: INSTALL CHECK → Verify installer still works (d:\pantesting)
Stage 6: SESSION END → Commit, generate summary
```

---

## Capacity Budget

| Size | Points | Per Session |
|------|--------|-------------|
| **XS** | 1 | Up to 40 |
| **S** | 2 | Up to 20 |
| **M** | 4 | Up to 10 |
| **L** | 10 | Up to 4 |
| **XL** | 20 | Up to 2 |

Default: 40 points per session.

---

## AI Behavioral Rules

### Rule 1: Read Before You Write (MANDATORY)
Before changing ANY file, read it first. Understand context, callers, invariants.

### Rule 2: Root Cause Fixes (MANDATORY)
Do NOT apply surface-level patches. Trace the actual defect.

### Rule 3: One Change, One Test (MANDATORY)
Test after EACH item. Don't batch 5 changes then test once.

```powershell
# After each item:
npm test
```

### Rule 4: Follow the Plan (MANDATORY)
Implement exactly what the plan says. No "while I'm here" refactoring.

### Rule 5: All 5 Runtimes (MANDATORY)
When changing installer or core logic, verify all runtime targets:
- Claude, Codex, Gemini, OpenCode, GitHub

### Rule 6: Verify Install (MANDATORY)
After changes to installer or shipped files:
```powershell
cd d:\pantesting
node d:\PanWizard\bin\install.js --all --local
```

---

## Stage Details

### Stage 1: Session Start
- Read CLAUDE.md for context
- Check `package.json` version
- Run `npm test` for baseline

### Stage 2: Plan Loading
- Find the active work plan (or use $ARGUMENTS)
- Select items within budget, P0 first
- Show selection to user

### Stage 3: Execution
For each item:
1. Read relevant files
2. Understand the issue
3. Implement the fix/feature
4. Run targeted tests: `node --test tests/<relevant>.test.cjs`
5. Run full suite: `npm test`
6. Mark item complete

### Stage 4: Verification
```powershell
npm run test:all
```
All tests must pass. If not, fix before proceeding.

### Stage 5: Install Check
```powershell
cd d:\pantesting
Remove-Item .claude, .codex, .gemini, .opencode, .github -Recurse -Force -ErrorAction SilentlyContinue
node d:\PanWizard\bin\install.js --all --local
```
Verify installed files are correct.

### Stage 6: Session End
```powershell
git add -A
git commit -m "<type>: <summary of changes>"
```

Report: items completed, tests passing, version.
