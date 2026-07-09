# End-to-End User Acceptance Testing — Feature Specification

**Mode:** `--internal` | **Date:** 2026-03-04 | **ADR:** ADR-0019

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard has 1,466 tests (1,419 unit + 47 scenario) that validate internal modules and basic install-then-run flows. However, **zero tests replicate the actual user journey**: a developer installs PAN into a project folder, opens it in VS Code, and invokes PAN commands through Claude Code or Copilot CLI. The existing scenario tests (ADR-0018) prove that `pan-tools.cjs` works from an installed path, but they don't validate:

1. **Settings/config schema correctness** — Is the generated `settings.json` (Claude) or `config.json` (Copilot) structurally valid for the host tool to consume?
2. **Command discoverability** — Are `.md` command files correctly placed where Claude Code / Copilot CLI expects them?
3. **Hook registration integrity** — Are hooks registered with correct event names (PascalCase for Claude, camelCase for Copilot) and valid file references?
4. **Agent structural validity** — Do agent `.md` files have the required frontmatter and XML structure tags?
5. **Multi-command user workflows** — Does a realistic sequence like `install → /pan:new-project → /pan:discuss-phase → /pan:plan-phase → /pan:exec-phase → /pan:verify-phase` produce coherent state transitions?
6. **IDE integration surface** — Does the installed structure match what VS Code extensions for Claude Code or Copilot CLI expect to find?

The gap: ADR-0018 tests prove "pan-tools works from installed location." This spec addresses "the installed structure is correct for the host tool to consume, and a user can complete a full workflow."

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Personal pain (user-stated) | This conversation | "it works well from a system test but contain no end state user test, where the panwizard is install into a folder opened up with VSCODE and is called via claude or copilot, now do a document for that" |
| ADR-0018 gap | ADR-0018 consequences | ADR-0018 explicitly defers: "No test validates that converted TOML/SKILL.md files are syntactically valid" and "No test validates hook execution" |
| Release risk | Production experience | Every release risks breaking the IDE integration surface — settings.json schema changes, hook key renames, command file misplacement — with no automated guard |

### 0.2.5 Before/After State

**Current behavior (before):**
- `npm run test:scenarios` runs 47 tests across 4 files
- `runtime-matrix.test.cjs`: install 5 runtimes + run `generate-slug`, `current-timestamp`, `state json`, `config-ensure-section` from installed path
- `workflow-init.test.cjs`: phase add/list, state mutations, validate health from Claude installed path
- `state-integrity.test.cjs`: state add-decision → add-blocker → state-snapshot consistency
- `cross-platform-paths.test.cjs`: JSON output has forward slashes, no absolute paths leaked
- **No test validates**: settings.json schema, hook key names, command file placement, agent file structure, multi-step user workflow coherence, or IDE integration surface

**Desired behavior (after):**
- New scenario test files that validate the **host tool integration contract**:
  - Settings.json / config.json contain required keys with correct types
  - Command `.md` files exist at correct paths for each runtime
  - Hook entries reference existing files and use correct event key names
  - Agent files have valid frontmatter and required XML structure tags
  - A realistic multi-command workflow produces coherent state (install → init state → add phase → plan-like operations → snapshot shows expected state)
  - Copilot config.json uses camelCase hooks, Claude settings.json uses PascalCase

**Delta:**
- New `tests/scenarios/settings-schema.test.cjs` — validates generated settings/config files
- New `tests/scenarios/command-discovery.test.cjs` — validates command file placement and discoverability
- New `tests/scenarios/hook-registration.test.cjs` — validates hook entries and file references
- New `tests/scenarios/agent-structure.test.cjs` — validates agent file format
- New `tests/scenarios/user-workflow-e2e.test.cjs` — full user journey simulation
- Existing scenario count grows from 47 to ~80+

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Settings.json / config.json schema validation | LLM response testing — non-deterministic |
| Command file placement per runtime | VS Code extension internals — third-party code |
| Hook registration format per runtime | Actual hook execution — requires real event triggers |
| Agent file structural validation | Agent behavior validation — requires LLM |
| Multi-command workflow state coherence | Interactive readline prompts — requires stdin mock |
| Claude + Copilot host tool contract | OpenCode TOML validation — separate runtime format |
| Gemini TOML basic structure | Full TOML spec compliance — needs TOML parser (runtime dep) |

