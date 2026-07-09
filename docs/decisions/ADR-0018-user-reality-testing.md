# ADR-0018: User Reality Testing System

## Status
Proposed

## Context
PAN Wizard supports 5 AI coding tool runtimes (Claude Code, OpenCode, Gemini CLI, Codex, Copilot CLI) across 3 platforms (Windows, Mac, Linux). The existing test suite (1,314 tests, 42 files) validates individual core modules and CLI commands in isolation using `node:test` and temp directories.

However, real users experience PAN through multi-step workflows: install, init project, create phases, plan, execute, verify. The current tests don't replicate this. Specific gaps:

1. **Runtime install tests verify file structure but don't run commands** — 4 of 5 runtimes are structure-only
2. **No CI pipeline** — tests run only on developer's Windows machine; Mac/Linux coverage = 0
3. **Installer is script-only** — 2,636 LOC with no exported functions; internal logic untestable
4. **No multi-step workflow tests** — no test validates a sequence like install → init → plan → verify
5. **No structured diagnostics** — test failures require reading raw output to identify the broken runtime/platform

The user explicitly reported: "the testing done is not replicating user testing."

## Decision

Build a 4-component "User Reality Testing" system:

### Component 1: Scenario Runner
Extend `tests/helpers.cjs` with `createScenarioRunner(runtime)` that:
- Creates temp dir, installs PAN for specified runtime
- Provides `execute(steps)` function for multi-step workflow testing
- Returns structured diagnostics on failure (runtime, platform, step, error, fix hint)

### Component 2: Installer Function Extraction
Extract pure/testable functions from `bin/install.js` into `bin/install-lib.cjs`:
- `getDirName()`, `expandTilde()`, content converters, attribution processing, `parseJsonc()`
- `install.js` requires `install-lib.cjs` — behavior unchanged, functions now independently testable

### Component 3: Scenario Test Files
New `tests/scenarios/` directory with 7 test files:
- `runtime-matrix.test.cjs` — all 5 runtimes: install + basic commands
- `workflow-init.test.cjs`, `workflow-phases.test.cjs`, `workflow-focus.test.cjs` — multi-step flows
- `installer-functions.test.cjs` — direct tests of extracted functions
- `state-integrity.test.cjs`, `cross-platform-paths.test.cjs` — edge cases

### Component 4: CI Pipeline
`.github/workflows/ci.yml` with matrix: 3 OS x Node 18/20/22

### Separation of Test Tiers
- `npm test` — fast unit/integration tests only (existing 1,314 tests, <30s)
- `npm run test:scenarios` — slow scenario tests only (<60s)
- `npm run test:all` — everything (<90s)

## Consequences

### Positive
- All 5 runtimes tested on 3 platforms via CI — 15-cell coverage matrix
- Multi-step workflow bugs caught before users hit them
- Installer functions independently testable for the first time
- Structured diagnostics reduce bug investigation time
- Foundation for future: scenario recording, regression dashboards

### Negative
- Installer extraction has medium risk of introducing bugs (mitigated by running full E2E tests after)
- Scenario tests are slower than unit tests (~15s) — separated into own script
- CI matrix (9 cells) consumes GitHub Actions minutes

### Neutral
- Zero new runtime dependencies (uses only `node:test`, `node:assert`, `node:fs`, `node:child_process`)
- No changes to user-facing commands or output schemas
- Existing 1,314 tests completely unchanged

## Options Considered

1. **Do nothing** — Continue with unit tests only. Rejected: user explicitly reports the gap; cross-platform bugs will continue reaching users.

2. **Docker-based testing** — Run tests in containers per platform. Rejected: adds infrastructure dependency; GitHub Actions matrix covers platforms more simply.

3. **Mock-heavy approach** — Mock filesystem, shell, etc. Rejected: defeats the purpose of "reality testing"; mocks hide the bugs we're trying to find.

4. **Full installer rewrite as module (chosen: partial extraction)** — Rewrite all 2,636 LOC as a proper module with exports. Rejected: too risky for one change; partial extraction (just pure functions) gives 80% of the testing benefit with 20% of the risk.

5. **Scenario runner with structured diagnostics (CHOSEN)** — Extend existing patterns, extract testable installer functions, add CI pipeline.

## Links
- Spec: `docs/specs/user_reality_testing_system_featureai.md`
- Related: ADR-0015 (focus-auto-runner), ADR-0009 (production deployment checklist)
- Existing E2E: `tests/e2e-install.test.cjs`
- Installer: `bin/install.js`
