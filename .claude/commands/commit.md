# /commit - Create Git Commit with Safety Checks

Create a git commit with safety checks for PAN Wizard development.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Commits are for source code changes only.
NEVER commit self-install artifacts (.claude/agents/, .claude/commands/, .claude/hooks/, etc.).

---

## Step 1: Safety Checks (MANDATORY)

### 1.1 Check for Deleted Files
```powershell
git status --porcelain | Select-String "^ D|^D "
```

**If files are deleted, STOP and ask user** — confirm deletions are intentional.

### 1.2 Check for Self-Install Artifacts
```powershell
# These should NEVER be committed — they're gitignored
git status --porcelain | Select-String "\.claude/(agents|commands|hooks|pan-wizard-core)/|\.codex/|\.gemini/|\.opencode/|\.github/"
```

**STOP if self-install artifacts are staged.** They must not be committed.

### 1.3 Check for Sensitive Files
```powershell
git diff --cached --name-only | Where-Object { $_ -match "\.env$|\.pem$|\.key$|credentials|secret|password|token" }
```

**STOP if sensitive files detected.**

### 1.4 Check for Large Files
```powershell
git diff --cached --name-only | ForEach-Object {
    $size = (Get-Item $_ -ErrorAction SilentlyContinue).Length / 1MB
    if ($size -gt 1) { Write-Host "WARNING: $_ is $([math]::Round($size,2)) MB" }
}
```

---

## Step 2: Review Changes

```powershell
git status
git diff --stat
git diff --cached --stat
```

Show summary: files modified, added, deleted, lines changed.

---

## Step 3: Run Tests (if code changed)

**Skip if ONLY `.md` or `.txt` files changed.**

Otherwise:
```powershell
npm test
```

**STOP if tests fail.** Do not commit broken code.

---

## Step 4: Version Bump (if warranted)

**Ask the user:**
> What type of version bump?
> - **patch** (2.8.0 → 2.8.1): Bug fixes, minor changes
> - **minor** (2.8.0 → 2.9.0): New features, non-breaking changes
> - **major** (2.8.0 → 3.0.0): Breaking changes
> - **none**: No version change

If bumping, update `package.json` version field.

---

## Step 5: Commit

```powershell
git add -A
git commit -m "<type>: <description>"
```

**Commit types:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`

---

## Step 6: Post-Commit

Show: commit hash, files changed, test status.

**Do NOT push** unless user explicitly asks.
