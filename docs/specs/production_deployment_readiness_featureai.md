# Production Deployment Readiness — Feature AI Specification

**Mode:** `--internal` (no competitive research — this is deployment preparation)
**Date:** 2026-03-02
**Version:** PAN Wizard v1.0.0

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard v1.0.0 is feature-complete with 37 commands, 15 modules, 11 agents, and 1065 passing tests across 5 runtimes — but has not undergone a production deployment audit. Before publishing to npm as a stable release, we must verify that all non-code artifacts (LICENSE, SECURITY.md, .gitignore, CI, documentation accuracy, installer shebang, npm package contents) meet production standards. Shipping without this audit risks a poor first impression, broken install experiences, stale documentation confusing new users, and security policy gaps that erode trust.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Personal pain (user-stated) | This conversation | User explicitly requested: "Need to deploy and make ready for production deployment, analyse whats left todo, need to check everything, readme's licence, everything that would make the product production ready" |
| Industry standard | npm registry best practices | All top-100 npm packages have LICENSE, SECURITY.md, .gitignore, CI, and accurate docs |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| LICENSE file accuracy | New feature development (already v1.0.0) |
| SECURITY.md version table | Marketing website (separate concern) |
| .gitignore completeness | CDN/hosting (npm handles distribution) |
| CI pipeline gaps | Paid services integration (Codecov, etc.) |
| Documentation count accuracy | IDE plugin development (future milestone) |
| npm package.json fields | Database/backend (PAN is CLI-only) |
| Installer robustness | |
| Security posture of core code | |
| Test coverage gaps | |
| Build system cleanup | |

### 0.4 Success Criteria (Measurable)

```
SC-1: SECURITY.md version table shows 1.0.0 as current supported version
SC-2: .gitignore covers all standard Node/OS patterns (.env, .DS_Store, IDE files)
SC-3: ARCHITECTURE.md workflow count matches actual (31, not 33)
SC-4: Zero TODO/FIXME/HACK/XXX markers in core modules (verified: PASS)
SC-5: npm publish --dry-run succeeds with acceptable package size
SC-6: All 1065 tests pass on Node 16, 18, 20, 22 across Windows/Mac/Linux
SC-7: No execSync with string interpolation of user input in core modules
SC-8: FUNDING.yml populated or removed (currently empty placeholder)
```

### 0.5 User Stories

```
As a developer installing PAN Wizard for the first time, I want accurate
installation docs and a clean npm package, so that I can get started in
under 2 minutes, instead of troubleshooting stale instructions.

As a security-conscious team lead evaluating PAN Wizard, I want a complete
SECURITY.md with current version support, so that I know how to report
vulnerabilities, instead of guessing if the project is maintained.

As an open-source contributor, I want a .gitignore that prevents accidental
commits of sensitive files, so that PRs stay clean, instead of manually
cleaning up .env files and IDE artifacts.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:focus-sync` | Partial | focus-sync checks doc counts but not LICENSE, SECURITY, .gitignore, CI |
| `/pan:health` | Partial | health checks .planning/ integrity but not npm/deployment readiness |
| `/pan:milestone-audit` | None | audits milestone intent, not deployment artifacts |

**Verdict:** No full overlap. This is a one-time deployment preparation task, not a new command.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 37 | 37 | +0 |
| New concepts introduced | 0 | 0 | +0 |
| Score | — | — | simplifies (-1) — fixing docs reduces confusion |

---

## Phase 1: Internal Reconnaissance — Audit Results

### 1.1 Complete Findings Matrix

