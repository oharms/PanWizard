# ADR-0016: Enhanced Documentation Sync (focus-sync v2)

## Status
Proposed

## Context
The current `focus sync` command checks only README.md for 3 count patterns (commands, agents, modules). An end-to-end documentation audit on 2026-03-04 revealed 20+ staleness issues across 8 files:

- Stale counts in DEVELOPMENT.md (test count 1277 vs actual 1314)
- Old command names from v1.0.0 rename in EXAMPLES.md (`resume-work`, `pause-work`, `complete-milestone`, `new-milestone`)
- Wrong Copilot CLI prefix in FAQ.md (`/pan:*` should be `/pan-*`)
- Missing `focus-auto` command in USER-GUIDE.md tables
- Placeholder URL in TROUBLESHOOTING.md

Every feature addition (e.g., focus-auto in v2.3.0) requires manual audit of 14+ files. This was demonstrably missed and is unsustainable.

## Decision
Enhance `checkDocStaleness()` in `focus.cjs` to:

1. **Scan all doc files** (README, ARCHITECTURE, DEVELOPMENT, CONTRIBUTING, USER-GUIDE, CLI-REFERENCE) for count patterns — not just README
2. **Detect old command names** using a `COMMAND_RENAME_MAP` constant in `constants.cjs` (17 entries from v1.0.0 rename)
3. **Check command table completeness** — parse markdown tables containing `/pan:` entries and verify all `.md` files in `commands/pan/` have entries
4. **Cross-reference version** — compare `package.json` version against CHANGELOG top entry
5. Return enriched output with new fields (`old_names`, `missing_commands`, `version_match`) alongside existing fields

Output contract is **additive** — existing `stale`, `current`, `actuals` fields preserved. No breaking changes.

## Consequences

### Positive
- Catches 90%+ of documentation staleness automatically
- Reduces manual audit from ~30 minutes to <1 minute
- Prevents stale docs from shipping when used in focus-auto loop
- Old command names detectable programmatically (was purely visual before)

### Negative
- More file reads per sync invocation (~12 files vs 1) — acceptable at <100ms total
- COMMAND_RENAME_MAP requires maintenance if future renames happen (unlikely after v1.0.0 stabilization)

### Neutral
- No changes to the focus-sync.md command file structure (it reads JSON output)
- No new modules or exports beyond the COMMAND_RENAME_MAP constant
- Test count checking uses stored count rather than live `npm test` execution

## Options Considered

1. **Status quo** — Keep checking only README. Rejected: misses 90% of staleness.
2. **Full AST-based doc parser** — Parse markdown AST for tables, headings. Rejected: over-engineering for regex-solvable patterns.
3. **Enhanced regex scanning (chosen)** — Extend existing pattern to more files and add targeted checks. Right balance of coverage and simplicity.

## Links
- Feature spec: `docs/specs/focus_sync_v2_featureai.md`
- Related: ADR-0006 (focus commands), ADR-0014 (internal cleanup)
- Audit findings: 20+ issues across Categories A-D in spec