### 0.4 Success Criteria

| ID | Criterion | Verification Method | Pass Condition |
|----|-----------|-------------------|----------------|
| SC-1 | Claude settings.json has valid hook keys | Test: parse JSON, check `hooks.SessionStart`, `hooks.PostToolUse` exist as arrays | Arrays with `>=1` entry each |
| SC-2 | Copilot config.json has valid hook keys | Test: parse JSON, check `hooks.sessionStart`, `hooks.postToolUse` exist as arrays | Arrays with `>=1` entry each |
| SC-3 | Command files discoverable per runtime | Test: glob for command files in expected paths | >= 30 commands found per runtime |
| SC-4 | Hook file references resolve to existing files | Test: extract paths from hook entries, verify file exists | All referenced files exist |
| SC-5 | Agent files have valid structure | Test: read agent .md files, check frontmatter + XML tags | All agents have `name`, `description` in frontmatter + `<objective>` tag |
| SC-6 | Multi-command workflow produces coherent state | Test: install → init state → add phase → list phases → snapshot | Snapshot reflects added phase |
| SC-7 | No regression in existing 1,466 tests | `npm run test:all` | All tests pass, count >= 1466 |

### 0.5 User Stories

```
As a PAN Wizard maintainer, I want tests that validate the settings.json schema
matches what Claude Code expects, so that installer changes don't silently break
hook registration, instead of discovering broken hooks after users install.
```

```
As a PAN Wizard maintainer, I want tests that verify command files are placed
where each runtime expects them, so that renamed or moved commands are caught
before release, instead of users getting "command not found" errors.
```

