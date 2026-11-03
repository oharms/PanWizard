<div align="center">

<img src="https://cdn.jsdelivr.net/npm/pan-wizard@latest/assets/pan-readme-hero.png" alt="PanWizard — context engineering that makes AI coding reliable" width="820" />

# PAN Wizard

**Spec-driven development for AI coding agents.** PAN turns an idea into a roadmap, each phase into small checked plans, and each plan into committed, verified code, with every step run by a specialist agent in a fresh context window.

Claude Code · Codex · Gemini CLI · OpenCode · Copilot CLI

[![npm version](https://img.shields.io/npm/v/pan-wizard?style=for-the-badge&color=FF5A3C&labelColor=211E18)](https://www.npmjs.com/package/pan-wizard)
[![npm downloads](https://img.shields.io/npm/dm/pan-wizard?style=for-the-badge&color=5B4BE6&labelColor=211E18)](https://www.npmjs.com/package/pan-wizard)
[![License](https://img.shields.io/badge/license-MIT-1E8E5A?style=for-the-badge&labelColor=211E18)](LICENSE)

```bash
npx pan-wizard@latest
```

Mac, Windows and Linux · zero runtime dependencies · MIT

[Quick start](#quick-start) · [How it works](#how-it-works) · [Why it holds up](#why-it-holds-up) · [User Guide](docs/USER-GUIDE.md) · [Install guide](docs/INSTALL.md)

</div>

---

## The problem

An AI coding agent does its best work early in a session. As the context window fills with file dumps, failed attempts and old decisions, quality slips: it forgets what was agreed, re-argues settled choices, and declares things done that are not. That is **context rot**, and a long task cannot avoid it in a single session.

PAN keeps every piece of work small enough to finish in a fresh context, writes everything that has to survive to files in `.planning/`, and checks the result against what was promised before it moves on.

## Quick start

```bash
npx pan-wizard@latest        # pick your runtime; installs into the current project
```

Then, inside your coding agent:

```text
/pan:new-project             # questions → requirements → roadmap
/pan:plan-phase 1            # small plans, checked against the requirements
/pan:exec-phase 1            # build in waves, one commit per task, then verify
/pan:progress                # where am I, what is next
```

Already have code? Run `/pan:map-codebase` first, so planning knows your stack and conventions. For a one-off fix or small feature, `/pan:quick` gives you the same agents and atomic commits without the full ceremony.

On Codex the commands start with `$pan-`, and on OpenCode and Copilot CLI with `/pan-`. See the [install guide](docs/INSTALL.md) for flags, CI installs, permissions and uninstalling.

## How it works

```text
new-project ─▶ discuss ─▶ plan ─▶ execute ─▶ verify ─▶ next phase … ─▶ milestone done
```

| Step | Command | What happens | Leaves behind |
|---|---|---|---|
| **Define** | `/pan:new-project` | Asks until it understands the idea, scopes v1 and v2, and maps requirements to phases. You approve the roadmap | `project.md`, `requirements.md`, `roadmap.md`, `state.md` |
| **Discuss** *(optional)* | `/pan:discuss-phase N` | Settles the gray areas of a phase (layout, error handling, flags, tone) before anything is planned | `context.md` |
| **Plan** | `/pan:plan-phase N` | Writes plans of two or three tasks each, and a checker tests them against the requirements, with a revision when it finds gaps | `N-M-plan.md` |
| **Execute** | `/pan:exec-phase N` | Runs independent plans in parallel waves, each in a fresh context, one atomic commit per task; reviews and verifies the phase against its goals | code, `summary.md`, `verification.md` |
| **Verify** | `/pan:verify-phase N` | Re-checks the phase against what it promised, gated on your test suite; `--uat` walks you through acceptance tests | gaps → `/pan:plan-phase N --gaps` |

Repeat per phase, then `/pan:milestone-done` archives the milestone and tags it, and `/pan:milestone-new` starts the next. `/pan:autodev` runs the roadmap unattended and stops in code on a failed gate, a budget, or anything that needs you.

## Why it holds up

- **Fresh context for every unit of work.** The orchestrating session only routes; planners, executors and verifiers each start clean, so your main session stays small however much code is written.
- **State lives in files, not in the chat.** Decisions, position and blockers are in `.planning/`. Close the terminal, come back next week, run `/pan:resume`.
- **A crash costs one task, not a plan.** Each task commit records which step it finished, so an interrupted plan resumes after its last committed task, even if the session that ran it is gone.
- **Checked before and after.** Plans are checked against requirements before any code is written; afterwards the verifier checks the codebase against the phase's goals, and `phase complete` refuses a phase with a failing test run, a missing verification or an open high-severity finding.
- **Decisions travel with the work.** Plans carry what is locked and what was rejected; summaries carry why the executor deviated. The next agent reads the reasoning, not only the output.
- **Questions survive sessions.** When PAN stops to ask you something, the question is written down, and the next session asks it again instead of losing it.
- **Safe when commands overlap.** Planning files are written under locks with atomic replaces, so two commands running at once do not lose each other's writes.
- **Tested the way you use it.** PAN's own behaviour is checked by scenarios that install the packed package into a fresh project and drive it, including runs with a live model.

## Runtimes

| Runtime | Install flag | Commands | Notes |
|---|---|---|---|
| Claude Code | `--claude` | `/pan:help` | Native subagents, native workflows, hooks and an MCP server |
| Codex | `--codex` | `$pan-help` | Skills in `.agents/skills/` |
| Gemini CLI | `--gemini` | `/pan:help` | Antigravity CLI reads PAN through `--unified-skills` |
| OpenCode | `--opencode` | `/pan-help` | A plugin keeps PAN's position through compaction |
| Copilot CLI | `--copilot` | `/pan-help` | Skills in `.github/skills/` |

The planning pipeline is the same markdown on all five. Claude-only features are extras, never requirements.

## Bot army (Claude Code)

`/pan:army "<goal>"` runs a whole goal rather than one phase. A Mission Control agent plans the campaign and delegates to architecture, build, quality and release squads; builders work in their own git worktrees, and the release squad stops for your approval instead of merging. Pair it with branch protection so that approval is something your repository enforces. `/pan:hud` renders the campaign as a single HTML page. Details are in the [User Guide](docs/USER-GUIDE.md#bot-army-campaigns-panarmy).

<div align="center">
<img src="https://cdn.jsdelivr.net/npm/pan-wizard@latest/assets/terminal.svg" alt="A PAN bot-army run: Mission Control delegating to squads, builders in isolated worktrees, a human-gated merge" width="760" />
</div>

## Cost and control

- **`/pan:cost`** shows token use and estimated spend per command and phase; each phase warns as it nears its budget (`cost.phase_budget_usd`).
- **`/pan:settings`** switches the model profile (`quality`, `balanced`, `budget`) and turns research, plan checking and verification on or off.
- **`/pan:preview phase N`** forecasts a phase's cost from your project's own history before you run it.

## Documentation

| Read this | For |
|---|---|
| [User Guide](docs/USER-GUIDE.md) | Every command, the full config reference, workflow diagrams |
| [Install guide](docs/INSTALL.md) | Flags, CI and Docker installs, permissions, uninstalling |
| [FAQ](docs/FAQ.md) | Cost, runtimes, customization |
| [Examples](docs/EXAMPLES.md) | Worked runs from new project to release |
| [Comparison](docs/COMPARISON.md) | PAN against other AI coding tools |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Execution, state, git and verification problems |
| [Architecture](docs/ARCHITECTURE.md) · [Agents](docs/AGENTS.md) · [CLI Reference](docs/CLI-REFERENCE.md) | How PAN is built |
| [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Attribution](ATTRIBUTION.md) | Taking part, release history, where ideas came from |

## License

MIT. See [LICENSE](LICENSE). Brand palette and art prompts are in [`docs/branding/image-prompts.md`](docs/branding/image-prompts.md).
