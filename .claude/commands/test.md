# /test - Run PAN Wizard Tests

Run PAN Wizard tests with configurable scope.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. NEVER run `node bin/install.js` from here.
Unit/scenario tests are safe to run here. Installation testing goes to `d:\pantesting`.

---

## Usage

```
/test                    # Standard: unit tests (default)
/test unit               # Unit tests only (tests/*.test.cjs)
/test scenarios          # Scenario tests only (tests/scenarios/*.test.cjs)
/test all                # All tests (unit + scenarios)
/test install            # Integration: install to d:\pantesting and verify
/test <pattern>          # Run tests matching pattern
```

## Quick Reference

| Scope | Command | Tests | Time |
|-------|---------|-------|------|
| Unit | `npm test` | 1649+ across 54 files | ~30s |
| Scenarios | `npm run test:scenarios` | tests/scenarios/ | ~15s |
| All | `npm run test:all` | Everything | ~45s |
| Install | See integration section | Manual verification | ~20s |

---

## Unit Tests (default)

```powershell
npm test
```

This runs all `tests/*.test.cjs` files via Node.js test runner.

**Expected:** 1649+ tests passing, 0 failures.

## Scenario Tests

```powershell
npm run test:scenarios
```

Tests in `tests/scenarios/*.test.cjs` — end-to-end installer scenarios using temp directories.

## All Tests

```powershell
npm run test:all
```

## Integration Testing (Install Verification)

**Always use the external test directory:**

```powershell
# Clean and test fresh install (all 5 runtimes)
Remove-Item d:\pantesting\.claude, d:\pantesting\.codex, d:\pantesting\.gemini, d:\pantesting\.opencode, d:\pantesting\.github -Recurse -Force -ErrorAction SilentlyContinue
cd d:\pantesting
node d:\PanWizard\bin\install.js --all --local
```

Then verify:
```powershell
# Check installed files
Get-ChildItem d:\pantesting\.claude\commands\pan\*.md | Measure-Object | Select-Object Count
Get-ChildItem d:\pantesting\.claude\agents\*.md | Measure-Object | Select-Object Count
Test-Path d:\pantesting\.claude\pan-wizard-core\bin\pan-tools.cjs
```

## Running Specific Tests

```powershell
# By filename pattern
node --test tests/installer*.test.cjs
node --test tests/config.test.cjs

# By test name
node --test --test-name-pattern "should handle" tests/core.test.cjs
```

## If Tests Fail

1. Note which test file and test name failed
2. Read the test to understand what it verifies
3. Fix the root cause — NEVER change test expectations to match bugs
4. Re-run to confirm the fix
5. Run `npm run test:all` to check for regressions

**NEVER:** Skip failing tests or proceed with broken tests.
