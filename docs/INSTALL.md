# Installing PAN Wizard

Everything about getting PAN into a project, keeping it current, and taking it out again. For the workflow itself, see the [User Guide](USER-GUIDE.md).

## Interactive install

```bash
npx pan-wizard@latest
```

The installer prompts you to choose the **runtime**: Claude Code, OpenCode, Gemini, Codex, Copilot CLI, or all. Location is not prompted: it defaults to the current project (`--local`). To install into your home config directory instead, pass `--global` with a runtime flag, such as `--claude --global`. `--global` alone skips the runtime prompt and installs Claude Code.

Verify with:

| Runtime | Command |
|---|---|
| Claude Code, Gemini CLI | `/pan:help` |
| OpenCode, Copilot CLI | `/pan-help` |
| Codex | `$pan-help` |

> [!NOTE]
> Codex and Copilot CLI installations use skills rather than custom prompts. Codex uses the shared `.agents/skills/pan-*/SKILL.md` tree; Copilot CLI uses `skills/pan-*/SKILL.md` under `.github` (local) or `~/.copilot` (global).

## Non-interactive install (Docker, CI, scripts)

```bash
# Claude Code
npx pan-wizard --claude --global   # Install to ~/.claude/
npx pan-wizard --claude --local    # Install to ./.claude/

# OpenCode
npx pan-wizard --opencode --global # Install to ~/.config/opencode/

# Gemini CLI (see the note below)
npx pan-wizard --gemini --global   # Install to ~/.gemini/

# Codex (skills-first)
npx pan-wizard --codex --global    # Skills to ~/.agents/skills/, core, agents and hooks to ~/.codex/
npx pan-wizard --codex --local     # Skills to ./.agents/skills/, core, agents and hooks to ./.codex/

# GitHub Copilot CLI (skills-first)
npx pan-wizard --copilot --global  # Install to ~/.copilot/
npx pan-wizard --copilot --local   # Install to ./.github/

# All runtimes
npx pan-wizard --all --global      # Install to all directories
```

Use `--global` (`-g`) to install into your home config directory; `--local` (`-l`) is the default and may be omitted, except with `--uninstall`, which needs `--global` or `--local`. Use `--claude`, `--opencode`, `--gemini`, `--codex`, `--copilot`, or `--all` to skip the runtime prompt.

### What a local install writes outside the runtime directory