```
As a developer using PAN on Copilot CLI, I want confidence that config.json
uses the correct camelCase hook keys, so that hooks actually fire when I use
the tool, instead of silently failing because the key names are wrong.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `runtime-matrix.test.cjs` (ADR-0018) | Partial | Existing tests install + run commands. New tests ADD schema/structure validation on top. No replacement needed. |
| `workflow-init.test.cjs` (ADR-0018) | Partial | Existing tests run phase operations. New `user-workflow-e2e` adds a longer, more realistic sequence. Complementary. |
| `tests/installer-functions.test.cjs` | None | Tests install-lib.cjs pure functions. New tests validate the OUTPUT of the full installer. |
| `validate health` command | None | Validates `.planning/` structure. New tests validate runtime config directory structure. |

No full overlap — new tests validate the **host tool integration surface**, not pan-tools behavior.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 0 (internal) | 0 (internal) | 0 |
| New concepts introduced | 0 | 1 (host tool integration contract) | +1 |
| Score | — | — | neutral (0) — internal tooling, developer-only |

---

## Phase 0.8: Autonomous Codebase Investigation — Summary

### Files Read & Patterns Discovered

**Settings.json Schema (Claude Code — via `bin/install.js` lines 1578-1669):**
```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/pan-check-update.js" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/pan-context-monitor.js" }] }]
  },
  "statusLine": {
    "type": "command",
    "command": "node .claude/hooks/pan-statusline.js"
  }
}
```

**Config.json Schema (Copilot CLI — via `bin/install.js` lines 1538-1575):**
```json
{
  "hooks": {
    "sessionStart": [{ "command": "node .github/hooks/pan-check-update.js" }],
    "postToolUse": [{ "command": "node .github/hooks/pan-context-monitor.js" }]
  },
  "statusLine": {
    "command": "node .github/hooks/pan-statusline.js"
  }
}
```

**Key Difference:** Claude uses PascalCase event keys + nested `{hooks: [{type, command}]}` structure. Copilot uses camelCase keys + flat `{command}` structure. This is a prime source of integration bugs.

**Command File Paths by Runtime:**
- Claude: `.claude/commands/pan/*.md`
- OpenCode: `.opencode/command/pan-*.md` (flat, hyphenated)
- Gemini: `.gemini/commands/pan/*.md` (converted to TOML extension)
- Codex: `.codex/skills/pan-*/SKILL.md` (one dir per command)
- Copilot: `.github/skills/pan-*/SKILL.md` (one dir per command)

**Agent File Structure (from `agents/*.md`):**
- Frontmatter: `name`, `description`, `tools` (optional list), `color` (optional)
- Body: XML tags including `<objective>`, `<context>`, `<process>`, `<constraints>`

**Hook Files (from `hooks/dist/`):**
- `pan-statusline.js`, `pan-context-monitor.js`, `pan-check-update.js`
- All compiled by esbuild from `hooks/` source

### Impact Analysis

| Affected Area | Specific Item | How Affected | Risk Level |
|--------------|---------------|-------------|------------|
| Test directory | `tests/scenarios/` | 5 new test files added | Low |
| Package.json | `scripts` | No change needed — existing `test:scenarios` glob picks up new files | Low |
| Core modules | None | Tests are read-only against installed dirs | Low |
| Installer | None | Tests validate output, don't modify installer | Low |

Zero High-risk items — these are purely additive tests.

---

## Phase 1: Internal Reconnaissance — Summary

### 1.1 Existing Capabilities Inventory

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| Scenario runner (createScenarioRunner) | Complete | `tests/helpers.cjs:59-108` | Base for all new tests |
| Runtime matrix install + run | Complete | `tests/scenarios/runtime-matrix.test.cjs` | Template for schema/structure tests |
| Multi-step workflow test | Complete | `tests/scenarios/workflow-init.test.cjs` | Template for e2e workflow |
| Settings.json schema validation | Missing | — | Core deliverable |
| Command discoverability test | Missing | — | Core deliverable |
| Hook registration validation | Missing | — | Core deliverable |
| Agent structure validation | Missing | — | Core deliverable |
| Full user journey e2e | Missing | — | Core deliverable |

### 1.3 Convention Enforcement Checklist

- [x] CommonJS only (`.cjs` with `require()`)
- [x] Zero runtime dependencies — only `node:test`, `node:assert`, `node:fs`, `node:path`
- [x] Functions stay within complexity budget (50 lines max)
- [x] Tests use `test()` not `it()`
- [x] Tests use `node:assert/strict`
- [x] Tests follow `before()/after()` lifecycle with createScenarioRunner
- [x] Cleanup guaranteed by `after()` hooks

### 1.4 Dependency & Integration Map

```
[E2E User Acceptance Tests (new)]
    ├── depends on: tests/helpers.cjs (createScenarioRunner, RUNTIME_DIR)
    ├── depends on: bin/install.js (installer under test — not modified)
    ├── depends on: pan-wizard-core/bin/pan-tools.cjs (CLI under test)
    ├── reads: .claude/settings.json, .github/config.json (generated by installer)
    ├── reads: command .md files, agent .md files, hook .js files
    ├── extends: runtime-matrix.test.cjs (same install pattern)
    ├── conflicts with: nothing
    └── enables: regression detection for IDE integration surface
```

No circular dependencies.

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What testing complexity can we drop? | Eliminate need for running actual VS Code or Claude Code process — validate the file contracts instead. Eliminate LLM-dependent testing — focus on deterministic structural checks. |
| **REDUCE** | What should decrease? | Reduce reliance on manual "install and try it" testing. Reduce chance of shipping broken settings.json schemas. |
| **RAISE** | What should be raised? | Raise confidence that installed directories are consumable by host tools. Raise hook registration correctness from "trust the installer code" to "verified by test." |
| **CREATE** | What doesn't exist? | Create host-tool-contract validation tests. Create command discoverability tests. Create hook reference integrity tests. Create agent structural validation tests. |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                  ^
        [Host Tool Contract Testing]
```

Testing that "file structures match what AI tools expect" is deeply custom-built. No framework exists for validating Claude Code settings.json or Copilot CLI config.json schemas. This must be purpose-built and maintained as host tool schemas evolve.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Validates commands, agents, hooks are correctly structured for AI consumption | 5 |
| **Cross-Platform** | Tests run on all 3 platforms via CI | 4 |
| **Developer Experience** | Catches broken installs before users do | 5 |
| **Zero Dependencies** | Uses only Node.js builtins | 5 |
| **State Persistence** | Validates state transitions across multi-command sequences | 3 |
| **Verification Quality** | Directly verifies the user-facing integration surface | 5 |
| **Total** | | **27/30** |

### 3.4 Strategic Recommendation

**Build it.** This closes the last gap in the testing pyramid: ADR-0018 proved pan-tools works from installed paths, but nothing proves the installed directory is correct for the HOST TOOL. A broken `settings.json` hook key means hooks silently don't fire. A misplaced command `.md` means the command doesn't appear in Claude Code. These are invisible failures — users blame PAN, not the integration surface. The unique angle: contract-based testing of AI tool integration points. No other project tests this because no other project supports 5 runtimes.

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

### 3.5.1 Feature Type Classification

**Type: Test Infrastructure (additive)**
- Create: `tests/scenarios/settings-schema.test.cjs`
- Create: `tests/scenarios/command-discovery.test.cjs`
- Create: `tests/scenarios/hook-registration.test.cjs`
- Create: `tests/scenarios/agent-structure.test.cjs`
- Create: `tests/scenarios/user-workflow-e2e.test.cjs`

### 3.5.2 Layer Violation Check

- [x] Tests only read generated files — no writes to installed dirs
- [x] Tests use `createScenarioRunner` from helpers.cjs — same pattern as existing tests
- [x] No test file imports agent/command/hook files as modules — they read them as plain text
- [x] No upward dependencies

### 3.5.3 Output Contract Design

N/A — tests produce node:test TAP output. No custom JSON contract needed.

### 3.5.4 State Transition Modeling

N/A — tests are read-only against generated dirs. The `user-workflow-e2e` test creates temp `.planning/` state, which is cleaned up after.

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | No |
| Changes file formats? | No |
| Changes directory structure? | No — new test files only |
| Changes installer output? | No |

### 3.5.6 Composability Analysis

| Interaction | Works? | How |
|-------------|--------|-----|
| CI runs new tests automatically | Yes | `npm run test:scenarios` glob picks up new files in `tests/scenarios/` |
| Developer runs single test file | Yes | `node --test tests/scenarios/settings-schema.test.cjs` |
| Existing test:all includes new tests | Yes | Glob: `tests/scenarios/*.test.cjs` |

### 3.5.7 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| Install per runtime (~200ms) | ~1000ms for 5 | Shared per describe block |
| Read + validate settings.json | ~5ms per runtime | JSON parse + key checks |
| Glob command files | ~20ms per runtime | fs.readdirSync |
| Read agent .md files | ~50ms for 11 agents | fs.readFileSync x 11 |
| Multi-command workflow | ~500ms | 5 x execSync ~100ms each |
| **Total new test time** | **~3-5s** | Minimal addition to existing ~15s scenarios |

### 3.5.8 Cross-Platform Considerations

| Platform | Consideration |
|----------|---------------|
| Windows | Path separators in hook commands — installer should produce forward slashes |
| Mac/Linux | POSIX paths — no issues |
| All | Use `path.join()` for file reads, compare with normalized patterns |
| CI | GitHub Actions already configured (ADR-0018) |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

**End-to-End User Acceptance Tests** validate that PAN Wizard's installed directory structure is correct for the host AI tool to consume. They bridge the gap between "pan-tools commands work" (ADR-0018) and "the user can actually use PAN from Claude Code / Copilot CLI."

**Example 1: Settings.json Schema Validation**
```javascript
// tests/scenarios/settings-schema.test.cjs
describe('Claude settings.json schema', () => {
  let runner;
  before(() => { runner = createScenarioRunner('claude'); });
  after(() => { if (runner) runner.cleanup(); });

  test('hooks use PascalCase event keys', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    assert.ok(settings.hooks.SessionStart, 'SessionStart hook missing');
    assert.ok(settings.hooks.PostToolUse, 'PostToolUse hook missing');
    // Verify NO camelCase keys leaked
    assert.equal(settings.hooks.sessionStart, undefined, 'camelCase sessionStart should not exist');
  });
});
```

**Example 2: Command Discoverability**
```javascript
// tests/scenarios/command-discovery.test.cjs
describe('Claude command discoverability', () => {
  test('command files exist in .claude/commands/pan/', () => {
    const cmdDir = path.join(runner.tmpDir, '.claude', 'commands', 'pan');
    const files = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md'));
    assert.ok(files.length >= 30, `Expected >= 30 commands, found ${files.length}`);
    assert.ok(files.includes('plan-phase.md'), 'plan-phase.md should exist');
    assert.ok(files.includes('exec-phase.md'), 'exec-phase.md should exist');
  });
});
```

**Example 3: Full User Workflow**
```javascript
// tests/scenarios/user-workflow-e2e.test.cjs
describe('Full user workflow: install → init → plan → verify', () => {
  test('complete lifecycle produces coherent state', () => {
    // Setup project structure
    setupProject(runner.tmpDir);

    // 1. Config ensure
    const config = runner.run('config-ensure-section');
    assert.ok(config.success);

    // 2. Add phase
    const phase = runner.run('phase add authentication');
    assert.ok(phase.success);

    // 3. List phases — should include added phase
    const list = runner.run('phases list');
    const parsed = JSON.parse(list.output);
    assert.ok(parsed.directories.length >= 1);

    // 4. State snapshot — should be consistent
    const snapshot = runner.run('state-snapshot');
    assert.ok(snapshot.success);
    const state = JSON.parse(snapshot.output);
    assert.ok(state.status);

    // 5. Validate health — should pass
    const health = runner.run('validate health');
    assert.ok(health.success);
  });
});
```

**What these tests do NOT test:**
- LLM responses (non-deterministic)
- VS Code extension behavior (third-party)
- Actual hook execution (requires real event triggers)
- Interactive readline prompts (requires stdin)

### 4.2 Reference-Level Explanation

#### 4.2.1 Test File Specifications

**`settings-schema.test.cjs`** — Host tool config validation
```
Runtimes tested: claude, copilot
Reads: .claude/settings.json, .github/config.json
Validates:
  - JSON is parseable
  - Hook event keys use correct casing (PascalCase for Claude, camelCase for Copilot)
  - Hook entries are arrays (not objects or strings)
  - statusLine key exists with command field
  - No unexpected top-level keys
  - Hook command strings are non-empty
```

**`command-discovery.test.cjs`** — Command file placement
```
Runtimes tested: claude, copilot, codex
Validates:
  - Claude: .claude/commands/pan/*.md — count >= 30
  - Copilot: .github/skills/pan-*/SKILL.md — count >= 30
  - Codex: .codex/skills/pan-*/SKILL.md — count >= 30
  - Known critical commands exist (plan-phase, exec-phase, verify-phase, new-project, quick)
  - No empty command files (size > 100 bytes)
