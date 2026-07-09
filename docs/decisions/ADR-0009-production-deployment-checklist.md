# ADR-0009: Production Deployment Checklist

## Status
Proposed

## Context

PAN Wizard v1.0.0 is feature-complete with 37 commands, 15 modules, 11 agents, and 1065 passing tests across 5 runtimes (Claude Code, OpenCode, Gemini CLI, Codex, Copilot CLI). The codebase has undergone 21 sessions of systematic hardening, testing, and documentation work.

Before publishing to npm as a stable v1.0.0 release, a production deployment audit was conducted to verify all non-code artifacts meet professional standards. The audit examined: LICENSE, SECURITY.md, .gitignore, CI pipeline, documentation accuracy, npm package configuration, installer robustness, and security posture.

### Forces at Play
- **First impressions matter:** New users evaluate quality from README, LICENSE, and install experience before reading code
- **Security trust:** SECURITY.md with stale version (0.1.x) undermines confidence in a 1.0.0 release
- **Contributor friction:** Minimal .gitignore risks accidental commits of sensitive files in PRs
- **Documentation accuracy:** Stale counts (33 workflows when 30 exist) create confusion for contributors

## Decision

Execute a focused deployment preparation sprint addressing 9 items in priority order:

### P0 (Must fix before publish)
1. **SECURITY.md** — Update version table from `0.1.x` to `1.0.0`
2. **.gitignore** — Expand from 3 entries to comprehensive Node/OS coverage
3. **ARCHITECTURE.md** — Fix workflow count from 33 to 31

### P1 (Should fix before publish)
4. **npm publish --dry-run** — Verify package size and contents
5. **Orphaned verify-work.md** — Remove or document as alias

### P2+ (Polish, non-blocking)
6. **Dependabot** — Add `.github/dependabot.yml` for esbuild updates
7. **FUNDING.yml** — Populate or remove empty placeholder
8. **Internal command files** — Fix stale "123 tests" references
9. **isGitIgnored()** — Migrate from `execSync` string to `execFileSync` array (defense-in-depth)

### What We Decided NOT to Do
- **ESLint/Prettier:** Not blocking for v1.0.0. The codebase maintains consistent style without formal linting. Adding linting tools introduces devDependencies and CI complexity that doesn't match the "zero ceremony" philosophy. Consider for v1.1.0.
- **TypeScript/JSDoc validation:** Pure CJS project with 1483 tests provides better guarantees than type annotations. Not worth the migration effort.
- **npm publish workflow:** Manual publish via `npm publish` is appropriate for a solo-maintained tool. Automated publishing adds attack surface.
- **Coverage thresholds:** The project has 1483 tests across 52 files. Threshold enforcement would add CI complexity without improving actual coverage.

## Consequences

### Positive
- Clean, professional npm package on first publish
- Accurate security policy builds trust with evaluators
- Comprehensive .gitignore prevents contributor accidents
- Documentation accuracy reduces confusion for new users

### Negative
- Small time investment (estimated 1 focus-exec session / ~30 minutes)
- No automated code quality gates (ESLint/Prettier deferred)

### Neutral
- Dependabot will create PRs for esbuild updates (only devDependency)
- FUNDING.yml decision depends on whether GitHub Sponsors is set up

## Options Considered

1. **Ship as-is** — All issues are non-blocking, but first impression suffers
2. **Fix HIGH priority only** — SECURITY.md + .gitignore + ARCHITECTURE.md (chosen minimum)
3. **Full polish sprint** — All 9 items including ESLint, Prettier, coverage (rejected: over-engineering for v1.0.0)

## Links
- Spec: `docs/specs/production_deployment_readiness_featureai.md`
- Previous ADR: ADR-0007 (Ship v1.0.0 decision)
- Previous spec: `docs/specs/production_readiness_ship_v1_featureai.md`
