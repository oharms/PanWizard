# PAN Wizard Improvement TODO

This document turns the April 2026 project review into an actionable improvement backlog. It focuses on release safety, documentation trust, installer reliability, and long-term maintainability.

> **June 2026 update:** a follow-up ecosystem review with time-critical items (Gemini→Antigravity transition, model-table staleness, runtime format migrations, skills-standard convergence) lives in [ECOSYSTEM-REVIEW-2026-06.md](ECOSYSTEM-REVIEW-2026-06.md). Items there are proposals until promoted into this backlog or an ADR.

Do not duplicate filesystem-derived counts here. `CLAUDE.md` remains the single source of truth for command, agent, module, workflow, test, hook, spec, and ADR counts.

## Goals

- Make releases harder to publish in a broken or partially validated state.
- Keep documentation accurate without manually chasing drift.
- Make installer failures visible and diagnosable.
- Reduce maintenance risk in the largest CLI and core modules.
- Preserve the current strengths: zero runtime dependencies, broad tests, and multi-runtime support.

## Priority Work

### P0: Release Gate Hardening

Current issue: `prepublishOnly` only runs the hook build step. That is too light for a CLI installer that ships commands, agents, workflows, hooks, runtime adapters, and generated install layouts.

Tasks:

- Add a release validation script, for example `npm run release:check`.
- Include these checks in the release gate:
  - `npm run build:hooks`
  - `npm run test:all`
  - `npm audit --omit=dev`
  - `npm pack --dry-run --json`
  - A packed-tarball install smoke test in a temp directory.
- Update `prepublishOnly` to call the release validation script.
- Document the release flow in `docs/DEVELOPMENT.md` or a dedicated `docs/RELEASE.md`.

Acceptance criteria:

- A publish attempt fails before upload if tests, hook build, audit, package dry-run, or smoke install fails.
- The release process can be run locally with one command.
- The release document names the required commands but does not duplicate test counts.

### P0: Installer Manifest Verification

Current issue: parts of `bin/install.js` swallow copy/write errors. Some later checks prove that directories exist, but not that every expected file landed correctly.

Tasks:

- Replace empty `catch {}` blocks in installer copy paths with warning collection or explicit failure where the file is required.
- Add a manifest verification pass after install.
- Verify all required commands, agents, hooks, core files, references, templates, and workflows expected for the selected runtime are present.
- Report optional failures as warnings and required failures as fatal errors.
- Add regression tests for partial copy failure behavior.

Acceptance criteria:

- A missing required installed file causes a clear installer failure.
- Optional cleanup failures do not hide required install failures.
- Tests cover at least one simulated copy/write failure.

### P1: Documentation Drift Guard

Current issue: the project rule says counts live only in `CLAUDE.md`, but other docs and specs still contain count-like values. This makes docs look authoritative after they have gone stale.

Tasks:

- Add a doc-lint rule that flags filesystem-derived counts outside `CLAUDE.md`.
- Allow historical changelog entries only if the team wants changelog snapshots to remain as release history.
- Clean current docs and specs by replacing numeric counts with qualitative language or links to `CLAUDE.md`.
- Include attribution and architecture docs in the drift scan.

Acceptance criteria:

- CI or `npm run test:all` catches new duplicated count drift.
- Current user-facing docs no longer embed mutable project counts.
- `CLAUDE.md` remains the only active count table.

### P1: Test Result Artifact Cleanup

Current issue: `test-results/latest.txt` and `test-results/scenarios.txt` can become stale and misleading.

Tasks:

- Decide whether test result files are generated artifacts or release evidence.
- If generated, remove tracked stale files and keep `test-results/` ignored.
- If release evidence, add `npm run refresh:test-results` and call it during release prep.
- Ensure output encoding is readable on Windows and Unix terminals.

Acceptance criteria:

- The repository no longer contains stale test output from old package versions.
- The policy for test-result files is documented.

### P1: Runtime Artifact Ignore Rules

Current issue: local runtime files can still appear in the source worktree, such as `.claude/*.lock` files.

Tasks:

- Add ignore rules for local Claude runtime lock files.
- Audit `.gitignore` for other runtime-local files that should never be committed.
- Keep development-only `.claude/commands`, `.claude/agents`, and `.claude/workflows` available as intended.

Acceptance criteria:

- Local scheduler/lock artifacts no longer show up as untracked source changes.
- Existing dev command and agent files remain trackable.

### P2: Large Module Decomposition — module half DONE (2026-06-11)

