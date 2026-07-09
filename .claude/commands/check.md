# /check - Verify PAN Wizard Implementations

Verify that PAN Wizard features actually work, not just exist.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. NEVER install PAN here.
Installation verification goes to `d:\pantesting`.

---

## Usage

```
/check                       # Verify current feature (auto-detect from context)
/check --verify <feature>    # Deep implementation verification
/check --install             # Verify installer works end-to-end
/check --all                 # Full verification (tests + install)
```

---

## --verify: Implementation Verification

### Steps

1. **Identify** what to validate (from argument or recent changes)
2. **Find** implementation files (installer, core libs, commands, agents)
3. **Read the code** to understand what it claims to do
4. **Run unit tests** that cover this feature:
   ```powershell
   npm test
   ```
5. **Run scenario tests** if the feature involves installation:
   ```powershell
   npm run test:scenarios
   ```
6. **Run learn-lint** to catch learnings-store integrity drift (duplicate IDs, dangling refs, scope leaks):
   ```powershell
   node pan-wizard-core/bin/pan-tools.cjs learn lint --raw
   ```
   Exits non-zero on errors; warnings are advisory.
7. **Manual verification** if needed — install to test directory:
   ```powershell
   cd d:\pantesting && node d:\PanWizard\bin\install.js --all --local
   ```
8. **Report** verified vs. failing features with evidence

### Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| VERIFIED ✅ | Feature works as claimed | None |
| PARTIAL ⚠️ | Works for some runtimes or partial functionality | Fix gaps |
| BROKEN ❌ | Claimed but doesn't work | Fix or mark as in-progress |
| MISSING 🔴 | Not implemented at all | Remove false claim |

---

## --install: Installer Verification

Verify all 5 runtimes install correctly:

```powershell
# Clean slate
Remove-Item d:\pantesting\.claude, d:\pantesting\.codex, d:\pantesting\.gemini, d:\pantesting\.opencode, d:\pantesting\.github -Recurse -Force -ErrorAction SilentlyContinue

# Install each runtime
cd d:\pantesting
node d:\PanWizard\bin\install.js --claude --local
node d:\PanWizard\bin\install.js --codex --local
node d:\PanWizard\bin\install.js --gemini --local
node d:\PanWizard\bin\install.js --opencode --local
node d:\PanWizard\bin\install.js --github --local
```

Verify each installed correctly:
- Commands present (42 in `commands/pan/`)
- Agents present (12 in `agents/`)
- Core modules present (`pan-wizard-core/bin/`)
- Hooks present (3 in `hooks/`)
- Manifest present (`pan-file-manifest.json`)

---

## --all: Combined Check

Runs `--verify` (tests) then `--install` (end-to-end).

---

## Never Do

- Report "VERIFIED" without running tests or checking actual behavior
- Skip installer verification (all 5 runtimes must be checked)
- Change test expectations to match broken behavior
- Trust documentation claims without execution evidence
