# ADR-0047: PAN Harness — a behavioural test harness that lives with the code it tests

## Status

Accepted — 2026-09-10. Replaces the PanLoop harness (`D:\panwiz_recursiontest`), which no longer exists on disk; only its Claude transcript folder survives, and this record was written from what that transcript and its recovered files show worked. Implementation under `harness/`; the model-free tier ran green against a packed artifact the day this was accepted.

## Context

PAN had one thing almost nothing in its category has: a behavioural eval harness that drove *deployed* installs and measured what the model actually did. PanLoop found the auto-advance chain drop (0/3 → 16/16 across the fix chain), two dead MCP resources, a dead reconcile gate, and its own over-claiming checks. Then it disappeared with the directory it lived in. The market-delta plan (`docs/specs/market-delta-2026-09-superplan.md`) closed every item except the ones that needed it: the behavioural gate for the new native workflows (5c), the agent-scope probe (3b), and the live installs for the Agent Plugins vendor directories.

What the recovered material establishes about the old harness, and what this design keeps or changes:

| PanLoop practice | Verdict | Why |
|---|---|---|
| Scenario = JSON with `tier`, `description`, a `why` per step, `expect` assertions, a `budget` | **Keep** | The `why` is what made findings legible months later |
| Steps of three kinds: `panSteps` (pan-tools argv), `mcpSteps` (JSON-RPC to the installed bridge), `steps` (a prompt to `claude -p`) | **Keep, unify** | One `steps` array with a `kind` field; the old split hid that a scenario could mix them |
| Install from a **packed artifact**, never the source tree; identify the build by content | **Keep** | The released and branch builds shared a version string once; `npx <tgz>` silently no-ops on Windows |
| Model steps run under `--mcp-config <ws>/.mcp.json --strict-mcp-config` | **Keep** | Measured: without it an agent saw two `pan` servers (workspace + plugin cache) with near-identical tool names |
| Findings ledger with signatures, promotion rule (deterministic, or seen in ≥2 runs), recheck sweep | **Keep** | It stopped single flaky runs from becoming filed defects |
| Every check must be proven able to **fail** (mutation fixture) — PanLoop withdrew four of its own claims for lacking this | **Keep, enforce in tests** | A check that cannot fail is a false pass waiting to be believed |
| Lived in its own directory with its own git history | **Change** | It vanished. Scenarios assert PAN's contracts; they version with PAN |
| Run scenarios five times | **Keep for model tiers** | One green run proves nothing at a 4/5 failure rate |

## Decision

**D1 — Location: source in the repo, state outside it.** `harness/` in this repository holds the runner, the scenario definitions and the seeds; it is absent from `package.json` `files`, so nothing ships. Run state — workspaces, extracted artifacts, per-run reports — goes under `d:\pantesting\harness-runs\<run-id>\` by default (`--state-dir`, or `PAN_HARNESS_STATE`), honouring the rule that installs never touch the source checkout. The findings ledger, `harness/ledger.jsonl`, is tracked: it is the finding history the promotion rule depends on.

**D2 — Three tiers, model spend is opt-in and capped.** Tier 0 is model-free (pan-tools, filesystem, the bridge over stdio) and is the default run. Tier 1 is one model turn per step; tier 2 is a chain run. A tier ≥1 step is refused unless the run carries `--max-usd`; the runner stops when the cap is reached and records the stop as a finding of the run, not of PAN. Costs come from `claude -p --output-format json` (`total_cost_usd`), so the cap is enforced from measured spend, not estimates.

**D3 — Artifact-first.** A run begins with `npm pack` of the repository into the run directory, extraction with `tar` (never `npx`), and an install from the extracted package into each workspace. The run records the package version, the repository HEAD, and the tarball's SHA-256; a report that names only a version is not a report.

**D4 — Scenario schema.** One JSON file per scenario:

```
{ id, tier, description, why,
  seed: "<name under harness/seeds>" | "empty",
  install: ["--claude", "--codex", …] | null,      // installer flags; null = no install
  requires: { cli: "copilot" } | null,             // absent CLI → the scenario is SKIPPED with the reason, never green
  budget: { maxUsd, maxMinutes, maxStepMinutes },
  steps: [ { kind: "pan" | "sh" | "mcp" | "model" | "fs", …, expect: [ … ], why } ] }
