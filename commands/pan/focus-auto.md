---
name: focus-auto
group: Focus
description: Continuous scan-plan-exec loop with purpose-driven categories and 5-layer safety harness
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
---

# /pan:focus-auto — Continuous Autonomous Improvement Campaigns

Run purpose-driven improvement campaigns with a single command. The auto-runner orchestrates scan, plan, and exec cycles automatically with category-scoped scanning, intelligent defaults, and structured stopping.

**ADR:** ADR-0015 | **Heritage:** execplan budget + PanMonty categories + focus-exec pipeline

## Project Scope Boundary

This command runs improvement campaigns on the **host project's source code** — not on PAN Wizard's own infrastructure.

**Exclude these directories from scanning and execution:**
- `.claude/`, `.github/copilot-instructions.md`, `.opencode/`, `.gemini/`, `.codex/` — PAN runtime directories
- Any `pan-wizard-core/`, `pan-tools`, agent `.md`, or command `.md` files within PAN runtime directories

**These directories are PAN's own tooling installed into the project.** Do not scan PAN files for TODOs, do not report PAN files as lacking coverage, do not modify PAN agents/commands/core as part of a campaign. If a scan finding or batch item targets a PAN infrastructure file — DROP IT.

---

<completion_contract>
A campaign is complete when ANY stop condition is met:
1. Max cycles reached (--max-cycles, default 10)
2. Total budget exhausted (--total-budget, default 200)
3. Scan returns zero items for the selected category
4. Context window drops below 25% (CRITICAL threshold)
5. User sends /pan:focus-auto --stop
6. Category-specific completion (e.g., prompts_remaining === 0)

Each cycle is complete when: scan → plan → exec → commit succeeds, OR a safety harness triggers and the cycle is cleanly aborted with state preserved.
</completion_contract>

## FIRST ACTION — Category Selection (if no --category argument)

If `$ARGUMENTS` does NOT contain `--category`, you MUST ask the user before doing anything else.

**Display this text menu and STOP — wait for the user to reply:**

```
Which category should this auto campaign focus on?

1. **cleanup** — Dead code, unused imports, duplicated logic, magic numbers (P3-P5)
2. **stability** — Unguarded file ops, missing error handling, crash risks (P0-P2)
3. **tests** — Missing test coverage, low assertion density (P2-P5)
4. **features** — Roadmap items, new capabilities (P3-P5)
5. **docs** — Stale documentation, missing command descriptions (P5-P6)
6. **optimize** — Performance bottlenecks, redundant computation, robustness hardening (P1-P4)
7. **prompts** — Execute micro-prompt documents sequentially, or generate them from specs (P0-P6)
8. **security** — OWASP Top 10 violations, STRIDE threats, auth/injection/crypto hardening (P0-P2)
9. **distill** — AI code-bloat: phantom try/catch, unused imports, repeated blocks, premature abstraction, god functions (P1-P5)

Reply with a number (1-9) or category name.
```

**After the user replies, map their response to a category name:**
- "1" or "cleanup" → SELECTED_CATEGORY = cleanup
- "2" or "stability" → SELECTED_CATEGORY = stability
- "3" or "tests" → SELECTED_CATEGORY = tests
- "4" or "features" → SELECTED_CATEGORY = features
- "5" or "docs" → SELECTED_CATEGORY = docs
- "6" or "optimize" → SELECTED_CATEGORY = optimize
- "7" or "prompts" → SELECTED_CATEGORY = prompts
- "8" or "security" → SELECTED_CATEGORY = security
- "9" or "distill" → SELECTED_CATEGORY = distill

Wait for the user's reply before proceeding. Do not guess or pick a default category.

## AUTONOMY RULES (apply AFTER category is selected)

- **DO NOT invoke the Skill tool.** All scan, plan, and exec work is done INLINE within this command.
- **DO NOT stop between phases.** Execute Phase 0 through Phase 3 (or until a safety harness triggers) without pausing.
- **DO NOT ask the user any more questions.** After category selection, run fully autonomously.
- **DO NOT show intermediate results.** Only display: the cycle summary line after each cycle, and the campaign summary table at the end.

## Arguments

```
/pan:focus-auto [--source scan|backlog] [--category CAT] [--mode MODE] [--budget N]
                [--max-cycles N] [--total-budget N] [--continue] [--stop] [--status]
                [--dry-run] [--deep-review]
                [--parallel-research] [--parallel-verify] [--clean-seal]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--source` | `scan` | Work selection. `scan` = category-scoped code scan (below). `backlog` = rank actionable items from `roadmap.md` / `requirements.md` (ADR-0031). |
