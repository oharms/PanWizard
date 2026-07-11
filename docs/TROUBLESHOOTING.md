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

**Symptom:** Plan checker rejects your plan with "missing required field" errors.

**Required frontmatter fields:**

```yaml
---
phase: "01"
plan: "01"
type: feature|fix|refactor|test|docs
autonomous: true|false
wave: 1
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

**Symptom:** The planner generates a plan, the checker rejects it, the planner regenerates, the checker rejects again -- repeating up to the maximum iteration count (default 3).

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

1. Run `/pan:verify-phase N` to create fix plans targeting the deferred items
2. Execute fixes with `/pan:exec-phase N --gaps-only`
3. For particularly stubborn issues, use `/pan:debug "description of the problem"` which spawns a dedicated debugging agent

### Deferred items accumulating across plans

**Symptom:** Multiple summary.md files in a phase have deferred items. The phase technically "completed" but has quality gaps.

**Root cause:** Individual plan executors deferred issues they could not resolve within their 3-attempt limit. These accumulate because each plan executor starts fresh and does not see previous plans' deferred items.

**Diagnostic steps:**

1. Check each summary.md in the phase directory for "Deferred Issues" sections
2. Check `deferred-items.md` for the consolidated list
3. Run `/pan:verify-phase N` -- the verifier reads all deferred items and produces a gap analysis

**Recovery:**

1. Run `/pan:verify-phase N` to get a verification.md with a consolidated gap analysis
2. Review the verification results to prioritize which items to fix
3. Use `/pan:exec-phase N --gaps-only` to execute only the gap-closure plans
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

```
/pan:health
```

**Common causes:**

- Manual editing of state.md broke the `**Field:** value` format (fields must follow this exact pattern)
- YAML frontmatter and markdown body fields are out of sync (the frontmatter is canonical)
- Interrupted execution left state partially updated (executor crashed between `state advance-plan` and `state update-progress`)
- A plan was manually deleted from the phase directory but state.md still references it

**Fix options (from least to most destructive):**

1. **Auto-repair:** Run `/pan:health --repair` to fix consistency issues automatically
2. **Manual fix:** Edit `.planning/state.md` directly -- ensure fields use `**Field:** value` format and the YAML frontmatter matches
3. **Reconstruct from disk:** Delete state.md and run `/pan:progress` -- PAN regenerates state by scanning roadmap.md and existing summary.md files
4. **Full reset:** Delete `.planning/state.md` and `.planning/roadmap.md`, then re-run `/pan:progress` to rebuild from project.md and phase directories

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
2. If the file is badly corrupted, delete it and run any `/pan:` command -- config is recreated with defaults
3. Then use `/pan:settings` to reconfigure your preferences

### .planning/ directory missing or inaccessible

**Symptom:** "Failed to create .planning directory", "EACCES: permission denied", or commands report "Project not initialized" despite previous initialization.

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
- For missing directory: run `/pan:new-project` to reinitialize (this will not overwrite existing files if `.planning/project.md` exists)
- For wrong working directory: navigate to the project root before running PAN commands

### Phase directory numbering mismatch

**Symptom:** Phase directories use different numbering than roadmap.md, or `find-phase` returns the wrong directory.

**Root cause:** Phase directories are named `XX-phase-name/` where XX is the zero-padded phase number. If phases were inserted (e.g., phase 3.1), the directory name uses the full number. Renaming directories manually breaks the mapping.

**Diagnostic steps:**

1. List phase directories: check `.planning/phases/` contents
2. Compare against roadmap.md phase listing
3. Run `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs find-phase N --raw` to see what PAN resolves

**Fix:** Do not rename phase directories manually. Use `/pan:insert-phase` and `/pan:remove-phase` to manage phase structure. If directories are already mismatched, run `/pan:health --repair` to attempt reconciliation.

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

**Symptom:** You enabled `auto_advance: true` in config but still get a checkpoint that pauses execution.

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
2. Run `/pan:verify-phase N` to generate targeted fix plans
3. Execute with `/pan:exec-phase N --gaps-only`
4. Re-verify to confirm stubs are replaced with real implementations

### Wiring verification fails

**Symptom:** verification.md reports "component does not call API", "API does not query database", or similar layer-connection failures.

**What wiring means in PAN's verification model:**

```
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

