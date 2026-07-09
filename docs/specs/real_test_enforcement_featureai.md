# Real Test Enforcement & Integration Test Scaffolding — Feature Specification

**Generated:** 2026-03-09
**Version:** 1.0
**Status:** Proposed
**Source:** Deployment audit of d:\xxxxx (SQL Server Analyser — Rust CLI, PAN v2.8.0)

---

## Problem Statement

A deployment audit of a completed 6-phase Rust CLI project that communicates with SQL Server via DMV queries revealed a critical test quality gap: **PAN generated 96 unit tests — all pure data-structure tests — with zero integration tests, zero E2E tests, and zero Docker infrastructure** for a tool whose entire value proposition is connecting to a live database.

### Specific Failures Observed

1. **Plans don't require test tier classification.** Plans say "add unit tests for helpers" but the phase goal says "User can connect to SQL Server and discover databases." The test plan has no mechanism to flag that unit tests on string formatting do not validate the behavioral goal.

2. **Plan-checker doesn't validate test-criteria alignment.** The plan-checker agent verifies structural completeness (frontmatter, dependencies, artifacts) but never asks: "Will these tests actually prove the success criteria are met?" A plan with success criterion "User can run `discover` and see server version" passed plan-check with only `csv_field()` tests planned.

3. **Verifier accepts hollow test coverage.** Verification reports note `cargo test: 96 pass` as evidence of quality, but don't distinguish between tests that exercise behavioral criteria vs tests that only cover utility helpers. Phase 2 verification says "PASS" for "User can run `tables` subcommand" based on format_size() unit tests alone.

4. **No Docker/infrastructure scaffolding during research or planning.** The research phase identified `tiberius` as the SQL driver and documented DMV queries, but never proposed a Docker Compose for test SQL Server. No phase produced test seed data, integration test infrastructure, or CI configuration.

5. **Missing verification for 3 of 6 phases.** Phases 1, 3, 4 executed to completion but were never verified — no `verification.md` exists. The auto_advance workflow setting allowed execution to proceed without verification gates.

6. **No Playwright/headed testing guidance for web projects.** While this specific project is CLI-only, PAN's `phase-tests` command generates unit test stubs for all project types. For web frontends, it should scaffold Playwright with headed mode for development and propose page object models matching planned UI flows.

## Demand Evidence

| Evidence Type | Source | Finding |
|---|---|---|
| Deployment audit | d:\xxxxx cargo test | 96 tests, ALL are pure-function unit tests (csv_field, format_size, parse_column_list) |
| Deployment audit | d:\xxxxx src/ | 0 integration tests against real SQL Server, 0 E2E CLI tests |
| Deployment audit | d:\xxxxx | No `tests/` directory, no Docker Compose, no test seed SQL |
| Test distribution | index_stats.rs | 11 tests on DDL string building; 0 tests executing DDL against SQL Server |
| Test distribution | wait_stats.rs | 19 tests on wait category mapping; 0 tests reading real DMV wait data |
| Test distribution | query_stats.rs | 18 tests on duration formatting; 0 tests querying real plan cache |
| Test distribution | security_checks.rs | 2 tests on display_name(); 0 tests running security audit against real instance |
| Verification gap | Phases 1, 3, 4 | Executed but never verified — auto_advance skipped verification |
| Plan quality | All 13 plans | No plan includes test tier table, Docker requirements, or integration test strategy |
| Verifier reports | Phases 2, 5, 6 | `cargo test: PASS (N tests)` accepted as evidence without analyzing test scope |

## Success Criteria

```
SC-1: Plan templates include mandatory test tier table (Unit/Integration/E2E) with infrastructure column
SC-2: Plan-checker flags when success criteria mention user-observable behavior but test plan only has unit tests
SC-3: Verifier checks that behavioral success criteria have matching integration or E2E tests, not just unit tests
SC-4: Research phase detects external service dependencies and proposes Docker Compose for test infrastructure
SC-5: phase-tests command generates integration test scaffolding (not just unit stubs) when project has external dependencies
SC-6: phase-tests command scaffolds Playwright with headed mode for web frontend projects
SC-7: Verification gate cannot be auto-advanced when verification is enabled in config
SC-8: No regression in existing 1636+ PAN Wizard tests
```

## Competitive Landscape

No AI coding tool currently enforces integration test quality or scaffolds test infrastructure. This would be a differentiator.

