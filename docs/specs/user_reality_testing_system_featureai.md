# User Reality Testing System — Feature Specification

**Mode:** `--internal` | **Date:** 2026-03-04 | **ADR:** ADR-0018

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard's 1,314 unit/integration tests validate individual modules in isolation, but they do not replicate how real users interact with the tool across 5 runtimes (Claude Code, OpenCode, Gemini CLI, Codex, Copilot CLI) on 3 platforms (Windows, Mac, Linux). The gap between "tests pass" and "users report it works" manifests as: installer path failures in containers, multi-word argument breakage in real shells, runtime-specific command syntax mismatches, and state corruption during interrupted sessions. Users discover these bugs only after installation — there is no automated system that simulates a user installing PAN, running a workflow end-to-end, and verifying the output matches expectations across all environments.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Personal pain (user-stated) | This conversation | "I am struggling to test it and the testing done is not replicating user testing, would like to design a testing system that can actually replicate on all environment the user testing and feedback to close the loop" |
| Known deferred items | MEMORY.md | "parseJsonc unit tests: blocked because installer is script-only", "Health --full: M effort, shelling out to npm test risky" |
| Architecture gap | Codebase investigation | 42 test files test pan-tools CLI in temp dirs, but 0 tests exercise: shell argument parsing, runtime command discovery, hook execution, agent delegation, or multi-step user workflows end-to-end |
| Cross-platform gap | CI analysis | No CI workflow file found; tests run only on developer's local machine (Windows); Mac/Linux coverage = 0 |

### 0.2.5 Before/After State

