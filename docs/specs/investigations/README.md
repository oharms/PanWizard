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
| [`2026-09-28`](digests/2026-09-28.md) | LLM brief (GrokBot llm-watch), incl. Growing Harness and PaMER papers | ENHANCE 2 · HAVE 2 · WATCH 1 · SKIP 7 |

## Feature write-ups

| Feature | Verdict | Priority | Status | Last updated |
|---|---|---|---|---|
| [Failure capture in the trace hook](features/trace-failure-capture.md) | ENHANCE | P2 | PROPOSED | `2026-09-28` |
| [Regression gate and rollback for `optimize apply`](features/optimize-apply-regression-gate.md) | ENHANCE | P3 | PROPOSED | `2026-09-28` |