The lib-module half shipped behind a compatibility harness (`tests/module-surface.test.cjs` pins every module's export surface against a committed fixture; behavior stays pinned by the rest of the suite):

- `verify.cjs` decomposed by validation domain: drift detection, retrospective, deployment validation, and pre-execution gates each extracted to a focused `verify-*.cjs` submodule, re-exported through the facade.
- `commands.cjs`: error-pattern/session-history/learnings lifecycle extracted to `commands-learnings.cjs` (with the shared phase-summary collector, keeping dependencies one-directional).
- `phase.cjs`: removal + renumbering cascade extracted to `phase-remove.cjs`.
- Public CLI behavior unchanged throughout — every consumer goes through the original facades, and the harness fails any extraction that drops or mutates an export.

Remaining (open):

- Split the central `pan-tools.cjs` switch into command-family routers or a table-driven dispatcher. Lower urgency now that the implementation modules are focused; do it behind the same harness plus dispatch-level contract tests.

### P2: Hook Build Naming and Dependency Cleanup

Current issue: docs and dependencies imply hooks are compiled with esbuild, but the build script currently copies pure Node.js files.

Tasks:

- Choose one direction:
  - Keep copy-only hooks and rename/document the command accordingly, or
  - Implement actual esbuild bundling if bundling is still desired.
- Align `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/HOOKS.md`, `ATTRIBUTION.md`, and `package.json` with the chosen direction.
- Remove unused development dependencies if copy-only remains the design.

Acceptance criteria:

- Build docs, script behavior, and dependencies agree.
- Contributors do not need to infer whether hook files are copied or bundled.

### P2: Package Documentation Policy

Current issue: the npm package includes `README.md` automatically, but not the full `docs/` directory. That may be intentional, but the policy should be explicit.

Tasks:

- Decide whether user-facing docs should ship in the npm package.
- If yes, add selected docs or the full docs directory to the package files list.
- If no, document that npm installs rely on GitHub for full documentation.
- Keep package size checked with `npm pack --dry-run --json`.

Acceptance criteria:

- The package contents match the intended user experience.
- Package-size changes are visible in release review.

### P2: Optional LLM Evaluator for Self-Improvement Runner — ADR WRITTEN, awaiting review

> **Status (2026-06-11):** the design spike shipped as [ADR-0029](decisions/ADR-0029-experiment-evaluator.md) — pluggable evaluator, host-CLI backend (no SDK dependency), off by default, runner-scoped with a hard "one stop authority" fence. Implementation stays blocked until the maintainer accepts the ADR. Original task list retained below for review context.

Current issue: the v3.7.0 self-improvement loop (`runner.cjs`, `experiment.cjs`, ADR-0026) stops experiments on iteration count and deterministic checks. For experiments whose success criterion is genuinely qualitative ("did this prompt variant produce a better outcome?"), iteration count is a blunt stop condition. Claude Code's built-in `/goal` command demonstrates the worker/evaluator-split pattern (separate small model judges completion after every turn), but it is Claude-only and outside PAN's surface.

The case for adopting this pattern in PAN is narrow and specific to the experiment runner. The rest of PAN (phase, focus, verify, retro) has been deliberately moving toward deterministic gates; reintroducing LLM-as-judge there would be regression. Inside `runner.cjs`, where the work being evaluated is itself probabilistic, an evaluator model is the right tool.

Tasks:

- Write an ADR before any code, capturing why the experiment runner is the only place this exception applies and what would have to change for the scope to grow.
- Specify the evaluator contract: input is experiment transcript plus a goal condition string, output is a yes/no decision plus a short reason recorded to the experiment log.
- Decide model access without breaking the zero-runtime-dependency posture. Options to evaluate: opt-in Anthropic SDK behind a config flag, shelling to the host runtime's CLI, or a pluggable evaluator interface that ships with no default backend.
- Identify which experiment shapes benefit (prompt-variant comparison, output-quality judgment) and which must remain deterministic (anything wired to phase or verify state).
- Specify failure modes: missing credentials, evaluator timeout, ambiguous response. Decide whether each fails the experiment, falls back to deterministic stop, or warns and continues.
- Confirm cross-runtime behavior: the runner is the only consumer, so non-Claude runtimes should degrade gracefully when the feature is off.

Acceptance criteria:

- ADR shipped and reviewed before any implementation work.
- Feature lives behind an explicit config flag, off by default.
- No change to phase, focus, verify, or retro code paths.
- Behavior documented in `commands/pan/experiment.md` and `pan-wizard-core/workflows/` only after the ADR lands.

Reference: Claude Code's `/goal` ([docs](https://code.claude.com/docs/en/goal)) introduced the worker/evaluator-split pattern. This item adopts the pattern in one subsystem where probabilistic judgment is appropriate, without adopting the Claude-Code-specific implementation.

## Suggested Execution Order

1. Add runtime artifact ignore rules and clean stale local artifacts.
2. Fix or remove stale test-result files.
3. Add `release:check` and wire it into `prepublishOnly`.
4. Add package dry-run and packed-install smoke validation.
5. Add doc drift linting and clean current duplicated counts.
6. Harden installer manifest verification.
7. Align hook build naming, docs, and dependencies.
8. Begin large-module decomposition behind compatibility tests.

Deferred (not on the critical path): the LLM evaluator design spike for the self-improvement runner. ADR first, scoped strictly to `runner.cjs`.

## Verification Commands

Use these during implementation and before release:

```bash
npm run build:hooks
npm test
npm run test:scenarios
npm run test:all
npm audit --omit=dev
npm pack --dry-run --json
```

For manual installation testing, use a separate test directory. Do not install PAN into the source repository.

## Notes

- Preserve the zero-runtime-dependency posture unless there is a strong reason to change it.
- Keep installer changes conservative; installation failures should become clearer, not noisier.
- Prefer automated drift checks over periodic manual cleanup.
- Treat docs as product surface. For this project, stale docs are a real reliability bug because agents and users both consume them.