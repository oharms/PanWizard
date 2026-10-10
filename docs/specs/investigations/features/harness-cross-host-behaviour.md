# Behavioural harness runs on every host CLI

| | |
|---|---|
| Verdict | ENHANCE |
| Priority | P2 (this release cycle) |
| Size | L 10 points (all four non-Claude hosts); M 4 for the first host and the shape |
| Area | harness/evals/testing |
| Runtimes | Codex, Copilot CLI, Gemini CLI and OpenCode measured beside Claude Code; nothing shipped changes |
| First seen | `2026-10-08` — [digest](../digests/2026-10-08.md) |
| Ledger | MI-104 (related: MI-044, MI-071) |
| Status | FILED MI-104 |

## Source trail
- `2026-10-08` — Hugging Face ran one set of small-model weights through four unmodified coding-agent harnesses and got very different pass rates on the same held-out tasks: 62.1% under Mini-SWE-Agent, 40.0 under Codex, 33.6 under OpenCode and 33.2 under Claude Code. Training through one harness transferred poorly to another: OpenCode-only RL scored 52.3 overall but 42 under Claude Code. (source: "The ultimate guide to multi-harness RL", Hugging Face with Liquid AI, published `2026-09-24`, updated `2026-10-01`, read via the VentureBeat AI Weekly of `2026-10-08`)

## Why it matters for PAN
PAN's product claim is one planning, execution and verification layer that behaves the same under five host tools. Its evidence for that is behavioural on one host only. The harness pillar (ADR-0047, "behavioural evals against deployed installs") checks behaviour through `claude -p`. On the other four hosts it checks that PAN installs and is discovered, and nothing more.

The Hugging Face result is outside evidence that the host shapes outcomes, even with everything else held fixed. PAN's own record says the same from the other side. The host differences that mattered were all found by running the host live, never by reading its docs:
- Codex cuts plugin skills at 8,000 bytes (MI-015, found by the M25 live probe).
- The Codex gate wrote into the user's real `CODEX_HOME` (M31).
- Gemini's hooks were registered under event names Gemini skips, from 3.4 until `2026-09-23`.

Every one of those was an install or discovery fault. Nothing yet tells PAN whether a `/pan:exec-phase` chain completes under Codex or Copilot, or how much it costs there.

The cost of not doing it: tuning decided on Claude-only measurements is assumed to hold on four hosts that were never measured. That covers the R21 body-split A/B, the O6 memory retirement and the chain timings. The Hugging Face transfer result is a warning against exactly that assumption.

## Current state (evidence)
- **Model steps drive Claude Code only.** `modelArgs()` builds a `claude` argv (`harness/src/model.cjs:46-55`), and `runModelStep()` spawns `claude` (`harness/src/model.cjs:63`). ADR-0047 D4 says the same in prose: "`model` runs `claude -p` in the workspace". SOURCE.
- **Non-Claude coverage is install and discovery.**
  - `live-gate-codex`, `live-gate-copilot`, `live-gate-gemini` and `live-gate-opencode` are tier 0. Their `cli` steps list plugins, MCP servers and agents.
  - `copilot-agent-frontmatter` is the one paid non-Claude step: a single `copilot --agent … -p` turn that checks a frontmatter shape loads.

  SOURCE (`harness/scenarios/*.json`).
- **The chain scenarios are Claude-pinned.** `markdown-exec-phase-chain` installs `--claude`, requires `cli: claude` and prompts `/pan:exec-phase 1 --skip-tests`, budget `maxUsd: 8`. `native-exec-waves-chain` is Claude-only by nature (native workflows are a Claude Code feature, MI-002). SOURCE.
- **Four of the five host CLIs are on this machine, each with a headless JSON mode.** PROBED `2026-10-08` (help output only, no model call):
  - codex-cli 0.157.1: `codex exec --json`, plus `--dangerously-bypass-approvals-and-sandbox` and `--skip-git-repo-check`.
  - GitHub Copilot CLI 1.0.91: `-p`, `--output-format json` (JSONL) and `--allow-all-tools`.
  - Gemini CLI 0.61.0: `-p`, `-o json|stream-json` and `--approval-mode yolo`.
  - OpenCode 1.18.32: `run --format json`.
  - Antigravity (`agy`) is absent.
- **Spend is priced and capped for Claude only.** `--max-budget-usd` is passed to `claude` (`model.cjs:50`), and the step cost comes from Claude's JSON. The other CLIs' usage fields are not read anywhere in the harness. SOURCE.
- **What is missing:**
  - a host-selectable model step;
  - per-host cost accounting;
  - a portable chain scenario run per host.