| Category | Status | Issues Found | Severity |
|----------|--------|-------------|----------|
| **README.md** | GOOD | None — professional, accurate, all 5 runtimes, badges, MIT badge | — |
| **package.json** | GOOD | All fields present, zero runtime deps, proper files field, engines >=16.7.0 | — |
| **LICENSE** | GOOD | MIT, complete, copyright 2026 PAN Wizard Contributors | — |
| **CHANGELOG.md** | GOOD | Keep a Changelog format, v1.0.0 entry current | — |
| **CONTRIBUTING.md** | GOOD | Clear guidelines, setup instructions, cross-platform notes | — |
| **CODE_OF_CONDUCT.md** | GOOD | Contributor Covenant v2.0 | — |
| **SECURITY.md** | NEEDS-FIX | Version table shows `0.1.x`, should show `1.0.0` | HIGH |
| **.gitignore** | NEEDS-FIX | Only 3 entries. Missing .env, .DS_Store, IDE, OS patterns | HIGH |
| **ARCHITECTURE.md** | NEEDS-FIX | Workflow count says 33, actual is 31 | MEDIUM |
| **FUNDING.yml** | NEEDS-FIX | Empty placeholder — should populate or remove | LOW |
| **CI (ci.yml)** | GOOD | Node 16/18/20/22, Ubuntu/Windows/macOS, tests + build | — |
| **Issue templates** | GOOD | bug_report.yml + feature_request.yml | — |
| **PR template** | GOOD | Multi-platform checklist | — |
| **CODEOWNERS** | GOOD | Present | — |
| **Dependabot** | MISSING | No automated dependency updates | LOW |
| **Linting** | MISSING | No ESLint/Prettier configured | LOW |
| **Type checking** | N/A | Pure CJS project, no TypeScript needed | — |
| **Core modules** | CLEAN | Zero TODO/FIXME/HACK/XXX markers across all 15 modules | — |
| **Test suite** | EXCELLENT | 1065/1065 pass, 37 test files, cross-platform | — |
| **Build (hooks)** | GOOD | scripts/build-hooks.js, prepublishOnly configured | — |
| **Installer** | GOOD | Shebang, error handling, 5 runtimes, graceful degradation | — |

### 1.2 Security-Relevant Code Findings

| Location | Pattern | Risk | Assessment |
|----------|---------|------|------------|
| core.cjs:198 | `execSync('git check-ignore -q -- ' + sanitized)` | LOW | Input sanitized via `replace(/[^a-zA-Z0-9._\-/]/g, '')` — safe |
| core.cjs:217 | `execFileSync('git', args)` | NONE | Array-based — no injection possible |
| init.cjs:280 | `execSync('find ...')` | NONE | Hardcoded command, no user input interpolated |
| commands.cjs | No execSync calls | NONE | Clean |

**Verdict:** No command injection vulnerabilities. The `isGitIgnored` function sanitizes path input before shell interpolation. The `execGit` function uses the safe `execFileSync` array pattern.

### 1.3 npm Package Contents Verification

The `files` field in package.json correctly includes only:
- `bin/` — installer
- `commands/` — command definitions
- `pan-wizard-core/` — core runtime
- `agents/` — agent definitions
- `hooks/dist/` — built hooks (not source)
- `scripts/` — build scripts
- `assets/` — visual assets

Properly excludes: tests/, docs/, .github/, .planning/, .claude/

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Decision |
|--------|----------|
| **ELIMINATE** | Stale version references in SECURITY.md, empty FUNDING.yml placeholder |
| **REDUCE** | Risk of accidental sensitive file commits (expand .gitignore) |
| **RAISE** | Documentation accuracy (fix workflow count), professional polish |
| **CREATE** | Dependabot configuration for automated security updates |

### 3.2 Wardley Evolution

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                                  ^
                          PAN Wizard is HERE
                    (v1.0.0, feature-complete,
                     needs deployment polish)
