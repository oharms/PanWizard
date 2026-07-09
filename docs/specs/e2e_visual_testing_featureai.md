# Feature Spec: E2E Automated Visual Testing — Installed Experience Validation

## Status
Proposed

## Problem Statement

PAN Wizard has 1500 unit/integration tests that validate internal mechanics, but **zero tests that verify the installed user experience works as expected**. The gap:

| What's Tested | What's NOT Tested |
|---------------|-------------------|
| `pan-tools phase add` returns correct JSON | `/pan:new-project` in VSCode triggers correct workflow |
| Installer copies files to correct paths | Hooks actually fire on SessionStart/PostToolUse |
| State mutations are atomic | Multi-session continuity (close IDE, reopen, state intact) |
| JSON output schema is correct | Output matches what the AI agent can parse and act on |
| 5 runtimes install correctly | Installed commands are discoverable by host tool |
| Config merging works | User with corrupted .planning/ gets helpful error recovery |

**Real failures this would catch:**
1. Hook script crashes silently on SessionStart (user never knows)
2. Command frontmatter has invalid `allowed-tools` (Claude Code ignores command)
3. Workflow `@reference` path resolves wrong after install (subagent gets empty context)
4. `output()` writes >50KB to tmpfile but caller doesn't handle `@file:` prefix
5. Phase with unicode name creates directory but roadmap table regex fails to match it
6. Two concurrent pan-tools invocations corrupt state.md (no file locking)

## Proposed Solution

### Architecture: 4-Layer E2E Test Pyramid

```
Layer 4: Smoke Tests (CI)           — 5 tests, <30s
  "Does the installed product boot and respond?"

Layer 3: Command Contract Tests     — 40+ tests, <60s
  "Does every command produce the expected output schema?"

Layer 2: Workflow Simulation Tests  — 15+ tests, <90s
  "Does a multi-step user journey produce correct end state?"

Layer 1: Feedback Loop Tests        — 10+ tests, <60s
  "Does the system respond predictably to errors, edge cases, corruption?"
```

Layers 1-4 use the existing `createScenarioRunner(runtime)` pattern — zero new dependencies.

```
Layer 5: Playwright VSCode Integration  — 8+ tests, <120s
  "Does the installed product work inside a real VSCode instance?"
```

Layer 5 uses `@playwright/test` + `@vscode/test-electron` (dev dependencies only).

---

## Layer 5: Playwright VSCode Integration Tests — "Does It Work In the Real IDE?"

**Purpose:** Launch a real VSCode instance with PAN Wizard installed, verify the installed files are visible, openable, and structurally correct inside the actual IDE environment. This is the closest we can get to testing the real user experience without a human.

**Dependencies:** `@playwright/test`, `@vscode/test-electron` (devDependencies only — zero runtime impact)

### Architecture

```
1. Create temp project folder
2. git init + configure
3. Run PAN Wizard installer (node bin/install.js)
4. Launch VSCode via Playwright's Electron API (_electron.launch())
5. Interact with VSCode UI: file explorer, quick open, command palette
6. Assert: files visible, openable, valid content
7. Close VSCode, cleanup temp folder
```

### Key Technical Details

```javascript
const { _electron: electron } = require('playwright');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const app = await electron.launch({
  executablePath: await downloadAndUnzipVSCode('stable'),
  args: [
    '--disable-gpu-sandbox', '--no-sandbox',
    '--disable-updates', '--profile-temp',
    '--skip-welcome', '--skip-release-notes',
    '--new-window', tmpDir
  ],
  timeout: 60000
});
const window = await app.firstWindow();
```

### PW-001: VSCode launches with PAN Wizard installed project
```
1. Create temp dir, git init, run installer
2. Launch VSCode on temp dir via Playwright Electron API
3. Wait for window load (domcontentloaded)
4. Verify: VSCode window is visible, title contains folder name
5. Close gracefully
```

### PW-002: File explorer shows .claude directory structure
```
1. Launch VSCode on installed project
2. Open file explorer (Ctrl+Shift+E)
3. Verify: .claude directory visible in explorer tree
4. Expand .claude → commands → pan
5. Verify: command files listed (42+ .md files)
```

### PW-003: PAN Wizard command files are openable
```
1. Use Quick Open (Ctrl+P) to search for ".claude/commands/pan/help.md"
2. Select and open the file
3. Verify: editor tab opens with content
4. Verify: file content contains expected sections (frontmatter, description)
```