**Fix:** Wiring issues usually require small, targeted changes (adding an import, changing a fetch URL, connecting a handler to the database). Run `/pan:verify-phase N` to create fix plans that specifically address the wiring gaps.

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

**Fix:** If the actual work was done (files exist, commits present), the self-check failure is cosmetic. If files or commits are genuinely missing, use `/pan:verify-phase N` to identify and fill the gaps.

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

1. Check current config: look at `.planning/config.json` for the `git` section
2. Check all branches: `git branch -a`
3. Check where the commits are: `git log --all --oneline --graph -20`

**Expected config for branching:**

```json
{
  "git": {
    "branching_strategy": "phase",
    "phase_branch_template": "pan/{phase}-{slug}",
    "milestone_branch_template": "pan/{milestone}"
  }
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

**Available types:** `feat`, `fix`, `test`, `refactor`, `chore`, `docs`

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

| Stage | Budget Profile | Balanced Profile | Quality Profile |
|-------|---------------|-----------------|----------------|
| Research | 10-20K | 30-50K | 50-80K |
| Planning | 10-20K | 20-40K | 40-70K |
| Execution (per plan) | 10-40K | 20-80K | 40-120K |
| Verification | 5-10K | 10-20K | 15-30K |

**Common causes of higher-than-expected usage:**

- Plan checker rejection loop (up to 3 iterations = 3x planning cost)
- Executor auto-fix loops (each Rule 1-3 attempt costs additional tokens)
- Plans with too many tasks (4+ tasks per plan increases per-plan cost)
- Using `quality` profile when `balanced` would suffice
- Research enabled for a domain you already know well

**Cost reduction strategies (ordered by impact):**

1. **Switch profile:** `/pan:profile budget` for prototyping, `balanced` for production work
2. **Skip research:** `/pan:plan-phase N --skip-research` for familiar domains
3. **Disable plan checker:** `workflow.plan_check: false` in `/pan:settings` (saves 20-40K per phase)
4. **Disable verifier:** `workflow.verifier: false` for early prototyping (saves 10-30K per phase)
5. **Smaller plans:** Keep plans to 2-3 tasks each (reduces per-plan context usage)
6. **Use --prd:** Provide a detailed PRD with `/pan:plan-phase N --prd spec.md` to skip discuss-phase

### Wrong model being used for an agent

**Symptom:** An agent uses Sonnet when you expected Opus, or vice versa. Execution quality does not match expectations for the configured profile.

**How model selection works:**

| Agent type | Budget | Balanced | Quality |
|-----------|--------|----------|---------|
| Research | Haiku | Sonnet | Opus |
| Planning | Sonnet | Opus | Opus |
| Execution | Sonnet | Sonnet | Opus |
| Verification | Haiku | Sonnet | Opus |
| Plan checker | Haiku | Sonnet | Opus |

**Override precedence:** Per-agent override > profile default > hardcoded default

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
    "pan-researcher": "haiku"
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
3. For complex tasks, use `model_overrides` to assign Opus to the executor
4. Add more detail to the phase's context.md to provide implementation guidance

---

## Context and Sessions

### Context window exhausted mid-phase

**Symptom:** Claude becomes less coherent, loses track of the current task, or starts repeating itself. The context monitor (if installed) shows CRITICAL warning.

**Why this happens:** The main session accumulates context from every command you run. PAN subagents (executors, verifiers) each get fresh 200K windows, but the orchestrating session does not reset automatically.

**Immediate recovery:**

1. Run `/pan:pause` -- this saves progress to a pause.md handoff document
2. Start a new Claude Code session
3. Run `/pan:resume` -- this restores context from state.md, roadmap.md, recent summary.md files, and pause.md

**Prevention strategies:**

- Run `/clear` between major commands (e.g., after plan-phase completes, before exec-phase)
- Avoid reading large files in the main session -- let subagents handle file reading
- Use `balanced` or `budget` profile (Opus generates more verbose output, consuming more context)
- Keep plans to 2-3 tasks each to reduce executor output size

### resume restores incomplete context

**Symptom:** After resuming, PAN seems to have forgotten important details about the project or recent work.

**What `/pan:resume` restores:**

| Source | Content | Always loaded |
|--------|---------|--------------|
| state.md | Current phase, plan, status, decisions | Yes |
| roadmap.md | Project overview, phase list, progress | Yes |
| pause.md | Handoff notes from pause | If exists |
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

**Root cause:** PAN's state management is file-based and does not implement locking. Concurrent sessions writing to the same state.md or committing to the same branch will conflict.

**Prevention:** Do not run multiple PAN sessions on the same project simultaneously. PAN is designed for single-session operation.

**Recovery:**

1. Close all but one session
2. Run `/pan:health --repair` to fix any state inconsistencies
3. Check `git log` for duplicate or conflicting commits
4. Manually resolve any git conflicts

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
- Line endings mixed between CRLF (Windows) and LF (Unix) causing parsing issues in YAML frontmatter

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

Quick reference for diagnosing PAN issues at various levels.

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
| `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state load` | Dump current state.md as structured JSON |
| `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state json` | state.md frontmatter as JSON |
| `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs find-phase N` | Resolve phase number to directory path |

### Reading raw state

To inspect PAN's internal state directly:

```bash
# Full state dump as JSON
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state load --raw

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

