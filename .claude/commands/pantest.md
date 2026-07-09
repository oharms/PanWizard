# /pantest - Structured Testing Workflow for PAN Wizard

Analyze, fix, and expand test coverage for PAN Wizard: $ARGUMENTS

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY.
- Unit tests: `npm test` (tests/*.test.cjs)
- Scenario tests: `npm run test:scenarios` (tests/scenarios/*.test.cjs)
- All: `npm run test:all`
- Install verification goes to `d:\pantesting`

---

## Usage
```
/pantest                        # Audit all tests
/pantest <module>               # Focus on specific module
/pantest installer              # Focus on installer tests
/pantest coverage               # Find coverage gaps
```

## Execution Instructions

1. **CHECK STATE** — Look for `pantest_status.md` in workspace root
   - **IF EXISTS:** Resume from current phase
   - **IF MISSING:** Start new testing session
2. **EXECUTE** all phases sequentially
3. **UPDATE** status after each phase

---

## Phases

### Phase 0: Initialize
- Read CLAUDE.md for test context
- Run current test suite and capture baseline:
  ```powershell
  npm run test:all 2>&1 | Tee-Object pantest_baseline.txt
  ```
- Note: total tests, passing, failing, test files

### Phase 1: Analysis & Discovery
- List all test files: `Get-ChildItem tests/*.test.cjs`
- List all source files that should have tests
- Map test files to source files:

| Source File | Test File | Coverage |
|-------------|-----------|----------|
| `bin/install.js` | `tests/e2e-install.test.cjs` | ? |
| `bin/install-lib.cjs` | `tests/installer-functions.test.cjs` | ? |
| `pan-wizard-core/bin/lib/state.cjs` | `tests/state.test.cjs` | ? |

### Phase 2: Test Validation (Audit)
For each test file, check:
- Are assertions meaningful? (not just `assert(true)`)
- Do tests exercise real behavior?
- Are edge cases covered?
- Do tests handle all 5 runtimes?

**Red flags:**
- Tests that always pass regardless of implementation
- Tests that mock everything (proving nothing)
- Tests that check trivial properties

### Phase 3: Coverage Gaps
Identify untested code paths:
- Functions in `install-lib.cjs` without corresponding test cases
- Core modules in `pan-wizard-core/bin/lib/` without tests
- Installer flags without test coverage
- Runtime-specific code paths not tested for all 5 runtimes

### Phase 4: Fix Issues
For any test quality issues found:
1. Fix the test to be meaningful
2. Run: `npm test`
3. Verify the fix doesn't break other tests

### Phase 5: Coverage Expansion
Write new tests for gaps found in Phase 3:
- Follow existing test patterns (Node.js test runner, `assert`)
- Location: `tests/<module>.test.cjs`
- Minimum per module: happy path + edge cases + error cases

### Phase 6: Verification
```powershell
npm run test:all
```
All tests must pass. Compare to baseline.

### Phase 7: Stress Testing
For critical paths (installer, state management):
- Test with many files, deep directories
- Test with invalid inputs, missing permissions
- Test concurrent operations (if applicable)

### Phase 8: Summary
```
PANTEST RESULTS

Baseline: X tests passing
After: Y tests passing (+Z new)

New tests added: N
Tests fixed: M
Coverage gaps remaining: K

Files modified:
- tests/<file>.test.cjs — <changes>
```

---

## Test Patterns

### Unit Test Template
```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('moduleName', () => {
  it('should handle happy path', () => {
    // Arrange
    // Act
    // Assert
  });

  it('should handle edge case', () => {
    // ...
  });

  it('should throw on invalid input', () => {
    assert.throws(() => {
      // ...
    }, /expected error/);
  });
});
```

### Key Testing Rules
- Tests use OS temp directories (safe to run from source repo)
- NEVER run installer in source repo during tests
- Assert specific values, not just truthiness
- Test all 5 runtime paths when relevant
