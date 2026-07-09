# /superplan — Strategic Work Plan Generator

Generate a comprehensive work plan for PAN Wizard development. $ARGUMENTS

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. The plan covers development of PAN itself.
Installation testing goes to `d:\pantesting`.

---

## MANDATORY: Execute ALL Phases Automatically

**Flags:**
- `--focus <area>` — Weight items toward an area (e.g., `--focus installer`, `--focus commands`, `--focus testing`)
- `--quick` — Skip competitive analysis (Phase 2)
- `--lean` — Only include actionable items (drop low-priority)

---

## Phase 0: Orientation & Baseline

### 0.1 Read Current State

**Core Status:**
- `CLAUDE.md` — Project rules, structure, test counts
- `package.json` — Version
- `CHANGELOG.md` — Recent changes

**Code inventory:**
```powershell
Write-Host "Version: $((Get-Content package.json | ConvertFrom-Json).version)"
Write-Host "Commands: $((Get-ChildItem commands/pan/*.md).Count)"
Write-Host "Agents: $((Get-ChildItem agents/*.md).Count)"
Write-Host "Core modules: $((Get-ChildItem pan-wizard-core/bin/lib/*.cjs).Count)"
Write-Host "Test files: $((Get-ChildItem tests/*.test.cjs).Count)"
Write-Host "Hooks: $((Get-ChildItem hooks/*.js).Count)"
```

### 0.2 Scan for Real Issues
```powershell
# TODOs and FIXMEs in source
Select-String -Pattern "TODO|FIXME|HACK|STUB" -Path bin/*.js, bin/*.cjs, pan-wizard-core/bin/lib/*.cjs -CaseSensitive:$false
```

### 0.3 Test Baseline
```powershell
npm test 2>&1 | Select-String "pass|fail|suites" | Select-Object -Last 5
```

### 0.4 Baseline Snapshot
```markdown
| Metric | Value |
|--------|-------|
| Version | |
| Tests passing | /total |
| Test files | |
| Commands shipped | |
| Agents shipped | |
| Core modules | |
| Open TODOs | |
```

---

## Phase 1: Priority Classification

| Priority | Focus | Criteria |
|----------|-------|----------|
| **P0: BROKEN** | Crashes, data loss, install failures | Tests failing, installer broken |
| **P1: WRONG** | Silent bugs, incorrect behavior | Wrong files installed, bad paths |
| **P2: STABILITY** | Edge cases, error handling | Graceful failures, clear errors |
| **P3: MISSING TESTS** | Untested code paths | Coverage gaps |
| **P4: FEATURE GAPS** | Incomplete runtime support | Not all 5 runtimes handled |
| **P5: NEW FEATURES** | New capabilities | From roadmap/user requests |
| **P6: DOCUMENTATION** | Doc sync, accuracy | Stale docs, missing guides |
| **P7: POLISH** | UX, performance, cleanup | Code quality, DX improvements |

---

## Phase 2: Item Collection

Gather items from:
1. **Test failures** — any currently failing tests
2. **TODO/FIXME scan** — undocumented work items in code
3. **CHANGELOG.md** — planned but unimplemented items
4. **docs/** — documented features that aren't implemented
5. **GitHub issues** — if any open issues
6. **Runtime gaps** — features that don't work for all 5 runtimes
7. **Test coverage gaps** — code paths without tests

---

## Phase 3: Sizing & Scoring

### Size Categories

| Size | Points | Meaning |
|------|--------|---------|
| **XS** | 1 | Config tweak, typo fix |
| **S** | 2 | Single-file fix, small test |
| **M** | 4 | Multi-file feature, test suite |
| **L** | 10 | Multi-module change |
| **XL** | 20 | Major feature, cross-cutting |

### Output Format

```markdown
## PAN Wizard Work Plan — [date]

### Baseline
[snapshot table]

### Items

| ID | Priority | Size | Title | Files | Status |
|----|----------|------|-------|-------|--------|
| 1 | P0 | S | Fix installer crash on empty dir | bin/install.js | Remaining |
| 2 | P1 | M | Wrong manifest for codex runtime | bin/install-lib.cjs | Remaining |
...
```

Target: prioritized, actionable items with clear file references.

---

## Phase 4: Execution Recommendations

Group items into sessions:
- Each session budget: ~40 points
- P0 items are mandatory (always first)
- Mix fixes and features for progress on both fronts