```

The deployment checklist is a **commodity operation** — every npm package needs this. Execute quickly.

### 3.3 Strategic Recommendation

**Ship immediately after fixing the HIGH-priority items.** PAN Wizard v1.0.0 is production-ready from a code perspective: zero runtime deps, 1065 tests, cross-platform CI, comprehensive docs. The gaps are exclusively in non-code artifacts (SECURITY.md version, .gitignore, ARCHITECTURE.md count). These are 30-minute fixes that should not delay deployment.

---

## Phase 3.5: Architecture Assessment

### 3.5.1 Feature Type Classification

This is a **documentation and configuration fix** — no new commands, modules, agents, or hooks.

### 3.5.2 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | No |
| Changes file formats? | No |
| Changes directory structure? | No |
| Changes installer output? | No |

### 3.5.3 Cross-Platform Considerations

All fixes are text file edits — no platform-specific concerns.

---

## Phase 4: Design Synthesis

### 4.1 Production Deployment Checklist

The fixes are organized into 3 tiers:

#### Tier 1: HIGH Priority (Must fix before publish)

1. **SECURITY.md** — Update supported versions table from `0.1.x` to `1.0.0`
2. **.gitignore** — Expand with standard Node/OS patterns
3. **ARCHITECTURE.md** — Fix workflow count from 33 to 31 (line 47 and line 119)

#### Tier 2: MEDIUM Priority (Should fix before publish)

4. **FUNDING.yml** — Either populate with GitHub Sponsors username or remove
5. **Dependabot config** — Add `.github/dependabot.yml` for esbuild updates
6. **verify-work.md** — Orphaned workflow (verify-phase already has its own workflow)

#### Tier 3: LOW Priority (Nice to have)

7. **npm publish --dry-run** — Verify package size and contents
8. **Internal command .md files** — Fix stale "123 tests" count in 5 files (from focus-sync findings)

### 4.2 Feature Ladder

| Version | Scope | Value | Effort |
|---------|-------|-------|--------|
| **v0 (MVP)** | Fix SECURITY.md + .gitignore + ARCHITECTURE.md | Unblocks safe publish | XS |
| **v1 (Complete)** | + Dependabot + FUNDING.yml + verify-work.md cleanup + dry-run | Professional polish | S |
| **v2 (Enhanced)** | + ESLint + Prettier + pre-commit hooks + coverage thresholds | Developer experience | M |

---

## Phase 5: Architecture Decision Record

See: `docs/decisions/ADR-0009-production-deployment-checklist.md`

---

## Phase 6: Error Handling Audit

**Core module error handling: COMPLETE**

All 15 core modules have been audited across sessions 7-21:
- Zero `existsSync` TOCTOU races remaining
- All file writes wrapped in try-catch
- All `mkdirSync`/`rmSync` calls wrapped in try-catch
- JSON output via `output()` function (never console.log)
- Errors via `error()` function (never console.error)
- `cmdScaffold` uses `wx` flag for atomic exclusive-create
- `readStateSafe()` exported for cross-module use
- All path output passes through `toPosix()`

**No error handling work needed for deployment.**

---

## Phase 7: Security Audit

### 7.1 Asset Inventory

| Asset | Access | Trust Level |
|-------|--------|-------------|
| .planning/ directory | Read/Write | System-generated |
| pan-wizard-core/ | Read | System-shipped |
| User project files | Read (selective) | User-controlled |
| Git repository | Read/Write (commits, tags) | User-controlled |

### 7.2 Shell Execution Audit

| Function | Method | Input | Verdict |
|----------|--------|-------|---------|
| `isGitIgnored()` | `execSync()` with sanitized string | Path sanitized via regex `[^a-zA-Z0-9._\-/]` stripped | SAFE — consider migrating to `execFileSync` array form |
| `execGit()` | `execFileSync('git', args)` | Array-based, no interpolation | SAFE |
| `init.cjs` code detect | `execSync('find ...')` | Hardcoded command, no user input | SAFE |

### 7.3 Output Sanitization

- All paths normalized via `toPosix()` — relative, never absolute
- No environment variables exposed in output
- No stack traces in error messages
- `error()` function produces clean JSON `{error: "message"}`

### 7.4 Supply Chain

- **Zero runtime dependencies** — no supply chain attack surface
- **One devDependency** (esbuild) — only used at build time, not shipped
- `prepublishOnly` script ensures hooks are built before publish

### 7.5 Recommendations

1. **isGitIgnored()**: Consider migrating from `execSync(string)` to `execFileSync('git', ['check-ignore', '-q', '--', path])` for defense-in-depth (current sanitization is sufficient but array form is safer by design)
2. **SECURITY.md**: Fix version table (implementation task)

**Overall security posture: STRONG for a CLI tool with zero runtime deps.**

---

## Phase 8: Implementation Roadmap

### 8.1 Implementation Tasks (Ordered)

```
### Task 1: Fix SECURITY.md version table
Files: SECURITY.md
Test: Manual review
Estimate: XS (1 point)
Priority: P0

### Task 2: Expand .gitignore
Files: .gitignore
Test: Verify with git status
Estimate: XS (1 point)
Priority: P0

### Task 3: Fix ARCHITECTURE.md workflow count (33 → 31)
Files: docs/ARCHITECTURE.md
Test: Count workflows via glob
Estimate: XS (1 point)
Priority: P1

### Task 4: Clean up orphaned verify-work.md workflow
Files: pan-wizard-core/workflows/verify-work.md
Test: Verify verify-phase still works
Estimate: XS (1 point)
Priority: P2

### Task 5: Add Dependabot configuration
Files: .github/dependabot.yml (new)
Test: GitHub renders it correctly
Estimate: XS (1 point)
Priority: P3

### Task 6: Fix or remove FUNDING.yml
Files: .github/FUNDING.yml
Test: GitHub renders it correctly
Estimate: XS (1 point)
Priority: P5

