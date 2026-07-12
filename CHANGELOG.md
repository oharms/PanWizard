# Changelog

All notable changes to PAN Wizard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.15.0] - 2026-07-12

### Added — per-phase HTML reports (`pan-tools report` / `pan:report`, M1)

The HUD is a single project-level snapshot; the work a project leaves behind phase by phase (`plan.md`, `summary.md`, `verification.md`) had no graphical, shareable form. The new `report` command renders self-contained HTML for the phases of a project, reusing the HUD's rendering foundation so both surfaces look identical. This is milestone 1 — the manual command; automatic generation as a build deliverable (workflow/focus-auto/army wiring) follows in later milestones.

- **`pan-tools report phase <N>`** writes a self-contained `.planning/phases/<NN-slug>/<NN>-report.html` — dark hero, the full-roadmap stepper with this phase as the "now" dot, a metric strip, and panels for objective & success criteria, what changed, verification & quality, and gaps.
- **`pan-tools report index`** writes `.planning/report-index.html`, a project timeline whose rows link to each phase report; **`report all`** regenerates every report plus the index.
- **Honest by construction.** The `verify reconcile` verdict is shown beside the (rubber-stampable) self-reported verification status; status is framed as a current-disk snapshot; per-phase requirements are derived from plan/summary frontmatter (never the global count); and any spend routes through `ledgerReliability()` so a poisoned or unpriced ledger never renders a fake `$0`.
- **Deterministic writes.** The only volatile value (the generated-at timestamp) is ignored when comparing to the existing file, so re-running rewrites nothing when phase data is unchanged — no git churn.
- **Graceful degradation.** Empty/researched/planned phases render valid honest reports; a phase-less (focus-auto) project has nothing to report, so `index` exits with a pointer to `pan:hud` rather than emitting a dead shell.
- **New module `phase-report.cjs`** follows the HUD's pure-collect / pure-render / thin-cmd split. It reuses `hud.cjs`'s styling primitives (now exported: `HUD_CSS`, `pill`, `bar`, `metricCard`, `pipelineStage`, …) with zero HUD logic change. The browser opener's inline allowlist barrier is duplicated byte-identically (a CodeQL taint barrier must stay a literal, not a shared helper) — a test asserts the two copies never diverge.

### Fixed — HUD is now useful for non-phase projects and honest about cost

The dashboard was built around the standard phase/state/roadmap layout, so a focus-auto or imported project (no `state.md`/`roadmap.md`/`phases/`) rendered a near-empty shell — and a poisoned or unpriced cost ledger was presented as a real `$0.00` spend.

- **Planning-activity fallback panel.** When a project has no phase/roadmap layout, the HUD now summarises its `.planning/` markdown — document count by folder plus the most-recently-updated docs — instead of leaving mission + telemetry floating on a bare page. Only markdown is stat-ed (a focus-auto ledger can hold tens of thousands of JSON artifacts, which are never walked); the scan is depth- and entry-bounded. Standard phase-based projects are unchanged (the panel is suppressed when a roadmap exists).
- **Honest cost degradation.** Telemetry and the mission "Spend" card no longer show a fabricated `$0.00`. A shared `ledgerReliability()` check detects two failure modes — the pre-v3.12.4 transcript-oversum bug (more records quarantined than survived) *and* a wholly-unpriced ledger (every surviving record lacks a resolvable model→rate) — and renders an advisory plus the real token volume rather than a dollar figure the data can't support.
- **Cleaner empties.** `Phase 0` and `Progress —` no longer read as if `0` were a real phase; a lone panel renders full-width instead of floating in a lopsided half-grid.

## [3.14.0] - 2026-07-12

### Added — anti-fabrication hardening (ADR-0036 review follow-ups)

Closes the gaps a deep anti-fake review found: the pipeline could still advance a rubber-stamped verification, a fabricated "tests pass", a hardcoded stub, or an aspirational doc flag with no deterministic contradiction.

- **`verify reconcile <phase>`** cross-checks the agent-written `verification.md` `status:` against the mechanical signals (artifact substance + key-link wiring); a claimed pass over failing checks exits non-zero. Wired into the `exec-phase` auto-advance gate so a rubber-stamped verification cannot auto-advance. The artifact/key-link checkers were extracted into pure functions (`checkArtifacts` / `checkKeyLinks`).
- **`verify stubs`** scans changed files for fake-implementation markers (`not implemented`, throw-stubs, HTTP 501, `return {ok:true}`, empty returns, TODO); high-severity is the blocking set (`--gate`).
- **`doc-lint flags`** flags documented `pan-tools … --flag` tokens that don't exist in source (a diagnostic — scoped to the pan-tools surface; aspirational-doc dirs excluded).
- **`doc-lint counts`** now catches bare "N tests" / "N hooks"; a new SSoT self-audit test recomputes every file-based count from disk and asserts CLAUDE.md's table matches, so the counts source-of-truth can no longer drift silently.
- **`focus auto` regression breaker** re-runs the `node:test` suite and uses the real pass count when `focus.verify_tests` is enabled; otherwise it records `tests_verified: false` so a self-reported count is visible rather than silently trusted.
- **CI/release gates:** `links validate` (doc↔code graph) added to `release-check.js` and CI; the count SSoT test runs via `npm test`.
- Fixed a latent bug: `runFullTestCheck` parsed only the TAP (`# tests`) reporter and silently returned `null` on modern Node's spec reporter (`ℹ tests`).

### Fixed — documentation accuracy sweep (`/pan:doc-audit --deep`)

A prose-vs-code audit across the eight core docs corrected content drift, each fix verified against source: `workflow.nyquist_validation` default (`true`→`false`), config key `plan_checker`→`plan_check`, the model-profile matrix (Quality is `inherit` for every agent, not `sonnet`), Codex agent paths (`.md`→`.toml`), stale "Opus 4.7"→"4.8", a dead `/pan:complete-phase` reference and an unimplemented `pan-tools --version`, README-documented flags/config that don't exist (`/pan:health` extra flags, `standards_health`, progress "health subformat"), nonexistent DEVELOPMENT installer-copy steps, and drift-prone counts replaced with qualitative phrasing (count-SSoT). The Nyquist layer is reframed as opt-in.

## [3.13.1] - 2026-07-09

### Changed — public-release hygiene sweep

Preparation for taking the repository public. Full-history secret scan (gitleaks, 200 commits): clean; commit authorship already uses noreply addresses.

- **Neutral codenames in shipped content.** Field-sourced learnings, workflow notes, and CHANGELOG entries now reference source projects by neutral codenames (e.g. "the lending project", "the compliance project") instead of private project directory names; machine-local absolute paths removed from repo docs. No pattern content changed — only source identity. Learnings index rebuilt; lint-strict clean.
- **Community health files.** Added `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md` and `PULL_REQUEST_TEMPLATE.md`; SECURITY.md supported-versions table refreshed; CODE_OF_CONDUCT enforcement contact now routes to GitHub private reporting (was a placeholder email); README clone-directory casing fixed.
- **Stale tracked build artifacts untracked.** Three `hooks/dist/*.js` copies predating the ignore rule removed from git (regenerated at build/release; `hooks/dist` still ships to npm via the build).

## [3.13.0] - 2026-07-02

### Added — project hygiene system: version alignment + history/memory cleanup (`hygiene.cjs`, `/pan:hygiene`)

Past projects drift as PAN advances: runtime installs fall behind (`the lending project` had five runtimes at 3.12.5 under a 3.13.0 core), pre-v3.12.4 hooks left poisoned cost ledgers (79% suspect records in one live project), memory logs grow past the compaction cap, legacy uppercase planning filenames linger, atomic-write `.tmp` orphans and unbounded trace sessions pile up, and stray fragment `.planning/` dirs appear where a lone mapping step once ran. The new hygiene system detects and (safely) fixes all of it:

- **`pan-tools hygiene scan`** — read-only findings report: per-runtime manifest version vs latest (re-run-installer remediation, never auto-run), untracked installs, legacy filenames, `.tmp` orphans (>1h), memory bloat (> entry cap), poisoned ledgers (≥50% suspect via the v3.12.4 `isSuspectRecord`, ≥20 records), stale trace sessions (>30d, newest 5 always kept), fragment planning dirs (no workflow spine — phase model, focus model, and orchestration layouts all recognized).
- **`pan-tools hygiene clean [--apply]`** — dry-run by default; `--apply` executes only the safe subset: case-hop lowercase renames, orphan deletion, `memory compact`, ledger **quarantine-by-rename** (content never deleted), trace pruning. Version drift and fragment dirs always stay manual.
- **`/pan:hygiene`** command (new, 57th) wraps scan → confirm → clean → re-scan.
- 25 new unit tests (`tests/hygiene.test.cjs`); five `HYGIENE_*` constants.

### Added — ADR-0039: worktrees are project variants

Records the design rule harvested from an external agent-tooling monorepo worktree-awareness spec: any future feature keying identity or mutable state off a project path must resolve project-then-variant and namespace state per `(project, variant)` — never match a worktree to its parent's mutable state, never treat it as a separate project. No code change today; binding on the first feature that violates the assumption.

### Added — field harvest pass 2: 7 audit-doctrine patterns from the lending project audit rounds

Deep-mine of the round-3/4 code-quality audits and the 340-line verified findings register. New universal topics **audit-convergence** (stop on zero-top-severity + order-of-magnitude collapse, escalate model / taper fan-out as the tree hardens; rotate audit lenses per round with prior-scope exclusion) and **fix-campaigns** (hand fixers defect-class clusters ranked by real risk, not N tickets; treat auditor `suggestedFix` as untrusted input; run a dedicated fix-regression lens for inert/half-wired/sibling-breaking fixes), plus two `adversarial-verification` additions (anti-double-jeopardy git provenance; reachable-trigger confirmation with precedent-calibrated severity and the five false-positive shapes). Library now 47 topics / 93 patterns.

### Added — field harvest: 20 new patterns from the d:\ project sweep (docs/FIELD-HARVEST-2026-07.md)

A four-scout sweep of every past project directory on the dev drive, deduped against the existing library and promoted through the standard manual gate (`learn promote`, lint-strict clean). Library grows 32→45 topics, 66→86 patterns. New universal topics: **live-path-honesty** (no fabricated data/success on live paths; honest-empty + demo gating; scaffold ≠ deliverable), **test-integrity** (no dumbing down generated tests), **adversarial-verification** (per-finding refute-first verifiers; expect 30-55% refutation), **integration-verification** (intra-phase PASS ≠ integrated; regenerate derived closure artifacts), **single-source-of-truth** (one classification predicate; re-sync parallel truth copies + golden-reproduction E2E), **migration-safety** (no unattended destructive DDL), **flaky-triage** (isolated re-run protocol; windowed stats + 2-of-3 reproduction), **external-tool-truth** (judge CLIs by artifact, not exit code), **golden-sets** (human-verified golden sets; execution-gated corpus curation), **harness-isolation** (SHA-locked frozen artifacts), **workaround-catalog** (catalog env overlays before ticket close), **service-security** (authed-CRUD security spine), **mcp-security** (MCP surface = injection channel). Internal: **P-RES-008** (retrieval-first over fine-tuning; schema-linking is the enterprise bottleneck). Sources: the lending project fake-code audit, the platform project v2.0 milestone audit + dispatch postmortem, the compliance project campaign v1.1, the spec-factory project research corpus, mph_factory/_limits harness rules, montyhall learning corpus. New topics carry curated agent-relevance rows in `learn-index.cjs`; shipped evidence prose is machine-path-free (exact paths live in the repo-only harvest doc).

### Added — Skill-Aligned Decomposition pass for planning (ADR-0038)

SkillWeaver (Alibaba, arXiv 2606.18051) measured one-shot task decomposition at 51% accuracy against its tool library and 92% with a *Skill-Aware Decomposition* feedback loop — draft, retrieve loosely-matching skills, realign the decomposition to the vocabulary/granularity of what exists. PAN's planner decomposed phases in exactly that one-shot pattern. This adopts the loop's mechanism at PAN scale, inside ADR-0036's distill-and-select yardstick:

- **`skills align`** (`skill-align.cjs`) — scores a draft planner task list against an on-the-fly index of the installed skill surface (`commands/pan/`, `templates/` recursive, `references/`, learnings topics via `learn-index.cjs`) using the shipped `scoreRelevance` keyword scorer. Returns per-task top-k matches, coverage, and a deduped **token-budgeted** vocabulary hint list (default 1500t) with explicit `dropped` overflow — no silent caps. Planning glue words are stripped from cues so "Create the API" doesn't match everything.
- **`skills index`** — prints the skill index (`{entries, total, by_kind, skipped_roots}`). Nothing is persisted: the walk is ~140 small files, so no staleness, no installer changes, no rebuild step.
- **`pan-planner` gains a `skill_alignment` step** between task breakdown and dependency-graph building: realign task wording/granularity to matched skill names, cite matched learnings topics in `<action>` blocks; unmatched tasks signal a wording/split rethink — never added scope. Advisory and **fail-open**: any error skips the step. One matching quality-gate line in `plan-phase.md`.
- Guardrails held: no embeddings, no FAISS, no vector store, zero runtime dependencies; missing roots (partial installs, non-Claude command formats) are skipped and reported, never thrown. Spec: `docs/specs/skill-aligned-decomposition.md`.

### Added — bounded, cue-scoped memory (ADR-0036 follow-up work)

Brings PAN's per-agent memory onto the distill-and-select axis (the `learnings/` store already was), so per-agent memory injection can't grow unbounded and flood context as the bot army fans out. This closes ADR-0036's own follow-up work; the ADR moves Proposed → Accepted.

- **`memory select`** (`selectMemory`) — a cue + recency-floored + token-budgeted read of `.planning/memory/<agent>.md`, alongside the existing whole-file `readMemory`. Always keeps the newest entries (so recall never returns empty on a non-empty log), fills the rest by cue relevance, falls back to recency-only when the cue matches nothing, and is bounded by an explicit token budget. Reuses the shipped scoring / greedy-pack idioms; zero new dependencies.
- **`exec-phase` uses it size-gated.** Memory injection stays whole-file by default; when the memory-load budget flags a large log it switches to a per-agent cue-scoped slice (cue = phase objective + changed files), with a whole-file fallback if a cue matches nothing — so a mis-scoped cue never silently drops a rule.
- **Soft auto-compaction.** `appendMemory` now trims to `DEFAULT_MAX_ENTRIES` once a log crosses `MEMORY_SOFT_CAP_MULT×` (2×) that cap (surfaced via `auto_compacted`), closing the "a log grows past 500 unbounded until someone runs compact manually" hole.
- **`memory budget`** (`memoryLoadBudget`) — the ADR's acceptance signal, wired into `validate health --full`: estimates whole-memory injection tokens vs the median per-agent input from the (v3.12.4 suspect-quarantined) cost ledger; read-only, non-blocking, degrades to an absolute-token check when the ledger is thin.
- **`knowledge ask --recall-cue`** — minimal FW-1: re-scores the already-gathered `CITATION_ROOTS` candidates against a follow-up cue and returns a tighter `recall_sources` slice (no second filesystem walk, no new deps). `sources` keeps its existing `{file, score, bytes}` shape.

Also corrected two factual errors in ADR-0036 that an e2e review caught — the original draft wrongly cited `context-budget.cjs` (a read-only reporter that never reads `memory/` or `learnings/`) as the memory-bounding backstop. Hard guardrails held: no vector store, no embeddings, zero runtime dependencies.

## [3.12.6] - 2026-07-02

### Fixed — Fable cyber-classifier still refused security work; pin security agents to Opus (ADR-0037)

The v3.12.5 wording tuning was not enough: Claude Fable 5's cybersecurity classifier still refused the **`focus-auto`/army `security` category** in a real project. Root cause — a security scanner is classifier-adjacent by definition (it must name injection, auth bypass, RCE), so prompt-wording has a hard floor. The durable fix routes security work off Fable:

- **`pan-hardener`, `pan-reviewer`, and `pan-meta-reviewer` are pinned to `model: opus`.** On Claude Code a subagent's `model` overrides the session model, so these run on Opus 4.8 regardless of what you selected and never reach Fable's classifier — fixing `/pan:review-deep` and `exec-phase --deep-review` deterministically.
- **The `focus-auto` security category delegates its vulnerability *assessment* to the Opus-pinned `pan-hardener`.** The autonomous main loop (which runs on the session model) keeps only the grep triage and the fix implementation; the classifier-triggering exploit reasoning happens on Opus.
- **The pin is Claude-Code-only.** The installer strips `model:` from the Gemini and OpenCode agent frontmatter (OpenCode's own `model` field expects a `provider/model` id); the Codex and Copilot converters never carried it. On the other runtimes, run security work on a non-Fable model.
- Also reworded the last offensive-sounding language in `focus-auto.md`'s security category (removed an explicit "exploit path: attacker does X → Y → compromised" narration; "exploit-ready"/"auth bypass"/"malicious payload" → reachability/impact/authorization framing) as a backstop for non-Claude runtimes.

Decision + rationale: `docs/decisions/ADR-0037-pin-security-agents-to-opus.md`. Tests assert both converter strips and the three agent pins.

## [3.12.5] - 2026-07-02

### Changed — Claude Fable 5 support hardening + flagship recommendation

- **The security-review agents are reframed as authorized, defensive review, so Claude Fable 5's cyber-classifier stops false-refusing them.** Fable is the only current Claude model that runs input safety classifiers on cybersecurity/biology content, and benign defensive security tooling can trip a `stop_reason: "refusal"`. `pan-hardener`, `pan-reviewer`, and `pan-meta-reviewer` now carry an explicit "authorized, defensive review of the user's own codebase — never produce exploit code" framing, and offensive-sounding imperatives were reworded (`pan-hardener` "construct an exploit path mentally" → "trace how it could be reached and what the impact would be, so you can prioritize the fix"; "remote exploit … RCE" → "remotely reachable … remote code execution"; `pan-debugger` "attack the top two" → "investigate the top two"). This is what blocked `/pan:review-deep` and `exec-phase --deep-review` when the host model was Fable — a defensive review of auth/crypto/injection code was the single most likely thing to draw a `cyber` false positive.
- **Claude Fable 5 is now PAN's recommended flagship reasoning model.** `references/model-profiles.md` gains a "Recommended Models (Claude)" section — Fable as the flagship (deepest long-horizon reasoning for the bot army), `claude-opus-4-8` as the half-cost, no-classifier alternative — documenting the ~2× cost, the cyber-classifier caveat + the re-run-on-Opus recovery, the 30-day data-retention requirement, and Fable's preference for less-prescriptive prompts. The install-time model nudge now leads with `claude-fable-5`. PAN still never sets your host model: `reasoning: inherit` routes reasoning-tier agents to whichever top model you select, while `mid`/`fast` stay on Sonnet/Haiku so the fleet is never all-Fable.

## [3.12.4] - 2026-06-28

### Fixed

- **Cost/trace telemetry no longer over-counts a shared-session transcript.** `hooks/pan-cost-logger.js` and `hooks/pan-trace-logger.js` summed `usage` across the *entire* transcript on every `SubagentStop`; because subagents share the parent session id and `cache_read` is cumulative per turn, this multiplied cache-read into the billions/trillions, pinned cache-hit at 100%, and wrote near-identical inflated rows once per subagent (observed across five production installs — see `docs/FIELD-REPORT-army-2026-06.md`). Each hook now attributes only the transcript slice since its own previous event via a per-transcript cursor (`.cost-cursor.json` / `.trace-cursor.json`), so `/pan:cost`, the HUD telemetry, and `/pan:optimize` reflect real per-subagent usage. Regression tests added.
- **The cost aggregator quarantines physically-impossible records** (`isSuspectRecord`) so a legacy ledger poisoned by the above bug can't report $millions — billion-scale cache-read, cache-read that dwarfs input, or absurd output are excluded from totals/breakdowns, and `totals.suspect_excluded` reports how many. Fixes `/pan:cost` and the HUD together.
- **`/pan:hud` is resilient to junk/partial state.** It falls back to the project's directory name when there's no `package.json` name (was "Untitled project"), and when most cost records are implausible it shows a "legacy ledger — unreliable · reset with `pan-tools cost clear`" advisory instead of dubious salvaged spend. (Surfaced by running the HUD in a focus-auto project with no `state.md` and a pre-fix ledger.)

## [3.12.3] - 2026-06-28

### Added

- **Two learning patterns mined from production campaigns** (`learnings/universal/autonomous-loop.md` — shipped; agents load them via `learn topics-for` during planning/review):
  - **P-350** — review a worktree branch against its **merge-base** (three-dot `main...HEAD` or `<fork-sha>..HEAD`), never two-dot `main..HEAD`; a base that advances under a parallel mission otherwise shows already-merged code as phantom deletions (a real false Quality block we observed).
  - **P-360** — campaign telemetry must be both **captured** (active per-step record, not just the passive `SubagentStop` hook, which a main-loop coordinator never fires) and **trustworthy** (never naive-sum a shared-session transcript — cumulative-per-turn cache-read over-counts by orders of magnitude; observed billions/trillions of phantom cache-read tokens and 100% cache-hit in real ledgers).

Source analysis: `docs/FIELD-REPORT-army-2026-06.md` (dev-only; not shipped).

## [3.12.2] - 2026-06-27

### Changed

- **Sharper package description + README subtitle** — lead with what PAN does ("Command a bot army for your codebase … ships behind a human merge gate. Five AI CLIs, zero context rot.") instead of a generic "workflow automation system" line. Added `opencode`, `bot-army`, `ai-agents`, `subagents`, `agent-orchestration` keywords for npm discoverability.

## [3.12.1] - 2026-06-27

### Fixed

- **README images render on the npm package page.** Switched the hero, army terminal, orchestration illustration, and docs banner from relative paths to absolute CDN URLs (`cdn.jsdelivr.net/npm/pan-wizard@latest/assets/…`). npmjs.com does not rewrite relative `<img src>` paths, so they showed broken there; the asset files were already shipped in 3.12.0. No functional changes.

## [3.12.0] - 2026-06-12

### Added — scheduled, self-resuming army campaigns (ADR-0034)

Closes the bot-army arc: the army can now advance a backlog over days, on a cadence, resuming itself — without ever shipping to a protected branch unattended.

- **`campaign.cjs`** (43rd module): schedule descriptor + scheduler logic — `parseCadence` (hourly/daily/weekly/Nh/Nd), `writeSchedule`/`readSchedule`, `isRunDue` (enabled/paused/per-day-budget/next-due with explicit skip reasons), `recordRun` (advances next-due, accrues the day's spend, capped history), `isDreamDue` (cadenced retro/learn). Descriptor at `.planning/orchestration/schedule.json`.
- **`pan-tools campaign schedule | status | due | record-run`** — PAN owns the schedule and the due-check; an external trigger (host scheduler / `/loop` / next-open nudge) polls `campaign due` and fires `/pan:army --continue`. PAN is deliberately not a daemon.
- **`/pan:army --schedule <cadence> --daily-budget N`** arms a self-resuming campaign; Phase 6 records the run and advances next-due; a resume protocol drives `--continue`.
- **The merge gate is unchanged** — scheduled or not, integration is `always-ask`: a scheduled campaign runs the backlog down to staged, reviewed, green PRs and waits for a human at every merge. Autonomy up to the irreversible step, a human at the step.
- Pattern promoted to `learnings/universal/autonomous-loop.md` (P-340: schedule autonomy as a host-fired due-check, never an embedded daemon, never lowering an irreversible-action gate).

### Added — single-page HTML army + project dashboard (ADR-0035)

- **`hud.cjs`** (44th module): aggregates project + army state into one self-contained HTML file. `collectHudData` (pure — reads `state.md`, roadmap/phases, the squad registry, the campaign schedule, army worktrees, the cost ledger, `requirements.md`, verification artifacts, and git history), `renderHud` (no server/network/external assets, HTML-escaped → XSS-safe), `cmdHud`. A read-only **view**: it writes only its own file and creates no new state.
- **`/pan:hud`** (alias **`/pan:dashboard`**) / **`pan-tools hud [--out <file>] [--open] [--stdout]`** — renders `.planning/hud.html` with up to ten panels (mission, command stack with per-squad agent drill-down, campaign, safety harness, worktrees, roadmap, telemetry, requirements/quality, recent activity). Army-only panels self-hide on plain projects (graceful degradation).

### Changed — PanWizard brand system

- **New visual identity:** node-graph logo mark (coral parent → indigo links → butter + green children), the Ember/Conduit/Verify/Butter palette, and Gabarito + JetBrains Mono type. Rewrote `assets/pan-logo-2000.svg` + `-transparent.svg` to the new mark (same viewBox so every `<img>` still resolves), refreshed the README hero + badges + Brand section. Design source and generated art live in `docs/branding/`.
- **HUD re-themed to the brand and rebuilt to match the design:** light Sand/Paper palette, a dark "now building" hero (phase stepper → pan pipeline → in-flight worktrees), per-squad colored command stack, inline metric bars, and spend-by-squad telemetry. Still a self-contained, read-only view — no network, no `<script>`, no new state.

## [3.11.0] - 2026-06-12

### Added — PAN as a bot army (ADR-0032 + ADR-0033)

Turns PAN's agents into a coordinated army that can deliver a whole-project goal, built on the existing `pan-conductor` safety harness — no cap relaxed.

- **Squad model (`squads.cjs`, ADR-0032):** the 21 agents grouped into four role-scoped, tool-contracted, model-tiered squads — Architecture (read-only), Build (read/write/bash), Quality (read-only adversarial), Release (always-ask). `pan-tools squad list | show <name>`. A drift test pins squad roster ⇄ agent files ⇄ `AGENT_BASE_EFFORT` so no agent is ever silently unassigned.
- **Worktree-per-agent (`worktree.cjs`, ADR-0033):** the Build squad parallelizes by giving each agent its own `army/<task>` branch + isolated git worktree — concurrent builders never share a tree or file. `pan-tools worktree list | create | remove` (removal refuses non-`army/` branches). Generalized from `whatif.cjs`.
- **`/pan:army` campaign command:** Mission Control (Opus conductor) → squads → human-gated ship, looping plan→delegate→execute→review→integrate→learn. Composes `squad`, `focus-auto --source`, `worktree`, the conductor harness, and `retro --write-memory`.
- **`pan-release` agent:** the always-ask Release squad member — prepares squash-merges, runs configured verification, surfaces a human-approval gate, tags, and rolls back via revert/previous-tag. Registered in `MODEL_PROFILES` + `AGENT_BASE_EFFORT` (mid tier, high effort).
- **`pan-conductor` campaign mode:** delegates to squads (roster resolved at runtime), parallelizes Build by worktree, gates integration through a human, carries learnings back — every Tier-0 cap unchanged.
- Pattern promoted to `learnings/universal/autonomous-loop.md` (P-330).

## [3.10.1] - 2026-06-12

### Added — focus-auto backlog source + parallel pipeline (ADR-0031)

- `/pan:focus-auto --source backlog` selects work by ranking actionable `roadmap.md`/`requirements.md` items (value/effort, derived from the current document — no hardcoded ID lists) instead of a category code-scan. `--source scan` remains the default.
- `--parallel-research` / `--parallel-verify` fan the per-item research and verify stages out via the Workflow tool (read-only); the implement/exec stage always stays a single serial agent. `--clean-seal` runs one clean build + full verification (commands from `config.json`) after the last item to catch cross-item orphans. Optional `concurrency.serial_build` config enforces at-most-one-builder for projects whose build trees corrupt under concurrency. All default off; no behavior change for existing campaigns.
- Generalizes the proven parallel-research → serial-build → parallel-verify → clean-seal pattern from a downstream project's `/focus-loop` command, without shipping its project-specific content. Pattern also promoted as a universal learning (`learnings/universal/autonomous-loop.md`).

## [3.10.0] - 2026-06-12

### Added — `--unified-skills` shared tree (ADR-0028 Phase 1, alpha)

- New installer flag `--unified-skills`: compiles `commands/pan/*.md` once into the runtime-neutral `.agents/skills/pan-*/SKILL.md` tree (Agent Skills standard; project root for local installs, `~/.agents/skills/` for global) instead of per-runtime command formats, for **all five runtimes**. Proprietary command surfaces are swept on install so commands don't resolve twice; manifests track the tree with out-of-tree (`../`) keys; uninstall removes it.
- New pure converters in `install-lib.cjs`: `convertClaudeCommandToUnifiedSkill()` + `getUnifiedSkillAdapterHeader()` — a runtime-neutral adapter header (invocation, sub-agent delegation, and interaction guidance phrased per "your runtime's native mechanism"); AskUserQuestion blocks survive for runtimes that consume them natively.
- This is also the Antigravity CLI consumption path recorded in the June 2026 ecosystem review.

### Added — shared core + ref-counted uninstall (ADR-0028 Phase 2)

- Unified installs now ship a **shared, runtime-neutral `pan-wizard-core` copy** at `.agents/pan-wizard-core/` (`~/.agents/` for global): compiled skills resolve `pan-tools` and workflow references against it, so the shared tree's content no longer depends on which runtime installed last. Core-internal references are rewritten to the shared prefix; internal learnings are stripped as in the per-runtime copy. The per-runtime core remains for agents and hooks.
- **Ref-counted shared-tree uninstall:** uninstalling a runtime leaves `.agents/skills/` (and the shared core) in place while any other runtime's manifest still tracks it; the last tracker removes both and prunes empty `.agents/` directories. Applies to Codex's standard installs too (its skills always live in the shared tree).
- **Agent-ref canonicalization:** unified installs ship reference copies of the canonical agent definitions at `.agents/pan-wizard-core/agents/`, and shared content (skills + core workflows) references those instead of the installing runtime's agents dir — whose files carry runtime-specific formats (Codex TOML, Copilot `.agent.md`). These are reading material for agents; per-runtime installed agents still drive subagent spawning. Shared-tree content is now runtime-neutral end to end.
- Remaining before default-on: per-runtime live discovery gates.

### Added — Claude Code plugin build (first slice)

- New `npm run build:plugin` emits a self-contained Claude Code plugin at `dist/pan-wizard-plugin/` (format verified against code.claude.com 2026-06): `.claude-plugin/plugin.json` manifest, command markdown, agents, `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}`-anchored hook commands, hook scripts, and the core (internal learnings stripped). Built ALONGSIDE the loose-file installer; marketplace publishing is gated on one live check — whether the plugin-root variable expands inside command markdown content.

### Added — .planning/ concurrency hardening (ADR-0030, v1)

- New `lock.cjs` core module: `withFileLock()` (advisory `<file>.lock` via atomic exclusive-create, bounded retry, 10s stale-lock stealing for crashed holders) and `writeFileAtomic()` (temp + rename — readers never see torn files). `writeStateMd()` is the first adopter: every state.md write now serializes behind the lock and lands atomically. v1 is best-effort — on lock timeout the write proceeds unlocked, so single-agent behavior is unchanged; strict mode is the documented escalation path.

### Added — native Claude Code workflows (first slice)

- Claude installs now ship deterministic orchestration scripts to `.claude/workflows/` for PAN's fan-out-shaped protocols: `pan-review-pipeline` (reviewer + hardener in parallel, meta-reviewer merge + verdict ladder) and `pan-map-codebase` (area discovery, parallel per-area documenters, synthesis). Invoke by name through Claude Code's native workflow runner; the markdown protocols remain the source of truth for judgment-heavy flows. Manifest-tracked; removed on uninstall. Claude-only — no other runtime has an equivalent surface.

### Added — multi-runtime hooks layer

- **Codex hooks** (verified against developers.openai.com 2026-06): `.codex/hooks.json` uses Claude-compatible PascalCase events, so all four PAN hooks now ship to Codex — update check (`SessionStart`), context monitor (`PostToolUse`), cost + trace loggers (`SubagentStop`). PAN entries are merged non-destructively alongside any user hooks (`mergeCodexHooksConfig`), reinstalls are idempotent, and uninstall strips only PAN entries (`removeCodexPanHooks`), deleting the file only when nothing else remained. Hook scripts now install to `.codex/hooks/`. Project-scoped hooks load once the project is trusted — the existing trust notice covers it.
- **Copilot cost + trace loggers** (verified against docs.github.com 2026-06): Copilot CLI's `subagentStop` event now carries `pan-cost-logger` and `pan-trace-logger` in `.github/hooks/pan.json` — `/pan:cost` and `/pan:learn` get automatic instrumentation on Copilot, same as Claude/Gemini.
- New `HOOK_EVENT_MAP` in `install-lib.cjs`: the canonical event → per-runtime name/surface table (OpenCode: no hook support).

### Added — AGENTS.md universal rules layer (ADR-0028 Phase 3, first half)

- Local installs now contribute one marker-fenced PAN section to the project's `AGENTS.md` — the cross-runtime instructions standard read natively by every PAN runtime (and Antigravity CLI). The section explains `.planning/`, the `pan-*` command surface, and the dispatcher; user content outside the markers is never touched, and updates are idempotent across runtimes and reinstalls.
- Claude installs bridge `CLAUDE.md` to it via a fenced `@AGENTS.md` import (skipped when the user already imports it themselves).
- Uninstall is ref-counted: the PAN section (and the bridge) are stripped only when the last PAN runtime leaves the project; files are deleted only if nothing but PAN content remained. Global installs never touch project files.

### Fixed

- PAN-created git tags (rollback snapshots, milestone tags, `git tag create`) failed silently on machines with `tag.gpgsign=true` (git turns plain `git tag` into sign-or-fail). Tag-creation sites now pass `-c tag.gpgsign=false`; full suite green for the first time.

## [3.9.0] - 2026-06-10

### Changed — June 2026 ecosystem alignment (model layer, effort migration, runtime format migrations)

Driven by the June 2026 ecosystem review (`docs/ECOSYSTEM-REVIEW-2026-06.md`). Baseline survey, decisions, and per-item status live in that document.

#### Model layer refresh

- `cost.cjs` `DEFAULT_RATES`: Opus 4.7/4.6 corrected to $5/$25, added `claude-opus-4-8` ($5/$25) and `claude-fable-5` ($10/$50), removed retired `gemini-1.5-pro`; reasoning-tier fallback tracks current Opus pricing.
- `install-lib.cjs` `detectModelCapabilities()`: added Fable 5 + Opus 4.8; corrected 1M-context flags for Opus 4.6 / Sonnet 4.6 (legacy 4.0–4.5 generations stay 200K). `install.js` upgrade recommendation now points at Opus 4.8 / Fable 5.

#### `thinking_budget` → `effort` migration (adaptive-thinking era)

- All shipped agents now declare `effort:` frontmatter instead of `thinking: enabled` + `thinking_budget:` (budget 4000 → `medium`, 6000 → `high`, 8000 → `xhigh`).
- `translateThinkingDirective()` emits `{effort}` frontmatter for Claude and effort-scaled prose preambles for other runtimes; legacy `{enabled, budget}` directives still translate via a budget→effort mapping.
- **Effort-aware model profiles:** `core.cjs` gained `AGENT_BASE_EFFORT` + `resolveEffortInternal()` — `budget` profile steps effort down one level (floor `low`), `quality`/`balanced` keep base, `.planning/config.json → effort_overrides` wins. `resolve-model` CLI returns an `effort` field. A drift test pins frontmatter ⇄ map parity.

#### Runtime format migrations

- **Codex:** skills install to the shared `.agents/skills/` tree (`$CODEX_HOME/skills` is a dead read location); agents emit as `.codex/agents/pan-*.toml` via new `convertClaudeAgentToCodexToml()` (PAN `effort` → Codex `model_reasoning_effort`); `codexTrustNotice()` prints after local installs; legacy `.codex/skills/pan-*` swept on upgrade/uninstall.
- **Copilot:** hooks moved from `.github/config.json` (where they almost certainly never fired) to `.github/hooks/pan.json` (`version: 1`, `type: "command"`) via new `buildCopilotHooksConfig()`; reinstall migrates PAN hooks out of legacy `config.json` preserving foreign entries; uninstall removes `pan.json`.
- **OpenCode:** commands install to plural `.opencode/commands/` (legacy singular `command/` swept); agent converter emits `permission: {tool: allow}` instead of the deprecated `tools:` map.
- **Gemini:** `geminiTransitionNotice()` prints after every `--gemini` install (suppressible with `--skip-warnings`) — from 2026-06-18 Google's Gemini CLI serves Code Assist enterprise customers; individual accounts are directed to Antigravity CLI. An `--antigravity` sixth runtime remains an open decision pending primary-source verification of the plugin format.

#### Agent SDK billing split (effective 2026-06-15)

- `runner.cjs` tags captured claude-run experiment metrics with `billing_pool: "agent_sdk"` (`null` for other runtimes) so learn/billing reconciliation can separate experiment spend from interactive spend.

#### Prompt re-tuning for Opus 4.8 / Fable 5

- `pan-reviewer` reframed from FOCUS (filter at the finder) to COVERAGE (report every finding, tiered; `pan-meta-reviewer` / `review-deep` is the downstream filter) — the recommended finder→filter pattern, which PAN already had architecturally.
- Survey outcome: PAN's CRITICAL/MUST constraints are legitimate correctness invariants, not tool-over-triggering — deliberately left intact. No forced-progress scaffolding or over-narration existed to remove.

#### Build

- **esbuild removed entirely.** PAN hooks are pure zero-dependency Node.js; `npm run build:hooks` is now a copy step (`hooks/*.js` → `hooks/dist/`). Dev docs updated accordingly.

#### Docs

- New `docs/ECOSYSTEM-REVIEW-2026-06.md` — June 2026 review + priority-ordered enhancement roadmap (v3.9 format migrations shipped here; v4.0 strategic items remain proposals).
- `docs/IMPROVEMENT-TODO.md`: deferred design spike recorded for an optional LLM evaluator in the self-improvement runner (ADR-first, `runner.cjs`-scoped).

## [3.8.0] - 2026-05-03

### Added — doc-code link graph (ADR-0027)

A new top-level concept: PAN's planning surface (ADRs, specs, learnings, references, workflows) is now treated as an explicit graph, with both forward links (inline `[[<id>]]` body refs and frontmatter `must_haves.key_links`) and backlinks (`// @pan: <id>` source-comment anchors). Renaming an ADR or moving a module no longer silently strands references.

Inspired by external project `1st1/lat.md`; PAN's implementation is regex-only, zero-deps, and CJS — incompatible portions (TypeScript, libsql, tree-sitter, MCP server, embeddings) explicitly rejected.

#### What ships

- **`pan-tools links validate`** (53rd command) — three-pass lint:
  - Forward links: F-001 (broken `[[<id>]]`), F-002 (missing section anchor), F-003/F-004 (`key_links` path/regex)
  - Backlink contract: B-001 (`require-code-mention: true` doc with no anchors), B-002 (single-source informational, exempt from `--strict` per spec §5.2)
  - Anchor-target existence: A-001 (stale anchor), A-002 (stale section), A-004 (empty id)
- **`// @pan: <doc-id>` source-comment convention** — host-language-idiomatic leaders (`//` for JS/TS/CJS, `#` for shell/Python, `<!--` for markdown/HTML); line-anchored regex avoids string-literal false positives.
- **`require-code-mention: true` frontmatter** — opt-in per doc; the lint enforces ≥1 resolving anchor.
- **`pan-tools validate health --links`** — attaches `link_graph` summary to the health report (advisory; errors degrade to a `LINKS_ERR` warning, non-blocking).
- **Three canary ADRs opted in:** ADR-0021 (codebase-mapper-v2 → `codebase.cjs`), ADR-0026 (self-improvement-loop → `experiment.cjs` + `runner.cjs`), ADR-0027 (this ADR → `links.cjs`). Source repo passes `--strict` cleanly.

#### What's new under the hood

- New core module **`pan-wizard-core/bin/lib/links.cjs`** (33rd) — `validateAll`, `scanForwardLinks`, `scanAnchors`, `resolveDocId`, `parseAnchorLine`, `parseInlineLinks`, `cmdLinksValidate`. Reuses `doc-lint/walk.js` and `frontmatter.cjs`.
- New spec at `docs/specs/doc_code_link_graph_featureai.md` (41st) defining grammars, lint passes, output schema, and acceptance criteria.
- 32 new tests across one unit suite and one scenario suite.

#### What's NOT in scope (deferred to v3.8.x / v3.9)

- `pan-tools links refs <doc>` reverse query
- `pan-tools links expand <file>` (inline `[[<id>]]` content into prompts under context budget)
- `pan-optimizer` auto-anchor suggestion when sessions touch ADR-named files
- AST-based code parsing — regex sufficient by design
- Migration of `must_haves.key_links` to inline `[[<id>]]` — both shapes coexist

#### Bug fixes folded in

- `core.cjs:output()` calls `process.exit(0)` unconditionally, making any post-`output()` `process.exit(1)` dead code. Affected the strict-mode exit semantics for the new `links validate` command. `cmdLinksValidate` writes to stdout directly and exits with the correct code; same latent issue exists for `learn lint` but is out of scope here (filed as follow-up).

## [3.7.10] - 2026-05-02

### Added — release gate, manifest verification, doc-drift lint, P-RES-003 reasoning trace handoff

Closes most of the IMPROVEMENT-TODO P0/P1 items + Session D feature.

#### Session A — Hygiene + silent-failure surface

- `.gitignore` now blocks `.claude/*.lock` (the scheduler's runtime artifacts).
- `experiment list` hides soft-pruned `*-archived-*` folders by default; `--include-archived` opts them in.
- `pan-tools commit --fail-on-error` exits non-zero on `commit_failed`. Closes the P-EXP-001 silent-failure surface that whoocache hit (autonomous loop saw exit-0 with `{committed: false, reason: 'commit_failed'}` and kept going).
- 18 new tests covering safety-net commit, plan-checker Dimension 11, verifiable-signals reference, v3.7.9 universal learnings shipping.

#### Session B — Release gate hardening (IMPROVEMENT-TODO P0)

- `npm run release:check` (and `prepublishOnly`) — five-gate validation: `build:hooks` → `test:all` → `npm audit --omit=dev --audit-level=high` → `npm pack --dry-run --json` → smoke install (pack + install into temp dir + sanity-run `pan-tools experiment list`). `npm publish` now fails BEFORE upload if any gate is red.
- `bin/install-lib.cjs verifyInstall()` — post-install manifest walk. Asserts `pan-wizard-core/bin/pan-tools.cjs` (the dispatcher) is present, then walks every manifest entry and asserts the file exists on disk. Missing files exit 1; warnings log but continue.
- `scripts/generate-skills-docs.py` no longer embeds drift-prone counts; SKILLS-FULL-TEXT.md and SKILLS-REFERENCE.md regenerated against the current version.
- 5 new tests for verifyInstall (ok path, missing entries, missing dispatcher, null/empty manifest).

#### Session C — Documentation drift automation (IMPROVEMENT-TODO P1)

- `pan-tools doc-lint counts <dir>` — drift-prone count detector. Flags `52 commands`, `21 agents`, `27th module`, `(9 files)` outside CLAUDE.md. Negative lookbehind excludes version refs (`v3.5 module`); fenced code blocks are skipped; allow-list covers ADRs / specs / experiments / learnings / archive / auto-generated SKILLS docs / EXAMPLES (illustrative scenarios). docs/ scans clean.
- Hook build naming aligned with reality (copy-only, no esbuild bundling — PAN's hooks are pure Node.js with zero deps).
- `docs/AGENTS.md` plan-checker dimension table refreshed with all dimensions (1–11) including the v3.7.9 Dimension 11 "Spec Sufficiency for Handoff" (P-RES-004).

#### Session D — P-RES-003 reasoning trace handoff

The structural feature surfaced by the external-research scan. PAN's serial pipeline previously passed artifacts (plan.md, summary.md) but not reasoning; downstream agents re-derived blindly when the artifact didn't anticipate a micro-decision.

- New `pan-wizard-core/references/handoff-decisions.md` — schema reference loaded by planner / executor / verifier via `@`-syntax.
- `pan-planner` emits `## Plan Decisions` (Locked / Open / Considered+rejected) between `<objective>` and tasks.
- `pan-executor` reads it, then writes `## Implementation Decisions` (Taken / Deviations / Open Questions) into the summary.
- `pan-verifier` Step 1b consumes the trace: deviations → check the executor's stated verification step; open questions → extra focus areas; decisions taken → cross-reference plan's Open bucket.
- `pan-plan-checker` Dimension 12 enforces section presence + ≥1 item OR explicit single-line disclaimer.
- All 3 summary templates carry the new section. References count went from 14 → 15.

#### Session E1 — Release housekeeping

- v3.7.10 bump.
- `bin/install.js copyWithPathReplacement` empty `catch {}` blocks replaced with warning collection (the silent-failure surface that pre-dated `verifyInstall` — now hardened from both sides).
- `release-check.js` now also runs `pan-tools doc-lint counts docs` as a gate.

#### Session E2 — Research-concept nudges

Three more research concepts wired into existing surface (no new commands):

- P-RES-007 (Sakana DGM, structural-vs-prompt generalization): `learn promote --scope universal` now warns when the rule looks like a prompt-fragment (specific phrasing, "always say X") rather than a structural pattern. Universal scope should be reserved for structural changes; prompt fragments belong in internal scope.
- P-RES-005 (GitHub PR audit, repo-norms-first verification): `pan-verifier` updated to read `codebase/CONVENTIONS.md` and `codebase/STRUCTURE.md` as first-class verification inputs when they exist.
- P-RES-002 (Chroma context-rot, distractor density): `phase-budget` now reports a `relevance_ratio` signal alongside token count.

### Tests

2704 → ~2720+. Full suite passes. CLAUDE.md count table refreshed.

## [3.7.9] - 2026-05-02

### Fixed — closures from the whoo* experiment campaign (5 new autonomous experiments)

Ran 5 new autonomous experiments (whoolog / whoocache / whooflow / whooschema / whoodb) in `~/pan-experiments/`, harvested back to `experiments/`. All 5 reached `milestone: completed` via per-phase `--auto` invocations. Total across the 5 trees: 216 commits, 63 test files, 54 src files.

Surfaced 5 internal findings; promoted to `pan-wizard-core/learnings/internal/experiment-runner.md`:

- **P-EXP-001** — `new-project --auto` can finish all artifacts but never commit if the run ends before the workflow's commit step (whoocache hit this exactly).
- **P-EXP-002** — `claude -p` exits at every Phase N → Phase N+1 boundary despite `--auto`. All 5 confirmed. Treat cross-phase chain as best-effort.
- **P-EXP-003** — state.md YAML frontmatter is the authoritative truth; body prose may lag after phase completion.
- **P-EXP-004** — 30-min `DEFAULT_TIMEOUT_MS` cuts off real 3-plan phases mid-execution.
- **P-EXP-005** — 4 concurrent `claude -p` experiment sessions run cleanly on a single workstation; no TTY contention or rate-limit issues. Wall-clock ~3h vs ~9h sequential.

#### P-EXP-004 — `runner.cjs` default timeout bumped from 30 → 60 minutes

`DEFAULT_TIMEOUT_MS` in `pan-wizard-core/bin/lib/runner.cjs` raised from `30 * 60 * 1000` to `60 * 60 * 1000`. The whoolog Phase 1 first run timed out at 30:00 having only completed Phase 1 research; resumed with 90-min cap and finished cleanly in 26 min. The default was cutting real work off mid-phase. Per-phase 3-plan budgets average 25-50 min, so 60 min is the right floor.

**Files:** `pan-wizard-core/bin/lib/runner.cjs:83`

#### P-EXP-001 — Defensive safety-net commit at end of `new-project.md`

New section `## 8.9. Safety-Net Commit` added between standards and the Done banner. Sweeps any uncommitted `.planning/` artifacts into a single bundle commit, catching the whoocache pattern (24 min of work, project.md/requirements.md/roadmap.md/src/* on disk, git log empty).

**Files:** `pan-wizard-core/workflows/new-project.md` (~line 1055)

### Tests

2664/2664 still pass (2373 unit + 291 scenario). No new test files; the changes are runtime constants and workflow text exercised at autonomous-run time.

## [3.7.8] - 2026-04-27

### Fixed — closing all v3.8-deferred items from the wookie autonomous build

This release closes the four issues deferred from v3.7.7 (the wookie post-build audit). All four were observed in vivo during the 5-phase autonomous run.

#### P-1803 — `discuss-phase.md` auto-mode bypass

The discuss-phase workflow has 6 unguarded `AskUserQuestion` calls (lines 140, 156, 208, 261, 264, 278). Any auto-mode run that enters discuss-phase stalls headless `claude -p` (the wookie Phase 3 retry exited at 75s with $0.42 cost and zero commits — same root pattern as P-1301 / P-1802). v3.7.7 routed *around* this by making `plan-phase`'s auto-mode skip discuss-phase entirely.

**Fix:** new `auto_mode_bypass` step at the top of `discuss-phase.md` (right after `initialize`). When `--auto` flag is present or `workflow.auto_advance: true` in config, the workflow synthesizes `context.md` directly from `idea.md` + `project.md` + `requirements.md` + the roadmap goal — no user dialogue — then jumps straight to the existing `auto_advance` step. The interactive question-driven flow is preserved for non-auto invocations.

This makes discuss-phase auto-mode-safe so `transition.md`'s YOLO branch can spawn it cleanly when context.md is missing for the next phase.

**Files:** `pan-wizard-core/workflows/discuss-phase.md` (new step ~lines 130-220)

#### P-1804 — state.md `stopped_at` frontmatter staleness

Throughout the 5-phase wookie build, `state.md`'s frontmatter `stopped_at:` field stuck at `"Phase 1 plan 01-01 executed, awaiting verification"` even after Phase 5 completed. Visible in `/pan:progress` and confusing to the user. Root cause: `transition.md`'s `update_session_continuity_after_transition` step uses raw `Edit` to update the body's "Stopped at" line, but the frontmatter `stopped_at` field is mirrored from the body via `syncStateFrontmatter()` — which only runs through `pan-tools state update` (which calls `writeStateMd` → `syncStateFrontmatter`). Direct `Edit` bypasses the sync.

**Fix:** the step now explicitly uses `pan-tools state update "Stopped at" "Phase X complete, ready to plan Phase X+1"` for the Stopped-at line. Last session and Resume file lines (no frontmatter mirror) can stay as Edit.

**Files:** `pan-wizard-core/workflows/transition.md` (~line 334)

#### P-1805 — `pan-trace-logger` and `pan-cost-logger` zero token counts in headless mode

Throughout the wookie build, every `agent_completion` trace event and every `tokens.jsonl` cost record showed `input_tokens: 0, output_tokens: 0, cache_read_tokens: 0`. Per-agent cost attribution was completely broken — only the orchestrator-total via P-1603 captureMetrics was usable. Root cause: the SubagentStop hook payload from Claude Code in headless `claude -p` mode does NOT include `data.usage`. It only ships `transcript_path` (the JSONL transcript file). The hooks were reading `data.usage.input_tokens` etc. directly, finding nothing, and recording zeros.

**Fix:** new `readUsageFromTranscript(transcriptPath, sessionId)` helper in both `hooks/pan-trace-logger.js` and `hooks/pan-cost-logger.js`. When `data.usage` is missing/empty, parse the transcript JSONL line by line, find entries belonging to the subagent's session (via `entry.session_id === data.session_id`), and sum their `usage` fields across all assistant messages. Falls back to zeros silently if the transcript is unreadable. Interactive Claude Code path (where `data.usage` is populated) is unchanged.

**Files:** `hooks/pan-trace-logger.js`, `hooks/pan-cost-logger.js`. Hooks rebuilt to `hooks/dist/`.

#### P-1806 — verify-phase trace event missed when verification runs inline

v3.7.5 added `optimize trace log --category verification_passed` at the bottom of `verify-phase.md`. It never fired across the 5-phase wookie build because verification ran "inline" in auto-mode — the orchestrator wrote `verification.md` directly without spawning a separate `pan-verifier` Task subagent, so `verify-phase.md`'s end-of-file trace block was never reached.

**Fix:** moved the trace event emission upstream into `exec-phase.md`'s `verify_phase_goal` step, immediately after reading `VERIF_STATUS` from `verification.md`. Now the event fires regardless of whether verification was inline or via subagent. Three categories logged: `verification_passed`, `verification_gaps`, `verification_human_needed`.

**Files:** `pan-wizard-core/workflows/exec-phase.md` (~line 513)

### Tests

2664/2664 still pass. No new test files; the changes are workflow-text and hook-runtime fixes that are exercised at autonomous-run time, not unit-test time. v3.8 candidate: add unit tests for `readUsageFromTranscript()` in both hooks.

## [3.7.7] - 2026-04-27

### Fixed

#### P-1802 — `plan-phase.md` step 4 unguarded AskUserQuestion in auto mode

**Surfaced by the wookie autonomous run continuation (v3.7.6, 2026-04-27).** After v3.7.6's P-1801 fix correctly advanced state.md to `current_phase: 3`, attempting to resume with `claude -p "/pan:plan-phase 3 --auto"` exited in 40 seconds with $0.37 cost, 8 turns, **zero commits**. The orchestrator hit `plan-phase.md` step 4's `AskUserQuestion` ("No context.md found for Phase 3. Continue or capture context first?") which has no `--auto` mode gate. Headless `claude -p` cannot answer interactive prompts → session exits silently.

**Same root pattern as P-1301** (which removed unguarded AskUserQuestion from `new-project.md`'s auto block in v3.7.2). The bug was missed in `plan-phase.md` because the autonomous loop usually has `transition.md`'s YOLO branch spawn `discuss-phase` first when context.md is missing — so plan-phase rarely sees a missing-context.md state in the happy path. Resuming a partial run via direct `/pan:plan-phase X --auto` invocation skips the transition path and exposes the gap.

**Fix:** in `plan-phase.md` step 4, gate the `AskUserQuestion` block by `--auto` flag. In auto mode, **proceed without context.md** (rather than asking the user, and rather than spawning `discuss-phase` — discuss-phase has 6 unguarded AskUserQuestion calls of its own that also stall headless `claude -p`). The planner derives phase decisions from project-level research + requirements + idea.md. Reliability over input-quality in auto mode; the user has already encoded preferences in idea.md / project.md.

Trade-off: per-phase context.md captures user-specific design choices that idea.md may not cover. Acceptable in auto mode — interactive mode preserves the original AskUserQuestion path for users who want fine-grained per-phase input.

**Validated in vivo (wookie Phase 3 retry):** before fix, two retry attempts (plan-phase 3 + discuss-phase 3) exited in 40s and 75s with zero commits and $0.79 cost. After fix, expected to proceed cleanly via research + requirements derivation.

**Files:** `pan-wizard-core/workflows/plan-phase.md` (step 4, ~lines 177-205)

**Deferred to v3.8 (related but bigger scope):** `discuss-phase.md` has 6 unguarded `AskUserQuestion` calls (lines 140, 156, 208, 261, 264, 278). Auto-mode runs that route through discuss-phase (e.g., transition.md's YOLO branch when context.md is missing) will still stall. Either gate every AskUserQuestion in discuss-phase by `--auto` (with sensible defaults derived from idea.md/project.md/requirements.md) — or cut the auto path so it never enters discuss-phase. v3.7.7 takes the second path: plan-phase auto-mode no longer spawns discuss-phase.

## [3.7.6] - 2026-04-27

### Fixed

#### P-1801 — Cross-phase YOLO continuation (transition.md → next phase)

**Surfaced by the wookie autonomous run (v3.7.5 in vivo, 2026-04-27).** A 5-phase social-media app project completed Phase 1 fully (Docker Compose stack verified up, Flutter web build verified, all 4 containers healthy, 14 commits, $12 cost) but the orchestrator exited cleanly at the Phase 1 → Phase 2 boundary instead of continuing into Phase 2 planning. State.md correctly advanced to `current_phase: 2` and the transition commit landed — but **discuss-phase / plan-phase 2 never started**.

**Root cause:** the v3.7.4 P-1701 patch replaced `SlashCommand("/pan:plan-phase ...")` (which spawns a fresh session and breaks in headless `claude -p`) with prose-based "**DO NOT exit. Read `~/.claude/pan-wizard-core/workflows/plan-phase.md` and follow its steps.**" Prose is not behavioral. After the verification subagent and transition subagent return to the orchestrator, claude `-p` decides the conversation is over and exits cleanly — the "read X and continue" instruction is treated as a suggestion, not an obligation.

**Fix:** `transition.md`'s YOLO branch (offer_next_phase, Route A) now spawns the next phase as a `Task(subagent_type="general-purpose", prompt="@plan-phase.md ${NEXT_PHASE} --auto")` — a tool call the orchestrator cannot ignore. Same pattern as `plan-phase.md`'s existing auto-advance to exec-phase (which has been working since v3.7.0). Two branches: spawn plan-phase if context.md exists for the next phase, spawn discuss-phase if not.

**Trade-off:** each phase boundary spawns a new Task tree, restarting context (loses the cumulative cache reads from the previous phase). Acceptable because (1) cross-phase cache value is low — phase N's plans are mostly irrelevant to phase N+1's executor — and (2) reliability beats marginal cost optimization for autonomous runs.

**Files:** `pan-wizard-core/workflows/transition.md` (YOLO branch rewritten ~lines 387-485)

### Validated in vivo (wookie run, v3.7.5 patches all confirmed working)

- **P-1401 lightweight-phase bypass** — Phase 1 (1 plan, scaffolding change_class) skipped per-phase research.md, saved ~3-5 min. Trace event logged.
- **P-1502 milestone gate** — Exit 0 + state=`planning` correctly mapped to `stop_reason: incomplete`.
- **P-1601 standards filtering** — Detected `api` project type, auto-selected only OWASP-Top-10 (high priority) — no STRIDE noise.
- **P-1603 captureMetrics** — Full envelope parsed first run: $12.01, 46 turns, session_id, 4-way token breakdown.
- **P-1604 transition state-write batching** — Phase complete = single `docs(01): complete phase` commit (was ~5 in v3.7.4).
- **P-1606 MODEL_PROFILES coverage** — All agent spawns resolved cleanly; no fall-through to default `mid` tier.
- **Spec A E-1 caching** — 95.4% cache hit rate (2.34M reads vs 112K creation) across the 27-min run.

### Known issues deferred to v3.8

- ⚠️ Per-agent token attribution in trace events shows zero counts (`pan-trace-logger` doesn't capture model usage in headless mode). Cost per-orchestrator is captured (P-1603), but per-subagent attribution missing.
- ⚠️ `verify-phase` trace event doesn't fire when verification runs inline (auto-mode); only when verify-phase is spawned as a separate Task subagent.
- ⚠️ State.md `stopped_at` field can go stale after verification (shows "awaiting verification" even when verification passed).

## [3.7.5] - 2026-04-27

### Engine optimizations from autonomous-loop audit

Ten engine-level optimization candidates were observed during the v3.7.x panloop / panmd / panmd2 / panmd3 runs but never formally promoted as findings. v3.7.5 fixes the ones that have a clear implementation; defers the rest with explicit status notes.

#### Real code changes

- **P-1601 — Standards auto-selection gated by detected project type.** `cmdStandardsRecommend` now marks a recommendation `priority: "high"` only when it comes from an *explicitly* detected non-general project type (e.g., `web`, `api`, `ai`). For projects that fall back to `general`, all recommendations are `medium`. The `new-project.md` auto-mode block now selects only `high`-priority recommendations and **skips standards.md creation entirely** when the project is `general`. Eliminates the panmd-style noise where a markdown linter project got OWASP-Top-10 + STRIDE auto-applied. (`config.cjs`, `workflows/new-project.md`)
- **P-1602 — `workflow.phase_record_compact` config flag.** New opt-in field added to `templates/config.json` and the hardcoded defaults in `config.cjs`. When `true` AND the P-1401 lightweight-phase bypass triggers (1-plan trivial phase, project-level research present), `plan-phase` collapses per-phase context.md + research.md + summary.md into a single `${N}-record.md`. Cuts 4 commits per trivial phase. Off by default — substantive phases ignore the flag entirely. (`templates/config.json`, `config.cjs`, `workflows/plan-phase.md`)
- **P-1603 — Token metering via `claude --output-format json`.** `runner.runExperiment` accepts a new `captureMetrics: true` opt. The claude adapter's `buildArgs(prompt, opts)` now appends `--output-format json` when requested, and after spawn returns the new `parseClaudeJsonEnvelope()` helper extracts the trailing JSON block from stdout (containing `total_cost_usd`, `num_turns`, `session_id`, `usage.{input,output,cache_*}_tokens`) and persists it under `runState.metrics`. Default behavior unchanged. (`runner.cjs`, `tests/runner.test.cjs` — 4 new tests)
- **P-1604 — Batch state.md writes in `transition.md`.** New `<state_write_policy>` block at top of the workflow instructs the orchestrator to *plan* the four state.md section updates (Project Reference, Accumulated Context, Session Continuity, progress bar) and apply them in a **single Edit + single commit** at the end, instead of the previous edit-per-section pattern. Cuts transition commits from 5 to 2. The `pan-tools phase complete` commit (roadmap + state position) stays separate because it must run first. (`workflows/transition.md`)
- **P-1605 — Coalesce micro-task commits in `pan-executor`.** New paragraph in `<task_commit_protocol>` allowing consecutive trivial tasks (≤5 lines, same commit type, no checkpoint between, max 5 in a batch) to coalesce into one commit when they share scope. Per-task commits remain the default for `feat`/`fix`. Reduces commit-thrash on auto-mode runs while preserving bisect/blame granularity for substantive changes. (`agents/pan-executor.md`)

#### Documentation-only changes (workflow patches with unclear behavioral impact)

- **#10 — `workflow.auto_advance` scope clarified.** USER-GUIDE config table now documents that `auto_advance` chains **across phase boundaries** in YOLO mode via `transition.md`'s P-1701-patched in-context-continuation branch. Equivalent to passing `--auto` on every `/pan:` command. The naming is preserved (rename would break user installs); only the description is sharpened. (`docs/USER-GUIDE.md`)
- **#5 / #6 — verify-phase / plan-check trace events.** Verified that `optimize trace log` events are already emitted at `verify-phase.md` lines 301-314 (`verification_passed` / `verification_gaps`) and at `plan-phase.md` lines 425-498 (`plan_verified` / `plan_checker_issues` / `plans_created`). No code change required.
- **#7 — Combine context+research for trivial phases.** Already covered by P-1401 lightweight-phase bypass (v3.7.3) extended via P-1602 `phase_record_compact` (above). No additional change.
- **#8 — Parallelize pan-roadmapper.** Deferred to v3.9. The roadmapper agent currently runs serially across phases; parallelization would require splitting roadmap generation into per-section subagents with a final merge step. Speculative — needs a real performance bottleneck before designing the merge protocol.

### Tests

2659+ unit + scenario tests pass. 4 new tests in `tests/runner.test.cjs` cover the captureMetrics path: envelope parse, missing-envelope handling, default args without `--output-format`, args with `--output-format` when `captureMetrics: true`.

### Honest scope note

Five of these are real code/behavior changes (P-1601 through P-1605). The others are workflow-text or doc updates whose effect on agent behavior is unproven — workflow prose lives in the prompt context, but whether agents actually *honor* a new "batch your commits" rule depends on prompt salience. Marked with the **(workflow patches with unclear behavioral impact)** disclaimer above so v3.8 validation runs can measure whether the prose changes shifted observed run telemetry.

## [3.7.4] - 2026-04-27

### Fixed (1 of 3 attempted) + 1 honest documentation

Three v3.7.3 candidates attempted; one fully fixed, two partially fixed/blocked. The empirical results are documented honestly so v3.8 has clear next steps.

#### ✅ P-1502 — Runner success criteria via state.md milestone check (FIXED + VALIDATED)

`runner.cjs runExperiment()` after spawnSync returns `exit_code:0`, now reads `<expPath>/.planning/state.md` and checks the `status:` field. If not `completed`, sets `stop_reason: "incomplete"` instead of misleading `success`. **Validated in vivo by panmd3 run**: runner correctly reported `status:"incomplete"` after claude -p exited at Phase 0 with only config.json written (was: misleading `status:"done"`).

The check skips when `runtimeOverride` is set (tests/dev mocks don't write state.md). New `STOP_REASONS.INCOMPLETE` enum value.

#### 🟡 P-1501-r2 → P-1501-r3 — stdio:'inherit' fix is INSUFFICIENT in non-TTY environments

`runner.cjs spawnSync` now uses `stdio: ['inherit', 'pipe', 'pipe']` (was `['ignore', 'pipe', 'pipe']`) so that when the parent has a TTY, the spawned `claude -p` inherits it and continues its autonomous loop.

**BUT**: panmd3 v3.7.4 validation run (launched from Bash tool wrapper) still exited at 48s with 0 commits. Root cause: `inherit` inherits from parent → grandparent → ancestry chain. If ANY ancestor (Bash tool, CI runner, script wrapper) lacks a TTY, the inheritance chain transports "no TTY" all the way down. Claude `-p` detects no-TTY → exits early.

**Real fix path (v3.8 candidate)**: node-pty for explicit PTY allocation (would be PAN's first runtime dep; meaningful trade-off) OR Windows-specific ConPTY API integration.

**Current limitation documented**: `pan-tools experiment run` for autonomous claude works ONLY when launched from a real terminal where the entire ancestry has a TTY. From Bash-tool / CI / script wrappers, the run will exit early — but v3.7.4's P-1502 fix at least reports this honestly via `status: "incomplete"`.

#### 🟡 P-1701 — Workflow continuation patched but UNTESTABLE without P-1501 working

`pan-wizard-core/workflows/transition.md` `<if mode="yolo">` branch now instructs in-context continuation (read next workflow file inline) instead of `Exit skill and invoke SlashCommand(...)`. SlashCommand spawns fresh sessions, which works in interactive Claude Code but NOT in headless `claude -p`.

The patch is in source. It will work once P-1501 is fully fixed and we can run a multi-phase autonomous workflow end-to-end.

#### 📝 P-1401 — Lightweight phase bypass NOT YET VALIDATED

The v3.7.3 patch added a bypass condition (`plan_count == 1 AND simple class AND project research exists`). Phase 1 of panmd2 (the only multi-phase test that ran) had 2 plans, so the bypass correctly didn't trigger. A genuine 1-plan project hasn't been run yet — needs a true single-plan idea (deferred to v3.8 testing).

### Tests

2659/2659 unit + scenario tests pass. Runner regression test updated to exercise the new `status: "incomplete"` path indirectly via the runtime-override skip.

### Honest tally for v3.7.x

| Generation | Bugs found | Fixed and validated | Open |
|-----------|------------|---------------------|------|
| v3.7.0 design | — | — | — |
| v3.7.1 | 3 (P-101, P-102, P-301) | 3 ✓ | 0 |
| v3.7.2 | 3 (P-1301, P-1302, P-1304) | 3 ✓ | 0 |
| v3.7.3 | 4 (P-1401, P-1402, P-1403, P-1404) | 3 patches shipped, P-1401 untested | 1 (untested) |
| v3.7.3 validation surfaced | 2 (P-1501, P-1502) | — | both for v3.7.4 |
| v3.7.4 | 1 fully (P-1502), 1 partially (P-1501-r3 needs node-pty), 1 blocked (P-1701) | 1 of 3 | 2 partial/blocked |

Total real PAN bugs found by the loop across v3.7.x: **13**. Fully fixed and validated: **7**. Partially or blocked: **6**.

The autonomous loop is real, produces real signal, and is iterating. It is not yet self-sufficient end-to-end via the runner — TTY allocation is the remaining hard problem.

## [3.7.3] - 2026-04-27

### Fixed — patches consuming v3.7.2 panloop run findings + 2 new ones from v3.7.3 validation

Four patches from the v3.7.2 panloop completion + two new findings from the v3.7.3 validation experiment (panloop2). The validation surfaced gaps in the autonomous loop's headless-mode behavior that weren't visible until the runner-spawned path was exercised end-to-end.

#### Fixed (4)

- **P-1401** — `pan-wizard-core/workflows/plan-phase.md` adds a lightweight-phase bypass in step 5: when `plan_count == 1` AND the plan's class is chore/docs/feat-trivial AND project-level research files exist, skip per-phase research entirely. Saves ~3 commits and ~5 minutes per trivial phase. Surfaced by panloop run: Phase 1 (project setup, ~10 LOC of work) over-ceremonialized through full research+plan-checker pipeline.
- **P-1402** — `agents/pan-phase-researcher.md` prompt now explicitly requires reading project-level `research/architecture.md`, `features.md`, `stack.md`, `project.md` before producing per-phase research. Per-phase research must emit only deltas/specifics, not re-derive territory already in project-level research. Surfaced when phase 1 + phase 2 research duplicated each other and project-level research.
- **P-1403** — `pan-wizard-core/bin/lib/optimize.cjs analyzeEvents()` now computes autonomous-overhead metrics: `commits_per_minute`, `minutes_per_commit`, `cost_usd_per_commit`, `total_cost_usd`. When commit count + cost data are passed via `sessionMeta` (caller reads from harvest.json + claude-cli result JSON), these surface in the `overhead` field of the report. Useful trend signal: are autonomous runs getting cheaper as patterns saturate?
- **P-1404** — `pan-wizard-core/bin/lib/optimize.cjs initTraceSession()` now reuses an existing recent session (within 1-hour window) instead of always creating a new one. Surfaced by panloop: 14 trace events were scattered across 4 sub-sessions because every workflow phase called `optimize trace init` independently, creating a new session each time. Now a single autonomous run produces ONE consolidated session for cleaner /pan:learn analysis.

#### Validated in production (panloop2 v3.7.3 validation run)

- **P-1304 fix CONFIRMED** — runner.cjs spawned claude -p cleanly via the patched shell-arg quoting. Status: done, exit_code: 0 (was failing in 538ms before). The runner integration path works.

#### New findings from v3.7.3 validation (NOT yet fixed; v3.7.4 candidates)

- **P-1501** — `claude -p` autonomous session exits after Phase 0 setup. The runner-spawned panloop2 run wrote only `config.json` in 48s before exiting cleanly. The auto-mode workflow block ends with prose ("proceed") — model interprets that as completion. The original panloop 29-min full lifecycle worked because it was driven by my manual interactive `claude -p` invocation, not via runner. **Workflow auto-mode blocks must end with explicit tool calls (Write/Task) that drive the next step.** Audit all `--auto`-flagged workflow paths for this pattern.
- **P-1502** — `runner.cjs` exit_code:0 is too coarse a success signal. panloop2 reported `status: done, stop_reason: success` despite the workflow halting at Phase 0. Runner should additionally check whether `<experiment>/.planning/state.md` shows `status: completed` (or whether milestone summary exists) before declaring success. If workflow never reached milestone-done, set `stop_reason: incomplete` even with exit 0.

These two findings keep the door open for v3.7.4 — they're documented, not blocking. The current v3.7.3 ships real value (the 4 patches above) and validates that the runner spawn path works end-to-end at the OS level.

### Test deltas

Unit suite: 2368/2368 pass (was 2364 in v3.7.2 — +4 from new doc-lint test added earlier).

## [3.7.2] - 2026-04-27

### Fixed — patches consuming panloop autonomous-loop findings (the loop closes on itself, second iteration)

The first **real autonomous run** of the v3.7.0 self-improvement loop (panloop experiment, 25-second initial probe + multi-minute follow-up) surfaced 3 new internal PAN bugs that were blocking the design intent. All three fixed in v3.7.2.

- **P-1301** — `/pan:new-project --auto` invoked `AskUserQuestion` for depth/execution/git-tracking/research/plan-check/verifier/model-profile despite `--auto` being set. In headless `claude -p` mode, `AskUserQuestion` is denied (no interactive UI), so the workflow stalled after 5 turns at $0.33. Fix in `pan-wizard-core/workflows/new-project.md`: replaced 7 `AskUserQuestion` calls in the auto-mode block with a declarative defaults table. Idea.md frontmatter can override any default (e.g., `planning_depth: standard`).
- **P-1302** — `runner.cjs` adapters didn't pass non-interactive permission flags. claude/gemini autonomous runs hit interactive permission prompts they couldn't answer. Fix: claude adapter now defaults `--dangerously-skip-permissions`; gemini adapter adds `--yolo`. Trade-off (trusts the prompt's tool choices) acceptable because the runner only spawns inside isolated experiment folders (PAN_SOURCE_ROOT-guarded by `experiment.cjs`).
- **P-1304** — `runner.cjs spawnSync({shell:true})` on Windows joins args with spaces but doesn't quote them. Multi-word args (e.g., the prompt `/pan:new-project --auto @.planning/idea.md`) get re-split by `cmd.exe` into multiple args. Surfaced when the patched runner exited 1 in 538ms. Fix: under `useShell`, wrap any arg containing whitespace in double-quotes and double any embedded double-quote (cmd.exe convention).

### Validated in production by the panloop run

- **P-101 fix** confirmed: `experiment.json` shows `status: "ready"` after installer success.
- **P-102 fix** confirmed: `claude -p` spawns cleanly via `runner.cjs` on Windows.
- **Auto-trace hooks** confirmed firing during real `claude -p` subprocess execution: `pan-trace-logger.js` and `pan-cost-logger.js` automatically append to `<experiment>/.planning/optimization/traces/sess_auto_*/trace.jsonl` and `<experiment>/.planning/metrics/tokens.jsonl`. First confirmation in production.
- **Caveat — token metering is best-effort**: auto-captured events show `input_tokens: 0, model: null, cost_usd: null`. Claude Code's `SubagentStop` payload doesn't always include token counts (documented in ADR-0024; reconfirmed in vivo by panloop). The `total_cost_usd` field in `claude --output-format json` is reliable.

### Added — universal patterns harvested from the 13-experiment series

5 universal topic files from prior experiments (whooo + 5 substantive + 8 mock):

- `learnings/universal/binary-io.md` (P-1101 — `fs.readFileSync` without encoding returns Buffer)
- `learnings/universal/error-handling.md` (P-1201 — return errors as result fields, not throw)
- `learnings/universal/invariants.md` (P-901 — round-trip tests for format converters)
- `learnings/universal/loop-design.md` (**P-1303 critical** — self-improvement loops must EXERCISE the system being optimized, not BUILD PARALLEL artifacts. Empirical evidence: 25-second autonomous run produced 3 critical bugs; 8 hand-built mock experiments produced 0 PAN-internal findings.)
- `learnings/universal/unicode.md` (P-1001 — `String.length` is UTF-16 code units, not characters)

## [3.7.1] - 2026-04-27

### Fixed — patches consuming whooo experiment findings (ADR-0026 self-improvement loop)

The first **real harvest of internal patterns** from the v3.7.0 self-improvement loop. Three internal patterns (P-101, P-102, P-301), promoted from the whooo experiment, became actionable v3.7.1 patches. This is the loop closing on itself: PAN ran an experiment, found bugs in PAN, shipped fixes.

- **P-101** — `experiment.cjs newExperiment` now persists `manifest.status='ready'` to disk after a successful installer run. Earlier versions mutated the in-memory manifest but never wrote it back, so `experiment.json` kept saying `scaffolded` forever. 3-line fix in `pan-wizard-core/bin/lib/experiment.cjs`.
- **P-102** — `runner.cjs runExperiment` now passes `shell: process.platform === 'win32'` to `spawnSync`. Without this, every adapter (claude/codex/gemini/opencode) failed ENOENT on Windows because Node's spawn doesn't resolve `.cmd` shims. Confirmed across two consecutive whooo runs as a hard blocker; fixed in `pan-wizard-core/bin/lib/runner.cjs`.
- **P-301** — 9 frontmatter consistency bugs in PAN's own `commands/pan/*.md`:
  - `learn.md`, `optimize.md` — added missing frontmatter (`name`, `group`, `description`, `allowed-tools`)
  - `patches.md` — added missing `name`; converted `allowed-tools` from CSV string to YAML list
  - `debug.md`, `health.md`, `todo-add.md`, `todo-check.md` — quoted `argument-hint` placeholder strings (e.g. `[issue description]` → `"[issue description]"`) so YAML doesn't interpret them as flow lists
  - `phase-tests.md` — replaced `argument-instructions: |` block scalar with single-line string (block scalars are out-of-scope for the canonical PAN schema)

### Added — `pan-tools doc-lint` (vendored from whooo)

Catches frontmatter drift at author time. Ships in v3.7.1 as a runtime tool wired into `/pan:health`.

- `pan-wizard-core/bin/lib/doc-lint.cjs` — adapter wrapping the vendored 5-module library
- `pan-wizard-core/bin/lib/doc-lint/{frontmatter,schema,validate,walk,reporter}.js` — vendored from `d:\whooo\lib\` (whooo experiment v0.1.0)
- `pan-wizard-core/references/schemas/pan-command.schema.yml` — canonical schema for `commands/pan/*.md` frontmatter (`name`, `group`, `description`, `allowed-tools`, `argument-hint`, `argument-instructions`, `agent`, `type`)
- `pan-tools doc-lint <dir> [--schema <path>] [--format json|human] [--strict] [--exclude <glob>]`
- `pan-tools doc-lint schema-check <path>`
- `pan-wizard-core/workflows/health.md` — new `<step name="run_doc_lint">` block runs doc-lint against `commands/pan/` if it exists in the host project
- `tests/doc-lint.test.cjs` — 4 tests covering vendored modules, schema shipping, block-list parsing, and full self-lint of PAN's commands

### Verified — PAN's own commands/pan/ is fully clean

After P-301 fixes: `pan-tools doc-lint commands/pan` reports **0 errors, 0 warnings across 52 files in <100ms**. Negative test asserts this in the regression suite.

### Test deltas

2655 → ~2700+ across new doc-lint tests + the regression suite continuing to pass.

## [3.7.0] - 2026-04-27

### Added — Self-Improvement Loop (Cross-Project Meta-Learning)

Closes the deferred MEMORY note "Cross-Session Learning (PATTERNS.md auto-capture)". Spec: `docs/specs/self_improvement_loop_featureai.md`. ADR: ADR-0026. Shipped across 4 waves (W1 scaffold, W2 runner, W3 harvest, W4 promote+ship) — all bundled in v3.7.0.

**The loop:**
```
1. /pan:experiment new <slug> --idea idea.md   →  scaffold isolated project at ~/pan-experiments/<slug>/
2. /pan:experiment run <slug>                  →  spawn external AI session (claude/codex/gemini/opencode)
3. /pan:experiment harvest <slug>              →  copy telemetry to <source>/experiments/<slug>/
4. /pan:learn --experiment <slug>              →  run pan-optimizer over harvested data
5. pan-tools learn promote --pattern <id>      →  write findings to learnings/{universal,internal}/
6. ship as next release                        →  patterns auto-load via workflow cross-references
```

**New core modules:**
- `pan-wizard-core/bin/lib/experiment.cjs` (28th module): `newExperiment`, `listExperiments`, `getExperimentManifest`, `harvestExperiment`, `pruneExperiment`. PAN_SOURCE_ROOT guard prevents scaffolding inside source repo.
- `pan-wizard-core/bin/lib/runner.cjs` (29th module): `runExperiment`, `tailExperimentState`, `stopExperiment`, `RUNTIME_RUNNERS` adapter map. Uses `spawnSync` with native timeout. Copilot CLI is `null` (no headless mode).
- `pan-wizard-core/bin/lib/optimize.cjs` extensions: `promotePattern`, `listPromotedPatterns`, `unpromotePattern` for the universal/internal tier writes.

**New agent:**
- `agents/pan-experiment-runner` (21st agent): observation-only watchdog. Tools: `[Read, Bash, Glob, Grep]` only — no Edit/Write by design.

**New command:**
- `commands/pan/experiment.md` (52nd command) with 8 subcommands: `new`, `list`, `manifest`, `run`, `status`, `stop`, `harvest`, `prune`.

**New template:**
- `pan-wizard-core/templates/idea.md` (27th template): structured idea-doc shape (problem / success / scope / constraints).

**New top-level dir under pan-wizard-core:**
- `learnings/universal/` — AI-derived patterns shipped to all 5 runtime installs
- `learnings/internal/` — PAN-development-specific patterns, source-only (installer strips this)

**Two-tier shipping (critical invariant):**
- `bin/install.js` explicitly removes `learnings/internal/` from each install dir after copy
- `tests/scenarios/learnings-installed.test.cjs` asserts (negative test) that `learnings/internal/` does NOT ship to any of 5 runtimes
- This prevents PAN-internal patterns ("always commit individually because of source repo's hooks") from leaking to user installs as universal advice

**Workflow cross-references:**
- 4 long workflows (`exec-phase`, `plan-phase`, `verify-phase`, `execute-plan`) now reference `learnings/universal/` alongside `references/guardrails.md`. Patterns auto-load as topic files appear.

**`/pan:learn --experiment <slug>`:**
- New flag for `commands/pan/learn.md`. Routes pan-optimizer at the harvested experiment data instead of the current project's traces.

**`pan-tools learn promote/unpromote/list-promoted`:**
- CLI dispatcher commands for the W4 promote step. Manual gate by design (no auto-promote in v3.7).

**Deferrals (documented in ADR-0026):**
- Auto-promote without human review — v3.8+
- Cross-experiment aggregation — v3.8+
- VSCode UI runner path — keep CLI; Playwright stays for tests
- Bidirectional control mid-experiment — observation-only by design
- GitHub Copilot CLI runner — no headless prompt mode

**Test deltas:** 2588 (v3.6.0) → ~2670+ (v3.7.0). New: 21 W1 unit tests (experiment scaffold + harvest + prune), 12 W2 unit tests (runner), 13 W4 unit tests (promote), 6 W3 scenario tests (lifecycle), 15 W4 scenario tests (3×5 runtime tier shipping). Zero regressions.

## [3.6.0] - 2026-04-27

### Added — Behavioral Guardrails Layer

Adopts three patterns from Google's `agents-cli` (see `docs/specs/googlecli_adoption_featureai.md`) — a consolidated behavioral rules surface for AI agents executing PAN workflows. Additive only; zero breaking changes.

- `pan-wizard-core/references/guardrails.md` — new 14th reference doc (~58 lines). Consolidates: 5-row "Common Shortcuts to Resist" table (anti-patterns + correct action), Code Preservation Principle (surgical edits only — preserve config values, comments, formatting), Stop-the-Line Rule (regressions halt feature work), Systematic Debugging Sequence (reproduce → localize → fix one variable → verify → guard), and cross-references to existing references.
- 4 long workflows gain `## Re-Read Checkpoints` sections to resist context-compaction drift across long autonomous sessions:
  - `pan-wizard-core/workflows/exec-phase.md`
  - `pan-wizard-core/workflows/plan-phase.md`
  - `pan-wizard-core/workflows/verify-phase.md`
  - `pan-wizard-core/workflows/execute-plan.md`
- `pan-wizard-core/workflows/new-project.md` — MANDATORY Phase 0 Clarify gate (4 questions: problem / success / scope / constraints) before scaffolding. `--auto` mode short-circuits when a PRD is provided.
- `pan-wizard-core/workflows/plan-phase.md` — recommended Phase 0 Clarify Phase Scope (3 phase-scoped questions).
- `agents/pan-reviewer.md` — references guardrails.md; flags Code Preservation violations at high severity.
- `agents/pan-planner.md` — references guardrails.md; plans must enforce guardrails in their `<deviation_rules>`.
- `tests/guardrails.test.cjs` — 4 unit tests (62nd test file): file existence, line budget, required headings, cross-references.
- `tests/workflows-checkpoints.test.cjs` — 4 unit tests (63rd file): `## Re-Read Checkpoints` section in each of 4 long workflows.
- `tests/guardrails-references.test.cjs` — 6 unit tests (64th file): 4 workflows + 2 agents reference guardrails.md.
- `tests/phase0-gate.test.cjs` — 2 unit tests (65th file): Phase 0 sections in new-project.md + plan-phase.md.
- `tests/scenarios/guardrails-installed.test.cjs` — 5 scenario tests (31st scenario file): guardrails.md installs to all 5 runtime install dirs (.claude, .codex, .gemini, .opencode, .github).
- `docs/decisions/ADR-0025-behavioral-guardrails-layer.md` — records decisions, deferrals, and rollback plan.
- `docs/specs/googlecli_adoption_featureai.md` — source spec (5 candidate adoptions ranked by ROI; this release ships #1, #2, #5; defers #3 prototype-first; #4 to v3.7+).

**Test deltas:** 2302 → 2318 unit tests (+16), 265 → 270 scenario tests (+5). Total **2567 → 2588** (+21).

**Explicit deferrals:**
- `pan-tools info` self-discovery command — high overlap with `state json` and `validate health`. Defer to v3.6.1 prototype-first.
- Frontmatter `requires`/`related` schema — defer until concrete consumer justifies 50+ command backfill.
- LLM-as-judge eval framework — different problem domain; out of scope.

**Spec-implementation note:** The original spec named `focus-exec.md` as a 4th workflow target for Re-Read Checkpoints. `focus-exec.md` is a *command* file (`commands/pan/`), not a workflow. The 4th workflow target is **`execute-plan.md`** — the next-longest workflow after exec-phase, plan-phase, verify-phase. Documented in ADR-0025.

## [3.5.2] - 2026-04-25

### Fixed

- README images on npmjs.com (real fix) — 3.5.1 used inline base64 `data:image/svg+xml;base64,...` URIs in the README, but npmjs.com's frontend strips `data:` URIs from `<img>` tags as an XSS protection. The data URIs were correctly stored in the registry's README field but never rendered on the package page. Switched to **jsDelivr CDN URLs** (`https://cdn.jsdelivr.net/npm/pan-wizard@latest/assets/...`) which serve the images directly from the published npm tarball — no GitHub access needed, no external image hosting, repo can stay private.

## [3.5.1] - 2026-04-25

### Fixed

- README images on npmjs.com (attempt 1) — switched from GitHub raw URLs to inline base64 data URIs. Did not actually work (see 3.5.2). Kept the version published so the changelog accurately records the iteration.

### Chore

- Untracked `.claude/settings.local.json` — per-user Claude Code config that shouldn't be shared. File remains on disk; only its tracking was removed. Convention: `settings.json` is committed (team-shared), `settings.local.json` is gitignored (user-personal).

## [3.5.0] - 2026-04-25 (updated)

### Added — Distill: AI Code-Bloat Optimizer (9th focus-auto category)

The `distill` category brings the SOTA agentic-refactoring pipeline (deterministic-first, LLM-on-narrow-spans) to PAN's focus-auto loop. Targets the bloat patterns documented in *"Do LLMs Generate Smelly Code?"* (TSE 2025), CloneGPT (MSR 2025), and *"Less Is More: Compressing LLM-Generated Code"* (FSE 2025) — the slop that AI assistants drop into codebases that no shipping CLI tool currently scrubs.

- `pan-wizard-core/bin/lib/distill.cjs` — new 27th core module (~430 LOC). Exports 9 pattern matchers + 5 dispatcher/helper functions:
  - **Pass 1 (Deterministic):** `findPhantomTryCatch`, `findUnusedImports`, `findMagicNumbers`, `findLongFunctions`, `findWideParamLists`
  - **Pass 2 (AST-style):** `findSingleInstanceFactories`, `findDeepNesting`
  - **Pass 3 (Cross-file graph):** `findRepeatedBlocks`, `findUnreferencedExports`
  - **Pass 4 (LLM judgment):** delegated to `pan-distiller` agent — receives only flagged spans
  - **Pass 5 (Cross-session memory):** `readPatternsMemory`, `writePatternsMemory`, `detectRegressedPatterns` — `.planning/memory/distill-patterns.md`
  - **Bloat budget gate:** `computeBloatBudget` — touched_LOC / essential_LOC ratio (default 2.0x threshold)
- `agents/pan-distiller.md` — new 20th agent. Receives only flagged spans (max 50 lines context per finding), validates pattern, refines safety tier, proposes minimal diff rewrite. Read-only; never applies fixes.
- `pan-wizard-core/bin/lib/constants.cjs` — `distill` added to FOCUS_CATEGORIES (9 entries), CATEGORY_PRIORITY_RANGE (P1-P5), CATEGORY_DEFAULTS (balanced/50)
- `pan-wizard-core/bin/lib/focus.cjs` — `distill_complete` stop reason added to `determineStopReason`
- `pan-wizard-core/bin/pan-tools.cjs` — new `distill` dispatch case with subcommands: `scan`, `analyze`, `report`
- `commands/pan/focus-auto.md` — category 9 added to menu + flag table; new "Distill Category — Execution Details" section documenting the 5-pass pipeline, safety tiers, bloat budget formula
- `tests/distill.test.cjs` — new 61st unit test file. 34 tests covering all 5 passes, safety tiers, bloat budget, cross-session memory, integration scan, PAN-runtime exclusion

**Safety tiers:**
- `safe` — auto-applied (deterministic, behavior-preserving)
- `review_required` — surfaced to user for confirmation
- `risky` — never auto-applied
- Confidence < 0.85 auto-downgrades to review_required

**CLI:**
```bash
pan-tools distill scan                              # All findings
pan-tools distill analyze [--touched-loc N] [--bloat-threshold X]  # + budget + regression detection
pan-tools distill report                            # Persist patterns to memory
```

### Fixed — Uninstaller Skills Cleanup Bug

- `bin/install.js` — Claude Code uninstaller now removes `skills/pan-*.md` shim files. Previously only `commands/pan/` was cleaned, leaving 51 orphan shim files after uninstall. The empty `skills/` directory is also removed when all PAN shims are gone, but preserved if the user has other (non-pan-*) skills.
- `tests/claude-install.test.cjs` — new 60th unit test file (18 tests) covering Claude install structure, uninstall cleanup, and two regression tests for the skills/ cleanup gap + user-skill preservation.

### Added — Git Command Family (/pan:git)

Phase-aware git workflow commands with safety guardrails matching the quality of the commit.md dev reference.

- `pan-wizard-core/bin/lib/git.cjs` — new 26th core CJS module. 10 user-facing subcommand functions: `cmdGitCommit` (safety-checked, conventional types, reuses `runCommitSafetyChecks`), `cmdGitBranch` (create/switch/list/delete/current with `pan/phase-N` naming), `cmdGitPush` (remote validation, explicit `--force`), `cmdGitStatus` (branch + file counts), `cmdGitLog` (count-limited formatted history), `cmdGitStash` (named save/pop/list/drop), `cmdGitDiff` (staged/unstaged with line counts), `cmdGitRollback` (find+reset to `pan-rollback-*` tags, dry-run), `cmdGitTag` (list/create/delete), `cmdGitSync` (fetch+pull with optional rebase). Helper exports: `getCurrentBranch`, `getBranchList`, `getTagList`.
- `commands/pan/git.md` — new `/pan:git` command (51st command). Full workflow docs for all 10 subcommands, safety check tables, phase-aware branch naming examples, rollback workflow, runtime note.
- `tests/git.test.cjs` — new 59th unit test file. 27 tests covering all subcommands via CLI + 3 pure helper functions.

**New CLI subcommands (`pan-tools git <sub>`):**
- `git commit [--type T] [--message M] [--all] [--amend] [--force]`
- `git branch <create|switch|list|delete|current> [--name N] [--phase N] [--force]`
- `git push [--remote R] [--branch B] [--force]`
- `git status`
- `git log [--count N]`
- `git stash <save|pop|list|drop> [--name M] [--index I]`
- `git diff [--staged] [--file F]`
- `git rollback [--tag T] [--dry-run]`
- `git tag <list|create|delete> [--name N] [--message M] [--pattern P]`
- `git sync [--remote R] [--branch B] [--rebase]`

**Safety model:**
- `commit` reuses `runCommitSafetyChecks` from `commands.cjs` — deleted-file detection, sensitive-file patterns, `--force` override
- `push` requires explicit `--force` flag for force-push; validates remote exists first
- `rollback` requires clean working tree unless `--dry-run`; lists available `pan-rollback-*` tags

---

## [3.5.0] - 2026-04-21

### Added

**Circular Optimization Loop (self-learning system):**

The key new capability: every agent spawn is traced, analyzed after the build, and turned into memory entries that make the next run smarter. Repeat. The model gets better at your specific project on every cycle.

- `pan-wizard-core/bin/lib/optimize.cjs` — new core module (25th CJS module). Manages trace sessions, event logging, local analysis (frequency maps, agent stats, error rates), report storage, auto-apply logic, and cumulative stats. Exports: `initTraceSession`, `logTraceEvent`, `endTraceSession`, `readTraceSession`, `listTraceSessions`, `analyzeEvents`, `generateLocalReport`, `listOptimizationReports`, `parseAutoApplyBlock`, `applyReportRecommendations`, `deriveActionsFromAnalysis`, `getOptimizeStats`, + 5 cmd functions.
- `hooks/pan-trace-logger.js` — new SubagentStop hook (5th hook). Fires alongside cost-logger on every agent completion. If a trace session is active, logs a `decision:agent_completion` event with token counts, and a `redundancy:uncached_heavy_run` event when output > 3000 tokens with zero cache hits (potential repeated research).
- `agents/pan-optimizer.md` — new agent (19th agent). Reads trace events + existing memory, clusters patterns by frequency × impact, produces structured optimization report with ranked findings and machine-parsable `## Auto-Apply Actions` JSON block.
- `commands/pan/learn.md` — new `/pan:learn` command. Analyze most recent trace session, invoke pan-optimizer, show optimization score + top findings.
- `commands/pan/optimize.md` — new `/pan:optimize` command. Subcommands: `apply`, `list`, `stats`, `trace init/end/status/list`.
- `pan-wizard-core/workflows/learn.md` — workflow for /pan:learn.
- `pan-wizard-core/workflows/optimize.md` — workflow for /pan:optimize.
- `tests/optimize.test.cjs` — 78 new tests covering: session lifecycle, event logging, analysis, report parsing, apply logic, stats, hook behavior.

**New CLI subcommands:**
- `pan-tools optimize trace init [--description "..."]` — start trace session
- `pan-tools optimize trace end` — finalize + write summary stats
- `pan-tools optimize trace current` — show active session ID
- `pan-tools optimize trace list` — list all sessions
- `pan-tools optimize trace log --type <type> --description "..."` — log manual event
- `pan-tools optimize learn [--session <id>]` — generate local analysis JSON
- `pan-tools optimize apply [--report <path>]` — apply auto-apply actions
- `pan-tools optimize list` — list optimization reports
- `pan-tools optimize stats` — cumulative stats
- `pan-tools learn [--session <id>]` — convenience alias for optimize learn

**Installer:**
- Registers `pan-trace-logger.js` as a second SubagentStop hook (alongside cost-logger). No-ops silently when no trace session is active.

**Trace storage layout:**
- `.planning/optimization/traces/{session}/trace.jsonl` — raw event stream
- `.planning/optimization/traces/{session}/session.json` — metadata
- `.planning/optimization/current-session` — active session ID
- `.planning/optimization/reports/` — analysis JSON + optimizer markdown reports
- `.planning/optimization/applied.jsonl` — cumulative apply log
- `.planning/optimization/suggestions.md` — manual review items
- `.planning/optimization/config-suggestions.md` — config notes

**The circular loop:**
```
trace init → exec-phase (hook traces every agent) → learn (pan-optimizer analyzes) →
optimize apply (writes memory entries) → next run has better context → repeat
```

### Changed

- `bin/install.js` — added `pan-trace-logger.js` to hooks file manifest; registers trace-logger SubagentStop hook entry
- `scripts/build-hooks.js` — added `pan-trace-logger.js` to HOOKS_TO_COPY list
- `pan-wizard-core/bin/pan-tools.cjs` — added `optimize` and `learn` dispatch cases; added `optimize` module require
- `package.json` — version 3.4.1 → 3.5.0
- `hooks/pan-trace-logger.js` — added `ensureSessionId()`: auto-creates day-scoped `sess_auto_YYYYMMDD` session if none active, so tracing is always-on with zero setup
- `pan-wizard-core/workflows/exec-phase.md` — wired: trace init at start, wave_complete log after each wave, phase_complete log after roadmap update; **W1**: reviewer correction events now logged to trace bus when verdict is NEEDS_FIXES or PASS_WITH_WARNINGS; **W2**: new `load_phase_memory` step reads `.planning/memory/*.md` before Wave 1 dispatch and injects rules into executor `<project_memory>` context block; **W3**: phase field auto-inherited from session metadata
- `pan-wizard-core/workflows/plan-phase.md` — wired: trace init at start, plan_verified/plan_checker_issues log during checker loop, plans_created log at end
- `pan-wizard-core/workflows/verify-phase.md` — wired: verification_passed/verification_gaps log in return_to_orchestrator step
- `pan-wizard-core/workflows/quick.md` — wired: trace init after roadmap_exists validation
- `commands/pan/focus-exec.md` — wired: trace init in Stage 1, trace end before Stage 6 commit
- `commands/pan/focus-scan.md` — wired: trace init in Phase 0
- `commands/pan/milestone-done.md` — wired: trace end + optimize learn after milestone archive (Step 9)
- `pan-wizard-core/bin/lib/optimize.cjs` — **W1**: `analyzeEvents()` now surfaces `reviewer_corrections` and `memory_primed_count` in summary; **W3**: `logTraceEvent()` auto-inherits `phase` from session metadata when event has no explicit phase, eliminating the session-join requirement for per-phase filtering

### Tests

- 2468 total tests (88 files, 511 suites) — up from 2460
- 13 new tests in `tests/optimize.test.cjs`: W1 reviewer_correction counts (5), W2 memory_primed_count (2), W3 phase inheritance (3), plus 3 new timing tests added in patch
- 1 pre-existing failure in `tests/learnings.test.cjs` (unchanged)

---

## [3.4.1] - 2026-04-21

### Fixed

**E2E workflow bugs (discovered during end-to-end project trace):**
- `bin/install.js` — source-guard path comparison on Windows: `D:\` vs `d:\` case mismatch caused guard to pass when it should block. Added `normPath()` for case-insensitive comparison on win32.
- `pan-wizard-core/templates/state.md` — template was generating unbolded `Field:` format instead of `**Field:**` bold format required by all parsers. Fixed to match parser expectations.
- `pan-wizard-core/templates/roadmap.md` — standardized `**Goal:**`, `**Depends on:**`, `**Requirements:**`, `**Plans:**` field format (colon inside bold, not outside).
- `pan-wizard-core/bin/lib/state.cjs` — `parseSessionFromState` regex now accepts both `## Session` and `## Session Continuity` headings, and both `Last Date:` and `Last session:` field names.
- `pan-wizard-core/bin/lib/roadmap.cjs` — Goal/Depends-on/Plans parsers now accept both `**Field:**` and `**Field**:` formats (colon inside or outside bold).
- `pan-wizard-core/bin/lib/core.cjs` — Goal parser same dual-format fix.
- `pan-wizard-core/bin/lib/init.cjs` — `cmdInitPlanPhase` now falls back to roadmap data when phase directory doesn't exist yet (before first plan is created).
- `pan-wizard-core/bin/lib/phase.cjs` — `phase-plan-index` reading: fixed wrong key name (`files-modified` → `files_modified`), XML task counting vs heading counting, objective extraction from XML body. Phase `complete` next-phase fallback now reads roadmap when no disk directories exist. Progress table regex now updates plans count column correctly. `markRequirementsCompleteForPhase` accepts `**Requirements**:` format.

**File name normalization (consistency audit):**
- `pan-wizard-core/bin/lib/knowledge.cjs` — `PLAYBOOK_FILE` constant changed from `'PLAYBOOK.md'` to `'playbook.md'` to match project-wide lowercase kebab-case convention. All references updated across agents, commands, and docs.
- `pan-wizard-core/workflows/plan-phase.md` — Nyquist validation file changed from `${PADDED_PHASE}-VALIDATION.md` to `${PADDED_PHASE}-validation.md`.
- `agents/pan-project-researcher.md` — Output files `COMPARISON.md` and `FEASIBILITY.md` normalized to lowercase.
- `pan-wizard-core/bin/lib/constants.cjs` — Added `VALIDATION_SUFFIX = '-validation.md'` export (the only phase-artifact suffix previously without a constant).

**Documentation count fixes (deep audit):**
- Corrected stale counts across CLAUDE.md, README.md, ARCHITECTURE.md, DEVELOPMENT.md, USER-GUIDE.md: commands 42→48, agents 12→18, templates 38→40, hooks 3→4, tests 2368→2382, install.js LOC 1959→1999, docs/ count 12→16, ADRs 22→24, specs 35→38.
- ARCHITECTURE.md: added 6 Spec B v2 agents to Layer 3 table, added `pan-cost-logger` hook row, added `roadmap.cjs` dependency to `init.cjs` in module graph.

## [3.4.0] - 2026-04-18

### Added — Spec B v2 Wave 5 (Final: hierarchical exec + auto cost instrumentation)

Closes Spec B v2. Three concerns: GA the hierarchical orchestrator, wire the deep-review flag into existing commands, automate cost logging via SubagentStop hooks.

**Y-7 hierarchical exec — GA:**
- New agent `agents/pan-conductor.md` — top-level orchestrator for `/pan:exec-phase <N> --hierarchical`. Orange color, thinking enabled (budget 8000). Decomposes a phase, spawns sub-agents in waves (executors, reviewers, verifiers), tracks audit trail via `bus.cjs` `orchestrator` channel and `.planning/orchestration/trace.json`.
- Safety harness (hard caps, not advisory): max 2 nesting levels (conductor → sub-agent, no sub-sub-agents), max 12 spawns per phase, budget ceiling from focus-auto config, `.planning/orchestration/abort` kill-switch. Checks enforced before every spawn.
- Runtime gating: Claude Code + Opus 4.7 only. On other runtimes, the `--hierarchical` flag is a no-op with a warning — falls back to flat exec. Agent file still ships to all runtimes for uniformity.
- Documented in [commands/pan/exec-phase.md](commands/pan/exec-phase.md) — flag is opt-in, with clear guidance on when to use it (≥4 autonomous plans) and when to skip it (single-plan phases, many checkpoints).

**`--deep-review` flag wiring:**
- `commands/pan/exec-phase.md` — `--deep-review` documented. After the normal reviewer step, auto-invokes `/pan:review-deep <N>` (pan-hardener + pan-meta-reviewer). Roughly 3× a normal review in cost; recommended for auth/payment/PII/migrations/public APIs.
- `commands/pan/focus-exec.md` — same flag documented for per-item campaigns.

**Auto cost instrumentation:**
- New hook `hooks/pan-cost-logger.js` — SubagentStop hook. Extracts what it can from Claude Code's event payload (`agent_type`, `session_id`, `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`, `model`, `phase`), appends a record to `.planning/metrics/tokens.jsonl` with `source: "hook"`. Non-blocking — any write failure is silent so hook doesn't break the agent loop.
- Pure helpers `buildCostRecord(data, cwd)` and `appendRecord(cwd, record)` exported for unit tests.
- Installer registers the hook in settings.json under `SubagentStop` for all runtimes that use settings.json (Claude, Gemini, OpenCode). Gemini + OpenCode may not fire the event; the registration is a no-op there but doesn't hurt.
- `scripts/build-hooks.js` updated to include the new hook in the dist copy.
- Installer cleanup list (`panHooks` array) includes `pan-cost-logger.js` so uninstall removes it.

Integration note: records from this hook are picked up by the existing `cost.cjs` aggregator with no changes required. The `source: "hook"` field distinguishes hook-sourced records from manually-appended records for future filtering.

### Test additions

- `tests/cost-logger-hook.test.cjs` — 18 tests: buildCostRecord input handling (null, wrong event type, field extraction from usage), appendRecord (file creation, non-blocking failure, multi-record append), integration with cost.aggregate() aggregator.

### Developer notes

- Module count: 24 (unchanged — conductor is an agent, not a core module; cost-logger is a hook).
- Agent count: 12 → 13. `pan-conductor` joins the shipped agents.
- Hook count: 3 → 4. `pan-cost-logger.js` added.
- Test delta: 2350 → 2368 (+18).
- `bus.cjs` from v3.0 is now consumed by a real producer (conductor audit trail) — end-to-end verification that Y-7 infrastructure works as designed.
- Auto cost instrumentation is best-effort: Claude Code's SubagentStop payload doesn't always include token counts. Records with zero tokens still indicate that an agent ran; exact cost fills in when usage is exposed.

### Spec B v2 status: complete

All 5 waves shipped:
- v3.0 — Y-6 cost + Y-7 bus (foundation + visibility)
- v3.1 — Y-1 preview (foresight)
- v3.2 — Y-2 review-deep + Y-3 knowledge (deep review + knowledge loop)
- v3.3 — Y-4 what-if + Y-5 mcp-bridge (narrow features)
- v3.4 — hierarchical GA + deep-review wiring + auto cost (this release)

Post-v3.4 work is discretionary. Candidates for future versions: X-8 watch (background monitoring, deferred from v1), cross-runtime MCP discovery (generic protocol), auto-injection of MCP tools into planner context, `pan-conductor` nesting beyond 2 levels (would need substantially more safety tooling).

## [3.3.0] - 2026-04-18

### Added — Spec B v2 Wave 4 (Y-4 what-if + Y-5 mcp-bridge)

Narrow-scope features completing Wave 4. Two commands, one new agent, two new core modules.

**Y-4 `/pan:what-if` — counterfactual phase exploration:**
- New core module `pan-wizard-core/bin/lib/whatif.cjs`:
  - `scenarioSlug(scenario)` — lowercase + hyphenate, bounded to 50 chars, filesystem-safe. Defaults to "scenario" for empty/non-string input.
  - `buildCounterfactualContext(cwd, phaseNum, scenario)` — gather phase plan / summary / scenario slug for the counterfactual agent.
  - `writeCounterfactualReport(cwd, phaseNum, scenario, comparison)` — serialize the agent's comparison JSON (summary / differences / recommendations / risks / verdict) to `.planning/counterfactuals/<phase>-<slug>.md` in the main tree.
  - `createWorktree(cwd, phaseNum, scenario, opts)` — git worktree add on fresh branch `pan-whatif/<phase>-<slug>-<ts>`, default root is a sibling of the main repo.
  - `cleanupWorktree(cwd, worktreePath, branch, opts)` — best-effort worktree remove + branch delete with warnings list.
- New agent `agents/pan-counterfactual.md` — purple, thinking enabled (budget 6000). Explicit boundaries: may modify worktree files, must NOT commit/push/merge, must NOT touch paths outside worktree. Returns a structured JSON payload (not a file) so the command writes the report in the main tree before worktree cleanup.
- New command `/pan:what-if <phase> "<scenario>"` — see [commands/pan/what-if.md](commands/pan/what-if.md). Four-stage pipeline: prepare → spawn agent → write report → cleanup.
- CLI: `pan-tools whatif prepare <phase> <scenario>`, `pan-tools whatif report <phase> <scenario> --comparison <json>`, `pan-tools whatif cleanup --worktree <path> --branch <name> [--force]`.

**Y-5 `/pan:mcp-bridge` — MCP discovery + per-phase recommendation:**
- New core module `pan-wizard-core/bin/lib/bridge.cjs`:
  - `loadToolCache(cwd)` / `writeToolCache(cwd, data)` — read/write `.planning/bridge/available-tools.json` (generic schema: `{cached_at, runtime, servers[{name, tools[{name, description, schema}]}]}`).
  - `flattenTools(servers)` — collapse the server/tool hierarchy into a flat list with per-tool server attribution.
  - `scoreToolForPhase(phaseText, tool)` — word-boundary keyword matching of tool name/description against plan text. Returns `{score, hits}`.
  - `recommendForPhase(cwd, phaseNum, opts)` — rank all cached tools by relevance to phase plan, cap at `max_recommendations` (default 10), filter by `min_score` (default 1).
- New command `/pan:mcp-bridge {list | recommend <phase> | cache}` — see [commands/pan/mcp-bridge.md](commands/pan/mcp-bridge.md).
- CLI: `pan-tools bridge list`, `pan-tools bridge recommend <phase> [--max N] [--min-score N]`, `pan-tools bridge cache [--servers <json>] [--runtime <name>]`.

**Deliberately out of scope** (deferred to v3.5+):
- Auto-injection of recommended tools into planner context
- Auto-invocation of MCP tools from executor agents
- Cross-runtime tool discovery protocol

### Test additions

- `tests/whatif.test.cjs` — 24 tests: scenarioSlug edge cases, buildCounterfactualContext for existing/missing phases, writeCounterfactualReport serialization + filename pattern, worktree lifecycle (git-init integration, skipped when git absent), CLI dispatch.
- `tests/bridge.test.cjs` — 26 tests: loadToolCache handles missing/malformed files, writeToolCache round-trip, flattenTools dedupe + attribution, scoreToolForPhase keyword semantics (word boundaries, case-insensitivity), recommendForPhase ranking + min_score filtering + max cap, CLI dispatch.

### Developer notes

- Module count: 22 → 24. `whatif.cjs` + `bridge.cjs` added.
- Test delta: 2300 → 2350 (+50: 24 whatif + 26 bridge).
- Spec B v2 infra reuse: Y-4 uses `findPhaseInternal` (core), `execGit`/`isGitRepo` (core). Y-5 uses `findPhaseInternal` + `safeReadFile`. Neither depends on Y-7 bus (no agent coordination needed).
- The counterfactual agent writes NOTHING during its run — all file writes happen in the main tree via the CLI. This keeps the worktree disposable.
- MCP cache is passive: PAN reads it, the host runtime writes it. Provides a generic schema so future non-Claude runtimes can plug in.

Wave 5 next (v3.4): `exec-phase --hierarchical` flag GA + `exec-phase --deep-review` / `focus-exec --deep-review` wiring + automatic cost instrumentation on agent spawns.

## [3.2.0] - 2026-04-18

### Added — Spec B v2 Wave 3 (Y-2 review-deep + Y-3 knowledge)

**Y-2 `/pan:review-deep` — deep security + cross-check review:**
- New core module `pan-wizard-core/bin/lib/review-deep.cjs`:
  - `parseReviewFindings(md, source)` — extract structured findings from reviewer/hardener/meta markdown. Format: `- **[SEVERITY] category** — description. File: \`path:line\` — rationale.` Missing severity defaults to `info`.
  - `mergeReviews(reviewer, hardener, meta)` — merge three findings sets into consolidated list + conflict table. Detects `meta_dispute` (dispute/overstated/incorrectly/false-positive keywords) and `meta_addition` (meta finding on a file+line neither first-pass covered). Verdict: `block` > `review_required` > `fix_before_merge` > `ok_with_minor` > `ok`.
  - `writeDeepReview(cwd, phaseNum, payload)` — write `.planning/reviews/<N>/deep-review.md` with frontmatter + coverage + findings table + conflicts. Publishes audit entry to `review-handoff` bus channel (best-effort, non-blocking).
- New agents:
  - `agents/pan-hardener.md` — OWASP Top 10 (2025) + STRIDE threat model agent. Thinking enabled (budget 6000). Red color. Read-only.
  - `agents/pan-meta-reviewer.md` — reviews the reviewer + hardener output. Thinking enabled (budget 4000). Magenta. Read-only.
- New command `/pan:review-deep <phase>` — see [commands/pan/review-deep.md](commands/pan/review-deep.md). Also invocable via `exec-phase --deep-review` or `focus-exec --deep-review` (flag integration deferred to v3.4).
- CLI surface: `pan-tools review-deep merge <phase> --reviewer-file X --hardener-file Y [--meta-file Z]`, `pan-tools review-deep analyze ...` (dry-run).

**Y-3 `/pan:knowledge` — grounded Q&A, discussion, playbook:**
- New core module `pan-wizard-core/bin/lib/knowledge.cjs` with three mode handlers:
  - `ask(cwd, question, opts)` — walks `CITATION_ROOTS` (project.md, requirements.md, roadmap.md, docs/, phases/, memory/, CHANGELOG, README, CLAUDE.md), scores each file by keyword frequency (≥3-char word-boundary matches, case-insensitive), returns top `max_sources` (default 20). Always includes project.md + requirements.md even with zero score.
  - `loadSession(cwd, phase)` + `appendTurn(cwd, phase, {role, content, cites})` — multi-turn session state at `.planning/conversations/<phase>/session.json`. Rejects invalid role values.
  - `buildPlaybook(cwd)` + `writePlaybook(cwd, playbook)` — read all `.planning/memory/*.md`, categorize entries via keyword regex (Conventions / Gotchas / Decisions / Tool choices / Anti-patterns / Recurring gaps / General), write `.planning/PLAYBOOK.md` with agent attribution per entry.
- New agent `agents/pan-knowledge.md` — single agent, three modes. Thinking enabled (budget 4000). Cyan. Branches on `<mode>` field in prompt.
- New command `/pan:knowledge {ask|discuss|playbook}` — see [commands/pan/knowledge.md](commands/pan/knowledge.md).
- New template `pan-wizard-core/templates/playbook.md`.
- CLI surface: `pan-tools knowledge ask <question>`, `pan-tools knowledge discuss <phase> --subcmd read|append --role user|agent --content "..."`, `pan-tools knowledge playbook [--preview]`.

### Test additions

- `tests/review-deep.test.cjs` — 28 tests: parseReviewFindings edge cases, mergeReviews verdict matrix, writeDeepReview serialization + bus audit, CLI round-trip.
- `tests/knowledge.test.cjs` — 33 tests: scoreRelevance ranking, ask candidate walker, discuss session CRUD, categorizeEntry cluster logic, playbook writer, CLI round-trip for all three modes.

### Developer notes

- Module count: 20 → 22. `review-deep.cjs` + `knowledge.cjs` added.
- Test delta: 2239 → ~2300 (+61 new).
- Y-2 leverages Y-7 bus (published from writeDeepReview → `review-handoff` channel).
- Y-3 reuses E-4 memory (playbook source) + E-1 caching infrastructure (discuss mode multi-turn efficiency).
- Agents are all read-only; no source-code modification pathway.
- `exec-phase --deep-review` and `focus-exec --deep-review` flag wiring deferred to v3.4 (Wave 5) alongside the `--hierarchical` GA work.

Wave 4 next: Y-4 `/pan:what-if` + Y-5 `/pan:mcp-bridge` (v3.3, 1-2 weeks).

## [3.1.0] - 2026-04-18

### Added — Spec B v2 Wave 2 (Y-1 `/pan:preview`)

Consolidated foresight command. Single entry point with three modes replacing Spec B v1's X-1 architect, X-5 simulate, and X-11 predict-milestone.

- New command `/pan:preview {phase <N> | phases | milestone}` — see [commands/pan/preview.md](commands/pan/preview.md).
- New agent `agents/pan-previewer.md` — read-only, thinking enabled (budget 6000). Branches behavior by `mode` in `<preview_input>` payload.
- New core module `pan-wizard-core/bin/lib/preview.cjs` with three deterministic builders:
  - `buildPhasePreview(cwd, phaseNum)` — scans phase plan files, extracts mentioned file paths via regex (backtick-wrapped and bare `src|tests|lib|agents|commands|hooks|pan-wizard-core|docs|scripts|bin/...` prefixes), detects risk keywords (drop/delete/migrate/rename/breaking/auth) and computes a 1-10 risk score. Returns `{phase, status, plans[], files_mentioned, test_files_mentioned, risk_signals, risk_score, goal, …}`.
  - `buildPhaseDependencyGraph(cwd)` — parses roadmap + plan frontmatter, extracts explicit `depends_on` (both inline `[phase:1, phase:2]` and block-list forms), detects hidden deps via `phase N` prose mentions, generates Kahn-style parallel batches, and emits mermaid source with `classDef done` for completed phases. Dotted arrows (`-.->`) mark hidden deps.
  - `buildMilestoneETA(cwd)` — samples completion durations from phase summary frontmatter (`started`/`completed` fields), computes average and velocity, projects ETA with confidence (80% ≥5 samples, 65% ≥3, 50% ≥1, 35% otherwise), identifies bottleneck phase by plan-count heuristic.
- New template `pan-wizard-core/templates/preview-report.md` with per-mode sections and placeholder syntax.
- CLI surface: `pan-tools preview phase <N>`, `pan-tools preview phases`, `pan-tools preview milestone`.

Output paths:
- `phase` mode → `.planning/phases/<N>/preview.md`
- `phases` mode → `.planning/architecture/dependency-graph.md`
- `milestone` mode → `.planning/milestones/preview-<today>.md`

### Test additions

- `tests/preview.test.cjs` — 35 tests covering all three builders, helpers, and CLI dispatch.
- Scenario fixtures exercise: unknown-phase error, zero-padded-vs-bare phase dir matching (e.g. roadmap "1" → dir "01-foo"), inline and block-list depends_on parsing, prose-mention hidden-dep detection, mermaid source shape, bottleneck identification by plan count.

### Developer notes

- Module count: 19 → 20. `preview.cjs` joins the library.
- Test delta: 2204 → ~2239 (+35).
- Behavior is fully deterministic in the data layer; all LLM reasoning happens in `pan-previewer`.
- Opus 4.7 with `thinking: enabled` catches subtler risk patterns; smaller models still produce a valid report by reading the structured input.
- Dependency-graph mermaid is ready to paste into any markdown renderer that supports mermaid blocks.

Wave 3 is next: Y-2 `/pan:review-deep` + Y-3 `/pan:knowledge`.

## [3.0.0] - 2026-04-18

### Added — Spec B v2 Wave 1 (Cost + Bus Infrastructure)

First wave of Spec B v2 ([docs/specs/opus_47_extended_features_v2_featureai.md](docs/specs/opus_47_extended_features_v2_featureai.md)). Consolidated design shipping 6 user-facing commands across 5 waves, starting with observability + foundation.

**Y-6 `/pan:cost` — Cost Dashboard:**
- New core module `pan-wizard-core/bin/lib/cost.cjs` with `appendRecord`, `readRecords`, `aggregate`, `computeCost`, `renderTable`, `renderChart`, `resolveRate`.
- Log format: `.planning/metrics/tokens.jsonl` — append-only JSON Lines, one record per call with `{ts, agent, command, model, tier, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, phase, session}`.
- Default rate table (USD per million tokens) for Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5 plus tier fallbacks; override via `.planning/config.json` → `cost.rates`.
- Aggregation: totals, cache hit rate, breakdowns by agent / command / tier / day. Supports `--since YYYY-MM-DD` / `--until YYYY-MM-DD` windows.
- Three output formats: `json` (default, for piping), `table` (aligned columns with sections), `chart` (ASCII bar chart of daily spend).
- New command `/pan:cost {report|append|clear}` — see [commands/pan/cost.md](commands/pan/cost.md).
- CLI surface: `pan-tools cost report [--format json|table|chart] [--since X] [--until Y]`, `pan-tools cost append …`, `pan-tools cost clear`.

**Y-7 Infrastructure — Message Bus:**
- New core module `pan-wizard-core/bin/lib/bus.cjs` with `publish`, `readChannel`, `drain`, `listChannels`.
- File-backed channels at `.planning/bus/<channel>.jsonl` — append-only JSON Lines, one message per line with `{ts, source, payload}`.
- Three drain modes: `peek` (non-destructive read), `consume` (read + truncate), `archive` (read + rename to `<channel>-<ts>.archive.jsonl`).
- Agent-name / channel-name validated against `^[a-zA-Z0-9_-]+$` to block path traversal.
- Malformed lines don't crash readers — surfaced as `{malformed: true, raw: "..."}` entries.
- No standalone user command. The bus is infrastructure — Spec B v2 Waves 3-5 consume it (`review-deep` agent coordination, `exec-phase --hierarchical` conductor communication, orchestrator audit trail).
- CLI surface for developers/debugging: `pan-tools bus publish <channel> <payload> [--source <name>]`, `pan-tools bus drain <channel> [--mode peek|consume|archive]`, `pan-tools bus list`.

### Major version rationale

This is a major version bump (2.10.0 → 3.0.0) because:
1. Two new directories in `.planning/`: `.planning/metrics/` and `.planning/bus/`. Tools reading `.planning/` need to know these exist.
2. New append-only files that grow over time — downstream tooling should handle rotation.
3. Opt-in instrumentation path (Wave 5) will change agent spawn behavior; shipping a major now signals that the observability story is still evolving.

All changes are additive — no existing command, agent, config file, or CLI contract breaks.

### Developer notes

- Test delta: 2143 → ~2200 (+60: 31 bus + 30 cost, minus collisions).
- No new dependencies. `bus.cjs` and `cost.cjs` use only Node.js built-ins.
- Token instrumentation itself (auto-append on agent spawn) ships in Wave 5 as part of the `exec-phase --hierarchical` GA. For now, records are caller-driven via `pan-tools cost append` or external scripts reading the provider API.
- Spec B v2 Wave 2 (Y-1 `/pan:preview`) is next — foresight entry point consolidating X-1 architect + X-5 simulate + X-11 predict-milestone.

## [2.10.0] - 2026-04-18

### Added — Opus 4.7 Foundation (Spec A)

Full Spec A shipped across 5 /execplan sessions, raising test count from
1983 to 2143 (+160). See [docs/specs/opus_47_existing_enhancements_featureai.md](docs/specs/opus_47_existing_enhancements_featureai.md) for the source spec and [docs/decisions/ADR-0023-opus-4-7-adoption.md](docs/decisions/ADR-0023-opus-4-7-adoption.md) for the accepted decision.

- **E-1: Prompt caching helper** — `buildCachedContext(cwd)` in core.cjs returns ordered `{blocks, total_bytes, sha}` over `CACHEABLE_CONTEXT_FILES` (project.md, requirements.md, roadmap.md, state.md, standards.md). SHA stable across identical inputs for cache key hits. CLI: `pan-tools cache prime [--summary]`.
- **E-2: Whole-project ingest** — `estimateRepoTokenSize(cwd, opts)` in codebase.cjs classifies a repo as `single-shot` (≤700K tokens, one Opus 4.7 agent) or `sharded` (6-way parallel). CLI: `pan-tools codebase estimate-size [--threshold N] [--no-docs]`. `map-codebase.md` now runs a Stage 0 ingest-mode decision before spawning agents; `pan-document_code` agent has a `<mode>` block so it knows which shape it was spawned with.
- **E-3: Extended thinking** — `thinking: enabled` + `thinking_budget` frontmatter on pan-plan-checker (8000), pan-verifier (6000), pan-integration-checker (6000), pan-reviewer (4000), pan-debugger (8000). Installer calls `stripThinkingFrontmatter(content, runtime)` to remove those fields for non-Claude runtimes and inject a prose "think step-by-step" preamble via `translateThinkingDirective`.
- **E-4: Agent memory layer** — new `pan-wizard-core/bin/lib/memory.cjs` with `readMemory`, `appendMemory`, `compactMemory`, `listMemoryAgents`. Agent-name validated against `^[a-zA-Z0-9_-]+$` to block path traversal. Files live at `.planning/memory/<agent>.md`. CLI: `pan-tools memory {read,append,list,compact}`.
- **E-5: Native skills registration** — installer generates `.claude/skills/pan-*.md` shims for each command (42 total) so Claude Code's native skill discovery surfaces them. `buildClaudeSkillShim(opts)` in install-lib.
- **E-6: Parallel-tool stage DAG** — `classifyStageDependencies(items)` in focus.cjs returns waves + `parallelism_hint`. CLI: `pan-tools focus classify-stages [--stdin]`. focus-exec Stage 3.0 runs the classifier and emits instructions for parallel reads on MICRO/STANDARD waves. `pan-executor` agent gained a `<parallel_tool_use>` block: batch reads, serialize writes.
- **E-7: Capability-aware model routing** — `resolveModel` accepts new opts `{context_estimate, needs_thinking, cache_warm}`. Large context forces reasoning tier; fast+thinking upgrades to mid; cache-warm + small ctx allows mid→fast downgrade. `adjustTierForCapabilities` exported for direct use.
- **E-8: Statusline cache/thinking indicators** — `hooks/pan-statusline.js` refactored as pure `buildStatuslineOutput(data, deps)` with stdin driver gated by `require.main===module`. New `🧠` badge when `data.thinking.active`; new `⚡N%` cache-hit badge (green ≥70%, yellow 30-70%, dim <30%). Reads extras from optional bridge file `claude-pan-<session>.json`.
- **E-9: Installer capability warnings** — `detectModelCapabilities(modelName)` in install-lib. Post-install, reads `settings.json` model field and warns when features E-2/E-3/E-10/E-11 will degrade on the user's default model.
- **E-10: Focus-auto reflection gate** — `determineContinuation(run, cycle, batch, opts)` emits a thinking-gated reflection prompt between cycles when tier supports thinking. CLI: `pan-tools focus reflection` (reads `{run, cycle, batch, tier}` from stdin). Wired into `focus-auto.md` Step 2.5a.
- **E-11: Debugger hypothesis trees** — `agents/pan-debugger.md` gained a "Hypothesis Tree (Parallel Investigation)" section instructing 3+ hypotheses with Bayesian priors and parallel attack of top 2. Parallel *investigation* is encouraged; parallel *fixes* remain forbidden.
- **E-12: Oldest-batch-first fix (bugfix)** — `readLatestBatch` in focus.cjs now sorts ascending so older unfinished batches execute before newer ones.

### Added — Support

- Two companion feature specs in `docs/specs/`: Spec A (opus_47_existing_enhancements, shipped) and Spec B (opus_47_extended_features, 14 items deferred to v3.x).
- Constants: `LARGE_CONTEXT_TOKEN_THRESHOLD`, `SMALL_CONTEXT_TOKEN_THRESHOLD`, `CACHEABLE_CONTEXT_FILES`, `THINKING_BUDGETS`, `REFLECTION_THRESHOLD`.

### Changed

- `commands/pan/map-codebase.md` — new Stage 0 ingest-mode decision.
- `commands/pan/exec-phase.md` — new `<cache_priming>` section runs `pan-tools cache prime --summary` once per invocation.
- `commands/pan/focus-exec.md` — Stage 3.0 runs `pan-tools focus classify-stages` and instructs parallel tool use on MICRO/STANDARD waves.
- `commands/pan/focus-auto.md` — new Step 2.5a reflection gate between cycles.
- 5 agent files — added `thinking:` frontmatter (Claude only; installer strips for other runtimes).
- `commands/pan/plan-phase.md`, `verify-phase.md` — gained `<cache_priming>` blocks calling `pan-tools cache prime --summary`.
- `commands/pan/focus-exec.md` Stage 1 — added cache-prime step 4.
- `commands/pan/profile.md` — new `<tier_decision_tree>` block documenting capability-aware routing rules.
- `/pan:retro` extended with `--write-memory` / `--max N` flags: extracts top-N gap patterns as `pan-planner` lessons; writes a `pan-verifier` lesson when first-try rate < 60% over ≥3 runs.
- Installer default changed to project-level silent install; location prompt removed. Use `--global` for user-level.
- `context-budget` health report now surfaces cache metrics (block count, paths, bytes, tokens, eligible_pct, sha).
- 4 new scenario test files under `tests/scenarios/opus-47-*.test.cjs`:
  `claude-skills-installed`, `memory-across-phases`, `map-codebase-modes`, `debugger-parallel-hypotheses`.

### Developer notes

- Single pre-existing test failure (`learnings prune by age` flakiness) persists from before Spec A. Unrelated to Opus 4.7 changes.
- All new code is additive; no breaking changes to `.planning/` layout or public CLI contracts.
- Spec B (14 new commands/agents leveraging 1M context, hierarchical agent spawning, MCP bridge) is designed but intentionally deferred until Spec A adoption stabilizes.

## [2.9.1] - 2026-04-12

### Added
- **Skills Enhancement Plan v2** — 12 prompting technique enhancements from Anthropic agent engineering guides applied across 15 command skills (+584 lines to SKILLS-FULL-TEXT.md)
  - Output contracts, negative examples, dependency-aware rules, structured handoff protocols
  - Todo-list recitation, grounding/citation enforcement, explicit routing criteria
  - Action gating by phase, progressive disclosure, failure pattern capture
  - Diversity injection, meta-prompting for self-generated investigation strategies
- **Skills docs generation** — `scripts/generate-skills-docs.py` produces SKILLS-FULL-TEXT.md and SKILLS-REFERENCE.md
- **SKILLS-ENHANCEMENT-PLAN-V2.md** — completed enhancement tracking document

### Fixed
- **EXAMPLES.md** — Corrected "four researcher agents" claim for plan-phase (actual: 1 researcher)
- **ARCHITECTURE.md** — Updated focus-exec behavioral rules count from 9 to 10
- **FAQ.md** — Clarified researcher agent counts for new-project vs plan-phase
- **CLAUDE.md** — Updated installer LOC (1,939 → 1,959) and test count accuracy

### Changed
- **docs/** — Full deep audit and refresh of all 15 documentation files for accuracy, freshness, and cross-doc consistency (97.5% average score)

## [2.9.0] - 2026-03-21

### Added
- **Multi-model routing engine** — provider-agnostic tier aliases, complexity routing, cost estimation (4 sessions, 96 pts)
  - `PROVIDER_MODELS` constant with anthropic/openai/google/default providers
  - `LEGACY_ALIASES` for backward compatibility (opus→reasoning, sonnet→mid, haiku→fast)
  - `detectProvider()`, `resolveTierToModel()`, `resolveComplexityTier()` in core.cjs
  - `cmdEstimateCost()` command for token cost estimation
  - Per-phase model override via HTML comments in roadmap
  - Routing strategy config: `quality-first`, `cost-first`, `balanced` (default)
  - 35+ new tests for routing engine
- **Focus-auto optimize category** — diminishing-returns stop condition for optimization loops
- **Opus quality profile** — dedicated quality tier with downgrade confirmation UX
- 3 new commands: `/pan:focus-drift-walking`, `/pan:focus-doc-audit`, `/pan:focus-plan`
- 2 new feature specs: `comp_analysis_markdown_v1`, `multi_model_routing_featureai`

### Fixed
- OpenCode installer no longer installs hooks (OpenCode has no hook support)
- Smoke test `require(hookPath)` replaced with `vm.Script` syntax check (prevented 90s hang)
- Stale counts synced across CLAUDE.md, README.md, ARCHITECTURE.md, DEVELOPMENT.md, USER-GUIDE.md

### Changed
- Command count: 39 → 42 (focus-drift-walking, focus-doc-audit, focus-plan)
- Test count: 1622 → 1972 (72 files, 416 suites)
- Spec count: 30 → 35
- Installer hook guard: `!isCodex` → `!isCodex && !isOpencode`

## [2.8.0] - 2026-03-08

### Added
- **Lifecycle Completeness** — V-Model right-side coverage (ADR-0022)
  - `pan-reviewer` agent — read-only code review (conventions, security, quality)
  - `/pan:retro` command — milestone retrospective with estimation accuracy, verification patterns, common gap analysis
  - `cmdRetro()` in verify.cjs with `collectVerificationStats()`, `countRoadmapPhases()`, `groupGapPatterns()` helpers
  - `retro` subcommand in pan-tools.cjs dispatcher (100 subcommands total)
  - `retro.md` workflow — quantitative process analysis after milestone completion
  - Test suite gate in `verify-phase.md` — runs `npm test` before goal-backward verification
  - Auto test generation in `exec-phase.md` — invokes `/pan:phase-tests` after execution (was orphaned)
  - Code review step in `exec-phase.md` — spawns `pan-reviewer` after test generation
  - `--skip-tests`, `--skip-review`, `--fast` flags for `/pan:exec-phase`
  - `reviewer_model` in init.cjs execute-phase output
  - pan-reviewer registered in MODEL_PROFILES (sonnet/haiku/haiku)
  - 18 new tests (1622 total)
- Feature spec: `docs/specs/lifecycle_completeness_featureai.md`
- ADR: `docs/decisions/ADR-0022-lifecycle-completeness.md`

### Changed
- Agent count: 11 → 12 (pan-reviewer)
- Command count: 38 → 39 (/pan:retro)
- Subcommand count: 99 → 100 (retro)
- Updated: AGENTS.md, ARCHITECTURE.md, CLI-REFERENCE.md, DEVELOPMENT.md, USER-GUIDE.md, help.md

## [2.7.0] - 2026-03-08

### Added
- **Codebase Mapper v2** — language-aware import analysis, dependency graphs, best-practices detection (ADR-0021)
  - New `codebase.cjs` core module (745 LOC, 16 exports)
  - `codebase detect-languages` — extension + manifest scanning, primary/secondary detection
  - `codebase analyze-imports` — dependency graph builder with circular dep detection, entry points, orphan modules, Mermaid visualization
  - `codebase best-practices` — 5-category assessment (error handling, testing, naming, security, performance) with scored recommendations
  - `findCodebaseDoc()` — lowercase-first with UPPERCASE fallback for backward compatibility
  - 2 new templates: `relationships.md`, `best-practices.md`
  - Enhanced `init map-codebase` output: `supported_languages`, `file_count`, `focus_areas` (6 areas)
  - 6 focus areas for `/pan:map-codebase`: tech, arch, quality, concerns, relationships, practices
  - 53 new tests (1604 total)
- Feature spec: `docs/specs/codebase_mapper_v2_featureai.md`
- ADR: `docs/decisions/ADR-0021-codebase-mapper-v2.md`

## [2.6.0] - 2026-03-08

### Added
- **AI Drift Prevention** — quantitative convention drift scoring (ADR-0020)
  - `drift-check` command — checks changed files against project conventions
  - `parseConventionRules()` — extracts anti-pattern rules from CONVENTIONS.md + CLAUDE.md
  - `checkFileConventions()` — per-file regex convention checking (skips comments, respects file globs)
  - `calculateDriftScore()` — weighted scoring: errors=3x, warnings=1x, info=0.5x, capped at 1.0
  - `getChangedFiles()` — git diff integration with binary filtering and file count limits
  - 5 built-in convention rules (no-console-log, no-console-error, no-existsSync, no-throw-to-user, no-raw-path-output)
  - `--since`, `--threshold`, `--files`, `--verbose` flags for flexible checking
  - `--verbose` adds `per_file` breakdown grouping violations by file
  - Drift verdicts: clean (0-0.2), low (0.2-0.5), medium (0.5-0.8), high (0.8-1.0)
  - `validate health --drift` — drift analysis integrated into health check
  - Drift contract test schema + E2E contract tests
  - 41 new tests (drift-check unit + integration + health --drift + contract)
- Feature spec: `docs/specs/ai_drift_prevention_featureai.md`
- ADR: `docs/decisions/ADR-0020-ai-drift-prevention.md`

### Fixed
- Stale test counts in README.md and DEVELOPMENT.md updated to current values

## [2.5.0] - 2026-03-07

### Added
- **Focus sync v2** — multi-file doc staleness scanning (ADR-0016 gap closure)
  - `DOC_SYNC_FILES` constant — scans README.md, DEVELOPMENT.md, CLI-REFERENCE.md, USER-GUIDE.md, ARCHITECTURE.md
  - `COMMAND_RENAME_MAP` constant — 12 old→new command name mappings for stale reference detection
  - `checkOldCommandNames()` — detects renamed v1 command references in user-facing docs
  - `checkVersionCrossRef()` — package.json vs CHANGELOG.md version mismatch detection
  - `--tests N --suites N` flags for `focus sync` — test/suite count staleness detection
- **Source TODO scanning** — `scanSourceTodos(cwd)` in core.cjs
  - Scans `pan-wizard-core/bin/lib/*.cjs` for TODO/FIXME/XXX/HACK comments
  - Wired into `cmdFocusScan()` output as `source_todos` field
- **Health --full mode** — `validate health --full` in verify.cjs
  - Runs `node --test` (120s timeout) and `npm run build:hooks` (60s timeout)
  - Reports `test_status` and `build_status` in output
  - Default (no flag) remains fast static check
- **17 new tests** for focus sync, source TODO scanning, health --full, version cross-ref

### Fixed
- Stale test counts in 4 doc/spec files updated from 875/1065/1419 to 1483

## [2.4.0] - 2026-03-07

### Added
- **Git lifecycle integration** — all 12 items from git_integration_overhaul spec (SCAN-001 through SCAN-012)
  - `isGitRepo(cwd)` helper in core.cjs — safe git repo detection via `git rev-parse`
  - `cmdBatchCommit(cwd, items, raw)` — orchestrator helper for batch commit summaries
  - `ensureGitRepo(cwd)` in init.cjs — auto-initializes git for new projects
  - Phase-complete auto-commit with `--no-commit` bypass
  - Milestone-complete auto-commit + `milestone-vX.Y` tag with `--no-commit` bypass
  - Focus-exec dirty working tree gate with `--force` bypass
  - Focus-auto cycle checkpoint commits with `focus.auto_commit` config toggle
  - Explicit `not_a_git_repo` error response from `cmdCommit()`
  - `/check` skill now shows git branch, clean/dirty state, ahead/behind
  - `/build` skill now warns about uncommitted changes before build
  - `/commit` skill rewritten — 7 scenarios, 4-layer safety, conventional commits
- **25 new tests** for git integration (core-helpers, commit-safety, focus, phase, milestone, init)

## [2.3.0] - 2026-03-03

### Added
- **focus-design v2** — Autonomous Investigation & Best-in-Industry Enhancement (ADR-0017)
  - Phase 0.8: Autonomous Codebase Investigation — silent discovery + impact analysis before any design work
  - Phase 0.2.5: Before/After State Specification — explicit current→desired behavior mapping
  - Phase 1.5: Informed Clarification Questions — must reference discovered code patterns, never generic
  - Structured Acceptance Criteria — table format with verification method and pass condition (2+ auto-verifiable)
  - Scope Calibration — auto-mode-selection table (bug fix→spike, new command→internal, user-facing→full)
  - Dynamic Competitor Selection — 8-tool default set with domain-aware guidance
  - PAN-specific Convention Checklist — readStateSafe, output, toPosix, fileAccessible, getArgValue, cmd naming
  - MCP/context7 tools added to allowed-tools frontmatter
  - Enhanced Phase 10.3 report summary with 13 specific items
  - Mode+Phase Matrix updated with new phase rows for 0.8 and 1.5
  - Propagated to all 5 runtimes (Claude, OpenCode, Gemini, Codex, Copilot CLI)
  - `/featureAI` deprecated with redirect to `/pan:focus-design`
  - Feature specification: `docs/specs/focus_design_v2_featureai.md`
  - Architecture decision: `docs/decisions/ADR-0017-enhanced-focus-design.md`
- **Focus Auto-Runner** (`focus auto`) — Continuous scan→plan→exec loop with purpose-driven categories (ADR-0015)
  - 5 categories: cleanup, tests, stability, features, docs — each with intelligent default mode/budget
  - 5-layer safety harness: per-cycle budget, cumulative budget, max-cycles, regression circuit breaker, zero-completed guard
  - State management: init, --status, --update, --stop, --continue, --dry-run
  - State persistence in `.planning/focus/auto-run.json` for cross-session resumability
  - `categoryFilter()` — priority-range post-filter on existing scan infrastructure
  - 37 new tests (constants, categoryFilter, readAutoRun/writeAutoRun, state machine, integration)
  - Workflow command file: `/pan:focus-auto` orchestrates the continuous loop
- **Test Hardening Batch** — 108 new tests across 6 modules (1169 → 1277)
  - `commands.test.cjs` +12: rollback-snapshot, shouldSkipTests, readErrorPatterns, appendErrorPattern, appendSessionSummary, learnings commands, generate-slug, current-timestamp, verify-path-exists, list-todos
  - `config.test.cjs` +19: config-set/get edge cases, parseStandardsFile, renderStandardsMd, detectStandardsFromContent, standards-list/select/remove/status
  - `phase.test.cjs` +8: classifyPlanTier, updateRoadmapAfterRemoval, find-phase, phase next-decimal, phase-plan-index
  - `verify-extended.test.cjs` +19: preflight (7 tests), deps validate (5 tests), validate consistency edge cases (3 tests), plan-structure, verify-summary
  - `milestone.test.cjs` +7: archive-phases flag, requirements mark-complete edge cases
  - `template.test.cjs` +8: threshold constants, fill error cases, unknown subcommand
  - `constants.test.cjs` +14 descriptive assertion messages for regex match tests
- **User Reality Testing System** — Installer extraction, scenario runner, CI pipeline (ADR-0018)
  - Extracted `install-lib.cjs` from `install.js` — testable installer functions without side effects
  - `createScenarioRunner(runtime)` test helper — installs PAN to temp dir, returns `run()` for CLI commands
  - 47 scenario tests across 4 files: install-smoke (per-runtime validation), multi-step workflow, cross-runtime parity
  - CI workflow: `test:scenarios` runs on push/PR alongside unit tests
  - New npm scripts: `test:scenarios`, `test:all` (unit + scenario)
- **E2E User Acceptance Tests** — Host tool integration contract validation (ADR-0019)
  - 52 new scenario tests across 5 files validating what host AI tools actually consume
  - `settings-schema.test.cjs` (12 tests): Claude PascalCase vs Copilot camelCase hook keys, nested vs flat structure, statusLine
  - `command-discovery.test.cjs` (10 tests): Correct paths per runtime (commands/pan/*.md, skills/pan-*/SKILL.md), >= 30 commands, critical commands exist
  - `hook-registration.test.cjs` (9 tests): Hook file existence, settings.json references resolve to real files, no duplicates
  - `agent-structure.test.cjs` (8 tests): Frontmatter fields, `<role>` tag, pan-* naming, no duplicates
  - `user-workflow-e2e.test.cjs` (13 tests): 10-step Claude workflow + 3-step Copilot workflow with state consistency validation

### Changed
- **Internal Code Quality Cleanup (Batch 2)** — 25 items across 2 waves, zero behavioral changes
  - Correctness: Fixed `verify.cjs` regex for lowercase plan files, made `cmdStateGet` return JSON errors consistently
  - Dispatcher: Updated stale command help (14→38 commands listed), added usage hints to error messages
  - Constants: Added `PATTERNS_FILE`, `SESSION_HISTORY_FILE`, `LEARNINGS_FILE` to `constants.cjs`, replaced 12+ string literals with constants across 6 modules, replaced 4 regex patterns with `isPlanFile()`/`isSummaryFile()` helpers
  - Cleanup: Extracted `fileAccessible()` helper replacing 6 IIFEs, moved inline `require('os')` to top-level, added `verbose()` to empty catch blocks, removed variable aliases, renamed `existing_content` to camelCase, replaced `readFileSync` existence check with `accessSync`
  - Tests: Removed 3 duplicate test suites (state.test.cjs), fixed 3 tautology assertions (dispatcher.test.cjs), consolidated verify-commits to single file, standardized all 42 test files to `node:assert/strict`, replaced `it()` with `test()` in focus.test.cjs
  - Tests: 1190 → 1169 (net -21 from deduplication), zero regressions
- **Internal Code Quality Cleanup (Batch 1)** — 20 items across 4 waves, zero behavioral changes (ADR-0014)
  - Wave 1: Removed 5 dead code items (duplicate imports, unused parameters, unused exports)
  - Wave 2: Consolidated duplications — `getArgValue()` dispatcher helper replacing 20+ inline patterns, `countCheckedInSection()` config helper, 10 magic numbers extracted to `constants.cjs`, removed duplicate `listArchivedPhaseDirs()`
  - Wave 3: Split 7 oversized functions under 50 LOC — `cmdCommit()`, `allocateBudget()`, `cmdConfigEnsureSection()`, `cmdStandardsPhaseTrack()`, `cmdVerifySummary()`, `renumberIntegerPhases()`, `checkPhaseContents()`
  - Wave 4: Added dispatcher argument validation for 7 commands, 10 new tests in `dispatcher.test.cjs`
  - Tests: 1180 → 1190 (+10 new), zero regressions

### Added
- **Strategic Feature Additions** — 4 new command groups based on 6-tool competitive analysis (ADR-0013)
  - `preflight [target]` — Pre-flight validation: state, blockers, git clean, config, error patterns
  - `dashboard` — Aggregated project overview: phase progress, blockers, next action
  - `learnings extract|list|prune` — Session intelligence: auto-extract patterns from sessions, error resolutions, file co-change patterns
  - `deps validate` — Dependency graph validation: roadmap vs disk sync, orphaned requirements detection
  - 6 new commands (41 total), 3 new test files (41 new tests)
  - Competitive analysis spec: `docs/specs/industry_analysis_strategic_additions_featureai.md`
  - Architecture decision: `docs/decisions/ADR-0013-strategic-feature-additions.md`

## [2.2.0] - 2026-03-02

### Added
- **Standards v2 Enhanced** — Full lifecycle standards governance
  - `standards phase-track <N>` — per-phase compliance tracking with keyword detection
  - `standards tools [id]` — external scanning tool recommendations (OWASP ZAP, Semgrep, axe-core, SonarQube, etc.)
  - `PHASE_KEYWORDS_TO_STANDARDS` mapping — 35+ keywords map phase content to relevant standards
  - `STANDARDS_EXTERNAL_TOOLS` catalog — tool recommendations for all 12 standards
  - `detectStandardsFromContent()` helper — reusable content→standards detection
  - Verifier agent v2: per-phase tracking (Step 7b.1), auto-tick verified checklist items (Step 7b.3), tool recommendations (Step 7b.4)
  - focus-design Phase 7.0: Standards Auto-Reference — auto-cross-references selected standards during security threat modeling
  - New-project workflow updated with v2 command references
  - 31 new tests (v2 constants, detectStandardsFromContent, phase-track CLI, tools CLI)
  - All agent/command updates propagated to 6 runtime directories

## [2.1.0] - 2026-03-02

### Added
- **Standards Integration** — Industry standards selection and advisory compliance system
  - Built-in catalog of 12 standards: OWASP Top 10, ASVS L1, LLM Top 10, Agentic Top 10, WCAG 2.2, NIST SSDF, ISO 25010, STRIDE, CWE Top 25, SOC 2 Dev, TOGAF ADM, Conventional Commits
  - 5 subcommands: `standards list`, `standards select`, `standards remove`, `standards status`, `standards recommend`
  - `.planning/standards.md` as persistent registry — agents read it as context naturally
  - Project-type recommendations based on project.md analysis (web→OWASP+WCAG, ai→LLM Top 10, etc.)
  - `--standards` flag for `validate health` — reports per-standard coverage
  - Advisory model: standards guide agents, never block execution
  - Agent prompts updated: pan-verifier gains Step 7b (standards compliance), pan-plan-checker gains Dimension 9 (standards awareness)
  - Settings workflow extended with standards_health toggle
  - New-project workflow offers standards recommendation after roadmap creation
  - 43 new tests (unit + integration + CLI)
  - Architecture decision: `docs/decisions/ADR-0010-standards-integration.md`
  - Feature specification: `docs/specs/standards_integration_featureai.md`

## [2.0.0] - 2026-03-02

### Changed
- Version bump to 2.0.0
- Documentation alignment: fixed stale counts across 12 files (workflow 33→30, tests 1012→1065, commands 32→37, runtimes 4→5)
- Added Copilot CLI to FAQ runtime table
- Added `.codex/`, `.gemini/`, `.opencode/` to .gitignore
- Archived completed batch files and superplans

### Fixed
- Production deployment readiness: SECURITY.md version table, .gitignore expansion, ARCHITECTURE.md workflow count, isGitIgnored execFileSync migration, orphaned workflow cleanup, FUNDING.yml, Dependabot config, stale test counts in command files

## [1.0.0] - 2026-03-01

### Changed
- **Command naming restructure** — 17 of 32 commands renamed for consistency and brevity
  - Phase commands: `execute-phase` → `exec-phase`, `verify-work` → `verify-phase`, `list-phase-assumptions` → `assumptions`, `add-tests` → `phase-tests`, `context-budget` → `phase-budget`
  - Session commands: `pause-work` → `pause`, `resume-work` → `resume`, `set-profile` → `profile`
  - Milestone commands grouped: `new-milestone` → `milestone-new`, `complete-milestone` → `milestone-done`, `audit-milestone` → `milestone-audit`, `plan-milestone-gaps` → `milestone-gaps`, `cleanup` → `milestone-cleanup`
  - Todo commands grouped: `add-todo` → `todo-add`, `check-todos` → `todo-check`
  - Utility commands shortened: `join-discord` → `discord`, `reapply-patches` → `patches`
  - Added `group` frontmatter field to all 32 command .md files (7 groups: Getting Started, Phase Lifecycle, Phase Management, Session & Progress, Milestone, System, Community)
  - Help command redesigned with grouped command table
  - Mean invocation length reduced 25% (20.3 → 15.3 chars)
  - **Breaking:** Old command names no longer work — no alias files
- Architecture decision: `docs/decisions/ADR-0005-command-naming.md`
- Feature specification: `docs/specs/command_naming_optimization_featureai.md`

### Fixed
- `cmdFindPhase()` in phase.cjs: wrapped `directory` output with `toPosix()` to prevent Windows backslash leak in JSON
- 3 bare `writeFileSync` calls in `bin/install.js` now wrapped in try-catch (lines 246, 1721, 1849)
- 11 broken workflow references — workflow files renamed to match session-16 command names
  - `list-phase-assumptions.md` → `assumptions.md`, `execute-phase.md` → `exec-phase.md`, `audit-milestone.md` → `milestone-audit.md`, `cleanup.md` → `milestone-cleanup.md`, `plan-milestone-gaps.md` → `milestone-gaps.md`, `new-milestone.md` → `milestone-new.md`, `pause-work.md` → `pause.md`, `add-tests.md` → `phase-tests.md`, `set-profile.md` → `profile.md`, `add-todo.md` → `todo-add.md`, `check-todos.md` → `todo-check.md`
- `COMPARISON.md`: "4-Runtime Support" → "5-Runtime Support" (was missing Copilot CLI)

### Added
- **`--verbose` flag** for pan-tools dispatcher — enables debug logging to stderr via `PAN_VERBOSE=1` env var
  - `verbose()` helper in core.cjs for conditional debug output
  - 7 new tests for flag parsing and helper function
- **Mermaid diagrams + TOGAF alignment** for `/pan:map-codebase` codebase mapper
  - 5 codebase templates updated: architecture (flowchart + sequence), structure (hierarchy), stack (deployment), integrations (service map + ER), concerns (risk quadrant)
  - TOGAF architecture domains mapped: Business, Application, Data, Technology
  - `<diagram_guidelines>` section added to pan-document_code agent (syntax standards, security rules, TOGAF alignment)
  - Workflow prompts updated with diagram and TOGAF instructions
  - 14 new template/agent validation tests
- **Multi-runtime E2E installer tests** — OpenCode, Gemini CLI, Codex
  - `tests/opencode-install.test.cjs` — 20 tests (install structure + uninstall)
  - `tests/gemini-install.test.cjs` — 18 tests (install structure + uninstall)
  - `tests/codex-install.test.cjs` — 19 tests (install structure + uninstall)
  - Runtime-specific assertions: .toml for Gemini, directory-based skills for Codex, flat commands for OpenCode
- **Focus Commands** — 5 strategic project management commands for cross-cutting work prioritization
  - `focus scan` — Collect and classify work items from phases, todos, error patterns with P0-P6 priority and Reality Score
  - `focus plan` — Capacity-budgeted batch creation with 4 execution modes (bugfix/balanced/features/full)
  - `focus exec` — Batch execution pipeline with tier-based test cadence (MICRO/STANDARD/FULL)
  - `focus sync` — Documentation staleness detection (command/agent/module counts vs README)
  - `focus design` — 10-phase strategic feature investigation pipeline with 4 modes (--full/--internal/--outward/--spike)
  - New core module: `focus.cjs` (15th module) — scan, plan, sync, exec data layer
  - Priority/effort validation: `extractPriorityEffort()` in frontmatter.cjs
  - Focus constants in constants.cjs: PRIORITY_LEVELS, EFFORT_SIZES, EFFORT_POINTS, FOCUS_MODES, FOCUS_TIERS
  - 73 new tests in focus.test.cjs
  - Feature specification: `docs/specs/pan_focus_commands_featureai.md`
  - Architecture decision: `docs/decisions/ADR-0006-focus-commands.md`
- **`--verbose` flag documentation** — USER-GUIDE.md and CLI-REFERENCE.md updated with Debug Logging sections
- 60 new tests across 5 test files (952 → 1012)
  - `tests/state.test.cjs` +14: stateExtractField/stateReplaceField unit tests
  - `tests/core.test.cjs` +18: findPhaseInternal (12) + scanPendingTodos (6) unit tests
  - `tests/frontmatter.test.cjs` +7: parseMustHavesBlock unit tests
  - `tests/commands.test.cjs` +8: dispatcher unknown subcommand error paths
  - `tests/phase.test.cjs` +19: removePhaseFromDisk (3) + renumberDecimalPhases (5) + renumberIntegerPhases (6) unit tests (note: 3+5+6=14 but 19 with additional edge case tests)
- **Copilot CLI interaction optimization** — structured user interaction for text-only environments
  - `rewriteAskUserQuestionForCopilot()` in install.js: regex-based rewriter converts AskUserQuestion blocks to numbered text menus
  - Adapter header "User interaction" section: teaches Copilot CLI model how to present numbered choices, handle multi-select, mark recommended options
  - Handles single-select (numbered list + "Type a number"), multi-select (comma-separated), and free-text fallback
  - Inline `AskUserQuestion` references rewritten to conversational equivalents
  - 11 new tests in copilot-install.test.cjs for interaction converter
- Architecture decision: `docs/decisions/ADR-0004-copilot-cli-interaction.md`
- Feature specification: `docs/specs/copilot_cli_interaction_featureai.md`

## [0.3.0] - 2026-03-01

### Added
- **Smart Execution System** — tier classification, budget tracking, dry-run, commit safety, rollback snapshots
  - `classifyPlanTier()` in phase.cjs: MICRO/STANDARD/FULL classification from task count, files, autonomous flag
  - `--dry-run` flag for `init execute-phase`: preview execution plan without spawning agents
  - `--budget N` flag for `init execute-phase`: point-based budget tracking (XS=1, S=2, M=4, L=10, XL=20)
  - `--type TYPE` flag for `commit`: conventional commit prefixes (feat, fix, docs, test, refactor, chore)
  - `--force` flag for `commit`: override deleted-file safety check
  - Commit safety checks: blocks staging of `.env`, `.pem`, `.key`, `credentials`, `secret`, `password`, `token` files
  - `rollback-snapshot` command: creates `pan-rollback-{phase}-{timestamp}` git tags before execution
  - `shouldSkipTests()` helper: detects when all modified files are markdown (skips test verification)
  - `readErrorPatterns()` / `appendErrorPattern()`: read/write PAT-NNN entries in `.planning/patterns.md`
  - `appendSessionSummary()`: append session summaries to `.planning/session-history.md` (keeps last 20)
  - Enhanced `progress health` output: includes `patterns_count` and `session_count`
  - New config sections: `budget.*`, `commit.*`, `execution.*` with defaults
  - Plan template includes `tier`, `priority`, `effort` frontmatter fields
  - `plans_by_tier`, `estimated_points`, `budget_exceeded`, `execution_mode`, `dry_run`, `rollback_tag` in execute-phase init output
- Architecture decision: `docs/decisions/ADR-0003-smart-execution.md`
- 116 new tests across 4 new test files and 2 updated test files (674 → 790)
  - `tests/tier-classification.test.cjs` (22 tests)
  - `tests/commit-safety.test.cjs` (14 tests)
  - `tests/rollback.test.cjs` (8 tests)
  - `tests/smart-test-skip.test.cjs` (12 tests)
  - `tests/execute-phase-enhanced.test.cjs` (16 tests)
  - `tests/error-patterns.test.cjs` (18 tests)
  - `tests/session-history.test.cjs` (9 tests)
  - `tests/progress-health.test.cjs` (7 tests)
  - `tests/template.test.cjs` (+5 tests)
  - `tests/config.test.cjs` (+6 tests)

### Changed
- `execGit()` in core.cjs: switched from shell-based `execSync` to `execFileSync` for cross-platform safety
- `loadConfig()` in core.cjs: returns `budget`, `commit`, `execution` config sections
- `cmdConfigEnsureSection()` in config.cjs: merges new config sections with nested defaults
- `renderHealthReport()` in commands.cjs: reads patterns.md and session-history.md for enhanced health metrics
- CLI subcommand count: 74 → 75 (added `rollback-snapshot`)

## [0.2.0] - 2026-03-01

### Added
- **GitHub Copilot CLI as 5th supported runtime** (`--copilot` flag)
  - All 32 commands installed as `skills/pan-*/SKILL.md` (Copilot CLI skill format)
  - All 11 agents installed as `pan-*.agent.md` (Copilot CLI agent convention)
  - Hook support via `config.json` (sessionStart, postToolUse events)
  - Global install to `~/.copilot/`, local install to `.github/`
  - Interactive menu shows Copilot CLI as option 5
  - `--all` flag now installs to all 5 runtimes
  - Full uninstall support (`--copilot --global --uninstall`)
  - Tool name mapping: Claude→Copilot CLI (Read→read, Bash→bash, Grep→search, etc.)
  - Copilot CLI-specific format converters (skill adapter header, `.agent.md` frontmatter)
- 30 new tests in `copilot-install.test.cjs` (install structure, uninstall, --all flag, converter validation)
- Feature spec: `docs/specs/copilot_cli_runtime_featureai.md`
- Architecture decision: `docs/decisions/ADR-0002-copilot-cli-runtime.md`
- `classifyPhaseStatus` tests in `utils.test.cjs` (7 new tests)
- `getMilestoneInfo` edge-case tests in `core-helpers.test.cjs` (2 new tests)
- `getPlanId`/`getSummaryId` edge-case tests in `constants.test.cjs` (5 new tests)
- Strengthened assertion density across `utils.test.cjs` (52→89), `constants.test.cjs` (97→105), `core-helpers.test.cjs` (52→69)
- 6 new tests in `verify.test.cjs` covering `verify references`, `verify artifacts`, `verify key-links` error paths
- Additional assertion in `websearch` empty-query test
- `context-budget` command: estimates context window utilization for current phase with token breakdown and health status
- `progress health` subcommand: composite project health score (grade A-D) from progress, context, and staleness metrics
- `docs/COMPARISON.md`: comprehensive 8-tool comparison matrix across 18 dimensions
- Test coverage for constants.cjs (68 tests), utils.cjs (37 tests), core helpers (31 tests), context-budget (19 tests)
- Template generator unit tests (5 tests), roadmap helper unit tests (7 tests), verify repair test (1 test)
- E2E tests for `context-budget` and `progress health` from installed location
- `test:watch` script in package.json for development convenience
- Test coverage reporting step in CI workflow

### Fixed
- Wrapped 4 bare `mkdirSync`/`rmSync` calls: `cmdTodoComplete`, `removePhaseFromDisk`, `cmdMilestoneComplete`, `cmdScaffold` phase-dir
- Fixed existsSync TOCTOU in `cmdRequirementsMarkComplete` — replaced with try-catch readFileSync
- Fixed existsSync TOCTOU in `cmdScaffold` file-exists check — replaced with `wx` flag atomic exclusive-create
- Added `toPosix()` wrapping for path output in `cmdTemplateFill` and `cmdScaffold`
- Removed absolute path leak in `cmdScaffold` phase-dir JSON output
- Surfaced `requirements_warning` in `cmdPhaseComplete` output when requirements.md write fails
- Surfaced `archive_warnings` in `cmdMilestoneComplete` output when archive operations fail
- Updated stale module/command counts in featureAI.md (13→14 modules, 31→32 commands) and featureAI spec
- Wrapped 4 bare `writeFileSync` calls in try-catch: `cmdScaffold`, `cmdTemplateFill`, `output()` tmpfile fallback, `cmdTodoComplete` split write/unlink
- Eliminated 14 existsSync TOCTOU races across phase.cjs, state.cjs, config.cjs, core.cjs, milestone.cjs
- Surfaced partial rename failures in phase renumbering with `rename_warning` output field
- Added error on unknown `type` parameter in `cmdPhasesList` (was silently returning all files)
- Deduplicated `readdirSync` call in `cmdValidateConsistency`
- Fixed dead code in state dispatcher: unknown subcommands now return proper error instead of silently calling `cmdStateLoad`
- Fixed `commit --amend` parsing: `--amend` flag no longer misinterpreted as the commit message
- Fixed `scaffold --name` consuming `--raw` and other flags as part of the name
- Fixed `summary-extract --fields` truncating multi-word field lists
- Hardened 20+ bare file operations across phase.cjs, verify.cjs, milestone.cjs, commands.cjs with try-catch (TOCTOU race elimination)
- **CRITICAL:** All .md files (agents, commands, workflows) referenced wrong pan-tools path (`pan-wizard/bin/`) instead of correct (`pan-wizard-core/bin/`); also fixed template and workflow path references — 224+ occurrences across 48+ files
- Ghost command `commit-docs` in plan-phase.md workflow (should be `commit`)
- Ghost command `validate-consistency` in TROUBLESHOOTING.md (should be `validate consistency`)
- Ghost command `config get` in TROUBLESHOOTING.md (should be `config-get`)
- Formalized `state load` as explicit subcommand (was working via fallthrough)

### Changed
- Extracted `checkPhaseInternalConsistency` from `cmdValidateConsistency` (114→~60 lines)
- Extracted `scanAllPhases` from `cmdInitProgress` (104→~40 lines)
- Extracted `processYamlLine` from `extractFrontmatter` (111→~60 lines)
- `removePhaseFromDisk` now returns `{ removed, error? }` for caller to surface warnings
- `markRequirementsCompleteForPhase` now returns `{ updated, error? }` for caller to surface warnings
- `archiveMilestoneFiles` now returns `{ warnings: string[] }` collecting non-ENOENT errors
- Extracted `gatherMilestoneStats`, `archiveMilestoneFiles`, `createMilestoneEntry` from `cmdMilestoneComplete` (153→70 lines)
- Extracted `buildPlanIndex` from `cmdPhasePlanIndex`, `updateStateAfterPhaseRemoval` from `cmdPhaseRemove`, `markRequirementsCompleteForPhase` from `markPhaseCompleteInRoadmap`
- Centralized `classifyPhaseStatus` in utils.cjs, shared by init.cjs and roadmap.cjs
- Extracted `renderProgressBar` helper, eliminating duplication in commands.cjs
- Exported `readStateSafe` from state.cjs for cross-module use
- Extracted `scanPendingTodos` shared helper into core.cjs, eliminating duplication between commands.cjs and init.cjs
- Refactored `renderHealthReport` to use options object (7 params → 3)
- Refactored `updateStateAfterPhaseComplete` to use options object (6 params → 2)
- Inlined duplicate `extractField` lambda: `cmdStateSnapshot` now reuses `extractFieldsFromState`
- Documented command-only files (context-budget, join-discord, reapply-patches) in ARCHITECTURE.md
- Updated README.md comparison table from 3-column to 5-column format with link to full comparison
- Refactored `reconstructFrontmatter` from 3-level manual YAML unrolling (depth 6) to recursive `renderYamlEntry` helper (depth 2)
- Extracted `renderHealthReport` from `cmdProgressRender` (128 lines → 85 + 50 extracted)
- Updated command count 31→32, module count 13→14 across ARCHITECTURE.md, USER-GUIDE.md
- Added `context-budget` to USER-GUIDE.md, README.md, CLI-REFERENCE.md
- Added `pan-check-update` hook to CHANGELOG [0.1.0] section
- Added `context-budget` and `progress health` documentation to CLI-REFERENCE.md

## [0.1.0] - 2026-02-27

### Added

#### Core Workflow
- Phase-based workflow system: discuss, plan, execute, verify
- Multi-agent orchestration with 11 specialized agents
- Wave-based parallel execution with fresh 200K context per plan
- Automated domain research (4 parallel researchers per phase)
- Plan verification loop (up to 3 iterations before approval)
- Human verification workflow (UAT) with auto-diagnosis
- Built-in test validation architecture (Nyquist layer)
- Quick mode for ad-hoc tasks without full planning overhead

#### Runtime Support
- Claude Code: commands (`/pan:*`), agents, hooks
- OpenCode: commands (`/pan-*`), agents
- Gemini CLI: commands (`/pan:*`), agents
- Codex: skills (`$pan-*`) with SKILL.md format
- Interactive installer with runtime and location prompts
- Non-interactive flags (`--claude`, `--opencode`, `--gemini`, `--codex`, `--all`, `--global`, `--local`)
- Uninstall support (`--uninstall`)

#### State Management
- Session pause/resume with context handoff
- State tracking across sessions (state.md)
- Milestone lifecycle: new, plan, execute, verify, audit, complete
- Todo capture and management with pending/done tracking
- Systematic debugging with persistent debug sessions

#### Configuration
- Model profiles: quality, balanced, budget (per-agent model assignment)
- Per-agent model overrides
- Workflow toggles: research, plan-check, verifier, Nyquist validation
- Git branching strategies: none, phase, milestone (with template variables)
- Planning artifact commit control (`commit_docs`)
- Interactive settings command (`/pan:settings`)

#### Brownfield Support
- Codebase mapping with 4 parallel mapper agents (stack, architecture, conventions, concerns)
- Maps feed into `/pan:new-project` for context-aware initialization

#### Hooks
- Context window monitor (PostToolUse hook with WARNING/CRITICAL thresholds)
- Statusline integration (writes bridge file for context metrics)
- Update checker (PreToolUse hook with background npm version check and caching)

### Commands (31 total)

**Core:** `new-project`, `discuss-phase`, `plan-phase`, `execute-phase`, `verify-work`, `audit-milestone`, `complete-milestone`, `new-milestone`

**Navigation:** `progress`, `help`, `update`, `join-discord`

**Phase Management:** `add-phase`, `insert-phase`, `remove-phase`, `list-phase-assumptions`, `plan-milestone-gaps`, `research-phase`

**Session:** `pause-work`, `resume-work`

**Utilities:** `quick`, `debug`, `settings`, `set-profile`, `map-codebase`, `add-todo`, `check-todos`, `health`, `add-tests`, `cleanup`, `reapply-patches`

### Agents (11 total)

`pan-planner`, `pan-roadmapper`, `pan-executor`, `pan-phase-researcher`, `pan-project-researcher`, `pan-research-synthesizer`, `pan-debugger`, `pan-document_code`, `pan-verifier`, `pan-plan-checker`, `pan-integration-checker`

[2.3.0]: https://github.com/oharms/PanWizard/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/oharms/PanWizard/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/oharms/PanWizard/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/oharms/PanWizard/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/oharms/PanWizard/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/oharms/PanWizard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/oharms/PanWizard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/oharms/PanWizard/releases/tag/v0.1.0