### PW-004: Hook files are openable and valid
```
1. Quick Open → ".claude/hooks/pan-statusline.js"
2. Verify: file opens in editor
3. Verify: no syntax error indicators (red squiggles on first load)
```

### PW-005: Agent files are discoverable
```
1. Quick Open → ".claude/agents/"
2. Verify: 11+ agent files appear in search results
3. Open one agent file → verify content has expected structure
```

### PW-006: pan-wizard-core files accessible
```
1. Quick Open → "pan-wizard-core/bin/pan-tools.cjs"
2. Verify: file opens
3. Verify: content includes command dispatcher (switch statement)
```

### PW-007: .planning directory created after init
```
1. Install PAN Wizard, then run `node pan-tools.cjs init new-project --name "Test"` in temp dir
2. Launch VSCode
3. Verify: .planning/ visible in file explorer
4. Verify: state.md, roadmap.md, config.json visible inside .planning/
```

### PW-008: Multiple runtime installs produce correct structure
```
For claude + copilot:
  1. Install for runtime in separate temp dirs
  2. Launch VSCode on each
  3. Verify: runtime-specific directory (.claude/ vs .github/) visible
  4. Close, cleanup
```

**Effort:** L | **Files:** `tests/e2e/vscode-integration.spec.mjs`

### Known Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| Cannot trigger Claude Code slash commands | Can't test `/pan:*` invocation | CLI contract tests (Layer 3) cover command behavior |
| Cannot verify Claude Code's command registry | Can't confirm commands are "seen" by Claude | Frontmatter validation tests verify structure |
| VSCode DOM selectors are internal/unstable | Selectors may break on VSCode updates | Pin VSCode version, use robust locators, accept maintenance cost |
| Playwright Electron API is experimental | API surface may change | Lock `@playwright/test` version in package.json |
| CI requires display server on Linux | `xvfb-run` needed for headless | CI config includes xvfb setup |
| VSCode startup is slow (5-15s) | Tests are slower than CLI tests | Use `beforeAll` to share one VSCode instance across tests |
| macOS CI needs specific runner | Different runner config | Platform-conditional CI matrix |

### What This Layer Does NOT Replace

Layer 5 complements but does not replace Layers 1-4:
- **Layer 3 (Contracts)** tests that command OUTPUT is correct JSON — Playwright can't invoke pan-tools
- **Layer 2 (Workflows)** tests multi-step CLI sequences — Playwright tests file visibility, not CLI execution
- **Layer 1 (Feedback)** tests error messages and edge cases — Playwright tests the "visual" installed state

---

## Layer 4: Smoke Tests — "Does It Boot?"

**Purpose:** Fast CI gate. If these fail, nothing else matters.

### ST-001: Installed pan-tools responds to `--version`
```
Install → run `pan-tools --version` → expect version string matching package.json
```

### ST-002: All 42 commands discoverable after install
```
Install for claude → list .claude/commands/pan/*.md → count >= 42
Install for copilot → list .github/skills/pan-*/ → count >= 42
```

### ST-003: Hook files are valid JavaScript
```
For each hook in hooks/dist/:
  require(hookPath) → does not throw
  typeof module.exports === 'function' || typeof module.exports === 'object'
```

### ST-004: pan-tools help includes all top-level commands
```
Run `pan-tools help` → output includes: state, phase, roadmap, config, validate, focus, init
```

### ST-005: Clean install + `init new-project` succeeds
```
Install → run init → .planning/ exists with state.md, roadmap.md, config.json
```

**Effort:** XS | **Files:** `tests/scenarios/smoke.test.cjs`

---

## Layer 3: Command Contract Tests — "Does Output Match Contract?"

**Purpose:** Verify every command produces a predictable JSON schema that the AI agent can parse. This is the core "visual testing" equivalent — instead of pixel-matching screenshots, we schema-match JSON output.

### Approach: Output Schema Snapshots

For each of the 94 CLI subcommands, define the expected output contract:

```javascript
const COMMAND_CONTRACTS = {
  'phases list': {
    success_fields: ['directories', 'count'],
    types: { directories: 'array', count: 'number' },
    error_fields: ['error'],
  },
  'state json': {
    success_fields: ['pan_state_version', 'status', 'milestone'],
    types: { status: 'string', pan_state_version: 'string' },
  },
  'focus scan': {
    success_fields: ['items', 'sources', 'total', 'priorities', 'source_todos'],
    types: { items: 'array', total: 'number', source_todos: 'object' },
  },
  'validate health': {
    success_fields: ['status', 'errors', 'warnings', 'info', 'repairable_count'],
    types: { status: 'string', errors: 'array', warnings: 'array' },
    enum_values: { status: ['healthy', 'degraded', 'broken'] },
  },
  // ... 90 more commands
};
```

### CT-001: Every command returns valid JSON (or valid raw string)
```
For each command in COMMAND_CONTRACTS:
  Run command with minimal valid args
  Parse output as JSON
  Verify: no parse error, no uncaught exception in stderr
```

### CT-002: Success output contains all required fields
```
For each command:
  Verify all success_fields present
  Verify field types match (string, number, array, object, boolean)
```

### CT-003: Error output follows error contract
```
For commands that can fail:
  Invoke with invalid args
  Verify output has `error` field (string)
  Verify no stack trace leaked to stdout
```

### CT-004: Raw mode output is parseable
```
For commands supporting --raw:
  Run with --raw flag
  Verify output is plain text (not JSON-wrapped)
  Verify no JSON braces in output
```

### CT-005: Large output uses @file: protocol correctly
```
Generate large plan (>50KB output)
  Verify output starts with @file:
  Verify referenced file exists and contains valid JSON
  Verify JSON matches expected schema
```

### CT-006: Enum fields contain only valid values
```
For commands with enum constraints (status, priority, effort):
  Verify returned values are within allowed set
```

**Effort:** L | **Files:** `tests/scenarios/command-contracts.test.cjs`, `tests/contracts/schemas.cjs`

---

## Layer 2: Workflow Simulation Tests — "Does the Journey Work?"

**Purpose:** Simulate real multi-step user workflows end-to-end. Each test represents a complete user story.

### WF-001: New Project Setup (10-step journey)
```
1. init new-project --name "Auth System"
2. config set model_profile balanced
3. phase add "database-schema"
4. phase add "api-endpoints"
5. phase add "auth-middleware"
6. state update status "In progress"
7. state add-decision --summary "Use JWT tokens"
8. phases list → expect 3 phases
9. roadmap analyze → expect 3 phases listed
10. state-snapshot → expect status="In progress", 1 decision
```

### WF-002: Phase Lifecycle (plan → execute → verify → complete)
```
1. init + add phase
2. template fill phase-prompt --phase 01
3. state update current_phase 01
4. Simulate plan creation (write plan.md to phase dir)
5. Simulate summary creation (write summary.md)
6. phase complete 01
7. Verify: phase marked complete in roadmap, state updated
8. Verify: auto-commit created (if git repo)
```

### WF-003: Focus Workflow (scan → plan → exec cycle)
```
1. init + add 5 phases with frontmatter (priority/effort)
2. focus scan → expect 5 items with priorities
3. focus plan --mode balanced → expect batch with budget allocation
4. focus exec --dry-run → expect execution plan
5. Verify: batch file created in .planning/focus/
```

### WF-004: Milestone Lifecycle
```
1. init + add 3 phases
2. Complete all 3 phases
3. milestone complete --name "v1.0"
4. Verify: MILESTONES.md updated
5. Verify: phases archived to milestones/v1.0-phases/
6. Verify: state.md milestone field updated
```

### WF-005: Error Recovery Journey
```
1. init project
2. Manually corrupt state.md (remove closing ---)
3. Run state json → expect graceful error (not crash)
4. Run validate health → expect "degraded" or "broken"
5. Run validate health --repair → expect repair action
6. Run state json → expect success after repair
```

### WF-006: Multi-Runtime Parity
```
For each runtime (claude, opencode, gemini, codex, copilot):
  1. Install
  2. Run init
  3. Run phase add
  4. Run state json
  5. Verify: identical JSON output across all runtimes
```

### WF-007: Git Integration Journey
```
1. git init + configure user
2. init project (auto git-init should detect existing repo)
3. Add phase + complete it
4. Verify: auto-commit created with conventional message
5. focus auto --init → verify initialized
6. focus auto --update → verify checkpoint commit
7. Verify: git log shows expected commit messages
```