```

**`hook-registration.test.cjs`** — Hook file reference integrity
```
Runtimes tested: claude, copilot
Validates:
  - Each hook entry's command field references a file that exists on disk
  - hook .js files are non-empty (> 100 bytes)
  - 3 expected hooks present: pan-check-update.js, pan-context-monitor.js, pan-statusline.js
  - No duplicate hook entries (deduplication worked)
```

**`agent-structure.test.cjs`** — Agent file format
```
Runtimes tested: claude
Validates:
  - All .md files in .claude/agents/ have content
  - Frontmatter contains 'name' field
  - Body contains <objective> XML tag
  - Agent count matches expected (>= 10)
```

**`user-workflow-e2e.test.cjs`** — Full user journey
```
Runtime: claude
Workflow:
  1. Install (done by createScenarioRunner)
  2. Setup .planning/ structure (roadmap.md, state.md)
  3. config-ensure-section → config.json exists
  4. phase add → new phase directory created
  5. phase add (second) → two phases exist
  6. phases list → returns both phases
  7. state add-decision → decision recorded
  8. state-snapshot → reflects decisions and phases
  9. validate health → passes
  10. generate-slug → utility works in context
Validates:
  - Each step succeeds
  - State is consistent across operations
  - No state corruption from interleaved operations
  - Final snapshot reflects all accumulated changes
