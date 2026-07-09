# /pandev - Structured PAN Wizard Development Workflow

Structured development workflow with batch planning, verification gates, and progress tracking: $ARGUMENTS

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY.
- Tests run here: `npm test`, `npm run test:all`
- Build hooks here: `npm run build:hooks`
- Install testing goes to `d:\pantesting`
- NEVER run installer from this directory

---

## Usage
```
/pandev <feature or task description>
```

## Execution Instructions

1. **READ CLAUDE.md** — Extract project context, test commands, structure
2. **CHECK STATE** — Look for `pandev_status.md` in workspace root
   - **IF EXISTS:** Resume from current phase
   - **IF MISSING:** Start new workflow
3. **BATCH PLAN** — Size items, assign tiers, show plan
4. **EXECUTE** — Follow phases for the assigned tier
5. **UPDATE** status file after every phase

---

## Workflow Tiers

| Tier | Sizes | Phases | Tracker |
|------|-------|--------|---------|
| **MICRO** | XS, S | Implement → Test → Done | None |
| **STANDARD** | M | 0 → 3 → 4 → 5 → 8 → 10 | Compact |
| **FULL** | L, XL | All phases (0-10) | Full |

---

## Phases

### Phase 0: Initialize
- Read CLAUDE.md (once, cache key facts)
- Note version, test baseline, project structure
- Create checklist

### Phase 1: Understand
- Identify the feature scope
- Find relevant files in `bin/`, `pan-wizard-core/`, `commands/`, `agents/`, `tests/`
- Assess impact on all 5 runtimes

### Phase 2: Plan
```
## Execution Plan: <Feature Name>

### Scope
- Files to modify: <list>
- Runtimes affected: <which of the 5>

### Steps
1. <step>
2. <step>

### Tests Required
- Unit tests in tests/<file>.test.cjs
- Scenario tests if installer-related

### Verification
- [ ] npm test passes
- [ ] npm run test:all passes
- [ ] Install to d:\pantesting works (if installer changed)
```

### Phase 3: Implement
- Write code following existing patterns
- CommonJS for core modules (.cjs)
- Pure functions in install-lib.cjs (no side effects)
- Handle all 5 runtimes consistently

### Phase 4: Test
- Create comprehensive tests
- Minimum 10 cases: happy path + edge cases + errors
- Location: `tests/<feature>.test.cjs`

### Phase 5: Quick Verify
```powershell
npm test
```

### Phase 6: Full Verify
```powershell
npm run test:all
```

### Phase 7: Install Verify (if installer/shipped files changed)
```powershell
cd d:\pantesting
Remove-Item .claude, .codex -Recurse -Force -ErrorAction SilentlyContinue
node d:\PanWizard\bin\install.js --all --local
```

### Phase 8: Documentation
- Update relevant docs if behavior changed
- Update CLAUDE.md if test counts or structure changed
- Update CHANGELOG.md for notable changes

### Phase 9: Simplify
- Review implementation for unnecessary complexity
- Remove any "while I was here" additions
- Ensure code is minimal and focused

### Phase 10: Ship
- Final `npm run test:all`
- Commit with descriptive message
- Update version if warranted

---

## Quality Standards

- [ ] All existing tests pass (0 regressions)
- [ ] New tests cover the change
- [ ] All 5 runtimes handled (if applicable)
- [ ] No self-install artifacts created
- [ ] Code follows existing patterns (CommonJS, pure functions)
- [ ] Documentation updated if needed
