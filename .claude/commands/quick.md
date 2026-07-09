# /quick - Quick Test Run

Run the fast unit test suite for rapid development feedback.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Tests run here; installs go to `d:\pantesting`.

---

## Usage

```
/quick              # Run unit tests (fastest feedback)
/quick all          # Run unit + scenario tests
/quick <file>       # Run specific test file
```

## Execution

```powershell
# Fast feedback — unit tests only (~30s)
npm test

# If you need everything
npm run test:all
```

## When to Use

- **Before commits**: `npm test` for instant feedback
- **During development**: Run after any code change
- **Before PR**: `npm run test:all` for full coverage
- **Specific module**: `node --test tests/config.test.cjs`

## Notes

- Unit tests use OS temp directories — safe to run from source repo
- Scenario tests use OS temp directories — also safe
- Integration install testing MUST go to `d:\pantesting`
- Expected: 1649+ tests, 0 failures