```

#### 4.2.2 Settings.json Contract (Claude Code)

Expected structure after install:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/pan-check-update.js" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/pan-context-monitor.js" }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "node .claude/hooks/pan-statusline.js"
  }
}
```

#### 4.2.3 Config.json Contract (Copilot CLI)

Expected structure after install:
```json
{
  "hooks": {
    "sessionStart": [
      { "command": "node .github/hooks/pan-check-update.js" }
    ],
    "postToolUse": [
      { "command": "node .github/hooks/pan-context-monitor.js" }
    ]
  },
  "statusLine": {
    "command": "node .github/hooks/pan-statusline.js"
  }
}
```

### 4.3 Design Decisions

| Decision | Rationale | What We Did NOT Do (and Why) |
|----------|-----------|-------------------------------|
| Validate file contracts, not runtime behavior | Host tools consume files — if files are correct, tools work. Avoids non-deterministic testing. | Didn't start actual Claude Code / Copilot process — requires full IDE, not automatable |
| Test Claude + Copilot schemas separately | Different key casing and hook structure — both must be validated independently. | Didn't create a generic "validate any runtime config" — too abstract, each runtime is different |
| Read agent .md files as plain text, not parse frontmatter | We need to verify structure exists, not parse it perfectly. Regex for key fields is sufficient. | Didn't add a YAML parser — runtime dependency |
| Test command count thresholds, not exact counts | Command count changes with each release. Threshold (>=30) catches catastrophic failures. | Didn't hardcode exact command list — too brittle |

