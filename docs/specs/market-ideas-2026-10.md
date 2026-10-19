# Market ideas — October 2026 (second run of `/market-ideas`)

Sized queue from the second live run of the `/market-ideas` dev skill on `2026-10-03`, against `feat/evidence-loop` @ `ab125d4` (`3.32.0`; the same tree was squash-merged as `main` @ `4cc8132` and tagged `v3.32.0`). The delta window is `2026-09-21` → `2026-10-03`, with no landscape sweep. Every idea below has a row in [market-ideas-ledger.md](market-ideas-ledger.md) (`MI-nnn`); this file holds the triage and the queue. Queue items continue the September numbering (M19–M34) so a ledger reference never needs the file name. Consume with `/execplan`.

Three scouts ran in parallel (host-tool natives, direct peers, new entrants with standards and vendor patterns) and returned tables with primary sources; the verdicts are the main session's. The run was reported in chat first and written back the same day with `--write`. Under doctrine 8 the write-back re-verified rather than re-scanned: every PAN status was grepped again, and one chat claim did not survive. `claude plugin validate` already runs in `tests/plugin-marketplace.test.cjs` whenever the CLI is present, so M30 narrowed to the GitHub skill validator. Numbers about the repository appear only as commands; counts live in `CLAUDE.md`.

## Baseline (measured this run — reproduce with the commands, never copy the numbers)

| Item | Value | Reproduce |
|---|---|---|
| Tree | `feat/evidence-loop` @ `ab125d4`, clean; `3.32.0`; newest tag `v3.32.0`, npm `latest` `3.32.0` | `git rev-parse --short HEAD && git describe --tags --abbrev=0`; `npm view pan-wizard dist-tags` |
| Ledger before this run | MI-001 to MI-061 | `grep -cE "^\| MI-" docs/specs/market-ideas-ledger.md` |
| Rate table | verified `2026-09-23` | `grep -n RATES_VERIFIED_AT pan-wizard-core/bin/lib/cost.cjs` |
| Host tools on this machine | Claude Code `2.1.280` (`stable` `2.1.285`, `latest` `2.1.288`); Codex `0.157.1` (latest `0.160.0`); Gemini CLI `0.61.0` (latest `0.62.0`); OpenCode `1.18.32` (latest `1.18.34`); Copilot CLI `1.0.88` (latest `1.0.91`); Antigravity `agy` absent | `claude --version` and each CLI's `--version`; `npm view @anthropic-ai/claude-code dist-tags` |
| Scouts | three background agents, 20–32 minutes each, 121–185 tool calls each | run transcript |

## What the scan found

**The single highest-leverage finding is a Codex loading limit.** Codex's source cuts any skill that arrives through an Agent Plugin to 8,000 bytes when it is selected, with a "was truncated" warning (`codex-rs/ext/skills/src/render.rs`, `MAX_SKILL_PROMPT_BYTES`). Many of the bodies in PAN's Agent Plugins bundle are longer (`find dist/pan-agent-plugin -name SKILL.md -size +8000c` after a build). The constant is read from source, not observed, and the docs do not mention it, so M25 confirms it live on the Codex CLI now installed here before anything is converted. It re-opens MI-015, whose SKIP rested on a Claude-only measurement and a catalog budget.

**Convergence, amended.** The window moved the market further onto PAN's verification and state-discipline thesis:

