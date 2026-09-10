# PAN Wizard Work Plan — Reality Check 2026-09

**Generated:** 2026-09-10 (evening) · **Tree:** `feat/market-delta-2026-09-s1` @ `5684d38` (v3.27.0 + unreleased commits; PR #29 open, every check green, mergeable) · **Source:** the first `/reality-check` run, recorded as §9 of [ECOSYSTEM-REVIEW-2026-08.md](../ECOSYSTEM-REVIEW-2026-08.md) and as the Addendum (findings RC1–RC23, items R1–R20) of [market-delta-2026-09-superplan.md](market-delta-2026-09-superplan.md). This plan expands every one of those items into implementation steps a session can execute with `/execplan`, and adds R21 so the one parked finding has a protocol instead of a shrug.

> **Counts doctrine.** Per CLAUDE.md this file carries no filesystem-derived counts; the baseline points at the counts table and the commands that reproduce each result. **Point-in-time.** Every line-number anchor below was read on 2026-09-10 — re-grep before editing, the tree moves (`git rev-parse HEAD && git status --porcelain`). **Branching.** PR #29 carries S1–S5 and the harness; start this plan on a fresh branch off `main` once #29 merges (`feat/reality-check-2026-09`), not on top of #29.

---

## Baseline (Phase 0)

| Metric | Value | Reproduce |
|---|---|---|
| Version | `package.json` (3.27.0 at generation) | `node -p "require('./package.json').version"` |
| Suite | fully green, no skips, roughly half a minute | `npm run test:all` |
| Release gates | all eight passed | `node scripts/release-check.js` |
| Harness, model-free tier | every runnable scenario passed; Codex, Copilot and Antigravity live gates skipped (no CLI here) | `npm run harness` |
| Harness, model tier (concurrent run, not this session's) | markdown exec-phase chain three of five reps; native chain unmeasured (budget-starved pre-`87e53c9`) | `d:/pantesting/harness-runs/run-20260910-190841-i1aw/report.md` |
| CI | PR #29 green on the full matrix, CodeQL, gitleaks, audit | `gh pr view 29 --json statusCheckRollup` |
| Unreleased work | every commit since the tag | `git log v3.27.0..HEAD --oneline` |
| Open TODOs in shipped source | none beyond decomposition breadcrumbs and the todo feature's own patterns | `grep -rnE "TODO\|FIXME\|HACK" bin pan-wizard-core/bin --include=*.js --include=*.cjs` |
| Rate table | matches the pricing page; verified today | `node pan-wizard-core/bin/pan-tools.cjs models check` |

Counts (tests, suites, commands, agents, modules, specs, ADRs) live only in `CLAUDE.md`'s table; refresh it with the snippet at the top of that file after any session that adds a test file or a spec.

---

## Coverage map — every finding has an item

| Finding | Item(s) | Finding | Item(s) |
|---|---|---|---|
| RC1 Fable-default claim false | R1 | RC13 stray `nul/` | R11 |
| RC2 `validate health` exit 0 on broken | R2 | RC14 TROUBLESHOOTING precision | R12 |
| RC3 F13 false (BMAD, GSD) | R3 (done) | RC15 Copilot `model:` lists | R13 |
| RC4 README location prompt | R4 | RC16 Antigravity variant | R14 |
| RC5 README hook count | R4 | RC17 gsd-core shares `.planning/` | R15 |
| RC6 COMPARISON stale/false | R5 (partly done) | RC18 one core copy per runtime dir | R16a, R16b |
| RC7 README claims weakened | R4 | RC19 body budget (parked item 11) | R21 |
| RC8 OpenCode path undocumented; no OpenCode/Gemini live gates | R6 | RC20 behavioural claims without scenarios | R17 |
| RC9 four priced models unrated | R7 | RC21 roster (OpenSpec, gsd-core, Taskmaster) | R18 (done) |
| RC10 zero-dep unpinned | R8 | RC22 markdown chain three of five | R19 |
| RC11 server version literal | R9 | RC23 phantom probe findings | R20 |
| RC12 stale bundle ships silently | R10 | | |

---

## Priority classes and sizes (Phases 1 and 3)

**P0 BROKEN** · **P1 WRONG** (silent incorrect output, false docs) · **P2 STABILITY** · **P3 MISSING TESTS** · **P4 FEATURE GAPS** · **P5 NEW FEATURES** · **P6 DOCUMENTATION** · **P7 POLISH**. Sizes: XS 1 · S 2 · M 4 · L 10 · XL 20. No P0: the suite, the gates and the installer are green.

**Rules every item obeys.** (1) A behavioural change ships with a test that was seen red first — break the fix, watch the named assertion fail, restore (the revert-proof column). (2) Nothing installs into the source repo; every install goes to `d:\pantesting`. (3) Counts stay in CLAUDE.md; evergreen docs name models by capability; dated files (CHANGELOG, specs, ADRs, ECOSYSTEM-REVIEW) may name versions. (4) A market claim in code or docs carries a primary-source URL and the date read. (5) Generated docs (`docs/SKILLS-*.md`) are regenerated, never hand-edited.

---

## Items (Phase 3) — detailed

### R1 · P1 · XS (1) — Reword the "Claude Code's default" claim

**Finding.** RC1. `code.claude.com/docs/en/model-config` (read 2026-09-10): "Neither Fable model is the account-type default on any plan or provider." `default` is Opus 5 (Max, Team Premium, Enterprise, API, Bedrock, Google Cloud) or Sonnet 5 (Pro, Team Standard); the `fable` and `best` aliases resolve to Fable 5.1. The rate row and the flagship bump are right; the stated reason is wrong in three places that ship.

**Files.** `CHANGELOG.md` `[Unreleased]` intro and the section "Fixed — the rate table on the current default model"; `pan-wizard-core/bin/lib/cost.cjs` comment block above the `claude-fable-5-1` row.

**Steps.**
1. CHANGELOG: retitle the section "Fixed — the rate table on the model the `fable` and `best` aliases resolve to". Replace "the model Claude Code now defaults to", "Claude Code defaults to since 2.1.257" and "follows Claude Code's default" with alias language, and add one sentence quoting the model-config page with the date read.
2. `cost.cjs`: change "4× too high on the model Claude Code now defaults to" to "4× too high on the model the `fable`/`best` aliases resolve to (model-config, read 2026-09-10: neither Fable model is a plan default)".
3. `bin/install.js` `RECOMMENDED_MODELS`: confirm the comment makes no default claim (it does not today); leave it.
4. Do not rewrite F2/1b in the September superplan — the Addendum's "Corrections to this plan" already records it; frozen rows stay frozen.

**Tests / gate.** `grep -nE "Claude Code.*default" CHANGELOG.md pan-wizard-core/bin/lib/cost.cjs` returns nothing near Fable. CHANGELOG is lint-exempt, so the gate is the grep plus a read.

**Revert-proof.** Not applicable (prose). **Status.** Done `2026-09-10` (commit c35c41d).

### R2 · P1 · S (2) — `validate health` sets its exit code

**Finding.** RC2. `cmdValidateHealth` (`pan-wizard-core/bin/lib/verify.cjs`, from line 1280) calls `output()` twice without an exit code — the early return when `.planning/` is missing (status `broken`, E001) and the final `output(result, raw)` near line 1421. `output()` derives the code from the error family (`error`, `*_error`); the health payload's `errors[]` is a plural collection outside it, so a `broken` verdict exits 0. `docs/CLI-REFERENCE.md` states verdict commands set the code explicitly, and `reconcile` does (`verify.cjs` line 511). No test pins the health exit code.

**Files.** `verify.cjs` (both `output` sites); `tests/exit-code-contract.test.cjs` (real-CLI spawn pattern) or `tests/verify-health-codes.test.cjs`; `docs/CLI-REFERENCE.md` (`validate health` entry); `pan-wizard-core/workflows/health.md` (reads JSON; unaffected, verify).

**Steps.**
1. In `cmdValidateHealth`, compute `const exitCode = status === HEALTH_STATUS.BROKEN ? 1 : 0` after the status is decided (and after `--repair` has run, so the code reflects the post-repair state), and pass it as `output(result, raw, undefined, exitCode)` at both sites. `degraded` exits 0 — warnings are not failures; write that rule in a comment.
2. Decide against a new `uninitialized` status for E001 in this item: `HEALTH_STATUS` (`constants.cjs` line 539) has three values, `health.md` documents those three, and `tests/verify-health-codes.test.cjs` is driven from the CLI-REFERENCE code table. Keep `broken` + E001, exit 1. Record the optional follow-up (a fourth status, with the doc table, the workflow and the test updated together) in the item's closing note.
3. CLI-REFERENCE: add "Exit code: 1 when `status` is `broken`, 0 otherwise" to the `validate health` entry.
4. Confirm callers: `grep -rn "validate health" hooks commands pan-wizard-core/workflows bin` shows only `health.md` (JSON parse) and `links.md` (prose). Nothing gates on exit 0.

**Tests.** In `tests/exit-code-contract.test.cjs`, a block "validate health is a verdict": spawn the real CLI in a temp dir with no `.planning/` → exit 1 and `status: broken`; in a scaffolded healthy tree (`pan-tools init` in the temp dir, or the fixture `tests/verify-health.test.cjs` already uses) → exit 0. **Revert-proof.** Remove the fourth argument at one site → the corresponding assertion fails.

**Status.** Done `2026-09-10` (commit f34423b).

### R3 · P1 · XS (1) — F13 correction · **Done 2026-09-10**

Recorded in the Addendum ("Corrections to this plan") and §9. **Verify:** `grep -n "open-gsd/gsd-core" docs/specs/market-delta-2026-09-superplan.md docs/ECOSYSTEM-REVIEW-2026-08.md` finds both.

### R4 · P6 · M (4) — README accuracy pass

**Finding.** RC4, RC5, RC7 (the claims audit's FALSE and WEAKENED rows). Line anchors are from 2026-09-10; re-grep each phrase before editing.

**Files.** `README.md`; `docs/COMPARISON.md` (the builtins list).

**Steps.**
1. Install steps (near line 133): replace the "Location — Global or local" prompt bullet with "Location defaults to the current project (`--local`); pass `--global` for your home config directory" — the installer prompts for runtime only (`bin/install.js` runtime prompt block near line 3110).
2. Docs table (near line 886): "5 built-in hooks" → "the built-in hooks" (counts doctrine; six ship).
3. Bot army (hero line near 7, section near 79): add "on Claude Code" — `agents/pan-conductor.md` line 3 says Claude Code only; `--hierarchical` falls back to flat elsewhere.
4. Fresh-context spawning (near 59, 364, 526, 587): qualify "on Claude Code; other runtimes delegate through their native agent mechanism" — `install-lib.cjs` rewrites `Task(...)` to a prose adapter (lines 423–425, 460–462, 712–714).
5. Atomic commits (near 365, 553–565): "one commit per task; consecutive trivial chore or docs tasks may be coalesced (P-1605, `agents/pan-executor.md` 340–349)".
6. Plan-checker loop (near 347, 525): "up to three revision passes, then the remaining issues come to you" (`workflows/plan-phase.md` 466–509).
7. map-codebase (near 288): "single-shot with one agent for repositories under the sharding threshold; six-way sharded above it" (`commands/pan/map-codebase.md` 53–60).
8. `mode` / `depth` (near 727): "chosen at `/pan:new-project`; they are not config defaults" (`config.cjs` defines neither).
9. "every agent runs on the model you launched with" (near 740): add "except the reviewer-class agents, which pin a reasoning-tier model (see USER-GUIDE)". Write by capability — no family or version name (the model-version-drift lint and the role-claim guard both scan README).
10. Caps and abort (near 104): "enforced by the conductor's protocol; the MCP `pan_next_action` path enforces caps in code" (`agents/pan-conductor.md` 27–35; `orchestrator.cjs` 126).
11. Scheduled campaign (near 106): "the daily budget is advisory unless `budget.enforce` is set, and an external scheduler triggers `--continue`" (`config.cjs` 64–69; `campaign.cjs` 2–6).
12. COMPARISON builtins list (line 45): add `readline`.

**Tests / gate.** `node --test tests/doc-lint.test.cjs tests/model-version-drift.test.cjs` green; re-run the skill's Phase 1.2 claims audit → no FALSE row, and every WEAKENED row now carries its qualifier in the README. **Status.** Done `2026-09-10` (commit a9df350).

### R5 · P6 · M (4) — COMPARISON.md refresh (remainder)

**Finding.** RC6. Done today: the MCP row, "Leads" items 3–5, the date line, a dated verification note. Remaining: the matrix columns and PAN's understated rows.

**Files.** `docs/COMPARISON.md`.

**Steps.**
1. Columns: rename Windsurf to "Devin Desktop (formerly Windsurf; Cascade removed September 2026)"; mark Continue.dev "(repository read-only since June 2026)" or drop the column; mark Aider "(dormant; no release since 2025)"; refresh Cline (4.x subagents, Agent Plugins discovery) and Cursor (3.0 parallel agents in worktrees, `/goal`) from their changelogs, each with the date read.
2. PAN rows, from the audit's evidence: Multi-Agent (army, `--hierarchical`, four native Claude Code workflow scripts), Git (`/pan:git` subcommands, branching strategies, worktrees, revert-only release), Cost (ledger, rate table, `/pan:phase-budget`, campaign budgets), Cross-Platform (hooks on four runtimes, unified tree, both plugin bundles), Session (stop-guard, hygiene, `health --repair`, campaigns), Context (statusline and context-monitor hooks, `learn topics-for`), Plan Verification (twelve checker dimensions), Codebase Awareness (single-shot vs sharded, native `pan-map-codebase`).
3. New section "Direct peers — spec-driven layers": a table of Spec Kit, BMAD, gsd-core, Superpowers and OpenSpec against Appendix C of the skill (durable state, research, plan verification, UAT, deterministic orchestration, harness, distribution, MCP, runtimes, cost routing), each cell dated. Source data: the peer agent's grid in the run and each project's releases page.
4. "Leads" item 1 (context-rot prevention): read gsd-core's executor workflow before keeping "no competitor solves this"; if it spawns per-plan executors, rewrite the item as a shared strength with PAN's differentiator (learnings-scoped context, stop-guard).
5. Collapse the two-date "Last verified" line to one date once every row has been touched.

**Gate.** No "no competitor" or "nobody else" phrase remains without a dated check (`grep -nE "no competitor|nobody else|every competitor" docs/COMPARISON.md`); doc-lint and model-drift green. **Status.** Done `2026-09-10` (commit b9ca497).

### R6 · P3 · S (2) — OpenCode and Gemini live gates; cite the loader

**Finding.** RC8. PAN writes `.opencode/opencode.json` (config-dir-relative `localPath` in `MCP_REGISTRATION.opencode`, `bin/install-lib.cjs` 1129–1130). The docs page lists only a repo-root `opencode.json`; the loader source (`packages/opencode/src/config/config.ts`, the branch `if (dir.endsWith(".opencode") …) for (const file of ["opencode.json","opencode.jsonc"])`) reads it. The `why` cites the docs page. The harness has live gates for Codex, Copilot and Antigravity only.

**Files.** `bin/install-lib.cjs` (`MCP_REGISTRATION.opencode.why`); `harness/scenarios/live-gate-opencode.json`, `harness/scenarios/live-gate-gemini.json`; `tests/mcp-registration.test.cjs`.

**Steps.**
1. `why`: append "Loader source `packages/opencode/src/config/config.ts` reads `opencode.json`/`.jsonc` inside any `.opencode` directory (read 2026-09-10); the docs page lists only the repo-root file, so this path is live but undocumented — re-check the loader on OpenCode upgrades."
2. `live-gate-opencode.json` (tier 0, `requires.cli: opencode`, seed `empty`, `install: ["--opencode","--local"]`): steps `cli opencode --version` → `exit:0`; `fs` read `.opencode/opencode.json` → `json:mcp.pan.type=local`; `cli opencode mcp list` → `exit:0`, `stdout~pan` if the subcommand exists — otherwise record stderr as the evidence (the Antigravity gate's "either outcome is information" pattern). Follow `live-gate-codex.json` for shape and `why` text.
3. `live-gate-gemini.json` (tier 0, `requires.cli: gemini`, `install: ["--gemini","--local"]`): `cli gemini --version` → `exit:0`; `cli gemini mcp list` → `stdout~pan`; the `why` must say the workspace has to be trusted first (RC14) and name the flag or prompt that trusts it.
4. Pin the `why` in `tests/mcp-registration.test.cjs`: the opencode row's rationale names `config.ts`.

**Gate.** `npm run harness` shows both scenarios SKIPPED with reason on this machine; they pass on a machine with the CLIs (record the run id in the ledger). **Revert-proof.** Remove `config.ts` from the `why` → the pin fails. **Status.** Done `2026-09-10` (commit 5320552).

### R7 · P2 · S (2) — Rate rows for four priced models

**Finding.** RC9. `resolveRate` returns `null` for `claude-mythos-5-1`, `claude-mythos-5`, `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`; all are on `platform.claude.com/docs/en/about-claude/pricing` (read 2026-09-10): Mythos 5.1 $10/$50, cache read $0.25, write $12.50; Mythos 5 $10/$50/$1/$12.50; Opus 4.5 $5/$25/$0.50/$6.25; Sonnet 4.5 $3/$15/$0.30/$3.75.

**Files.** `pan-wizard-core/bin/lib/cost.cjs` (`DEFAULT_RATES`, lines 57–69); `tests/cost.test.cjs`.

**Steps.**
1. Add rows `claude-mythos-5-1`, `claude-mythos-5`, `claude-opus-4-5`, `claude-sonnet-4-5` with the numbers above and a comment citing the pricing page and the date. Mythos 5.1 shares Fable 5.1's 0.025× cache-read convention — say so in the comment (the pricing footnote names both).
2. Leave `RATES_VERIFIED_AT` at `2026-09-10`. Put the pricing-page URL in the commit message (the rule from the September plan).

**Tests.** Dated ids resolve via `familyPrefixRate` (line 108) to the new rows: `claude-opus-4-5-20251101` → the 4.5 row, not a 4.x neighbour; `claude-sonnet-4-5-20250929` → the 4.5 row; `claude-mythos-5-1` differs from `claude-mythos-5` (copy the `claude-fable-5-1` longest-prefix test at lines 53–70). **Revert-proof.** Delete one row → its test fails. **Status.** Done `2026-09-10` (commit 1d42428).

### R8 · P3 · XS (1) — Pin "zero runtime dependencies"

**Finding.** RC10. No test or gate asserts `package.json` has no `dependencies`.

**Files.** New `tests/package-contract.test.cjs`; `scripts/release-check.js` Gate 6.

**Steps.**
1. Test: `require('../package.json').dependencies` is undefined or empty; `files` excludes `dist/`, `harness/`, `marketplace/`; `bin` points at `bin/install.js`.
2. Gate 6 (npm pack size sanity, line 128): add one line failing the gate when `dependencies` is non-empty, with the reason "PAN ships zero runtime dependencies (README, COMPARISON)".
3. Refresh the CLAUDE.md counts table (unit test files row) via the snippet.

**Revert-proof.** In a temp copy of `package.json` with `"dependencies": {"x":"1"}`, the test fails. **Status.** Done `2026-09-10` (commit 79582dc).

### R9 · P7 · XS (1) — MCP server reports the package version

**Finding.** RC11. `SERVER_INFO = { name: 'pan-mcp', version: '0.1.0' }` (`pan-wizard-core/mcp/server.cjs` line 53) while the package is 3.27.0. Tests check only the name (`tests/pan-zcode-mcp.test.cjs` lines 131, 233).

**Steps.**
1. `readPackageVersion()`: try `path.join(__dirname, '..', '..', 'package.json')` — the repo root in the source tree, the runtime directory in an install (the installer writes `package.json` beside `pan-wizard-core/`), absent in the plugin bundle; fall back to the plugin manifest at `../../.claude-plugin/plugin.json` if present, else the literal `0.0.0-unknown`. Read once at module load, never throw.
2. `SERVER_INFO.version = readPackageVersion()`; keep the export.

**Tests.** In `pan-zcode-mcp.test.cjs`, `initialize` returns `serverInfo.version === require('../package.json').version`; a test with a fake `__dirname` layout lacking both files gets the fallback. Optionally extend `harness/scenarios/mcp-bridge-cwd.json` with `rpc:<id>.result.serverInfo.version=<pkg>` if the runner exposes the package version to `expect` templates (check `fill()` vars first). **Revert-proof.** Restore the literal → the equality fails. **Status.** Done `2026-09-10` (commits ab50f06, 27945f2).

### R10 · P4 · S (2) — Stale Agent Plugins bundle cannot ship

**Finding.** RC12. `.agents/plugins/marketplace.json` and `.github/plugin/marketplace.json` resolve to `./dist/pan-agent-plugin`; release Gate 8 builds both bundles into a temp dir (`scripts/release-check.js` 196–215) and never looks at `dist/`; `dist/pan-agent-plugin/` was observed stale today (built before the S3 vendor-directory commit). The Claude `command` source rebuilds on resolve; the Agent Plugins sources cannot.

**Files.** `scripts/release-check.js` (Gate 8); a pure helper `dirDigest(dir)` (file list + sha256) in `bin/install-lib.cjs` or a new `scripts/lib/dir-digest.cjs`; `marketplace/README.md` (line 141 area); tests.

**Steps.**
1. After building `agentOut` in Gate 8: if `dist/pan-agent-plugin/` exists and `dirDigest(dist) !== dirDigest(agentOut)`, fail the gate with "dist/pan-agent-plugin is stale — run `npm run build:agent-plugin` (the Codex and Copilot marketplaces install from it)". The gate stays read-only: it never writes `dist/`.
2. Apply the same comparison to `dist/pan-wizard-plugin/` as a warning only (the Claude marketplace rebuilds on resolve).
3. `marketplace/README.md`: one paragraph — build the bundle before any local Codex or Copilot install, and the release gate now refuses a stale one.

**Tests.** Unit test for `dirDigest` (order-independent, content-sensitive); a release-check test that seeds a stale `dist/` copy in a temp checkout and sees the gate go red (the plugin-marketplace test's harness pattern). **Revert-proof.** Touch one byte in `dist/pan-agent-plugin/plugin.json` → Gate 8 fails. **Status.** Done `2026-09-10` (commit fecb9d2).

### R11 · P7 · XS (1) — Remove the stray `nul/` directory · user action

**Finding.** RC13. `D:\PanWizard\nul\` holds an npm cache (`_cacache`, `_logs`) created 2026-08-21; git cannot open it and warns on every command.

**Steps.**
1. From cmd (Windows reserved name, extended-path form): `rd /s /q \\?\D:\PanWizard\nul`.
2. Find the cause so it does not recur: `grep -rnE "cache[= ]+nul|NPM_CONFIG_CACHE|> ?nul\b" scripts package.json .github tests` — a PowerShell `> nul` redirection or a `--cache nul` argument run through Git Bash creates a real path named `nul`.
3. Verify `git status` prints no warning.

**Status.** Open (user action; Claude does not delete directories it did not create).

### R12 · P6 · XS (1) — TROUBLESHOOTING precision

**Finding.** RC14, from the runtime re-verification.

**Files.** `docs/TROUBLESHOOTING.md`: "The `pan` MCP server is missing on Gemini CLI in a fresh checkout" (near line 937), "Per-agent `effort:` appears to have no effect" (near 637), and a note near the update/upgrade guidance.

**Steps.**
1. Gemini: in an untrusted folder the whole project `.gemini/settings.json` is skipped, so PAN's hooks are absent too, not only the MCP server (trusted-folders doc plus release `0.59.0`, read 2026-09-10).
2. Effort: a `maxEffortLevel` setting (top-level or per model under `modelSettings`, Claude Code `2.1.267`) can clamp PAN's `effort:` frontmatter; check it before assuming the frontmatter is ignored.
3. Codex: since `0.154.0`, live sessions pick up plugin skill and hook changes after an upgrade without a restart; a stale skill after `pan-check-update` is therefore not a Codex caching issue.

Write by capability where a model is involved; runtime version numbers are fine. **Gate.** `node --test tests/model-version-drift.test.cjs tests/doc-lint.test.cjs` green. **Status.** Done `2026-09-10` (commit 2f36176).

### R13 · P5 · S (2) — Copilot agent `model:` fallback lists · gated

**Finding.** RC15. Copilot CLI `1.0.83` custom agents accept a `model:` list tried in order and `model-policy: required` (`docs.github.com` custom-agents page, read 2026-09-10). `convertClaudeToCopilotAgent` (`bin/install-lib.cjs` from line 742) emits `name`, `description` and `tools` only; three agents pin a model (`agents/pan-hardener.md`, `pan-meta-reviewer.md`, `pan-reviewer.md`).

**Steps.**
1. Re-read the Copilot page for the exact field names and accepted model ids (Copilot spells them with dots, e.g. `claude-fable-5.1`); record the URL and date in a code comment.
2. Add a Copilot row to `PROVIDER_MODELS` in `pan-wizard-core/bin/lib/core.cjs` if absent (tier → Copilot id), so the converter maps a pinned tier to `[primary, fallback]` and emits `model:` as a YAML list plus `model-policy: prefer` (degrade gracefully; `required` would refuse to run when the model is unavailable).
3. Emit only when a flag or config enables it (ADR-0028: unverified frontmatter waits for a live check); default off until the live gate below passes, then flip.

**Tests.** `tests/copilot-install.test.cjs`: list emitted when enabled, absent when disabled; non-pinned agents get no `model:`. **Gate.** Extend `live-gate-copilot.json` with a step that installs an agent carrying the list and checks Copilot accepts it (`copilot agent list` or the CLI's own validation output). **Revert-proof.** Disable the emission path → the enabled-case test fails. **Status.** Built `2026-09-10` (commit 194565c): the converter takes `modelLists` and emits the list plus `model-policy: prefer`; default output byte-identical. Not wired into the installer — the live probe in `live-gate-copilot.json` (writes a probe agent, asks `copilot agent list`) must pass first. Needs a machine with Copilot CLI.

### R14 · P4 · M (4) — Antigravity: measure first, then variant if needed

**Finding.** RC16. ADR-0045 deferred an Antigravity variant (own `$schema` `https://antigravity.google/schemas/v1/plugin.json`, fields `name`/`description`/`$schema`, `mcp_config.json` not `mcp.json`, discovery in `.agents/plugins/` and `_agents/plugins/`). `live-gate-antigravity.json` exists and skips here. Superpowers documents `agy plugin install <github-url>` of a `.claude-plugin` repository, so Antigravity may load Claude-format plugins.

**Steps.**
1. On a machine with `agy`: run `node harness/src/run.cjs --scenario live-gate-antigravity` (installs the Agent Plugins bundle). Then a second probe, added to the scenario as a separate step: `agy plugin install <path to dist/pan-wizard-plugin>` (Claude format). Record both outcomes in the ledger.
2. Outcome "Claude plugin accepted": no variant; document the install line for Antigravity in `marketplace/README.md` and `docs/USER-GUIDE.md`; close.
3. Outcome "both rejected": add step 8 to `scripts/build-agent-plugin.js` behind `--antigravity` (or a sibling `build-antigravity-plugin.js`), emitting `dist/pan-antigravity-plugin/` with `plugin.json` (three fields only), `mcp_config.json` (shape verified from `antigravity.google/docs/cli/plugins`, read on the day), `hooks.json`, `skills/` (unchanged), `agents/` and `rules/` as documented; reuse the existing converters (one compiler, two call sites). Conformance test mirroring `tests/agent-plugin-build.test.cjs` with the closed three-key schema pinned as a fixture.
4. Add the emitted variant to Gate 8 and to the `.agents/plugins/` discovery path.

**Gate.** `live-gate-antigravity` passes with either the bundle or the variant. **Status.** Probe added `2026-09-10` (commit 194565c): `live-gate-antigravity.json` now also builds the Claude plugin and tries `agy plugin install` on it. Both outcomes are information; the variant is built only if both bundles are rejected. Needs a machine with `agy`.

### R15 · P2 · M (4) — Recognise a foreign `.planning/` and refuse to touch it

**Finding.** RC17, sharpened. gsd-core writes `.planning/PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` in uppercase (its USER-GUIDE, read 2026-09-10) — exactly PAN's `LEGACY_UPPERCASE_FILES` (`pan-wizard-core/bin/lib/hygiene.cjs` line 68). `hygiene scan` will therefore report a gsd-core project as `legacy-filenames`, and `hygiene clean --apply` would **rename another tool's state files**. `validate health` cannot tell a foreign tree from a broken one. gsd-core also writes paths PAN never does — `MILESTONES.md`, `HANDOFF.json`, `.gsd-allow-shrink`, `forensics/`, `threads/`, `seeds/`, `ui-reviews/`, `sketches/`, `spikes/`, `onboarding/` — and a flat, dotted-key `config.json` (`workflow.discuss_mode`, `graphify.enabled`, `intel.enabled`, `hooks.workflow_guard`, `dynamic_routing`), where PAN's is nested.

**Files.** `pan-wizard-core/bin/lib/constants.cjs`, `hygiene.cjs`, `verify.cjs`, `init.cjs` (and the new-project workflow's preflight); `docs/CLI-REFERENCE.md` (health code table); `docs/TROUBLESHOOTING.md`; `docs/USER-GUIDE.md` (planning roots); tests and a fixture.

**Steps.**
1. `constants.cjs`: `FOREIGN_PLANNING_MARKERS = { gsd: { files: ['HANDOFF.json','MILESTONES.md','.gsd-allow-shrink'], dirs: ['forensics','threads','seeds','ui-reviews','sketches','spikes','onboarding'], configKeys: ['graphify.enabled','intel.enabled','hooks.workflow_guard','workflow.discuss_mode','dynamic_routing'] } }` with the source URL and date in a comment.
2. `hygiene.cjs`: `detectForeignPlanningTree(dir)` returns `{ tool, evidence[] }` when at least two markers match or any dotted config key is present. When detected: emit one `foreign-planning-tree` finding (severity `warn`, `fixable: false`, evidence listed), **skip** `legacy-filenames` entirely, and make `clean` refuse `rename-lowercase` with a hard message: "this `.planning/` belongs to gsd-core; PAN will not rename its files — give PAN its own tree with `--planning-dir` (ADR-0043)".
3. `verify.cjs` `cmdValidateHealth`: when `.planning/` exists and is foreign, add error code `E00N FOREIGN_TREE` with the same fix text; add the row to the CLI-REFERENCE code table (the `verify-health-codes` test is driven from that table, so the doc and the code move together).
4. `init.cjs` / new-project preflight: refuse to scaffold into a foreign tree; suggest `--planning-dir .planning-pan`.
5. Docs: TROUBLESHOOTING "Another tool already owns `.planning/`"; USER-GUIDE planning-roots section gains the coexistence paragraph.

**Tests.** Fixture `tests/fixtures/foreign-planning/gsd/` (uppercase files, `HANDOFF.json`, dotted `config.json`): `hygiene scan` reports `foreign-planning-tree` and **no** `legacy-filenames`; `hygiene clean --apply` performs zero renames (assert the file names afterwards); `validate health` reports the new code and exits 1 (after R2). A PAN legacy tree (uppercase files, nested PAN config, no gsd markers) still gets `legacy-filenames` — both directions pinned. **Revert-proof.** Drop the marker check → the zero-rename assertion fails. **Status.** Done `2026-09-10` (commit a3c4f28).

### R16a · P7 · S (2) — Decision: one core per project (ADR)

**Finding.** RC18. Every selected runtime directory carries its own full `pan-wizard-core` copy; `--unified-skills` adds a sixth at `.agents/pan-wizard-core/`. Measure with the skill's Phase 4.2 command on a packed install in `d:\pantesting`. ADR-0028 Phase 2 already made the shared core the runtime-neutral home for unified skills; the per-runtime copies remain for the proprietary command trees.

**Steps.** Write ADR-0048 with: context and the measurement command; options — (A) status quo, (B) local installs point every runtime's commands, hooks and MCP registration at `.agents/pan-wizard-core/` and drop the per-runtime copies, (C) links (rejected: Windows symlink privileges); costs of (B) — manifest ownership and ref-counted uninstall (exists for the shared tree), path rewriting in the converters (`rewriteSharedCoreMarkdown` exists), `--config-dir` custom dirs, hooks resolving the core relative to the runtime dir, `MCP_REGISTRATION` paths, and the fact that **global installs cannot share** (different runtime homes); the gate for (B) — `install-matrix` and `runtime-roundtrip` green, footprint measured before and after. **Status.** Done `2026-09-10` (commit 2444f61); decided the same evening — option A accepted, see the ADR.

### R16b · P7 · L (10) — Implement the shared core for local installs · conditional

Only if ADR-0048 accepts (B). Steps live in the ADR; sequence: converters and path rewriting first (unit-tested), installer wiring second, uninstall third, harness `install-matrix` and the runtime round-trip scenario last. Own session. **Status.** Closed `2026-09-10` — ADR-0048 accepted option A; the duplication is an accepted cost with a recorded revisit trigger.

### R17 · P3 · M (4) — Harness scenarios for the uncovered behavioural claims · blocked on spend

**Finding.** RC20. No scenario covers: research → plan → checker loop, UAT diagnosis, quick mode, pause and resume, bot army, unified-skills discovery, map-codebase modes. Only the `two-plan-phase` seed exists.

**Steps.**
1. Seeds under `harness/seeds/`: `phase-needs-plan` (a roadmap with one unplanned phase), `uat-with-failure` (a `uat.md` carrying one failed truth), `small-repo` (for single-shot map-codebase).
2. Scenarios (tier 1 or 2, each with a mutation fixture that proves it can fail, per ADR-0047): `plan-phase-checker-loop` (expects research and plan files plus a checker verdict), `uat-diagnose` (expects debugger findings and a fix plan), `quick-mode` (expects `.planning/quick/` artefacts and a commit), `pause-resume` (expects `.continue-here.md` then a resumed state), `map-codebase-single-shot` (expects `.planning/codebase/` documents from one agent), `unified-skills-discovery` (per runtime, `requires.cli`; ADR-0028 P4's live discovery gate).
3. Size the caps from the README's measurement (a chain rep costs several dollars); run each new scenario five times.

**Gate.** Each scenario's mutation fixture is red before the real seed is green; the ledger records the run ids. **Status.** Built `2026-09-10` (commit fc0e16c): seeds `phase-needs-plan`, `uat-with-failure`, `small-repo`; scenarios `plan-phase-checker-loop`, `uat-diagnose-native`, `quick-mode`, `pause-resume`, `map-codebase-single-shot`, `unified-skills-discovery`. All validate; none has run — each needs `--max-usd`. The UAT path uses the native `/pan-diagnose-issues` because the markdown walkthrough is interactive.

### R19 · P2 · M (4) — Run item 5c properly · blocked on spend

**Finding.** RC22. Run `run-20260910-190841-i1aw` (build `8e776bf`, twenty-dollar cap) completed the markdown chain in three of five reps: rep 4 exited non-zero with `passed=false`; rep 5 produced no summaries and no source files. The native chain was budget-starved before step 1 in every rep by the pre-`87e53c9` equal split.

**Steps.**
1. `node harness/src/run.cjs --scenario markdown-exec-phase-chain --scenario native-exec-waves-chain --tier 2 --repeat 5 --max-usd 50 --keep` (the README's sizing for both chains together).
2. Read the failed reps' workspaces under `ws/` and the `claude -p` JSON: find the drop point (which step the orchestrator skipped, or which tool call failed) and whether the stop-guard hook fired.
3. Compare completion rates. Decision rule (from the August review): recommend the native path on Claude Code only if it completes at least as often as the markdown path.
4. Record the result as a dated note in §9's successor and update the ledger; if the markdown path stays below five of five, open a P2 item against the drop point with the transcript as evidence.

**Gate.** Five reps each, one run, one build. **Status.** Done `2026-09-11`. Markdown `/pan:exec-phase`: five of five (mean $4.97, 14.4 min per rep; `run-20260910-214704-wgJSxr`). Native `/pan-exec-waves` under the lifted ceiling (R23, `run-20260910-235141-ITzx9T`): five of five, verification file in every rep (mean $4.71, 12.3 min). By the August rule the native path is the recommended one on Claude Code; USER-GUIDE says so with the numbers' provenance. Every native rep before the ceiling fix measured the ceiling (RC24), not the chain.

### R20 · P3 · S (2) — A model step that never ran cannot file a finding

**Finding.** RC23. Two tier-1 runs of `plugin-agent-scope` spent nothing, finished in seconds and printed neither greppable line; the ledger now carries two findings the two-run rule will promote. `runModelStep` (`harness/src/model.cjs`) returns `costUsd`, `turns`, `durationMs`, `stdout`; `run.cjs` (lines 150–262) evaluates `expect` on the result regardless.

**Steps.**
1. In `run.cjs`, after `runModelStep`: if `!r.refused && r.costUsd === 0 && (r.turns === null || r.turns === 0)`, set `rec.status = 'error'`, `rec.note = 'model step produced no turns and no spend — probe or harness fault: ' + stderr`, skip assertion evaluation, do not create findings, and let the run exit non-zero (an error is not green).
2. Reproduce the probe: `node harness/src/run.cjs --scenario plugin-agent-scope --tier 1 --max-usd 1 --keep`, read `ws/` and the `claude -p` stderr (a missing `--plugin-dir`, a permissions refusal, or a plugin that never installed are the candidates); fix the scenario or the runner accordingly.
3. Ledger: after the fix, a passing run resolves the two phantom findings. If the probe cannot be made to run here, withdraw them in a commit whose message states why (the PanLoop practice), rather than leaving promotable phantoms.

**Tests.** A unit test in the harness test file feeding a zero-turn, zero-cost result → status `error`, no findings, exit non-zero. **Revert-proof.** Remove the guard → the test fails. **Status.** Done `2026-09-10` (commit 5eb7ae7).

### R21 · P7 · M (4) — Body-budget split, measured not guessed · blocked on a live session

**Finding.** RC19 (parked item 11). Five emitted skills exceed the Agent Skills body recommendation (`focus-design`, `focus-auto`, `focus-doc-audit`, `focus-drift-walking`, `pan-army` once the adapter header is added). The August note stands: a split changes what the agent reads and when, which a size check cannot verify.

**Steps.**
1. Measure: on a packed install, run `/skill-doctor` in a live Claude Code session and record each PAN skill's context cost; keep the Phase 4.1 loop as the offline oracle.
2. Split one offender, the largest (`commands/pan/focus-design.md`): activation instructions stay in the command; the procedural body moves to `pan-wizard-core/references/focus-design-procedure.md`, pulled by an `@` reference at the step that needs it (the tier-3 mechanism the compiler already uses).
3. A/B at tier 1: the same `/pan:focus-design` prompt on the same seed, two reps each with the original and the split; compare the artefacts produced and the `cost` ledger tokens.
4. Parity or better → apply the pattern to the other four and add a test that the emitted `SKILL.md` bodies stay under the recommendation; worse → record why in the item and re-park with the evidence.

**Gate.** Artefact parity and lower activation tokens, measured. **Status.** Measured `2026-09-10` (commit 0cfd82f, run `run-20260910-215459-NRyNkG`): control $1.61 and $1.79 (3.8 and 5.4 min), split $1.83 and $1.81 (6.2 and 6.7 min); same section structure, the split arm's specs ~30% longer. **Verdict: the split does not reduce the cost of using the command** (the body loads on invocation either way and the extra Read adds a turn) — it raises cost ~7% and time ~40%. The shipped layout stays; the variant remains in `harness/variants/` as the record. Item 11 closes: the Agent Skills body recommendation protects activation cost, and a PAN command's activation is its invocation. The `/skill-doctor` reading needs Claude Code 2.1.261 (this machine runs 2.1.233); the scenario is gated by `requires.minVersion` (commit bb52a4f).

### R18 · P6 · XS (1) — Roster · **Done 2026-09-10**

Appendix B of `.claude/commands/reality-check.md` names gsd-core, OpenSpec and Taskmaster's dormancy; §9 carries the roster change. **Verify:** `grep -n "open-gsd/gsd-core\|Fission-AI/OpenSpec" .claude/commands/reality-check.md`.

---

## Session queue (Phase 4)

Items are small, so sessions are bounded by their blockers rather than by the forty-point budget; S6 and S7 fit one sitting each and can be run back to back.

| Session | Items | Pts | Theme | Exit criterion |
|---|---|---|---|---|
| **S6** | R1, R2, R7, R8, R9, R12, R4 | 12 | Truth pass before the next release — **Done `2026-09-10`** | CHANGELOG states the alias reason; `validate health` exit pinned by a real-CLI test; four rate rows cited and tested; zero-dep pinned; server reports the package version; README has no FALSE row on a claims re-audit; full suite and all gates green |
| **S7** | R15, R20, R10, R6, R5, R16a | 16 | Foreign trees, probe integrity, comparison, gates — **Done `2026-09-10`** (ADR-0048 written, Proposed) | `hygiene clean` performs zero renames on the gsd fixture; a zero-spend model step records `error`; a stale `dist/` turns Gate 8 red; OpenCode and Gemini gates exist and skip with reason here; COMPARISON has no undated "no competitor"; ADR-0048 written either way |
| **S8** | R19, R17, R21, R13, R14 | 18 | Model tier and live gates | run where `claude` has a spend cap and where `copilot` and `agy` exist; five reps per chain; each new scenario proven able to fail |
| **S9** | R16b | 10 | Shared core | **Closed `2026-09-10`** — ADR-0048 accepted option A (status quo); nothing to implement |
| Any time | R11 | 1 | User action | `git status` prints no warning |

**Executed `2026-09-10` (evening), S6 and S7, on the current branch by the user's instruction rather than on a fresh one.** Every item's suite, release gates (including the new stale-bundle check) and the model-free harness were green at the close; a fresh five-runtime install in `d:\pantesting\execplan-check` confirmed the verdict exit code, the foreign-tree refusal and the bridge's reported version. Found while executing: `validate health`'s exit code reached the `pan://health` resource and eleven scenario tests that had encoded exit 0 (all updated); the runtime directory's `package.json` carries no version, so the bridge reads the install manifest; the stale-bundle gate fired on its first real run, on a `dist/` left behind by earlier commits in the same session.

**Ordering rationale.** S6 fixes what is wrong in the tree PR #29 is about to merge and costs one sitting. S7 leads with R15 because it is the only item where PAN could damage another tool's files, and with R20 because the next model-tier run must not file phantom findings. S8 needs machines and money this one does not have; R19 goes first there because it is the one measurement the whole native-workflows move rests on.

---

## Execution protocol (per session, with `/execplan`)

1. Branch: `feat/reality-check-2026-09` off `main` after PR #29 merges. Never on top of #29.
2. Per item: implement → run the item's tests → **revert-proof** (break the fix, see the named assertion red, restore) → `npm test` for the touched area.
3. Per session close: `npm run test:all`, `node scripts/release-check.js`, `npm run harness`; regenerate `docs/SKILLS-*.md` if any command or dev skill changed (`python scripts/generate-skills-docs.py`); refresh the CLAUDE.md counts table if a test file or spec was added; `node --test tests/doc-lint.test.cjs tests/model-version-drift.test.cjs tests/claude-md-counts.test.cjs`.
4. Commit with `/commit`, one commit per item or per coherent group; the user decides when to push and open the PR (push with an explicit refspec — the tag-push trap is on record).
5. Update the memory note with what was refuted or learned, not with what the repo already records.
6. Mark each item's Status in this file when it closes, with the date and the commit; do not renumber.

---

## What not to do (carried forward, all still holding)

Do not retire the markdown workflows · do not chase a sixth runtime · do not standardise `.planning/` · do not soften the behavioural harness · do not list on a skills marketplace on quality grounds alone · do not fork the skills compiler · do not emit frontmatter a runtime has not been seen to read · do not add a model rate without a primary citation · **do not describe `.planning/` as unthreatened or unique** (gsd-core shares the layout; the differentiator is depth) · **do not write "no competitor" or "nobody else" in an evergreen doc without a dated peer check**. New for this plan: **do not let `hygiene clean` rename anything in a tree PAN did not create** — R15 makes that a hard refusal.

---

## Verification caveats and blockers

- **CLIs absent here:** `codex`, `copilot`, `gemini`, `opencode`, `agy` (only `claude`). R6, R13, R14 and the unified-skills scenario in R17 record SKIPPED until run elsewhere.
- **Spend:** R17, R19 and R21 need `--max-usd`; size from the README's per-rep measurement and run five reps.
- **User action:** R11.
- **Secondary-source claims that gate building:** Antigravity's acceptance of Claude-format plugins (Superpowers' install line only); Copilot's exact `model:` list semantics beyond the docs page. Both are measured before code ships (R14 step 1, R13 step 1).
- **Anchors move:** every line number here is from 2026-09-10; re-grep the quoted phrase, not the number.

---

## Sources

The run's sources are listed in the Addendum of [market-delta-2026-09-superplan.md](market-delta-2026-09-superplan.md). Added for this plan: `raw.githubusercontent.com/open-gsd/gsd-core/main/docs/USER-GUIDE.md` (the `.planning/` layout and `config.json` keys behind R15) and `github.com/open-gsd/gsd-core` (read 2026-09-10).