### 4.4 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| Schema validation | Manual JSON parse + key checks | JSON Schema library | Runtime dependency | Must maintain key expectations manually |
| Command discovery | fs.readdirSync + count | Start Claude Code and check /pan:help | Requires Claude Code installed, non-deterministic | Doesn't test actual tool discovery |
| Hook validation | Extract command from JSON, check file exists | Run hook command and check exit code | Some hooks have side effects | Doesn't test hook execution logic |
| Agent validation | Regex for frontmatter + XML tags | YAML parser + XML parser | Two runtime dependencies | Regex may miss edge cases |
| User workflow | 10-step command sequence | Full new-project interactive flow | Requires stdin mocking | Shorter workflow, less coverage |

### 4.5 Feature Ladder

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | Settings schema + command discovery + hook registration tests | Host tool contract validated for Claude + Copilot | S (2 pts) |
| **v1 (Complete)** | + agent structure + user workflow e2e + all 5 runtimes | Full integration surface validated | M (4 pts) |
| **v2 (Enhanced)** | + TOML syntax validation for Gemini + SKILL.md format validation for Codex + golden file comparison | Runtime-specific format correctness | M (4 pts) |

### 4.6 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this feature? | Internal — `npm run test:scenarios` automatically includes new files |
| What's the learning curve? | Minimal — same `createScenarioRunner` pattern as existing scenario tests |
| Does it require changing existing workflows? | No — additive tests only |
| What's the "aha moment"? | First time a test catches a broken settings.json key after an installer refactor |

---

## Phase 5: Architecture Decision Record

See `docs/decisions/ADR-0019-end-to-end-user-acceptance-testing.md` (saved separately).

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Mode Analysis

| Failure Mode | Category | Detection Pattern | Recovery | User Sees |
|-------------|----------|-------------------|----------|-----------|
| Settings.json not found after install | Installer bug | fs.readFileSync throws ENOENT | Test fails with "settings.json missing at {path}" | Actionable test failure |
| Hook key has wrong casing | Installer bug | `settings.hooks.SessionStart === undefined` | Test fails with "Expected PascalCase key SessionStart, not found" | Shows which key is wrong |
| Command .md file missing | Installer bug | readdirSync returns fewer than threshold | Test fails with "Expected >= 30 commands, found N" | Shows count mismatch |
| Hook references nonexistent file | Installer bug | fs.accessSync throws ENOENT | Test fails with "Hook references {path} which does not exist" | Shows exact missing file |
| Agent .md missing frontmatter | Agent file bug | Regex doesn't match | Test fails with "Agent {name} missing 'name' in frontmatter" | Shows which agent |
| State corruption in workflow | Core module bug | JSON.parse or field assertion fails | Test fails with "Expected status field in snapshot, got {actual}" | Shows state inconsistency |
| Installer fails for runtime | Environment | createScenarioRunner throws | Test describe block fails entirely | "Installer failed for {runtime}: {error}" |

### 6.2 Diagnostic Output

All tests use standard node:test assertions with descriptive messages:
```javascript
assert.ok(settings.hooks.SessionStart,
  'Claude settings.json missing hooks.SessionStart — installer may not be registering PascalCase keys');
```

The assertion message IS the diagnostic — no separate diagnostic framework needed.

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Input Inventory

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| Temp directories | Created by createScenarioRunner | System-generated, trusted |
| settings.json / config.json | Read from temp installed dir | Generated by installer, trusted |
| Command .md files | Read from temp installed dir | Copied by installer, trusted |
| Agent .md files | Read from temp installed dir | Copied by installer, trusted |
| Hook .js files | Read from temp installed dir | Compiled by esbuild + copied by installer, trusted |

