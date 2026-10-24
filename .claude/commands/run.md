# /run - Test PAN Wizard Installer

Test the PAN Wizard installer in the external test directory.

## ⛔ CRITICAL: Self-Protection Gate

**NEVER run the installer from d:\PanWizard.** The installer has a hard guard that rejects this.
ALL installation testing MUST happen in `C:\Project\pantesting`.

---

## Usage

```
/run                     # Install all runtimes to C:\Project\pantesting
/run --claude            # Install Claude runtime only
/run --codex             # Install Codex runtime only
/run --gemini            # Install Gemini runtime only
/run --opencode          # Install OpenCode runtime only
/run --copilot           # Install Copilot (.github) runtime only
/run --clean             # Clean C:\Project\pantesting first, then install all
```

## Execution

### Clean Install (recommended)

```powershell
# Clean previous installs
Remove-Item C:\Project\pantesting\.claude, C:\Project\pantesting\.codex, C:\Project\pantesting\.gemini, C:\Project\pantesting\.opencode, C:\Project\pantesting\.github, C:\Project\pantesting\.agents, C:\Project\pantesting\AGENTS.md, C:\Project\pantesting\.mcp.json -Recurse -Force -ErrorAction SilentlyContinue

# Install all runtimes
cd C:\Project\pantesting
node d:\PanWizard\bin\install.js --all --local
```

### Single Runtime

```powershell
cd C:\Project\pantesting
node d:\PanWizard\bin\install.js --claude --local
```

### Verify Installation

```powershell
# Check Claude runtime
Write-Host "Commands: $((Get-ChildItem C:\Project\pantesting\.claude\commands\pan\*.md -ErrorAction SilentlyContinue).Count)"
Write-Host "Agents: $((Get-ChildItem C:\Project\pantesting\.claude\agents\*.md -ErrorAction SilentlyContinue).Count)"
Write-Host "Core: $(Test-Path C:\Project\pantesting\.claude\pan-wizard-core\bin\pan-tools.cjs)"
Write-Host "Hooks: $((Get-ChildItem C:\Project\pantesting\.claude\hooks\*.js -ErrorAction SilentlyContinue).Count)"
Write-Host "Manifest: $(Test-Path C:\Project\pantesting\.claude\pan-file-manifest.json)"
```

### Expected Counts (verify against source)

Verify the installed counts match the source repo — compare against **CLAUDE.md's counts table** (the single source of truth). Do not hardcode counts here.

## Never Do

- Run installer from `d:\PanWizard` — it will exit code 1
- Modify `C:\Project\pantesting` and expect changes to persist (it's a test directory)
- Skip verification after installation
