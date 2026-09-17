# PAN Wizard — Development Rules

**Branch:** main · **Source of truth:** `package.json` for version, this file for counts

---

## CRITICAL: Single source of truth for counts

This file is the **only** place where test counts, command counts, agent counts, module counts, etc. are recorded as numbers. **All other docs** (README.md, docs/*.md, comments, etc.) MUST NOT embed these numbers — they drift instantly. Use qualitative phrasing ("multi-agent", "extensive command set", "all shipped commands") or refer back here.

If you're auditing a doc and find a number that looks like it should match a filesystem count (test count, command count, etc.), **delete the number** rather than chasing the drift across N files. The fix isn't to update; the fix is to remove.

To refresh the counts table below, run from repo root:

```bash
node -e "
const fs = require('fs'), path = require('path');
const pkg = require('./package.json');
const ls = (p, glob = /\.md$/) => fs.readdirSync(p).filter(f => glob.test(f)).length;
const walkMd = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) n += walkMd(fp);
    else if (e.name.endsWith('.md')) n++;
  }
  return n;
};
const lib = fs.readdirSync('pan-wizard-core/bin/lib').filter(f => f.endsWith('.cjs')).length;
console.log({
  version: pkg.version,
  commands: ls('commands/pan'),
  agents: ls('agents'),
  modules: lib,
  workflows: ls('pan-wizard-core/workflows'),
  templates: walkMd('pan-wizard-core/templates'),    // recursive — counts research-project/, codebase/ subtrees
  references: ls('pan-wizard-core/references'),
  unitTests: ls('tests', /\.test\.cjs$/),
  scenarioTests: ls('tests/scenarios', /\.test\.cjs$/),
  hooks: ls('hooks', /\.js$/),                       // sources, matching the row label — hooks/dist/ is gitignored build output and absent on a fresh clone
  specs: ls('docs/specs'),
  adrs: ls('docs/decisions', /^ADR-.*\.md$/),
});
"
```

Then run `npm run test:all 2>&1 | grep -E '^ℹ (tests|suites)'` to refresh the test count.

### Counts (the only place these live)

| What | Count |
|---|---|
| Version | (see `package.json`) |
| Commands (`commands/pan/*.md`) | 59 |
| Agents (`agents/*.md`) | 24 |
| Core modules (`pan-wizard-core/bin/lib/*.cjs`) | 55 |
| Workflows (`pan-wizard-core/workflows/*.md`) | 33 |
| Templates (`pan-wizard-core/templates/*.md`) | 42 |
| References (`pan-wizard-core/references/*.md`) | 16 |
| Unit test files (`tests/*.test.cjs`) | 135 |
| Scenario test files (`tests/scenarios/*.test.cjs`) | 36 |
| Total tests (npm run test:all) | 4211 |
| Total test suites | 906 |
| Hooks (`hooks/*.js`) | 6 |
| Specs (`docs/specs/*.md`) | 48 |
| ADRs (`docs/decisions/ADR-*.md`) | 48 |

These are a snapshot of the **current working tree**, not of any released tag — a branch mid-audit carries files `main` does not (test files especially). They drift; refresh via the snippet above when needed. **Never propagate them to another doc.**

---

## CRITICAL: Never install PAN into the source repository

**This is the PAN Wizard source code repository.** Do NOT install PAN into this directory.

- NEVER run `node bin/install.js` from `d:/PanWizard/` (or wherever this repo is cloned)
- NEVER create `.claude/pan-wizard-core/`, `.claude/pan-file-manifest.json`, or `.claude/package.json` in this repo
- NEVER copy source files into `.codex/`, `.gemini/`, `.opencode/`, or `.github/` (Copilot's project dir) within this repo
- The installer has a hard guard (`PAN_SOURCE_ROOT` check in `bin/install.js` — search for the constant) that refuses to run from the source directory
- `.gitignore` blocks all self-install artifacts from being committed

## Testing PAN installations

Use a **separate directory** for testing PAN installations:

```bash
# Correct — install into a test directory (single runtime)
cd d:/pantesting && node d:/PanWizard/bin/install.js --claude --local

# Correct — full deployment (all 5 runtimes)
cd d:/pantesting && node d:/PanWizard/bin/install.js --claude --codex --gemini --opencode --copilot --local

# Wrong — this will be rejected by the installer
cd d:/PanWizard && node bin/install.js --claude --local
```

The test directory is `d:\pantesting`. All manual installation testing goes there.

Automated tests (`npm test`, `npm run test:scenarios`) use OS temp directories via `os.tmpdir()` and are safe to run from the source repo.

## Test commands

```bash
npm test                # Unit tests (tests/*.test.cjs)
npm run test:scenarios  # Scenario tests (tests/scenarios/*.test.cjs)
npm run test:all        # All tests
npm run build:hooks     # Copy hook scripts to hooks/dist/ (copy-only; PAN hooks are pure Node.js)
```

## 5 target runtimes

PAN Wizard installs into 5 AI coding tool runtimes:

| Runtime | Directory | CLI Flag | Tool |
|---------|-----------|----------|------|
| Claude  | `.claude/` | `--claude` | Claude Code |
| Codex   | `.codex/` | `--codex` | OpenAI Codex CLI |
| Gemini  | `.gemini/` | `--gemini` | Google Gemini CLI |
| OpenCode | `.opencode/` | `--opencode` | OpenCode |
| Copilot | `.github/` | `--copilot` | GitHub Copilot CLI |

## Project structure

### Source code (shipped by installer)

- `bin/install.js` — Installer entry point
- `bin/install-lib.cjs` — Installer functions, pure apart from the read-only `verifyInstall()`/`dirDigest()`
- `pan-wizard-core/bin/pan-tools.cjs` — CLI dispatcher
- `pan-wizard-core/bin/lib/*.cjs` — Core CJS modules
- `pan-wizard-core/workflows/*.md` — Multi-step workflow definitions
- `pan-wizard-core/templates/*.md` — Scaffolding templates
- `pan-wizard-core/references/*.md` — Agent-loaded reference docs
- `pan-wizard-core/mcp/*.cjs` — **MCP bridge (canonical home).** Zero-dep dual-era JSON-RPC stdio server exposing `pan-tools` verbs as MCP tools/resources, plus the registry, the `next-action` state machine, and the human merge gate. Lives under the core so it ships to every install and every runtime. `pan-zcode/` is a **consumer**, not the owner — never fork a copy back under it.
- `commands/pan/*.md` — Command definitions (copied by installer)
- `agents/*.md` — Agent definitions (copied by installer)
- `hooks/*.js` — Hooks (source, built → `hooks/dist/`)
- `pan-zcode/*` — **Experimental (preview):** ZCode-native subsystem. Ports PAN's agents to ZCode subagents and emits an MCP registration pointing at the shared server in `pan-wizard-core/mcp/`; its own installer (`pan-zcode/bin/install-zcode.js`) is separate from `bin/install.js` and is NOT a 6th runtime of the main installer. See `pan-zcode/README.md`.

### Tests

- `tests/*.test.cjs` — Unit test files
- `tests/scenarios/*.test.cjs` — Scenario test files (installer + integration + workflow)

### Documentation

- `docs/*.md` — User and developer docs (USER-GUIDE, ARCHITECTURE, CLI-REFERENCE, etc.)
- `docs/decisions/ADR-*.md` — Architecture Decision Records
- `docs/specs/*.md` — Feature specs

### Development tools (for PAN development only — `.claude/`, `marketplace/` and `harness/` are not shipped; `scripts/` does ship because `package.json` `files` includes it)

- `.claude/commands/*.md` — Dev commands (`/build`, `/test`, `/check`, `/pandev`, etc.)
- `.claude/agents/*.md` — Dev agents (dev-orchestrator, dev-workflow)
- `.claude/workflows/*.md` — Workflow protocols
- `.claude/settings.json` — Claude Code permissions
- `scripts/build-hooks.js` — hook copy script (copies the hooks listed in `HOOKS_TO_COPY` to `hooks/dist/`; copy-only, no bundler — a new hook must be added to that list)
- `scripts/build-plugin.js` — emits the Claude Code plugin to `dist/pan-wizard-plugin/` (manifest, commands, agents, hooks, workflows, `.mcp.json`, core)
- `scripts/plugin-path.js` — rebuilds the plugin and prints its absolute path as **exactly one stdout line**, the contract a plugin-marketplace `command` source requires. Claude Code runs it from the user's HOME, so nothing may depend on cwd, and the builder's output is relayed to stderr
- `scripts/deprecate-old-versions.js` — release housekeeping: after a successful publish, deprecates every stable release outside the newest-3 window plus any superseded prerelease. Dry-run by default; **never unpublishes** (a test asserts the script has no unpublish path)
- `scripts/test-surface.cjs` — derives the shipped surface from the code (verbs, subcommands, dispatcher arms, installer flags, hook × runtime, MCP tools/resources, config keys, content dirs) into `tests/fixtures/surface.json`; `--check` fails on drift, `--map` shows which test names each row, `--scaffold <dir>` writes a todo stub per unreferenced row. `tests/surface-map.test.cjs` enforces it with `tests/fixtures/surface-allowlist.json` (every entry needs a reason)
- `scripts/coverage-gate.cjs` — runs the suite under Node's own coverage (`node --test --experimental-test-coverage`, Node 22+) and fails when a dispatcher `case` arm never executed or a module group drops below the floors in `tests/fixtures/coverage-policy.json`. Release-check Gate 9; advisory CI step on the Node 22 job. `npm run test:coverage`
- `scripts/test-quality-lint.cjs` — the assertion shapes that passed while the feature was broken (OR-shaped liveness asserts, in-process `cmd*` calls that exit the process, `assert(true)`, length-only CLI asserts, bare platform returns, tight wall-clock bounds, real-HOME reads, committed todos), applied to the suite by `tests/test-quality.test.cjs` with `tests/fixtures/test-quality-allowlist.json`
- `marketplace/` — a local `command`-source marketplace (`marketplace/.claude-plugin/marketplace.json`) that installs the plugin from this checkout without publishing. Not shipped — absent from `package.json` `files`. See `marketplace/README.md`
- `scripts/build-agent-plugin.js` — emits the vendor-neutral **Agent Plugins** bundle to `dist/pan-agent-plugin/` (ADR-0045) for Copilot CLI, Codex, Cursor, Kiro. `.agents/plugins/marketplace.json` (Codex) and `.github/plugin/marketplace.json` (Copilot) point at it
- `harness/` — the **PAN Harness** (ADR-0047): behavioural scenarios run against deployed installs built from a packed artifact. `npm run harness` is tier 0 (model-free, free); model tiers need `--max-usd`. Run state goes to `d:\pantesting\harness-runs\`; `harness/ledger.jsonl` is the tracked finding history. Not shipped. See `harness/README.md`

### Key design patterns

- **CommonJS (.cjs)** for all core modules — required for Claude Code compatibility
- **Pure functions** in `install-lib.cjs` — side-effect free apart from two read-only helpers (`verifyInstall()`, `dirDigest()`) that read the filesystem; fully testable
- **Runtime-agnostic** commands and agents — no PAN-specific hardcoding in shipped content
- **Path normalization** via `toPosix()` — cross-platform path handling
- **Manifest-based tracking** — `pan-file-manifest.json` tracks all installed files