- a marker-fenced PAN section in the project's `AGENTS.md`, with a short table of which PAN command a plain request belongs to (`instructions.routing`);
- for Gemini CLI, `AGENTS.md` added to `context.fileName` in `.gemini/settings.json` so Gemini loads it;
- for Claude Code, a marker-fenced block in `CLAUDE.md` (the `@AGENTS.md` import, and compact instructions that keep PAN's position through compaction) and a `pan` MCP server in `.mcp.json`;
- for Codex or `--unified-skills`, the shared `.agents/` tree (skills, plus a shared core under `--unified-skills`);
- a `<runtime dir>/pan-local-patches/` line in `.gitignore` under a `# PAN Wizard` comment, so the update backups are never committed (a missing `.gitignore` is created only in a git repository).

An update rewrites those blocks only while they hold PAN's own text: once your project edits one, PAN keeps your version and says so. `--uninstall` removes them (the `AGENTS.md` and `CLAUDE.md` blocks and the `.agents/` tree stay while another PAN runtime in the project still uses them).

### One shared skills tree (`--unified-skills`)

Add `--unified-skills` to install commands as one shared `.agents/skills/` tree instead of per-runtime formats. Codex, Gemini CLI, OpenCode, Copilot CLI and Antigravity CLI read that tree; Claude Code does not, so for Claude the installer also copies each skill into `.claude/skills/` and the commands become `/pan-<name>`. Gemini CLI gives skills no slash command, so on a unified Gemini install you ask for the task and `/skills list` shows what loaded.

> **Gemini CLI note:** from June 18, 2026, Google's Gemini CLI serves Gemini Code Assist (Standard/Enterprise) customers; individual free / AI Pro / Ultra accounts are directed to Antigravity CLI instead. PAN's `--gemini` target installs for Gemini CLI. Antigravity CLI is not yet a PAN install target, but it reads the shared `.agents/skills/` tree natively — install with `--unified-skills` and PAN's commands are usable from Antigravity in the same project.

### Commands only you can start (`--user-invoked-only`)

On Claude Code the model may start any PAN command. To keep some for yourself, name them: `--user-invoked-only health,update` marks `/pan:health` and `/pan:update` (or `/pan-health` and `/pan-update` after `--unified-skills`) `disable-model-invocation: true`, so they run only when you type them. A local install also reads `claude.user_invoked_only` from the project's `.planning/config.json` on every reinstall and `/pan:update`; a global install uses the flag only. The installer records the flag's names, so an update keeps them without the flag; `--user-invoked-only none` clears them. Other runtimes ignore it.

### See what an install would change (`--dry-run`)

Add `--dry-run` to a local install or uninstall to list the files it would add, change or delete, without writing anything:

```bash
npx pan-wizard --claude --local --dry-run
npx pan-wizard --all --local --dry-run --json
npx pan-wizard --claude --local --uninstall --dry-run
```

The installer runs the real install in a temporary copy of the paths it can touch (the runtime directories, `.agents/`, `.mcp.json`, `AGENTS.md`, `CLAUDE.md`, `.gitignore` and `.planning/config.json`) and compares the result with your project, so the list is what a real run writes. On a reinstall, `pan-file-manifest.json` shows as changed because it records when it was written. `--json` prints `added`, `changed`, `deleted`, `outside_project` and `exit_code`. A dry run of a `--global` or `--config-dir` install is refused.

### Docker and containers

If Claude Code in the container reads its config from somewhere other than the installing user's `~/.claude`, set `CLAUDE_CONFIG_DIR` to that directory before installing (`--global --config-dir <path>` does the same):

```bash
CLAUDE_CONFIG_DIR=/home/youruser/.claude npx pan-wizard --global
```

PAN then installs into that directory and writes its absolute path into the installed commands, agents and hook commands. A global install writes absolute paths whether or not the variable is set.

## Staying updated

Run `/pan:update`. It reads from the install's own path whether it is local or global and which runtime it belongs to, and reinstalls that runtime. For an install made with `--config-dir` or `--unified-skills`, which it cannot tell from the path, re-run the installer yourself with the flags you installed with (add `--global` for a global install, since the installer defaults to the current project):

```bash
npx pan-wizard@latest
```

## Permissions

PAN is designed for unattended runs. On Claude Code the smoothest way is:

```bash
claude --dangerously-skip-permissions
```

Stopping to approve `date` and `git commit` dozens of times a phase defeats the purpose. If you prefer not to use that flag, allow the commands PAN runs in your project's `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(date:*)",
      "Bash(echo:*)",
      "Bash(cat:*)",
      "Bash(ls:*)",
      "Bash(mkdir:*)",
      "Bash(wc:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(sort:*)",
      "Bash(grep:*)",
      "Bash(tr:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git tag:*)"
    ]
  }
}
```

## Protecting sensitive files

PAN's codebase mapping and analysis commands read files to understand your project. Protect files that hold secrets by adding them to Claude Code's deny list (`.claude/settings.json`, or the global one):

```json
{
  "permissions": {
    "deny": [
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/secrets/*)",
      "Read(**/*credential*)",
      "Read(**/*.pem)",
      "Read(**/*.key)"
    ]
  }
}
```

This stops Claude reading those files whatever command runs.

> [!IMPORTANT]
> PAN includes built-in protections against committing secrets, but defense in depth is best practice. Deny read access to sensitive files as a first line of defense.

## Commands not found after install?

- Restart your runtime to reload commands and skills.
- Check the files are where the runtime looks:

| Runtime | Global | Local |
|---|---|---|
| Claude Code | `~/.claude/commands/pan/` | `./.claude/commands/pan/` (after `--unified-skills`: `.claude/skills/pan-*/SKILL.md`) |
| Codex | `~/.agents/skills/pan-*/SKILL.md` | `./.agents/skills/pan-*/SKILL.md` |
| Copilot CLI | `~/.copilot/skills/pan-*/SKILL.md` | `./.github/skills/pan-*/SKILL.md` |
| OpenCode | `~/.config/opencode/commands/pan-*.md` | `./.opencode/commands/pan-*.md` |
| Gemini CLI | `~/.gemini/commands/pan/*.toml` | `./.gemini/commands/pan/*.toml` |

After a `--unified-skills` install, the runtimes other than Claude Code read `./.agents/skills/pan-*/SKILL.md` (`~/.agents/skills/` after `--global`).

Still not working? Run the help command for your runtime (table above; `/pan-help` on a unified Claude install too), and re-run `npx pan-wizard` with the flags you installed with (the runtime, `--global`/`--local`, and any `--config-dir` or `--unified-skills`). [Troubleshooting](TROUBLESHOOTING.md) goes deeper.

## Uninstalling

```bash
# Global installs
npx pan-wizard --claude --global --uninstall
npx pan-wizard --opencode --global --uninstall
npx pan-wizard --gemini --global --uninstall
npx pan-wizard --codex --global --uninstall
npx pan-wizard --copilot --global --uninstall