### `/pan:mcp-bridge list` returns `source: "empty"`

The MCP tool cache at `.planning/bridge/available-tools.json` isn't populated. Causes:

- **Host runtime hasn't discovered MCP servers yet.** PAN reads the cache; it doesn't probe MCP servers directly. Check your Claude Code MCP configuration (`.claude/settings.json` or `~/.claude/settings.json` under `mcpServers`).
- **Not on Claude Code.** MCP is Claude-first. Other runtimes report empty.
- **Testing without MCP setup.** Seed the cache manually with `pan-tools bridge cache --runtime claude --servers '[{"name":"test","tools":[{"name":"test.x","description":"test"}]}]'`.

This is expected behavior — `bridge list` is designed to report cleanly when no tools are available.

### `/pan:exec-phase --hierarchical` printed a warning and ran flat

Expected when:
- You're not on Claude Code (other runtimes don't support agents-spawn-agents)
- Your default model isn't Opus 4.7
- Your phase has only 1 plan file (`pan-conductor` refuses to orchestrate a single-plan phase — it would be pure overhead)

The flag silently degrades to flat exec in all three cases. To verify it would trigger, check `commands/pan/exec-phase.md` for the flag's runtime matrix. If you're on Claude + Opus 4.7 and still getting flat exec, look at the stderr warning — it names the specific guard that fired.

### Cost log records have `input_tokens: 0` and `cost_usd: null`

The SubagentStop hook captures whatever Claude Code's event payload provides. If `usage` data isn't present in the payload (depends on Claude Code version + Task tool implementation), the record logs zeros.

Options:
- **Upgrade Claude Code** if your version predates `usage` field support in SubagentStop.
- **Append explicit records** for calls you care about: `pan-tools cost append --agent X --model claude-opus-4-7 --input-tokens N --output-tokens N`. The aggregator merges hook-sourced and caller-sourced records.
- **Reconcile from provider billing.** The hook is directional — use the provider's API (Anthropic console, etc.) for exact monthly totals.

Records with zero tokens still indicate that an agent ran — they're not useless, just incomplete.
