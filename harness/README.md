# PAN Harness

A behavioural test harness for PAN that drives **deployed installs built from a packed
artifact**, not the source tree — the successor to PanLoop (ADR-0047). It lives in this
repository so it cannot be lost separately from the contracts it asserts; its run state
lives outside the checkout.

```bash
node harness/src/run.cjs                       # tier 0: model-free, free, ~a minute
node harness/src/run.cjs --tier 1 --max-usd 2 --scenario plugin-agent-scope  # one tier-1 scenario, capped spend
node harness/src/run.cjs --tier 2 --max-usd 50 --repeat 5 --scenario native-exec-waves-chain --scenario markdown-exec-phase-chain   # the chain pair, five reps each
node harness/src/run.cjs --scenario install-matrix          # one scenario
node harness/src/run.cjs --repo <dir> --keep                 # pack another checkout; keep the extracted artifact and workspaces after the run
node harness/src/run.cjs --no-ledger                        # leave the tracked harness/ledger.jsonl untouched (CI)
node harness/src/run.cjs --controls                         # also run every control: each sabotage must turn its scenario red
node harness/src/run.cjs --require-run double-executor-body-claude   # fail, never skip, when this scenario cannot run (CI)
node harness/src/run.cjs --scenario cassette-drift-claude --record   # re-record a synthetic cassette after an intended prompt change
node harness/src/run.cjs --tier 2 --max-usd 50 --repeat 12 --until-decided --scenario quick-mode   # stop the reps once SPRT decides
node harness/src/run.cjs --tier 2 --max-usd 25 --repeat 5 --arm no-guidance --scenario quick-mode # the no-guidance baseline arm
node harness/src/run.cjs --help
```

Or `npm run harness` (tier 0) and `npm run harness:model -- --max-usd <n>`.

## What a run does

1. Run `scripts/build-hooks.js` (the package ships the gitignored `hooks/dist/`), `npm pack` the checkout into the run directory, extract with `tar` (never `npx`), and
   record the package version, repository HEAD and tarball SHA-256 — a build is identified
   by content, not by version string.
2. For each scenario at or below the requested tier: create a workspace, apply its seed
   (a tiny project, usually with a PAN-shaped `.planning/` tree), `git init`, install PAN **from the
   extracted package** with the scenario's installer flags, then run its steps.
3. Evaluate every step's `expect` list. A failed assertion becomes a finding with a stable
   signature in `harness/ledger.jsonl` (tracked); a step that later passes resolves it.
4. Write `report.md` and `report.json` under the run directory and print a one-line JSON
   summary. Exit 1 when any step failed or a model step never reached the model (recorded as `error`, with no assertion evaluated and no finding filed). **A skipped scenario is never counted as passed:** the report records it as `skipped` with its reason, but a skip does not by itself make the run exit 1 (a scenario named by `--require-run` that does not run does, as does a control a scenario survives).