| Tool | Test Generation | Test Tier Awareness | Docker Scaffolding | E2E/Playwright | Verification Gate |
|---|---|---|---|---|---|
| **PAN Wizard (current)** | Unit stubs only | None | None | None | Bypassable |
| **Aider** | None | None | None | None | N/A |
| **Cursor** | Inline suggestions | None | None | None | N/A |
| **Cline** | None | None | None | None | N/A |
| **Devin** | Task-specific | None | Some Docker | None | None |

## Design

### Architecture

The changes integrate into 4 existing PAN workflow stages:

```
Research Phase ──► Plan Phase ──► Execute Phase ──► Verify Phase
     │                │                                  │
  [NEW: detect      [NEW: test tier        [NEW: test-criteria
   external deps,    table required,        alignment check,
   propose Docker    plan-checker           behavioral coverage
   Compose]          validates tiers]       validation]
                                    │
                              [NEW: phase-tests
                               generates integration
                               scaffolding + Playwright]
```

### Test Tier Model

Plans must classify tests into tiers that map to infrastructure needs:

| Tier | Scope | Infrastructure | Example |
|---|---|---|---|
| **T1: Unit** | Pure functions, data structures | None | `csv_field("a,b")` returns `"\"a,b\""` |
| **T2: Integration** | Code + external service | Docker container | `get_server_info(&mut client)` returns real server version |
| **T3: E2E** | Full CLI/UI end-to-end | Docker + built binary | `sqla discover -c "..." -d TestDB` outputs JSON with tables |
| **T4: Visual/UI** | Browser-rendered UI flows | Playwright (headed) | Navigate to dashboard, verify chart renders with real data |

### Criteria-to-Tier Mapping Rules

Success criteria language maps to minimum test tier:

| Criterion Pattern | Minimum Tier | Rationale |
|---|---|---|
| "User can run X and see Y" | T3 (E2E) | Observable behavior requires real execution |
| "X connects to Y" | T2 (Integration) | Connection requires real service |
| "X returns/produces Y format" | T1 (Unit) if pure transform, T2 if from external data | Depends on data source |
| "User sees X in browser/UI" | T4 (Visual) | Requires rendered UI |
| "X handles errors gracefully" | T2 (Integration) | Error paths need real failure injection |

### Docker Detection Heuristics

During research phase, detect external dependencies by scanning:

| Language | Dependency Indicators | Docker Image |
|---|---|---|
| Rust | `tiberius`, `sqlx`, `diesel` in Cargo.toml | `mcr.microsoft.com/mssql/server:2022-latest` |
| Rust | `redis`, `fred` in Cargo.toml | `redis:7-alpine` |
| Node.js | `pg`, `mysql2`, `mssql` in package.json | Respective DB images |
| .NET | `Microsoft.EntityFrameworkCore.SqlServer` | `mcr.microsoft.com/mssql/server:2022-latest` |
| Python | `psycopg2`, `sqlalchemy` in requirements.txt | `postgres:16-alpine` |
| Any | `rabbitmq`, `amqplib` | `rabbitmq:3-management` |
| Any | Frontend framework (React, Vue, Svelte, Flutter) | Playwright browsers |

### Playwright Scaffolding

For web frontend projects, generate:

1. `playwright.config.ts` with headed mode default for development:
   ```typescript
   headless: process.env.CI === 'true'  // headed locally, headless in CI
   video: 'on-first-retry'
   trace: 'on-first-retry'
   ```

2. Page object models matching planned UI components
3. E2E flows matching success criteria ("User can navigate to X and see Y")
4. Visual regression baseline configuration

## Feature Ladder

| Version | Scope | Value | Effort |
|---|---|---|---|
| **v0 (MVP)** | Test tier table in plan template + plan-checker validation | Plans explicitly declare test strategy; checker flags unit-only for behavioral criteria | M |
| **v1** | Verifier test-criteria alignment + Docker detection in research | Verifier rejects hollow coverage; research auto-proposes Docker Compose | L |
| **v2** | phase-tests integration scaffolding + Playwright generation | Full test infrastructure scaffolded automatically per project type | XL |

## Implementation Tasks

