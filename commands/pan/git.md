---
name: pan:git
group: Git Workflow
description: Safe, phase-aware git workflow commands — commit, branch, push, status, log, stash, diff, rollback, tag, sync
argument-hint: "<subcommand> [options]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
---

<objective>
Phase-aware git workflow with safety guardrails built in. Every subcommand that modifies history runs safety checks. Rollback uses PAN snapshot tags (`pan-rollback-*`), which `pan-tools rollback-snapshot <phase>` creates; no workflow creates them for you.

Works with any git repository — no PAN project (`.planning/`) needed, only the installed `pan-tools.cjs`.
</objective>

<subcommands>

## Subcommands

| Subcommand | Usage | What it does |
|------------|-------|--------------|
| `commit` | `git commit --type feat --message "add X"` | Safe commit: checks deleted files + secrets, conventional type prefix |
| `branch` | `git branch create --phase 3` | Create / switch / list / delete branches; phase-aware naming |
| `push` | `git push [--remote origin] [--branch main]` | Push with remote validation; requires `--force` for force-push |
| `status` | `git status` | Branch + staged/unstaged/untracked counts |
| `log` | `git log [--count 20]` | Formatted history, default 10 entries |
| `stash` | `git stash save --name "WIP auth"` | Named stash save / pop / list / drop |
| `diff` | `git diff [--staged] [--file path]` | Diff with line counts |
| `rollback` | `git rollback [--tag pan-rollback-X] [--dry-run]` | Reset to PAN snapshot tag |
| `tag` | `git tag list [--pattern v*]` | List / create / delete tags |
| `sync` | `git sync [--rebase]` | Fetch + pull from origin |

</subcommands>

<workflow>

## Execution

Run the appropriate subcommand via pan-tools:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git <subcommand> [opts]
```

Or invoke directly in conversation: `/pan:git <subcommand> [opts]`

---

### commit — Safe Commit

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git commit \
  --type feat --message "implement user auth"
```

**Options:**
- `--type` — `feat | fix | docs | test | refactor | perf | chore`
- `--message` — Commit message body
- `--all` — Stage all changes before committing
- `--files f1 f2` — Stage specific files
- `--amend` — Amend last commit (no message needed)
- `--force` — Bypass the deleted-file block (not the sensitive-file block)

**Safety checks run automatically:**

| Check | Blocks on | Override |
|-------|-----------|---------|
| Deleted files | A deletion anywhere in the repository (`git status --porcelain`, staged or not) | `--force` |
| Sensitive files | A staged path ending `.env`, `.pem` or `.key`, or containing `credentials`, `secret`, `password` or `token` (PAN's own `.planning/metrics/tokens.jsonl` is exempt) | None: narrow `commit.sensitive_patterns` in `.planning/config.json`, or commit the file yourself |

**Output:** `{committed, hash, type, safety_checks}`

---

### branch — Branch Management

```bash
# Phase-aware branch (names as pan/phase-3)
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git branch create --phase 3

# Custom name
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git branch create --name feature/auth

# Switch
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git branch switch --name main

# List all branches
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git branch list

# Delete (safe — merged only)
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git branch delete --name feature/old

# Delete unmerged (force)
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git branch delete --name feature/old --force

# Current branch
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git branch current
```

**Phase naming convention:** `pan/phase-{N}` — the branch is named `pan/phase-{N}` directly (hardcoded; not derived from any config template)

---

### push — Safe Push

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git push
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git push --remote upstream --branch main
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git push --force  # requires explicit flag
```

**Output:** `{pushed, remote, branch, force}`

---

### status — Phase-Aware Status

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git status
```

**Output:** `{branch, clean, staged_count, unstaged_count, untracked_count, files}`

---

### log — Commit History

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git log --count 20
```

**Output:** `{commits: [{hash, message}], total}`

---

### stash — Named Stash

```bash
# Save
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git stash save --name "WIP: auth refactor"

# List all stashes
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git stash list

# Pop latest
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git stash pop

# Pop by index
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git stash pop --index 1

# Drop
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git stash drop --index 0
```

---

### diff — Staged/Unstaged Diff

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git diff
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git diff --staged
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git diff --staged --file src/api.js
```

**Output:** `{diff, lines_added, lines_removed, files_changed}`

---

### rollback — Revert to PAN Snapshot

```bash
# Rollback to the last pan-rollback-* tag in name order — the newest only among one phase's snapshots (requires clean working tree)
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git rollback

# Preview — does NOT reset, shows what would happen
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git rollback --dry-run

# Rollback to specific tag
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git rollback --tag pan-rollback-3-20260415T101500
```

**Rollback workflow:**
1. Lists all `pan-rollback-*` tags (created with `pan-tools rollback-snapshot <phase>`)
2. Verifies working tree is clean (blocks on dirty tree unless `--dry-run`)
3. Runs `git reset --hard <tag>`

**Output:** `{rolled_back, tag, hash, dry_run}`

---

### tag — Tag Management

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git tag list
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git tag list --pattern "v*"
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git tag create --name v3.6.0 --message "Release 3.6.0"
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git tag delete --name v3.6.0-rc1
```

**Output:** `{tags, count}` / `{created, tag}` / `{deleted, tag}`

---

### sync — Pull from Upstream

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git sync
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git sync --rebase
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs git sync --remote upstream --branch main
```

**Output:** `{synced, remote, branch, rebase, commits_received}`

</workflow>

<runtime_note>
All subcommands work with any git repository, whether or not it holds a PAN project (`.planning/`); they run the installed `pan-tools.cjs`. The only requirement is a valid git repo (`git init` or cloned).
</runtime_note>
