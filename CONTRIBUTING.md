# Contributing to PAN Wizard

Thank you for your interest in contributing to PAN Wizard!

## How to Contribute

### Reporting Bugs

1. Check existing issues first
2. Provide clear reproduction steps
3. Include: OS, runtime (Claude Code/OpenCode/Gemini/Codex/Copilot CLI), PAN version
4. Share relevant logs or error messages

### Suggesting Enhancements

1. Check if enhancement already requested
2. Explain the problem it solves
3. Describe proposed solution
4. Consider impact on existing workflows

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Add tests if applicable
5. Update documentation
6. Run the whole suite: `npm run test:all` (and `npm run release:check` before a release PR)
7. Commit with clear messages
8. Push and create PR

## Development Setup

```bash
git clone https://github.com/oharms/PanWizard.git
cd PanWizard
npm install
npm test
```

### Local Install for Testing

Install PAN from your local clone to test changes. The installer refuses to
run inside its own source repo (`PAN_SOURCE_ROOT` guard), so run it from a
**separate** directory and point it at your clone:

```bash
cd <some-test-dir>                                     # NOT the clone root
node <path-to-clone>/bin/install.js --claude --local   # Install to ./.claude/
node <path-to-clone>/bin/install.js --claude --global  # Install to ~/.claude/
```

### Building Hooks

PAN's hooks are pure Node.js with zero dependencies, so `build:hooks` simply
copies the hooks listed in `HOOKS_TO_COPY` (`scripts/build-hooks.js`) to `hooks/dist/` — there is no bundler or compile step.
After modifying `hooks/`:

```bash
npm run build:hooks
```

Output goes to `hooks/dist/`.

## Project Structure

```text
PanWizard/
  bin/                  # Installer entry point (install.js)
  commands/pan/         # command .md files (Claude Code format)
  agents/               # agent .md files
  pan-zcode/            # Experimental: ZCode subsystem (MCP bridge; ZCode is beta)
  pan-wizard-core/      # Core library
    bin/lib/            # CJS modules (config, state, init, verify, etc.)
    bin/pan-tools.cjs   # CLI tool for commands/agents to call
    mcp/                # MCP bridge — zero-dep stdio server exposing pan-tools to MCP clients
    workflows/          # Workflow orchestration .md files
    references/         # Reference docs loaded by agents
    templates/          # File templates (config.json, plans, etc.)
  hooks/
    pan-*.js            # Hook source files
    dist/               # Built hooks (copied output)
  scripts/              # Build, release-gate and test-runner scripts
  harness/              # Behavioural harness against packed installs (dev only: npm run harness)
  marketplace/          # Local Claude plugin marketplace for the dev loop (not shipped)
  tests/                # Test suite (node:test + node:assert)
  docs/                 # User-facing documentation
  assets/               # README images and logos (hero PNGs, terminal SVG, avatar)
```

### Key Files

| File | Purpose |
|------|---------|
| `bin/install.js` | Main installer — detects runtime, copies files |
| `pan-wizard-core/bin/pan-tools.cjs` | CLI bridge — commands/agents call this for state, config, commits |
| `pan-wizard-core/bin/lib/config.cjs` | Config loading, dot-notation get/set |
| `pan-wizard-core/bin/lib/state.cjs` | State management (load, save, phase tracking) |
| `pan-wizard-core/bin/lib/init.cjs` | Phase initialization (loads context for agents) |
| `pan-wizard-core/bin/lib/verify.cjs` | Plan verification utilities |

## Testing

```bash
# Unit tests
npm test

# Scenario tests (installer + integration + workflow), then everything together
npm run test:scenarios
npm run test:all

# Run specific test file
node --test tests/phase.test.cjs

# The runner npm test uses (cross-platform; a tests/*.test.cjs glob only expands on bash or Node 22+)
node scripts/run-tests.cjs tests
```

Tests use `node:test` and `node:assert` (no external test framework). All modules are CommonJS (`.cjs`).

### Cross-Platform Considerations

- Use `toPosix()` from `pan-wizard-core/bin/lib/core.cjs` for file paths (Windows backslashes break comparisons)
- Use file-based input for shell commands containing `$` signs (avoids shell expansion)
- Test on both Windows and macOS/Linux when touching path-related code

## Code Style

- CommonJS modules (`.cjs` extension, `require()`/`module.exports`)
- Zero runtime dependencies — only `node:` built-in modules
- Meaningful variable names
- Comments for complex logic only
- Follow existing patterns in the codebase

## Writing Commands

Commands live in `commands/pan/`. Each is a Markdown file that becomes a slash command (`/pan:filename`).

Commands should:
- Be thin orchestrators (spawn agents for heavy work)
- Read state via `pan-tools.cjs` CLI
- Handle errors gracefully with user-facing messages

## Writing Agents

Agents live in `agents/`. Each is a Markdown file with XML-structured instructions.

Agents should:
- Have a single, focused responsibility
- Read only the context they need (project.md, plan.md, etc.)
- Write structured output (summary.md, verification.md, etc.)
- Never modify state directly — return results to the orchestrator

## Documentation

- Update README.md for user-facing feature changes
- Update docs/USER-GUIDE.md for detailed configuration or workflow changes
- Update CHANGELOG.md for all notable changes, under `## [Unreleased]` — the release commit turns that heading into the version
- Never embed filesystem-derived counts (commands, agents, tests, modules, …) anywhere but `CLAUDE.md`; release Gate 4 (`doc-lint counts`) fails on them — write "all shipped commands", not a number
- Keep docs/context-monitor.md current if hooks change

## Further Reading

- [Architecture Guide](docs/ARCHITECTURE.md) — 5-layer system design, data flow, module dependency graph
- [Development Guide](docs/DEVELOPMENT.md) — Detailed setup, how-to guides, cross-platform pitfalls
- [Agent System](docs/AGENTS.md) — Agent inventory, lifecycle, model profiles
- [FAQ](docs/FAQ.md) — Common questions and answers
- [Internals](docs/INTERNALS.md) — Checkpoint system, TDD, verification patterns, model profiles
- [Troubleshooting](docs/TROUBLESHOOTING.md) — Deep-dive diagnostics and recovery procedures
