<div align="center">

<img src="https://cdn.jsdelivr.net/npm/pan-wizard@latest/assets/pan-banner.svg" alt="PanWizard — context engineering that makes AI coding reliable · npx pan-wizard@latest" width="860" />

### Build whole features with AI coding agents, without the quality falling apart halfway.

PAN splits the work into small plans, runs each one in a fresh context,<br>writes down everything that has to survive, and checks the result before it moves on.

[![npm version](https://img.shields.io/npm/v/pan-wizard?style=for-the-badge&color=FF5A3C&labelColor=211E18)](https://www.npmjs.com/package/pan-wizard)
[![npm downloads](https://img.shields.io/npm/dm/pan-wizard?style=for-the-badge&color=5B4BE6&labelColor=211E18)](https://www.npmjs.com/package/pan-wizard)
[![License](https://img.shields.io/badge/license-MIT-1E8E5A?style=for-the-badge&labelColor=211E18)](LICENSE)

```bash
npx pan-wizard@latest
```

**Claude Code · Codex · Gemini CLI · OpenCode · Copilot CLI** &nbsp;—&nbsp; Mac, Windows, Linux · zero dependencies

**New in 3.45:** [let a model on your own machine write the code](#new-your-own-machine-writes-the-code) while Claude plans, reviews and commits.

<br>

<img src="https://cdn.jsdelivr.net/npm/pan-wizard@latest/assets/pan-session.svg" alt="An illustrative PAN session: phase 2 runs in two waves, is reviewed, verified against its goals and the test suite, and gated complete" width="860" />

</div>

<br>

## Why PAN

A coding agent is sharp at the start of a session and sloppy by the end of it. The context window fills with file dumps, dead ends and stale decisions; it forgets what you agreed, re-argues settled choices, and calls things done that are not. On a feature bigger than one sitting, that is not a risk, it is a certainty.

PAN's answer is structural rather than clever prompting: **no unit of work is allowed to get big enough to rot.**

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/pan-wizard@latest/assets/pan-flow.svg" alt="PAN's flow: define, discuss, plan, execute and verify, each in a fresh context, with state kept in .planning/" width="860" />
</p>

## Quick start

```bash
npx pan-wizard@latest     # choose your runtime; installs into this project
```

```text
/pan:new-project          # it asks, you answer: requirements and a roadmap come out
/pan:plan-phase 1         # small plans, checked against the requirements
/pan:exec-phase 1         # built in parallel waves, reviewed, verified
/pan:progress             # where you are and what comes next
```

- **Existing codebase?** Run `/pan:map-codebase` first, and planning will follow your stack and conventions.
- **Just a fix?** `/pan:quick "add a dark-mode toggle"` keeps the agents and atomic commits and skips the ceremony.
- **Walking away?** `/pan:autodev` runs the roadmap unattended and stops on a failed gate, a budget, or anything that needs you.

Codex uses `$pan-…`, OpenCode and Copilot CLI use `/pan-…`. The [install guide](docs/INSTALL.md) covers flags, CI installs, permissions and uninstalling.

## New: your own machine writes the code

Run `/pan:local` once and PAN hands the typing to a model on your own hardware: Qwen, Llama or anything else served by Ollama, LM Studio, llama.cpp or vLLM. Claude stays the engineer. It writes a spec for each task, reviews what comes back, re-runs the tests itself and commits, or sends the task back with fix notes, or takes it over.

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/pan-wizard@latest/assets/pan-local.svg" alt="Local offload: Claude plans each task, a model on your machine writes the code with five confined tools, Claude reviews, re-runs the tests and commits with a measured label of who wrote each line" width="860" />
</p>

```text
/pan:local                # finds your local models, picks the best coding one, turns it on
/pan:quick "add CSV export"   # Claude specs it, your model writes it, Claude checks and commits
```

- **Confined, not trusted.** The local model gets five tools and no shell. It writes only the files named for its task and runs only that task's test command; `.git`, secrets and PAN's own files are out of reach, and an endpoint off your machine is refused unless you allow it.
- **Kept where it matters.** Authentication, payments, cryptography, secrets and security fixes are never handed off.
- **Measured, not claimed.** Every run is recorded in `.planning/delegations/`, and each commit says how many of its lines came verbatim from the local model: `PAN-Delegated: qwen-coder (31/31 added lines from the local model)`.
- **Falls back on its own.** Server down, a failing model, or too many failed rounds: Claude finishes the task and says so.

Before release it was run end to end on real projects (JavaScript and Python, single tasks, planned multi-task work, a full phase, edits to existing files, security work, a down and a failing server, and a hostile fake model). A recording proxy that PAN did not know about kept every byte the local model sent, and each commit's label was recounted from it independently: they matched in every scenario. Off by default; nothing changes until you turn it on. [How it works](docs/USER-GUIDE.md#local-executor-offload) · [Design decision](docs/decisions/ADR-0053-local-executor-offload.md)

## What you get

<table>
<tr>
<td width="50%" valign="top">

**🧠 Fresh context for every unit of work**<br>
The session you talk to only routes. Planners, executors and verifiers each start clean, so your own context stays small no matter how much code gets written.

</td>
<td width="50%" valign="top">

**📁 State in files, not in the chat**<br>
Decisions, position and blockers live in `.planning/`. Close the terminal on Friday, run `/pan:resume` on Monday.

</td>
</tr>
<tr>
<td valign="top">

**✅ Checked before and after**<br>
Plans are checked against requirements before any code is written. Afterwards the phase is verified against its goals, and it will not close on a failing test run or an open high-severity finding.

</td>
<td valign="top">

**🔁 A crash costs one task, not a plan**<br>
Every task is its own commit, and each commit records the step it finished. An interrupted plan resumes after its last commit, even when the session that ran it is gone.

</td>
</tr>
<tr>
<td valign="top">

**🧭 Decisions travel with the work**<br>
Plans carry what is locked and what was rejected; summaries carry why the code deviated. The next agent inherits the reasoning, not only the output.

</td>
<td valign="top">

**⏸️ Questions survive the session**<br>
When PAN needs you, the question is written down. If the session ends first, the next one asks it again instead of guessing.

</td>
</tr>
<tr>
<td valign="top">

**💰 Cost you can see**<br>
`/pan:cost` shows spend by command and phase, phases warn near their budget, and `/pan:preview` forecasts a phase from your project's own history.

</td>
<td valign="top">

**🧪 Tested the way you use it**<br>
PAN's own behaviour is checked by scenarios that install the packed package into a fresh project and drive it, including runs with a live model.

</td>
</tr>
</table>

## One workflow, five tools

| | Install | Help | Extras |
|---|---|---|---|
| **Claude Code** | `--claude` | `/pan:help` | native subagents, workflows, hooks, MCP server, bot army |
| **Codex** | `--codex` | `$pan-help` | skills in `.agents/skills/` |
| **Gemini CLI** | `--gemini` | `/pan:help` | Antigravity CLI via `--unified-skills` |
| **OpenCode** | `--opencode` | `/pan-help` | plugin keeps PAN's place through compaction |
| **Copilot CLI** | `--copilot` | `/pan-help` | skills in `.github/skills/` |

The planning pipeline is the same markdown everywhere. Tool-specific features are extras, never requirements.

## Bot army

On Claude Code, `/pan:army "<goal>"` takes a whole goal instead of one phase. A Mission Control agent plans the campaign and hands it to architecture, build, quality and release squads; builders each work in their own git worktree, and the release squad **stops for your approval instead of merging**. Pair it with branch protection so that approval is enforced by your repository, and watch it with `/pan:hud`. [More in the User Guide](docs/USER-GUIDE.md#bot-army-campaigns-panarmy).

## Learn more

**[User Guide](docs/USER-GUIDE.md)** — every command and setting &nbsp;·&nbsp; **[Install](docs/INSTALL.md)** &nbsp;·&nbsp; **[FAQ](docs/FAQ.md)** &nbsp;·&nbsp; **[Examples](docs/EXAMPLES.md)** &nbsp;·&nbsp; **[Comparison](docs/COMPARISON.md)** &nbsp;·&nbsp; **[Troubleshooting](docs/TROUBLESHOOTING.md)**

Building on PAN: [Architecture](docs/ARCHITECTURE.md) · [Agents](docs/AGENTS.md) · [CLI Reference](docs/CLI-REFERENCE.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Attribution](ATTRIBUTION.md)

<br>

<div align="center">

MIT licensed · brand palette and art prompts in [`docs/branding/image-prompts.md`](docs/branding/image-prompts.md)

**Your coding agent is powerful. PAN makes it reliable.**

</div>