```

Step kinds: `pan` runs the **installed** `pan-tools` with an argv; `sh` runs a whitelisted node script (never a shell string); `mcp` sends a JSON-RPC batch to the **installed** bridge over stdio; `model` runs `claude -p` in the workspace; `fs` asserts without running anything. Assertion kinds: `exit:<n>`, `file:<rel>`, `absent:<rel>`, `glob:<pattern>`, `count:<glob>=<n>`, `json:<path>` (key present) and `json:<path>=<value>` (on stdout JSON), `stdout~<regex>`, `stderr~<regex>`, and for `mcp` steps `rpc:<id>.<path>=<value>`. Every kind has a unit test that shows it failing on a mutated input.

**D5 — Findings.** A failed assertion is a finding with a signature (`sha1(scenario, step, kind, normalised detail)`). The ledger records first/last seen, the runs and builds it appeared in, and `resolved_at` when a later run passes the same step. Promotion rule as before: a tier-0 finding is promotable at once; a model-tier finding after two runs. A skipped scenario is recorded as `skipped` with its reason in the report and is never counted as passed.

**D6 — What it covers first.** The coverage matrix the plan left open:

| Plan item | Scenario | Tier |
|---|---|---|
| Deployed install of every runtime; Codex hooks async; native workflows shipped; MCP registrations written | `install-matrix` | 0 |
| 4g — the installed bridge answers for another project when `cwd` says so | `mcp-bridge-cwd` | 0 |
| Native workflow scripts as deployed: parse, meta first, phases agree | `native-workflows-deployed` | 0 |
| Agent Plugins bundle builds from the artifact's sibling repo and validates; Copilot/Codex/Antigravity live installs | `agent-plugin-bundle`, `live-gate-copilot`, `live-gate-codex`, `live-gate-antigravity` | 0 (skips with reason when the CLI is absent) |
| 5c — `/pan-exec-waves` chain completion vs the markdown path on a seeded two-plan phase | `native-exec-waves-chain` | 2 |
| 3b — agent scope inside the Claude plugin (`AGENT_SCOPE: scoped\|bare`) | `plugin-agent-scope` | 1 |

**D7 — Seeds are PAN-shaped.** A seed is a `.planning/` tree written the way PAN's own templates write it (roadmap, state, plan files with the frontmatter `phase-plan-index` parses), because the reconcile-gate lesson stands: a fixture hand-written in a format PAN never emits verifies nothing.

## Consequences

- The harness can no longer be lost separately from the code; a change to a PAN contract and the scenario that asserts it land in the same commit.
- Tier 0 runs in CI-like conditions with no spend and no credentials; it is the release gate's natural ninth step once it has run green for a while.
- Model tiers spend the maintainer's Claude usage. They never run by accident: no `--max-usd`, no model step.
- The live gates for Copilot, Codex and Antigravity are encoded now and will report `skipped: <cli> not installed` on this machine until the CLIs exist; on a machine that has them, the same run turns them into real results.
- Every assertion kind carries a both-direction test, so the harness cannot accumulate checks that pass vacuously — the failure mode PanLoop found in itself.

## Alternatives considered

- **Rebuild PanLoop as a sibling repository.** Rejected: it is how the last one was lost, and its scenarios asserted contracts that live here.
- **Reuse `tests/scenarios/` for behavioural runs.** Rejected: those are unit-shaped, model-free and run from the source tree; the harness's value is the deployed artifact and the model.
- **Drive Claude Code through the Agent SDK instead of `claude -p`.** Deferred: `claude -p --output-format json` already yields cost and result; the SDK adds a dependency to a zero-dependency project for no measured gain.
