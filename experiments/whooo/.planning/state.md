# Project State

**Status:** Done
**Last Activity:** 2026-04-27
**Last Activity Description:** Built whooo markdown frontmatter linter end-to-end across 4 waves. All 10 requirements satisfied; 39 tests passing; dogfood gate produces 9-error/4-warning real-world report against PAN's commands/pan/.
**Current Milestone:** v0.1.0 (initial release)

## Decisions

- **5-module library + thin CLI** — chose responsibility-separated modules (frontmatter / schema / validate / walk / reporter) over monolithic single-file. Mirrors PAN's pan-wizard-core/bin/lib/ pattern.
- **Zero deps; handwritten YAML-ish parser** — accepted the risk that real-world YAML edge cases would surface during dogfood. Risk materialized (block-list scope cut was wrong); fixed in a 50-line patch.
- **DESIGN_SPEC.md authored before any code** — locked module boundaries, error code contract, YAML subset. Made the eventual scope-cut reversal visible as a spec correction, not a generic bug fix.
- **Tests assert violation SHAPE, not message prose** — codes + field names + severity. Generalizes P-001 (timestamp shape) from the prior whooo run.
- **Dogfood gate non-optional** — running whooo against PAN's own files immediately surfaced 2 real bugs (block-list missing, schema name pattern wrong) in the linter that all 39 unit tests had missed.

## Blockers

_None_

## Notes

- **Real findings ready to promote:** 6 patterns (4 universal + 2 internal). See `phases/01-build-cli/01-build-cli-summary.md` § "Promote-worthy findings".
- **Confirmed PAN bugs from prior whooo run** (P-101 manifest persistence, P-102 runner Windows spawn) reproduced again in this run — P-102 specifically forced the direct-build path for the experiment runtime.
- **Phase 1 verification status:** passed (see 01-build-cli-verification.md).
