<purpose>
Check for PAN updates via npm, display changelog for versions between installed and latest, obtain user confirmation, and execute clean installation with cache clearing.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="get_installed_version">
Detect whether PAN is installed locally or globally by checking both locations and validating install integrity:

```bash
# There is ONE install location per install. The installer templates the
# canonical ~/.claude/ prefix to this install's real path, and the SHAPE of that
# templated prefix reveals the scope: a --local install is cwd-relative ("./…"),
# a --global install is an absolute path. Deriving scope from the single
# templated path avoids the collapsed dual-path detection that mis-ran every
# global update as --local (N2 regression fix, ADR audit 2026-08).
VERSION_FILE="~/.claude/pan-wizard-core/VERSION"
MARKER_FILE="~/.claude/pan-wizard-core/workflows/update.md"
case "$VERSION_FILE" in
  ./*) SCOPE="LOCAL" ;;
  *)   SCOPE="GLOBAL" ;;
esac
# The same templated path names the runtime: the installer rewrites ~/.claude/ to
# this runtime's own directory. With no runtime flag the installer installs Claude
# Code only, so the flag must be passed.
case "$VERSION_FILE" in
  *.codex/*)  RUNTIME="--codex" ;;
  *.gemini/*) RUNTIME="--gemini" ;;
  *opencode/*) RUNTIME="--opencode" ;;
  *.github/*|*.copilot/*) RUNTIME="--copilot" ;;
  *)          RUNTIME="--claude" ;;
esac

if [ -f "$VERSION_FILE" ] && [ -f "$MARKER_FILE" ] && grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+' "$VERSION_FILE"; then
  cat "$VERSION_FILE"
  echo "$RUNTIME"
  echo "$SCOPE"
else
  echo "UNKNOWN"
  echo "$RUNTIME"
  echo "$SCOPE"
fi
```

Parse output (there is ONE install; scope and runtime are derived from the single templated prefix). The output is three lines: the installed version (or `UNKNOWN`), the runtime flag (`--claude`, `--codex`, `--gemini`, `--opencode` or `--copilot`) and the scope. Remember the runtime flag: the install step writes it into its command.
- If last line is "LOCAL": this install is local-scoped (templated prefix is `./`-relative); use `--local`
- If last line is "GLOBAL": this install is global-scoped (templated prefix is an absolute path); use `--global`
- If the first line is "UNKNOWN": the VERSION/marker files are missing or invalid; proceed to install step (treat as version 0.0.0) — the runtime and scope lines still apply

**If VERSION file missing:**
```
## PAN Update

**Installed version:** Unknown

Your installation doesn't include version tracking.

Running fresh install...
```

Proceed to install step (treat as version 0.0.0 for comparison).
</step>

<step name="check_latest_version">
Check npm for latest version:

```bash
npm view pan-wizard version 2>/dev/null
```

**If npm check fails:**
```
Couldn't check for updates (offline or npm unavailable).

To update manually: `npx -y pan-wizard@latest {runtime_flag} --global` (`--local` for a local install), with the runtime flag and scope step 1 printed
```

Exit.
</step>

<step name="compare_versions">
Compare installed vs latest:

**If installed == latest:**
```
## PAN Update

**Installed:** X.Y.Z
**Latest:** X.Y.Z

You're already on the latest version.
```

Exit.

**If installed > latest:**
```
## PAN Update

**Installed:** X.Y.Z
**Latest:** A.B.C

You're ahead of the latest release (development version?).
```

Exit.
</step>

<step name="show_changes_and_confirm">
**If update available**, fetch and show what's new BEFORE updating:

1. Fetch changelog from GitHub raw URL
2. Extract entries between installed and latest versions
3. Display preview and ask for confirmation:

```
## PAN Update Available

**Installed:** 1.5.10
**Latest:** 1.5.15

### What's New
────────────────────────────────────────────────────────────

## [1.5.15] - 2026-01-20

### Added
- Feature X

## [1.5.14] - 2026-01-18

### Fixed
- Bug fix Y

────────────────────────────────────────────────────────────

⚠️  **Note:** The installer performs a clean install of PAN folders:
- `commands/pan/` will be wiped and replaced
- `pan-wizard-core/` will be wiped and replaced
- `agents/pan-*` files will be replaced

(Paths are relative to your install location: `~/.claude/` for global, `./.claude/` for local)

Your custom files in other locations are preserved:
- Custom commands not in `commands/pan/` ✓
- Custom agents not prefixed with `pan-` ✓
- Custom hooks ✓
- Your CLAUDE.md files ✓

If you've modified any PAN files directly, they'll be automatically backed up to `pan-local-patches/` and can be reapplied with `/pan:patches` after the update.
```

Use AskUserQuestion:
- Question: "Proceed with update?"
- Options:
  - "Yes, update now"
  - "No, cancel"

**If user cancels:** Exit.
</step>

<step name="run_update">
Run the update using the install type detected in step 1:

**If LOCAL install:**
```bash
npx -y pan-wizard@latest {runtime_flag} --local
```

**If GLOBAL install:**
```bash
npx -y pan-wizard@latest {runtime_flag} --global
```

`{runtime_flag}` is the runtime line step 1 printed: write the flag itself into the command. A variable set in step 1's shell call is gone in this one (each Bash call starts a new shell), and an empty `""` argument in its place installs Claude Code only. A `--config-dir` or `--unified-skills` install is not recognised from its path: for those, re-run the installer with your original flags instead.

Capture output. If install fails, show error and exit.

Clear the update cache so the statusline indicator disappears. The update-check hook keeps it under your home directory for every install, local or global, in the runtime's own config directory: `.claude` (Claude Code), `.codex` (Codex), `.gemini` (Gemini CLI) or `.copilot` (Copilot CLI); OpenCode runs no update-check hook, so there is nothing to clear there:

```bash
rm -f "$HOME/<config dir from the list above>/cache/pan-update-check.json"
```
</step>

<step name="display_result">
Format completion message (changelog was already shown in confirmation step):

```
╔═══════════════════════════════════════════════════════════╗
║  PAN Updated: v1.5.10 → v1.5.15                           ║
╚═══════════════════════════════════════════════════════════╝

⚠️  Restart your AI coding tool to pick up the new commands.

[View full changelog](https://github.com/oharms/PanWizard/blob/main/CHANGELOG.md)
```
</step>


<step name="check_local_patches">
After update completes, check if the installer detected and backed up any locally modified files:

Check for pan-local-patches/backup-meta.json in the config directory.

**If patches found:**

```
Local patches were backed up before the update.
Run /pan:patches to merge your modifications into the new version.
```

**If no patches:** Continue normally.
</step>
</process>

<success_criteria>
- [ ] Installed version read correctly
- [ ] Latest version checked via npm
- [ ] Update skipped if already current
- [ ] Changelog fetched and displayed BEFORE update
- [ ] Clean install warning shown
- [ ] User confirmation obtained
- [ ] Update executed successfully
- [ ] Restart reminder shown
</success_criteria>