**Current behavior (before):**
- `npm test` runs 1,314 tests via `node --test tests/*.test.cjs`
- Tests call `runPanTools(args, cwd)` which uses `execSync('node pan-tools.cjs args')`
- E2E install tests run the installer with `--claude --local`, verify file structure, then run commands
- 5 runtime-specific install tests verify directory structure and file conversion
- All tests run on a single platform (developer's Windows machine)
- No test validates: shell argument quoting, hook firing, agent-to-CLI round-trips, multi-command workflows, or platform-specific path behavior

**Desired behavior (after):**
- A "scenario runner" that executes multi-step user workflows (install → init → plan → exec → verify) against real runtime directories
- Platform matrix testing via CI (Windows, Ubuntu, macOS)
- Runtime matrix testing: all 5 runtimes verified per commit
- Feedback loop: test failures produce structured diagnostic output identifying the exact runtime/platform/step that broke
- Installer internal functions testable via extracted module (not script-only)

**Delta:**
- New `tests/scenarios/` directory with multi-step workflow test files
- New test helper: `createScenarioRunner(runtime, platform)` for structured scenario execution
- New `pan-tools test-scenario` command for running scenarios from CLI
- CI workflow running tests on 3 platforms x core runtime coverage
- Installer refactor: extract testable functions to `bin/install-lib.cjs`

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Multi-step workflow scenario tests | Network API testing (BraveSearch, etc.) — external dependency |
| Platform matrix CI (Win/Mac/Linux) | Interactive readline prompts — requires stdin mocking library (runtime dep) |
| Runtime matrix tests (all 5 runtimes) | Performance benchmarks — separate concern, not user-facing |
| Installer function extraction for testability | Installer UI redesign — separate feature, would bloat scope |
| Structured diagnostic output on failure | Docker/container testing — infrastructure dependency, CI covers platforms |
| Hook execution verification | Agent LLM response testing — non-deterministic, can't unit test |
| State transition integrity tests | |
| Scenario replay from recorded user sessions | |

### 0.4 Success Criteria

| ID | Criterion | Verification Method | Pass Condition |
|----|-----------|-------------------|----------------|
| SC-1 | Scenario runner executes multi-step workflows | `npm test` includes scenario tests | All scenario tests pass |
| SC-2 | All 5 runtimes have install+run scenario coverage | Grep for runtime names in scenario tests | >= 1 scenario per runtime |
| SC-3 | No regression in existing tests | `npm test` | All tests pass, count >= 1314 |
| SC-4 | CI runs on Windows, Mac, and Linux | `.github/workflows/ci.yml` | Matrix build passing on 3 OS |
| SC-5 | Failure diagnostics include runtime, platform, step | Test output format check | Error output contains `{runtime, platform, step, expected, actual}` |
| SC-6 | Installer functions are independently testable | `require('bin/install-lib.cjs')` succeeds | Exports >= 10 functions |

### 0.5 User Stories

```
As a PAN Wizard maintainer, I want scenario-based tests that simulate real user workflows,
so that I catch integration bugs before users do, instead of relying on isolated unit tests.
```

```
As a PAN Wizard contributor, I want CI that runs tests on all 3 platforms,
so that I know my changes work cross-platform, instead of discovering Windows/Mac issues post-release.
```

```
As a PAN Wizard user on Codex CLI, I want confidence that my runtime is tested,
so that skill installation and invocation work correctly, instead of finding broken commands after install.
```

```
As a PAN Wizard maintainer, I want structured failure diagnostics,
so that I can quickly identify which runtime/platform/step failed, instead of reading raw test output.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `pan-tools validate health` | Partial | Health checks validate file structure, not workflow execution. New scenarios cover workflows; health stays for quick structural checks. |
| `e2e-install.test.cjs` | Partial | Current E2E tests verify structure + basic commands. New scenarios ADD multi-step workflows on top. E2E tests stay as fast structural validation. |
| `verify-phase` command | None | Verifies phase artifacts, not test infrastructure. |
| `pan:phase-tests` | None | Generates tests for user project phases, not PAN's own testing. |

No full overlap — this is new infrastructure.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 0 (internal) | 0 (internal) | 0 |
| New concepts introduced | 0 | 1 (scenario runner) | +1 |
| Score | — | — | neutral (0) — internal tool, no user-facing complexity |

---

## Phase 0.8: Autonomous Codebase Investigation — Summary

### Files Read & Patterns Discovered

**Test Infrastructure:**
- `tests/helpers.cjs`: 3 functions (`runPanTools`, `createTempProject`, `cleanup`) — minimal but consistent
- `runPanTools` uses `execSync` with `stdio: ['pipe', 'pipe', 'pipe']` — captures stdout/stderr separately
- All 42 test files follow identical lifecycle: `beforeEach(createTempProject)`, `afterEach(cleanup)`
- JSON output parsed inline: `const output = JSON.parse(result.output)`

**E2E Install Pattern (e2e-install.test.cjs):**
- Single `before()` installs once, all tests share the same installed directory
- `runInstalled(args, cwd)` — identical to `runPanTools` but uses installed path
- Tests verify: directory structure, file existence, then CLI commands from installed location

**Multi-Runtime Install Tests (opencode/gemini/codex/copilot):**
- Each test file: `before()` installs with runtime flag, verifies directory structure
- Tests verify: config dir name, command file format, tool conversion, agent conversion
- No test runs a command from the installed runtime location (structure-only)

**Critical Gap Discovered:**
- Runtime install tests verify FILES exist but never RUN commands from the installed location
- Only `e2e-install.test.cjs` (Claude) runs commands from installed path — other 4 runtimes don't
- No test validates that converted TOML/SKILL.md files are syntactically valid
- No test validates hook execution (hooks require event triggers that don't exist in test env)

### Impact Analysis

| Affected Area | Specific Item | How Affected | Risk Level |
|--------------|---------------|-------------|------------|
| Core module | None — tests are additive | No changes to core | Low |
| Test helpers | `tests/helpers.cjs` | New `createScenarioRunner()` function added | Medium |
| Installer | `bin/install.js` | Extract functions to `bin/install-lib.cjs` | High |
| CI | `.github/workflows/ci.yml` | New file (or update if exists) | Medium |
| Test directory | `tests/scenarios/` | New directory with scenario test files | Low |
| Constants | `constants.cjs` | New test-related constants possible | Low |
| Dispatcher | `pan-tools.cjs` | New `test-scenario` subcommand (optional) | Low |

---

## Phase 1: Internal Reconnaissance — Summary

### 1.1 Existing Capabilities Inventory

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| Unit test framework | Complete | `node:test` + `node:assert/strict` | Foundation — extend, don't replace |
| CLI integration testing | Complete | `runPanTools()` helper | Reuse for scenario steps |
| E2E install + run (Claude) | Complete | `e2e-install.test.cjs` | Template for multi-runtime E2E |
| Runtime install verification | Partial (structure only) | `*-install.test.cjs` | Extend to run commands |
| CI pipeline | Missing | No `.github/workflows/` in repo | Must create |
| Diagnostic output | Missing | — | Must design |
| Multi-step workflow tests | Missing | — | Core deliverable |
| Installer function testing | Blocked | `bin/install.js` is script-only | Must extract |

### 1.3 Convention Enforcement Checklist

- [x] Functions named `cmd<Module><Action>(cwd, raw, ...args)` — scenario runner won't be a pan-tools command; test helper only
- [x] File reads use try-catch pattern — test helpers already use this
- [x] JSON output via `output(data, raw, humanLabel)` — N/A for test infrastructure
- [x] CommonJS only (`.cjs` with `require()`) — all test files are `.cjs`
- [x] Zero runtime dependencies — test infra uses only `node:test`, `node:assert`, `node:fs`, `node:child_process`
- [x] Functions stay within complexity budget — 50 lines max
- [x] `fileAccessible()` instead of existsSync — will use in new test helpers

### 1.4 Dependency & Integration Map

```
[Scenario Runner (new)]
    ├── depends on: tests/helpers.cjs (runPanTools, createTempProject, cleanup)
    ├── depends on: bin/install.js (installer execution)
    ├── depends on: bin/install-lib.cjs (NEW — extracted installer functions)
    ├── depends on: pan-wizard-core/bin/pan-tools.cjs (CLI under test)
    ├── extends: e2e-install.test.cjs (pattern for installed-path execution)
    ├── conflicts with: nothing
    └── enables: CI matrix testing, regression detection, runtime certification
```

No circular dependencies.

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What testing complexity can we drop? | Eliminate need for Docker/containers — CI matrix covers platforms. Eliminate mock-heavy approach — test real CLI execution. |
| **REDUCE** | What test boilerplate should decrease? | Reduce per-test setup cost with shared scenario fixtures. Reduce diagnostic noise with structured failure output. |
| **RAISE** | What should be raised above current state? | Raise confidence in multi-runtime compatibility. Raise cross-platform test coverage from 1 to 3 platforms. Raise workflow coverage from unit-level to user-journey-level. |
| **CREATE** | What testing capability doesn't exist yet? | Create scenario-based testing that simulates full user workflows. Create runtime certification matrix. Create structured diagnostic feedback loop. |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                  ^
            [User Reality Testing]
```

User-journey testing for multi-runtime CLI tools is **custom-built** territory. No off-the-shelf framework handles "install a CLI tool for 5 different AI assistants, verify each one works." In 2-3 years, as the AI coding tool ecosystem matures, shared test harnesses may emerge — but today this must be purpose-built.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Tests validate that context (commands, agents) is correctly formatted per runtime | 3 |
| **Cross-Platform** | CI matrix ensures Win/Mac/Linux compatibility — direct moat strengthener | 5 |
| **Developer Experience** | Faster bug detection = fewer broken releases = happier users | 4 |
| **Zero Dependencies** | Test infra uses only Node.js built-ins — maintains constraint | 5 |
| **State Persistence** | Scenario tests validate state transitions across multi-step workflows | 3 |
| **Verification Quality** | Runtime certification gives measurable quality signal | 4 |
| **Total** | | **24/30** |

### 3.4 Strategic Recommendation

**Build it.** PAN Wizard supports 5 runtimes on 3 platforms — that's a 15-cell matrix with only 1 cell currently tested (Claude on Windows). The user explicitly reports testing doesn't replicate real usage. This infrastructure is the highest-leverage investment possible: it protects every future feature from cross-runtime regression and closes the feedback loop between development and user experience. The unique angle is scenario-based multi-runtime certification — no competing tool tests like this because no competing tool supports 5 runtimes from a single codebase.

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

### 3.5.1 Feature Type Classification

**Type: Core Enhancement + Test Infrastructure**
- Modify: `tests/helpers.cjs` (add scenario runner helper)
- Extract: `bin/install-lib.cjs` (from `bin/install.js`)
- Create: `tests/scenarios/*.test.cjs` (scenario test files)
- Create: `.github/workflows/ci.yml` (CI pipeline)

### 3.5.2 Layer Violation Check

- [x] Scenario tests call CLI via `execSync` — same pattern as existing tests, no layer violation
- [x] `install-lib.cjs` exports pure functions — no side effects on import
- [x] No test file imports agent/command files — tests exercise CLI interface only
- [x] No upward dependencies

### 3.5.3 Output Contract Design

**Scenario Runner Return Value:**
```json
{
  "scenario": "string — scenario name",
  "runtime": "string — claude|opencode|gemini|codex|copilot",
  "steps": [
    {
      "name": "string — step name",
      "command": "string — CLI command executed",
      "success": "boolean",
      "output": "string — stdout",
      "error": "string — stderr (if failed)",
      "duration_ms": "number",
      "assertions_passed": "number",
      "assertions_failed": "number"
    }
  ],
  "passed": "boolean — all steps passed",
  "duration_ms": "number — total scenario time",
  "diagnostics": {
    "platform": "string — win32|darwin|linux",
    "node_version": "string",
    "runtime": "string",
    "failed_step": "string|null — first failed step name",
    "error_summary": "string|null — concise error description"
  }
}
```

### 3.5.4 State Transition Modeling

N/A — test infrastructure doesn't mutate `.planning/` state. It creates temp projects and destroys them.

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | No |
| Changes file formats? | No |
| Changes directory structure? | No — new `tests/scenarios/` dir is additive |
| Changes installer output? | No — extraction preserves all behavior |

### 3.5.6 Composability Analysis

| Interaction | Works? | How |
|-------------|--------|-----|
| CI runs scenarios automatically | Yes | `npm test` includes scenario files |
| Developer runs single scenario | Yes | `node --test tests/scenarios/workflow.test.cjs` |
| Scenario results feed CI reporting | Yes | node:test TAP output parsed by CI |

### 3.5.7 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| Install per runtime (~200ms) | ~1000ms for 5 | Shared per describe block |
| Run 5-step scenario | ~500ms | 5 x execSync ~100ms each |
| Full scenario suite (est. 10 scenarios) | ~10s | Acceptable for CI |
| **Total** | **~15s added to test suite** | node:test parallelizes describe blocks |

### 3.5.8 Cross-Platform Considerations

| Platform | Consideration |
|----------|---------------|
| Windows | `execSync` uses cmd.exe shell — arg quoting differs from bash; test with real shell |
| Mac/Linux | POSIX shell — no issues with arg quoting |
| All | Use `path.join()` everywhere; `toPosix()` for output comparison |
| CI | GitHub Actions `runs-on: [ubuntu-latest, windows-latest, macos-latest]` |
| Git | `git config user.email/name` required in CI (no global config) |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

**User Reality Testing** is PAN Wizard's scenario-based test infrastructure that exercises complete user workflows — install, configure, run multi-step commands, verify output — across all 5 supported runtimes and 3 platforms.

**Example 1: Full Workflow Scenario**
```javascript
// tests/scenarios/workflow-init.test.cjs
describe('Scenario: Initialize and plan a project', () => {
  const runner = createScenarioRunner('claude');

  test('install → init → create state → plan phase', () => {
    const result = runner.execute([
      { step: 'install', command: '--claude --local' },
      { step: 'init', command: 'init --name test-project' },
      { step: 'state', command: 'state-snapshot' },
      { step: 'plan', command: 'roadmap get-progress' },
    ]);
    assert.ok(result.passed, result.diagnostics.error_summary);
  });
});
```

**Example 2: Multi-Runtime Install Verification**
```javascript
// tests/scenarios/runtime-matrix.test.cjs
for (const runtime of ['claude', 'opencode', 'gemini', 'codex', 'copilot']) {
  describe(`Scenario: ${runtime} install and basic commands`, () => {
    const runner = createScenarioRunner(runtime);

    test('install + version + help', () => {
      const result = runner.execute([
        { step: 'install', command: `--${runtime} --local` },
        { step: 'version', command: 'version', expect: { field: 'version' } },
        { step: 'help', command: 'help', expect: { success: true } },
      ]);
      assert.ok(result.passed, result.diagnostics.error_summary);
    });
  });
}
```

**Example 3: Diagnostic Output on Failure**
```
FAIL: Scenario "codex install and commands" — step "version" failed
  Platform: win32 | Node: 22.5.0 | Runtime: codex
  Command: node ".codex/pan-wizard-core/bin/pan-tools.cjs" version
  Expected: success=true, field "version" present
  Actual: success=false, error="Cannot find module '.codex/pan-wizard-core/bin/lib/core.cjs'"
  Fix hint: Check installer copies all lib modules for codex runtime
```

### 4.2 Reference-Level Explanation

#### 4.2.1 Component 1: Scenario Runner (`tests/helpers.cjs` extension)

```javascript
/**
 * Create a scenario runner for a specific runtime.
 * @param {string} runtime - 'claude'|'opencode'|'gemini'|'codex'|'copilot'
 * @returns {{ execute: Function, cleanup: Function, tmpDir: string }}
 */
function createScenarioRunner(runtime) { /* ... */ }
```

**Behavior:**
1. Creates a temp directory
2. Runs the installer with `--${runtime} --local`
3. Resolves the installed `pan-tools.cjs` path based on runtime config dir
4. Returns an `execute(steps)` function that runs each step sequentially
5. Each step runs `execSync` against the installed pan-tools
6. Collects structured results with timing and diagnostics
7. Returns comprehensive result object (see 3.5.3 contract)

**Runtime → Config Dir Mapping (mirrors installer):**
```
claude  → .claude
opencode → .opencode
gemini  → .gemini
codex   → .codex
copilot → .github
```

#### 4.2.2 Component 2: Installer Function Extraction (`bin/install-lib.cjs`)

Extract these pure/testable functions from `bin/install.js`:

| Function | Lines in install.js | Purpose |
|----------|-------------------|---------|
| `getDirName(runtime)` | 46-52 | Runtime → config dir name |
| `getConfigDirFromHome(runtime)` | 53-97 | Runtime → global config path |
| `expandTilde(p)` | ~160 | Expand `~` to home dir |
| `convertClaudeToOpencodeFrontmatter(content)` | 798-902 | Frontmatter conversion |
| `convertClaudeToGeminiToml(content)` | 909-943 | Claude MD → Gemini TOML |
| `convertClaudeToCodexMarkdown(content)` | ~400 | Claude MD → Codex SKILL.md |
| `convertClaudeToCopilotMarkdown(content)` | ~500 | Claude MD → Copilot SKILL.md |
| `processAttribution(content, attribution)` | 250-326 | Commit attribution processing |
| `getCommitAttribution(runtime, dir)` | ~330 | Read attribution from settings |
| `parseJsonc(str)` | (exists) | Parse JSON with comments |

**Strategy:** `install.js` will `require('./install-lib.cjs')` for these functions. The script's main logic stays in `install.js`. This is a non-breaking refactor.

#### 4.2.3 Component 3: Scenario Test Files (`tests/scenarios/`)

| File | Scenarios | What It Validates |
|------|-----------|-------------------|
| `runtime-matrix.test.cjs` | 5 | All runtimes: install + version + help commands work |
| `workflow-init.test.cjs` | 2 | Init project → create state → snapshot |
| `workflow-phases.test.cjs` | 2 | Create phase → list → roadmap integration |
| `workflow-focus.test.cjs` | 1 | Focus scan → plan (scan writes, plan reads) |
| `state-integrity.test.cjs` | 3 | State mutations don't corrupt across operations |
| `installer-functions.test.cjs` | 15+ | Direct tests of extracted installer functions |
| `cross-platform-paths.test.cjs` | 5 | Path normalization, toPosix, separator handling |

#### 4.2.4 Component 4: CI Pipeline (`.github/workflows/ci.yml`)

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [18, 20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm test
```

### 4.3 Design Decisions

| Decision | Rationale | What We Did NOT Do (and Why) |
|----------|-----------|-------------------------------|
| Extend `tests/helpers.cjs` rather than new helper file | Follows existing pattern; all test files already import from helpers.cjs | Didn't create separate test framework — would violate zero-dep constraint |
| Extract installer functions, don't rewrite installer | Minimal blast radius; preserves working installer | Didn't refactor entire installer — too risky, scope creep |
| Scenario files in `tests/scenarios/` subdirectory | Separates slow E2E from fast unit tests; `node --test tests/*.test.cjs` still runs fast tests only | Didn't mix with existing test files — scenarios are 10x slower |
| Use `node:test` for scenarios (not Jest/Mocha) | Zero deps, project convention | Didn't add test framework dependency |
| CI matrix: 3 OS x 3 Node versions | Covers real user spread (Win/Mac/Linux, Node 18/20/22) | Didn't add Docker — CI matrix covers platforms already |

### 4.4 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| Scenario execution | Sequential execSync | Parallel with worker_threads | Ordering matters in multi-step scenarios | Slower (~15s total) |
| Installer extraction | Extract to install-lib.cjs | Rewrite installer as module | Rewrite too risky for v2.3 | Two files to maintain |
| CI platform | GitHub Actions | None (manual) | Manual testing doesn't scale | CI minutes cost |
| Runtime coverage | All 5 runtimes | Just Claude + OpenCode | Other runtimes have real users | More tests = slower suite |

### 4.5 Feature Ladder

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | Scenario runner helper + runtime-matrix test + CI yml | All 5 runtimes tested on 3 platforms | S (2 pts) |
| **v1 (Complete)** | + installer extraction + workflow scenarios + diagnostics | Full user-journey coverage + installer testability | M (4 pts) |
| **v2 (Enhanced)** | + scenario recording/replay + regression dashboard + hook verification | Recorded real-user sessions replayed as tests | L (10 pts) |

### 4.6 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this feature? | Internal — maintainers see it in `tests/scenarios/` and CI |
| What's the learning curve? | Low — follows existing test patterns with `createScenarioRunner()` |
| Does it require changing existing workflows? | No — `npm test` still works; scenarios are opt-in via `node --test tests/scenarios/*.test.cjs` |
| What's the "aha moment"? | First time CI catches a bug on Linux that passed on Windows locally |

---

## Phase 5: Architecture Decision Record

See `docs/decisions/ADR-0018-user-reality-testing.md` (saved separately).

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Mode Analysis

| Failure Mode | Category | Detection Pattern | Recovery | User Sees |
|-------------|----------|-------------------|----------|-----------|
| Installer fails for runtime X | Environment | execSync throws | Catch, report runtime + error | Diagnostic: "codex install failed: ENOENT..." |
| Command returns error JSON | Expected failure | `result.success === false` | Check against expected behavior | Step marked failed with error details |
| Command returns malformed output | Bug | `JSON.parse` throws | Catch, include raw output in diagnostic | "Expected JSON, got: [raw output]" |
| Timeout (command hangs) | Environment | execSync timeout option | Kill process, mark step as timeout | "Step 'init' timed out after 30s" |
| File not found after install | Installer bug | fileAccessible check | Report missing file path | "Expected .codex/pan-wizard-core/... not found" |
| Permission denied | Environment | EACCES in error | Report platform + path | "Permission denied: /tmp/pan-test-xxx/..." |

### 6.2 Diagnostic Output Format

Every scenario failure includes:
```
FAIL: Scenario "<name>" — step "<step_name>" failed
  Platform: <platform> | Node: <version> | Runtime: <runtime>
  Command: <full command>
  Expected: <expected outcome>
  Actual: <actual outcome>
  Duration: <ms>
  Files checked: [list of verified files]
  Fix hint: <actionable suggestion>
```

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Input Inventory

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| Temp directories | Created by test, destroyed after | System-generated, fully trusted |
| Installer script | Executed via `node bin/install.js` | Internal, trusted |
| pan-tools CLI | Executed via `execSync` | Internal, trusted |
| Test scenario definitions | Hardcoded in test files | Developer-controlled, trusted |

| Input Vector | Source | Validation Required |
|-------------|--------|-------------------|
| Runtime flag (--claude, etc.) | Hardcoded in test | Allowlist validation |
| Temp directory path | `os.tmpdir()` | Path within temp dir verified |
| CLI output | stdout from execSync | JSON.parse in try-catch |

### 7.2 Path Safety

- All temp directories created via `fs.mkdtempSync` — OS-guaranteed unique
- All paths resolved relative to temp dir — no escape possible
- Cleanup uses `fs.rmSync(tmpDir, { recursive: true, force: true })` — existing pattern
- No user-supplied paths — all test paths are hardcoded

### 7.3 Output Sanitization

- [x] No absolute filesystem paths in test assertions (use relative)
- [x] No environment variable values exposed in diagnostics
- [x] No stack traces in diagnostic output (structured errors only)
- [x] Temp directories cleaned up after test — no sensitive data persists

### 7.5 Privilege Scope

```
Reads from: tests/, bin/, pan-wizard-core/
Writes to: temp directories only (os.tmpdir())
Executes shell: Yes — node bin/install.js, node pan-tools.cjs (internal tools only)
Reads outside project: No
```

---

## Phase 8: Implementation Roadmap

### 8.1 Command .md Definition

N/A — this is test infrastructure, not a user-facing command. The `npm test` script is the interface.

**Updated `package.json` scripts:**
```json
{
  "scripts": {
    "test": "node --test tests/*.test.cjs",
    "test:scenarios": "node --test tests/scenarios/*.test.cjs",
    "test:all": "node --test tests/*.test.cjs tests/scenarios/*.test.cjs",
    "test:watch": "node --test --watch tests/*.test.cjs"
  }
}
```

### 8.2 Implementation Tasks

```
### Task 1: Extract installer functions to install-lib.cjs
Files: bin/install-lib.cjs (new), bin/install.js (modify to require install-lib)
Test: node --test tests/scenarios/installer-functions.test.cjs
Estimate: M
Priority: P2

### Task 2: Create scenario runner helper
Files: tests/helpers.cjs (add createScenarioRunner, runInstalledForRuntime)
Test: Used by all scenario tests
Estimate: S
Priority: P2

### Task 3: Runtime matrix scenario test
Files: tests/scenarios/runtime-matrix.test.cjs (new)
Test: node --test tests/scenarios/runtime-matrix.test.cjs
Estimate: S
Priority: P2

### Task 4: Workflow scenario tests (init, phases, focus)
Files: tests/scenarios/workflow-init.test.cjs, workflow-phases.test.cjs, workflow-focus.test.cjs (new)
Test: node --test tests/scenarios/workflow-*.test.cjs
Estimate: M
Priority: P3

### Task 5: Installer function unit tests
Files: tests/scenarios/installer-functions.test.cjs (new)
Test: node --test tests/scenarios/installer-functions.test.cjs
Estimate: S
Priority: P2

### Task 6: State integrity scenario tests
Files: tests/scenarios/state-integrity.test.cjs (new)
Test: node --test tests/scenarios/state-integrity.test.cjs
Estimate: S
Priority: P3

### Task 7: Cross-platform path scenario tests
Files: tests/scenarios/cross-platform-paths.test.cjs (new)
Test: node --test tests/scenarios/cross-platform-paths.test.cjs
Estimate: XS
Priority: P3

### Task 8: CI pipeline configuration
Files: .github/workflows/ci.yml (new)
Test: Push to branch, verify CI runs
Estimate: S
Priority: P3

### Task 9: Update package.json scripts
Files: package.json (modify)
Test: npm run test:scenarios works
Estimate: XS
Priority: P3
```

### 8.3 Dependency Graph

```
Task 1 (extract installer) ──┐
                              ├── Task 5 (installer function tests)
Task 2 (scenario runner) ────┤
                              ├── Task 3 (runtime matrix) ──┐
                              ├── Task 4 (workflow tests)    ├── Task 8 (CI)
                              ├── Task 6 (state integrity)   │
                              └── Task 7 (path tests) ──────┘
                                                             └── Task 9 (package.json)
```

**Critical path:** Task 1 + Task 2 → Task 3 → Task 8

### 8.4 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Installer extraction breaks install flow | Medium | High | Run full E2E test suite after extraction; git tag before refactor |
| Scenarios too slow for regular `npm test` | Medium | Medium | Separate script: `npm run test:scenarios`; keep `npm test` fast |
| CI minutes cost on 3x3 matrix | Low | Low | Start with 3 OS x 1 Node version; expand later |
| Runtime install paths differ on CI vs local | Medium | Medium | Use relative paths; verify with `path.resolve` |
| Flaky tests due to filesystem timing | Low | Medium | Add retry logic for install step only; deterministic assertions |

### 8.5 Cognitive Complexity Budget

- Max lines per function: 50
- Max nesting depth: 3 levels
- Max parameters: 4 (use options object if more)
- `createScenarioRunner(runtime, options?)` — 2 params
- `executeScenarioStep(command, cwd, timeout?)` — 3 params

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Pattern | Minimum Count | What It Catches |
|-------|---------|---------------|-----------------|
| **Unit** | Test installer functions directly | 15+ | Conversion bugs, path resolution, attribution |
| **Integration** | Runtime matrix (install + commands) | 10+ (2 per runtime) | Runtime-specific wiring, file format, tool names |
| **E2E** | Multi-step workflow scenarios | 5+ | State transitions, cross-command interaction, data flow |

### 9.2 Assertion Density Requirements

Every scenario step asserts:
- (a) `result.success === expected.success` — command succeeds/fails as expected
- (b) If JSON: parsed output has expected fields
- (c) If file operation: file exists at expected path with expected content
- (d) No `error` field when success expected

Every installer function test asserts:
- (a) Return value type and shape
- (b) Edge case handling (empty input, null, undefined)
- (c) Cross-platform behavior (forward/backward slashes)

### 9.3 Boundary Value Analysis

- [x] Empty project (no `.planning/` directory) — install should still work
- [x] Runtime name edge cases — only 5 valid names, reject others
- [x] Path with spaces in directory name — common on Windows
- [x] Very long phase names (near 40-char slug limit)
- [x] Installer run twice (idempotent check)
- [x] Missing Node.js in PATH (graceful error)
- [x] Read-only filesystem (permission denied on write)

### 9.4 Regression Verification

- [x] All 1,314 existing tests pass unchanged
- [x] `npm test` still runs only fast tests (no scenarios)
- [x] `npm run test:all` runs everything
- [x] E2E install tests remain independent of new scenarios

### 9.5 Performance Validation

- [x] `npm test` (unit/integration only) completes in < 30s
- [x] `npm run test:scenarios` completes in < 60s
- [x] `npm run test:all` completes in < 90s
- [x] Individual scenario file runs in < 15s

---

## Phase 10: Report Summary

### Problem & Evidence
PAN Wizard's 1,314 tests validate modules in isolation but don't replicate real user workflows across 5 runtimes and 3 platforms. User explicitly reports the testing gap.

### Investigation Depth
- 42 test files analyzed, 15 core modules read, 5 runtime adapters traced
- Installer flow traced through all 2,636 lines
- Patterns: `runPanTools()`, `createTempProject()`, `runInstalled()`, `execSync` CLI testing
- Impact: 1 High-risk item (installer extraction), 3 Medium, rest Low

### Strategic Assessment
- **Blue Ocean:** CREATE scenario-based multi-runtime certification (no tool does this)
- **Wardley:** Custom-built — no off-the-shelf framework for this
- **Moat Score:** 24/30 — strengthens cross-platform, DX, zero-dep, verification moats
- **Cognitive Load:** 0 (internal tool, no user-facing complexity)
- **Recommendation:** Build — highest-leverage testing investment, protects all future features

### Design Summary
- **Type:** Test infrastructure (helpers + scenario files + CI + installer extraction)
- **Modules affected:** `tests/helpers.cjs` (extend), `bin/install.js` (refactor), `package.json` (scripts)
- **New files:** `bin/install-lib.cjs`, `tests/scenarios/*.test.cjs` (7 files), `.github/workflows/ci.yml`
- **Error handling:** Structured diagnostics with platform/runtime/step/fix-hint
- **Breaking changes:** None

### Feature Ladder
- **v0 (MVP):** Scenario runner + runtime matrix test + CI = S effort
- **v1 (Complete):** + installer extraction + workflow scenarios + diagnostics = M effort
- **v2 (Enhanced):** + scenario recording/replay + regression dashboard = L effort

### Implementation Tasks
- 9 tasks, total complexity: 1 XS + 4 S + 2 M = ~18 points
- Files to create: 9 new files
- Files to modify: 3 existing files

### Security
- All operations in temp directories — no production risk
- No user-supplied paths — all hardcoded test paths
- Cleanup guaranteed by afterEach hooks

### Acceptance Criteria
- 6 criteria, 5 machine-checkable (SC-1 through SC-5), 1 structural (SC-6)

### Documents Created
- Spec: `docs/specs/user_reality_testing_system_featureai.md`
- ADR: `docs/decisions/ADR-0018-user-reality-testing.md`

### Next Step
Recommended: `/pan:plan-phase` to create implementation plan from this spec, starting with Task 1 (installer extraction) and Task 2 (scenario runner helper).

---

## Post-Implementation Note (2026-03-04)

ADR-0018 implemented: installer extraction (`install-lib.cjs`), scenario runner (`createScenarioRunner`), 47 scenario tests, CI pipeline. ADR-0019 followed with 52 additional E2E tests. Counts at spec time: 1,314 tests, 42 test files. Counts after both ADRs: 1,518 tests (1,419 unit + 99 scenario), 52 test files (43 unit + 9 scenario). Commits: 90f0da8 (ADR-0018), cd86512 (ADR-0019).
