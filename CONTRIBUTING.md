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
6. Run test suite: `npm test`
7. Commit with clear messages
8. Push and create PR

## Development Setup

```bash
git clone https://github.com/oharms/PanWizard.git
cd pan-wizard
npm install
npm test
```

### Local Install for Testing

Install PAN from your local clone to test changes:

```bash
node bin/install.js --claude --local   # Install to ./.claude/
node bin/install.js --claude --global  # Install to ~/.claude/
```

### Building Hooks

PAN's hooks are pure Node.js with zero dependencies, so `build:hooks` simply
copies `hooks/*.js` to `hooks/dist/` — there is no bundler or compile step.
After modifying `hooks/`:

```bash
npm run build:hooks
```

Output goes to `hooks/dist/`.

## Project Structure

```
pan-wizard/
  bin/                  # Installer entry point (install.js)
  commands/pan/         # 38 command .md files (Claude Code format)
  agents/               # 11 agent .md files
  pan-wizard-core/      # Core library
    bin/lib/            # CJS modules (config, state, init, verify, etc.)
    bin/pan-tools.cjs   # CLI tool for commands/agents to call
    workflows/          # Workflow orchestration .md files
    references/         # Reference docs loaded by agents
    templates/          # File templates (config.json, plans, etc.)
  hooks/
    pan-statusline.js   # Hook source files
    pan-context-monitor.js
    pan-check-update.js
    dist/               # Built hooks (copied output)
  scripts/              # Build scripts
  tests/                # Test suite (node:test + node:assert)
  docs/                 # User-facing documentation
  assets/               # SVG terminal recordings
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
# Run all tests
npm test

# Run specific test file
node --test tests/phase.test.cjs

# Run with verbose output
node --test --test-reporter spec tests/*.test.cjs
```

Tests use `node:test` and `node:assert` (no external test framework). All modules are CommonJS (`.cjs`).

### Cross-Platform Considerations

- Use `toPosix()` from helpers for file paths (Windows backslashes break comparisons)
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
- Update CHANGELOG.md for all notable changes
- Keep docs/context-monitor.md current if hooks change

## Further Reading

- [Architecture Guide](docs/ARCHITECTURE.md) — 5-layer system design, data flow, module dependency graph
- [Development Guide](docs/DEVELOPMENT.md) — Detailed setup, how-to guides, cross-platform pitfalls
- [Agent System](docs/AGENTS.md) — Agent inventory, lifecycle, model profiles
- [FAQ](docs/FAQ.md) — Common questions and answers
- [Internals](docs/INTERNALS.md) — Checkpoint system, TDD, verification patterns, model profiles
- [Troubleshooting](docs/TROUBLESHOOTING.md) — Deep-dive diagnostics and recovery procedures
