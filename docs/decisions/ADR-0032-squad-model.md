# ADR-0032: Squad Model — Agents as a Coordinated Army

## Status
Accepted — 2026-06-12. First slice of the "PAN as a bot army" enhancement (see `docs/ECOSYSTEM-REVIEW-2026-06.md` and the bot-army architecture brief). Turns PAN's 21 standalone agents into four named, tool-scoped **squads** under the existing `pan-conductor` coordinator, without changing any agent's behavior.

## Context

PAN already has the bot-army primitives — a delegation-only Opus coordinator (`pan-conductor`), 21 specialist agents, a file-backed message bus (`bus.cjs`), per-agent memory, cost/trace telemetry, and a hard safety harness (nesting cap 2, 12-spawn cap, budget ceiling, abort kill-switch). What it lacks is the **squad** abstraction: a named grouping of agents with a shared role, a least-privilege tool scope, and a model tier. Today the conductor knows individual agents; an "army" needs it to reason in squads — "delegate to Quality" rather than naming six agents.

The bot-army model defines four squads by lifecycle role:
- **Architecture** — design before code (read-only).
- **Build** — turn design into committed code (read/write/bash).
- **Quality** — adversarially break what Build makes (read-only).
- **Release** — ship safely, roll back fast (always-ask on destructive ops).

These map cleanly onto PAN's existing agents. The only genuinely new member is a Release agent (today release is bare git calls).

## Decision

Add a **squad registry** as data, with a small resolver and CLI surface. No agent is modified; squads are a *view over* the existing roster plus a tool/model contract.

### 1. `squads.cjs` core module

A pure registry + resolver:

```
SQUADS = {
  architecture: { tier: 'reasoning', access: 'read-only',
                  agents: ['pan-roadmapper','pan-planner','pan-plan-checker',
                           'pan-project-researcher','pan-phase-researcher','pan-research-synthesizer'] },
  build:        { tier: 'reasoning', access: 'read-write-bash',
                  agents: ['pan-executor'] },
  quality:      { tier: 'mid', access: 'read-only',
                  agents: ['pan-reviewer','pan-hardener','pan-meta-reviewer',
                           'pan-verifier','pan-integration-checker','pan-debugger'] },
  release:      { tier: 'mid', access: 'always-ask',
                  agents: [] },   // release ops are git-tool driven until a release agent ships
}
```

Functions: `listSquads()`, `getSquad(name)`, `squadForAgent(agent)` (reverse lookup), `validateRoster(knownAgents)` (every squad agent must be a real agent; the inverse — every non-coordinator/non-worker agent belongs to exactly one squad — is checked by a drift test).

### 2. CLI surface

- `pan-tools squad list` — the squads, their tier/access, and member counts.
- `pan-tools squad show <name>` — one squad's full roster + contract.

JSON by default; `--raw` for a human summary. These let the conductor (and a human) reason about the army without hardcoding rosters in prompts.

### 3. Drift test (the load-bearing invariant)

A test pins **squad roster ⇄ agent files ⇄ `AGENT_BASE_EFFORT`** parity: every squad member is a shipped agent, and every shipped agent is either the coordinator (`pan-conductor`), a worker (`pan-document_code`, `pan-distiller`, plus the standalone utility agents `pan-optimizer`, `pan-experiment-runner`, `pan-knowledge`, `pan-counterfactual`, `pan-previewer`), or a member of exactly one squad. Adding an agent without placing it fails the test — the army can't silently leave a soldier unassigned.

### What this does NOT do

- Does not modify any agent definition, model profile, or the conductor harness.
- Does not change default execution — squads are inert until the army campaign command (ADR-0033) uses them.
- Does not ship the Release agent yet (its squad is declared with an empty roster + the `always-ask` contract; the agent lands with ADR-0033).

## Consequences

**Positive.** The conductor gains a coarse, least-privilege delegation vocabulary; tool scope is declared per squad (Architecture/Quality read-only, Build read/write, Release always-ask) rather than re-derived per prompt; the drift test makes the roster self-maintaining. Zero behavior change until a campaign opts in.

**Negative / risks.** A second place (besides `MODEL_PROFILES` and `AGENT_BASE_EFFORT`) that enumerates agents — mitigated by the parity drift test. The Architecture/Quality split is a judgment call about a few agents (e.g. `pan-debugger` sits in Quality though it also fixes); the registry is data, so re-grouping is a one-line change defended by tests.
