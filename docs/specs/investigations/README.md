# Investigations

Output of the `/investigate` dev command (`.claude/commands/investigate.md`): material the maintainer brings — a news
dump, an article, a paper, a host tool's release notes — triaged against what PAN Wizard already does, with a
write-up for every ADD or ENHANCE verdict. Nothing here ships; it is the inbox that feeds
[the ideas ledger](../market-ideas-ledger.md) once the owner files an item.

- `digests/` — one per run: the full triage, what PAN already has, what to watch, hand-offs to `/reality-check`.
- `features/` — one per proposed feature; later runs append to the source trail instead of creating duplicates.
- `sources/` — the raw input of each run, **gitignored**: this repository is public, so third-party text stays local
  and only the write-ups (in our own words) are tracked.

Statuses: PROPOSED → FILED `MI-nnn` (entered in the ledger) or REJECTED (with the reason).

## Digests

| Date | Source | Result |
|---|---|---|
| [`2026-10-10`](digests/2026-10-10.md) | `mattpocock/skills` repository at `49dd158` | ENHANCE 2 · HAVE 7 · WATCH 1 · SKIP 4 |
| [`2026-10-08`](digests/2026-10-08.md) | VentureBeat AI Weekly newsletter (pasted), incl. multi-harness RL, SIFT, WikiSkill, Agent Memory Repo, Context Language Models | ENHANCE 1 · HAVE 3 · WATCH 3 · SKIP 7 |
| [`2026-09-28`](digests/2026-09-28.md) | LLM brief (GrokBot llm-watch), incl. Growing Harness and PaMER papers | ENHANCE 2 · HAVE 2 · WATCH 1 · SKIP 7 |

## Feature write-ups

| Feature | Verdict | Priority | Status | Last updated |
|---|---|---|---|---|
| [Debugger: a failing command before any hypothesis](features/debugger-red-loop-first.md) | ENHANCE | P2 | FILED `MI-105`, built | `2026-10-10` |
| [Reviewer: a fixed code-smell baseline](features/reviewer-smell-baseline.md) | ENHANCE | P3 | FILED `MI-106`, built | `2026-10-10` |
| [Behavioural harness runs on every host CLI](features/harness-cross-host-behaviour.md) | ENHANCE | P2 | FILED `MI-104`, plumbing built | `2026-10-10` |
| [Failure capture in the trace hook](features/trace-failure-capture.md) | ENHANCE | P2 | FILED `MI-060` (built, ADR-0049) | `2026-09-28` |
| [Regression gate and rollback for `optimize apply`](features/optimize-apply-regression-gate.md) | ENHANCE | P3 | FILED `MI-061` (revert built; verdict deferred) | `2026-09-28` |
