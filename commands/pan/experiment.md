---
name: experiment
group: Self-Improvement
description: Manage external experiments — scaffold, run, harvest, promote findings back to PAN
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
---

# /pan:experiment — Cross-Project Self-Improvement Loop

> **Self-protection:** This command **scaffolds external project folders OUTSIDE the PAN source repo** to drive autonomous AI coding sessions against fresh ideas, then harvests the resulting telemetry back into `pan-wizard-core/learnings/`. It is a **PAN-development tool**, not a feature for end-users of PAN to invoke on their own projects.

**Spec:** `docs/specs/self_improvement_loop_featureai.md`
**ADR:** ADR-0026 (pending W4)
**Status:** v3.7.0 W1+W2+W3 — scaffolding (`new`/`list`/`manifest`) + external runner (`run`/`status`/`stop`) + harvest (`harvest`/`prune`); W4 adds promote integration with `/pan:learn`.

---

## When to use this

- You have an idea for a small project. You want to know **how PAN drives that build** — what shortcuts the AI takes, where verification fails, which guardrails fire.
- You want the resulting telemetry to **flow back into PAN's shipped artifacts** so the next release is smarter.
- You're testing a behavioral change (new `references/` doc, new workflow rule) by running it against a real, isolated build.

## When NOT to use this

