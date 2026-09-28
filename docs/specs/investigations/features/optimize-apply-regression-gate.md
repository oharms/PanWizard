# Regression gate and rollback for `optimize apply`

| | |
|---|---|
| Verdict | ENHANCE |
| Priority | P3 (backlog) — its signal depends on [trace-failure-capture](trace-failure-capture.md) |
| Size | M 4 points |
| Area | learnings/optimize/experiment |
| Runtimes | all five (the verbs are runtime-neutral; the signal they read is richest where the trace hook runs) |
| First seen | `2026-09-28` — [digest](../digests/2026-09-28.md) |
| Ledger | — |
| Status | FILED `MI-061` |

## Source trail
- `2026-09-28` — Growing Harness (arXiv:2609.26760 v2): each proposed change to the agent program is kept only if success on a held-out gate set does not drop; otherwise the whole change sequence since the last accepted checkpoint is rolled back, including state. Without the gate, their gate success rose to 30% and then fell to 16%; with it, the best result was retained (one run per variant, 50 tasks). Repairing a window of several failures at once beat single-failure repairs by 8 points (same caveats) (source: arXiv:2609.26760, via the LLM brief of `2026-09-28`).

## Why it matters for PAN
`optimize apply` writes what a report recommends into the project, and the memory entries it writes are read by agents in every later run. A bad entry therefore degrades every future session, which is the regression the paper's gate exists to catch. Today PAN cannot tell whether an apply helped, and it cannot undo one mechanically.

## Current state (evidence)
- `pan-wizard-core/bin/lib/optimize.cjs:675` `applyReportRecommendations`: `memory` actions create a file (skipped if it exists), `memory_append` actions **append to an existing memory file**, and `note`/`planning_note` actions append to suggestion files. There is no check before or after. **SOURCE**
- `optimize.cjs:752-761`: the log line in `optimization/applied.jsonl` records the timestamp, report name, counts and action **types** only: not the paths, not the appended text, not a pre-image. An append cannot be located afterwards to undo it. **SOURCE**
- `optimize.cjs:800` `getOptimizeStats`: sums applied/skipped counts; nothing compares sessions before and after an apply. **SOURCE**
- `pan-tools optimize` subcommands are `trace`, `learn`, `apply`, `list`, `stats` (dispatcher arm and `tests/fixtures/surface.json`). No `revert`. **SOURCE**
- `optimize learn` analyses one trace session (`--session`), so each report reflects a single run. **SOURCE**

## Proposal
1. **Revertible applies.** `optimize apply` gives each run an `apply_id` and records, per action, the path, the kind (`created` / `appended`) and the exact appended text with a hash of the file after the write. `pan-tools optimize revert <apply_id>` deletes created files and removes appended spans, **refusing** any file whose current hash differs from the recorded one (a human edited it since), and reports what it refused.
2. **A success-first verdict.** `pan-tools optimize verdict <apply_id>` compares trace sessions after the apply against an equal number before it: error events per spawn, verdict failures, retries, then tokens per spawn. It emits `kept`, `regressed` or `insufficient-data` (fewer than N sessions on either side; N in `.planning/config.json` under a new `optimize` section: `config.cjs` has none today). As in the paper, a cost drop never outweighs a rise in failures. The verdict recommends `revert`; it never reverts by itself.
3. **Window, not single session (optional).** `optimize learn --sessions <n>` pools the last n sessions, so a recommendation must explain failures recurring across them rather than one run's accident.

Honest limit: the paper gates on a fixed held-out task set. A PAN project has no such set; sessions before and after an apply do different work. The verdict is therefore advisory and says so in its output.

## Implementation sketch
| Layer | Change |
|---|---|
| Core module (`pan-wizard-core/bin/lib/`) | `optimize.cjs`: `apply_id`, per-action records, `revertApply()`, `applyVerdict()`, `--sessions` pooling in `generateLocalReport`; regenerate `tests/fixtures/module-surface.json` for the new exports |
| Dispatcher (`pan-tools.cjs`) | `revert` and `verdict` arms inside `case 'optimize'`; extend the unknown-subcommand error text |
| Installer / per-runtime (`bin/install-lib.cjs`) | none |
| Commands / agents / workflows (markdown) | `commands/pan/optimize.md` and `workflows/optimize.md` document revert/verdict; `/pan:learn --apply` prints the `apply_id` |
| Hooks / MCP | none (not an MCP verb: it writes the project) |
| Tests | unit: append → revert restores bytes; edited-since file is refused; verdict thresholds; each shown to fail on the current module. `node scripts/test-surface.cjs` for the two new rows; the dispatcher-arms contract sees both arms |
| Harness | not needed for the mechanics; a tier-1 scenario only once the trace signal exists |
| Docs / ADR | `docs/CLI-REFERENCE.md` (no counts) |

## Gate
`tests/optimize.test.cjs` proves apply → revert round-trips byte-for-byte on a `memory_append`, refuses a hand-edited file, and fails on the current tree because `revert` does not exist.

## Effort & risk
- The revert half stands alone and is cheap. The verdict half is only as good as the trace signal, which is empty in the field today. Build it after, or together with, [trace-failure-capture](trace-failure-capture.md).
- CRLF: appended spans must be matched EOL-tolerantly (the 3.31.0 lesson from `bytesMatchHashIgnoringEol`).

## Open questions for the owner
- Ship revert alone first (XS–S), and hold the verdict until the trace hook produces errors?
- Is the optimize loop worth this investment at all, given the field shows it is barely used? The alternative is to fix the signal first and measure use before adding verbs.

## Outcome (`2026-09-28`)

Part 1 (revertible applies) is built on `feat/evidence-loop`:
- every apply gets an `apply_id` with per-action records;
- `optimize revert <apply_id|--last>` refuses a hand-edited file and reverts last-in, first-out per file, matching line endings tolerantly;
- applying the same report twice now writes nothing the second time, where it used to append everything twice.

Part 3 is built too: `optimize learn --sessions <n>` pools sessions.

Part 2, the advisory before/after verdict, is deferred, which answers the owner's question: the loop is worth fixing (signal and safety) but not worth growing until it is used. The field showed 1 apply run in 14 projects. The apply records keep what the verdict needs, so it can be added without a migration. Trigger: apply runs in three or more projects.
