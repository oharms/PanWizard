# PAN Harness

A behavioural test harness for PAN that drives **deployed installs built from a packed
artifact**, not the source tree — the successor to PanLoop (ADR-0047). It lives in this
repository so it cannot be lost separately from the contracts it asserts; its run state
lives outside the checkout.

```bash
node harness/src/run.cjs                       # tier 0: model-free, free, ~a minute
node harness/src/run.cjs --tier 1 --max-usd 2  # + single-turn model steps, capped spend
node harness/src/run.cjs --tier 2 --max-usd 10 --repeat 5   # + chain runs, five times each
node harness/src/run.cjs --scenario install-matrix          # one scenario
node harness/src/run.cjs --repo <dir> --keep                 # pack another checkout; keep the extracted artifact after the run
node harness/src/run.cjs --help
```

Or `npm run harness` (tier 0) and `npm run harness:model -- --max-usd <n>`.

## What a run does

1. `npm pack` the checkout into the run directory, extract with `tar` (never `npx`), and
   record the package version, repository HEAD and tarball SHA-256 — a build is identified
   by content, not by version string.
2. For each scenario at or below the requested tier: create a workspace, apply its seed
   (a PAN-shaped `.planning/` tree plus a tiny project), `git init`, install PAN **from the
   extracted package** with the scenario's installer flags, then run its steps.
3. Evaluate every step's `expect` list. A failed assertion becomes a finding with a stable
   signature in `harness/ledger.jsonl` (tracked); a step that later passes resolves it.
4. Write `report.md` and `report.json` under the run directory and print a one-line JSON
   summary. Exit 1 when any step failed. **Skipped scenarios are never green.**

Run state defaults to `D:\pantesting\harness-runs\<run-id>\` on this machine
(`--state-dir` or `PAN_HARNESS_STATE` elsewhere).

## Tiers and spend

| Tier | Steps | Cost | Default |
|---|---|---|---|
| 0 | `pan`, `fs`, `sh`, `build`, `cli`, `mcp` | none | yes |
| 1 | + one `model` turn per step (`claude -p`) | your Claude usage | needs `--max-usd` |
| 2 | + chain runs (a whole `/pan-exec-waves`) | more | needs `--max-usd`, run `--repeat 5` |

A model-tier scenario is **skipped with the reason** `model tier requires --max-usd` when no cap is given (never green). The cap is **split equally across the
model-tier scenarios in the run** and enforced per scenario from the measured
`total_cost_usd` in Claude Code's JSON output, so an oracle cannot starve the scenario it is
compared with; reps are interleaved (every scenario's rep 1 before any rep 2) so an
interrupted run still yields comparable counts. A model step is not started with less than
one dollar of its scenario's share left, and a step Claude Code stops at the cap is recorded
as `budget`, not `failed` — both are facts about the run, never findings against PAN. Size
the cap per scenario: a chain rep on the two-plan seed measured **$3–6**, so five reps of
one chain scenario want about `--max-usd 25`, and both chain scenarios together `--max-usd 50`. Model steps run with `--dangerously-skip-permissions`
and, when the workspace carries `.mcp.json`, with `--strict-mcp-config` so the agent sees
exactly one `pan` server — the workspace's.

## Headless background-wait ceiling

Native PAN workflows run as background Workflows inside `claude -p`. Claude Code waits for them, but by default **the wait ends after ten minutes and the workflow is stopped with its partial result dropped** (`code.claude.com/docs/en/headless`, "Background tasks at exit"). The runner therefore sets `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` for every model step (`modelEnv()` in `src/model.cjs`); the scenario's `budget.maxStepMinutes` remains the bound. The two native-chain reps measured on 2026-09-10 before this fix both died at ~605 s with `Workflow aborted` — that was the ceiling, not the chain, and the ledger entries they filed were withdrawn for that reason.

Every model step's full `claude -p` output is written to `<run>/steps/<scenario>-<rep>-<step>.json` so a run that dies mid-agent leaves its evidence on disk.

## Scenario files

`harness/scenarios/<id>.json`:

```json
{ "id": "install-matrix", "tier": 0,
  "description": "…", "why": "…",
  "seed": "empty",
  "install": ["--claude", "--codex"],
  "requires": { "cli": "copilot" },
  "budget": { "maxUsd": 0, "maxMinutes": 10, "maxStepMinutes": 3 },
  "steps": [ { "kind": "pan", "argv": ["models", "check"], "expect": ["exit:0", "json:stale=false"], "why": "…" } ] }