### Task 7: Fix stale test counts in internal .claude/commands/*.md
Files: .claude/commands/test.md, quick.md, session-start.md, execplan.md, build.md
Test: Grep for "123 tests"
Estimate: XS (1 point)
Priority: P6

### Task 8: npm publish --dry-run verification
Files: none (verification only)
Test: npm publish --dry-run succeeds, size < 5MB
Estimate: XS (1 point)
Priority: P1

### Task 9: Migrate isGitIgnored to execFileSync (defense-in-depth)
Files: pan-wizard-core/bin/lib/core.cjs
Test: Existing tests pass
Estimate: S (2 points)
Priority: P4
```

### 8.2 Dependency Graph

```
Task 1 (SECURITY.md) ─┐
Task 2 (.gitignore)   ─┤
Task 3 (ARCH count)   ─┼── All independent, can run in parallel
Task 4 (verify-work)  ─┤
Task 5 (Dependabot)   ─┤
Task 6 (FUNDING.yml)  ─┤
Task 7 (stale counts) ─┘
                        │
                        v
Task 8 (npm dry-run) ─── Depends on all above being committed
                        │
Task 9 (execFileSync) ─── Independent, lower priority
```

### 8.3 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| .gitignore additions exclude needed files | Low | Medium | Review against `files` field in package.json |
| Removing verify-work.md breaks verify-phase | Low | High | Verify verify-phase.md references its own workflow, not verify-work.md |
| npm publish fails due to missing files | Low | High | Run --dry-run first; verify with npm pack |

### 8.4 Total Effort

**9 tasks, ~11 points, all XS-S size. Estimated: 1 focus-exec session.**

---

## Phase 9: Test Plan

### 9.1 Verification Strategy

Since this is a documentation/configuration fix (not code changes except Task 9), the test plan is:

| Verification | Method | Pass Criteria |
|-------------|--------|---------------|
| SECURITY.md | Read file, verify `1.0.0` in table | Version `1.0.0` shown as supported |
| .gitignore | `git status` shows no new untracked sensitive files | Standard patterns present |
| ARCHITECTURE.md | Glob count vs documented count | Both say 31 |
| verify-work.md | `node --test tests/verify*.test.cjs` | All pass without verify-work.md |
| Dependabot | File exists with valid YAML | GitHub parses it |
| npm publish | `npm publish --dry-run` | Exit code 0, size < 5MB |
| isGitIgnored | `node --test tests/core*.test.cjs` | All existing tests pass |
| Full regression | `npm test` | 1065/1065 pass |

### 9.2 New Tests Required

Only Task 9 (isGitIgnored migration) would need a test if the implementation changes. All other tasks are documentation edits verified by reading the files.

---

## Phase 10: Summary

### Production Readiness Scorecard

| Area | Score | Notes |
|------|-------|-------|
| **Code Quality** | 10/10 | Zero TODO/FIXME, all error paths handled, zero TOCTOU races |
| **Test Coverage** | 10/10 | 1065 tests, 37 files, cross-platform, cross-Node-version |
| **Documentation** | 9/10 | 12 comprehensive guides, 200KB+ total. 1 stale count (33→31) |
| **Security** | 8/10 | Zero runtime deps, safe shell usage, stale SECURITY.md version |
| **npm Package** | 9/10 | Proper files field, prepublishOnly, zero deps. Missing dry-run verification |
| **CI/CD** | 8/10 | 4 Node versions × 3 OS. No publish workflow, no Dependabot |
| **Community Files** | 9/10 | LICENSE, COC, CONTRIBUTING, SECURITY present. FUNDING.yml empty |
| **Installer** | 10/10 | Shebang, 5 runtimes, error handling, graceful degradation |
| **.gitignore** | 4/10 | Only 3 entries — needs standard patterns |
| **OVERALL** | **8.6/10** | **PRODUCTION READY — 9 small fixes for perfect score** |

### Blocking Issues (0)

**None.** PAN Wizard can be published to npm today. All issues found are polish items.

### Recommended Fix Order

1. SECURITY.md version table (30 seconds)
2. .gitignore expansion (2 minutes)
3. ARCHITECTURE.md workflow count (30 seconds)
4. npm publish --dry-run verification (1 minute)
5. Everything else (optional polish)

### Next Steps

Run `/pan:focus-plan` with this spec as input to create an execution batch, or fix the items directly — they're all trivial edits.
