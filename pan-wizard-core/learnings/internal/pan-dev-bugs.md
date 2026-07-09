---
topic: pan-dev-bugs
last_updated: 2026-04-27T14:36:56.341Z
patterns:
  - id: P-101
    summary: experiment.cjs newExperiment does not persist status='ready' update after installer success
    promoted_at: 2026-04-27T09:26:39.526Z
    source_experiments: [whooo]
  - id: P-102
    summary: runner.cjs spawnSync fails on Windows for CLI tools without explicit .cmd resolution
    promoted_at: 2026-04-27T09:26:39.618Z
    source_experiments: [whooo]
  - id: P-301
    summary: PAN's commands/pan/*.md has 9 real frontmatter consistency bugs surfaced by the whooo dogfood gate
    promoted_at: 2026-04-27T09:49:20.847Z
    source_experiments: [whooo]
  - id: P-1301
    summary: /pan:new-project --auto workflow invokes AskUserQuestion for depth/execution/git-tracking despite --auto, blocking autonomous runs
    promoted_at: 2026-04-27T11:21:36.615Z
    source_experiments: [panloop]
  - id: P-1302
    summary: runner.cjs claude adapter must include --dangerously-skip-permissions for autonomous runs
    promoted_at: 2026-04-27T11:21:36.712Z
    source_experiments: [panloop]
  - id: P-1304
    summary: runner.cjs spawnSync with shell:true on Windows doesn't quote multi-word args; cmd.exe re-splits them
    promoted_at: 2026-04-27T11:38:25.897Z
    source_experiments: [panloop]
  - id: P-1401
    summary: Lightweight phases (scaffolding-only, single plan) over-ceremonialize: 5 commits + 5-7 min for trivial work
    promoted_at: 2026-04-27T12:01:14.083Z
    source_experiments: [panloop]
  - id: P-1402
    summary: Per-phase researcher re-derives material already covered by project-level research
    promoted_at: 2026-04-27T12:01:14.179Z
    source_experiments: [panloop]
  - id: P-1404
    summary: Auto-trace SubagentStop hook covers only some agents — pan-roadmapper logged but pan-planner/executor/verifier did not
    promoted_at: 2026-04-27T12:01:14.367Z
    source_experiments: [panloop]
  - id: P-1501
    summary: claude -p autonomous session exits after Phase 0 setup; multi-step workflows don't drive headless mode forward without explicit tool calls
    promoted_at: 2026-04-27T12:11:40.314Z
    source_experiments: [panloop2]
    superseded_by: P-1501-r3
    supersession_note: Original P-1501 hypothesis (workflows don't drive headless forward) was refined by P-1501-r2 (no-TTY root cause) and again by P-1501-r3 (TTY chain inheritance, stdio:'inherit' insufficient). Latest current rule lives at P-1501-r3.
  - id: P-1502
    summary: runner.cjs exit_code=0 is too coarse — should validate milestone-completion before declaring success
    promoted_at: 2026-04-27T12:11:40.408Z
    source_experiments: [panloop2]
  - id: P-1701
    summary: Multi-phase (3+) autonomous workflows exit at phase boundaries with /clear-and-rerun instructions; loop is autonomous WITHIN a phase, not across phases
    promoted_at: 2026-04-27T12:43:48.397Z
    source_experiments: [panmd2]
  - id: P-1501-r2
    summary: P-1501 root cause refined: runner.cjs spawnSync({stdio:[ignore,pipe,pipe]}) lacks TTY; manual bash invocation has TTY; claude -p detects no-TTY and exits after first response loop
    promoted_at: 2026-04-27T12:43:48.469Z
    source_experiments: [panmd2]
    superseded_by: P-1501-r3
    supersession_note: stdio:'inherit' fix proposed here turned out to be insufficient when the grandparent itself lacks TTY — see P-1501-r3.
  - id: P-1501-r3
    summary: P-1501 stdio:'inherit' fix is INSUFFICIENT when the grandparent (script/CI/tool) has no TTY itself
    promoted_at: 2026-04-27T14:36:56.341Z
    source_experiments: [panmd3]
---

# Pan Dev Bugs (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-101 — experiment.cjs newExperiment does not persist status='ready' update after installer success

**Evidence:** whooo experiment: after successful installer run, in-memory manifest had status='ready' but the file write in newExperiment skipped the persistence. On-disk experiment.json shows status='scaffolded'.

**Rule:** In experiment.cjs newExperiment: after manifest.status='ready' assignment (line ~155 in v3.7.0), add fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)) to persist the success status. 3-line fix; ship as v3.7.1.