### WF-008: Focus Sync Detects Real Staleness
```
1. Install PAN into temp project
2. Create README.md with "Has 99 commands and 50 agents"
3. Create docs/DEVELOPMENT.md with "1000 tests"
4. Run focus sync --tests 1500
5. Verify: stale items detected for commands, agents, tests
6. Verify: DOC_SYNC_FILES all scanned
7. Verify: COMMAND_RENAME_MAP old names detected if present
```

### WF-009: Concurrent Access Safety
```
1. init project
2. Spawn 5 parallel pan-tools invocations:
   - state update status "Active"
   - state add-decision --summary "Decision A"
   - state add-blocker --text "Blocker B"
   - phases list
   - state-snapshot
3. Verify: no crashes, no corrupted state.md
4. Verify: all mutations present in final state
```

### WF-010: Unicode/Special Character Handling
```
1. phase add "Authentifizierung"  (German)
2. phase add "API-endpunkte"
3. state add-decision --summary "Use UTF-8 encoding"
4. generate-slug "my feature $100"  (dollar sign)
5. Verify: all operations succeed
6. Verify: slugs are valid directory names
7. Verify: state.md content is not corrupted
```

**Effort:** XL | **Files:** `tests/scenarios/workflow-*.test.cjs`

---

## Layer 1: Feedback Loop Tests — "Does It Respond Predictably?"

**Purpose:** Verify the system gives useful, predictable feedback when things go wrong. This is the "visual" test — what does the user see?

### FL-001: Missing .planning/ gives actionable error
```
Run state json in empty dir → error message mentions "Run /pan:new-project first"
Run validate health → status: "broken", error mentions ".planning/ not found"
```

### FL-002: Invalid command gives helpful suggestion
```
Run pan-tools unknown-command → error lists available commands
Run pan-tools phas list (typo) → error suggests "phase"
```

### FL-003: Missing required args gives usage hint
```
Run phase add (no name) → error mentions required argument
Run config set (no key/value) → error shows expected format
```

### FL-004: Corrupted JSON config recovers gracefully
```
Write invalid JSON to config.json
Run config get model_profile → returns default (not crash)
Run validate health → reports config issue as repairable
```

### FL-005: Disk-full simulation (write failure)
```
Make .planning/ read-only (chmod)
Run state update status Active → returns error JSON (not crash)
Verify: error message mentions permission/write failure
```

### FL-006: Very large state.md performance
```
Generate state.md with 500 decisions, 200 blockers
Run state json → completes in <2 seconds
Run state-snapshot → completes in <2 seconds
```

### FL-007: Hook crash isolation
```
Install hooks
Replace hook with throw new Error("boom")
Run pan-tools command → command still succeeds (hook failure isolated)
```

### FL-008: Output never leaks sensitive info
```
Set env var PAN_SECRET=hunter2
Run various commands
Grep all stdout/stderr for "hunter2" → not found
Grep all stdout/stderr for absolute home paths → not found (only relative)
```

### FL-009: Exit codes are correct
```
Successful command → exit code 0
Failed command (invalid args) → exit code 1
Command with --help → exit code 0
```

### FL-010: JSON output is always valid (no mixed stdout)
```
For 20 random commands:
  Capture raw stdout
  Verify: either valid JSON or valid @file: reference
  Verify: no console.log leaks mixed into JSON
```

**Effort:** L | **Files:** `tests/scenarios/feedback-loop.test.cjs`

---

## Implementation Plan

### Phase 1: Contracts + Smoke (S, 2 pts)
- Create `tests/contracts/schemas.cjs` with 20 critical command schemas
- Create `tests/scenarios/smoke.test.cjs` (5 tests)
- Add `npm run test:e2e` script

### Phase 2: Expand Contracts (M, 4 pts)
- Expand schemas to all 94 subcommands
- Create `tests/scenarios/command-contracts.test.cjs` (40+ tests)
- Add CT-001 through CT-006

### Phase 3: Workflow Simulations (L, 10 pts)
- Create WF-001 through WF-010 (10 test files or sections)
- Most complex: WF-009 (concurrent), WF-005 (corruption recovery)

### Phase 4: Feedback Loop (M, 4 pts)
- Create FL-001 through FL-010
- Performance baselines (FL-006)
- Security assertions (FL-008)

