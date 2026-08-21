# ADR-0044: Bound the cached context — PAN's dominant cost is what it re-reads, not what it generates

## Status

Accepted — 2026-08-21. Implemented across `state-compact.cjs` (new), `hygiene.cjs`, `context-budget.cjs`, `core.cjs::buildCachedContext`, and the three planning-aware hooks.

## Context

A field project reported that PAN had got slow. Its cost ledger explains why.

Excluding the 24% of rows that PAN's own `isSuspectRecord` flags as pre-v3.12.4 oversum poison, 92 clean records show:

| axis | tokens |
|---|---:|
| cache_read | 550.2M |
| output | 8.7M |
| input | 1.9M |

**Cache reads are 98.1% of all token traffic** — roughly sixty times the generated output. `pan-executor` averaged 7.0M cache-read tokens per call across 47 calls.

The block being re-read on every agent call was 109 KB ≈ 28k tokens:

```
project.md        14.1 KB
requirements.md   21.5 KB
roadmap.md        18.3 KB
state.md          53.8 KB   ← half the block
```

And 56% of `state.md` was settled history: a 25.6 KB session log from ten weeks earlier, a resolved milestone audit, and three phase closures. Roughly 7k tokens of finished work re-read into every agent call for months.

Two structural facts made this inevitable rather than accidental:

1. **`state.md` can only grow.** Its section writers are append-only — `sectionBody.trimEnd() + '\n' + entry` in both `cmdStateAddDecision` and `cmdStateAddBlocker`. PAN bounds its other append-only store (`memory compact`, `DEFAULT_MAX_ENTRIES`) but never applied the same idea to the file that dominates every prompt.

2. **Nothing watched the block.** `context-budget.cjs` computed `cache.total_tokens` and `eligible_pct` and reported them with no threshold attached. A measurement with no classification is not a signal — a 28k-token block looked exactly like a 3k-token one.

Two adjacent failures shared the shape:

- **The ledger poison gate counted rows, not tokens.** `checkCostLedger` fired at `suspect/records.length ≥ 0.5`. The field ledger sat at 24% by count — passing — while those rows carried 89% of the token mass. A ledger that is arithmetically useless reported clean.
- **Phase attribution only worked under tracing.** The cost hook read the phase from `.planning/optimization/current-session`, which exists only while the optimizer runs. With tracing off — the default — 100% of rows carried `phase: null`, so "which phase got expensive" was unanswerable from PAN's own telemetry.

## Decision

**1. `state.md` gets a compaction path.** New `pan-tools state compact [--apply] [--keep-days N]` moves settled sections into `state-history.md`. Safety is ordered:

- Nothing is deleted. History is appended to the archive **first**, then `state.md` is rewritten, so an interruption can only duplicate, never lose.
- Only unambiguous history moves: a heading dated past the retention window, or one saying "closure"/"closed". Anything unrecognised stays.
- A protected list guards the headings PAN reads and writes (`state get <section>` can read *any* heading by name).
- A section carrying a field the frontmatter is rebuilt from (`**Status:**`, `**Current Phase:**`, …) is never moved: `syncStateFrontmatter` regenerates frontmatter from the **first** such match in the body, so relocating one could silently rewrite `state.md` metadata.
- Compaction that would not shrink the file is declined. On a small file the pointers cost more than the sections they replace, and churning `state.md` to make it bigger helps nobody.
- Dry-run by default, and the dry-run's byte count is produced by the same rebuild `--apply` uses — a dry-run that disagrees with the apply is not a dry-run.

**2. The cached block is classified, not merely measured.** `CACHE_BLOCK_WARN_TOKENS` (15k) / `CACHE_BLOCK_CRIT_TOKENS` (25k) / `CACHE_FILE_WARN_TOKENS` (6k), mirroring the existing `MEMORY_LOAD_*` pattern. `context-budget` gains `cache.status` plus advice naming the largest file, and hygiene gains a `cache-context` check whose `state.md` finding carries the `compact-state` remedy.

**3. Hygiene covers the rest of the growth surface.** `optimization/reports/` is now pruned on the same retention and keep-newest floor as `optimization/traces/` — previously traces aged out while the analysis JSON beside them (92 KB in the field) never did.

**4. The ledger poison gate watches token mass.** `HYGIENE_LEDGER_SUSPECT_MASS_RATIO` fires when suspect rows carry ≥50% of the token mass, whatever their count. The finding names which gate tripped so a healthy-looking row count is not mistaken for a false positive. Mass is what `aggregate` sums, so mass is what the gate has to watch.