**Applies in:** experiment.cjs maintenance, v3.7.x patches

## P-102 — runner.cjs spawnSync fails on Windows for CLI tools without explicit .cmd resolution

**Evidence:** whooo experiment: tried to spawn node via runtime-override; got ENOENT on Windows because spawnSync with shell:false doesn't resolve .cmd shims. Forced fallback to direct build instead of subprocess invocation.

**Rule:** In runner.cjs runExperiment: on Windows, either set shell:true OR resolve adapter.bin to its .cmd/.exe equivalent before spawnSync. Currently the runner is unusable on Windows for any CLI tool that ships only as .cmd (claude, gemini, codex via npx, etc.).

**Applies in:** runner.cjs cross-platform fix; v3.7.x patches

## P-301 — PAN's commands/pan/*.md has 9 real frontmatter consistency bugs surfaced by the whooo dogfood gate

**Evidence:** whooo dogfood final report (51ms across 52 files): optimize.md missing frontmatter; patches.md missing name field plus description as array; phase-tests.md uses multi-line block-scalar values; todo-add.md and todo-check.md have description as array (should be string). Reproducible via: node bin/whooo.js lint --dir d:/PanWizard/commands/pan --schema test/fixtures/pan-cmd.schema.yml

**Rule:** Ship a v3.7.x patch fixing the 9 known consistency issues in PAN's commands/pan/. Vendor whooo (or write equivalent) and add pan-tools doc-lint to the /pan:check flow so future drift is caught at author time, not by users at install.

**Applies in:** v3.7.x patch planning; /pan:check workflow extension; commands/pan/ maintenance

## P-1301 — /pan:new-project --auto workflow invokes AskUserQuestion for depth/execution/git-tracking despite --auto, blocking autonomous runs