- gsd-core shipped stale-verification fingerprints and per-finding dispositions, and is building one owner per gate verdict (`GateVerdict`, epic #5056, unshipped).
- OpenSpec stopped counting skipped checks as passed.
- Anthropic's code-modernization plugin gates the build on a file of human verdicts and marks modules "changed since verified".
- Anthropic's math-proof plugin runs a judge with fresh workers and a ledger of what is proved, refuted and open.
- GitHub's Security Lab Taskflow keeps all state in a database, with the model deciding and tools executing.
- Pi 1.0 and ZCode both read `.agents/skills/`.

Three things argue the other way:

- Anthropic puts agent teams at about 7x the tokens and now argues for forked subagents on cache cost.
- spec-superflow and gentle-ai retreated from per-task subagents and from spec-driven development on cost grounds.
- The new extension surface (Claude Mods) is Claude-only and plugin-only.

The `2026-09-21` read ("converged; the gap is publication and positioning") holds with one amendment: the pressure has moved to the **cost of fresh-context fan-out**, which PAN should answer with measurement (the harness's cost per rep, the ledger) rather than a retreat. Publication remains the gap, and it now has a concrete route: Anthropic's directory takes submissions from a public GitHub repo through a developer portal.

### Triaged ideas

Verdicts: **ADOPT** take as found · **ADAPT** take in PAN's idiom · **WATCH** not yet, trigger recorded · **SKIP** reason recorded · **SEEN** ledger row holds. PAN status is grep-verified: HAVE · PARTIAL · MISSING · DECLINED.

| # | Idea (concept) | Who ships it (version · date) | PAN status (evidence) | Fit / portability | Verdict | Size | Gate | Ledger |
|---|---|---|---|---|---|---|---|---|
| 1 | Codex cuts Agent Plugin skill bodies at 8,000 bytes → short bodies that point at reference files | Codex source (`render.rs`, `host_prompt.rs`), present since about `2026-08-07`; wshobson/agents docs say the same (secondary) | PARTIAL: the bundle emits full command bodies as `SKILL.md`; many exceed the limit | Progressive disclosure · Codex via the bundle; any host with a body cap | ADAPT, live check first | M, then L | a live Codex load of a long PAN skill shows the warning or the full body | MI-015 |
| 2 | Price Codex's default model | Codex 0.159.1 (`2026-09-29`): `gpt-6.1-sol`; OpenAI pricing page | MISSING: `resolveRate('gpt-6.1-sol')` is null | Ledger accuracy · Codex | ADOPT | XS | cost test; `models check` clean for the id | MI-023 |
| 3 | Sonnet 5.5 as OpenCode's Anthropic mid tier | Claude Code 2.1.284 (`2026-09-28`) | PARTIAL: priced through the prefix fallback (same price); OpenCode's mid tier pins `anthropic/claude-sonnet-5` (`core.cjs`) | Routing currency · OpenCode | ADOPT | XS | pin test; `opencode models` lists the id | MI-023 |
| 4 | Escape free text written into planning tables | gsd-core v1.15.0 (#4918, #4960, #4971) | **Defect:** `quick.md` step 7 writes `${DESCRIPTION}` unescaped into state.md's table | State discipline · all runtimes | ADOPT | S | escape test plus a lint over workflow table templates | MI-062 |
| 5 | Decision checkpoints name their auto-pick | gsd-core v1.15.0 `auto_select` (#4912) | MISSING: auto mode takes the first option (`pan-executor.md`, `checkpoints.md`) | Safety of auto mode · all runtimes | ADOPT | S | plan-checker rule; plan-structure test | MI-063 |
| 6 | A check that did not run is never reported as passed | OpenSpec v1.13.2 (#1732); code-modernization 1.0.0 | PARTIAL: `passed` allows "test gate passed or skipped" (`verify-phase.md`); the verdict contract has no not-checked outcome | Verification pillar · all runtimes | ADOPT | S | verifier rule plus contract and adapter tests | MI-064 |
| 7 | Install verifies the hook entrypoints it registered | gsd-core v1.15.0 (#4249) | PARTIAL: `verifyInstall()` checks manifest files, not hook commands | Install correctness · all runtimes | ADOPT | S | installer test with a hook script removed | MI-065 |
| 8 | Stale-verification detection | gsd-core v1.13.0 (`2026-09-06`) and v1.15.0; code-modernization | MISSING (grep `stale`, `fingerprint` in the verify and phase modules) | Verification pillar · all runtimes | ADAPT: record the verified commit, diff since | M | temp-repo unit tests; `progress` shows stale | MI-067 |
| 9 | Dependency-ready dispatch | gsd-core v1.15.0 (#4781) | PARTIAL: after a failed plan, "Continue?" runs dependents anyway (`exec-phase.md`) | Deterministic orchestration · all runtimes | ADAPT | S | a fixture phase names the blocked plan | MI-068 |
| 10 | Name unknown config keys | OpenSpec v1.14.0 (#1925) | MISSING: `cmdConfigSet` stores any path | State discipline | ADOPT | S | unit tests; health lists unknown keys | MI-066 |
| 11 | `version --json --check` | OpenSpec v1.14.0 (#2001) | MISSING: no `version` verb | Tooling | ADOPT | S | dispatcher-arm test; surface row | MI-069 |
| 12 | GitHub's skill validator over the emitted skills | `gh skill publish --dry-run` (GitHub CLI, preview); wshobson/agents CI (secondary) | PARTIAL: `claude plugin validate` already runs when present; nothing runs GitHub's validator | Standards conformance · every skill host | ADOPT | S | test runs the validator, skips without `gh skill` | MI-070 |
| 13 | Model-free discovery checks in the Codex and OpenCode live gates | `agent-plugins-conformance` CI; wshobson/agents `validate.yml` | PARTIAL: `live-gate-codex` adds and lists the marketplace only | Behavioural evals · Codex, OpenCode | ADAPT | S | both gates pass here with no model turn | MI-071 |
| 14 | Plans record decisions, not code | Superpowers v6.4.2 (`2026-09-25`) | MISSING: no rule in `pan-planner.md`; Scope Sanity counts tasks only | Planning quality · all runtimes | ADAPT | S | planner and plan-checker text tests | MI-072 |
| 15 | State re-injection on Gemini and Copilot | planning-with-files v3.20.8 (`BeforeAgent`); Copilot CLI 1.0.88 (`sessionStart` context merge) | PARTIAL: `HOOK_EVENT_MAP` has `compact: null` for both | State discipline · Gemini, Copilot | ADAPT | M | hook-map tests; live gates on Gemini 0.61 and Copilot 1.0.88 | MI-036 |
| 16 | Audit the shipped prompts with the host's prompt audit | Claude Code 2.1.283 `/doctor prompt-audit` | MISSING | Prompt quality · runs on Claude, fixes reach every runtime | ADAPT | S | report-only run on a deployed install; findings fixed or dismissed with reasons | MI-073 |
| 17 | Claude Mods (in-process handlers, panes, `agent.spawn`) | Claude Code 2.1.287 (`2026-10-01`) | command hooks only | Claude-only, plugin-only | WATCH | — | mods on `stable` and the plugin published | MI-074 |
| 18 | Host-native worktree sessions | Codex 0.156.0 default-on; Copilot `/worktree`, `/fleet` | army is Claude-only (ADR-0033) | user-started, not dispatched | WATCH, trigger refined | — | an orchestrator can dispatch into a worktree | MI-042 |
| 19 | Stall watchdog | gsd-core v1.15.0; `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` | none, and no stall measured | — | WATCH | — | a measured stall | MI-075 |
| 20 | Native workflow scripts on Copilot | Copilot dynamic workflows (preview) | Claude-only native scripts | — | WATCH | — | leaves preview | MI-076 |
| 21 | Cross-family critique | Copilot `rubber-duck` (1.0.87); porch beta | one family per run | trigger met, re-triaged | WATCH, trigger refined | — | a planted defect missed by one family | MI-044 |
| 22 | Effort-first escalation; retry by failure class | Anthropic cost post; multiagents-workflow | tier escalation shipped (`3.31.0`) | refines MI-029 | WATCH | — | per-spawn effort on two runtimes | MI-077 |
| 23 | Map facts attached at read time | code-modernization 1.0.0 | `map-codebase` writes files only | Claude-first | WATCH | — | a measured benefit | MI-078 |
| 24 | Human-verdict file gating the build | code-modernization 1.0.0 | dispositions plus the human merge gate | — | WATCH | — | a field case it would have caught | MI-079 |
| 25 | Idea triage with a kill verdict | Spec Kit v1.0.9 `assess` | none | — | WATCH | — | user demand or a second peer | MI-080 |
| 26 | Hook-enforced read-only judges | stop-that-shit 0.2.4 | tool lists and prompts only | — | WATCH | — | a judge writing outside its report | MI-081 |
| 27 | Retire the Gemini CLI runtime | gsd-core v1.15.0 | `--gemini` kept | roster signal | WATCH | — | API-key and Vertex users lose Gemini CLI | MI-082 |
| 28 | MCP `tool-approval` extension | SEP-2848 (open) | custom nonce-bound merge gate | — | WATCH | — | SEP accepted and implemented | MI-083 |
| 29 | `omitClaudeMd`; Gemini subagents; Codex `openai.yaml` | Claude Code, Gemini CLI, Codex | triggers met by this machine's CLIs | live checks | handed off | — | `/reality-check` | MI-040, MI-051, MI-052 |
| 30 | Tasks exported to GitHub issues | Spec Kit v1.0.13 (leaving core) | none | different layer | SKIP | — | — | MI-084 |
| 31 | Plan attestation hash | planning-with-files v3.21.0 | PAN injects no plan body | nothing to guard | SKIP | — | — | MI-085 |
| 32 | Codex `/usage` as the cost view | Codex 0.156.0 | ledger | not redundant on inspection | SKIP | — | — | MI-086 |
| 33 | Antigravity `/plan` review policy | Antigravity 2.0 v2.17.0 | plan and plan-checker | not redundant on inspection | SKIP | — | — | MI-087 |
| 34 | Paid per-edit rule classifier | TypeSafe Jev plugins | none | zero-dep, no secrets | SKIP | — | — | MI-088 |
| 35 | Tests and docs per task group | OpenSpec (#1955) | `<verify>` per task, TDD plans | no measured gap | SKIP | — | — | MI-089 |
| 36 | A `verify`/`simplify` skill run before commits | Claude Code 2.1.286 | `pan-verify-phase` named apart | interaction recorded | SKIP | — | — | MI-090 |
| 37 | Publication route; OpenCode observers; Antigravity variant; `maxTurns`; fork; MCP Skills; MCP Tasks; OTel naming; sixth runtime; pricing feeds; browser plan UI; skills marketplaces | various | — | — | SEEN | — | — | MI-025 (new facts), MI-038 (v2 API fact), MI-026, MI-009, MI-013, MI-043, MI-027, MI-050, MI-017, MI-055, MI-054 (new fact, holds), MI-020 |

**Not triaged (no PAN action, kept as leads):**

- agent-console: the same offline-rate-table ledger design as PAN's.
- Intent-Router: writes verification results back into the plan file; PAN's verifier writes the phase's own report.
- Archon: a loop-end signal must sit alone on the final line; PAN's `pan-verdict` is a fenced block.
- Aegis: counts a Codex skill load as evidence from command output, a possible harness assertion.
- ZCode: source public since `2026-09-20`; reads `.agents/skills` and Claude-format plugins, a lead for the pan-zcode M0 spike.
- The Antigravity SDK's local executors.
- GitHub Taskflow's stop rule: end a loop after two iterations that each gain under 1%.
- The addyosmani lesson that gates living only in a command vanish when a host loads the skill alone. PAN's skills carry the full command body, gates included.

### Hand-offs to `/reality-check` (path or behaviour changes, not ideas)

| # | Observation | Source | Why it is reality-check's |
|---|---|---|---|
| H1 | `"attribution": false` (Claude Code 2.1.281) hides all commit and PR attribution; `getCommitAttribution()` in `bin/install.js` treats `false` as unset and keeps the default the user asked to hide | settings reference; changelog | A settings shape PAN reads wrongly; small fix with a test |
| H2 | stdio MCP servers are asked for protocol revision `2026-07-28` from 2.1.285 (rolling out); URL elicitation on `2025-11-25` from 2.1.287 | code.claude.com/docs/en/mcp | The modern path in `pan-wizard-core/mcp/server.cjs`, unit-tested only, becomes live; needs a live check after `claude update` |
| H3 | Auto mode is the starting permission mode (2.1.283 to 2.1.285); background commands are capped in unattended sessions; Workflow fixes for subagents restarted after a stalled connection (2.1.286) and late `agent()` awaits (2.1.285) | permission-modes and workflows docs; changelog | exec-waves, the army and harness `-p` runs on a current Claude Code |
| H4 | Copilot custom-agent fields are camelCase in the CLI reference (`models`, `modelPolicy`, `reasoningEffort`); 1.0.88 applies `reasoningEffort` | Copilot CLI command reference; releases | PAN's converter writes `model-policy` and no effort (MI-024) |
| H5 | Claude Code reads AGENTS.md on Bedrock, Vertex, Foundry, gateways and telemetry-off sessions since 2.1.281 | memory docs; changelog | `docs/TROUBLESHOOTING.md` still says it does not |
| H6 | Antigravity moved project config to `<repo>/.gemini/config.json`, scans directory entries flat, and gives rules their own 20,000-token budget | antigravity.google/docs/changelog | Nothing PAN writes breaks; PAN's AGENTS.md section counts against the rules budget |
| H7 | Copilot hook commands without an explicit `cwd` run in the project root again (1.0.88 fixed a regression) | copilot-cli releases | PAN's Copilot hook commands are repo-relative; a version with the regression would break them |
| H8 | Live checks now possible on this machine: `omitClaudeMd` (MI-040), Gemini subagents on by default (MI-051), Codex `agents/openai.yaml` (MI-052), Copilot field spelling (MI-024) | this machine's CLIs | MI-022: documented is not observed |
| H9 | This machine runs Claude Code `2.1.280`; `stable` is `2.1.285`, `latest` `2.1.288` | npm dist-tags | User action (`claude update`): unblocks H2, H3 and M34 |

**Hand-off outcomes (`2026-10-03`, same session, before any `/reality-check` run):**

- **H1 fixed.** `commitAttributionFromSettings()` reads `attribution: false` and the deprecated `includeCoAuthoredBy: false` as the settings reference defines them. No shipped file carries a `Co-Authored-By` line today, so installed content does not change yet. A separate mismatch was found on the way and left open: Claude's `attribution.commit` is the whole trailer text, while `processAttribution` writes a custom string after `Co-Authored-By:`.
- **H5 fixed** in TROUBLESHOOTING, from the memory docs read that day.
- **H9 done:** Claude Code updated to `2.1.288` the same day.
- **H2 found a real defect, fixed.** Claude Code `2.1.288` opens with `server/discover` and then sends `2026-07-28` on every request, so the rollout reached this machine. PAN's server showed as connected with no tools and no resources: in `2026-07-28` the tool and resource lists and resource reads are `CacheableResult`s, whose `ttlMs` and `cacheScope` are required, and the server set them only on `server/discover`. Claude Code discarded every list and kept asking for it again; a model asked to use a PAN tool found none. Found with a stdio proxy that logged every JSON-RPC line between the two. Fixed in `pan-wizard-core/mcp/server.cjs`: the registry lists are `public` with a long TTL, reads are `private` with `ttlMs: 0`, and every modern result names the server in `_meta`. Re-checked live: all PAN tools listed, `pan_roadmap_analyze` called over MCP, each list fetched once, for about three cents of Haiku. ADR-0041 amended.
- **H3 checked, nothing to change.** The harness's model steps pass `--dangerously-skip-permissions`, so auto mode as the starting permission mode does not reach them. The new time limit stops background Bash and PowerShell commands in unattended sessions; PAN starts background subagents (map-codebase), never background shell commands, so it does not apply. The native `/pan-exec-waves` chain (harness `native-exec-waves-chain`, tier 2) passed on Claude Code `2.1.288`: a summary per plan, the phase's verification and the seed's functions built, in four minutes for $2.06. The tier-0 harness passed the same tree (Antigravity skipped: `agy` is not installed).
- **Still open:** H4 and H8 need live probes; H6 and H7 need no change in PAN.

## Priority classes

From `/superplan`: **P0 BROKEN** · **P1 WRONG** (silent incorrect output, false docs) · **P2 STABILITY** · **P3 MISSING TESTS** · **P4 FEATURE GAPS** (runtime coverage, distribution) · **P5 NEW FEATURES** · **P6 DOCUMENTATION** · **P7 POLISH**. Sizes XS 1 · S 2 · M 4 · L 10 · XL 20.

## Items

| ID | Pri | Size | Pts | Title | Files | Gate / verify | Status |
|---|---|---|---|---|---|---|---|
| M19 | P1 | XS | 1 | **Price `gpt-6.1-sol`**, Codex's default since 0.159.1. Re-read OpenAI's pricing page on the day (the scout read `$2.00` input, `$0.10` cached input, `$10.00` output) and cite it in the row; move Codex's mid tier only if Codex's subagent guidance names the new model | `pan-wizard-core/bin/lib/cost.cjs`, `pan-wizard-core/bin/lib/core.cjs`, `tests/cost.test.cjs` | `resolveRate('gpt-6.1-sol')` returns the page's rates; `pan-tools models check` clean for the Codex default | Done `2026-10-03`: the `gpt-6.1-sol` row from the raw pricing page; the documented-defaults fixture names it as Codex's default. Codex's mid tier stays `gpt-6-sol`: GPT-6.1 Sol is off on Enterprise and Edu until an administrator enables it (`core.cjs` comment) |
| M20 | P7 | XS | 1 | **OpenCode's Anthropic mid tier to Sonnet 5.5** once `opencode models` lists the id; an explicit rate row is optional (the prefix fallback already prices it) | `pan-wizard-core/bin/lib/core.cjs`, the routing pin test | the pin test names the id `opencode models` prints | Done `2026-10-03`: OpenCode's Anthropic mid tier is `anthropic/claude-sonnet-5-5` (models.dev lists it). Sonnet 5.5 got its own rate row after all: the documented-defaults test (R31) requires an exact row for every alias target |
| M21 | P1 | S | 2 | **Escape free text written into planning tables.** The quick-task rows (and any other table row a workflow builds from free text) escape `\|` and fold newlines before writing; a lint test flags free-text placeholders in workflow table templates that are not escaped | `pan-wizard-core/workflows/quick.md`, a helper in `pan-wizard-core/bin/lib/` if a verb writes the row, `tests/` | a description containing `\|` leaves the table parseable; the lint fails on the old template (revert-proven) | Done `2026-10-03`: `escapeTableCell()` in `core.cjs`; `init quick` returns `description_cell` and the workflow writes it; `state record-metric` escapes its cells; review-deep uses the helper. Lint and behaviour in `tests/planning-table-escape.test.cjs` (revert-proven) |
| M22 | P1 | S | 2 | **Decision checkpoints need a named default in auto mode.** A `checkpoint:decision` may carry `auto_select` naming one of its options; auto mode takes it, and without it the checkpoint stops for a human; the plan checker fails an `auto_select` that names no option | `agents/pan-executor.md`, `agents/pan-planner.md`, `agents/pan-plan-checker.md`, `pan-wizard-core/references/checkpoints.md`, `pan-wizard-core/bin/lib/verify.cjs` (plan structure), tests | plan-structure test: a decision checkpoint without `auto_select` is flagged for auto mode; one naming a missing option fails | Done `2026-10-03`: `auto_select` in the executor, exec-phase, the checkpoints reference, the planner, the phase-prompt template, the plan checker and three user docs. `verify plan-structure` now checks each checkpoint against its own shape: it used to reject every documented checkpoint and read the `<tasks>` wrapper as a task |
| M23 | P1 | S | 2 | **A skipped gate is never a plain pass.** The verifier's `passed` names any gate that did not run and why (no test script, no browser); the verdict contract gains a not-checked list; the phase summary shows it | `pan-wizard-core/workflows/verify-phase.md`, `agents/pan-verifier.md`, `pan-wizard-core/references/verdict-contract.md`, the verdict adapter, tests | contract and adapter tests: a skipped test gate appears as not checked, never only as `passed` | Done `2026-10-03`, grown to M: exec-phase's verifier never ran the test gate at all (its prompt did not load `verify-phase.md`; code finding of `2026-09-29`). `pan-verifier` Step 8b and exec-phase's prompt run it; `test_gate` and `not_checked` in the frontmatter; `not_checked` in the verdict contract, the record, the ledger row and the trace |
| M24 | P2 | S | 2 | **Installer verifies the hook commands it registered.** After the runtime configs are written, every hook command's script path must exist (nothing is executed); a miss is reported and `verifyInstall` fails | `bin/install-lib.cjs`, `bin/install.js`, `tests/` | installer test: remove a copied hook script → reported, non-zero exit; a clean install passes on every runtime with hooks | Done `2026-10-03`: `verifyHookEntrypoints()`; the install exits 1 before writing any runtime config. End-to-end tests from a source copy without `hooks/dist` (Claude, Codex), revert-proven |
| M25 | P1 | M | 4 | **Confirm the Codex skill cut live** (MI-015). Build the Agent Plugins bundle, install it into a scratch Codex home under `d:\pantesting`, select a skill over 8,000 bytes, and look for the truncation warning or the cut body. Use a model-free path if Codex exposes the rendered prompt, otherwise one capped `codex exec` turn. Record the result in the ledger; if confirmed, size the conversion (S8) | `harness/scenarios/` (a live-gate step), `docs/specs/market-ideas-ledger.md` | the probe's output saved; MI-015 carries the observed behaviour | Done `2026-10-03`, **confirmed**: through an Agent Plugin, Codex 0.157.1 injects the first 8,000 bytes of a skill (cut mid-sentence, with a "was truncated" warning item); a 3,188-byte plugin skill arrives whole; the `--codex` install's `.agents/skills/` copy of the same 54,677-byte skill arrives whole. Method: a capture-only mock Responses provider, no model, no login. Evidence: `d:\pantesting\codex-skillcut-probe-20261003-141126\RESULT.md` |
| M26 | P2 | S | 2 | **Name unknown config keys.** `config-set` warns on a key path outside the known schema; `validate health` lists unknown keys in `.planning/config.json` as info; the known list derives from the config defaults, not a second hand-kept list | `pan-wizard-core/bin/lib/config.cjs`, `pan-wizard-core/bin/lib/verify.cjs`, tests, `docs/CLI-REFERENCE.md` | a typo key warns and a known key is silent; health lists unknown keys | Done `2026-10-03`: `config-set` warns with the nearest known key; `validate health` I006. The defaults alone are not the schema (alias keys, open sections, keys read outside loadConfig), so one list sits beside them, pinned by a test against the keys the shipped prose reads and writes |
| M27 | P2 | M | 4 | **Stale-verification marker.** The verifier records the commit it verified; `progress` and `verify` report the phase `stale` when files in its scope changed since that commit | `agents/pan-verifier.md`, `pan-wizard-core/workflows/verify-phase.md`, `pan-wizard-core/bin/lib/verify-scope.cjs` or `phase.cjs`, the progress output, tests | temp-repo tests: verify at A, edit a phase file at B → stale; an unrelated change → not stale | Done `2026-10-03`: `verified_commit` in the verifier's template and in verify-phase; `pan-tools verify stale <phase>`; `progress json` and `progress table` mark a stale verification |
| M28 | P2 | S | 2 | **Dependency-ready dispatch after a failed plan.** When the user continues past a failed plan, plans whose `depends_on` includes it are skipped and named, not run | `pan-wizard-core/workflows/exec-phase.md`, a `pan-tools` helper that lists blocked plans if the index lacks one, tests | fixture phase: plan 02 depends on failed plan 01 → 02 reported as blocked | Done `2026-10-03`: `depends_on` in the plan index; `--failed` lists the blocked plans (transitive; full id or plan number); exec-phase skips and names them. The native exec-waves twin already halts on any failure |
| M29 | P5 | S | 2 | **`pan-tools version [--json] [--check]`**: version, install location, update state (available, current, offline, disabled) from the update check's cache, never a throw offline | `pan-wizard-core/bin/pan-tools.cjs`, a lib module, tests, `docs/CLI-REFERENCE.md`, `tests/fixtures/surface.json` | dispatcher-arm test; `--check` offline reports `offline` | Done `2026-10-03`: `pan-tools version [--check]`, update state from the update check's cache only |
| M30 | P3 | S | 2 | **GitHub's skill validator over the emitted skills.** A test builds the skills into a temp dir and runs `gh skill publish --dry-run`, skipping when `gh skill` is absent (`claude plugin validate` already runs in `tests/plugin-marketplace.test.cjs`) | `tests/` | passes here (gh 2.102); skips cleanly without it | Done `2026-10-03`: `license` (from `package.json`) in all three skill converters; `tests/skill-validator.test.cjs` runs the validator over the bundle and a Codex and a Copilot install (passes here on gh 2.102; skips without it). The remaining warnings are long bodies (S8) |
| M31 | P3 | S | 2 | **Model-free discovery in the Codex and OpenCode live gates**: `codex plugin add --json` (the installed path), `codex app-server` MCP status (PAN's server listed), `opencode agent list` (PAN's agents listed), all under a scratch home; skip without the CLI | `harness/scenarios/live-gate-codex.json`, `harness/scenarios/live-gate-opencode.json`, the harness runner if a step kind is missing | both gates pass here (Codex 0.157.1, OpenCode 1.18.32) with no model turn | Done `2026-10-03`: both gates pass live here (Codex 0.157.1, OpenCode 1.18.32, no spend). Found on the way: the Codex gate had been writing into the user's real `~/.codex/config.toml`; every codex step now runs under a scratch home (`harness/scripts/scratch-home.cjs`) |
| M32 | P5 | S | 2 | **Plans record decisions, not code.** The planner names signatures, assertions, values and the verify command instead of implementation bodies; the plan checker flags plans that embed implementation | `agents/pan-planner.md`, `agents/pan-plan-checker.md`, tests on the agent text | text tests; a chain rep's plans follow the rule | Done `2026-10-03`: the planner's "Decisions, Not Code" section, the plan checker's red flag, and a `verify plan-structure` warning on a code block over 20 lines in an `<action>` |
| M33 | P4 | M | 4 | **State re-injection on Gemini and Copilot** (MI-036). Neither host has a post-compaction start event, so the design is per host. A pre-compaction hook (`PreCompress`, `preCompact`) marks the session, and the next turn-start hook that honours added context injects the block once. Re-read both hook references first | `hooks/pan-state-reinject.js`, `bin/install-lib.cjs` (`HOOK_EVENT_MAP`), `bin/install.js`, `tests/hooks-e2e.test.cjs`, `docs/HOOKS.md` | hook-map tests; a live gate on Gemini 0.61 and Copilot 1.0.88 shows the block after a compaction | **Done `2026-10-03`.** Design read from the hosts' docs that day. Gemini (v0.61.0 `docs/hooks/reference.md`): `SessionStart` sources are `startup` \| `resume` \| `clear`, no compact; `PreCompress` is advisory and async (output: `systemMessage` only); `AfterTool` and `BeforeAgent` take `hookSpecificOutput.additionalContext`. Copilot (hooks reference): `sessionStart` sources `startup` \| `resume` \| `new`; `preCompact` is notification-only; command-hook output on `userPromptSubmitted` is dropped; `postToolUse` takes a top-level `additionalContext`. Built as designed: `--mark` on the pre-compaction event writes a per-session marker under `os.tmpdir()` (never in the project) when a phase is in flight, and `--inject <host>` on the next tool result (`AfterTool`, `postToolUse`) consumes it and injects the block once. The installer's settings.json loop keeps a hook under every event it registers on (a keep-set passed to `stripPanHookEntries()`). The R39 question dissolved: the Claude registration a Copilot session also runs is the `SessionStart` mode, which no Copilot start matches. Revert-proven: with the inject disabled the marker tests fail, and with the keep-set disabled the Gemini registration tests fail. **Live, Copilot CLI 1.0.88: passed.** A manual `/compact` in prompt mode fired `preCompact` (`trigger: manual`) and left the marker; the next run's first `postToolUse` consumed it, Copilot appended the block to the tool result as "Additional guidance from postToolUse hooks", and the model quoted it verbatim. The payloads carry `sessionId` and `cwd` on both events. Cost about ten AI credits on the user's Copilot plan, most of it the compaction and the resumed run. **Live, Gemini CLI 0.61.0: blocked.** This machine's sign-in is a personal Google login, which Gemini Code Assist now refuses (`IneligibleTierError`); the check needs a `GEMINI_API_KEY` from the user. Not carried into the Agent Plugins bundle's Copilot `hooks/hooks.json`, whose PascalCase aliases' payload and output shapes are unconfirmed |
| M34 | P7 | S | 2 | **Prompt audit of PAN's shipped prompts.** Run `/doctor prompt-audit` against a deployed install under `d:\pantesting` (`.claude/commands/pan`, `.claude/agents`); fix real findings in the sources and record dismissed ones with reasons | the sources the audit names | the report is clean, or every finding is fixed or dismissed with a reason | **Done `2026-10-03`** on Claude Code `2.1.288`: `claude -p "/doctor prompt-audit"` in a fresh `--claude` install under `d:\pantesting`, with Edit, Write and Bash disallowed and a $10 cap; it cost $9.18 and fanned out to parallel reviewers. Each high-confidence finding and each clear stale fact was checked against the source before it was fixed. One was partly wrong: the TOGAF sections it said no template has are in the full codebase templates; the real gap was that the agent never pointed at them. One was dismissed: "plan as before" still refers to something that exists. The rest are fixed (CHANGELOG), and `tests/prompt-audit-fixes.test.cjs` pins each class across all shipped files, each check proven against the pre-fix files. Found on the way: `pan-tools drift-check` read only `CONVENTIONS.md`, which Linux never matched, and focus-auto never forwarded `--enforce-budget` and its other init flags. The style findings moved to M35. Left open: pan-project-researcher's Step 2 and checklist still assume one researcher covers every dimension, and its commit ownership disagrees with the synthesizer's; exec-phase's `--hierarchical` flag has no workflow step that spawns the conductor; `THINKING_BUDGETS` in `constants.cjs` is exported and read nowhere |
| M35 | P7 | M | 4 | **Prompt-style pass, measured (from M34's audit).** The audit's style findings, deferred: shouted CRITICAL/MUST/NEVER emphasis (the "Mandatory Initial Read" block in most agents, "Project Scope Boundary" in the focus commands), reasoning and planning scaffolds (debug, focus-design, assumptions, quick and several agents), strategy coaching and tool-priority lists, parallel-call tips, history notes in shipped prompts (version tags, incident ids, paper citations), and context-management steps a model cannot carry out ("DISCARD raw tool output", attention anchors), plus the audit's low-confidence flags. Each changes how a prompt reads without fixing a wrong fact, path, flag or tool grant, and whether it helps or hurts is a behavioural question: the audit did not run its own before/after check | `commands/pan/*.md`, `agents/*.md` | a harness A/B on the affected commands (the `focus-design-ab-*` pattern) shows equal or better outcomes before the edits ship | Open `2026-10-03`, deferred from M34 |

## Session queue

| Session | Items | Pts | Theme | Exit criterion |
|---|---|---|---|---|
| **S5** | M19, M20, M21, M22, M23, M25 | 12 | Correctness | the Codex default is priced; no planning table breaks on a `\|`; auto mode never takes an unnamed option; no skipped gate reads as a plain pass; the Codex cut is observed or refuted |
| **S6** | M24, M26, M27, M28, M30, M31 | 14 | Stability and gates | an install with a missing hook script fails verification; config typos are named; a stale verification is visible; dependents of a failed plan are named, not run; GitHub's skill validator and model-free Codex and OpenCode discovery run here |
| **S7** | M29, M32, M33, M34 | 10 | Coverage and behaviour | `version --check` exists; plans carry decisions, not code; Gemini and Copilot get state back after compaction; the prompt audit ran. **M29, M32 and M33 done `2026-10-03`** (M33 live on Copilot; Gemini blocked on its sign-in) |
| **S8** | progressive-disclosure SKILL bodies for the Agent Plugins bundle (**M25 confirmed the cut on `2026-10-03`**; the `--codex` install is unaffected, so only the bundle's builder changes) | 10 | Packaging | every bundled skill body fits under the limit and points at its reference files; a Codex probe shows no truncation warning; Claude's command path unchanged. **Done `2026-10-03`** (ADR-0045 D9): long skills are a pointer `SKILL.md` + `references/instructions.md` via `splitOversizedSkill()`; an equivalence test rebuilds every skill; the live re-probe got the 3,116-byte page whole with no warning |

Ordering rationale. S5 fixes what is wrong today. Each P1 item produces a wrong state or a wrong verdict without saying so: an unpriced default model, a table a `|` breaks, auto mode taking whatever option is listed first, a pass with no tests. M25 is in S5 because a confirmed cut would be the largest silent defect PAN has on Codex. S6 protects what S5 changed: a verification that knows when it went stale, dispatch that respects dependencies, and gates that run the hosts' own validators. S7 holds the behavioural and per-host changes, which carry the real risk and need live CLIs. M34 also needs a newer Claude Code than this machine runs. S8 is sized only after M25, so a conversion is never built on an unobserved limit (MI-022).

**Execution (`/execplan`, `2026-10-03`, branch `feat/market-ideas-2026-10`).** S5, S6 and M29 and M32 of S7 were built, tested (each code change revert-proven) and installed into all five runtimes from a clean directory. M23 grew from S to M once the exec-phase verifier turned out to run no test gate at all. M33 is deferred with its design recorded in its row; M34 waits on a newer Claude Code; S8 is the next session's lead item, sized by M25's measurement. **Continued the same day:** S8 and the hand-offs H1 and H5 shipped; with paid live checks approved by the user, M33 was built and passed live on Copilot (Gemini blocked on its sign-in); Claude Code `2.1.288` unblocked M34.

## What not to do — carried forward and re-affirmed

All the inherited entries hold. Three additions with reasons:

- **Do not move PAN's observers into Claude Mods.** Mods are Claude-only and plugin-only. Command hooks are the portable path, and the peer that ships mods keeps command hooks as its default and fallback (MI-074).
- **Do not answer the cost of fresh-context fan-out by retreating from it without a measurement.** Two frameworks dropped per-task subagents on cost grounds this window. PAN's answer is the harness's cost per rep and the ledger, the same measurement that settled MI-002, not a pillar trade.
- **Do not ship a skill named `verify` or `simplify`.** Claude Code runs a project skill by either name before every commit (MI-090).

## Sources read for this run (all `2026-10-03` unless dated)

**Claude Code:**
- `raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`, with versions dated from `registry.npmjs.org/@anthropic-ai/claude-code` `time`.
- `code.claude.com/docs/en/{model-config,plugins/mods,plugins/mods/reference,memory,settings-reference,mcp,permission-modes,workflows,skills,plugins-reference,plugins/publish,plugins/marketplace-reference}` and `claude.com/docs/plugins/submit` (undated).
- Blog posts on `claude.com/blog`: `claude-code-mods` (`2026-10-01`), `build-plugins-for-claude` (`2026-09-25`), `claude-opus-5-5-built-for-coding-sessions-that-use-more-context` (`2026-09-24`), `what-a-task-costs-on-opus-5-5` (`2026-09-25`).

**Anthropic official marketplace:**
- `anthropics/claude-plugins-official` `marketplace.json`, parsed raw at `c447c32` (`2026-09-18`) and `d182ca4` (`2026-10-02`).
- `plugins/code-modernization/hooks/README.md` and its CHANGELOG; the `plugins/math-proof` README.

**Codex:**
- GitHub releases API `openai/codex` (`per_page=40`, three pages; `per_page=100` returned 504).
- `learn.chatgpt.com/docs/{models,changelog}`.
- `developers.openai.com/api/docs/pricing` and `/api/docs/guides/prompt-caching.md`.
- `developers.openai.com/plugins/*`, including the undated guide to submitting a Claude Code plugin.
- Codex source on `main`: `codex-rs/ext/skills/src/{render.rs,host_prompt.rs,extension.rs}`.
- `openai.com/news/rss.xml`.

**Gemini CLI and Antigravity:**
- Releases API `google-gemini/gemini-cli`; PR #29443; `models.ts` and `cli/config.ts` at v0.62.0.
- `geminicli.com/docs/core/subagents`.
- `antigravity.google/docs/{changelog,subagents,hooks,models}`.
- `developers.googleblog.com`, Antigravity SDK local-models post (`2026-09-23`).

**OpenCode:** releases API `anomalyco/opencode`; `opencode.ai/docs`; `opencode.ai/v2/docs/build/plugins`; npm `opencode-ai`.

**Copilot:**
- Releases API `github/copilot-cli` (1.0.87 to the 1.0.92 prerelease).
- The Copilot CLI command reference and hooks configuration.
- `docs.github.com/en/copilot/concepts/agents/about-plugins`; the dynamic-workflows how-to.
- `github.blog/changelog`: dynamic workflows (`2026-10-01`), Sonnet 5.5 (`2026-09-28`), model deprecations (`2026-10-02`).

**Peers** (releases API `published_at` plus docs and PRs):
- `github/spec-kit`: v1.0.9 to v1.1.0; PRs #4504 and #4488; `workflows/assess/workflow.yml`.
- `bmad-code-org/BMAD-METHOD`: no release; main commits.
- `open-gsd/gsd-core`: v1.15.0; PRs #4912, #4749, #4818, #4918, #4960, #4971, #4781, #4585, #4249, #4716, #4743, #3861; `.out-of-scope/claude-code-mod-adapter-in-core.md`; epic #5056.
- `obra/superpowers`: v6.4.2.
- `Fission-AI/OpenSpec`: v1.13.2 and v1.14.0; PRs #1732, #1955, #2001, #1925.
- `eyaltoledano/claude-task-master`: dormant.
- `OthmanAdi/planning-with-files`: v3.20.5 to v3.22.0; the `opencode-planning-with-files` README.

**Entrants** (README plus releases API):
- Harnesses and orchestration: `zai-org/ZCode`, `wshobson/agents` (`validate.yml`, `tools/tests/test_cli_smoke.py`), `ccai40359-wq/multiagents-workflow`, `CodeAlive-AI/pragmatic-orchestration`, `ruvnet/ruflo`, `coleam00/Archon`.
- Observability and rule enforcement: `LockedinLabs-AI/agent-console`, `coldteadotai/abide`, `kunchenguid/compact-adviser`, `tamaratran/fast-jev-compaction`, `lennney/stop-that-shit`.
- Skills and spec frameworks: `angel291592/Intent-Router`, `addyosmani/agent-skills`, `GanyuanRan/Aegis`, `MageByte-Zero/spec-superflow`, `Gentleman-Programming/gentle-ai`.

**Standards:**
- Agent Skills: `agentskills/agentskills` commits and PRs #573, #546 and #590.
- Agent Plugins: `agentplugins/agent-plugins-spec` PRs #82, #79, #80, #67, #66 and #85; `agentplugins/agent-plugins-conformance` (README, `ci.yml`, `scripts/smoke-codex.mjs`).
- `earendil-works/pi` `docs/skills.md`; `cli/cli` releases (`gh skill`).
- MCP: `modelcontextprotocol/modelcontextprotocol` commits and SEPs 3398, 3392, 2848 and 2145; `modelcontextprotocol/ext-skills` (`client-matrix.mdx`); `modelcontextprotocol/ext-tasks` releases.
- `agentsmd/agents.md`.
- `open-telemetry/semantic-conventions-genai` commits `771e321`, `b9ecbae` and `8ffdf56`.

**GitHub blog** (RSS `content:encoded`): the Security Lab Taskflow posts (`2026-09-24`, `2026-09-28`) and "When chat is the wrong UI" (`2026-09-24`).

**Secondary-only material, never carrying a verdict:**
- Star counts.
- ruflo's notes on when mods became the default.
- wshobson's statement about the Codex truncation.
- Superpowers' reported planning gains.
- Vendor cost figures: Anthropic's 7x for agent teams and Google's local-token share.

**Dead ends:**
- `openai.com/news` and its index pages return 403 (the RSS feed works).
- `sst/opencode` moved to `anomalyco/opencode`. ("No OpenCode 2.x is released" was wrong: v2 ships as `@opencode/cli`, corrected `2026-10-11`, see the Addendum.)
- `learn.chatgpt.com/docs/changelog.md` returns 404 (the HTML works).
- `code.claude.com` `plugin-marketplaces` is now a tutorial; the reference moved to `plugins/marketplace-reference`.
- `geminicli.com/docs/cli/model-selection` returns 404.
- Two pages could not be dated: Anthropic's directory portal and OpenAI's plugin-submission guide.

## Addendum — `2026-10-11` (Superpowers read, doc audit, reality check)

Three runs on one day, on `feat/memory-optimization-2026-10` @ `4994ed5` (`3.34.0`) plus the doc audit's working tree: a same-window `/market-ideas` re-verify with a feature-level read of Superpowers (v7.0.0, `2026-10-10`), a `/doc-audit --all --fix` (twelve auditors, four verifier rounds), and a `/reality-check` (claims audit, packed five-runtime install, open-move ledger, runtime surfaces). Ledger rows MI-110 to MI-126; this addendum carries their queue.

### Corrections to this plan

- **M35 named two items.** The ledger's MI-107 and MI-023 called the Sonnet 5.5 cache-read fix "M35", while the Items table above uses M35 for the prompt-style pass. M35 stays the prompt-style pass (open); the rate fixes are M36 below.
- **M36, M37 and M38 had no row.** The third run's built items (`2026-10-10`) shipped in `3.34.0` without queue rows; they are added below.
- **M34's leftovers:** two of the three are fixed in `3.34.0` (`--hierarchical` routes to `pan-conductor`; the project researcher defers commits to the synthesizer). Still open: `THINKING_BUDGETS` in `constants.cjs` is exported and read nowhere.
- **The dead end "no OpenCode 2.x is released" is wrong.** OpenCode 2 ships as the npm package `@opencode/cli` (2.0.0 on `2026-09-11`, 2.0.26 on `2026-10-08`) with no GitHub release tags; this run's checks read only `opencode-ai` and the releases API.
- **H-items:** H2 (the MCP `2026-07-28` path) was a real bug, fixed in `3.33.0`; H1 is fixed; the H1 side mismatch (`attribution.commit` written as a whole trailer while `processAttribution` prefixes `Co-Authored-By:`) is still open and latent.

### Items

| ID | Pri | Size | Pts | Title | Files | Gate / verify | Status |
|---|---|---|---|---|---|---|---|
| M36 | P1 | S | 2 | **Rate rows for the newest models**: Sonnet 5.5 cache reads at the page's rate, a Haiku 5.5 row with its long-prompt tier, the Haiku capability row and fallback profile, the OpenCode fast tier (MI-023, MI-107) | `pan-wizard-core/bin/lib/cost.cjs`, `bin/install-lib.cjs`, `core.cjs` | `tests/cost-long-prompt.test.cjs`; rates re-read from the pricing page | **Done**, released in `3.34.0` |
| M37 | P7 | XS | 1 | **Node compile cache for the CLI** in a per-user 0700 directory (MI-108) | `pan-wizard-core/bin/pan-tools.cjs` | `tests/compile-cache.test.cjs` | **Done**, released in `3.34.0` |
| M38 | P5 | S | 2 | **Stop on the host's usage window**: `cost limits`, focus-auto `weekly_limit`, the army check (MI-109) | `cost.cjs`, `focus.cjs`, `hooks/pan-statusline.js`, `commands/pan/army.md` | `tests/host-limits.test.cjs` | **Done**, released in `3.34.0` |
| M39 | P1 | S | 2 | **Every subagent spawn names its model** (MI-110): the remaining `general-purpose` spawns in `discuss-phase.md`, `exec-phase.md`, `plan-phase.md` and `transition.md` pass a resolved model, or move to named agent types | those workflows | a test that fails on any `Task(`/`subagent_type=` block in shipped workflows and commands without `model=` | **Done `3.35.0`** (`18efcb5`; recorded `2026-10-19`): program L4 gave the remaining `general-purpose` spawns a resolved `model=`, and `scripts/prompt-lint.cjs` (`untyped-spawn`) fails a spawn without one; the debugger and template spawns were fixed by the doc audit |
| M40 | P1 | XS | 1 | **No positional `$N` in command bodies** (MI-111) | `tests/shipped-content-prefix.test.cjs`, `commands/pan/hud.md`, `commands/pan/report.md` | the test (proven red on the two bodies first) | **Done `2026-10-11`** (working tree) |
| M41 | P2 | M | 4 | **Review Focus in plans** (MI-112): the planner names up to five implied inputs no test covers, each pinned to a test in its owning task; the plan-checker checks it | `agents/pan-planner.md`, `agents/pan-plan-checker.md`, the plan template | a plan-checker fixture | **Done `2026-10-18`** as program P4, commit `f427e4f` on `feat/sprint-3b` (unreleased) |
| M42 | P2 | S | 2 | **Executor concerns and cost-if-wrong** (MI-113): a `DONE_WITH_CONCERNS` result; each deviation records why and its cost if wrong; the exec-phase report lists them | `agents/pan-executor.md`, the summary template, `workflows/exec-phase.md` | a contract test on the executor's return | **Done `2026-10-18`** as program P4, commit `f427e4f` on `feat/sprint-3b` (unreleased) |
| M43 | P3 | S | 2 | **A no-guidance baseline arm in the harness** (MI-114), then run M35 through it | `harness/scenarios/`, `harness/README.md` | an A/B run with a control arm | Open: the arm is built (program H3, `3.35.0`, `18efcb5`: a scenario can declare arms, and `quick-mode` declares `no-guidance`); the run through it needs `--max-usd` |
| R45 | P1 | S | 2 | **OpenCode 2 plugin**: add `setup(ctx)` with `ctx.session.hook("compaction", …)` beside `server()` in one default export (MI-038). v1 calls `server()`, v2 calls `setup()`; OpenCode ≥1.18.29 | `pan-wizard-core/opencode/pan-wizard.js`, `tests/opencode-plugin.test.cjs` | unit test of both entry points; a live check on `@opencode/cli` 2.0.26 shows the block in a compaction (the event's `system` array is read from the binary, not the docs) | **Done `3.35.0`** (`18efcb5`; recorded `2026-10-19`): the plugin exports `{ id, server, setup }`, unit-tested on both loaders; the live OpenCode 2 check has not run (OpenCode 1.x on this machine) |
| R46 | P1 | M | 4 | **Code-enforce the verifier's test gate**: a verification with `test_gate: failed` routes to gaps however its status reads (today only the verifier's prompt forces it; the recorder warns `test_gate_failed_under_pass` and keeps `passed`) | `pan-wizard-core/bin/lib/verdict.cjs` or `workflows/exec-phase.md`, tests | a test where a failed gate under `passed` does not reach phase completion | **Done `3.35.0`** (`18efcb5`; recorded `2026-10-19`): program V9 records `passed` over a failed test gate as `gaps_found` (`verdict.cjs`), and the V1 phase gate refuses it |
| R47 | P2 | M | 4 | **OpenCode uninstall and re-merge recognise both shapes**: strip PAN's entries from v2 `permissions[]` and `mcp.servers.pan` as well as the v1 keys; never add a legacy key beside a native one. Keep writing v1 (the published schema is still v1 and closed) | `bin/install.js` (uninstall, `configureOpencodePermissions`), `bin/install-lib.cjs` (`mergeMcpRegistration`, `stripMcpRegistration`) | tests on a v2-shaped `opencode.json` | **Done `3.35.0`** (`18efcb5`; recorded `2026-10-19`): program R47 |
| R48 | P2 | XS | 1 | **Drop the Copilot attribution fallback to `~/.copilot/config.json`**, which Copilot 1.0.93 ignores for user settings | `bin/install.js` | a test | **Done `3.35.0`** (`18efcb5`; recorded `2026-10-19`): program R48, attribution from `settings.json` only |
| R49 | P3 | S | 2 | **Re-run `resume-cost` and `memory-not-loaded` live**: both ledger findings are unresolved, and their passes were re-scored from recorded transcripts, never re-run | `harness/` | tier-2 runs pass and the ledger rows resolve | Waits on a per-run `--max-usd` approval (no standing cap, owner `2026-10-12`) |

### Session queue

| Session | Items | Pts | Theme | Exit criterion |
|---|---|---|---|---|
> Superseded `2026-10-12` by `product_excellence_program_2026_q4_featureai.md` §3.3: R45 → W1, R46 → V9/V1, M39 → L4, M41/M42 → program P4 (W3), M43 → H3/S4 (deletion arm). R47, R48, R49 and M35 stay here and run alongside the program's waves.

| **S9** | R45, R46, M39, R48 | 9 | Correctness | the plugin loads on OpenCode 2; a failed test gate cannot pass a phase; no spawn inherits the session model |
| **S10** | R47, M41, M42 | 10 | Stability and plans | a v2-converted OpenCode config uninstalls cleanly; plans carry Review Focus; executors report concerns |
| **S11** | M43 then M35, R49 | 8 + spend | Measured behaviour | prompt changes ship only behind a baseline arm; the two open harness findings resolve |

### What not to do — added `2026-10-11`

- **Do not emit OpenCode v2 config shapes.** v2 normalises the v1 shapes in memory, and the published `$schema` is still the closed v1 schema, so writing `permissions` or `mcp.servers` would break OpenCode 1.x users for no gain (MI-038).
- **Do not take the always-on bootstrap skill.** It trades progressive disclosure for recall (MI-119).

### Sources read (`2026-10-11`)

- `github.com/obra/superpowers` at `v7.0.0` (shallow clone of `main`, nothing executed), its releases API (`published_at`), `RELEASE-NOTES.md`; `obra/superpowers-marketplace`; `prime-radiant-inc/superpowers-evals` and sibling repos (repo metadata and READMEs).
- Marketplaces, raw JSON parsed: `anthropics/claude-plugins-official` `.claude-plugin/marketplace.json`, `openai/plugins` `.agents/plugins/marketplace.json`, `xai-org/plugin-marketplace`, `github/copilot-plugins`, `github/awesome-copilot`, `cursor/plugins`.
- OpenCode: `opencode.ai/v2/docs/{permissions,config,migrate-v1,build/plugins}`, `opencode.ai/config.json`, `npm view @opencode/cli`, strings read from the `@opencode/cli-linux-x64@2.0.26` binary (not run), `anomalyco/opencode` v1.19.0.
- Host tools: npm `@anthropic-ai/claude-code` time and dist-tags plus the raw CHANGELOG; releases APIs for `openai/codex`, `google-gemini/gemini-cli`, `github/copilot-cli`; `platform.claude.com` models and pricing.
- Antigravity: `antigravity.google/docs/plugins` (undated; its schema URL returns 404).

## Addendum — `2026-10-19` (delta scan)

A delta run of `/market-ideas` for `2026-10-11` → `2026-10-19`, on `claude/quirky-thompson-2c5aa3` @ `127389f` (`3.36.0`, `main` @ `e7d1011` plus the unmerged deprecate-sweep fix). Three scouts ran in parallel (host tools · direct peers · entrants and standards), and one claim was probed live on this machine. Ledger rows MI-127 to MI-143; this addendum carries their queue.

### Baseline (reproduce with the commands, never copy the numbers)

| Item | Value |
|---|---|
| Tree | `claude/quirky-thompson-2c5aa3` @ `127389f`, docs being written |
| Version | `package.json` `3.36.0`; newest tag `v3.36.0` |
| Ledger | count rows with `grep -cE "^\| MI-" docs/specs/market-ideas-ledger.md` |
| Window | `2026-10-11` → `2026-10-19`, delta only |
| Rate table | `RATES_VERIFIED_AT` in `pan-wizard-core/bin/lib/cost.cjs` reads `2026-10-10` |
| CLIs here | Claude Code 2.1.302 (`stable` 2.1.292, `latest` 2.1.303), Codex 0.163.0, Gemini CLI 0.64.0, OpenCode 1.19.3, Copilot CLI 1.0.98; `agy` absent |

### What the scan found

- **A live defect (MI-127).** Claude Code refuses a subagent's `Write` when the file's basename is `summary.md`, `report.md`, `findings.md` or `analysis.md`, in any case and any directory. gsd-core found it on 2.1.301. A probe on this machine's Claude Code reproduced it, while `01-01-summary.md` and `research-summary.md` wrote fine. PAN's research synthesizer writes `.planning/research/summary.md`, which new-project, milestone-new and the roadmapper read, and `pan-conductor` writes `.planning/orchestration/summary.md`. Research synthesis on Claude Code therefore fails at its write step today.
- **Model churn.** Copilot deprecates Claude Opus 4.8, Claude Opus 5 and GPT-5.6 Terra on `2026-11-16`, and PAN's recommended reasoning tier still names two of them (MI-128). Gemini 4 Argon is generally available with a price change scheduled for `2026-12-01`, and PAN cannot price it (MI-129).
- **Peers hardened their plan and gate checks** (gsd-core v1.17.0 and v1.18.0): truncated-plan detection, baselining a plan's own grep gates, monitors registered only where they can measure, fail-closed artifact lookup, and scope-checked state writes. The first three are queued; the rest are WATCH.
- **Anthropic described its own code-review practice** (`2026-10-15`). Most of it PAN already has (dispositions, clean twins in the corpus, review scope). The "pre-existing" finding class is new (MI-135), and the round cap is WATCH (MI-139).
- **No standard moved.** Agent Plugins 1.1.0 is still a draft, MCP has no core change (the Tasks working-group SEP and SEP-2848 are open), and OTel GenAI is still `development`.

### Hand-offs to `/reality-check` (path or behaviour changes, not ideas)

- **Copilot runs Claude's hooks too.** The Copilot hooks reference says the CLI also reads `.claude/settings.json` and `.claude/settings.local.json` hooks and runs every source (since 1.0.12). **Refuted as a PAN defect by the same-day reality check:** each Copilot-registered hook's `.github/hooks` copy defers to a Claude registration of the same script (`deferToClaudeRegistration`, pinned by `tests/copilot-hook-dedupe.test.cjs`).
- **OpenCode 2 is arriving.** Homebrew Core tracks OpenCode 2 (`@opencode/cli` 2.0.32), 1.19.0 offers `opencode upgrade --major`, and gsd-core reports renamed tool ids (`shell`, `patch`), dropped `opencode run` flags and a 1.x freeze on `2026-12-31`. Check PAN's permissions and tool names on 2.x; the installer does not detect the generation (MI-038).
- **Claude Code 2.1.302 turns fork subagents on by default** in `claude -p`, the Agent SDK, the desktop app and VS Code, and runs a subagent's own Agent calls in the foreground there. Confirm that PAN's typed spawns stay fresh-context in harness `-p` runs (ADR-0046 D6).
- **Claude Code idle compaction** (2.1.299; `idleCompaction`, `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`). Confirm that PAN's post-compaction re-injection (`SessionStart` `compact`) fires after an idle compaction.
- **Codex 0.163.0 adds a configurable default plugin activation policy.** Check whether the Agent Plugins bundle is active by default after install.
- **Copilot 1.0.99 prereleases** apply path-specific `.github/instructions` automatically and install verified plugins from GitHub install links (MI-025, MI-098).
- **Entrant claims about hosts, unverified at the host:** agentic-project-management v1.0.3 says Antigravity CLI no longer loads `.agents/workflows/` and that Codex rejects `/` in command names; dryforge v1.3.8 moved to "the current Codex plugin format".

### Items

| ID | Pri | Size | Pts | Title | Files | Gate / verify | Status |
|---|---|---|---|---|---|---|---|
| M44 | P0 | M | 4 | **Subagent-refused basenames** (MI-127): rename the synthesizer's output (for example `research-summary.md`, which the probe wrote) and the conductor's (`orchestration-summary.md`). Readers fall back to the old name for existing projects | `agents/pan-research-synthesizer.md`, `agents/pan-conductor.md`, `agents/pan-roadmapper.md`, `workflows/new-project.md`, `workflows/milestone-new.md`, the research template references | a prompt-lint rule that fails when an agent with Write is told to write a refused basename (proven red on the two agents first), plus a live research run on Claude Code that leaves the file | Open |
| M45 | P1 | XS | 1 | **Recommended reasoning tier names a live model** (MI-128): `RECOMMENDED_MODELS.reasoningTier` names Opus 5.5 instead of Opus 5 and Opus 4.8 | `bin/install.js` | a test on the advisory's names | Open |
| M46 | P1 | S | 2 | **Gemini 4 Argon rate row** (MI-129), with the price re-read from the pricing page on the day it is written; the `2026-12-01` change is recorded as a dated note (the table has no effective-from field) | `pan-wizard-core/bin/lib/cost.cjs` | a rate test; `RATES_VERIFIED_AT` bumped | Open |
| M47 | P2 | S | 2 | **Truncated-plan detection** (MI-130): `verify plan-structure` errors on an unclosed `<tasks>`, a file ending inside a tag, or a continuation marker | `pan-wizard-core/bin/lib/verify.cjs` | unit tests on truncated fixtures | Open |
| M48 | P2 | M | 4 | **Baseline a plan's grep and count gates** (MI-131): the plan-checker runs read-only grep and count `<verify>` forms at HEAD and flags one that already passes or can never match. It never runs tests or builds | `agents/pan-plan-checker.md`, a `pan-tools verify` subcommand | unit tests plus a defect-corpus case with a gate that passes before any work | Open |
| M49 | P5 | S | 2 | **`disable-model-invocation: true` on emitted Claude skills** (MI-132), after a live check that a marked skill leaves the listing and still runs as `/pan:<name>` | the skills converter in `bin/install-lib.cjs`, `scripts/build-plugin.js` | the live check recorded first (MI-022), then a converter test | Open |
| M50 | P2 | S | 2 | **Context monitor only where it can measure** (MI-133): confirm on Codex, Gemini and Copilot whether the monitor gets any numbers; drop the registration where it cannot | `bin/install.js`, `bin/install-lib.cjs`, `hooks/pan-context-monitor.js` | a test that every registered monitor has a metrics source on its runtime | Open |
| M51 | P7 | XS | 1 | **`x-` config keys are user metadata** (MI-134): `unknownConfigKeys()` skips them | `pan-wizard-core/bin/lib/config.cjs` | a unit test | Open |
| M52 | P5 | S | 2 | **A "pre-existing" class for review findings** (MI-135): a finding outside the change's diff is tagged pre-existing and disposed as deferred debt, never a blocker | `agents/pan-reviewer.md`, the review pipeline, `findings` | a contract test, plus a corpus case where a pre-existing defect does not block | Open |

### Session queue

| Session | Items | Pts | Theme | Exit criterion |
|---|---|---|---|---|
| **S12** | M44, M45, M46 | 7 | Correctness | research synthesis writes its file on Claude Code; no recommended model is deprecated; every model a runtime defaults to is priced |
| **S13** | M47, M48, M50 | 8 | Plan and gate integrity | a truncated plan fails structure checks; a plan gate that cannot fail is flagged; no hook runs where it measures nothing |
| **S14** | M49, M51, M52 | 5 | Polish | PAN's skills leave the listing budget on Claude; config metadata keys are quiet; pre-existing findings never block |

### What not to do — re-affirmed `2026-10-19`

- **Do not take the fork spawn now that it is on by default.** It inverts the fresh-context guarantee for planners, executors and judges (MI-013, ADR-0046 D6).
- **Do not put a controller in the loop** (MI-142). That is MI-058's layer, and PAN's levers are budgets, the stall watchdog and escalation.
- **Do not route PAN's review through the host's PR product** (MI-143).

### Sources read (`2026-10-19`)

- Host tools: npm `@anthropic-ai/claude-code` time and dist-tags plus the raw CHANGELOG; `code.claude.com/docs/en/{skills,headless,agent-teams,workflows,model-config}`; `platform.claude.com` models overview; releases APIs for `openai/codex` (`per_page=60`; 100 returned 504), `google-gemini/gemini-cli`, `github/copilot-cli`, `anomalyco/opencode`; `npm view @opencode/cli time`; `learn.chatgpt.com/docs/changelog` (first 100K characters); `geminicli.com/docs/changelogs`; `antigravity.google/docs/{changelog,plugins}`; `opencode.ai/v2/docs/plugins`; `docs.github.com/en/copilot/reference/hooks-reference` and the custom-agents reference; `github.blog/changelog` (`2026-10-13`, `2026-10-15`); `ai.google.dev/gemini-api/docs/pricing`.
- Peers: releases APIs and linked PRs for `github/spec-kit`, `bmad-code-org/BMAD-METHOD`, `open-gsd/gsd-core`, `Fission-AI/OpenSpec`, `OthmanAdi/planning-with-files`, `obra/superpowers`, `eyaltoledano/claude-task-master`. Marketplaces, raw JSON parsed: `anthropics/claude-plugins-official`, `openai/plugins`, `github/copilot-plugins`, `github/awesome-copilot`.
- Standards: `agentplugins/agent-plugins-spec`, `agentskills/agentskills`, `modelcontextprotocol/modelcontextprotocol` (draft path, PRs #3440, #3415, #2848, #2419), `modelcontextprotocol/ext-skills`, `agentsmd/agents.md`, `open-telemetry/semantic-conventions-genai`.
- Patterns: the Claude blog on code review and Code Review GA (`2026-10-15`), Claude Platform agent observability (`2026-10-14`), the GitHub blog on teaching Copilot a codebase (`2026-10-12`), the Google Developers blog on agent evaluation (`2026-10-15`), arXiv 2610.20003, 2610.22987, 2610.22732, 2610.21073, 2610.20116, 2610.22466 and 2610.18206.
- Entrants (releases APIs and READMEs): `sdi2200262/agentic-project-management`, `spec-kitty/spec-kitty`, `maxritter/pilot-shell`, `thedotmack/claude-mem`, `DietrichGebert/ponytail`, `dagoSte/squadra`, `seropaski/lets-build`, `addyosmani/agent-skills`, `foryourhealth111-pixel/Vibe-Skills`, `prekuter/dryforge`, `open-gsd/gsd-pi`. Star counts are secondary and are not repeated here.
- Live probe (this machine): a subagent's `Write` was refused for five report-like basenames and accepted for three others.

## Addendum — `2026-10-19` (reality check)

A `/reality-check` delta run on `claude/quirky-thompson-2c5aa3` @ `127389f` (`3.36.0` plus one unreleased release-workflow fix), the same day as the delta scan above, whose market read it reuses. Findings are prefixed `RC`, items `R`. The review-side summary is §12 of `docs/ECOSYSTEM-REVIEW-2026-08.md`.

### Baseline (reproduce with the commands, never copy the numbers)

| Item | Value |
|---|---|
| Suite and gates | `npm run test:all` and `node scripts/release-check.js` pass. In the first suite run, one wall-clock assertion failed under load and passed alone (RC6) |
| CI | `gh run list --limit 6`: green on `main`, the `v3.36.0` release run and this branch |
| Packed install | `npm pack` of the tree, then `install.js --claude --codex --gemini --opencode --copilot --local` into a scratch directory (there is no `D:` drive here; this machine's test directory is `C:\Project\pantesting`, where the harness keeps its run state) |
| Engine and bridge | installed `pan-tools models check` reports the rate table fresh; `validate health` reports `E001` on a bare project (expected); every resource listed by `resources/list` read cleanly through the installed MCP server |
| Harness | `node harness/src/run.cjs --tier 0 --no-ledger`: every scenario passed except the Antigravity live gate, skipped for lack of `agy` |
| Rates | the Anthropic and OpenAI rows match the pricing pages read today; Gemini: see M46 |

### Findings

| # | Finding (verified `2026-10-19`) | Phase | Class |
|---|---|---|---|
| RC1 | Claude Code refuses a subagent's write to `summary.md`, `report.md`, `findings.md` or `analysis.md`; the research synthesizer and the conductor write such files (MI-127) | 2.1 | P0 BROKEN → M44 |
| RC2 | Inherited statuses describe shipped work as open or unreleased (corrections below) | 1.5 | P1 WRONG → R50 |
| RC3 | The `3.35.0` changelog claims OpenCode 2 loads PAN's plugin; only a simulated loader has run it. Homebrew Core has installed OpenCode 2 since `2026-09-28`. PAN's OpenCode agents carry a legacy `permission:` map with `mcp__…` and `todowrite` keys, and the v2 docs do not say how those translate | 1.2, 2.1 | P1 WRONG → R50 wording, R51 live check |
| RC4 | Native `pan-exec-waves` lacks the test baseline, the phase budget report, the reviewer and `review scope` that `exec-phase.md` runs; its phase gate verdict reaches the halt through an agent's relay | 1.2 | P2 STABILITY → R52 |
| RC5 | COMPARISON's leading rows omit the code-enforced phase gate, the any-language test gate and the guard hook; its "Last verified" predates changes to PAN's own rows | 1.2, 1.4 | P6 DOCUMENTATION → R50 |
| RC6 | `tests/scenarios/feedback-performance.test.cjs` asserts a bound of exactly two seconds and flaked under load; the test-quality lint's wall-clock rule flags only bounds under two seconds | 4.4 | P2 STABILITY → R53 |
| RC7 | Claude Code `2.1.302` fork mode is on by default in `claude -p`: main-conversation spawns run in the background and `run_in_background` is removed (typed and `general-purpose` spawns still start fresh, per the sub-agents doc; the doc's default still reads "off" for `-p`). The harness model tiers have not run on it; CI pins `2.1.288` | 2.1 | P2 STABILITY → R54 |
| RC8 | Codex `0.163.0` lists the `plugin_hooks` feature flag as removed; `live-gate-codex` still discovers the bundle, but hook delivery from the bundle is unchecked | 2.1 | P4 FEATURE GAP → R55 |
| RC9 | Copilot `1.0.98` shows `copilot workflow run` with no experimental flag in its help (MI-076); `copilot instruction list` still enables AGENTS.md and CLAUDE.md as two sources (MI-098) | 2.1 | WATCH (ledger) |
| RC10 | Gemini's deprecation page auto-routes `gemini-3.5-flash` to `gemini-3.6-flash`; if routed calls bill at the newer rates, PAN's older row over-prices them (inferred; neither page states the billing rate) | 2.3 | P1 WRONG (unconfirmed) → M46 |
| RC11 | No model-tier harness run since `3.33.0`; two ledger findings (`resume-cost`, `memory-not-loaded`) are unresolved. The blocker is now only the owner's spend approval, since tier-1/2 runs default to a $15 cap | 1.4 | → R49 (open) |
| — | Refuted: Copilot running PAN's Claude hooks a second time. Each Copilot hook copy defers to a Claude registration of the same script (`tests/copilot-hook-dedupe.test.cjs`) | 2.1 | — |

### Corrections to this plan

- **R45, R46, R47** shipped in `3.35.0` (`18efcb5`): §11 of the review still lists R45 and R46 as open. R45 has unit evidence only (RC3).
- **R49 and M43:** "no standing cap" is no longer the blocker; `harness/src/run.cjs` defaults tier-1/2 runs to a $15 cap. When both R49 scenarios run together the cap is split evenly, so give `memory-not-loaded` its own run or raise `--max-usd`.
- **M40** shipped in `3.35.0` (`18efcb5`), not "working tree"; the changelog omits it. **M41, M42** shipped in `3.36.0` (PR #45); `f427e4f` is reachable from no ref.
- **Session queue S9 and S10** are complete; S11 (M43's run, M35, R49) is open. A blockquote placed between the queue's header and its rows breaks that table.
- **product-excellence-superplan:** `3.36.0` is tagged on `e7d1011`, not "awaiting push, merge and tag"; sprints 2a to 3c are released, not merged-only or unpushed.
- **OUTSTANDING-2026-08:** L6's stale instance is gone but the guard it asks for is not built (instance closed, guard open); A1's "`SCHEMA_V` is 3 in both hooks" is outdated (the hooks moved on; nothing regressed).
- **CHANGELOG:** `127389f` (the deprecation sweep fix) has no `[Unreleased]` entry.

### Items

| ID | Pri | Size | Pts | Title | Files | Gate / verify | Status |
|---|---|---|---|---|---|---|---|
| R50 | P1 | S | 2 | **Status and claims sweep** (RC2, RC3 wording, RC5): correct §11's rows, the superplan's release state, M40–M42 and the session queue, OUTSTANDING L6 and A1; qualify the `3.35.0` OpenCode 2 line as unit-tested; add the gates to COMPARISON's leading rows with a re-verified date; add an `[Unreleased]` entry for `127389f` | `docs/ECOSYSTEM-REVIEW-2026-08.md`, `docs/specs/product-excellence-superplan.md`, this file, `docs/audits/OUTSTANDING-2026-08.md`, `docs/COMPARISON.md`, `CHANGELOG.md` | doc-lint, model-version drift, link validation | Open |
| R51 | P1 | S | 2 | **OpenCode 2 live check** (RC3): install `@opencode/cli` into the test directory (never globally), then run `live-gate-opencode` against it. The plugin must load through `setup`, and the agents' legacy `permission:` keys (`mcp__…`, `todowrite`) must translate | `harness/scenarios/live-gate-opencode.json`, `bin/install-lib.cjs` (OpenCode agent converter) | the gate passes on OpenCode 2, or the converter emits v2-safe keys behind a test | Open |
| R52 | P2 | M | 4 | **Bring native `pan-exec-waves` level with `exec-phase.md`** (RC4): test baseline, phase budget report, reviewer with `review scope`; the phase gate read in code, not relayed | `bin/install-lib.cjs` (`buildNativeWorkflowScripts`), `tests/native-workflows-drift.test.cjs` | the drift test asserts each twin step | Open |
| R53 | P2 | XS | 1 | **Flaky wall-clock bound** (RC6): measure the CLI calls without a tight bound (or a bound with headroom), and make the lint's wall-clock rule include a bound of exactly two seconds | `tests/scenarios/feedback-performance.test.cjs`, `scripts/test-quality-lint.cjs` | the lint flags the old assertion (proven red), then passes | Open |
| R54 | P2 | S | 2 | **Harness under fork mode** (RC7): set `CLAUDE_CODE_FORK_SUBAGENT=0` in the harness's model-step environment, or show a tier-2 chain passing on current Claude Code | `harness/src/model.cjs` | a unit test on the spawned environment; a recorded tier-2 rep if spend is approved | Open |
| R55 | P3 | S | 2 | **Codex bundle hooks after `plugin_hooks` left the flag list** (RC8): find out from Codex's source or docs whether plugin hooks are now always on or gone, then adjust the bundle or its docs | `scripts/build-agent-plugin.js`, `harness/scenarios/live-gate-codex.json` | a model-free check in `live-gate-codex`, or a dated note | Open |

### Session queue

| Session | Items | Pts | Theme | Exit criterion |
|---|---|---|---|---|
| **S12** (from the scan above) | M44, M45, M46 | 7 | Correctness | runs first: M44 is the only P0 |
| **S15** | R50, R51, R53 | 5 | Truthful docs and runtimes | no inherited status contradicts the tree; OpenCode 2 is checked live; the timing test cannot flake |
| **S16** | R52, R54, R55 | 8 | Runtime drift | the native and markdown exec paths run the same gates; the harness behaves the same on current Claude Code; Codex bundle hooks are accounted for |

### What not to do — re-affirmed `2026-10-19`

Every entry carried forward still holds, and no finding overturns one: do not derive a runtime-integration test from the installer's table alone; do not retire the markdown workflows; do not chase a sixth runtime; do not standardise `.planning/`; do not soften the behavioural harness; do not list on a skills marketplace on quality grounds alone; do not fork the skills compiler; do not emit frontmatter a runtime has not been seen to read; do not add a model rate without a primary citation; do not emit OpenCode v2 config shapes. RC3 does not overturn the last one: R51 checks whether OpenCode 2 translates PAN's v1 agent keys before anything changes.

### Sources read (`2026-10-19`)

- `code.claude.com/docs/en/{sub-agents,hooks,settings-reference,env-vars}`, the raw Claude Code CHANGELOG; `platform.claude.com/docs/en/about-claude/pricing`; `developers.openai.com/api/docs/pricing`; `ai.google.dev/gemini-api/docs/{pricing,deprecations}`.
- `opencode.ai/v2/docs/{migrate-v1,permissions,agents,commands,plugins}`, `opencode.ai/install`, `formulae.brew.sh/api/formula/opencode.json`, Homebrew core commits, `npm view @opencode/cli` and `opencode-ai`, `anomalyco/opencode` releases.
- `docs.github.com/en/copilot/reference/hooks-reference`, `github/copilot-cli` releases (from 1.0.4 on, for the hook sources).
- Local CLIs, help and list commands only (no model turns): `copilot workflow run --help`, `copilot instruction list`, `codex plugin --help`, `codex features list`.
