# /run - Test PAN Wizard Installer

Test the PAN Wizard installer in the external test directory.

## ⛔ CRITICAL: Self-Protection Gate

**NEVER run the installer from d:\PanWizard.** The installer has a hard guard that rejects this.
ALL installation testing MUST happen in `d:\pantesting`.

---

## Usage

```
/run                     # Install all runtimes to d:\pantesting
/run --claude            # Install Claude runtime only
/run --codex             # Install Codex runtime only
/run --gemini            # Install Gemini runtime only
/run --opencode          # Install OpenCode runtime only
/run --github            # Install GitHub runtime only
/run --clean             # Clean d:\pantesting first, then install all
```

## Execution

### Clean Install (recommended)

```powershell
# Clean previous installs
Remove-Item d:\pantesting\.claude, d:\pantesting\.codex, d:\pantesting\.gemini, d:\pantesting\.opencode, d:\pantesting\.github -Recurse -Force -ErrorAction SilentlyContinue

# Install all runtimes
cd d:\pantesting
node d:\PanWizard\bin\install.js --all --local
```

### Single Runtime

```powershell
cd d:\pantesting
node d:\PanWizard\bin\install.js --claude --local
```

### Verify Installation

```powershell
# Check Claude runtime
Write-Host "Commands: $((Get-ChildItem d:\pantesting\.claude\commands\pan\*.md -ErrorAction SilentlyContinue).Count)"
Write-Host "Agents: $((Get-ChildItem d:\pantesting\.claude\agents\*.md -ErrorAction SilentlyContinue).Count)"
Write-Host "Core: $(Test-Path d:\pantesting\.claude\pan-wizard-core\bin\pan-tools.cjs)"
Write-Host "Hooks: $((Get-ChildItem d:\pantesting\.claude\hooks\*.js -ErrorAction SilentlyContinue).Count)"
Write-Host "Manifest: $(Test-Path d:\pantesting\.claude\pan-file-manifest.json)"
```

### Expected Counts (verify against source)

| Item | Expected |
|------|----------|
| Commands | 42 (in `commands/pan/`) |
| Agents | 12 (in `agents/`) |
| Core modules | 16+ (in `pan-wizard-core/bin/lib/`) |
| Hooks | 3 (in `hooks/dist/`) |
| Manifest | 1 (`pan-file-manifest.json`) |

## Never Do

- Run installer from `d:\PanWizard` — it will exit code 1
- Modify `d:\pantesting` and expect changes to persist (it's a test directory)
- Skip verification after installation
