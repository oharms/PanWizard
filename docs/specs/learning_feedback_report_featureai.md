# Learning Feedback Report — Feature Investigation & Spec

**Date:** `2026-10-30` · **Status:** Implemented (unreleased). One change from §3.5: the hooks keep their own secret patterns (the guard's is narrower on purpose, so it does not deny a legitimate write); `redact.cjs` scans with the union, and `tests/redact.test.cjs` fails if a token shape either hook knows is missing from it. A review after landing closed a leak (a boolean `x-` key or a key inside an open section printed its user-chosen name), made the canary skip list every word the report can print and its parts (a phase named `profile` refused every report that printed `model_profile`), and hardened the intake against pasted blocks of the wrong shape or with text outside PAN's names · **Command:** `/pan:feedback` · **Engine verb:** `pan-tools feedback`

A user runs one command on their own project. PAN builds, in code, a short report of what it learned there (which gates refused and why, which judge findings the user threw away as noise, where cost forecasts missed, which commands were started and never finished, which tool errors recur) and prints it into the chat. The user reads it, then pastes it into a GitHub issue or sends it to the PAN Wizard developers. Nothing is sent automatically. The report is built so that it cannot carry the user's code, text, names, paths or secrets: it is assembled only from closed vocabularies and numbers, then scanned, and it refuses to print rather than redact when the scan finds anything it does not expect.

---

## Phase 0: Problem framing

### 0.1 Problem statement

PAN's shipped learnings (`pan-wizard-core/learnings/universal/`) come only from PAN's own experiments: `/pan:experiment` runs ideas in scratch folders on the developers' machines, and `learn promote` lifts patterns into the store by hand. What PAN learns on real customer projects never comes back. Each project keeps its own trace sessions, findings ledger, cost ledger, test-run records and guard log, and PAN's own analysis of them (`/pan:learn`, the optimizer) stays local by design: PAN has no telemetry and the FAQ promises none. The only return path today is the GitHub bug template, which asks the user to paste "the relevant output (redact any private project names/paths)" by hand. That gets few reports, and the ones it gets are free text that is hard to aggregate and easy to over-share. The developers need structured, comparable signals from the field (which gate codes fire most, which reviewer finding classes users dismiss as noise, how far forecasts miss, which tool errors recur) without asking users to trust a hand redaction. Why now: 3.36.0 and 3.37.0 added the sources that make such a report worth reading (phase gate codes, learned suppressions, the cost forecast, `pan-tools usage`, test-run records, the guard log), and the local-first CI and autopilot work means the developers now have a repeatable intake path (`harness/autopilot/state/inbox.md`, the ideas ledger).

### 0.2 Scope

| In scope | Out of scope |
|---|---|
| `/pan:feedback` command (all 5 runtimes) that prints a report in the chat | Any automatic sending, network call, telemetry or background upload |
| `pan-tools feedback` engine verb that builds the report deterministically from local files | Letting a model write or summarise the report body (it would paraphrase the user's text into it) |
| An allowlist schema: every value is a number, a boolean, a semver, or a member of a closed vocabulary | Source code, file contents, diffs, plan or summary text, prompts, finding summaries, commit messages, branch names |
| A fail-closed leak scan of the rendered report | Silent redaction of free text (redaction is a best effort; refusal is a guarantee) |
| Opt-in extras: the user's own note; tool-error signatures | Opting in to raw text from the project |
| A versioned machine block (`pan-feedback v1`) the developers can parse and aggregate | A hosted collector service |
| A GitHub issue template for feedback, and a dev-only intake script that aggregates pasted reports into candidate learnings | Automatic promotion into `learnings/universal/` (stays a reviewed `learn promote`) |

### 0.3 Success criteria (measurable)

```
SC-1: /pan:feedback ships to all 5 runtimes (Claude/Gemini slash command, Codex and Copilot skills, OpenCode command) and prints the report; liveness registry and prompt-lint pass.
SC-2: Every leaf value in the report is a number, boolean, semver, ISO week, or a member of a closed vocabulary listed in the schema; a property test over generated ledgers proves it.
SC-3: A seeded project whose files contain a secret, an email, a home path, a project name, a git remote, a branch name and a phase name with the client's name produces a report that contains none of them (canary test, 12+ canaries).
SC-4: An unexpected string reaching the renderer (an out-of-vocabulary agent or category, a custom config key) is bucketed as "other" and counted, never printed; if the final scan still matches anything, the command prints a refusal with the reason and exits 1, never a partially redacted report.
SC-5: The report is under 4 KB of markdown plus its machine block, renders in under 1 second on a project with 10k ledger rows.
SC-6: A dev-only intake script parses N pasted reports and prints aggregated counts and candidate learnings; it rejects a block whose schema version or field set it does not know.
SC-7: Docs updated (CLI reference, user guide, FAQ privacy answer, SECURITY-HARDENING, CHANGELOG); no regression in the suite or gates.
```

### 0.4 User stories

```
As a PAN user, I want to give the PAN developers what PAN learned on my project,
so that the next release handles my situation better, instead of writing a bug
report by hand and wondering what I accidentally pasted.

As a PAN user at a company with strict data rules, I want to see the whole report
before it goes anywhere and know it cannot contain our code or names,
so that I can share it without a legal review, instead of not sharing at all.

As a PAN developer, I want feedback in one versioned, machine-readable shape,
so that I can count which gate codes, dismissed finding classes and tool errors
recur across users and promote real patterns into learnings/universal/,
instead of reading anecdotes.
```

---

## Phase 1: Internal reconnaissance

### 1.1 What the project already records, and what is safe to read

| Source | File | Safe structured fields | Free text (never read into the report) |
|---|---|---|---|
| Trace sessions | `.planning/optimization/traces/<sess>/trace.jsonl`, `session.json` | `type` (closed: `EVENT_TYPES`), `impact` (closed), `agent` (when `pan-*`), `category` (when in a closed list: `phase_gate_forced`, `verdict_retry`, `tool_error`, `agent_completion`, `uncached_heavy_run`, `wave_complete`, `plans_created`, `plan_check_overridden`, `phase_complete`, …), `tokens_wasted`, `ended_at` present or not | `description`, `context`, `correction`, session `description`, `command` when not a shipped command |
| Findings ledger | `.planning/findings.jsonl` | `agent`, `class` (closed: `FINDING_CLASSES`), `severity` (closed), folded `status` (closed), disposition kind, `suppressed`/`returned` counts, verdict `outcome`, `attempt`, `lowered_by` codes | `summary`, `where`, `reason`, `source`, finding ids |
| Cost ledger | `.planning/metrics/tokens.jsonl` | `agent` (when `pan-*`), `tier` (closed), token counts, `cost_usd`, suspect/empty flags | `model` ids from custom rate tables, `session`, `command` when not shipped |
| Phase gate | trace `phase_gate_forced`, `phase complete` output is not stored; `pan-tools phase gate` re-runnable | reason `code` (closed: the twelve in `phase-gate.cjs`), mode, `not_checked` check names | reason `detail` |
| Test runs | `.planning/phases/*/NN-test-run.json`, baseline | `status` (closed), counts, `source` (closed: `flag`/`config`/`package.json`/runner names), `timed_out` | `command`, `output_tail`, failing test ids |
| Mutation | `NN-mutation.json` | `sampled`, `killed`, `survived`, `score`, language family | survivor locations and diffs |
| Guard log | `.planning/guard.jsonl` | `rule` (closed: `secret_write`, `state_write`, `judge_write`, `undeclared_test_edit`), action (`report`/`deny`) | `path`, matched text |
| Tool errors | trace `tool_error` events from `pan-trace-logger.js` | `tool` (when a host tool name), `errorClass` (closed), `exitCode`, `count`, `messageSig` (a 12-char hash of the number-masked, already-redacted message) | `message` (even redacted: it is still user text) |
| Usage census | `pan-tools usage` (3.36.0) | shipped command and agent names, `calls`, `sessions`, `finished`, unfinished list | none (already closed vocabulary) |
| Config | `.planning/config.json` | known keys from `knownConfigKeys()` with boolean, number or enum values | any string value outside a key's enum, custom `cost.rates` model ids, `focus`, `build`, `verification` sections |
| Install | `pan-wizard-core/VERSION`, `pan-file-manifest.json` | PAN version, runtimes installed, local/global | install paths |
| Environment | process | `process.platform`, Node major, host CLI name when known | hostname, username, env vars |

### 1.2 Related code to reuse

- `pan-wizard-core/bin/lib/usage.cjs` (`usageCensus`, `readInventory`): the closed vocabulary of shipped commands and agents, and the used/unfinished census.
- `pan-wizard-core/bin/lib/findings.cjs` (`readLedger`, `foldFindings`): folded status without touching summaries.
- `pan-wizard-core/bin/lib/cost.cjs` (`readRecords`, `isSuspectRecord`, `isEmptyRecord`, `costForecast`, `phaseBudget`).
- `pan-wizard-core/bin/lib/optimize.cjs` (`listTraceSessions`, `EVENT_TYPES`, `IMPACT_LEVELS`).
- `pan-wizard-core/bin/lib/phase-gate.cjs` (`phaseGate`, the reason codes).
- `pan-wizard-core/bin/lib/config.cjs` (`knownConfigKeys`, `buildConfigDefaults`).
- `hooks/pan-trace-logger.js` (`redactErrorText`, `SECRET_KV_RE`, `TOKEN_RE`) and `hooks/pan-guard.js` (`hasSecret`): the patterns the leak scan reuses. They should move to one shared module (`pan-wizard-core/bin/lib/redact.cjs`) that the hooks and the new verb both require, so the two scans cannot drift.
- `scripts/test-surface.cjs`, `tests/fixtures/liveness-allowlist.json`: the new verb needs a shipped caller (the command) and the command a harness scenario.
- `.github/ISSUE_TEMPLATE/bug_report.md`: the pattern for a new `feedback.md` template.
- `optimize.cjs` `promotePattern`: where an accepted learning ends up after review.

### 1.3 Runtime compatibility

The engine verb is plain Node and runs the same under every runtime. The command is a markdown prompt the installer already converts per runtime: a slash command for Claude Code and Gemini, a skill (`pan-feedback/SKILL.md`) for Codex and Copilot, a command for OpenCode. The only runtime-specific part is the paste instructions: the command prints the same report everywhere and tells the user where to paste it, with `gh issue create` as an option where `gh` is on PATH. No hook, MCP or installer change is needed beyond the normal command and skill copy, and the manifest picks the new command up like any other.

---

## Phase 2: Competitive analysis

| Tool | How it collects field feedback | What PAN takes from it |
|---|---|---|
| VS Code, npm CLI, Homebrew | Opt-out or opt-in telemetry sent in the background | Nothing: PAN's FAQ promises no telemetry; background sending is out of scope |
| `gh` / Cargo / rustc ICE reports | A crash prints a ready-to-paste report with versions and a template link; the user files it | The shape: print, let the user read it, give a link |
| Sentry-style beforeSend scrubbing | Denylist redaction of known secret shapes before sending | Used only as the last line (the scan); a denylist alone leaks whatever it does not know |
| Differential-privacy and k-anonymity reporting (Chrome RAPPOR, Apple) | Report only aggregates and bucketed values | Bucket numbers that could fingerprint a project (cost, sizes); no per-item rows |
| Claude Code `/bug` | Collects a transcript and sends it after a confirmation | Confirmation is not enough for PAN's users: a transcript is the project. The report must be safe by construction |

Differentiation: an allowlist-built, locally rendered, fail-closed report whose machine block aggregates across users, which none of the peer workflow tools in `docs/COMPARISON.md` ship.

---

## Phase 3: Design

### 3.1 The privacy model (the core decision)

Three layers, each enough on its own for the cases it covers:

1. **Allowlist construction.** The engine never copies a string from the project into the report. It emits counts, numbers, booleans, a semver, an ISO week, and members of closed vocabularies defined in code: PAN's shipped command and agent names (from the install inventory), `FINDING_CLASSES`, `SEVERITIES`, dispositions, `EVENT_TYPES`, `IMPACT_LEVELS`, the phase-gate reason codes, guard rules, test-run statuses and sources, tool-error classes, host tool names, known config keys with their enum values. A value outside its vocabulary is counted under `other` and never printed. Phase names, file paths, branch names, model ids from custom rate tables and every free-text field are not read at all.
2. **Coarsening.** Numbers that could identify a project are bucketed: dollar amounts to 1-2-5 steps, token counts to powers of ten, durations to 1-2-5 minute steps, dates to ISO weeks, and any count under 3 reported as `<3`. Phase counts are reported, phase numbers are not.
3. **Fail-closed scan.** After rendering, the full text is scanned with the shared redaction patterns (secret key-value pairs, token shapes, Bearer headers, long mixed alphanumeric runs, URLs with query strings, email addresses, home and user paths, absolute paths, IPv4 and IPv6 addresses) plus project-specific canaries read at run time: the project directory name, the git remote host and repository name, the current branch name, the user's `git config user.name` and `user.email`, the OS username and hostname, and every phase directory slug. Any hit means the command prints a refusal naming the rule that matched (never the matched text) and exits 1. Redact-and-continue is not offered: a hit means the allowlist has a hole, which is a PAN bug to fix, and the refusal asks the user to report it with `--self-check` output (rule names only).

Opt-ins, each off by default and each still under layer 3:

- `--note "<text>"`: the user's own words, printed verbatim in a quoted block at the end, after the same scan (so a user cannot paste a token by accident either).
- `--tool-errors`: adds the tool-error table (tool, class, exit code, bucketed count, `messageSig`). The signature is a hash of the number-masked redacted message, so the developers can match the same error across users without seeing it.

There is deliberately no opt-in for code, plans, summaries, finding text or prompts: if the developers need those, that is a conversation, not a report.

### 3.2 What the report contains

Rendered as markdown in the chat, in this order, each section omitted when its source is empty:

1. **Header.** PAN version, runtimes installed, local or global, OS family, Node major, model profile, report window (default the last 90 days, `--since <ISO week>`), and the line "Built locally from counts and codes only. Nothing was sent."
2. **What PAN refused (phase gate).** Refusal counts by reason code, forced completions (`--force --reason`) count, `warn`-mode completions with failing gates, and `not_checked` reasons by check name.
3. **What the judges found and what you kept.** For each judge (`pan-verifier`, `pan-reviewer`, `pan-plan-checker`, `pan-design-checker`, `pan-hardener`): findings by class and severity, and by folded status (fixed, deferred, dismissed, decision, open). The **dismissal rate per class** is the main learning signal: a class users dismiss most of the time is noise in that judge's prompt. Learned suppressions and returns (R3) counts. Verdicts lowered by code facts (V9) by fact.
4. **What execution reported.** Executor returns by kind (complete, `DONE_WITH_CONCERNS`, checkpoint, `BLOCKED_SPEC_CONFLICT`) when the trace has them; test gate runs by status and by detected runner source; regressions against the baseline count; mutation score buckets by language family.
5. **Cost and forecast accuracy.** Spend by agent and tier (bucketed); per-phase budget `near`/`over` counts; forecast accuracy: for each phase whose forecast existed before it ran, actual spend against p10/p50/p90 as below p10, within, or above p90 (counts only).
6. **What you used.** From `pan-tools usage`: shipped commands used, never used, and started but never finished (names from the inventory only).
7. **What PAN's own guard caught.** Guard rule counts and whether each was reported or denied.
8. **Tool errors** (only with `--tool-errors`).
9. **Your note** (only with `--note`).
10. **Machine block.** The same data as a fenced `pan-feedback` JSON block with `"schema": "pan-feedback/1"`, so the developers can parse and aggregate it without reading the prose.
11. **How to share it.** "Paste this into a new issue: https://github.com/oharms/PanWizard/issues/new?template=feedback.md", or, when `gh` is on PATH, a ready `gh issue create --repo oharms/PanWizard --template feedback.md` line the user runs themselves with the report on the clipboard. The command never runs it.

### 3.3 Suggested learnings

The engine also derives candidate learnings with fixed rules (no model), printed as a short list, for example:

- "pan-reviewer `quality` findings dismissed in ≥ 60% of cases (n ≥ 10)": candidate for the reviewer's noise list.
- "Phase gate `no_verification` is the most common refusal and `workflow.verifier` is off": candidate for a settings warning.
- "Forecast above p90 in ≥ 30% of phases (n ≥ 5)": the forecast underestimates on this kind of project.
- "`test run` source `none` in every phase": no test command was detected; candidate for detection support.
- "`/pan:exec-phase` started and never finished in ≥ 3 sessions": a flow that stalls.

Each rule names its source counts, so the developers can check it. The developers decide; promotion into `learnings/universal/` stays a reviewed `pan-tools learn promote`.

### 3.4 Developer intake (not shipped)

`harness/scripts/feedback-intake.cjs` reads pasted reports (files, or GitHub issues with the `feedback` label via `gh issue view --json body` when the developer runs it), extracts each `pan-feedback/1` block, rejects any block with an unknown schema, extra fields or a field of the wrong type, keeps only PAN's names, codes and versions from the rest (so nothing a stranger pastes reaches the inbox as prose), de-duplicates by a content hash, and prints aggregated tables plus the suggested learnings that recur across at least three reports. With `--inbox` it appends to `harness/autopilot/state/inbox.md`, the same inbox the market watcher feeds, so a recurring pattern enters the ideas ledger the normal way.

### 3.5 Architecture decision

- **Code builds the report; the command only prints it.** `/pan:feedback` runs `pan-tools feedback` and shows its output verbatim, with an instruction not to paraphrase, add or remove anything. A model writing the report could quote the project into it; code cannot, because it never reads the free text.
- **New module `pan-wizard-core/bin/lib/feedback.cjs`**, reading through the existing modules' readers (no new parsing of the same files).
- **New shared `pan-wizard-core/bin/lib/redact.cjs`**, moving `redactErrorText`, `SECRET_KV_RE`, `TOKEN_RE` and `hasSecret` out of the two hooks into one module the hooks and the verb both require (the hooks are copied, not bundled, so they require it through the installed core path the hooks already resolve; if that is not workable for the hooks, `redact.cjs` is the source and `scripts/build-hooks.js` inlines it, with a drift test).
- **No installer change** beyond the new command and skill, which the existing copy and manifest handle.

### 3.6 Implementation plan

```
1. pan-wizard-core/bin/lib/redact.cjs (new) — shared secret/path/email/token patterns and scanText(text, canaries) → [{rule}]
2. hooks/pan-trace-logger.js, hooks/pan-guard.js — use redact.cjs (or build-time inline + drift test)
3. pan-wizard-core/bin/lib/feedback.cjs (new) — collect(cwd, opts) → model (closed vocabularies only), render(model) → markdown + pan-feedback/1 block, projectCanaries(cwd), scan, suggestions(model)
4. pan-wizard-core/bin/pan-tools.cjs — `feedback [--since <week>] [--note <text>] [--tool-errors] [--format md|json] [--self-check]` (lazy require); usage line and Commands: list
5. commands/pan/feedback.md (new, group: System) — run the verb, print verbatim, explain sharing, never send
6. .github/ISSUE_TEMPLATE/feedback.md (new) — label feedback, body = the pasted report
7. harness/scripts/feedback-intake.cjs (new, dev only) — parse, validate, aggregate, --inbox
8. harness/scenarios/feedback-report.json (new, tier 0) — seeded project with canaries; asserts the report prints, contains none of them, and a control plants an out-of-vocabulary leak and expects the refusal
9. tests/feedback.test.cjs, tests/redact.test.cjs, tests/feedback-intake.test.cjs (new)
10. scripts/build-help.cjs --write (help index), test-surface --write, liveness entry if needed
11. Docs: CLI-REFERENCE (verb), USER-GUIDE and README (command), FAQ ("Does PAN send my data?" now names /pan:feedback and what it never contains), SECURITY-HARDENING (the three layers), CHANGELOG
```

### 3.7 Test plan

Unit (`tests/feedback.test.cjs`, `tests/redact.test.cjs`, `tests/feedback-intake.test.cjs`), at least:

Happy path
1. A seeded project with findings, gate refusals, cost rows, test runs and a usage history renders every section with the expected counts.
2. The machine block parses as JSON, carries `schema: pan-feedback/1`, and matches the prose counts.
3. Dismissal rate per class and the suggested-learning rules fire on the thresholds and not below them (n and rate both).
4. `--format json` prints the machine block alone; `--since` limits the window.

Privacy (canaries planted in the seeded project's files and config)
5. A secret in a finding summary, a plan, a trace description and a test output tail never appears.
6. The project directory name, git remote, branch name, `user.name`, `user.email`, OS username and hostname never appear.
7. A phase slug naming a client never appears; phases appear only as counts.
8. A custom agent name, an unknown trace category and a custom config key are counted under `other`, not printed.
9. Cost and token numbers are bucketed; a count of 1 or 2 prints `<3`.
10. Property test (seeded PRNG, H7 style): random ledgers with random strings in every free-text field; no generated string of length ≥ 4 appears in the output.

Fail-closed
11. A planted out-of-vocabulary value that bypasses the bucket (a test-only seam) makes the scan refuse: exit 1, the rule named, the matched text not printed.
12. `--note` with a token is refused; with plain prose it is printed in the quote block.

Errors and edge cases
13. No `.planning/`: a clear "not a PAN project" error, exit 1.
14. Empty project: header only, "nothing recorded yet", exit 0.
15. Malformed ledger lines are counted, never fatal.
16. CRLF ledgers (parity with `tests/crlf-parity.test.cjs`).

Runtime and integration
17. The command file passes prompt-lint, ships to all five runtimes in an install-matrix tier-0 scenario, and the Codex and Copilot skills carry the same body.
18. The tier-0 harness scenario passes and its control (planted leak) turns it red.
19. The intake script rejects an unknown schema version and extra fields, de-duplicates the same report pasted twice, and aggregates three reports.

---

## Phase 4: Specification

## Feature: `/pan:feedback` — a privacy-safe learning report

### Files to create/modify

- Create `pan-wizard-core/bin/lib/feedback.cjs`, `pan-wizard-core/bin/lib/redact.cjs`, `commands/pan/feedback.md`, `.github/ISSUE_TEMPLATE/feedback.md`, `harness/scripts/feedback-intake.cjs`, `harness/scenarios/feedback-report.json` (+ seed `harness/seeds/feedback-canaries/`), `tests/feedback.test.cjs`, `tests/redact.test.cjs`, `tests/feedback-intake.test.cjs`.
- Modify `pan-wizard-core/bin/pan-tools.cjs` (verb), `hooks/pan-trace-logger.js` and `hooks/pan-guard.js` (shared patterns), `pan-wizard-core/workflows/help.md` (regenerated), `tests/fixtures/surface.json`, `tests/fixtures/module-surface.json`, docs listed below, `CLAUDE.md` counts.

### Implementation steps

1. Extract the redaction patterns into `redact.cjs` with tests proven red against a copy that misses one pattern; point both hooks at it; build the hooks and run their tests.
2. Write `feedback.cjs` `collect()` against fixture ledgers, one section at a time, each with its closed vocabulary and its bucketing, tests first.
3. Write `render()` and the `pan-feedback/1` block; then `scan()` with project canaries; then `suggestions()`.
4. Add the verb and the command; regenerate help; refresh the surface registry; add the tier-0 scenario with its leak control.
5. Add the issue template and the dev intake script.
6. Docs, CHANGELOG, counts; full suite, release gates, harness tier 0.

### Tests required

The 19 cases in §3.7, each proven red first.

### Documentation updates

- `docs/CLI-REFERENCE.md`: `feedback` verb, flags, sections, schema, exit codes, the refusal.
- `docs/USER-GUIDE.md` and `README.md`: `/pan:feedback` in the command tables; a short "Sharing what PAN learned" section.
- `docs/FAQ.md`: the "Does PAN send my data?" answer adds that `/pan:feedback` prints a report you choose to share, and lists what it never contains.
- `docs/SECURITY-HARDENING.md`: the three-layer model and the canary test.
- `CHANGELOG.md`, `CLAUDE.md` counts.

### Runtime matrix

| Runtime | Supported | Notes |
|---|---|---|
| Claude | ✅ | `/pan:feedback` slash command |
| Codex | ✅ | `$pan-feedback` skill (`.agents/skills/pan-feedback/SKILL.md`) |
| Gemini | ✅ | `/pan:feedback` command |
| OpenCode | ✅ | `/pan-feedback` command |
| GitHub Copilot | ✅ | `/pan-feedback` skill |

The report is the same on every runtime; it is built by the engine, not the host model.

---

## Phase 5: Risk assessment

| Risk | Impact | Mitigation |
|---|---|---|
| A field we treat as closed is not (an agent or category name a user can set) | High: user text in the report | Vocabularies come from code constants and the install inventory, never from the data; out-of-vocabulary values bucket to `other`; property test with random strings; fail-closed scan with project canaries |
| A combination of counts fingerprints a project | Medium | Bucketing, `<3` for small counts, no per-phase rows, ISO weeks only, no timestamps |
| The host model paraphrases or "improves" the report and adds project details | High | The command prints the engine's output verbatim and says so; the machine block is the authoritative part, and the intake script ignores the prose |
| A user pastes the report with extra context that leaks | Medium | The report ends with a reminder that anything added outside it is the user's to check; `--note` is scanned |
| The scan's false positives block legitimate reports (e.g. a 32-char hash) | Low | The engine emits no hashes except the declared `messageSig` field, which the scan knows; refusal names the rule so the bug is reportable |
| The feature reads like telemetry and erodes the "no telemetry" promise | Medium | Nothing is sent, ever; the FAQ and the command say so; there is no flag that sends |
| Hooks and verb redaction drift | Medium | One shared module, or a build-time inline with a drift test |
| Developers over-trust a handful of reports | Low | Suggested learnings need n ≥ 3 reports in intake; promotion stays a reviewed `learn promote` |
| Report becomes stale as ledgers change shape | Medium | `pan-feedback/1` is versioned; a schema change bumps it; intake rejects unknown versions |

**Sizing:** about M+M (8 points): `redact.cjs` and the hooks (S), `feedback.cjs` collect/render/scan with the privacy tests (M), command, scenario, template and intake (S), docs (S).
