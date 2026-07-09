# /sync - Synchronize PAN Wizard Documentation and Tracking

Sync documentation accuracy across the project.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Sync operates on source docs only.

---

## Usage

```
/sync                    # Full doc sync (default)
/sync --docs             # Sync all documentation
/sync --docs --quick     # Quick check: version/counts only
/sync --changelog        # Update CHANGELOG.md
/sync --counts           # Verify file/test/command counts
```

---

## --docs: Full Documentation Sync

### Source of Truth Hierarchy

```
Code (bin/, pan-wizard-core/, commands/, agents/)  ← AUTHORITATIVE
  ↓ documented in
docs/*.md, README.md                               ← Must match code
  ↓ summarized in
CLAUDE.md                                          ← Dev reference, must match
  ↓ versioned in
CHANGELOG.md                                       ← History record
package.json                                       ← Version number
```

### Procedure

1. **Read code** to establish truth:
   - Count commands: `Get-ChildItem commands/pan/*.md | Measure-Object`
   - Count agents: `Get-ChildItem agents/*.md | Measure-Object`
   - Count core modules: `Get-ChildItem pan-wizard-core/bin/lib/*.cjs | Measure-Object`
   - Count tests: Run `npm test` and capture summary
   - Get version: Read `package.json`

2. **Compare against docs** — find discrepancies:
   - CLAUDE.md test count matches reality?
   - README.md install instructions work?
   - CLI-REFERENCE.md flags match `install.js` code?
   - CHANGELOG.md has entry for current version?

3. **Fix discrepancies** — update docs to match code

4. **Report**:
   ```
   | Document | Status | Changes |
   |----------|--------|---------|
   | CLAUDE.md | Updated | Test count 1622→1649 |
   | README.md | Current | No changes needed |
   ```

---

## --counts: Quick Count Verification

Fast check that commonly-cited numbers are accurate:

```powershell
Write-Host "Commands: $((Get-ChildItem commands/pan/*.md).Count)"
Write-Host "Agents: $((Get-ChildItem agents/*.md).Count)"
Write-Host "Core modules: $((Get-ChildItem pan-wizard-core/bin/lib/*.cjs).Count)"
Write-Host "Test files: $((Get-ChildItem tests/*.test.cjs).Count)"
Write-Host "Hooks: $((Get-ChildItem hooks/*.js).Count)"
Write-Host "Version: $((Get-Content package.json | ConvertFrom-Json).version)"
```

Compare against CLAUDE.md claims and fix any mismatches.

### Never Do
- Modify code to match docs (docs follow code, not the other way)
- Skip reading actual test output
- Leave stale version numbers anywhere
