# Market ideas — November 2026

The sized queue from the `/market-ideas` run of `2026-11-07`. Every row cites a ledger id in [market-ideas-ledger.md](market-ideas-ledger.md), and the queue numbering continues from [market-ideas-2026-10.md](market-ideas-2026-10.md) (M53 onward). This file lives under `docs/specs/`, so it may name model versions and cite dated releases. It carries no filesystem-derived counts: `CLAUDE.md` holds those.

## Baseline (reproduce with the commands, never copy the numbers)

| Item | Value |
|---|---|
| Tree | `main` @ `a88cf79`, clean (`git rev-parse --short HEAD`, `git status --porcelain`) |
| Version | `3.42.2` (`package.json`); newest tag `v3.42.2` |
| Ledger | count rows with `grep -cE "^\| MI-" docs/specs/market-ideas-ledger.md` |
| Last scan | `2026-10-19` (the ledger's run log) |
| Delta window | `2026-10-19` → `2026-11-07`, delta only, no landscape sweep |
| Rate table verified at | `RATES_VERIFIED_AT` in `pan-wizard-core/bin/lib/cost.cjs` (`2026-10-10`) |
| Host tools on this machine | Claude Code 2.1.302 (`stable` 2.1.311, `latest` 2.1.319), Codex 0.163.0, Gemini CLI 0.64.0, OpenCode 1.19.3, Copilot CLI 1.0.103; `agy` absent |

## What the scan found

- **The highest-leverage idea is a PAN gap, not a market feature.** Claude Code documents that after a compaction it re-attaches each invoked skill cut to its first 5,000 tokens, within a 25,000-token budget for all of them. A PAN command @-includes its workflow, so a long orchestrator such as `/pan:exec-phase` keeps only its opening steps once the conversation compacts. PAN's compaction hook tells the model to re-read `state.md` and the current plan, not the workflow it was running (MI-144, M53).
- **PAN's own releases moved more ledger rows than the market did.** `3.37.0` to `3.42.2` shipped what five WATCH rows were waiting for: an opt-in cross-family reviewer lane (MI-044, which stays WATCH until a measurement makes it a default), autodev (MI-058), the lean path (MI-116), declined-to-judge lists (MI-118) and the step journal (MI-140). The `3.41.0` lock on the cost logger's cursor met half of MI-004's trigger. Re-checking it found that the trace logger's cursor, the same read-modify-write under parallel subagent fires, has no lock (M55).
- **Host tools.** Claude Code runs MCP tasks (MI-027, client half), and Mods reached `stable` (MI-074, half). Effort per spawn exists on Claude only (MI-077 not met). OpenCode 2 changes the config keys, tool names, agent fields and plugin API PAN writes; V1 plugins do not run on it. Gemini CLI repositioned to "Enterprise Code Assist only". Antigravity plugins do not load `commands/` or `workflows/`. These are hand-offs, not ideas.
- **Peers.** Spec-kit, gsd-core, Superpowers and OpenSpec released. BMAD made no release (v7 is aimed at mid-November), and Taskmaster is dormant. The peers' moves are engine-checked gates: TDD order by git ancestry, reviews that refuse a truncated input, validation that fails a dropped section, frozen run definitions. Each is WATCH with a measurable trigger.
- **Convergence holds.** The market keeps moving onto PAN's thesis: engine-enforced gates, durable run state and evals; GitHub's Plan / Build / Verify / Observe post; Anthropic's advice to keep the injected memory layer small. Two signals point the other way. ruflo ships a feature only as a Claude Mods plugin (Claude-only), and Gemini CLI is narrowing to enterprise. The gap is still publication and positioning (MI-025).

### Hand-offs to `/reality-check` (path or behaviour changes, not ideas)

| Runtime | Change | Source |
|---|---|---|
| OpenCode 2 | `permission`→`permissions` (ordered array), `mcp`→`mcp.servers` (`enabled`→`disabled`), `plugin`→`plugins`; tools `bash`→`shell`, `task`→`subagent`, `write`/`patch`→`edit`; agent `prompt`→`system`, `maxSteps`→`steps`; AGENTS.md only; V1 plugin code does not run. 1.x is bugfix-only and refuses 2.x updates | `opencode.ai/docs/migrate-v1` (read `2026-11-07`); `anomalyco/opencode` releases |
| Antigravity CLI | `agy plugin validate` (`1.4.3`) warns plugins do not load `commands/`, `workflows/` Markdown or `hooks/hooks.json`, and a top-level `"hooks"` key loads as one hook named `hooks`; `agy plugin import claude` (`1.4.11`) | `antigravity.google/docs/changelog` |
| Gemini CLI | README: "Enterprise Code Assist only"; paid API and Vertex keys legacy but supported; not tuned for Gemini 4+ (MI-082 not met) | `google-gemini/gemini-cli` PR #29995 (`2026-10-28`) |
| Claude Code | prompt and agent hooks capped at 24 concurrent per session (`2.1.312`); PostToolUse runs after an interrupt (`2.1.319`); nested `.claude/skills` under the Bash sandbox load only from the start folder (`2.1.319`); the Read tool's unchanged-file stub removed (`2.1.317`) | `anthropics/claude-code` CHANGELOG.md, dated with `npm view @anthropic-ai/claude-code time` |
| Copilot CLI | `--add-dir` loads `.agents/skills`, `.claude/skills` and `.claude/agents` (`1.0.106`); a warning names agent frontmatter keys Copilot ignores (an aid for the MI-022 live check); @-imports follow code-fence rules (`1.0.107`). Superpowers reports Copilot on Windows runs hook commands through PowerShell (PR #2592): confirm PAN's `node "<path>"` form | `github/copilot-cli` releases |

## Priority classes

Correctness before packaging before behaviour (carried from the earlier queues): P1 a defect or a guarantee PAN states and does not keep; P5 a capability; P7 hygiene.

## Items

| ID | Pri | Size | Pts | Title | Files | Gate / verify | Status |
|---|---|---|---|---|---|---|---|
| M53 | P1 | S | 2 | **Re-read the running workflow after a compaction** (MI-144): the state re-injection names the workflow or command file to re-read before the next step, alongside `state.md` and the plan, and says why (the host keeps only the start of an invoked command). Where the current command is unknown, name the workflows directory | `hooks/pan-state-reinject.js`, OpenCode's `pan-wizard-core/opencode/pan-wizard.js` (its compaction path), `hooks/dist/` via `npm run build:hooks` | a unit test on the injected text on Claude and OpenCode; a check that every command whose @-included content passes the 5,000-token budget keeps its step list in the first part, or is named in the injection | open |
| M54 | P5 | M | 4 | **Installer `--dry-run`** (MI-145): print the files an install or update would add, change or delete (per runtime, `--json` too) and write nothing, including no config merges | `bin/install.js`, `bin/install-lib.cjs` (a plan builder beside the writers), `docs/USER-GUIDE.md`, README install section | a scenario test that a dry run into a temp dir leaves it byte-identical and lists exactly what a real run then writes | open |
| M55 | P1 | S | 2 | **Lock the trace logger's cursor** (MI-004 re-check): the trace logger reads, advances and writes `.trace-cursor.json` with no lock, so parallel SubagentStop fires can lose an update and re-sum a slice. Use the cost logger's best-effort lock (same protocol as `lock.cjs`) and write by rename | `hooks/pan-trace-logger.js`, `tests/store-adoption.test.cjs` | a concurrency test like the cost logger's (parallel fires, no lost cursor advance, no double-counted slice) | open |

## Session queue

| Session | Items | Pts | Why this order |
|---|---|---|---|
| 1 | M55, M53, M54 | 8 | Two correctness fixes first (a lost-update defect, then a guarantee the compaction hook claims and does not keep), then the installer capability |

## What not to do — re-affirmed `2026-11-07`

- Do not ship a Claude-only feature as a Mods plugin while PAN's plugin is unpublished (MI-074, MI-025).
- Do not record only failures as lessons (MI-095); Anthropic's memory post now argues the same.
- Do not turn the logger hooks async on Claude until both cursors are locked (MI-004).
- Do not move the OpenCode target to 2.x inside this queue; that is `/reality-check`'s finding to size (MI-160).

## Sources read (all `2026-11-07`)

- Claude Code: `anthropics/claude-code` CHANGELOG.md 2.1.304–2.1.319 (dated with npm `time`); `code.claude.com/docs/en/skills.md` (skill content lifecycle), `/workflows`, `/sub-agents`; npm dist-tags.
- Codex: `openai/codex` releases API 0.164.0–0.167.0 (`per_page=30`); `learn.chatgpt.com/docs/hooks`, config reference.
- Gemini CLI / Antigravity: `google-gemini/gemini-cli` README and releases; `antigravity.google/docs/changelog`.
- OpenCode: `anomalyco/opencode` releases; `opencode.ai/docs/migrate-v1`, `/docs/agents`; npm `@opencode/cli`.
- Copilot CLI: `github/copilot-cli` releases 1.0.104–1.0.107; `docs.github.com/en/copilot` (hooks, custom instructions, dynamic workflows).
- Peers: GitHub releases API for `github/spec-kit`, `open-gsd/gsd-core`, `obra/superpowers`, `Fission-AI/OpenSpec`, `bmad-code-org/BMAD-METHOD`, `eyaltoledano/claude-task-master`; `anthropics/claude-plugins-official` `marketplace.json` diffed raw.
- Entrants: `dagoSte/squadra`, `ruvnet/claude-flow`, `Yeachan-Heo/oh-my-codex`, `Yeachan-Heo/oh-my-claudecode`, `addyosmani/agent-skills`, `microsoft/apm` (README and releases API).
- Standards: `agentplugins/agent-plugins-spec` (pulls, commits, `spec/1.1.0.md`); `modelcontextprotocol` PRs #3459, #3392, #3398 and issues #2848, #2419; `agentskills/agentskills` PRs #648, #649; `agentsmd/agents.md`; `open-telemetry/semantic-conventions-genai`.
- Vendor posts: Anthropic "The components of agent memory" (`2026-11-06`); Google "Agent Distraction" (`2026-11-06`) and "Cost per task" (`2026-11-03`); GitHub "Beyond code generation" (`2026-11-06`) and the Dependabot APM changelog (`2026-11-03`).

## Addendum — `2026-11-07` (reality check)

A delta `/reality-check` the same day, on `main` @ `7519709`. Finding ids are `RC`, item ids continue from R55. The evidence is in §13 of `docs/ECOSYSTEM-REVIEW-2026-08.md`.

### Baseline (reproduce with the commands, never copy the numbers)

| Item | Value |
|---|---|
| Gates | `npm run ci:local` on the `3.43.0` release commit: every gate passed; GitHub CI on `main`: macOS Node 18 and 20 failed (`gh run list`) |
| Install | packed tarball into `C:\Project\pantesting\reality-check`, `--claude --codex --gemini --opencode --copilot --local`; surfaces checked on disk |
| MCP | every resource read through the installed server on a bare project |
| Harness ledger | open findings: `node -e "…filter rows without resolved_at in harness/ledger.jsonl…"` |
| Rates | `pan-tools models check`; rows compared with the Anthropic, OpenAI and Gemini pricing pages read `2026-11-07` |

### Items

| ID | Pri | Size | Pts | Title | Files | Gate / verify | Status |
|---|---|---|---|---|---|---|---|
| R56 | P1 | S | 2 | **OpenCode 2 compaction part** (RC1): push `{ type: 'text', text }` into `system`; keep plain strings for v1's `context` | `pan-wizard-core/opencode/pan-wizard.js`, `tests/fixtures/opencode2-compaction-event.json` | `tests/opencode-plugin.test.cjs` checks the part against the documented shape (red on the old plugin). A live compaction on OpenCode 2 needs a model turn and is not run | **Done `2026-11-07`** |
| R57 | P1 | XS | 1 | **Status sweep** (RC3): the October queue's "unreleased" rows marked released in `3.37.0`; M49 marked reverted in `3.41.3` | `docs/specs/market-ideas-2026-10.md` | by reading | **Done `2026-11-07`** |
| R58 | P1 | S | 2 | **Dated rate changes** (RC4): `SCHEDULED_RATES` prices a record at the row in force on its own day; Gemini 4 Argon from `2026-12-01`, Gemini 3.8 Flash from `2027-01-01` | `pan-wizard-core/bin/lib/cost.cjs` | `tests/cost-scheduled-rates.test.cjs` | **Done `2026-11-07`** |
| R59 | P1 | XS | 1 | **GPT-6.1 Terra row; tier fallbacks on the current aliases** (RC5) | `pan-wizard-core/bin/lib/cost.cjs`, `tests/cost.test.cjs` | the same tests | **Done `2026-11-07`** |
| R60 | P6 | XS | 1 | **OpenCode 2 and Antigravity behaviour in the docs** (RC6) | `docs/TROUBLESHOOTING.md` | doc lint | **Done `2026-11-07`** |
| R61 | P7 | — | 0 | **Alias skills carry their target's body** (RC7) | — | design holds (`renderCommandAlias`) | closed, no change |
| R62 | P6 | XS | 1 | **Write back this run** | this file, §13, `docs/IMPROVEMENT-TODO.md` | post-write gate | **Done `2026-11-07`** |
| R63 | P0 | XS | 1 | **`--dry-run --json` cut short on macOS** (RC2): set `process.exitCode` instead of exiting | `bin/install.js`, `tests/install-dry-run.test.cjs` | a test pins the shape (red on `3.43.0`); CI on macOS after push | **Done `2026-11-07`** (`7519709`) |

### What not to do — re-affirmed `2026-11-07`

The inherited list holds item by item, unchanged. Added: do not derive a test of a host's hook payload from PAN's own handler; record the host's documented shape in a fixture first (RC1, the same lesson as the `2026-09-22` entry).

### Verification caveats

- A live compaction on OpenCode 2 needs a model turn; R56 rests on OpenCode's plugin docs and a fixture of the documented shape.
- The macOS fix is proven by a source-shape test and by reasoning about pipe semantics; CI on macOS after the push is the real gate.
- No Antigravity CLI on this machine; its rows rest on its changelog.

## Addendum — `2026-11-13` (GBrain read)

A feature-level `/market-ideas` read of `garrytan/gbrain`, at the owner's request, on `main` @ `6bd42ee` (`3.43.1`). GBrain is a personal memory system for agents (Bun and TypeScript, PGLite or Postgres, an MCP server) that ships Claude Code and Codex plugins. It is adjacent to PAN, not a direct peer. Ledger rows MI-161 to MI-182; item ids continue from R63.

### Findings

- **Codex skips untrusted hooks silently.** Codex's own source (`codex-rs/hooks`, read `2026-11-13`) keys trust as `<hooks.json path>:<event>:<group>:<handler>` under `[hooks.state."…"]` in the user-level `config.toml`. A hook with no `trusted_hash` there is listed and not run. PAN prints a notice at install and never checks again (MI-161).
- **A test that passes is not a test that catches.** GBrain requires each fix's test to fail with the source reverted (MI-162). PAN did this by hand this cycle.
- **The user docs are outside prompt-lint's reach.** Two stale `pan-tools` references were found by running prompt-lint's own checker over `docs/` (MI-163).
- **Convergence.** GBrain argues for PAN's thesis on evals: held-out gating, published negative results, a withdrawn score, claims graded by a live check with a control. It moves away on per-turn injection (MI-164, MI-165) and on closed or hosted components (MI-168), which the owner's routing-off decision of `2026-11-06` already answers.

### Items

| ID | Pri | Size | Pts | Title | Files | Gate / verify | Status |
|---|---|---|---|---|---|---|---|
| M64 | P1 | S | 2 | **Report untrusted Codex hooks** (MI-161): hygiene reads `.codex/hooks.json` and the user-level Codex `config.toml` (`CODEX_HOME`, else `~/.codex`), read-only, and warns when a PAN hook has no `trusted_hash` under its key. It never writes the trust entry | `pan-wizard-core/bin/lib/hygiene.cjs`, `commands/pan/hygiene.md`, `docs/CLI-REFERENCE.md`, `docs/TROUBLESHOOTING.md` | unit tests on a hooks.json built by the installer's own merge: no entries, all trusted, partly trusted, disabled, another project's key, foreign hooks, inline form, escaped Windows paths | **Built `2026-11-13`** (unreleased) |
| M65 | P7 | M | 4 | **Test-discrimination check** (MI-162): `scripts/check-test-discriminates.cjs <test…> [--base <ref>] [--src <file>…]` runs the tests on the working tree (must pass), then in a throwaway worktree of the base with every changed file overlaid except the source under test (must fail). Never edits the checkout | `scripts/check-test-discriminates.cjs`, `tests/check-test-discriminates.test.cjs`, `CLAUDE.md` | its own tests on a scratch repository: a discriminating test, a test that passes either way, a test that fails on the working tree | **Built `2026-11-13`** (unreleased); its first run on PAN confirmed M64's tests fail with `hygiene.cjs` reverted |
| M66 | P6 | S | 2 | **Docs CLI truth check** (MI-163): prompt-lint's verb and subcommand rules over `README.md` and `docs/*.md`, excluding the generated `docs/SKILLS-*.md`; fix the two stale references | `scripts/prompt-lint.cjs` or a test beside it, `docs/DEVELOPMENT.md`, `docs/MIGRATION-v2-to-v3.md` | a test that fails on the stale references and passes once they are fixed | **Built `2026-11-13`** (unreleased): `lintDocs` and `docFiles` in `scripts/prompt-lint.cjs`, checked by `tests/prompt-lint.test.cjs`; both references fixed |

### Session queue

| Session | Items | Pts | Why this order |
|---|---|---|---|
| 1 | M64, M65, M66 | 8 | The Codex check first (PAN's hooks not running is a correctness gap a user cannot see), then the two development checks |

### What not to do — re-affirmed `2026-11-13`

The inherited list holds. Added: do not write `trusted_hash` into a user's Codex `config.toml`; that approves code on the user's behalf (MI-161). Do not add a per-turn rule or skill hook while routing is off by owner decision (MI-164, MI-165).

### Sources read

- `garrytan/gbrain` at `master`, `VERSION` `0.60.704.0`, read `2026-11-12` with `gh api repos/garrytan/gbrain/contents/<path>`. Files: `docs/guides/setup.md`, `docs/memorable-agents.md`, `docs/guides/memory-trust.md`, `docs/guides/memory-boundaries.md`, `docs/contradictions.md`, `docs/operations/spend-controls.md`, `docs/TESTING.md`, `docs/RELEASING.md`, `docs/guides/skill-resolver.md`, `docs/guides/skillopt.md`, `docs/guides/checkpoint-compaction.md`, `src/core/agent-install/setup.ts`, `src/mcp/surface.ts`, `CHANGELOG.md` (window entries only).
- Releases API, `per_page=100`: `v0.60.318.0` (`2026-10-20`) to `v0.60.704.0` (`2026-11-12`).
- `openai/codex` at the default branch, read `2026-11-13`: `codex-rs/hooks/src/lib.rs`, `codex-rs/hooks/src/engine/discovery.rs`, `codex-rs/hooks/src/config_rules.rs`, `codex-rs/config/src/hook_config.rs`.

### Verification caveats

- Every GBrain figure in the ledger rows is GBrain's own measurement; none was reproduced.
- GBrain's per-turn claim ("agents use the brain when the rule reaches them on every turn") has no published figures that were found.
- M64 sees whether a trust entry exists, not whether its hash still matches: Codex's hash is a digest of its own TOML serialisation, which PAN does not reproduce. A trusted hook that PAN later changes shows as Modified in Codex's `/hooks` and is not reported here.
