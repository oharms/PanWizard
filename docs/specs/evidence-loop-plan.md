# Evidence loop — work plan (`/superplan`, 2026-09-28)

Builds [evidence_loop_featureai.md](evidence_loop_featureai.md) plus the market-ideas items that can be built on this machine. Branch `feat/evidence-loop`. Executed by `/execplan` in two sessions, back to back.

## Baseline (measured this run — reproduce, never copy)

| Metric | Value | Reproduce |
|---|---|---|
| Version | 3.31.0 | `package.json` |
| Tests | 4,657 / 4,658 pass. The one failure is the CLAUDE.md counts self-audit, which the new spec file tripped (specs on disk ≠ table) and which is fixed by the counts refresh in item G-1 | `npm run test:all` |
| Filesystem counts | see the CLAUDE.md table (the only place they live) | the snippet in CLAUDE.md |
| Open TODO/FIXME in shipped code | none actionable (historical `IMPROVEMENT-TODO` markers only) | `grep -rnE "TODO\|FIXME\|HACK" bin pan-wizard-core/bin/lib hooks` |
| Field evidence for the premise | see spec §1.1 (trace categories, failed tool calls per spawn, optimizer use) | spec §1.1 |

## Priority classes

Classes: **P0** BROKEN · **P1** WRONG · **P2** STABILITY · **P3** MISSING TESTS · **P4** FEATURE GAPS · **P5** NEW FEATURES · **P6** DOCS · **P7** POLISH.
Sizes: XS 1 · S 2 · M 4 · L 10 · XL 20.

## Items

### Evidence loop (spec items; the order below is the dependency order)