### 7.2 Path Safety

- All temp dirs created via `fs.mkdtempSync` — OS-guaranteed unique
- All paths resolved relative to `runner.tmpDir` — no escape possible
- No user-supplied paths — all test paths are hardcoded or derived from RUNTIME_DIR
- Cleanup guaranteed by `after()` hooks in every describe block

### 7.3 Output Sanitization

- [x] No absolute paths in assertion messages
- [x] No environment variables exposed
- [x] No stack traces in custom messages
- [x] Temp directories cleaned up after test

### 7.5 Privilege Scope

```
Reads from: temp directories (os.tmpdir()), bin/install.js (execSync)
Writes to: temp directories only
Executes shell: Yes — node bin/install.js, node pan-tools.cjs (via createScenarioRunner)
Reads outside project: No
```

---

## Phase 8: Implementation Roadmap

### 8.1 Implementation Tasks

```
### Task 1: Settings/config schema validation tests
Files: tests/scenarios/settings-schema.test.cjs (new)
Tests: ~12 tests (6 per runtime x 2 runtimes: Claude, Copilot)
Validates: JSON parseable, hook keys correct casing, arrays not objects,
  statusLine present, hook commands non-empty, no camelCase leak in Claude,
  no PascalCase leak in Copilot
Estimate: S
Priority: P2

### Task 2: Command discoverability tests
Files: tests/scenarios/command-discovery.test.cjs (new)
Tests: ~10 tests (3-4 per runtime x 3 runtimes: Claude, Copilot, Codex)
Validates: Command dir exists, >= 30 commands, critical commands present,
  no empty files, correct directory structure per runtime
Estimate: S
Priority: P2

### Task 3: Hook registration integrity tests
Files: tests/scenarios/hook-registration.test.cjs (new)
Tests: ~10 tests (5 per runtime x 2 runtimes: Claude, Copilot)
Validates: Each hook entry references existing file, 3 expected hooks present,
  no duplicate entries, hook files > 100 bytes
Estimate: S
Priority: P2

### Task 4: Agent structure validation tests
Files: tests/scenarios/agent-structure.test.cjs (new)
Tests: ~8 tests
Validates: Agent count >= 10, frontmatter has 'name', body has <objective>,
  no empty agent files, agents dir exists
Estimate: S
Priority: P3

### Task 5: Full user workflow e2e test
Files: tests/scenarios/user-workflow-e2e.test.cjs (new)
Tests: ~10 tests (10-step workflow)
Validates: Install → config → phase add → list → state mutation → snapshot →
  health check — all consistent and non-corrupting
Estimate: M
Priority: P3
```

### 8.2 Dependency Graph

```
Task 1 (settings schema) ──────┐
Task 2 (command discovery) ─────┤
Task 3 (hook registration) ─────┤── All independent, can be built in parallel
Task 4 (agent structure) ───────┤
Task 5 (user workflow e2e) ─────┘
```

All tasks depend only on `createScenarioRunner` from `tests/helpers.cjs` which already exists. No task depends on another task. All 5 can be built independently.

### 8.3 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Settings.json schema changes in future Claude Code releases | Medium | Medium | Tests document expected schema; update when Claude Code changes |
| Copilot CLI config.json format undocumented/unstable | Medium | Medium | Tests validate current known format; flag changes early |
| Agent file format changes | Low | Low | Tests use loose matching (contains key, not exact format) |
| Command count threshold too high/low | Low | Low | Use >= 30 (well below actual ~38); update if commands removed |
| Test flakiness from install timing | Low | Medium | createScenarioRunner already handles this with 30s timeout |

### 8.4 Cognitive Complexity Budget

- Max lines per function: 50
- Max nesting depth: 3 levels
- Max parameters: 4
- All test files follow identical pattern: `before(install) → test(validate) → after(cleanup)`

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Pattern | Minimum Count | What It Catches |
|-------|---------|---------------|-----------------|
| **Integration** | Settings/config schema validation | 12+ | Hook key casing, missing keys, wrong types |
| **Integration** | Command file discoverability | 10+ | Missing commands, wrong paths, empty files |
| **Integration** | Hook registration integrity | 10+ | Broken file references, missing hooks, duplicates |
| **Integration** | Agent structural validation | 8+ | Missing frontmatter, missing XML tags |
| **E2E** | Full user workflow | 10+ | State corruption, inconsistent operations, workflow breaks |