**5. Phase attribution works without tracing.** The cost hook falls back to `state.md` — frontmatter `current_phase`, then the `**Current Phase:**` body field — when no trace session is active.

**6. The cached list is extensible.** `config.json → cache.extra_files` lets a project add its own stable documents. The built-in list is the *phase-model* spine, so a focus-model project had an empty block and therefore no prompt caching at all. Entries are appended after the built-ins so the cache prefix stays byte-stable for projects that configure nothing.

**7. All three planning-aware hooks resolve the same root.** `pan-cost-logger`, `pan-trace-logger`, and `pan-stop-guard` now honour `PAN_PLANNING_DIR` / `PAN_TRACK`. Without this the CLI could be pointed at a track (ADR-0043) while the hooks kept writing to `.planning/`, stranding that track's telemetry in the wrong tree.

## Consequences

- **The reported slowdown has a measured remedy.** On the field project, `state compact` archives four sections and cuts the per-call re-read by ~6,995 tokens — roughly halving `state.md` and taking the block from `critical` to below it.
- **`cost_usd` stays null in the ledger, deliberately.** It is computed at read time from current rates (`appendRecord`, `aggregate`). Freezing a value at write time would bake in stale pricing. This was considered and rejected, not overlooked.
- **A conservative compactor leaves things behind.** On the field file it correctly declined to archive a milestone audit marked "GAPS FOUND" — an open item that merely looked historical. Under-archiving is the right failure direction for a tool that edits the project's source of truth.
- **`walkPlanning` no longer descends into `tracks/`.** Fixing this was forced by the new check: the root scan had been absorbing every track's files, which also meant `--all-tracks` double-counted `.tmp` orphans. A latent ADR-0043 defect, surfaced by giving the walker a second consumer.
- **One existing test changed meaning.** `small or mostly-clean ledgers are not flagged` asserted that 5 poisoned rows among 25 were fine. Under the mass gate they are not — those rows held 99.99% of the tokens. The test was rewritten to be clean on both axes, and a new test pins the count-passes/mass-fails case.

## Convergence — a clean must actually finish

Applying the above surfaced a fourth failure, reported from the field as "hygiene doesn't properly fix a project". Running `hygiene clean --apply` twice on a real tree showed why:

```
PASS 2:  ✗ compact-state  .planning/state.md  nothing past the retention window
         fixable: 1, executed: 0, failed: 1, manual: 1
```

Three defects, all of the same kind — the tool claiming more than it delivers:

1. **A finding advertised a fix that could no longer do anything.** `fixable` was derived from the mere presence of a `fix` object, so once state.md's settled history was archived the `compact-state` remedy stayed attached to a file whose remaining bulk is LIVE content. Every subsequent `clean --apply` reported `failed: 1`, forever. `checkCachedContext` now consults `planStateCompaction` and offers the fix only when something is genuinely archivable; otherwise the finding is honestly manual and says so.

2. **Quarantines accumulated without limit.** Each poisoned-ledger quarantine left a dated copy and nothing ever removed one — the field tree already held a July file alongside the new one. Quarantine now prunes superseded copies, keeping the newest so the evidence survives. The cure had become the disease it treats.

3. **The cost cursor outlived the ledger it indexed.** `.cost-cursor.json` holds per-transcript high-water marks into `tokens.jsonl`; leaving it after a quarantine meant the "fresh" ledger inherited the old read position and undercounted its next slice. It is now cleared with the rename.

After these, the same tree converges: `fixable: 0, executed: 0, failed: 0, manual: 2`, with the two remaining findings carrying honest manual advice. **`auto-fixable` now means "running clean will change this"** — which is the only reading that makes a repeat run meaningful.

## Alternatives considered

- **Cap `state.md` at a byte limit and truncate.** Simple, and unacceptable: the file is the project's source of truth, and a size-triggered truncation would drop live content as readily as settled content.
- **Stop caching `state.md`.** Removes the growth cost but also the benefit — it is genuinely stable within a phase, which is exactly what prompt caching rewards. The problem was never that it was cached; it was that it was unbounded.
- **Classify sections with an agent.** More flexible than pattern rules, and wrong for this job: compaction rewrites the project's source of truth and must be deterministic, reviewable in a dry-run, and identical on every run.
- **Infer the phase from the transcript path or session id.** Cheaper than reading `state.md`, but it guesses. `state.md` is where the current phase actually lives.