## Proposal
- **A `runtime` field on `model` steps.** It defaults to `claude`, so every existing scenario is unchanged. One adapter per host covers:
  - the argv, including the flags an unattended run inside the scratch workspace needs;
  - how the prompt is passed (stdin where the CLI accepts it, which avoids Windows `.cmd` quoting, as the Claude step already does);
  - the output parser (final message, error flag, usage).
- **Cost under `--max-usd` stays mandatory.**
  - When the CLI reports dollars, use them.
  - When it reports tokens, price them with PAN's own rate table (`cost.cjs`). MI-023 already prices the runtime defaults with the pricing page cited.
  - A step whose CLI reports neither is refused, because the cap could not be enforced. ADR-0047 D2's rule stays as it is.
- **One portable chain per host.** It uses the seed and assertions of `markdown-exec-phase-chain`, installed with that host's flag. The prompt is written in the host's command syntax, taken from the installer's own rewrite (`$pan-exec-phase` on Codex, `/pan-exec-phase` on OpenCode and Copilot; Gemini's form to confirm). A missing CLI skips with its reason, never green (D4's existing rule).
- **Results per host.** The run report and the ledger signature carry the runtime and the CLI version, so a finding on one host is not merged with the same step on another.

## Implementation sketch
| Layer | Change |
|---|---|
| Core module (`pan-wizard-core/bin/lib/`) | none (the harness may `require` `cost.cjs` for its rate table) |
| Dispatcher (`pan-tools.cjs`) | none |
| Installer / per-runtime (`bin/install-lib.cjs`) | none; the chain prompt reuses the installer's command-syntax rewrite rather than a second table |
| Commands / agents / workflows (markdown) | none |
| Hooks / MCP | none |
| Harness | `harness/src/model.cjs`: a runtime adapter table (argv, env, prompt input, parser, usage). `harness/src/scenario.cjs`: validate `runtime`. `harness/src/run.cjs`: per-host budget share and result keys. New scenarios: `markdown-exec-phase-chain-<host>` for each host, or one scenario with a `runtimes` list. |
| Tests | `tests/harness.test.cjs`: per adapter, the argv builder and the parser against output captured from that CLI version, each shown to fail on the pre-change runner. A runtime-tagged scenario validates, and skips with its reason when the CLI is absent. A step whose usage cannot be priced is refused under `--max-usd`. |
| Docs / ADR | `harness/README.md` (scenario table, how to run per host). An ADR-0047 amendment for D4 ("model steps take a runtime"), because it widens a recorded decision. No counts. |

## Gate
A tier-2 run of the first host's chain (Codex is suggested) must pass the same assertions as the Claude oracle. That means plans executed, the verification report written and the seed's tests passing. The run is recorded with the CLI version and its cost. Behind it, the adapter unit tests must fail on the pre-change runner.

## Effort & risk
- **Spend.**
  - A Claude chain rep costs $3–6 (harness run of `2026-09-10`).
  - The other hosts bill differently: Copilot in premium requests, Codex against a plan quota. So "dollars" may need an estimate from tokens, and the cap's meaning differs per host.
  - Model tiers stay the owner's runs (ADR-0047 D2).
- **Isolation versus auth.** M31 found the Codex gate writing into the real `CODEX_HOME`. A model step needs the user's credentials, and a scratch home does not have them. Copying a credential into a scratch directory is a security decision for the owner; the alternative is config-isolation flags on the real home.
- **Unstable output shapes.** The CLIs' JSON is not a published contract. Pin the parser fixtures to the CLI version and re-capture them on upgrade, the way M25 and M31 pinned versions.
- **Scope.**
  - Only the markdown chain is portable.
  - Antigravity cannot be run here (CLI absent).
  - Gemini's headless model behaviour has not been exercised on this machine yet.
- **Noise.** The Hugging Face cells are single attempts. PAN's chain already uses `--repeat 5`. Per-host results need the same repeats before any host-specific conclusion.

## Open questions for the owner
- Which host first? Codex is suggested: the most-exercised non-Claude gate (MI-071, M25, M31).
- What spend cap per host per run, and how should a host billed in requests count against `--max-usd`?
- Should credentials be copied into scratch homes, or the real home run with config overrides?
- Should a host that fails the chain block a release (a gate), or only file a finding?