```

`requires` gates a scenario on the environment rather than letting it pass vacuously: `cli`
names a binary that must be on PATH, and `minVersion` (needs `cli`) is compared against that
binary's `--version` — `/skill-doctor` exists from Claude Code 2.1.261, so the skill-doctor
scenario carries `"minVersion": "2.1.261"`. An unmet requirement **skips** the scenario and
records the reason it found; it is never green.

Step kinds: `pan` (installed `pan-tools` argv), `fs` (assert; `read: <rel>` puts a file's
text in stdout for `json:` assertions), `sh` (a script under `harness/scripts/`), `build`
(a repo `scripts/*.js` builder with the output override), `cli` (a bare command on PATH),
`mcp` (a JSON-RPC batch to the installed bridge; `cwd: "other"` runs it from a directory
that is not the project), `model` (a prompt to `claude -p`; `pluginDir` loads a plugin).
Any step may carry `timeoutMinutes` (default `budget.maxStepMinutes`); `pan` and `mcp` steps may
name a `runtime`; `model` steps take `strictMcp` (default true); `mcp` steps take `cwd: "other"` to address the second workspace; `build` steps take `out`.
Placeholders `<ws>`, `<other>`, `<repo>`, `<pkg>` are filled in argv, args, paths and prompts.

Assertion kinds: `exit:<n>`, `file:<rel>`, `absent:<rel>`, `glob:<pattern>`,
`count:<pattern>=<n>`, `json:<path>`, `json:<path>=<value>`, `json!:<path>`,
`stdout~<regex>`, `stderr~<regex>`, `rpc:<id>.<path>[=<value>]`. Every kind has a
both-direction test in `tests/harness.test.cjs`; add a kind there first.

Every step carries a `why`. That is not decoration — it is what makes a finding readable
when it surfaces months later, and the runner prints it under each failure.

## Representative scenarios

The full set lives in `harness/scenarios/` (`ls harness/scenarios`); this table names the ones the docs refer to.

| Scenario | Tier | Covers |
|---|---|---|
| `install-matrix` | 0 | Five-runtime install from the artifact; Codex async hooks; native workflows shipped; MCP registrations; engine runs; rate table current |
| `mcp-bridge-cwd` | 0 | The installed bridge, run from a foreign directory, answers for the project named by the per-call `cwd` |
| `native-workflows-deployed` | 0 | The §3.2 static gate on the installed scripts |
| `agent-plugin-bundle` | 0 | The Agent Plugins bundle builds and is shaped as the schemas and vendor docs require |
| `live-gate-copilot` / `-codex` / `-antigravity` | 0 | Live installs on those CLIs — **skipped with reason** where the CLI is absent |
| `plugin-agent-scope` | 1 | `/pan-plugin-selftest` inside the Claude plugin: `AGENT_SCOPE: scoped\|bare` |
| `native-exec-waves-chain` | 2 | `/pan-exec-waves` on a seeded two-plan phase: every plan gets a summary and the phase a verification |
| `markdown-exec-phase-chain` | 2 | The markdown twin on the same seed — the oracle for the chain comparison |
| `live-gate-gemini` / `-opencode` | 0 | Ask the CLI itself whether it loaded PAN's MCP registration — skipped with reason where the CLI is absent |
| `focus-design-ab-original` / `-split` | 1 | The body-budget A/B: the shipped `/pan:focus-design` versus a split variant on the same seed and prompt (R21) |
| `skill-doctor-context-cost` | 1 | `/skill-doctor`'s static context cost for PAN's skills; requires Claude Code 2.1.261+ |
| `map-codebase-single-shot` | 1 | Single-shot map-codebase on a repo below the sharding threshold |
| `pause-resume` | 1 | `/pan:pause` then `/pan:resume` restores the session |
| `unified-skills-discovery` | 1 | Claude Code discovers the `.agents/skills/` tree (ADR-0028's default-on gate) |
| `plan-phase-checker-loop` | 2 | Research → plan → checker loop on an unplanned phase |
| `quick-mode` | 2 | `/pan:quick` end to end on a small repo |
| `uat-diagnose-native` | 2 | `/pan-diagnose-issues` on a phase with one failed UAT truth and the matching real defect |

## Seeds

`harness/seeds/<name>/` is copied into the workspace before install (`"seed": "empty"` is reserved and means no seed). Seeds are written the
way PAN's own templates write them (roadmap checklist lines, state frontmatter, plan files
with the `wave` / `autonomous` frontmatter `phase-plan-index` parses) — a fixture in a
format PAN never emits verifies nothing.