| `--category` | null (all) | cleanup, tests, stability, features, docs, optimize, prompts, security, distill. Applies to `--source scan`. |
| `--mode` | category-dependent | bugfix, balanced, features, full |
| `--budget` | category-dependent | Points per cycle (5-100) |
| `--max-cycles` | 10 | Maximum iterations (1-50) |
| `--total-budget` | 500 | Cumulative points cap (5-5000) |
| `--continue` | — | Resume stopped/interrupted run |
| `--stop` | — | Gracefully stop active run |
| `--status` | — | Show current campaign progress |
| `--dry-run` | — | Show plan without executing |
| `--deep-review` | off | After every exec cycle, run inline OWASP security check on changed files. Verdict `block` or `review_required` stops the campaign (6th safety harness). Works with all categories. |
| `--parallel-research` | off | Fan out the per-item *research* stage via the Workflow tool (read-only agents). No-op fallback to sequential where the host has no Workflow tool. (ADR-0031) |
| `--parallel-verify` | off | Fan out the per-item *verify* stage via the Workflow tool (read-only). The implement/exec stage always stays a single agent. (ADR-0031) |
| `--clean-seal` | off | After the loop's last item, run one clean build + full verification (commands from `config.json → build`/`verification`) to catch cross-item orphans. (ADR-0031) |

## Category Defaults

| Category | Priority Range | Default Mode | Default Budget |
|----------|---------------|--------------|----------------|
| cleanup | P3-P5 | balanced | 50 |
| tests | P2-P5 | balanced | 50 |
| stability | P0-P2 | bugfix | 40 |
| features | P3-P5 | features | 50 |
| docs | P5-P6 | balanced | 30 |
| optimize | P1-P4 | balanced | 50 |
| prompts | P0-P6 | balanced | 100 |
| security | P0-P2 | bugfix | 40 |

## Backlog source (`--source backlog`, ADR-0031)

When `--source backlog` is set, work is selected from the **curated planning surface** instead of a code scan — for campaigns that work a human-prioritized roadmap rather than whatever grep finds.