### Phase 5: Playwright VSCode Integration (L, 12 pts)
- Add `@playwright/test` + `@vscode/test-electron` as devDependencies
- Create `tests/e2e/vscode-helpers.mjs` (launch VSCode, install PAN, cleanup)
- Create PW-001 through PW-008 (8 tests across 4 spec files)
- Add `npm run test:vscode` script
- CI integration: xvfb for Linux, platform-conditional matrix

### Total: 70+ node:test + 11 Playwright = 80+ new tests, ~32 pts

---

## Technical Approach

### Zero New Dependencies
All tests use existing infrastructure:
- `node:test` + `node:assert/strict`
- `createScenarioRunner(runtime)` from `tests/helpers.cjs`
- `runPanTools(args, cwd)` for CLI invocation
- `fs` for file system verification
- `child_process.execSync` for concurrent spawn tests

### Schema Validation Pattern
```javascript
function assertSchema(output, schema) {
  const parsed = typeof output === 'string' ? JSON.parse(output) : output;
  for (const [field, type] of Object.entries(schema.types || {})) {
    assert.ok(field in parsed, `missing field: ${field}`);
    assert.equal(typeof parsed[field], type, `${field} should be ${type}`);
  }
  if (schema.enum_values) {
    for (const [field, allowed] of Object.entries(schema.enum_values)) {
      assert.ok(allowed.includes(parsed[field]), `${field}=${parsed[field]} not in ${allowed}`);
    }
  }
}
```

### Snapshot Update Workflow
```bash
# Generate fresh snapshots from current code
node tests/contracts/generate-snapshots.js

# Review changes in git diff
git diff tests/contracts/schemas.cjs

# If intentional output change: commit new snapshots
# If unintentional regression: fix the code
```

---

## Success Criteria

| Criterion | Metric |
|-----------|--------|
| SC-001 | Smoke tests (5) pass on all 3 CI platforms |
| SC-002 | Command contracts cover >= 80% of 94 subcommands |
| SC-003 | All 10 workflow simulations pass |
| SC-004 | All 10 feedback loop tests pass |
| SC-005 | Layers 1-4 E2E suite runs in < 120 seconds |
| SC-006 | Zero new runtime dependencies added (Playwright is devDependency only) |
| SC-007 | CI pipeline includes `npm run test:e2e` and `npm run test:vscode` |
| SC-008 | WF-009 (concurrent access) identifies any race conditions |
| SC-009 | FL-008 (sensitive info) passes with no leaks |
| SC-010 | Layers 1-4 work on Windows, macOS, and Linux |
| SC-011 | Playwright tests (Layer 5) launch real VSCode and verify installed files are visible |
| SC-012 | Playwright tests verify .claude/ structure, commands, agents, and hooks are openable in VSCode |
| SC-013 | Playwright tests run in < 120 seconds (separate from Layer 1-4 timing) |

---

## What This Does NOT Cover (Intentional Exclusions)

| Exclusion | Reason |
|-----------|--------|
| Claude Code slash command invocation | Claude Code's chat webview is an iframe inaccessible to Playwright — no public DOM API for triggering `/pan:*` commands |
| Claude Code command registry verification | Cannot query whether Claude Code "sees" installed commands — its internal state is not exposed |
| AI response quality testing | Testing that the AI produces good plans is beyond E2E scope |
| Network-dependent tests (npm registry) | Flaky in CI, mock instead |
| Performance benchmarking | Separate concern; FL-006 is a sanity check, not a benchmark suite |
| Playwright terminal panel interaction | VSCode terminal DOM selectors are internal and fragile — CLI tests (Layers 1-4) cover this |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Contract schemas drift from code | Tests fail on intentional changes | Snapshot update workflow (generate + review) |
| Concurrent test (WF-009) is flaky | False failures in CI | Use retry logic, test 3x, fail if any run corrupts |
| chmod tests don't work on Windows | FL-005 skipped on Windows | Conditional skip with platform check |
| Large state.md test (FL-006) slow | CI timeout | Set explicit timeout, keep data < 1MB |
| Schema coverage incomplete | False confidence | Track coverage % in CI output |

---

## Links
- ADR-0018: User Reality Testing System (existing scenario infrastructure)
- Spec: `docs/specs/user_reality_testing_system_featureai.md`
- Test helpers: `tests/helpers.cjs`
- Existing scenarios: `tests/scenarios/*.test.cjs`
- CI: `.github/workflows/ci.yml`