- Building production user features. Use `/pan:new-project` and `/pan:exec-phase` directly.
- Validating a single-file change. The experiment loop is heavy — use `npm test` and `/pan:check`.
- Inside the PAN source repo. The command **refuses** to scaffold experiments inside `d:\PanWizard\` (or wherever the source is cloned). The experiment root defaults to `~/pan-experiments/`.

---

## Subcommands (W1 shipped)

### `/pan:experiment new <slug> --idea <path>`

Scaffold a new experiment folder. Creates:

```
<root>/<slug>/
├── .planning/
│   ├── idea.md              ← copied from --idea path
│   └── experiment.json      ← manifest (slug, runtime, created_at, etc.)
└── .claude/ (or .codex/, .gemini/, .opencode/, .github/)   ← PAN install for chosen runtime
```

**Flags:**

| Flag | Default | Purpose |
|------|---------|---------|
| `--idea <path>` | required | Path to the idea.md doc; copied into the experiment |
| `--runtime <r>` | `claude` | Which AI coding runtime to install: claude / codex / gemini / opencode / copilot |
| `--root <path>` | `~/pan-experiments/` | Override the experiment root directory |
| `--budget <pts>` | `80` | Optional budget cap (saved to manifest, enforced by W2 runner) |
| `--skip-installer` | `false` | Don't run the PAN installer (dev-only) |

**Slug rules:** lowercase letters, digits, hyphens. Max 40 chars. No leading/trailing hyphen.

**Returns:** JSON with `experiment_id`, `path`, `runtime`, `idea_path`, `created_at`. On failure, returns `{ error: "..." }`.

### `/pan:experiment list`

Enumerate all experiments under the root. Returns `{ experiments: [...], count }` sorted newest-first.

**Flags:**

| Flag | Default | Purpose |
|------|---------|---------|
| `--root <path>` | `~/pan-experiments/` | Override the root |
| `--raw` | `false` | Human-readable output instead of JSON |

### `/pan:experiment manifest <slug>`

Read the manifest for a single experiment. Returns the JSON shape written by `new`.

**Flags:**

| Flag | Default | Purpose |
|------|---------|---------|
| `--root <path>` | `~/pan-experiments/` | Override the root |

---

## Subcommands (W2 shipped)

### `/pan:experiment run <slug>`

Spawn the external AI runtime against the experiment folder. **Synchronous** — blocks until the external session exits, hits the timeout, or is stopped.

**Flags:**

| Flag | Default | Purpose |
|------|---------|---------|
| `--timeout <sec>` | `1800` (30 min) | Hard timeout in seconds; runner sends SIGTERM at deadline |
| `--prompt <text>` | `/pan:new-project --auto @.planning/idea.md` | Prompt passed to the external runtime |
| `--root <path>` | `~/pan-experiments/` | Override the experiment root |

**Returns:** `{ status: "done"\|"failed", stop_reason: "success"\|"error"\|"timeout"\|"manual", exit_code, elapsed_ms, started_at, ended_at }`. Run-state is also persisted to `<experiment>/.planning/run-state.json`.

**Runtime support:** claude / codex / gemini / opencode (via `RUNTIME_RUNNERS` adapter map in `runner.cjs`). GitHub Copilot CLI is **unsupported** for the `run` subcommand — no documented headless prompt mode. Copilot users can still scaffold and harvest manually.

**Billing note (Claude runtime):** headless `claude -p` runs bill against the **Claude Agent SDK credit pool** — a monthly allotment separate from your interactive subscription limits (Anthropic split the two effective June 15, 2026). Experiment runs do not consume interactive-session quota, but heavy experimentation can exhaust the SDK pool independently. Captured metrics are tagged `billing_pool: "agent_sdk"` so you can reconcile experiment spend separately.

### `/pan:experiment status <slug>`

Read the current `run-state.json` snapshot. Returns the full state object (`status`, `stop_reason`, `exit_code`, `elapsed_ms`, `events`).

### `/pan:experiment stop <slug>`

Gracefully halt a running experiment. Reads pid from `run-state.json`, sends SIGTERM, writes `status: failed, stop_reason: manual` to the run state. Returns the updated state.

If the experiment has already finished, returns the existing run state without error.

## Subcommands (W3 shipped)

### `/pan:experiment harvest <slug>`

Copy the experiment's telemetry into `<source-repo>/experiments/<slug>/` so it can be analyzed and promoted into shipped artifacts.

**What gets harvested** (skipped silently if absent):

- `.planning/idea.md` — the original idea doc
- `.planning/experiment.json` — scaffold manifest
- `.planning/state.md` — final project state
- `.planning/run-state.json` — runner result (status, exit_code, elapsed_ms)
- `.planning/agent-history.json` — every agent spawn during the build
- `.planning/optimization/` — full trace data (sessions, reports)
- `.planning/phases/` — phases the external session created

A `harvest.json` manifest is written at the destination capturing source path, timestamp, total bytes, and the list of harvested paths.

**Flags:**

| Flag | Default | Purpose |
|------|---------|---------|
| `--root <path>` | `~/pan-experiments/` | Override the experiment root |
| `--source-root <path>` | PAN source repo | Override harvest destination |
| `--force` | `false` | Overwrite an existing harvest at the destination |

**Returns:** `{ experiment_id, harvest_path, harvested_paths: [...], total_bytes, harvested_at, pan_version }`. On conflict without `--force`, returns `{ error }`.

### `/pan:experiment prune <slug>`

Remove the experiment folder after harvest.

**Modes:**

- **Soft** (default): rename to `<root>/<slug>-archived-<ISO-timestamp>` so the data is retained but the slug is freed for reuse
- **Hard** (`--hard` flag): permanently delete

**Flags:**

| Flag | Default | Purpose |
|------|---------|---------|
| `--root <path>` | `~/pan-experiments/` | Override the experiment root |
| `--hard` | `false` | Permanent deletion (irreversible) |

**Returns:** `{ pruned: <slug>, mode: "soft"|"hard", archive_path? }`.

## Subcommands (W4 — coming soon)

| Subcommand | Wave | Purpose |
|------------|------|---------|
| `archive <slug>` | W4 | Alias for `prune` (kept for clarity in scripts) |
| `delete <slug> --confirm` | W4 | Alias for `prune --hard` with confirmation prompt |

W4 also adds:
- `/pan:learn --experiment <slug>` — runs pan-optimizer over harvested data
- `pan-tools learn promote --pattern <id> --scope universal --topic <name>` — extracts a finding into `pan-wizard-core/learnings/{universal,internal}/<topic>.md`
- `pan-tools learn unpromote/list-promoted` — rollback and inventory

---

## CLI mapping (`pan-tools experiment <sub>`)

```bash
pan-tools experiment new <slug> --idea <path> [--runtime r] [--root path] [--budget n]
pan-tools experiment list [--root path] [--raw]
pan-tools experiment manifest <slug> [--root path]
```

Examples:

```bash
# Scaffold a new experiment
echo "# Idea: Build a markdown linter CLI" > my-idea.md
# (fill in problem, success, scope, constraints — see template at pan-wizard-core/templates/idea.md)
pan-tools experiment new md-lint --idea my-idea.md --runtime claude --budget 60

# List all experiments
pan-tools experiment list

# Inspect one
pan-tools experiment manifest md-lint
```

---

## Safety guards

- **Never inside source repo.** `newExperiment` refuses to write to `d:\PanWizard\` (or wherever the PAN source is). Mirrors `bin/install.js` `PAN_SOURCE_ROOT` guard.
- **No clobber.** Refuses to scaffold over an existing experiment folder of the same slug.
- **Slug validation.** Lowercase + digits + hyphens, max 40 chars. Rejects uppercase, spaces, special characters.
- **Idea path validation.** Errors if the `--idea` file doesn't exist.

## Related

- `pan-wizard-core/templates/idea.md` — idea doc template
- `pan-wizard-core/bin/lib/experiment.cjs` — implementation
- `pan-wizard-core/learnings/README.md` — where harvested findings go
- `docs/specs/self_improvement_loop_featureai.md` — full design

## Runtime support

Works in all 5 runtimes (Claude / Codex / Gemini / OpenCode / Copilot). The W2 external runner (subprocess invocation of the external session) supports Claude / Codex / Gemini / OpenCode; GitHub Copilot CLI lacks a headless prompt mode and is opt-out for the `run` subcommand.