# Local installs (current project)
npx pan-wizard --claude --local --uninstall
npx pan-wizard --opencode --local --uninstall
npx pan-wizard --gemini --local --uninstall
npx pan-wizard --codex --local --uninstall
npx pan-wizard --copilot --local --uninstall
```

This removes PAN's commands, agents, hooks and settings and keeps your other configuration.

## Development install

Clone the repository, then run the installer from a **separate** project directory. The installer refuses to install into its own source repository (a `PAN_SOURCE_ROOT` guard exits with an error), so point it at a different target:

```bash
# 1. Get the source and build the hooks (hooks/dist/ is build output a clone lacks;
#    the installer copies the hooks from there)
git clone https://github.com/oharms/PanWizard.git
cd PanWizard && npm run build:hooks

# 2. Install into a DIFFERENT project directory (never the PanWizard source dir)
cd /path/to/some-test-project
node /path/to/PanWizard/bin/install.js --claude --local
```

Run the test suite from inside the cloned source repository:

```bash
cd /path/to/PanWizard
npm test                # Unit tests
npm run test:scenarios  # Scenario tests
npm run test:all        # All tests (unit + scenario)
```

See the [Development Guide](DEVELOPMENT.md) for the rest.

## Experimental: ZCode (preview)

**PAN-Z** is an experimental, separate subsystem that brings the PAN workflow to [ZCode](https://zcode.z.ai), z.ai's GLM coding-agent harness. ZCode has no slash commands or hooks to host PAN directly, so PAN-Z exposes PAN's engine to ZCode over **MCP**: PAN's agents become ZCode subagents, and the deterministic engine, including a human merge gate the model cannot pass, is reached as MCP tools.

> **ZCode is beta**, and its on-disk formats change often. PAN-Z is a **preview**: two facts (whether a subagent can call MCP tools, and whether local MCP calls are metered) can only be confirmed on a live ZCode install. See [`pan-zcode/README.md`](../pan-zcode/README.md) and [`pan-zcode/KNOWN-BETA-RISKS.md`](../pan-zcode/KNOWN-BETA-RISKS.md).

```bash
# From an installed pan-wizard package, build the ZCode bundle into a target dir
node "$(npm root -g)/pan-wizard/pan-zcode/bin/install-zcode.js" --target ./zcode-bundle
# then finish setup inside ZCode per the generated INSTALL-ZCODE.md
```