Run state defaults to `<test dir>\harness-runs\<run-id>\` on Windows, the test directory being the
first of `C:\Project\pantesting` and `D:\pantesting` that exists (`<os temp>/pan-harness-runs/` otherwise; `--state-dir` or `PAN_HARNESS_STATE` overrides it).
The `two-plan-phase` seed sets `workflow.plan_check: false`: its plans are a fixture that never went through `/pan:plan-phase`, and exec-phase stops on plans with no recorded plan check, so the scenarios that run exec-phase on it would stop and ask instead.

A finished run keeps only `report.md`, `report.json` and `steps/`: the extracted package and the
workspaces (about 200 MB a run) are deleted once the reports are written. `--keep` leaves them,
for debugging a failed step.

## Tiers and spend

| Tier | Steps | Cost | Default |
|---|---|---|---|
| 0 | `pan`, `fs`, `sh`, `build`, `cli`, `mcp`, and `model` and `user` steps backed by the model double | none | yes |
| 1 | + `model` steps (one headless `claude -p` run each, however many turns it takes), or a `cli` step marked `paid: true` (another CLI's model run) | your Claude usage, or that CLI's credits | capped at $15 unless `--max-usd` says otherwise |
| 2 | + chain runs (a whole `/pan-exec-waves`) | more | set `--max-usd` to fit (the $15 default buys about one chain rep), run `--repeat 5` |

A model-tier run (`--tier 1` or `2`) is capped at **$15** when no `--max-usd` is given; `PAN_HARNESS_MAX_USD` changes that default, `--max-usd` overrides both, and `--max-usd 0` spends nothing (each model step is then recorded as `budget`, never green). Tier 0 spends nothing and has no cap. The cap is **split equally across the
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

## The model double: real hosts, no model, no spend

`src/model-double.cjs` is a local `node:http` server that answers a host CLI in place of the model provider (program H1). It speaks Anthropic Messages (streamed and not), OpenAI Responses and Chat, and Gemini, in four modes: **capture** (record every request, answer briefly), **script** (answer from a script of turns, text or a tool call), **replay** (answer from recorded pairs; any other request is `drift`) and **record** (proxy to a real upstream and keep the pairs). Nothing reaches a real model in the first three, so a step backed by them is **tier 0** (ADR-0047 D2 as amended `2026-10-12`) and runs in CI.

A `model` step with `double: {script}` runs the real host CLI against the double (`src/double-server.cjs`, its own process, because the step runner is synchronous), with a scratch config directory and a dummy key, so a user's own login is never read. A script is `{rules: [{when, turns}], fallback}`: `when` matches on the tools a request offers (`toolsInclude`, `toolsExclude`), its system prompt (`systemIncludes`, `systemExcludes`), the conversation (`userIncludes`, `messagesInclude`, below) or a header; each rule answers its turns in order and repeats the last. Claude Code `2.1.288` sends no agent-type header: its main session is the request that offers the spawn tool (`Agent`), a subagent's system prompt carries its agent body, and two more requests per turn are its own notification classifier (the fallback answers them). Only Claude Code takes a model base URL from the environment today; a double-backed step on another host is refused with that reason. The `harness` gate of `npm run ci:local` (`scripts/local-ci.cjs`) runs tier 0 with `--require-run double-executor-body-claude`, so the scenario fails rather than skips when the machine has no Claude Code CLI; a control the scenario survives and an unmet `--require-run` both make the run exit 1. The gate requires `cassette-drift-claude` and `discuss-phase-scripted-user` the same way.

Two assertion kinds read what the host sent: `wire:<field>~<regex>` (some request's `system`, `tools`, `url` or `body` matches) and `wire-count:<field>~<regex>=<n>`. `double-executor-body-claude` uses the double to show the executor subagent receives the **packaged** `pan-executor` body whole (`scripts/wire-agent-body.cjs`, after the installer's path rewrites), and its control truncates the installed agent to prove the check can fail: the MI-015 class, at $0.

## The scripted user: conversations at $0 (H9)

A `user` step answers the session the step before it left. Its `answers` are `[{match, reply}]`: the first whose `match` (a case-insensitive pattern) finds the host's last reply is sent, and the host resumes the same session with it (`claude -p --resume <session_id>`). The model step that opens the conversation sets `persistSession: true`; its session, and every user step's, lives in one config home for the whole scenario (`<other>/double-session-home`). A user step with no matching answer fails with the reply it could not answer. Double-backed it is tier 0; without `double` it spends like a model step. Two double rules read the conversation: `userIncludes` (the latest user text, tool results left out) and `messagesInclude` (every listed string appears somewhere in the conversation), so a script can require that the earlier answers are still there. `discuss-phase-scripted-user` drives `/pan:discuss-phase 1` on the `discuss-needed` seed through three answers; the scripted model writes `01-context.md` only when all three are in the request, and its control deletes the kept session so the first resume finds nothing and goes red.

## Cassettes: replay at $0, drift as prompt impact

A `model` step with `double: {cassette: <file>}` replays recorded answers (program H2). A request is keyed on its protocol, model and turn number, plus the part of the system prompt PAN owns: a request that carries an installed agent's body is keyed on that agent's lines as sent, in order, and any other request (the main session, the host's own classifiers) on its opening line. Paths, the host's project slug, line endings, Claude Code's billing line, ids, dates and durations are normalised away, so a cassette recorded on Windows replays on Linux. The host's own prose is not in the key: it varies with platform and host flags under one CLI version, and it is not PAN's prompt to measure.

A request with no recorded answer is **drift**, attributed to the installed agent whose body it carries (or *unattributed*: the main session, a host request, or a host upgrade). The double answers it with a 400, which the clients do not retry. Drift a step does not assert on gives the scenario the status `drift` with a note naming each agent and its file: the impact of a prompt change, reported and never a ledger finding, and not a failed run. Two assertion kinds expect it: `drift:none`, and `drift:<regex>` (at least one drifted request, every one attributed to an agent whose name matches).

Cassettes committed under `cassettes/` are **synthetic**: recorded from a scripted upstream, they hold keys and replies only, no prompt text and no credentials. A step that carries its recipe as `double.record.script` re-records its cassette from it under `--record`; without the flag it replays. `cassette-drift-claude` replays `cassettes/executor-spawn-claude.json` green, adds one line to the installed `pan-executor`, and expects drift for that agent and no other; its control edits the agent before the first replay. Recording from a real model (`double.record.upstream`) is refused both by the scenario validator and by the step runner: it spends, needs an API key (never a subscription login), and its cassettes stay outside the repository.

## Statistics: intervals, decisions, arms

Five reps cannot separate two variants: 4/5 passes has a 95% interval of [0.38, 0.96]. `src/stats.cjs` (pure, no dependencies) gives the runner and the ledger what a claim needs:

- **Every rate carries its interval.** The report's completion table shows the pass rate with its 95% Wilson interval, and pass^3 (the chance that three runs in a row all pass, tau-bench's measure) once a scenario has three reps. The markdown chain's 3/5 of `2026-09-10` re-renders as `3/5 [0.23, 0.88]`, pass^3 0.10.
- **`--until-decided`** stops a model-tier scenario's reps once Wald's sequential test decides (pass rate 0.8 against 0.5, alpha 0.05, beta 0.2), so a clear result costs fewer reps.
- **Comparisons** use `pairedSignTest` and `sprtPaired` (does B beat A on the same items?) or `nonInferiority` (Newcombe interval for the difference against a margin). `powerN` plans the reps: telling 0.6 from 0.8 at 80% power takes 79 per arm, which is why a wider matrix waits.
- **Autopilot** (S1, S2, S5): `harness/autopilot/` holds the market watcher, the autopilot spine and the weekly State of PAN; see the `harness/autopilot/` entry in `CLAUDE.md`. Model lanes spend only with a per-run `--approve-usd`.
- **Pairs** (H10): two scenarios with the same `pair: {id, arm, goal}`, one `pan` arm (PAN installed) and one `stock` arm (`install: null`, the host alone), on the same seed, host and tier, measure PAN against the bare host. `loadScenarios` refuses an inconsistent pair. The report adds a **PAN versus the bare host** table: paired deltas (completion, cost, duration), PAN minus the host alone, with 95% t intervals (`stats.cjs pairedDelta`). `pair-add-function` replays synthetic cassettes at tier 0; the evidence run re-records both arms from a real model with paired reps (`--repeat` at tier 1). `pair-ledger-live` is the large-project pair: seed `ledger-roadmap` is a six-phase ledger roadmap whose phase 5 changes the storage format under phases 1-4 (migrating `data/sample-ledger.json`) and whose phase 6 reuses phases 3 and 4. The PAN arm runs autodev over all six phases (`autodev-run.cjs`, `spends`); the stock arm is six model steps, one fresh session per phase, each capped by its own `maxUsd`. Both are judged by `scripts/check-ledger.cjs` (every phase plus cross-phase regressions, `per_phase` and `regressions` in its JSON), which `tests/h10-ledger-pair.test.cjs` proves fails six plausible phase-by-phase mistakes. Give it `--max-usd 60` per rep: the cap is split equally between the arms. `pair-vague-live` tests a vague goal: the request says only "Finance needs an export of expenses", and the constraints that decide the result sit in the seed's `docs/` (meeting notes, data dictionary, ops runbook), judged by `scripts/check-vague-export.cjs`, which neither arm sees; `tests/h10-vague-pair.test.cjs` proves model-free that the check passes a reference and fails each "coded from the request only" version on the constraint it misses. `pair-brief-live` tests project definition: seed `brief-shop` holds only `BRIEF.md`, one paragraph describing a stock and order library (reservations, partial shipments, cancellations, low stock, a daily report, persistence), and no `.planning/`. The PAN arm runs `/pan:new-project --auto @BRIEF.md` (a capped model step that stops at the roadmap), then autodev over the phases it planned; the stock arm is four fresh capped sessions from the same brief with no structure given; `brief-live-quality` is the same PAN path with the quality profile and `--quality`. All are judged by `scripts/check-shop.cjs`, which `tests/h10-brief-pair.test.cjs` proves fails five plausible misreadings of the brief, and runs the PAN arm end to end against a stand-in `claude`. Give the pair `--max-usd 60` per rep.
- **Simulations** (H8): `node harness/src/sim.cjs [--sim <id>] [--seeds N] [--no-stop-guard]` runs the real autodev loop and phase gate against a simulated host with a seeded fault schedule (no-op sessions, compile failures, cost spikes, verifications that need a human or find gaps), declared in `harness/sims/sim-*.json`, and checks the loop's invariants: a declared stop reason, within the unit and spend caps, no phase completed past the gate. `tests/autodev-sim.test.cjs` runs every sim on 20 seeds, and checks that one fails with the stop guard disabled. Model-free.
- **Prompt mutants** (H6): `--prompt-mutant <rule id>` deletes one rule (an id from `tests/fixtures/prompt-rules.json`, built by `scripts/prompt-rules.cjs`) from the packed package before install, and runs only the scenarios whose `covers` names it (a scenario's top-level `covers: [<rule id>...]`; `quick-mode` covers `pan-wizard-core/workflows/quick:4387c189`, quick.md's Step 7, and checks it with `scripts/quick-task-recorded.cjs`). If all of them still pass, the rule is decorative; a failure makes it load-bearing. Each mutant run appends `{rule, verdict, scenarios: [{passed, runs, interval}]}` to `harness/prompt-mutants.jsonl` (not with `--no-ledger`). A mutant drifts every cassette, so it runs live.
- **Arms** are declared variants of a scenario, the same shape as a control (`arms: [{id, why, delete|write|replace, after?}]`), applied after install and measured rather than expected to fail. `--arm <id>` runs the scenarios that declare it. `quick-mode` carries `no-guidance`, the executor reduced to a one-line role: the baseline a change to the executor prompt is measured against (M43).
- **Ledger classes.** A model-free finding promotes at once (tier 0 is deterministic). A model-tier finding counts every failure and every pass of its step, and promotes once it has failed at least twice and its failure rate's 95% lower bound reaches 0.2; with passes on record below that, it is `flaky`. An entry from before the counts keeps the old two-run rule.

## Seeded-defect corpus and the detection scoreboard

A pass rate says a chain finished; it does not say the judges at the end of it would have caught a bug. `corpus/` holds small projects with one known defect each, across PAN's defect funnel: a stub, a hollow test, an unwired export, a swallowed error, a false completion claim, an off-by-one, test tampering, scope creep and a security flaw. Each entry has a clean twin (`clean/`), the files that make the defective twin (`defect/`), the truth (`corpus.json`: the category, the task the phase was given, the file and a one-line summary of the defect) and a catching test (`catch/`) that judges never see.

- **Every entry is proven.** `tests/harness-corpus.test.cjs` puts each through V4's RED/catch proof (`verify red`): in a scratch repository the defective twin is the base and the clean twin plus the catching test is the plan commit, so the test must fail on the seeded diff and pass without it. The defective twin must also pass the project's own tests: a defect those tests already catch is not a judge's job.
- **Entries from mutation operators.** `scripts/corpus-generate.cjs` applies V5's operator table (`verify mutate`) to a base (`corpus/_base-<name>/`) and keeps a mutant only when the catching test kills it and the base's own suite does not, so an equivalent mutant is dropped rather than filed as a defect. `--write` writes the kept entries; the test asserts the committed ones are exactly what it keeps.
- **The scoreboard.** `scripts/catch-rate.cjs <results.jsonl>...` reads judge runs (`{corpus, twin, judge, host, profile, report}`), reads each verdict the way PAN does (`parseVerdictText`), and reports per judge × host × profile the catch rate on defective twins and the false-alarm rate on clean ones, each with its Wilson interval, a located count (a finding names the truth file) and a per-category breakdown. A report with no readable verdict is counted as unreadable, never as a catch or a miss. `--compare <baseline-key> <candidate-key>` runs the paired catch-rate SPRT. `run.cjs --scoreboard <results.jsonl>` adds the table to a run's report.
- **What is measured today.** `corpus-replays/synthetic-reviewer.jsonl` is a scripted replay, not a model: it pins the scoreboard and the comparison at $0 (a weakened judge scores lower and loses the SPRT). Real baselines for the verifier and the reviewer, and the weakened-verifier check against them, are the program's paid evidence step and need `--max-usd`.

### Producing live judge rows (`scripts/corpus-run.cjs`)

`catch-rate.cjs` only scores rows; `scripts/corpus-run.cjs` produces them, on a Claude Code login (no API key). For each selected entry and each twin it builds a workspace under the state dir (`corpus-runs` under the first of `C:\Project\pantesting` and `D:\pantesting` that exists on Windows, else the OS temp directory; `--state-dir`): a PAN project whose phase 1 was given the entry's task, with PAN installed from a packed artifact (`src/artifact.cjs`, never the source tree). The base commit is the planning tree; the second commit is the twin plus a plan summary, so `git diff HEAD~1` is the change under judgement (the install is git-excluded). One headless `claude -p` session (`src/model.cjs`: its argv, `--max-budget-usd <--session-usd>`, cost from the JSON result) spawns the judge, and its verdict (the reply's `pan-verdict` block, or the verifier's `verification.md`) becomes one row, appended to `--out`: catch-rate's fields plus `arm`, `variant`, `model`, `cost_usd`, `duration_ms` and the build identity.

```bash
node harness/scripts/corpus-run.cjs --judge verifier --dry-run                     # plan: sessions and spend ceiling, $0
node harness/scripts/corpus-run.cjs --judge verifier --max-usd 40 --out rows.jsonl # live
node harness/scripts/corpus-run.cjs --judge verifier --max-usd 40 --out rows.jsonl \
  --arm weak-verifier --variant .claude/agents/pan-verifier.md=harness/variants/pan-verifier-weakened.md