1. **Read the backlog once** at Phase 0: actionable items are unchecked rows in `roadmap.md` (phase/plan checkboxes) and unmet `requirements.md` REQ rows. Skip anything struck, completed, or marked blocked.
2. **Score from the CURRENT document — never a hardcoded ID list.** For each item, derive `RS = (UserValue + TimeCriticality + RiskReduction) / Effort` (1–5 each; Effort from the row's size tag). Sort by wave/priority ascending → RS descending → effort ascending. This re-derives the order from whatever the roadmap says today, so it never goes stale.
3. **Pop the top survivor each cycle**; re-rank only if a landing changed a dependency. The same budget/cycle/context stops and safety harness apply unchanged.
4. The backlog ranker reads only PAN's planning files — it embeds **no** project-specific item IDs, test counts, or build commands. A project with no actionable backlog items is a clean stop (`scan returns zero items` equivalent).

## Concurrency model (when `--parallel-research` / `--parallel-verify`, ADR-0031)

The proven shape is **parallel read-only research → exactly ONE serial implement/exec → parallel read-only verify**:

| Stage | Concurrency | Why |
|-------|-------------|-----|
| Research | Parallel (Workflow fan-out, read-only) when `--parallel-research` | Reads source/specs; mutates nothing. |
| Implement / exec | **Single agent, always** | Mutates the tree; never fanned out. |
| Verify | Parallel (Workflow fan-out, read-only) when `--parallel-verify` | Runs against the already-built tree; mutates nothing. |

**Serial-build constraint:** if `.planning/config.json → concurrency.serial_build` is `true`, the runner additionally guarantees at most one build process at any instant across the whole loop (for projects whose build trees corrupt under concurrency). This is **off by default** — most projects build in parallel safely. PAN does not assume it.

**Commit-quality gates** (advisory, always on): a *staging-miss guard* (no exec-touched file left unstaged) and an *orphan audit* (HEAD must not reference a symbol defined only in an uncommitted file). With `--clean-seal`, a single clean build + full verification runs after the last item to catch cross-item orphans the per-cycle incremental commits hid.

## Pipeline

### Phase 0: Initialization

1. Parse arguments from `$ARGUMENTS`
2. Handle quick operations first:
   - If `--status`: run `pan-tools focus auto --status`, display result, STOP
   - If `--stop`: run `pan-tools focus auto --stop`, display result, STOP
3. If `--continue`:
   - Run `pan-tools focus auto --continue` to resume
   - Read the restored state to get category, mode, budget, etc.
   - Skip to Phase 2 (Main Loop)
4. If no `--category` was provided, you already displayed the menu in FIRST ACTION above. Use SELECTED_CATEGORY from the user's reply.
5. Initialize new run using the category from step 4:
   - Run `pan-tools focus auto --category <SELECTED_CATEGORY> [--mode MODE] [--budget N] [--max-cycles N] [--total-budget N] [--dry-run]`
   - If `--dry-run`: display the plan, STOP
   - Record the run state

### Phase 1: Baseline Capture

1. Run the project's test suite (discover the test command from `package.json` scripts, `Makefile`, or project docs)
2. Record baseline test count from the summary line (e.g., "tests 1314")
3. If tests fail: ERROR — "Cannot start: N tests failing. Fix tests before running auto campaign."
4. Run `git status` to verify clean working tree (warn if dirty, don't block)
5. Create safety tag: `git tag -f focus-auto-baseline`

<phase_dependencies>
Phase 0 → Phase 1: Init MUST succeed before baseline (state tracking requires valid run)
Phase 1 → Phase 2: Baseline MUST be captured before main loop (regression circuit breaker needs it)
Phase 2 (each cycle): Scan → Plan → Exec → Commit is strictly sequential within a cycle
  - Scan MUST complete before plan (plan needs scan items)
  - Plan MUST complete before exec (exec needs batch file)
  - Exec MUST complete and tests pass before commit (never commit broken code)

HARD STOP conditions:
- Phase 1 fails (tests broken): Do not enter main loop — report and exit
- Any cycle: test count drops below baseline after revert → stop campaign, preserve state
- Context drops below 25%: stop campaign cleanly (safety harness 3)
</phase_dependencies>

### Phase 2: Main Loop

**For each cycle (1 to max_cycles), execute Steps 2.1 through 2.5 without stopping:**

#### Step 2.1: Scan (INLINE — do NOT invoke /pan:focus-scan)

Perform a deep codebase scan to find actionable work items with evidence.

**2.1.1 Read Codebase State**
- Read project source files via Glob + Read: modules, entry points, key directories
- Read planning state: `.planning/config.json`, any state/roadmap files that exist
- Read `package.json` (or equivalent project manifest) for version and entry points

**2.1.2 Search for Issues**
- Grep for `TODO`, `FIXME`, `HACK`, `STUB` in source and test directories
- Grep for error-prone patterns relevant to the category:
  - **stability:** unguarded `readdirSync`/`readFileSync` without try-catch, `existsSync` calls, `.forEach()` on unverified values, `parseInt` without NaN checks, `.match()` results accessed without null check
  - **cleanup:** dead code, unused imports, duplicated logic, magic numbers
  - **tests:** modules without corresponding test files, low assertion density
  - **features:** roadmap items not yet implemented, README promises without backing code
  - **docs:** stale documentation, missing command descriptions
  - **optimize:** N+1 operations (file I/O / network calls inside loops), redundant re-computation (`JSON.parse`/`stringify` of same data), synchronous blocking in async modules (`readFileSync`/`execSync` alongside async exports), algorithmic complexity (nested `.find()`/`.filter()` in loops creating O(n²)+), unnecessary allocations in hot paths (spread in loops, string concat vs `join()`), regex construction inside loops (should be hoisted), unbounded collection growth (`.push()` without size limits), swallowed errors (`catch {}` / `catch { /* */ }`), suboptimal data structures (array `.includes()` where Set is better), dead assignments, unguarded property access on nullable values (`.length`/`.split()`/`.match()[0]` without null check)
  - **security:** Three-pass approach:
    - **Pass 1 — Injection & crypto (inline grep):** Scan source files for `eval(`, `execSync`, `exec(`, string concatenation in SQL patterns (`` `SELECT...${`` / `"SELECT..."+`), `md5(`/`sha1(`/`createHash('md5'`/`createHash('sha1'`, hardcoded secrets (`password\s*=\s*['"]`, `api_key\s*=\s*['"]`, `secret\s*=\s*['"`), `Math.random()` used for security purposes.
    - **Pass 2 — Auth & access control (inline grep):** Routes without auth middleware (look for `router.get/post/put/delete` without preceding `app.use(...auth...)`), `req.params.id` used directly without ownership check, `JSON.parse(` on `req.body` without schema validation, CORS `origin: '*'` or `Access-Control-Allow-Origin: *`, verbose errors that expose stack traces (`res.json({ stack:`).
    - **Pass 3 — Semantic depth (Agent tool, optional):** For M/L items where grep found a suspicious pattern but fix guidance needs code-path tracing, use the Agent tool to spawn the `pan-hardener` subagent (pinned to `model: opus`, off Fable's cybersecurity classifier) to read the specific file and confirm the weakness is genuinely reachable before including in the batch.
    - **Classification:** Map findings to priorities: OWASP critical/directly-reachable → P0, High/missing-authorization → P1, Medium/defense-in-depth → P2. Drop LOW/INFO — they don't meet the P0-P2 filter.
  - **prompts:** Two operational modes — detect which applies:
    - **Execute mode:** Find micro-prompt documents (`.md` files containing ordered prompt blocks, e.g., `## Prompt 1`, `## Prompt 2`, or numbered checklist items `- [ ] Prompt: ...`). Look in `.planning/`, project root, and `docs/` for files matching patterns: `*prompts*`, `*micro-prompt*`, `*prompt-plan*`, `*prompt-sequence*`. Each unchecked/incomplete prompt block is one work item.
    - **Generate mode:** Find specification documents (files matching `*spec*`, `*prd*`, `*requirements*`, `*feature*` in `.planning/`, `docs/specs/`, project root) that do NOT already have a corresponding micro-prompt document. Each spec needing decomposition is one work item.

**Optimize category: convergent re-scan.** On cycles 2+, cross-reference scan findings against previous cycle completions (`cycles[].items` in auto-run state). Only pick genuinely new items — skip IDs already completed or failed. If the count of new findings drops AND cycle efficiency drops below 30% of the prior cycle's, this signals convergence and the `diminishing_returns` stop condition fires.
- Use the Agent tool with Explore subagent for thorough analysis if needed
- Cross-reference findings with any previously completed scan items

**2.1.3 Classify Items**

| Priority | Focus | Criteria |
|----------|-------|----------|
| P0 | CRASH/ERROR | Runtime throws, uncaught exceptions |
| P1 | WRONG RESULTS | Silent corruption, incorrect output |
| P2 | TEST GAPS | Missing coverage, low assertion density |
| P3 | INCOMPLETE | Partially implemented features |
| P4 | NEW FEATURES | From roadmap, not yet started |
| P5 | TOOLING | DX improvements, CLI UX |
| P6 | DOCUMENTATION | Docs sync, reference updates |

For P3-P6 items, compute Reality Score: `RS = (UV + TC + RR) / JS`
- UV = User Value (1-5), TC = Time Criticality (1-5), RR = Risk Reduction (1-5)
- JS = Job Size: XS=1, S=2, M=3, L=5, XL=8
- RS >= 3.0 = DO, RS 1.5-2.9 = DEFER, RS < 1.5 = BACKLOG

**2.1.4 Filter by Category**
Only keep items within the run's category priority range (see Category Defaults table). Drop items outside the range. If 0 items match: go to Phase 3 (Campaign End).

**2.1.5 Write Scan**
Write scan results to `.planning/focus/scan-<YYYY-MM-DD>-<category>.md` with:
- Baseline snapshot table (version, tests, modules)
- Items grouped by priority tier, each with: ID, title, symptom, root cause, fix guidance, file paths, effort size
- Summary: item count by priority, total points

#### Step 2.2: Plan (INLINE — do NOT invoke /pan:focus-plan)

Create a capacity-budgeted batch from the scan items found in Step 2.1.

**Capacity Points:** XS=1, S=2, M=4, L=10, XL=20

**Allocation by Mode:**
- `bugfix`: All budget on P0 mandatory, then P1, then P2-P4 smallest-first. No feature work.
- `balanced`: 60% stability (P0-P2), 40% features (P3-P6)
- `features`: P0 mandatory, then 80% on P3-P5, 20% on P1-P2 quick wins
- `full`: All priorities equally weighted, largest-impact-first

**Execution Tiers:** XS/S = MICRO, M = STANDARD, L/XL = FULL
Select items fitting within the cycle's `budget_per_cycle`. Order: MICRO first, then STANDARD, then FULL.

Write batch to `.planning/focus/batch-<YYYY-MM-DD>-<category>.json`:
```json
{ "date": "...", "mode": "...", "budget": N, "allocated": N,
  "items": [{ "order": N, "id": "...", "title": "...", "priority": "P1",
              "size": "XS", "points": N, "tier": "MICRO", "file": "...", "fix": "..." }],
  "deferred": [{ "id": "...", "title": "...", "reason": "..." }] }
```

#### Step 2.3: Execute (INLINE — do NOT invoke /pan:focus-exec)

Implement each item from the batch created in Step 2.2. Record `tests_before` by running the test suite first.

**For each item in execution order:**

**MICRO items (XS/S):**
1. Read target file(s) — always read before editing
2. Implement the fix
3. Run the specific test file for the changed module
4. Pass = DONE | Fail = one fix attempt, then revert changes, mark FAILED

**STANDARD items (M):**
1. State understanding: "Item X — Understanding: ..., Files: ..., Confidence: HIGH/MED"
2. Read target files + test files
3. Implement across necessary files
4. Run the project's test suite
5. Pass = DONE | Regression = revert all changes for this item, mark FAILED

**FULL items (L/XL):**
1. State detailed understanding
2. Read widely: target, callers, tests, related code
3. Design approach before coding
4. Implement in logical chunks
5. Run the project's build step if applicable
6. Run the project's test suite
7. Pass = DONE | Fail = investigate (15 min max), then revert, mark FAILED

**Error Recovery Classification:**
- RECOVERABLE (retry up to 3 times): test failure after code change, build syntax error, file not found (search for moved path)
- UNRECOVERABLE (mark FAILED, move to next item): same failure after 3 retries, permission errors, state corruption, unrelated test regression
A failed item never blocks subsequent items.

**After all items in the batch:**
1. Run full test suite — ALL tests must pass
2. Record `tests_after` from the summary line
3. If `tests_after < tests_before`: REGRESSION — revert all changes for this cycle, mark all items FAILED
4. Update the scan file: mark completed/failed items
5. Stage specific changed files (not `git add -A`) and commit with accurate message listing only verified items
6. Count: `items_completed`, `items_failed`, `points_used`

**If `--deep-review` flag is active (run after commit, before recording cycle):**

Get changed files from this cycle's commit:
```bash
CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null | grep -E '\.(js|ts|jsx|tsx|py|go|rb|java|php)$')
```

Run inline OWASP security check on changed files only:
- Grep each changed file for critical patterns:
  - Injection: `eval(`, `execSync(`, SQL string concat (`` `SELECT...${`` ), `child_process.exec(`
  - Crypto: `createHash('md5'`, `createHash('sha1'`, `Math.random()` near auth/token/secret context
  - Auth bypass: routes with no auth guard added, `req.params` used as DB key without ownership check
  - Secrets: `password\s*=\s*['"]`, `apiKey\s*=\s*['"]`, `token\s*=\s*['"]` assigned to a literal value
- Score findings by severity: critical (exploit-ready) → BLOCK; high (auth/injection surface) → WARN; medium/low → LOG

**Handle deep-review verdict:**

| Severity found | Verdict | Action |
|---------------|---------|--------|
| Critical pattern in changed file | `block` | STOP campaign — do NOT record cycle, revert last commit, present finding to user |
| High pattern in changed file | `review_required` | STOP campaign — record cycle as completed, flag finding, recommend manual review |
| Medium/low only | `ok_with_minor` | Continue — append findings to `.planning/focus/security-log-<date>.md` |
| No patterns | `ok` | Continue silently |

Write all non-ok findings to `.planning/focus/security-log-<date>.md` with file:line references.

#### Step 2.4: Record Cycle

Run: `pan-tools focus auto --update --items-completed N --items-failed N --points-used N --tests-before N --tests-after N --batch-file <path>`

Check the response for stop conditions:
- `regression`: Tests decreased — STOP IMMEDIATELY
- `budget_cap`: Cumulative budget exceeded — go to Phase 3
- `max_cycles`: Maximum iterations reached — go to Phase 3
- `zero_completed`: No items completed in this cycle — go to Phase 3
- `diminishing_returns`: Optimize only — cycle efficiency < 30% of previous cycle — go to Phase 3
- `prompts_complete`: Prompts only — all prompts in document executed — go to Phase 3
- `security_complete`: Security only — scan found no HIGH/CRITICAL items remaining — go to Phase 3
- `deep_review_block`: `--deep-review` only — critical pattern detected in changed files — go to Phase 3 with warning
- `null`: Continue to next cycle

#### Step 2.5: Inter-Cycle Context Management

Between cycles, manage context to prevent quality degradation over long campaigns:
- **KEEP:** Current cycle goals, test baseline, error states, active file paths
- **SUMMARIZE:** Previous cycle results to a one-line summary each
- **DISCARD:** Raw tool output from previous cycles, superseded scan results

Display one-line cycle summary: `Cycle N/M | X/Y pts | Z items done | Tests: A -> B`

#### Step 2.5a: Reflection Gate (Opus 4.7 thinking-capable models only)

Before committing to the next cycle, call the reflection helper:

```
echo '{"run": <run-state>, "cycle": <just-completed-cycle>, "batch": <proposed-next-batch>, "tier": "reasoning"}' \
  | pan-tools focus reflection
```

The helper returns `{reflect: true, prompt: "..."}` when the current model tier supports extended thinking. If `reflect: true`, think through the prompt — which asks whether running another cycle is worthwhile given telemetry and remaining items — and respond with JSON: `{"continue": true|false, "rationale": "..."}`.

- If `continue: false`: stop the campaign and treat as a user-reason stop (preserve state, skip to Phase 3).
- If `continue: true`: proceed to the next cycle.

If the helper returns `reflect: false` (tier doesn't support thinking, or `reflection_enabled: false` in run state, or no next batch): skip this step silently and continue to the next cycle.

The reflection gate catches "zero progress" or "wrong category" drift earlier than the automatic stop rules.

**Attention anchor — emit after every cycle summary:**
```
Remaining: {cycles_left} cycles | {budget_remaining}/{total_budget} pts | Safety: {active_harness_warnings}
Next: Cycle {N+1} — Scan → Plan → Exec → Commit
```
This prevents lost-in-the-middle drift in 10+ cycle campaigns where the agent forgets budget limits or stop conditions.

Then continue immediately to the next cycle (back to Step 2.1).

### Phase 3: Campaign End

1. Run `pan-tools focus auto --status` to get final state
2. Display campaign summary:

```
## Campaign Complete

| Metric | Value |
|--------|-------|
| Category | <category> |
| Cycles | N completed |
| Items completed | X |
| Items failed | Y |
| Points used | Z / total_budget |
| Tests | baseline -> current (delta) |
| Stop reason | <reason> |
```

3. Remove safety tag: `git tag -d focus-auto-baseline 2>/dev/null`

## 6-Layer Safety Harness

| Layer | Mechanism | Action |
|-------|-----------|--------|
| Per-cycle budget | `--budget N` per cycle | Limits single-cycle damage |
| Cumulative budget | `--total-budget N` | Prevents runaway spending |
| Iteration limit | `--max-cycles N` | Hard stop on loop count |
| Regression circuit breaker | tests_after < tests_before | Immediate stop, status=stopped |
| Zero-completed guard | 0 items done in a cycle | Stop — further cycles won't help |
| Security gate (`--deep-review`) | Critical/high OWASP pattern in changed files | Revert last commit (critical) or flag for manual review (high), stop campaign |

## 9 Behavioral Rules

1. **Read Before Write** — Read every file before editing. Understand context, callers, invariants.
2. **Root Cause** — Fix the actual defect, not symptoms. Trace the code path.
3. **One Change, One Test** — Test after every code change. MICRO: specific test. STANDARD/FULL: full suite.
4. **Follow the Plan** — Implement exactly what the batch says. No scope creep.
5. **Cross-Platform** — Use platform-agnostic path APIs. Follow the project's module format conventions.
6. **Revert Fast** — 5 min limit on debugging a single failure, then revert and mark FAILED.
7. **Verify Understanding** — State understanding for M+ items before coding.
8. **Preserve Tests** — Never change test expectations to match broken code.
9. **Accurate Commits** — Only claim verified items in commit messages. Include actual test counts.
10. **Vary Similar Fixes** — When 3+ items in a cycle share the same fix pattern (e.g., "add null check"), re-read each module's conventions before applying. The same pattern may need different implementations in different modules. Check after the 3rd fix whether a shared helper would be better than scattered copies.

## Prompts Category — Execution Details

The prompts category operates in two distinct modes. Detect which mode applies during the scan phase based on what the scan finds.

### Execute Mode (micro-prompt document found)

A micro-prompt document contains an ordered sequence of self-contained implementation prompts. Each prompt describes a single, testable change.

**Document format recognized:**

```markdown
# Micro-Prompts: <Feature Name>

Source: <spec file or description>
Generated: <date>

## Prompt 1: <title>
- [ ] Complete

<implementation instructions>

### Expected outcome
<what should work after this prompt>

### Test
<how to verify>

---

## Prompt 2: <title>
- [ ] Complete
...
```

Alternative format — checklist style:
```markdown
- [ ] Prompt 1: <title> — <instructions>
- [ ] Prompt 2: <title> — <instructions>
```

**Execution strategy:**

1. Read the micro-prompt document, identify all prompt blocks
2. Find the first uncompleted prompt (unchecked `- [ ]`)
3. Execute that prompt's instructions — implement the code changes described
4. Run the project's test suite (or the prompt-specific test if given)
5. If tests pass: mark the prompt as complete (`- [x]`), commit, move to next prompt
6. If tests fail: one fix attempt, then revert and mark prompt as FAILED, move to next prompt
7. Each prompt = one batch item. Budget: 1 prompt per cycle unless prompt is trivial (XS)
8. Record `prompts_remaining` count in cycle update — when 0, `prompts_complete` stop fires

**Key rules:**
- Execute prompts in document order — NEVER skip ahead or reorder
- Each prompt is atomic — commit after each successful prompt
- A failed prompt does NOT block subsequent prompts (mark failed, continue)
- The prompt document is the plan — do not re-plan or expand scope beyond what each prompt says

### Generate Mode (spec found without corresponding prompt document)

When a specification document is found that doesn't have a matching micro-prompt document, decompose it into ordered prompts.

**Generation strategy:**

1. Read the spec document thoroughly
2. Identify all discrete implementation steps
3. Order steps by dependency — foundation first, features that depend on earlier steps later
4. For each step, write a prompt block containing:
   - Clear title describing the change
   - Implementation instructions (files to create/modify, logic to implement)
   - Expected outcome (what should work after this prompt)
   - Test instruction (how to verify the prompt succeeded)
5. Write the micro-prompt document to `.planning/prompts/<spec-slug>-prompts.md`
6. Each generated document = one batch item (typically M or L size)

**Decomposition heuristics:**
- One prompt per logical unit of work (one function, one API endpoint, one component)
- Each prompt should be independently testable
- Prompts should be 5-30 minutes of implementation work each
- Aim for 5-20 prompts per spec (split large specs, combine trivial items)
- Include a "Prompt 0: Project setup" if the spec requires new dependencies or scaffolding
- Include a final "Prompt N: Integration test" that verifies the full feature end-to-end

**After generation:** The document is written and committed. The next cycle will detect it in execute mode and begin executing prompts sequentially.

## Security Category — Execution Details

The security category scans for OWASP Top 10 (2025) violations and STRIDE threats, then fixes them cycle by cycle until the scan returns zero HIGH/CRITICAL findings.

### Scan approach (Step 2.1)

Three passes per cycle:

**Pass 1 — Fast grep scan (always runs):**

| OWASP | Grep pattern | Priority |
|-------|-------------|---------|
| A03 Injection | `eval(`, `execSync(`, `` `SELECT.*\${ ``, `child_process.exec(` | P0 |
| A02 Crypto | `createHash\(['"]md5\|sha1`, `Math\.random\(\)` near auth/token | P0 |
| A01 Access | Route without auth middleware, IDOR (raw `req.params.id` to DB) | P1 |
| A05 Misconfig | `origin:\s*['"]?\*`, `Access-Control-Allow-Origin: \*`, stack in response | P1 |
| A07 Auth | No session expiry, credentials in URL params | P1 |
| A04 Design | Missing rate-limit on auth/payment endpoints | P2 |
| A09 Logging | Security events (`login`, `payment`, `admin`) with no log call nearby | P2 |

**Pass 2 — Structural check (always runs):**
- Read route files and check: does every mutating endpoint (POST/PUT/PATCH/DELETE) have auth middleware before the handler?
- Check for hardcoded secrets: grep for `['"][A-Za-z0-9_]{20,}['"]` assigned to variables named `key`/`token`/`secret`/`password`/`apiKey`
- Check for prototype pollution risk: `Object.assign(req.body)` or spread from untrusted input into a stored object

**Pass 3 — Semantic depth (Agent tool, for M/L items only):**
When a pattern match needs code-path confirmation, spawn an Explore subagent:
> "Read [file]. Confirm whether [line N] is reachable from an unauthenticated request path and whether the input is sanitized before use."

Use the confirmation to decide whether to include the item at P0/P1 or drop it as a false positive.

### Item classification

| Hardener severity | Focus priority | Example |
|------------------|----------------|---------|
| Critical | P0 | `eval(req.body.code)` — direct remote code execution risk |
| High | P1 | Missing authorization on admin route |
| Medium | P2 | Rate-limiting absent on login |
| Low / Info | DROP | Missing security header on non-sensitive route |

### Execution (Step 2.3)

This is authorized, defensive hardening of the user's own codebase — you assess and remediate weaknesses; you never write exploit code or attack instructions.

**Model routing (important).** Some session models — notably Claude Fable 5 — run a cybersecurity classifier that can refuse defensive security review. Do the vulnerability *assessment* (the Pass 3 semantic analysis and each item's risk statement below) by spawning the `pan-hardener` subagent, which is pinned to `model: opus` and is not subject to that classifier. The main loop runs the grep triage (Passes 1–2) and implements the fixes; it does not narrate exploit paths inline. If any security step is refused on the main loop, delegate it to `pan-hardener` and continue.

Treat each security item as a STANDARD or FULL item regardless of effort estimate:

1. **State the risk:** "This is [OWASP category]. How it could be reached and the impact: [unvalidated input reaches X → Y → data exposure or loss], so it must be fixed."
2. **Read the file** — confirm the pattern is real, not a false positive
3. **Implement the fix** — use established patterns (parameterized queries, allowlists, bcrypt, rate-limit middleware)
4. **Write or update the test** — every security fix MUST have a test that proves the weakness is closed (e.g., send the crafted/invalid input, assert 400/403 not 200)
5. **Run full test suite** — regression check before marking DONE

### Stop condition

`security_complete` fires when the scan finds zero P0/P1 items. P2 items (medium) may remain — they won't stop the campaign unless `zero_completed` fires (no items at all).

A security campaign that ends with `security_complete` means: no critical or high OWASP violations found in the scanned files. Medium/low items can be addressed in subsequent targeted passes or documented as accepted risk.

---

## Distill Category — Execution Details

The `distill` category targets **AI-generated code bloat** with a 5-pass pipeline based on the SOTA agentic-refactoring architecture (deterministic-first, LLM-on-narrow-spans).

### Pipeline

| Pass | What | Cost | Tier output |
|------|------|------|-------------|
| 1 | **Deterministic patterns** — phantom try/catch, unused imports, magic numbers, long functions, wide param lists | Free | safe / review |
| 2 | **AST-style analysis** — single-instance factories, deep nesting | Free | review |
| 3 | **Cross-file graph** — repeated 5+ line blocks, unreferenced exports | Free | review |
| 4 | **LLM judgment** — pan-distiller agent receives ONLY flagged spans (max 50 lines context per finding); validates pattern, refines tier, proposes minimal rewrite | LLM tokens | safe / review / risky |
| 5 | **Cross-session memory** — compares findings to `.planning/memory/distill-patterns.md`; flags **regressed** patterns ("we already fixed this") | Free | metadata |

### Safety Tiers

| Tier | Rule | Action |
|------|------|--------|
| `safe` | Deterministic, behavior-preserving (e.g., remove unused import) | Auto-applied |
| `review_required` | Behavior preserved under invariants but human should verify | Surfaced to user |
| `risky` | Cross-file impact or might surface latent bugs | Never auto-applied |

A finding's confidence below 0.85 is automatically downgraded to `review_required` regardless of original tier.

### Bloat Budget

After each cycle, distill computes:
- **touched_loc** — total LOC modified in cycle
- **removable_loc** — sum of `loc_saved` across findings
- **essential_loc** — touched_loc − removable_loc
- **bloat ratio** — touched_loc / essential_loc

Default threshold: **2.0x**. If a cycle's ratio exceeds threshold, the bloat budget gate flags it for review.

### Stop condition

`distill_complete` fires when the scan finds zero bloat findings. The codebase is fully distilled for the patterns the deterministic + AST + graph passes detect.

### CLI

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs distill scan
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs distill analyze [--touched-loc N] [--bloat-threshold X]
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs distill report
```

`scan` returns findings. `analyze` adds bloat budget + regressed pattern detection. `report` writes findings to `.planning/memory/distill-patterns.md` for the next session.

<failure_pattern_capture>
When the same failure pattern appears in 2+ items within a campaign, capture it for future runs.

**Detection:** After marking an item FAILED, check if the error classification matches any previous failure in this campaign:
- Same error type (e.g., "test regression in unrelated module")
- Same file or module involved
- Same root cause category (e.g., "missing null check pattern", "import path mismatch")

**Capture (when pattern repeats):**
Append to `.planning/focus/failure-patterns.md`:
```markdown
## Pattern: {short description}
- **First seen:** Cycle {N}, Item {ID}
- **Recurrence:** Cycle {M}, Item {ID2}
- **Error type:** {classification}
- **Root cause:** {what actually went wrong}
- **Avoidance rule:** {what to check before attempting similar items}
- **Files involved:** {paths}
```

**Use (on subsequent cycles):**
Before executing an item, check if its target files or error category match a known failure pattern. If so:
- Apply the avoidance rule BEFORE implementing
- If the pattern suggests the item will fail (e.g., "all items touching module X regress"), skip with reason "matches known failure pattern — defer to manual investigation"

This prevents the campaign from burning budget on items that will predictably fail.
</failure_pattern_capture>

## NEVER DO

- Invoke the Skill tool — scan/plan/exec must run inline so state stays coherent across cycles
- Stop or pause between phases — interruptions break the autonomous loop and lose cycle momentum
- Ask the user questions after category selection — the whole point is autonomous execution; questions defeat that
- Skip the baseline test capture — without a baseline, the regression circuit breaker has nothing to compare against
- Continue after a test regression — a test count decrease means code was broken; continuing compounds the damage
- Expand scope beyond what the scan found — scope creep in an autonomous loop compounds unpredictably across cycles
- Run more cycles than --max-cycles — the limit exists to cap total cost and prevent runaway loops
- Spend more points than --total-budget — the budget cap is the user's cost control mechanism
- Skip recording cycle results via --update — unrecorded cycles break resume, status, and stop-condition checks
- Change test expectations to match broken code — this hides bugs instead of fixing them
- Use `git add -A` or `git add .` — bulk staging can accidentally commit secrets, build artifacts, or unrelated changes

## ALWAYS DO

- Execute all phases autonomously from start to finish
- Capture baseline before first cycle
- Read every file before editing it
- Test after every code change
- Record every cycle via `pan-tools focus auto --update`
- Stop on ANY safety harness trigger
- Revert fast when stuck (5 min limit)
- Display one-line cycle summary between cycles
- Display campaign summary table at end
- Commit once per cycle with accurate item list
