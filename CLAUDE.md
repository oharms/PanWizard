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
  hooks: ls('hooks/dist', /\.js$/),
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
| Commands (`commands/pan/*.md`) | 58 |
| Agents (`agents/*.md`) | 22 |
| Core modules (`pan-wizard-core/bin/lib/*.cjs`) | 47 |
| Workflows (`pan-wizard-core/workflows/*.md`) | 33 |
| Templates (`pan-wizard-core/templates/*.md`) | 41 |
| References (`pan-wizard-core/references/*.md`) | 15 |
| Unit test files (`tests/*.test.cjs`) | 90 |
| Scenario test files (`tests/scenarios/*.test.cjs`) | 35 |
| Total tests (npm run test:all) | 3235 |
| Total test suites | 691 |
| Hooks (`hooks/*.js`) | 5 |
| Specs (`docs/specs/*.md`) | 44 |
| ADRs (`docs/decisions/ADR-*.md`) | 39 |

These are reflective of `main` at v3.18.0. They drift; refresh via the snippet above when needed. **Never propagate them to another doc.**

---

## CRITICAL: Never install PAN into the source repository

**This is the PAN Wizard source code repository.** Do NOT install PAN into this directory.

- NEVER run `node bin/install.js` from `d:/PanWizard/` (or wherever this repo is cloned)
- NEVER create `.claude/pan-wizard-core/`, `.claude/pan-file-manifest.json`, or `.claude/package.json` in this repo
- NEVER copy source files into `.codex/`, `.gemini/`, or `.opencode/` within this repo
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
- `bin/install-lib.cjs` — Pure functions for installer (side-effect free)
- `pan-wizard-core/bin/pan-tools.cjs` — CLI dispatcher
- `pan-wizard-core/bin/lib/*.cjs` — Core CJS modules
- `pan-wizard-core/workflows/*.md` — Multi-step workflow definitions
- `pan-wizard-core/templates/*.md` — Scaffolding templates
- `pan-wizard-core/references/*.md` — Agent-loaded reference docs
- `commands/pan/*.md` — Command definitions (copied by installer)
- `agents/*.md` — Agent definitions (copied by installer)
- `hooks/*.js` — Hooks (source, built → `hooks/dist/`)
- `pan-zcode/*` — **Experimental (preview):** ZCode-native subsystem. A zero-dep MCP bridge (`pan-zcode/mcp/`) wraps `pan-tools` for z.ai's ZCode harness (beta); its own installer (`pan-zcode/bin/install-zcode.js`) is separate from `bin/install.js` and is NOT a 6th runtime of the main installer. See `pan-zcode/README.md`.

### Tests

- `tests/*.test.cjs` — Unit test files
- `tests/scenarios/*.test.cjs` — Scenario test files (installer + integration + workflow)

### Documentation

- `docs/*.md` — User and developer docs (USER-GUIDE, ARCHITECTURE, CLI-REFERENCE, etc.)
- `docs/decisions/ADR-*.md` — Architecture Decision Records
- `docs/specs/*.md` — Feature specs

### Development tools (not shipped — for PAN development only)

- `.claude/commands/*.md` — Dev commands (`/build`, `/test`, `/check`, `/pandev`, etc.)
- `.claude/agents/*.md` — Dev agents (dev-orchestrator, dev-workflow)
- `.claude/workflows/*.md` — Workflow protocols
- `.claude/settings.json` — Claude Code permissions
- `scripts/build-hooks.js` — hook copy script (`hooks/*.js` → `hooks/dist/`; copy-only, no bundler)

### Key design patterns

- **CommonJS (.cjs)** for all core modules — required for Claude Code compatibility
- **Pure functions** in `install-lib.cjs` — no side effects, fully testable
- **Runtime-agnostic** commands and agents — no PAN-specific hardcoding in shipped content
- **Path normalization** via `toPosix()` — cross-platform path handling
- **Manifest-based tracking** — `pan-file-manifest.json` tracks all installed files