node harness/scripts/catch-rate.cjs rows.jsonl --compare "pan-verifier × claude × balanced" "pan-verifier × claude × balanced:weak-verifier"
```

- `--judge verifier|reviewer|plan-checker|meta-reviewer`; `--entry <id>` (repeatable), `--limit N`, `--profile` (default `balanced`, written to the workspace's config).
- `--arm <label>` keys the rows apart (`profile` becomes `<profile>:<label>`); `--variant <installed path>=<file>` replaces an installed file after install, with `run.cjs --variant`'s rule (the file must be under `harness/variants/`, and an agent variant at `.claude/agents/<name>.md` first gets the installer's path rewrites, `installedAgentText`, so a copy saved from the source tree points at the workspace's install). `variants/pan-verifier-weakened.md` is H4's deliberately weakened verifier: existence checks only, summaries trusted.
- `--lenses k` (reviewer only, R2): k sessions per twin, one `<lens>` each, merged by the installed `pan-tools review vote`; the voted report is the row's report.
- `--max-usd N` is required for a live run and caps the whole run: a twin starts only while the remaining cap covers all its sessions at `--session-usd` (default 2) each. A session whose cost cannot be read is charged at its ceiling.
- Each twin's workspace is deleted once its row is written, and the extracted package at the end; `--keep` leaves them. With `--out` outside the state dir nothing is left there.
- The meta-reviewer session runs the review-deep first pass (reviewer and hardener) before the meta-reviewer, so it costs about three judges. The plan-checker judges a plan, and every twin of an entry shares one plan, so its rows measure only how it reads the committed code against the plan; a plan-defect corpus would be needed to measure it properly.
- `tests/corpus-run.test.cjs` drives it against a stand-in `claude` (`PAN_STANDIN_DIR`) and a stand-in package, at $0.

## Headless background-wait ceiling

Native PAN workflows run as background Workflows inside `claude -p`. Claude Code waits for them, but by default **the wait ends after ten minutes and the workflow is stopped with its partial result dropped** (`code.claude.com/docs/en/headless`, "Background tasks at exit"). The runner therefore sets `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` for every model step whose environment does not already set it (`modelEnv()` in `src/model.cjs`); the scenario's `budget.maxStepMinutes` remains the bound. The two native-chain reps measured on 2026-09-10 before this fix both died at ~605 s with `Workflow aborted` — that was the ceiling, not the chain, and the ledger entries they filed were withdrawn for that reason.

A model step that returns a result, and is not stopped by the cap, leaves a record at `<run>/steps/<scenario>-<rep>-<step>.json`: exit code, cost, turns, duration, the result text and stderr. It is the harness's own record, not Claude Code's JSON: read `turns` and `costUsd`, not `num_turns` or `total_cost_usd`.

## Scenario files

`harness/scenarios/<id>.json`:

```json
{ "id": "my-scenario", "tier": 0,
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
(a repo `scripts/*.js` builder with the output override), `cli` (a bare command on PATH;
`paid: true` marks one that spends that CLI's model credits — it may not live in tier 0,
and it counts as a tier-1 scenario's model step; its credits are not counted against `--max-usd`),
`mcp` (a JSON-RPC batch to the installed bridge; `cwd: "other"` runs it from a directory
that is not the project), `model` (a prompt to `claude -p`; `pluginDir` loads a plugin; `double: {script}` or `double: {cassette}` runs it against the local model double at tier 0, see above), `user` (a scripted answer to the session the step before it left: `answers: [{match, reply}]`, see above; it must follow a `model` or `user` step).
Any step may carry `timeoutMinutes` (default `budget.maxStepMinutes`, else 5) and `fatal: true` (a failed step ends the scenario); a step due after `budget.maxMinutes` (default 30) has passed is not run, and the overrun is a failure with a finding, not a `budget` stop; `pan` and `mcp` steps may
name a `runtime`; `model` steps take `maxUsd` (a cap on that one session, below the scenario's share and `budget.maxUsd`), `runtime` (`claude` by default; `codex`, `copilot`, `gemini` or `opencode` name another host, but those are refused until a parser for that host's JSON output and usage exists, which needs one captured run each: MI-104), `strictMcp` (default true) and `persistSession: true` (it drops `--no-session-persistence`, so the host writes the session and per-agent transcripts that a transcript-reading hook, or a later step that checks what agents were sent or opened, needs); `mcp` steps take `cwd: "other"` to address the second workspace; `build` steps take `out`; `cli` steps take `env` (`{"NAME": "value"}`, placeholders filled), which `live-gate-gemini` uses to give Gemini a scratch home under `<other>` instead of the user's real `~/.gemini`.

Since Claude Code 2.1.302, fork mode is on by default in `claude -p`: main-conversation spawns run in the background, and the Agent tool loses `run_in_background`. Typed and `general-purpose` spawns still start with a fresh context. The harness leaves this default alone because it is what users run. To compare a model tier with a baseline recorded before 2.1.302, run it with `CLAUDE_CODE_FORK_SUBAGENT=0` in the environment.
Placeholders `<ws>`, `<other>`, `<repo>`, `<pkg>` are filled in argv, args, paths and prompts; an `mcp` step's requests get `<ws>` and `<other>` only.

Assertion kinds: `exit:<n>`, `file:<rel>`, `absent:<rel>`, `glob:<pattern>`,
`count:<pattern>=<n>`, `json:<path>`, `json:<path>=<value>`, `json!:<path>`,
`stdout~<regex>`, `stderr~<regex>`, `rpc:<id>.<path>[=<value>]`, and for double-backed steps
`wire:<field>~<regex>`, `wire-count:<field>~<regex>=<n>` and `drift:none` / `drift:<regex>`. Every kind has a
both-direction test, in `tests/harness.test.cjs` (the double's kinds in `tests/model-double.test.cjs`); add a kind there first.

### Controls

A scenario that cannot fail measures nothing. Every tier-0 scenario declares `controls`: at least one sabotage that must turn it red, and `validateScenario` refuses a tier-0 scenario without one.

```json
"controls": [
  { "id": "no-manifest", "after": 0, "delete": "bundle/plugin.json", "why": "A bundle without its manifest is not a plugin." }
]
```

Each control names exactly one sabotage, `delete: <path>`, `write: {path, content}` or `replace: {path, find, with}`, on a path inside the workspace or `<other>`. `after` is the index of the step it follows (default `-1`: after install and seed, before the first step). `--controls` runs each passing scenario once more per control, in a fresh workspace, and reports a **Controls** table: `killed` is the expected verdict. A control the scenario **survives** is a failure, because the scenario's assertions do not measure what they claim; a control that cannot be applied (its file or string is missing) is an error, because it changes nothing. Controls do not run by default, since they multiply a run's length; their failures never reach the ledger.

Every step carries a `why`. That is not decoration — it is what makes a finding readable
when it surfaces months later, and the runner writes it under each failure in `report.md`.

## Representative scenarios

The full set lives in `harness/scenarios/` (`ls harness/scenarios`); this table names the ones the docs refer to.

| Scenario | Tier | Covers |
|---|---|---|
| `install-matrix` | 0 | Five-runtime install from the artifact; Codex async hooks; native workflows shipped; MCP registrations; engine runs; rate table current |
| `mcp-bridge-cwd` | 0 | The installed bridge, run from a foreign directory, answers for the project named by the per-call `cwd` |
| `native-workflows-deployed` | 0 | The §3.2 static gate on the installed scripts |
| `agent-plugin-bundle` | 0 | The Agent Plugins bundle builds and is shaped as the schemas and vendor docs require |
| `live-gate-copilot` / `-codex` / `-antigravity` | 0 | Live installs on those CLIs. The Codex gate registers this checkout's marketplace in a scratch `CODEX_HOME`, installs the plugin, and asks Codex without a model whether it loaded the plugin, the `pan` MCP server and PAN's skills — **skipped with reason** where the CLI is absent |
| `copilot-agent-frontmatter` | 1 | A Copilot custom agent in PAN's model-list shape (`models:` + `model-policy: preferred`) loads and answers under `copilot --agent`; a paid `cli` step (Copilot credits), requires Copilot CLI 1.0.86+ |
| `plugin-agent-scope` | 1 | `/pan-plugin-selftest` inside the Claude plugin: `AGENT_SCOPE: scoped\|bare` |
| `native-exec-waves-chain` | 2 | `/pan-exec-waves` on a seeded two-plan phase: every plan gets a summary and the phase a verification |
| `markdown-exec-phase-chain` | 2 | The markdown twin on the same seed — the oracle for the chain comparison |
| `live-gate-gemini` / `-opencode` | 0 | Ask the CLI itself whether it loaded PAN's MCP registration — skipped with reason where the CLI is absent. The OpenCode gate also checks that OpenCode lists PAN's agents (`opencode agent list`) and the `.opencode/plugins/pan-wizard.js` plugin (`opencode debug config`). The Gemini gate runs every `gemini` call against a scratch home under `<other>` and proves the trust precondition both ways: `Disabled` while untrusted, then `Connected` once it trusts its own workspace |
| `live-gate-opencode2` | 0 | The same questions asked of OpenCode 2 through its `opencode2` binary (npm `@opencode/cli`): `mcp list`, `debug agents` (2.x has no `agent list`) and `plugin list --builtin`. These go through a background service that answers before it has loaded the project, so `harness/scripts/opencode-two-ready.cjs` waits for PAN's agents first and the last step stops the service. Skipped with reason where `opencode2` is absent |
| `skill-listing-claude` / `-claude-commands` | 0 | Claude Code against the model double, on a `--unified-skills` install and on a default one. No PAN skill or command description may be listed to the model (`disable-model-invocation`), and `/pan-help` and `/pan:help` must still deliver the command body when the user types them. A control restores one unmarked entry and the listing step must fail |
| `uat-walkthrough-scripted-user` | 0 | `/pan:verify-phase 1 --uat` on the `uat-pending` seed, with a scripted user answering two tests in one resumed session: a pass, then an issue. Each answer goes through `pan-tools uat record`; the engine completes the session and rebuilds the gaps. Rules match on the whole conversation and require the Bash tool, because Claude Code sends tool-less status-summary requests that quote the user |
| `focus-design-ab-original` / `-split` | 1 | The body-budget A/B: the shipped `/pan:focus-design` versus a split variant on the same seed and prompt (R21) |
| `skill-doctor-context-cost` | 1 | `/skill-doctor`'s static context cost for PAN's skills; requires Claude Code 2.1.261+ |
| `map-codebase-single-shot` | 1 | Single-shot map-codebase on a repo below the sharding threshold |
| `pause-resume` | 1 | `/pan:pause` then `/pan:resume` restores the session |
| `unified-skills-claude` | 0 | A `--unified-skills` install gives Claude Code its own copy of the compiled skills under `.claude/skills/`, because Claude does not read `.agents/skills/` (R32), and writes no flat shim (R33) |
| `unified-skills-discovery` | 1 | Claude Code, asked headlessly, names the unified `pan-` skills — ADR-0028's default-on gate, measured on the `.claude/skills/` copy since R32 |
| `plan-phase-checker-loop` | 2 | Research → plan → checker loop on an unplanned phase |
| `quick-mode` | 2 | `/pan:quick` end to end on the two-plan seed (quick mode needs a roadmap) |
| `memory-not-loaded` | 2 | `/pan:exec-phase` with a seeded agent memory store (a valid cited entry, a stale one, a quarantined directive, an archived state): no executor prompt carries any of it, the orchestrator runs no memory command, and nothing the run writes follows a seeded entry. An agent opening the folder on its own is reported, not failed (ADR-0036 and ADR-0040, amended) |
| `resume-cost` | 2 | The two-plan seed stopped halfway; a fresh session told only "continue" finishes it. Records turns, cost and time from the step's own record — the baseline for resume work |
| `context-note-headless` | 2 | A `claude -p` session with a 100K compaction window reads past the context monitor's line: PAN's note must be recorded before the host compacts, with no status-line bridge present (the transcript fallback) |
| `uat-diagnose-native` | 2 | `/pan-diagnose-issues` on a phase with one failed UAT truth and the matching real defect |
| `evidence-loop` | 0 | The evidence loop through a deployed Claude install, model-free: the installed trace hook captures failing tool calls from a subagent transcript, the installed engine records verdicts and a deferral, `optimize learn` sees the captured failures and the verifier's retry, and `optimize revert` undoes an apply byte for byte (ADR-0049) |
| `tool-error-capture` | 1 | A real subagent's failing `npm test` is recorded by the installed trace hook as an `error/tool_error` event read from that subagent's own transcript; the model step sets `persistSession: true` |
| `review-churn-live` | 2 | V6's evidence step: pan-reviewer reviews the same executed phase five times (exec-phase's `code_review` step, each report recorded), then `findings list --phase 1 --agent pan-reviewer` reports the churn. A measurement: read `churn` from the last step in `report.json` |
| `clarify-budget-greeting` / `-export` / `-ratelimit` | 2 | P1's evidence step: `/pan:discuss-phase 1` with a real model on three seeds, a scripted user with fallback answers, and `scripts/count-questions.cjs` summing the questions over the kept step records (lines ending in `?`): at most five, and a `context.md` at the end |
| `review-cross-family-copilot` | 1 | R4's evidence step: one cross-family lane run on Copilot CLI, three reps, through `scripts/cross-family-lane.cjs` (lane id, reps, Wilson interval over parseable verdicts, majority verdict). A `cli` step marked `paid`: Copilot spends premium requests, never `--max-usd`, so run it with `--max-usd 0` |

The three paid evidence steps above, and H6's mutant run, are run one at a time on the owner's
approval:

```bash
node harness/src/run.cjs --tier 2 --max-usd 10 --scenario review-churn-live
node harness/src/run.cjs --tier 2 --max-usd 10 --scenario clarify-budget-greeting --scenario clarify-budget-export --scenario clarify-budget-ratelimit
node harness/src/run.cjs --tier 1 --max-usd 0 --scenario review-cross-family-copilot
node harness/src/run.cjs --tier 2 --max-usd 15 --repeat 3 --prompt-mutant pan-wizard-core/workflows/quick:4387c189
```

## Seeds

`harness/seeds/<name>/` is copied into the workspace before install and committed as one commit (`"seed": "empty"` is reserved and means no seed). A scenario that needs history, such as a phase with a base and its own commits so `review scope` finds a diff, applies an overlay as its first step: `scripts/apply-overlay.cjs <ws> <repo>/harness/overlays/<name>` copies each `commits/<NN>-<name>/` directory over the workspace, in order, and commits only those files with the message in its `COMMIT_MSG` (`review-target-phase1` on the `review-target` seed). Seeds are written the
way PAN's own templates write them (roadmap checklist lines, the state template's `**Field:**` lines, plan files
with the `wave` / `autonomous` frontmatter `phase-plan-index` parses) — a fixture in a
format PAN never emits verifies nothing. The seeds' `state.md` does not yet meet that below its `**Field:**` lines: `## Key Decisions`, `## Active Blockers` and `## Session History` are not the template's `### Decisions`, `### Blockers/Concerns` and `## Session Continuity`, and the seeds' decision bullet lacks the template's `- [Phase N]:` prefix, so `state-snapshot` reads no decisions from them (renaming the heading alone does not change that).