| ID | Pri | Size | Pts | Title | Files | Gate / verify |
|---|---|---|---|---|---|---|
| EL-1 | P5 | M | 4 | **Verdict contract.** `verdict.cjs` (pure): `parseVerdictBlock` (last block wins, backtick/tilde, indented fences), `validateVerdict` (required fields, vocabularies, truncation, `outcome_mismatch`), `verdictFromVerificationFrontmatter` (gaps / human_verification / unrequested), `findingId`, `recordSig`, constants. Reference `references/verdict-contract.md` with the class guide | `pan-wizard-core/bin/lib/verdict.cjs`, `pan-wizard-core/references/verdict-contract.md`, `tests/verdict.test.cjs`, `tests/fixtures/module-surface.json` | every §4.3 verdict case; module surface regenerated |
| EL-2 | P5 | S | 2 | **Judges emit the block.** The `pan-verdict` block goes at the end of the plan-checker, reviewer and design-checker return contracts (verdict words unchanged; the class/severity mapping cites the reference) | `agents/pan-plan-checker.md`, `agents/pan-reviewer.md`, `agents/pan-design-checker.md`, `tests/verdict-agents.test.cjs` | each agent's shipped example parses; the same after conversion for all five runtimes (installed via the real installer into temp dirs) |
| EL-3 | P1 | S | 2 | **Review chain, part 1.** exec-phase writes the reviewer's return verbatim to `{PHASE_DIR}/{PADDED}-review.md`; review-deep reads that path (not `.planning/phases/<N>/review.md`); `parseReviewFindings` takes a `pan-verdict` block when present. Today the reviewer half of every deep review merges as zero findings | `pan-wizard-core/workflows/exec-phase.md`, `commands/pan/review-deep.md`, `pan-wizard-core/bin/lib/review-deep.cjs`, `tests/review-deep.test.cjs`, `tests/evidence-workflows.test.cjs` | a reviewer report with a block merges its findings, and the test fails on the current parser (revert-proof); workflow drift assertions |
| EL-4 | P1 | S | 2 | **Review chain, part 2: `--deep-review` made real.** Documented since v3.4 and read nowhere. exec-phase runs the deep review after the normal review: hardener → meta-reviewer → `review-deep merge` over the persisted review.md | `pan-wizard-core/workflows/exec-phase.md`, `commands/pan/exec-phase.md` | drift test: the step exists, is gated on the flag, names the three outputs and the merge call |
| EL-5 | P5 | M | 4 | **Findings ledger + verb.** `findings.cjs`: append-only `.planning/findings.jsonl`, fold (auto-fix, exemptions, reopen, deliberate dispositions stick), `record` (idempotent by record_sig, attempts, trace events `verdict_*` / `verdict_retry`), `list`, `dispose` (reason required), `debt` (by milestone). Dispatcher arm `findings`; MCP resource `pan://findings` | `pan-wizard-core/bin/lib/findings.cjs`, `pan-wizard-core/bin/pan-tools.cjs`, `pan-wizard-core/mcp/tool-registry.cjs`, `tests/findings.test.cjs`, `tests/fixtures/surface.json`, `tests/fixtures/module-surface.json` | every §4.3 findings case; `node scripts/test-surface.cjs --check`; surface-map, dispatcher-arms and MCP resource tests green |
| EL-6 | P5 | S | 2 | **M11: unrequested work.** `verify scope <phase>` (declared `files_modified` vs changed = the phase's plan commits by subject + summary key-files; planning tree and lockfiles excluded; `test_for_declared` hint); verifier scope step + `unrequested:` frontmatter; template; reviewer lens | `pan-wizard-core/bin/lib/verify.cjs`, `pan-wizard-core/bin/pan-tools.cjs`, `agents/pan-verifier.md`, `agents/pan-reviewer.md`, `pan-wizard-core/templates/verification-report.md`, `tests/verify-scope.test.cjs` | scope cases (git and no-git); the adapter reads `unrequested:`; template test |
| EL-7 | P5 | M | 4 | **Workflows record on the critical path, and dispose where they continue.** exec-phase: record review and verification (grep kept as the `\|\|` fallback), deferrals at PASS_WITH_WARNINGS and "continue anyway", no `$REVIEW_OUTPUT`. plan-phase: persist plan-check.md, branch on `record --raw`, defer at force-proceed. verify-phase: record at return. design-phase: persist design-check.md, record. milestone-audit: tech debt from `findings debt`. The verdict-path `optimize trace log` blocks are removed | `pan-wizard-core/workflows/{exec-phase,plan-phase,verify-phase,milestone-audit}.md`, `commands/pan/design-phase.md`, `tests/evidence-workflows.test.cjs` | drift assertions per step; the native-workflow drift test still green; no verdict-category trace-log call remains |
| EL-8 | P7 | XS | 1 | **M17 `contract` field.** `"1.0"` on `state` (load), `state json`, `progress` JSON; the resources inherit it; the additive rule goes in CLI-REFERENCE | `pan-wizard-core/bin/lib/state.cjs`, `pan-wizard-core/bin/lib/commands.cjs`, `tests/contract-field.test.cjs` | CLI outputs and the `pan://state` / `pan://progress` resources carry it |
| EL-9 | P5 | M | 4 | **Tool-failure capture in the trace hook.** Agent-transcript slice only: `error/tool_error` (tool, class, exit code, redacted ≤160-character message, count; ≤10 per spawn), completion `tool_calls`/`tool_errors`, `SCHEMA_V` 5, `agent-<id>.meta.json` name fallback, `execution.error_pattern_learning: false` off switch. The fixture's shape comes from a real emitted transcript | `hooks/pan-trace-logger.js`, `tests/fixtures/hooks/subagent-tool-errors-claude.json` (+ `.meta.json`), `tests/trace-logger-failures.test.cjs` | every §4.3 hook case; the capture test fails on the pre-change hook (revert-proof); hooks-e2e green |
| EL-10 | P5 | M | 4 | **Learn reads the signal.** `analyzeEvents`: `tool_error_patterns` (agent, tool, class, message signature; occurrences, spawns, sessions), `verdict_stats`, legacy verdict categories kept; notes derived from recurring patterns only; `optimize learn --sessions <n>` pooling; stats totals; optimizer and learn docs | `pan-wizard-core/bin/lib/optimize.cjs`, `pan-wizard-core/bin/pan-tools.cjs`, `agents/pan-optimizer.md`, `pan-wizard-core/workflows/learn.md`, `commands/pan/learn.md`, `tests/optimize-evidence.test.cjs` | analysis cases; pooled learn; legacy sessions still analyse |
| EL-11 | P2 | M | 4 | **Revertible apply.** `apply_id` + per-action records + a re-apply guard: today a second apply of the same report appends everything twice. `optimize revert <id\|--last>`: EOL-tolerant hash refusal, last-in-first-out per file, CRLF preserved, legacy rows reported as not revertible; stats count reverts | `pan-wizard-core/bin/lib/optimize.cjs`, `pan-wizard-core/bin/pan-tools.cjs`, `commands/pan/optimize.md`, `pan-wizard-core/workflows/optimize.md`, `tests/optimize-revert.test.cjs` | byte-for-byte round trip (LF and CRLF); refusals; the re-apply guard test fails on the current module (revert-proof) |
| EL-12 | P3 | S | 2 | **Harness.** Tier-0 `evidence-loop` against a deployed install: the installed trace hook fed a SubagentStop payload with a failing-tool transcript, then `findings record/dispose/debt`, `optimize learn`, `optimize apply` → `revert`. Tier-1 `tool-error-capture` defined (a model run on `uat-with-failure`; `--max-usd`) | `harness/scenarios/evidence-loop.json`, `harness/scenarios/tool-error-capture.json`, `harness/scripts/evidence-loop.cjs` | `npm run harness` tier 0 green; scenario schema checks green |

### Market-ideas items buildable here

| ID | Pri | Size | Pts | Title | Files | Gate / verify |
|---|---|---|---|---|---|---|
| Q-1 | P4 | S | 2 | **M3: planning-with-files coexistence.** Re-read the upstream layout first (a scout claim is a lead). Marker set with a dated-directory pattern; health and hygiene name the tool; the tree counts as *shared*, not foreign, when PAN's own state files are present; new info code when `.planning/` is gitignored while `commit_docs` is true | `pan-wizard-core/bin/lib/constants.cjs`, `foreign-planning.cjs`, `verify.cjs`, `hygiene.cjs`, `tests/foreign-planning.test.cjs`, `docs/CLI-REFERENCE.md` | fixture trees: dated dir + `.active_plan` → planning-with-files; shared tree → info, not refusal; ignored `.planning/` → the new code |
| Q-2 | P7 | XS | 1 | **M16: async observers on Claude.** Only if the host docs confirm `async` on hook entries and that an unknown key does not invalidate settings, and a race review of the trace/cost cursors under concurrent hooks comes out clean. Otherwise record the decision not to ship, with the reason | `bin/install.js`, `bin/install-lib.cjs`, `tests/`, `docs/HOOKS.md` | settings fixture; or a dated "not shipped" note in the market queue |
| Q-3 | P6 | XS | 1 | **M18: host-control user docs.** Only for the controls a primary source confirms, written by capability (no version-pinned model names) | `docs/USER-GUIDE.md`, `docs/TROUBLESHOOTING.md` | doc-lint and model-version lint clean |
| Q-4 | P1 | S | 2 | **Copilot payload field names.** Cost and trace loggers accept the documented camelCase aliases (`sessionId`, `transcriptPath`, `agentId`, `agentType`); the result is the agent type recorded, and still no per-agent transcript. The fixture is built from the GitHub hooks reference (documented, not observed; said so in its `.meta.json`) | `hooks/pan-cost-logger.js`, `hooks/pan-trace-logger.js`, `tests/fixtures/hooks/subagent-stop-copilot.json` (+ `.meta.json`), tests | a camelCase payload yields the agent type and no parent-slice tokens; the Claude fixtures are unchanged |

### Close-out

| ID | Pri | Size | Pts | Title | Files | Gate / verify |
|---|---|---|---|---|---|---|
| EL-13 | P6 | S | 2 | **Docs and decision record.** HOOKS, CLI-REFERENCE, USER-GUIDE (evidence section; the `error_pattern_learning` row), ARCHITECTURE; ADR-0049; CHANGELOG `[Unreleased]`; statuses in the investigation write-ups and index and in market items M3/M11/M12/M16/M17/M18 | `docs/…`, `CHANGELOG.md`, `docs/specs/investigations/…`, `docs/specs/market-ideas-2026-09.md` | doc-lint, link check, the no-counts rule |
| G-1 | — | S | 2 | **Full gate.** CLAUDE.md counts refresh; `npm run test:all`; `node scripts/test-surface.cjs --check`; coverage gate; release-check; harness tier 0; a five-runtime install into `d:\pantesting` and a smoke of the new verbs on the installed engine; commit on the branch (no push) | — | all green, and the output quoted in the final report |

**Total: 45 points** (evidence loop 35, queue items 6, close-out 4).

## Session grouping

| Session | Items | Pts | Theme | Exit criterion |
|---|---|---|---|---|
| **S1** | EL-1, EL-2, EL-3, EL-4, EL-5, EL-6, EL-7, EL-8 | 21 | Verdicts on the record: contract, judges, review chain, ledger, scope, workflows, contract field | a judge's verdict goes from agent text to ledger to `findings debt` in tests; the review chain merges reviewer findings; suite green |
| **S2** | EL-9, EL-10, EL-11, EL-12, Q-4, Q-1, Q-2, Q-3, EL-13, G-1 | 24 | Failures, learning and safe applies; the queue items; close-out | the hook records tool failures from a real-shaped transcript; learn shows them; apply → revert round-trips; harness tier 0 and release-check green; committed |

Ordering rationale: the P1 review-chain fixes (EL-3, EL-4) come immediately after the contract they need (EL-1, EL-2). Everything that consumes verdicts (EL-5 → EL-7) follows. S2 starts with the hook (EL-9), because learn (EL-10) and the harness (EL-12) read what it writes. Q-4 sits beside EL-9 because it edits the same loggers. The queue items come last among the builds because none of them blocks the loop.

## Deferred, with reasons and triggers

| Item | Why not now | Trigger |
|---|---|---|
| `optimize verdict` (write-up rec. 2, part 2) | One apply run in 14 field projects; the apply records keep what it needs | `optimize stats` shows apply runs in ≥ 3 projects |
| M5 publication path | Needs the maintainer's decision on the hosting form (ADR first) | the decision |
| M6 OpenCode observers | Rule MI-022: do not ship a host integration nobody has seen run. The OpenCode CLI is installed here but not signed in, so the plugin cannot be exercised live | `opencode auth login` on this machine |
| M7 Antigravity variant | No `agy` CLI here; conformance only from docs | `agy` available |
| M9 turn caps on exec-waves | Blocked: the Workflow tool's `agent()` has no per-spawn turn cap | host adds one |
| Recording hardener/meta-reviewer findings | They already have a parsed format; the ledger covers the reviewer | a deep review whose findings need dispositions |
| Phantom completions from unnamed agents without transcripts (spec §1.1 side finding) | Separate trace-quality issue | spun off as its own task |
