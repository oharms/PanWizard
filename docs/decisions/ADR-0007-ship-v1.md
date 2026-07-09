# ADR-0007: Ship v1.0.0 to npm

## Status
Proposed

## Context
PAN Wizard has been in active development through 29 sessions, reaching 1483 tests,
15 core modules, 42 commands, 11 agents, and 5 runtime targets. The codebase has
zero TODO/FIXME markers, zero TOCTOU races, 200+ try-catch blocks for error handling,
and passes CI across 3 OS x 4 Node versions (12 configurations).

Despite this maturity, the package has never been published to npm. The README
prominently features `npx pan-wizard@latest` as the install method, but this
command currently returns a 404 error. The `pan-wizard` name is available on npm.

Quality audit findings:
- 1483 tests, 0 failures, 0 skipped
- Zero TODO/FIXME/HACK markers in production code
- Zero console.log leaks in library code
- Zero .only()/.skip() in tests
- Zero hardcoded paths
- Zero runtime dependencies
- All file I/O wrapped in try-catch (200+ blocks)
- All TOCTOU races eliminated
- Cross-platform CI: Ubuntu + Windows + macOS x Node 16/18/20/22

Competitive analysis shows all comparable tools ship via standard package managers:
Aider (pip), Continue.dev (npm), GitHub Copilot CLI (npm). PAN Wizard's 422KB
packed size and zero runtime deps match the gold standard set by @github/copilot.

## Decision
Bump version from 0.3.0 to 1.0.0 and publish to npm.

1.0.0 was chosen over 0.4.0 because:
- The codebase is production-ready by every measurable metric
- 0.x signals instability; PAN Wizard is demonstrably stable
- Users need a clear signal that this is safe to adopt
- Semantic versioning says 1.0.0 = "public API is stable"
- The command naming restructure (Session 16) is a natural breaking-change boundary

## Consequences

### Positive
- Users can install via the documented `npx pan-wizard@latest` method
- npm download metrics provide adoption signal
- npm search discoverability for 13 keywords
- README badges (version, downloads) activate
- Community growth becomes possible
- Competitive positioning: lightest-weight AI workflow tool on npm (422KB, 0 deps, 5 runtimes)

### Negative
- 1.0.0 commits to backward compatibility for command names and JSON output schemas
- Must follow semver strictly for any future breaking changes (major version bump)
- Bug reports from real users will begin (support burden)
- npm account security becomes critical (2FA required)

### Neutral
- Existing local installs are unaffected
- `/pan:update` command already handles pulling latest from npm
- No new code required — this is purely operational

## Options Considered
1. **Publish as 0.4.0** — rejected: sends wrong stability signal for a production-ready tool
2. **Publish as 1.0.0** — chosen: clear, honest stability declaration
3. **Wait for automated release pipeline** — rejected: blocks shipping for no immediate user benefit; automated releases are v1.1.0 scope
4. **Use scoped name (@oharms/pan-wizard)** — rejected: `pan-wizard` is available and simpler

## Links
- Spec: docs/specs/production_readiness_ship_v1_featureai.md
- package.json: complete metadata, bin entry, files whitelist
- CI: .github/workflows/ci.yml (3 OS x 4 Node)
- npm name availability: confirmed (404 = available)
- Related: ADR-0005 (command naming — breaking change captured in 1.0.0)