| # | ID | Title | Files | Effort | Pts | Priority |
|---|---|---|---|---|---|---|
| 1 | T.1 | Add test tier table to plan template | `templates/summary-*.md`, `templates/phase-prompt.md` | S | 2 | P0 |
| 2 | T.2 | Add test tier table to planner agent prompt | `agents/pan-planner.md` | S | 2 | P0 |
| 3 | T.3 | Plan-checker: validate test-criteria alignment | `agents/pan-plan-checker.md` | M | 4 | P0 |
| 4 | T.4 | Verifier: check behavioral criteria have integration/E2E tests | `agents/pan-verifier.md` | M | 4 | P1 |
| 5 | T.5 | Verifier: flag phases with no verification.md when verifier is enabled | `agents/pan-verifier.md`, `workflows/verify-phase.md` | S | 2 | P1 |
| 6 | T.6 | Research agent: detect external dependencies from project files | `agents/pan-project-researcher.md`, `agents/pan-phase-researcher.md` | M | 4 | P1 |
| 7 | T.7 | Research agent: propose Docker Compose for detected dependencies | `templates/research-project/stack.md`, `agents/pan-project-researcher.md` | M | 4 | P1 |
| 8 | T.8 | phase-tests: generate integration test scaffolding per language | `workflows/phase-tests.md`, `commands/pan/phase-tests.md` | L | 6 | P2 |
| 9 | T.9 | phase-tests: scaffold Playwright config for web frontends | `workflows/phase-tests.md`, `commands/pan/phase-tests.md` | M | 4 | P2 |
| 10 | T.10 | phase-tests: generate Docker Compose from research artifacts | `workflows/phase-tests.md` | M | 4 | P2 |
| 11 | T.11 | phase-tests: generate seed data SQL/scripts for detected databases | `workflows/phase-tests.md` | M | 4 | P2 |
| 12 | T.12 | Verification gate: prevent auto-advance when verifier=true but no verification.md | `workflows/exec-phase.md`, `pan-wizard-core/bin/lib/verify.cjs` | M | 4 | P1 |
| 13 | T.13 | Tests for T.1-T.5 (template + agent prompt validation) | `tests/` | M | 4 | P0 |
| 14 | T.14 | Tests for T.6-T.7 (research dependency detection) | `tests/` | M | 4 | P1 |
| 15 | T.15 | Tests for T.8-T.12 (phase-tests scaffolding) | `tests/` | M | 4 | P2 |

### Dependency Graph

```
T.1 + T.2 ──► T.3 ──► T.13 (tests)
                         │
T.4 + T.5 ──► T.12 ──► T.14 (tests)
                         │
T.6 + T.7 ──► T.8 + T.9 + T.10 + T.11 ──► T.15 (tests)
```

### Execution Waves

```
Wave 1 (P0, 8 pts):  T.1 + T.2 + T.3 — plan template + checker
Wave 2 (P0, 4 pts):  T.13 — tests for Wave 1
Wave 3 (P1, 14 pts): T.4 + T.5 + T.6 + T.7 + T.12 — verifier + research + gate
Wave 4 (P1, 4 pts):  T.14 — tests for Wave 3
Wave 5 (P2, 18 pts): T.8 + T.9 + T.10 + T.11 — phase-tests scaffolding
Wave 6 (P2, 4 pts):  T.15 — tests for Wave 5

Total: 52 pts across 6 waves
```

## Test Plan

| Level | Count | What It Catches |
|---|---|---|
| Unit | 10+ | Template has test tier table, planner prompt includes tier guidance |
| Unit | 5+ | Plan-checker detects missing integration tier for behavioral criteria |
| Unit | 5+ | Verifier flags hollow test coverage (unit-only for DB project) |
| Unit | 5+ | Research agent detects tiberius/sqlx/pg and proposes Docker |
| Integration | 5+ | phase-tests generates working Docker Compose + integration test files |
| Integration | 3+ | Playwright config generated with correct headed/headless settings |

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Plan-checker too aggressive — flags projects that genuinely only need unit tests | Medium | Medium | Tier requirement only triggers when success criteria contain behavioral language ("User can run/see/connect") |
| Docker Compose generation incorrect for edge cases | Low | Low | Template-based generation with well-tested heuristics; user can edit |
| Playwright scaffolding breaks for non-standard frontend setups | Medium | Low | Conservative detection (only well-known frameworks); fallback to manual setup instructions |
| Auto-advance prevention too strict | Low | Medium | Only enforced when `workflow.verifier: true` in config.json; can be disabled |
| Integration test scaffolding generates non-compiling code | Medium | Medium | Language-specific templates tested against real project structures; includes TODO markers |

---

*Generated by /pan:audit-deployment — 2026-03-09*
