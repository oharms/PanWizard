# PAN Troubleshooting Guide

Deep-dive troubleshooting for PAN Wizard. For common issues, see the [Troubleshooting section in the User Guide](USER-GUIDE.md#troubleshooting).

This guide covers root causes, diagnostic steps, and recovery procedures for scenarios that go beyond basic troubleshooting. Use it as an escalation resource when the User Guide items are not enough.

**Other docs:** [User Guide](USER-GUIDE.md) | [FAQ](FAQ.md) | [CLI Reference](CLI-REFERENCE.md) | [Architecture](ARCHITECTURE.md) | [Development](DEVELOPMENT.md) | [Agents](AGENTS.md) | [Hooks](HOOKS.md)

---

## Table of Contents

- [Plan Structure and Validation](#plan-structure-and-validation)
- [Execution and Deviations](#execution-and-deviations)
- [State and File System](#state-and-file-system)
- [Checkpoints](#checkpoints)
- [Verification and Stubs](#verification-and-stubs)
- [Git Integration](#git-integration)
- [Models and Cost](#models-and-cost)
- [Context and Sessions](#context-and-sessions)
- [Cross-Platform Issues](#cross-platform-issues)
- [Diagnostic Commands](#diagnostic-commands)

---

## Plan Structure and Validation

### Plan frontmatter validation fails

**Symptom:** Plan checker rejects your plan with "Missing required frontmatter field: <name>" errors.

**Required frontmatter fields:**

```yaml
---
phase: "01"
plan: "01"
type: execute|tdd
autonomous: true|false
wave: 1
depends_on: []
files_modified: []
must_haves: []
---
```

**Common causes:**

- Missing `wave` field (added in v0.1.0)
- `autonomous: true` but plan contains checkpoint tasks
- Phase number not zero-padded (use `"01"` not `"1"`)
- Plan number as integer instead of string (use `"01"` not `1`)
- Missing quotes around numeric values in YAML

**Diagnostic steps:**

1. Open the plan.md and inspect the YAML frontmatter block between `---` markers
2. Run `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs verify plan-structure <path-to-plan>` for detailed validation output
3. Check that `autonomous` and the task types are consistent -- an autonomous plan must not contain any `type="checkpoint:*"` tasks

**Fix:** Correct the frontmatter to match the schema. Use `/pan:health` to validate all plans in the project at once.

### Task XML structure errors

**Symptom:** Executor cannot parse tasks from plan.md. Execution fails early with no tasks found.

**Required task structure:**

```xml
<task id="1" type="auto">
  <name>Task name</name>
  <action>What to do</action>
  <verify>How to verify it worked</verify>
  <done>Completion criteria</done>
  <files>files/that/change.ts</files>
</task>
```

**Common causes:**

- Missing `<name>` element (required)
- Missing `<action>` element (required)
- Missing `<verify>` -- not an error but the executor cannot validate task completion
- Unclosed XML tags (e.g., `<action>` without `</action>`)
- HTML entities or special characters in code snippets breaking XML parsing (e.g., `<`, `>`, `&` in code blocks)
- Nested XML-like content inside `<action>` that confuses the parser

**Diagnostic steps:**

1. Open the plan.md and search for all `<task` occurrences
2. Verify each task has matching open/close tags for `<name>`, `<action>`, and ideally `<verify>` and `<done>`
3. Check that code snippets within tasks do not contain raw `<` or `>` characters outside of fenced code blocks
4. Run `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs verify plan-structure <path>` for structural validation

**Fix:** Ensure all tasks have at minimum `<name>` and `<action>`. Wrap code snippets in CDATA sections or fenced markdown blocks if they contain XML-special characters. Use `<verify>` and `<done>` for better execution quality.

### Wave dependency conflicts

**Symptom:** Plans in the same wave fail because one depends on another's output. For example, Plan 01-02 needs a type defined in Plan 01-01, but both are in wave 1.

**Root cause:** Plans assigned the same wave number but have implicit dependencies. Plans in the same wave may execute in parallel (when `parallelization: true`), so wave-mates must be independent.

**Diagnostic steps:**

1. Open `.planning/roadmap.md` and review the wave assignments for the affected phase
2. Check each plan's `depends_on` frontmatter field -- missing dependencies cause this issue
3. Look for shared file references across plans in the same wave using the `<files>` elements

**Fix:** Increase the wave number of the dependent plan. Wave 1 runs first, wave 2 after wave 1 completes, and so on. If Plan B depends on Plan A, Plan B must be in a higher wave than Plan A.

### Plan checker enters infinite rejection loop

**Symptom:** The planner generates a plan, the checker rejects it, the planner regenerates, the checker rejects again -- repeating up to the maximum of 3 checker iterations (hard-coded in the plan-phase workflow; two revisions).

**Root cause:** The planner and checker have conflicting expectations. Common triggers:

- Checker requires verification commands but the plan's domain has no obvious CLI verification
- Checker requires `must_haves` but the plan type (e.g., `docs`) does not naturally produce them
- Phase context.md specifies constraints that conflict with checker rules

**Diagnostic steps:**

1. Read the checker's rejection message in the planner output -- it explains what failed
2. Check `.planning/phases/XX-name/` for any draft plans that were rejected
3. Review context.md for constraints that may conflict with plan structure requirements

**Fix:** Either adjust the context.md to align with the checker's expectations, or temporarily disable the checker: set `workflow.plan_check: false` in `/pan:settings`. You can also run `/pan:discuss-phase N` to surface assumptions before planning.

---

## Execution and Deviations

### Executor hits deviation Rule 4 (architectural change)

**Symptom:** Execution stops with a checkpoint asking about an architectural decision. The executor detected that completing the task requires structural changes beyond its auto-fix scope.

**What triggers Rule 4:**

- New database table or schema migration needed (not just a new column)
- Switching to a different library or framework than planned
- Adding a new service layer or API boundary
- Breaking changes to existing public APIs
- Changes that would affect other phases' assumptions or plans

**What to do:**

1. Read the checkpoint description carefully -- it explains what was found, the proposed change, why it is needed, the impact, and alternatives
2. Approve the change to let the executor continue with expanded scope
3. Reject the change to defer it -- the task is logged in `deferred-items.md` in the phase directory
4. If you need to discuss further, use `/pan:discuss-phase N` to explore alternatives

**Prevention:** Run `/pan:discuss-phase N` before planning to surface architectural decisions early. Write a context.md for the phase that captures your preferences.

### Task fails after 3 auto-fix attempts

**Symptom:** The executor tried auto-fix rules (Rules 1-3) three times on a task but could not resolve the issue. The task appears in summary.md under "Deferred Issues."

**Deviation auto-fix rules and their limits:**

| Rule | Trigger | Auto-fixes | Example |
|------|---------|------------|---------|
| Rule 1 | Code does not work (wrong logic, null pointers, type errors) | Up to 3 attempts | Query returns wrong data |
| Rule 2 | Missing critical functionality (error handling, validation, security) | Up to 3 attempts | No input validation on API |
| Rule 3 | Blocking issues (missing deps, broken imports, build errors) | Up to 3 attempts | Missing npm package |

**Diagnostic steps:**

1. Open the summary.md for the plan and read the "Deferred Issues" section
2. Check `deferred-items.md` in the phase directory for accumulated items
3. Review the executor's commit history for the task to see what fixes were attempted: `git log --oneline -10`
4. Look at the test output or build output that was failing

**Recovery:**

1. Run `/pan:verify-phase N` to list the gaps, then `/pan:plan-phase N --gaps` to create gap-closure plans for them
2. Execute fixes with `/pan:exec-phase N --gaps-only`
3. For particularly stubborn issues, use `/pan:debug "description of the problem"` which spawns a dedicated debugging agent

### Deferred items accumulating across plans

**Symptom:** Multiple summary.md files in a phase have deferred items. The phase technically "completed" but has quality gaps.

**Root cause:** Individual plan executors deferred issues they could not resolve within their 3-attempt limit. These accumulate because each plan executor starts fresh and does not see previous plans' deferred items.

**Diagnostic steps:**

1. Check each summary.md in the phase directory for "Deferred Issues" sections
2. Check `deferred-items.md` for the consolidated list
3. Run `/pan:verify-phase N` -- the verifier checks the phase goal against the codebase and produces a gap analysis (it does not read `deferred-items.md`, so check that separately)

**Recovery:**

1. Run `/pan:verify-phase N` to get a verification.md with a consolidated gap analysis
2. Review the verification results to prioritize which items to fix
3. Run `/pan:plan-phase N --gaps` to create the gap-closure plans, then `/pan:exec-phase N --gaps-only` to execute only those
4. Repeat the verify-then-fix cycle until verification.md shows all clear

### Executor creates files in wrong locations

**Symptom:** The executor creates source files but they end up in unexpected directories, or the file structure does not match the plan's `<files>` section.

**Root cause:** The plan's `<files>` section listed relative paths that the executor interpreted differently, or the executor's working directory was not the project root.

**Diagnostic steps:**

1. Compare the plan's `<files>` sections against the actual files created (check `git log --stat -5`)
2. Check if the executor was running from the correct working directory

**Fix:** For future plans, use explicit paths relative to the project root in `<files>` sections. For the current issue, move files to the correct locations and commit, or use `/pan:quick` to fix the file layout.

---

## State and File System

### state.md is corrupted or has wrong values

**Symptom:** `/pan:progress` shows wrong phase, plan count is incorrect, or fields have unexpected values. Commands behave as if you are at a different point in the project.

**Diagnostic:**

```text
/pan:health
```

**Common causes:**

- Manual editing of state.md broke the `**Field:** value` format (fields must follow this exact pattern)
- YAML frontmatter and markdown body fields are out of sync (the body is canonical: every state write re-derives the frontmatter from the `**Field:** value` lines, and a body value overwrites the frontmatter one)
- Interrupted execution left state partially updated (executor crashed between `state advance-plan` and `state update-progress`)
- A plan was manually deleted from the phase directory but state.md still references it
- state.md starts with two front-matter blocks: earlier releases stacked a new block on every state write to a CRLF checkout (`core.autocrlf=true`). State writes now refuse such a file with "state.md starts with more than one front-matter block" — keep the block with the right values, delete the other, and run the command again

**Fix options (from least to most destructive):**

1. **Auto-repair:** Run `/pan:health --repair` to fix consistency issues automatically
2. **Manual fix:** Edit `.planning/state.md` directly -- ensure fields use `**Field:** value` format and the YAML frontmatter matches
3. **Reconstruct from disk:** Delete state.md and run `/pan:health --repair` (or `/pan:resume`, which offers to reconstruct it) -- `/pan:progress` does not regenerate state.md; with it missing it points you at `/pan:new-project`
4. **Full reset:** restore `.planning/roadmap.md` from git (or recreate it with `/pan:milestone-new`), delete `.planning/state.md`, then run `/pan:health --repair` to regenerate state.md from the roadmap. `/pan:new-project` refuses to run while `project.md` exists — delete that too only for a true from-scratch reset

### config.json will not parse

**Symptom:** Commands fail with "Failed to read config.json" or similar JSON parse errors.

**Common causes:**

- Trailing comma after the last property in an object (invalid JSON)
- Missing closing brace or bracket
- Single quotes instead of double quotes (JSON requires double quotes)
- Comments in the file (JSON does not support comments)
- BOM character at the start of the file (invisible but breaks parsers)

**Diagnostic steps:**

1. Open `.planning/config.json` in your editor
2. Use a JSON validator (e.g., `node -e "JSON.parse(require('fs').readFileSync('.planning/config.json','utf8'))"`) to find the syntax error
3. Check the exact error message -- it usually includes a line/column number

**Fix:**

1. Correct the JSON syntax error
2. If the file is badly corrupted, delete it and run `/pan:health --repair` (or `pan-tools config-ensure-section`) to recreate it with defaults -- other commands fall back to in-memory defaults and write nothing
3. Then use `/pan:settings` to reconfigure your preferences

### .planning/ directory missing or inaccessible

**Symptom:** "Failed to create .planning directory", "EACCES: permission denied", or `/pan:health` reports `E001: .planning/ directory not found` despite previous initialization.

**Common causes:**

- Directory permissions prevent read/write access
- The `.planning/` directory was accidentally deleted or moved
- Running PAN from a different working directory than the project root
- On Windows, antivirus or file indexing may temporarily lock files

**Diagnostic steps:**

1. Check if the directory exists: look for `.planning/` in the project root
2. Check permissions on the directory and its contents
3. Verify your working directory matches the project root

**Fix:**

- For permission issues: adjust permissions so your user has read/write access to `.planning/` and all subdirectories
- For missing directory: run `/pan:new-project` to reinitialize (if `.planning/project.md` still exists it refuses to run and points you at `/pan:progress`; `/pan:resume` also picks the project back up)
- For wrong working directory: navigate to the project root before running PAN commands

### PAN says the planning tree belongs to another tool

**Symptom:** `/pan:health` (or `pan-tools validate health`) reports `E006: planning tree belongs to gsd-core: …` with status `broken` and no other errors; `pan-tools hygiene scan` raises a single `foreign-planning-tree` warning, and `hygiene clean --apply` reports the legacy-filename fix as `refused`; `/pan:new-project` stops with `planning tree belongs to gsd-core`.

**Root cause:** the project's `.planning/` was written by another tool. gsd-core (the continuation of Get Shit Done) also uses `.planning/`, with `STATE.md`, `ROADMAP.md`, `PROJECT.md` and `REQUIREMENTS.md` in uppercase — exactly the filenames PAN used before v2.2 — so without this check PAN read the tree as a legacy PAN layout: hygiene would have renamed the other tool's state, health called it broken, and `new-project` would have scaffolded PAN files into it. PAN now recognises the tree from markers it never writes itself (`HANDOFF.json`, `.gsd-allow-shrink`, two or more gsd-only directories, or gsd-core's flat dotted `config.json` keys such as `"workflow.discuss_mode"`) and refuses to touch it. This is deliberate, not corruption.

**Fix:** give PAN a tree of its own. Run PAN with `--planning-dir <dir>` (or set `PAN_PLANNING_DIR`) so it works in a separate, project-relative planning directory — the planning-root flags are documented in `docs/CLI-REFERENCE.md` (ADR-0043). If the tree really is an old PAN project and the markers are a coincidence, remove the foreign markers and re-run `pan-tools hygiene scan`: a genuine legacy PAN tree still gets the `legacy-filenames` finding and its rename fix.

### Phase directory numbering mismatch

**Symptom:** Phase directories use different numbering than roadmap.md, or `find-phase` returns the wrong directory.

**Root cause:** Phase directories are named `XX-phase-name/` where XX is the zero-padded phase number. If phases were inserted (e.g., phase 3.1), the directory name uses the full number. Renaming directories manually breaks the mapping.

**Diagnostic steps:**

1. List phase directories: check `.planning/phases/` contents
2. Compare against roadmap.md phase listing
3. Run `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs find-phase N --raw` to see what PAN resolves

**Fix:** Do not rename phase directories manually. Use `/pan:insert-phase` and `/pan:remove-phase` to manage phase structure. If directories are already mismatched, `/pan:health --repair` only rewrites state.md as a minimal scaffold from roadmap.md (after a timestamped `.bak-` backup) and does not touch phase directories; fix the directory names by hand.

---

## Checkpoints

### Dev server will not start at checkpoint

**Symptom:** A `checkpoint:human-verify` asks you to check the dev server, but the server fails to start.

**Common causes and fixes:**

| Cause | Diagnostic | Fix |
|-------|-----------|-----|
| Port already in use | `lsof -i :3000` (macOS/Linux) or `netstat -ano \| findstr :3000` (Windows) | Kill the stale process |
| Missing dependencies | Check for `node_modules/` or equivalent | Run `npm install` / `pip install` / etc. |
| Missing environment variables | Check error output for "undefined" env vars | Create `.env` file or set variables |
| Build errors from earlier tasks | Check the executor's task output above the checkpoint | Fix build errors, then retry the server start |
| Database not running | Check for connection refused errors | Start the database service |

**Important:** The executor is supposed to start the server before presenting the checkpoint. If it did not, this is a deviation Rule 3 issue (blocking problem). The checkpoint should include instructions for what the executor already tried.

### Checkpoint appears during auto-advance mode

**Symptom:** You enabled `workflow.auto_advance: true` in config but still get a checkpoint that pauses execution.

**What auto-advance handles automatically:**

| Checkpoint type | Auto behavior |
|----------------|--------------|
| `checkpoint:human-verify` | Auto-approved (assumes verification passes) |
| `checkpoint:decision` | Auto-selects the first option |
| `checkpoint:human-action` | **Cannot be automated -- always pauses** |

**Root cause:** The checkpoint is a `checkpoint:human-action` type, which requires a real human action that cannot be simulated. Common examples: logging into a third-party service, entering a 2FA code, adding an API key, clicking a confirmation email link.

**Fix:** Perform the requested action and confirm completion. There is no way to auto-advance through human-action checkpoints because they require interaction with external systems.

### Authentication gate during execution

**Symptom:** Executor hits an auth error and presents a dynamic checkpoint asking for credentials. This is not a code bug -- it is an authentication gate.

**How to distinguish auth gates from code bugs:**

| Indicator | Auth gate | Code bug |
|-----------|----------|----------|
| Error message | "Not authenticated", "401", "403", "Please run X login" | "TypeError", "Cannot read property", build errors |
| Executor behavior | Stops cleanly with a checkpoint | Enters auto-fix loop |
| Recovery | Provide credentials, executor retries | Fix code, re-execute |

**What to do:**

1. Follow the checkpoint instructions exactly (login command, API key location, etc.)
2. Confirm the action is complete
3. The executor retries the failed command automatically after your confirmation
4. If the auth gate recurs, check that credentials are being persisted (e.g., token stored in correct file, environment variable exported in the right shell profile)

### Checkpoint continuation agent loses context

**Symptom:** After a checkpoint, the continuation agent does not seem to know what was already done. It may attempt to redo completed tasks.

**Root cause:** Each checkpoint spawns a fresh agent. The continuation agent relies on the `<completed_tasks>` section in its prompt and on git commits to know what was done.

**Diagnostic steps:**

1. Check `git log --oneline -10` to verify previous task commits exist
2. Look for the checkpoint return format in the orchestrator's output -- it should list completed tasks with commit hashes

**Fix:** If the continuation agent is redoing work, it likely means the previous tasks were not committed. Check git log. If commits are missing, the previous executor may have crashed before committing. In that case, review the working tree for uncommitted changes and commit them manually before resuming.

---

## Verification and Stubs

### Verification finds stub components

**Symptom:** verification.md reports components that "render placeholder content", "have empty handlers", or "return hardcoded data."

**Common stub patterns the verifier detects:**

| Pattern | Example | Severity |
|---------|---------|----------|
| Placeholder rendering | `<div>ComponentName</div>` | High -- no real UI |
| Empty event handlers | `onClick={() => {}}` | High -- non-functional |
| Hardcoded API responses | `return { message: "Not implemented" }` | High -- no real logic |
| Skeleton schemas | Schema with only `id` field | Medium -- incomplete data model |
| TODO markers | `// TODO: implement this` | Medium -- acknowledged gap |
| Pass-through functions | `function validate(x) { return true; }` | Medium -- no real validation |

**Root cause:** The plan's tasks were too broadly scoped for the executor's context window, or the executor exhausted its auto-fix attempts and moved on.

**Recovery:**

1. Read verification.md for the full list of stub components
2. Run `/pan:plan-phase N --gaps` to generate targeted fix plans from verification.md
3. Execute with `/pan:exec-phase N --gaps-only`
4. Re-verify to confirm stubs are replaced with real implementations

### Wiring verification fails

**Symptom:** verification.md reports "component does not call API", "API does not query database", or similar layer-connection failures.

**What wiring means in PAN's verification model:**

```text
UI Component
    --> calls API endpoint (fetch/axios/etc.)
        --> API handler queries database (ORM/SQL/etc.)
            --> Database returns real data
        --> API returns response
    --> Component renders response
```

Each arrow is a "wire." The verifier checks that these connections exist in the code, not just that each layer exists independently.

**Common causes:**

- Executor completed individual layer tasks but did not connect them (e.g., built the API and the component but the component still uses mock data)
- Import paths are wrong so the connection code exists but does not resolve
- Environment variables for database connection are not set up

**Diagnostic steps:**

1. Read the verification.md wiring section for specific disconnected layers
2. Check the actual source files to see if the connection code exists but is broken, or does not exist at all
3. Look at import statements and function call chains

**Fix:** Wiring issues usually require small, targeted changes (adding an import, changing a fetch URL, connecting a handler to the database). Run `/pan:plan-phase N --gaps` to create fix plans that specifically address the wiring gaps, then `/pan:exec-phase N --gaps-only` to run them.

### summary.md self-check shows failure

**Symptom:** A summary.md file contains `## Self-Check: FAILED` at the bottom, or the verifier flags the self-check failure.

**What it means:** After completing all tasks, the executor ran its own self-check -- verifying that files it claimed to create actually exist and that commits it claimed to make are in the git log. One or more of these checks failed.

**Diagnostic steps:**

1. Read the self-check section in the summary.md -- it lists exactly what is missing (files or commits)
2. Check `git log --oneline -20` to see if commits are present but with different hashes
3. Check the file system for the claimed files

**Common causes:**

- Executor reported a file path in the summary that differs from the actual path (e.g., case sensitivity on Linux)
- A commit was made but the hash was recorded incorrectly
- The executor crashed after writing the summary but before the final commit

**Fix:** If the actual work was done (files exist, commits present), the self-check failure is cosmetic. If files or commits are genuinely missing, use `/pan:verify-phase N` to identify the gaps and `/pan:plan-phase N --gaps` to plan their fixes.

### Verification produces false positives

**Symptom:** verification.md reports issues that are not actually problems -- for example, flagging intentionally empty handlers or placeholder text that is correct for the current phase.

**Root cause:** The verifier applies generic quality heuristics that may not account for phase-specific context. An empty handler that will be wired in a later phase is correctly empty now.

**Fix:**

1. Review each flagged item and determine if it is a true gap or a false positive
2. For false positives, you can safely ignore them -- they do not block phase completion
3. Use `/pan:verify-phase N` which performs its own final check and distinguishes critical gaps from acceptable state
4. If the verifier is consistently too aggressive, consider disabling it for prototyping phases: `workflow.verifier: false` in `/pan:settings`

---

## Git Integration

### Commits created but not on expected branch

**Symptom:** Commits exist in `git log` but on the wrong branch. The phase branch was supposed to be created but was not, or commits landed on `main` instead.

**Root cause:** The `branching_strategy` config controls branch creation. If set to `"phase"` or `"milestone"`, the exec-phase workflow should create a branch. If it did not, the commits go to whatever branch was checked out.

**Diagnostic steps:**

1. Check current config: look at `.planning/config.json` for the `branching_strategy` and branch template keys
2. Check all branches: `git branch -a`
3. Check where the commits are: `git log --all --oneline --graph -20`

**Expected config for branching:**

```json
{
  "branching_strategy": "phase",
  "phase_branch_template": "pan/phase-{phase}-{slug}",
  "milestone_branch_template": "pan/{milestone}-{slug}"
}
```

**Fix:**

- If commits are on the wrong branch, cherry-pick them to the correct one: `git cherry-pick <hash1> <hash2> ...`
- If the branch was never created, create it now and cherry-pick or rebase
- For future phases, verify the branching strategy config before executing

### Planning docs committed when they should not be

**Symptom:** `.planning/` files appear in git history, but you wanted them excluded.

**Root cause:** `commit_docs` defaults to `true`, meaning PAN commits planning artifacts alongside code. If `.planning/` is not in `.gitignore`, these commits persist in history.

**Fix (prevent future commits):**

1. Set `commit_docs: false` in `.planning/config.json` via `/pan:settings`
2. Add `.planning/` to your `.gitignore`

**Fix (remove from history):**

1. Remove from tracking (keeps files locally): `git rm -r --cached .planning/`
2. Commit the removal: `git commit -m "chore: remove planning docs from tracking"`
3. The files remain on disk but are no longer tracked

**Caution:** If planning docs have already been pushed to a shared remote, removing them from history requires a force push or BFG Repo-Cleaner. Coordinate with your team before rewriting shared history.

### Commit message format does not match team standards

**Symptom:** PAN creates commits like `feat(03-02): add login endpoint` but your team uses a different conventional commit format or an entirely different commit style.

**Current format:** `{type}({phase}-{plan}): {description}`

**Available types (task commits, per `references/git-integration.md`):** `feat`, `fix`, `test`, `refactor`, `perf`, `chore`. Planning-doc commits go through `pan-tools commit`, whose `--type` accepts `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`

**Workarounds:**

1. **Squash at milestone:** Use `git merge --squash` when completing a milestone to combine all PAN commits into a single commit with your preferred message
2. **Interactive rebase:** After phase completion, rebase to rewrite messages: `git rebase -i <base-commit>` (do this before pushing)
3. **Post-push:** If already pushed, consider whether the PAN format is acceptable as-is for feature branches that will be squash-merged

**Note:** Commit message format is not configurable in the current version. This is a known limitation.

### Git hooks conflict with PAN commits

**Symptom:** PAN's commits fail because a pre-commit hook (linter, formatter, test runner) rejects the changes.

**Root cause:** PAN executors use `git commit` normally and do not skip hooks. If the committed code does not pass your pre-commit hooks, the commit fails.

**Diagnostic steps:**

1. Check which hooks are installed: look in `.git/hooks/` or `.husky/` (if using Husky)
2. Run the hook manually on the staged files to see the exact failure
3. Check if the failure is in PAN-generated code or in planning docs

**Fix:**

- If the hook fails on code quality: the PAN executor's auto-fix rules should handle this, but if the linter rules are unusual, the executor may not know how to satisfy them. Add linter configuration details to context.md for the phase.
- If the hook fails on planning docs: add `.planning/` to the hook's ignore list, or set `commit_docs: false` to avoid committing planning files entirely.
- Do not use `--no-verify` as a workaround -- fix the underlying issue instead.

---

## Models and Cost

### Token usage higher than expected

**Symptom:** A phase consumed significantly more tokens than anticipated. API billing shows unexpectedly high usage.

**Token usage by stage (approximate):**

| Stage | `budget` | `balanced` / `quality` |
|-------|---------------|-----------------|
| Research | 10-20K | 30-50K |
| Planning | 10-20K | 20-40K |
| Execution (per plan) | 10-40K | 20-80K |
| Verification | 5-10K | 10-20K |

`quality` and `balanced` are `inherit` for **every** agent — the two columns are identical, so switching between them changes nothing. `budget` is the only profile that down-tiers. Derived from `MODEL_PROFILES` in `core.cjs` — that table is the source of truth.

**Common causes of higher-than-expected usage:**

- Plan checker rejection loop (up to 3 iterations = 3x planning cost)
- Executor auto-fix loops (each Rule 1-3 attempt costs additional tokens)
- Plans with too many tasks (4+ tasks per plan increases per-plan cost)
- Staying on the default profile for high-volume work `budget` would have absorbed
- Research enabled for a domain you already know well

**Cost reduction strategies (ordered by impact):**

1. **Switch profile:** `/pan:profile budget` for prototyping or high-volume work — it is the only profile that lowers spend, since `balanced` and `quality` resolve identically
2. **Skip research:** `/pan:plan-phase N --skip-research` for familiar domains
3. **Disable plan checker:** `workflow.plan_check: false` in `/pan:settings` (saves 20-40K per phase)
4. **Disable verifier:** `workflow.verifier: false` for early prototyping (saves 10-30K per phase)
5. **Smaller plans:** Keep plans to 2-3 tasks each (reduces per-plan context usage)
6. **Use --prd:** Provide a detailed PRD with `/pan:plan-phase N --prd spec.md` to skip discuss-phase

### Wrong model being used for an agent

**Symptom:** An agent runs on a cheaper model than you expected, or execution quality does not match expectations for the configured profile.

**How model selection works:**

| Agent type | `budget` | `balanced` / `quality` |
|-----------|--------|----------|
| Research | fast | reasoning |
| Planning | mid | reasoning |
| Execution | mid | reasoning |
| Verification | fast | reasoning |
| Plan checker | fast | reasoning |

`quality` and `balanced` are `inherit` for **every** agent — the two columns are identical, so switching between them changes nothing. `budget` is the only profile that down-tiers. `inherit` → the reasoning tier, i.e. the model the session was launched with; `mid` and `fast` map to the provider's mid/fast models (Sonnet and Haiku on Anthropic). Derived from `MODEL_PROFILES` in `core.cjs` — that table is the source of truth, and `pan-tools estimate-cost` prints the relative multiplier per profile.

So if the symptom is "an agent ran on a weaker model", the profile to look at is `budget`; moving between `balanced` and `quality` will not change it.

**Override precedence:** Per-agent override (`model_overrides`) > per-phase roadmap model tier > profile default > hardcoded `mid`

**Diagnostic steps:**

1. Check `.planning/config.json` for `model_profile` (the base profile)
2. Check `model_overrides` in the same file for per-agent overrides
3. Run `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs resolve-model <agent-type> --raw` to see what model PAN would actually use

**Fix:** Adjust `model_overrides` in config to force a specific model for a specific agent:

```json
{
  "model_profile": "balanced",
  "model_overrides": {
    "pan-executor": "opus",
    "pan-phase-researcher": "haiku"
  }
}
```

### Execution quality varies between plans in the same phase

**Symptom:** Some plans produce high-quality, complete implementations while others produce stubs or partial work, even though they are in the same phase.

**Root cause:** Each plan executor gets a fresh context window. Quality depends on:

- **Plan specificity:** Vague plans produce vague code. Detailed `<action>` sections produce better results.
- **Task count:** Plans with 4+ tasks may exhaust the context window.
- **Domain complexity:** Some tasks (e.g., complex state management) are inherently harder for a single context to handle.
- **Model selection:** The assigned model may be insufficient for the task complexity.

**Fix:**

1. Review the lower-quality plans -- are their tasks specific enough?
2. Consider re-planning with smaller, more detailed tasks
3. If you are on `budget`, complex tasks are the case for leaving it — or pin just the executor back up with `model_overrides: { "pan-executor": "reasoning" }`
4. Add more detail to the phase's context.md to provide implementation guidance

### Per-agent `effort:` appears to have no effect

**Symptom:** PAN's agents carry an `effort:` level in their frontmatter (from `AGENT_BASE_EFFORT`, `effort_overrides`, or the `budget` profile's step-down), but every agent runs at the session's effort regardless.

**Root cause:** Claude Code before `2.1.267` ignored `effort:` frontmatter on custom commands, skills and subagents whenever the model had a pinned default effort. PAN emitted the field correctly the whole time; the runtime did not read it.

**Fix:** Update Claude Code (`claude --version` to check) — nothing changes on PAN's side. On the other runtimes PAN never relied on the field: their agent files carry an effort-scaled prose preamble instead, which is unaffected.

**Also check `maxEffortLevel`.** Claude Code `2.1.267` added a `maxEffortLevel` setting (top-level, or per model under `modelSettings`). A managed or user value there clamps every `effort:` PAN emits, so an agent that seems to ignore its frontmatter on a current build may be capped rather than ignored. `claude config get maxEffortLevel` (or the settings file) shows whether one is set.

### Cost report disagrees with Claude Code's `/usage` or with the invoice

**Symptom:** `pan-tools cost report` totals differ from what Claude Code shows or what the provider bills.

**Causes, in the order to check them:**

1. **Stale rate table.** `pan-tools models check` prints when the built-in rates were last verified and flags the table once it is old. Provider prices move faster than PAN releases; if it says STALE, the fix is a rate refresh, not a config change.
2. **Cache-read pricing on the newest Fable-tier model.** Its cache reads bill at a quarter of the standard Claude cache-read multiplier. PAN carries a dedicated rate row for it (see `DEFAULT_RATES` in `cost.cjs`); releases before that row existed priced its reads at the previous Fable model's rate, high by roughly four times on the line that dominates PAN's traffic.
3. **The newest Opus-tier model, now the default everywhere.** Claude Code `2.1.280` made it the default model on every plan, and its cache reads bill at half the standard multiplier — a third cache-read rate in the current lineup. Releases before PAN carried its row priced it through the family-prefix fallback at the previous Opus row: cache reads high by two and a half times, input, output and cache writes by a quarter. Upgrade PAN; `pan-tools models check` (without `--raw`, which prints only the one-line verdict) lists the model ids the table prices under `models`.
4. **Contracted rates.** If your organisation pins `modelPricing` in Claude Code's managed settings, PAN reads the same block and prices with it — its `overrides` rows, and its `multiplier` over every model, as Claude Code applies them; `pan-tools models check` (JSON output, not `--raw`) lists the model ids it found under `managed_model_pricing` and the multiplier under `managed_pricing_multiplier`. PAN 3.30.0 and earlier read a row shape the documentation does not describe, and so priced a real policy file at list price. Precedence is `.planning/config.json → cost.rates`, then managed `modelPricing`, then the built-in table. If the list is empty on a machine where the policy should apply, check that the file sits where Claude Code reads it (its managed-settings documentation gives the per-OS directory; the legacy Windows `ProgramData` path is read by neither tool), or point PAN at a relocated directory with `PAN_MANAGED_SETTINGS_DIR`.
5. **Hook rows are priced at read time.** Records the SubagentStop hook writes carry `cost_usd: null` and are priced when the report runs, so a rate change re-prices history. That is deliberate: it is what lets a rate fix correct old totals.

### Usage limits arrive sooner after a Claude Code update

**Symptom:** After updating Claude Code, a PAN phase uses noticeably more of the plan's allowance, or the cost report's model column moves from a Sonnet-tier id to an Opus-tier one.

**Root cause:** Claude Code `2.1.280` changed the default model on the Pro and Team Standard plans from Sonnet to the newest Opus-tier model, matching the other plans. PAN's `quality` and `balanced` profiles run every agent on the session's own model (`inherit`), so a change of default moves every agent at once — nothing in PAN changed.

**Fix:** Choose the session model yourself with `/model`, or switch PAN to the `budget` profile (planning and execution on the mid tier, verification and research on the fast tier), or pin individual agents with `model_overrides` in `.planning/config.json`.

---

## Context and Sessions

### Context window exhausted mid-phase

**Symptom:** Claude becomes less coherent, loses track of the current task, or starts repeating itself. The context monitor (if installed) shows CRITICAL warning.

**Why this happens:** The main session accumulates context from every command you run. PAN subagents (executors, verifiers) each get a fresh context window, but the orchestrating session does not reset automatically.

**Immediate recovery:**

1. Run `/pan:pause` -- this saves progress to a `.continue-here.md` handoff document
2. Start a new Claude Code session
3. Run `/pan:resume` -- this restores context from state.md, roadmap.md, recent summary.md files, and `.continue-here.md`

**Prevention strategies:**

- Run `/clear` between major commands (e.g., after plan-phase completes, before exec-phase)
- Avoid reading large files in the main session -- let subagents handle file reading
- Use the `budget` profile (its mid/fast agents produce shorter output, consuming less context); `balanced` and `quality` are identical, so switching between those two will not help here
- Keep plans to 2-3 tasks each to reduce executor output size

### resume restores incomplete context

**Symptom:** After resuming, PAN seems to have forgotten important details about the project or recent work.

**What `/pan:resume` restores:**

| Source | Content | Always loaded |
|--------|---------|--------------|
| state.md | Current phase, plan, status, decisions | Yes |
| roadmap.md | Project overview, phase list, progress | Yes |
| .continue-here.md | Handoff notes from pause | If exists |
| Recent summary.md | Latest completed plan details | Latest 1-2 |
| project.md | Project brief | Yes |

**What is NOT restored:**

- Conversation history from the previous session
- In-progress work that was not committed
- Detailed context from subagent executions
- File contents that were read during the previous session

**Fix:** If critical context is missing after resume:

1. Run `/pan:progress` for a comprehensive status analysis
2. Manually read key files that provide needed context
3. If you need details from a specific plan execution, read its summary.md directly
4. For file-level details, read the relevant source files

### Multiple sessions interfere with each other

**Symptom:** Two Claude Code sessions running PAN on the same project produce conflicting commits, corrupted state.md, or duplicated work.

**Root cause:** `state.md` writes are serialized via advisory file locking plus atomic writes (ADR-0030), but PAN does not coordinate whole-session concurrency. Two sessions can still commit to the same branch, race on other artifacts, or duplicate work — keep to one session per project.

**Prevention:** Do not run multiple PAN sessions on the same project simultaneously. PAN is designed for single-session operation.

**Recovery:**

1. Close all but one session
2. Run `/pan:health --repair` to fix any state inconsistencies
3. Check `git log` for duplicate or conflicting commits
4. Manually resolve any git conflicts

### Agents re-read the cached context at full price after a short pause

**Symptom:** `/usage` shows a low prompt-cache hit ratio for PAN's agents, or the ledger shows repeated cache *writes* of the same context block within an hour.

**Root cause:** Claude Code decides the prompt-cache lifetime per request bucket. The main conversation can get the one-hour lifetime on a subscription; **everything else — subagents, workflows, forks — gets five minutes** unless you say otherwise. Every PAN agent is a subagent, so a phase whose agents are spaced more than five minutes apart re-caches the same planning context each time. ADR-0044 measured that block as the bulk of PAN's token traffic.

**Fix:** Set `subagentPromptCacheTtl` to `"1h"` in a Claude Code settings file (Claude Code `2.1.242` or later). Weigh it first: one-hour cache writes bill at twice the base input rate against 1.25× for five-minute writes, so the longer lifetime pays off once a block is read at least twice inside the hour — true for a phase run, false for a single quick agent. To see which lifetime a session is using, `/usage` shows a `Prompt cache (main)` line with the hit ratio and, on recent builds, the likely cause of the last miss. On PAN's side, `pan-tools context-budget` reports the block's size under `cache.status` and, under `cache.ttl`, how many cache writes in the ledger followed an idle gap of five to sixty minutes (only the five-minute writes, on rows that record the cache-lifetime split; `cache.ttl.basis` says whether the count is `measured`, `mixed` or `inferred`) — the misses the one-hour lifetime would have avoided — recommending the setting only when that recurs; `pan-tools hygiene scan` raises the same recommendation as a `cache-context` finding — `info`, or `warn` once the re-written tokens reach `TTL_WARN_TOKENS` in `context-budget.cjs`.

### A headless `claude -p` run sees no PAN commands, agents or hooks

**Symptom:** A scripted or CI run of Claude Code answers as if PAN were not installed: `/pan:*` commands are unknown, no PAN agent can be spawned, and the cost and context hooks never fire.

**Root cause:** The run is in bare mode. Claude Code's headless documentation recommends `--bare` for scripted and SDK calls and says it "will become the default for `-p` in a future release". Bare mode skips auto-discovery of hooks, skills, custom commands, subagents, plugins, MCP servers, auto memory and CLAUDE.md. With `--add-dir` it loads that directory's `.claude/skills/` but still skips `.claude/commands/` and `.claude/agents/`, and it never reads OAuth credentials (it needs an API key).

**Fix:** Leave `--bare` off for runs that need PAN. Where bare mode is imposed, load PAN's parts explicitly: `--settings` for a settings file carrying PAN's hooks, `--mcp-config .mcp.json` for the bridge, `--agents` for agent definitions, or `--plugin-dir` pointing at the built PAN plugin. A `--unified-skills` install places its skills under `.claude/skills/`, which is the one PAN surface `--add-dir` still loads.

### The exec-phase orchestrator shows no todo checklist

**Symptom:** On the newest Claude models the `/pan:exec-phase` orchestrator never shows a todo list, although the command lists a todo tool among its allowed tools.

**Root cause:** Since Claude Code `2.1.233` its task-tracking tools (`TodoWrite` and the `TaskCreate` family) are offered by default only on older models; on newer ones they are absent unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` is set. PAN never depends on them — the wave record is the attention anchor the orchestrator prints after each wave, the wave summaries, and `state.md`.

**Fix:** Nothing is required. Set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` if you want the checklist back.

### PAN's project rules are not picked up

**Symptom:** Agents ignore the rules PAN adds to the project (for example they do not know where `.planning/` lives), in a project where the rules file exists.

**Root cause:** PAN writes its rules into a marker-fenced section of `AGENTS.md` and adds an `@AGENTS.md` import to `CLAUDE.md`, so Claude Code loads them either way. Since `2.1.277` Claude Code also reads `AGENTS.md` directly, but only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in the working directory or above, and not on Bedrock, Vertex or Foundry. So the rules go missing when the `@AGENTS.md` import has been removed from `CLAUDE.md` while a `CLAUDE.md` still exists, or when the project instructions setting in `/config` is limited to `CLAUDE.md` files.

**Fix:** Restore the import (re-running the installer does it), or set the project instructions setting back to its default, which reads `CLAUDE.md` or `AGENTS.md`.

### `/skill-doctor` lists most PAN skills as unused

**Symptom:** Claude Code's `/skill-doctor` reports many `pan-*` skills loaded but never invoked, with a context cost beside each.

**Why this is expected:** A unified-skills install ships the whole command set as skills, and only a few are used in any one session. Until a skill is invoked it costs its `description` line and nothing else — PAN's descriptions are short by design, and the tool's per-skill figure is that line, not the body.

**Fix, if you want a shorter list:** use Claude Code's `skillOverrides` setting to mark individual skills `hidden` or `collapsed` rather than deleting their files — PAN's manifest tracks every installed file, and a deleted skill comes back on the next upgrade and fails verification until then.

---

## Cross-Platform Issues

### Windows path backslashes cause failures

**Symptom:** File path comparisons or references fail on Windows. Plans reference files with forward slashes but verification checks use backslashes, or vice versa.

**Root cause:** Windows uses `\` backslashes natively but PAN normalizes to `/` forward slashes internally. Mismatches can occur when:

- plan.md `<files>` sections are written with backslashes
- External tools output paths with backslashes that PAN compares against forward-slash references
- `pan-tools.cjs` receives a backslash path as an argument

**Fix:**

- Always use forward slashes (`/`) in plan.md `<files>` sections and config paths
- PAN's internal `toPosix()` helper handles conversion for most operations
- If a specific command fails due to paths, check whether the path argument contains backslashes and convert them

### Shell expansion breaks commands containing $ signs

**Symptom:** Commands containing `$` (such as JavaScript template literals or shell variable references) get expanded by the shell before PAN processes them.

**Root cause:** Bash interprets `$` as variable expansion. A command containing `${name}` may be expanded to an empty string or an unrelated variable's value.

**Where this matters:**

- Custom pre/post hooks that contain template literals
- context.md code examples that the executor copies verbatim
- Commands in plan `<action>` sections

**Fix:**

- PAN uses file-based input for commands containing `$` signs -- this avoids shell expansion
- In context.md and plan code examples, use fenced code blocks (the executor reads them as literal text)
- In custom hooks or scripts, use single quotes to prevent expansion: `'${literal}'`
- Escape dollar signs with backslash when shell expansion is unavoidable: `\${escaped}`

### File encoding issues

**Symptom:** plan.md, state.md, or other planning files contain garbled characters, or tools fail to parse files that look correct in an editor.

**Common causes:**

- Files saved with non-UTF-8 encoding (e.g., UTF-16, Windows-1252)
- BOM (Byte Order Mark) at the start of files confusing parsers
- Line endings mixed between CRLF (Windows) and LF (Unix) in files another tool parses (PAN's own frontmatter reader normalises CRLF and a leading BOM)

**Diagnostic steps:**

1. Check file encoding in your editor (most show encoding in the status bar)
2. Look for a BOM character: the file may start with invisible bytes `EF BB BF`
3. Check line endings: look for `\r\n` versus `\n`

**Fix:**

- Convert files to UTF-8 without BOM
- Use consistent line endings (configure `.gitattributes` with `* text=auto`)
- If using VS Code, click the encoding indicator in the bottom bar to re-save with correct encoding

### Long file paths on Windows

**Symptom:** File operations fail with "path too long" errors, especially in deeply nested phase directories or projects with long names.

**Root cause:** Windows has a default maximum path length of 260 characters. Phase directory paths like `.planning/phases/03-user-authentication/03-02-summary.md` add significant length.

**Fix:**

- Enable long paths in Windows: `git config --system core.longpaths true`
- Or enable via Group Policy: Computer Configuration > Administrative Templates > System > Filesystem > Enable Win32 long paths
- Use shorter project directory names when possible

---

## Diagnostic Commands

Quick reference for diagnosing PAN issues at various levels. The `~/.claude/pan-wizard-core/...` paths below are a global Claude Code install's. A local install (the default) keeps the core in the project, so run `node .claude/pan-wizard-core/bin/pan-tools.cjs` from the project root, and use your runtime's directory (`.codex`, `.gemini`, `.opencode`, `.github`) in place of `.claude`.

### Project health

| Command | What it checks |
|---------|---------------|
| `/pan:health` | Validates ROADMAP/disk consistency, plan numbering, state integrity |
| `/pan:health --repair` | Same as above but auto-fixes what it can |
| `/pan:progress` | Shows current state, phase progress, identifies what to do next |
| `/pan:assumptions N` | Surfaces hidden assumptions about phase N |

### CLI-level diagnostics

| Command | What it checks |
|---------|---------------|
| `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs validate consistency` | Direct consistency check between ROADMAP and disk |
| `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs verify plan-structure <file>` | Validate a single plan.md structure |
| `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state load` | Config plus the raw state.md text, as JSON (`state json` parses the frontmatter) |
| `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state json` | state.md frontmatter as JSON |
| `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs find-phase N` | Resolve phase number to directory path |

### Reading raw state

To inspect PAN's internal state directly:

```bash
# Full state dump as JSON
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state load

# Specific field value
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state get "Current Phase" --raw

# Config value
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-get workflow.research --raw

# Phase directory lookup
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs find-phase 3 --raw

# Resolve which model an agent would use
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs resolve-model pan-executor --raw
```

### Git diagnostics

```bash
# Recent PAN commits
git log --oneline -20

# Commits for a specific phase-plan
git log --oneline --grep="(03-02)"

# Files changed by PAN in this session
git diff --stat HEAD~10

# Check which branch you're on
git branch --show-current

# See all PAN branches
git branch -a | grep pan/
```

### When to escalate

If none of the above resolves your issue:

1. **Check for known issues:** Review the [PAN Wizard repository](https://github.com/oharms/PanWizard) issues and discussions
2. **Collect diagnostics:** Run `/pan:health`, copy the output, and note the exact error message and command that triggered it
3. **Check versions:** Run `cat ~/.claude/pan-wizard-core/VERSION` for your installed PAN version, and note your Claude Code version
4. **File an issue:** Include the health output, error message, PAN version, and steps to reproduce

---

## Spec B v2 Troubleshooting (v3.0-v3.4)

### `/pan:what-if` worktree won't clean up

If `whatif cleanup` fails (e.g. process holding the directory open, permission issues), the worktree and branch remain. Clean up manually:

```bash
git worktree remove --force <worktree-path>
git branch -D pan-whatif/<phase>-<slug>-<ts>
```

The worktree path + branch name are printed by `whatif prepare` and logged to the counterfactual report. Check `git worktree list` if you can't find the path.

Common causes:
- Editor has files open in the worktree (close them first)
- Uncommitted changes in the worktree (use `--force` to discard them)
- Filesystem lock on Windows (close any terminal session with that cwd)

### `/pan:army` left `pan-army-*` directories or `army/*` branches behind

Army worktrees are created as **siblings of the project directory** (`../pan-army-<task>/`), each on an `army/<task>` branch. A completed or aborted campaign should leave none — Phase 5 removes each task's worktree and branch after its squash-merge lands. If any remain (a campaign aborted mid-flight, or predates the teardown), sweep them:

```bash
pan-tools worktree cleanup            # safe sweep — see what it keeps and why
pan-tools worktree cleanup --force    # also discard dirty worktrees + unintegrated branches
```

The default sweep is deliberately cautious: it **keeps** any worktree with uncommitted changes and any branch whose commits are not reachable from your current branch — that branch may be the only copy of aborted work — and prints the exact command to remove each kept item. Read the `kept` list before reaching for `--force`. Two things to know:

- A **squash-merged** branch never looks merged to git, so it shows up as "not reachable" even though its work landed — if the merge is in, deleting it is correct (`git branch -D army/<task>`, or `--force`).
- The sweep only ever touches the `army/` namespace and `pan-army-*` worktrees; your own worktrees and branches are never candidates.

Manual recovery, if the sweep itself is blocked (same causes as the what-if section above):

```bash
git worktree remove --force ../pan-army-<task>
git branch -D army/<task>
git worktree prune
```

### `/pan:mcp-bridge list` returns `source: "empty"`

The MCP tool cache at `.planning/bridge/available-tools.json` isn't populated. Causes:

- **Host runtime hasn't discovered MCP servers yet.** PAN reads the cache; it doesn't probe MCP servers directly. Check `.mcp.json` at the project root (where PAN registers its own server) or run `claude mcp list`.
- **Not on Claude Code.** MCP is Claude-first. Other runtimes report empty.
- **Testing without MCP setup.** Seed the cache manually with `pan-tools bridge cache --runtime claude --servers '[{"name":"test","tools":[{"name":"test.x","description":"test"}]}]'`.

This is expected behavior — `bridge list` is designed to report cleanly when no tools are available.

### The `pan` MCP server is missing on Gemini CLI in a fresh checkout

**Symptom:** PAN installed for Gemini and wrote its `pan` server into `.gemini/settings.json`, but Gemini CLI lists no such server.

**Root cause:** Gemini CLI `0.59.0` (released `2026-09-08`) enforces workspace trust fail-closed. Its trusted-folders documentation states that in an untrusted folder the **whole project `.gemini/settings.json` is not loaded** — so PAN's hooks are absent too, not only the MCP server — and the release note names `mcpServers`, `tools`, `policyPaths` and telemetry among the keys filtered in restricted mode. The registration is present and correct; the runtime declines to load it until you trust the folder.

**Fix:** Accept Gemini CLI's trust prompt for the workspace (or mark it trusted through its workspace-trust setting), then restart the session. PAN's own install checks still pass in the meantime — they verify the file on disk, not the runtime's trust state — so a clean install check plus a missing server is the signature of this case.

### A Codex plugin upgrade seems to need a restart

Since Codex CLI `0.154.0` (released `2026-09-09`), a live session picks up newly installed plugin tools and refreshes skills and hooks after an external plugin upgrade — no restart. If a PAN skill still reads stale after upgrading PAN, the cause is the install, not Codex caching (on Codex `pan-check-update` only records the newest version in `~/.codex/cache/pan-update-check.json`, since Codex runs no PAN statusline to show it): re-run the installer and compare the `version` in `pan-file-manifest.json` with the `VERSION` file the installer writes inside the installed core directory (beside its `bin/` folder).

### PAN's hooks do not run under `copilot -p`

**Symptom:** Copilot CLI works in a PAN project, but no cost rows appear and the stop guard never fires when you run it headless with `copilot -p` — while an interactive session in the same folder behaves.

**Root cause:** in prompt mode Copilot loads a repository's hooks — `.github/hooks/*.json` and the project's `.claude/settings.json` alike — only when the folder is already trusted, `COPILOT_ALLOW_ALL=true` is set, or `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` is set (Copilot CLI reference, environment variables). A folder you have never opened interactively is not trusted, so a scripted `copilot -p` there runs none of PAN's hooks.

**Fix:** open the folder once in an interactive `copilot` session and trust it, or set `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` for the headless run.

### PAN's hooks do not run on Codex, or stopped running after an upgrade

**Symptom:** `.codex/hooks.json` lists PAN's hooks, but no cost rows appear, the stop guard never fires, or they worked before a PAN upgrade and do not now. Codex may print a warning at startup telling you to open `/hooks`.

**Root cause:** Codex runs a non-managed hook only after you trust it, and records that trust against a hash of the hook's definition — its event, matcher and command. Its hooks documentation: "new or changed hooks are marked for review and skipped until trusted." A PAN install adds hooks, and an upgrade that registers a new one (the stop guard on `Stop`, or the state re-injection on `SessionStart`) or changes a command gives Codex hooks it has not reviewed; each is skipped until you trust it. Project-scoped `.codex/` hooks also load only once the project itself is trusted (the trust note the installer prints).

**Fix:** In Codex, run `/hooks`, review the `pan-*` hooks and trust them — the startup prompt's "Trust all and continue" does the same for every hook waiting on review. `--dangerously-bypass-hook-trust` runs enabled hooks without persisted trust for that one invocation, which is useful for a quick check but not a setting to keep. Repeat after any PAN upgrade that changes the hooks.

### `/pan:exec-phase --hierarchical` printed a warning and ran flat

Expected when:
- You're not on Claude Code — the flag needs native sub-agent spawning, which the other runtimes don't support cleanly

The flag degrades to flat exec in that case. There is **no model gate**: `pan-conductor` carries no `model:` frontmatter, so it runs on whatever model you launched the session with (the `budget` profile's advisory tiering is the only thing that would nominate a cheaper one, and it does not block the flag). So "wrong model" is never the reason — if you're on Claude Code with a multi-plan phase and still getting flat exec, the fallback is prose-driven — no deterministic guard exists in code, so check the runtime and the flag's conditions in `commands/pan/exec-phase.md`.

### Cost log records have `input_tokens: 0` and `cost_usd: null`

The SubagentStop hook reads the subagent's own transcript when the payload carries an `agent_id` (`token_source: "agent-transcript"`); without one it sums the slice of the parent session transcript since the previous SubagentStop (`token_source: "transcript"`), and the payload's `usage` block is only a fallback. Zeros mean no transcript was available (headless `claude -p` on a host without agent ids), a parallel sibling already consumed the shared slice, or the host named an agent whose transcript file was not there yet (`token_source: "agent-transcript-missing"`) — the record's `token_source` field says which path ran. Since v3.29 a row with no tokens and no model is an unmeasured spawn: `cost report` excludes it from `calls` and counts it under `totals.empty_excluded` rather than as an unknown-cost call. Rows written by 3.28 and earlier from the parent slice can carry a whole session's usage; `cost report` quarantines those as `suspect_excluded` when they exceed 500M cache-read or 10M output tokens, span more than six hours, or (untimed rows only) show cache reads dwarfing input and output — a timed parent-slice row under those limits is counted, attributed to the subagent that happened to stop — and `hygiene scan` names the ledger poisoned when the quarantined rows dominate it.

Options:
- **Upgrade Claude Code** if its SubagentStop payload carries no `agent_id` (the row's `agent_id` is `null`): the hook needs it to read the subagent's own transcript, and the payload's `usage` block is only the last resort.
- **Append explicit records** for calls you care about: `pan-tools cost append --agent X --model <model-id> --input-tokens N --output-tokens N`. The aggregator merges hook-sourced and caller-sourced records.
- **Reconcile from provider billing.** The hook is directional — use the provider's API (Anthropic console, etc.) for exact monthly totals.

Records with zero tokens still indicate that an agent ran — they're not useless, just incomplete.