**Evidence:** panloop sess-real-loop-2026-04-27 11:17:45Z error (critical): claude -p result includes permission_denials with tool_name=AskUserQuestion + 3 questions (Depth, Execution, Git Tracking). Workflow stalled after 5 turns / 910 output tokens / $0.33. The first real autonomous loop run (the loop's own design hypothesis) is blocked by this.

**Rule:** Audit pan-wizard-core/workflows/new-project.md auto-mode handling. When --auto is set, AskUserQuestion calls must be replaced with: (a) defaults from config.json, (b) overrides from idea.md frontmatter (e.g. planning_depth: quick), or (c) inferred values from idea content. Same audit applies to any other PAN workflow with an --auto/--yes/--non-interactive flag (plan-phase, milestone-new, etc.). Ship as v3.7.2 patch — this blocks the v3.7.0 self-improvement loop's own design intent.

**Applies in:** pan-wizard-core/workflows/new-project.md auto-mode block; v3.7.2 patch planning; audit of all --auto-flagged workflows

## P-1302 — runner.cjs claude adapter must include --dangerously-skip-permissions for autonomous runs

**Evidence:** panloop sess-real-loop-2026-04-27: claude -p WITHOUT this flag prompts for tool permissions, can't be answered in headless mode, exits 1 silently. Manual reproduction with the flag added: workflow proceeds to AskUserQuestion (separate finding P-1301)

**Rule:** In pan-wizard-core/bin/lib/runner.cjs RUNTIME_RUNNERS, add extraArgs: ['--dangerously-skip-permissions'] to the claude adapter (and equivalent flags for codex/gemini/opencode). The runner's purpose is autonomous execution — defaulting to interactive permission prompts contradicts the runner's design. Optionally gate behind opts.skipPermissions=true for paranoid users, but default ON for headless production. Document trade-off in adapter comment + ADR-0026 update.

**Applies in:** v3.7.2 patch — runner.cjs adapters

## P-1304 — runner.cjs spawnSync with shell:true on Windows doesn't quote multi-word args; cmd.exe re-splits them

**Evidence:** panloop second autonomous run (post-P-1302 fix): claude -p exited 1 in 538ms because the prompt /pan:new-project --auto @.planning/idea.md was passed as 4 args but Node joined them with spaces under shell:true without quoting, so cmd.exe re-split it into 6 args. Manual reproduction with the prompt quoted worked fine (10+ min real autonomous workflow ran).

**Rule:** When passing args to spawnSync({shell:true}), Node joins them with spaces and the shell re-parses. Multi-word args (prompts, paths with spaces) MUST be quoted by the caller. Fix in runner.cjs: when useShell is true, wrap any arg containing whitespace in double-quotes and double any embedded double-quote (cmd.exe convention). Apply same fix in any other place pan-wizard-core uses spawnSync({shell:true}).

**Applies in:** v3.7.2 patch — runner.cjs runExperiment, audit other shell:true call sites

## P-1401 — Lightweight phases (scaffolding-only, single plan) over-ceremonialize: 5 commits + 5-7 min for trivial work

**Evidence:** panloop run: Phase 1 (project setup — package.json + dirs + CLI stub, ~10 LOC of work) went through full context+research+plan+execute+summary+close. 5 commits, ~5-7 min wall clock.

**Rule:** PAN should detect 'phase has 1 plan with simple feat/chore-class work' and skip per-phase research + plan-checker stages, deferring directly from context to execute. Save ~3 commits and ~5 min per trivial phase. Heuristic: if plan count == 1 AND plan tasks count <= 3 AND no architectural changes mentioned in idea, treat as lightweight.

**Applies in:** v3.7.x patch — workflows/exec-phase.md, workflows/plan-phase.md

## P-1402 — Per-phase researcher re-derives material already covered by project-level research

**Evidence:** panloop: phase 1 research and phase 2 research both touched ESM scaffolding territory already covered by project-level research/architecture.md, features.md, stack.md. Wasted tokens.

**Rule:** pan-phase-researcher agent prompt should require reading research/architecture.md, features.md, stack.md as context, AND emit only deltas/specifics not in project-level research. Audit agents/pan-phase-researcher.md.

**Applies in:** v3.7.x patch — agents/pan-phase-researcher.md prompt

## P-1404 — Auto-trace SubagentStop hook covers only some agents — pan-roadmapper logged but pan-planner/executor/verifier did not

**Evidence:** panloop run had ~25 agent invocations across the lifecycle (researcher×2, roadmapper, context, planner×2, executor×3, verifier×2, etc.). Only 14 trace events captured across 4 sub-sessions. Hook coverage gap means /pan:learn analysis is working from incomplete data.

**Rule:** Audit hooks/pan-trace-logger.js to verify SubagentStop fires for ALL Task-spawned agent types, not just a known list. Either: (a) regex-match agent names broadly, (b) document expected agents and warn if hook payloads come from unknown ones, (c) add a 'fallback' trace event when an agent commits but no trace was captured (would require git-hook integration).

**Applies in:** v3.7.x patch — hooks/pan-trace-logger.js audit

## P-1501 — claude -p autonomous session exits after Phase 0 setup; multi-step workflows don't drive headless mode forward without explicit tool calls

**Evidence:** panloop2 v3.7.3 validation run via patched runner.cjs: status=done, exit_code=0, elapsed=48s, BUT only config.json was written. No project.md, no roadmap, no research, no subagent spawns. The auto-mode workflow block applies defaults then says 'proceed' — model interprets that as completion and exits. Original panloop 29-min success was via MANUAL interactive claude -p, not via runner-spawned.

**Rule:** Workflow auto-mode blocks must END with an explicit tool call that drives the next step (e.g., Write call to create project.md, or Task call to spawn pan-discusser). 'Proceed' as text instruction is insufficient in headless mode — claude -p exits when the assistant's text response has no pending tool calls. Audit all --auto-flagged workflow paths for this gap. Possible v3.7.4 patch: auto-mode workflow steps explicitly chain via tool invocation, not prose continuation.

**Applies in:** v3.7.4+ patch — workflows/new-project.md auto-mode chain audit

## P-1502 — runner.cjs exit_code=0 is too coarse — should validate milestone-completion before declaring success

**Evidence:** panloop2: runner returned status=done, stop_reason=success, exit_code=0 even though only config.json was written and the workflow halted at Phase 0. Exit code only reflects 'claude -p exited cleanly' — not 'autonomous build completed'.

**Rule:** After spawnSync returns exit_code=0, runner.cjs runExperiment should also check whether <experiment>/.planning/state.md status field is 'completed' (or whether milestone summary exists). If the workflow never reached milestone-done, set stop_reason='incomplete' or 'partial' even with clean exit. Caller can then act differently (e.g., mark for re-run, alert).

**Applies in:** v3.7.4 — runner.cjs runExperiment success criteria audit

## P-1701 — Multi-phase (3+) autonomous workflows exit at phase boundaries with /clear-and-rerun instructions; loop is autonomous WITHIN a phase, not across phases

**Evidence:** panmd2 manual claude -p run on a 5-phase project: completed Phase 1 with 13 commits + 20/20 tests passing, then exited cleanly with final assistant message: 'Next Up: Phase 2: Rule Infrastructure — /pan:discuss-phase 2 --auto. /clear first → fresh context window'. Compare panloop (2 phases) which auto-chained both phases without exit. The auto-mode workflow has phase-handoff logic that emits a /clear instruction between phases for context-budget reasons.

**Rule:** Audit pan-wizard-core/workflows/new-project.md and exec-phase.md for phase-handoff logic. The 'between phases /clear' approach prevents true multi-phase autonomous runs. v3.7.4+ options: (a) detect 'this is the last phase' and skip /clear instruction, (b) provide a '--multi-phase' mode that chains all phases in one session (high token cost, large context), (c) have the runner DETECT 'next up' style exits and auto-spawn next phase via /pan:plan-phase --auto. (c) is most scalable.

**Applies in:** v3.7.4+ — workflows/new-project.md phase-handoff, runner.cjs continuation logic

## P-1501-r2 — P-1501 root cause refined: runner.cjs spawnSync({stdio:[ignore,pipe,pipe]}) lacks TTY; manual bash invocation has TTY; claude -p detects no-TTY and exits after first response loop

**Evidence:** Isolation tests: (1) Manual bash invocation 'claude -p --dangerously-skip-permissions <prompt>' (NO --output-format json, exact same flags as runner) → 13 commits, Phase 1 complete, exit 0. (2) Runner-spawned 'claude -p --dangerously-skip-permissions <prompt>' via spawnSync({stdio:[ignore,pipe,pipe], shell:'win32'}) → 0 commits, only config.json written, exit 0 in ~45s. The ONLY difference is the spawn environment. claude -p likely detects isatty(stdin)=false and exits after first complete response, treating the absence of TTY as 'scripted single-shot' instead of 'autonomous loop'.

**Rule:** Fix in runner.cjs: either (a) allocate a pseudo-tty using node-pty (requires runtime dep), (b) pipe a 'continue' prompt to keep claude alive across iterations, or (c) wrap claude -p in a script that allocates a TTY (e.g., via 'script -q' on Unix, ConPTY on Windows). Document the environment requirement in runner adapter comment.

**Applies in:** v3.7.4 — runner.cjs spawn environment fix

## P-1501-r3 — P-1501 stdio:'inherit' fix is INSUFFICIENT when the grandparent (script/CI/tool) has no TTY itself

**Evidence:** panmd3 v3.7.4 validation run via patched runner with stdio:[inherit, pipe, pipe]: still 48s, 0 commits, status=incomplete (P-1502 caught the regression honestly). Root cause: 'inherit' inherits from parent (node), which inherits from Bash tool wrapper, which has no TTY. Chain: no-TTY-grandparent → no-TTY-parent → claude sees no-TTY → exits early.

**Rule:** Real fix for P-1501 requires either: (a) explicit pty allocation via node-pty (would be PAN's first runtime dependency — meaningful trade-off), (b) wrap claude invocation in a TTY-allocating tool (Windows: winpty/ConPTY API, Unix: script -q). Document the current limitation: pan-tools experiment run autonomous claude path WORKS only when invoked from a real terminal (where the entire ancestry chain has a TTY). When invoked from Bash-tool/CI/script wrappers, the run will return status=incomplete (P-1502 reports honestly). For v3.7.4: ship with this limitation documented; v3.8 may bring node-pty integration.

**Applies in:** v3.8 — runner.cjs pty allocation; v3.7.4 — documentation in commands/pan/experiment.md