**Total new tests: ~50+**

### 9.2 Assertion Density Requirements

Every test asserts:
- (a) Primary condition (key exists, file found, command succeeds)
- (b) Value correctness (correct casing, correct type, correct count range)
- (c) Negative condition where applicable (no wrong-cased keys, no duplicate hooks)

### 9.3 Boundary Value Analysis

- [x] Empty settings.json before install → installer creates correct structure
- [x] Pre-existing settings.json with other hooks → PAN hooks added without removing others
- [x] Runtime with no hook support (Codex) → no settings.json expected
- [x] Agent files with minimal frontmatter (just name) → still passes
- [x] Command files with only `---` frontmatter → caught by size check (> 100 bytes)
- [x] Copilot flat hook structure vs Claude nested hook structure → both validated independently

### 9.4 Regression Verification

- [x] All existing 1,466 tests pass unchanged
- [x] Existing 47 scenario tests pass unchanged
- [x] `npm run test:scenarios` glob includes new files automatically
- [x] No existing test expectations changed

### 9.5 Performance Validation

- [x] Each new test file completes in < 5s
- [x] Total new test time < 10s
- [x] `npm run test:all` still completes in < 100s total
- [x] No regression in existing test suite runtime

---

## Phase 10: Report Summary

### Problem & Evidence
1,466 tests validate internals but zero tests validate the host tool integration surface — settings.json schema, command discoverability, hook registration, agent structure. User explicitly requested: "no end state user test, where the panwizard is installed into a folder opened up with VSCODE and is called via claude or copilot."

### Investigation Depth
- Read `bin/install.js` (settings.json + config.json generation logic, lines 1520-1669)
- Read all 4 existing scenario test files (47 tests)
- Read `tests/helpers.cjs` (createScenarioRunner implementation)
- Read `install-lib.cjs` (extracted pure functions)
- Traced hook registration for Claude (PascalCase) vs Copilot (camelCase)
- Traced command file paths for all 5 runtimes

### Strategic Assessment
- **Blue Ocean:** CREATE host-tool-contract validation — no other project tests this
- **Wardley:** Custom-built — no off-the-shelf framework for AI tool config validation
- **Moat Score:** 27/30
- **Cognitive Load:** 0 (internal tooling)
- **Recommendation:** Build — closes the last gap in the testing pyramid

### Design Summary
- **Type:** Test infrastructure (5 new scenario test files, purely additive)
- **Modules affected:** None modified — tests read installed directories only
- **Breaking changes:** None
- **Error handling:** Descriptive assertion messages are the diagnostics

### Feature Ladder
- **v0 (MVP):** Settings schema + command discovery + hook registration = S effort
- **v1 (Complete):** + agent structure + user workflow e2e = M effort
- **v2 (Enhanced):** + TOML/SKILL.md format validation + golden files = M effort

### Implementation Tasks
- 5 tasks, all independent (parallelizable)
- Total: ~50 new tests across 5 files
- Zero files modified — purely additive

### Security
- All operations in temp directories — no production risk
- No user-supplied paths — all hardcoded

### Acceptance Criteria
- 7 criteria, 6 machine-checkable (SC-1 through SC-6), 1 regression (SC-7)

### Documents Created
- Spec: `docs/specs/end_to_end_user_acceptance_testing_featureai.md`
- ADR: `docs/decisions/ADR-0019-end-to-end-user-acceptance-testing.md`

### Next Step
Implement the 5 test files. Recommended order: Task 1 (settings schema) → Task 3 (hook registration) → Task 2 (command discovery) → Task 4 (agent structure) → Task 5 (user workflow e2e). Or implement all 5 in parallel since they have no dependencies on each other.

---

## Post-Implementation Note (2026-03-04)

All 5 tasks implemented and verified. Counts at spec time: 1,466 tests (1,419 unit + 47 scenario), 42 test files. Counts after implementation: 1,518 tests (1,419 unit + 99 scenario), 52 test files (43 unit + 9 scenario). Commit: cd86512.
