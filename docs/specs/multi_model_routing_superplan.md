# PAN Wizard Work Plan — Multi-Model Routing

**Generated:** 2026-03-21 · **Source:** `docs/specs/multi_model_routing_featureai.md`

---

## Baseline

| Metric | Value |
|--------|-------|
| Version | 2.8.1 |
| Tests passing | 1658/1658 |
| Test files | 71 (46 unit + 25 scenario) |
| Commands shipped | 42 |
| Agents shipped | 12 |
| Core modules | 16 |
| Open TODOs | 64 |
| Hooks | 3 |

---

## Items

| ID | Priority | Size | Pts | Title | Files | Status |
|----|----------|------|-----|-------|-------|--------|
| 1 | P5 | S | 2 | Add PROVIDER_MODELS constant | core.cjs | Done |
| 2 | P5 | XS | 1 | Add LEGACY_ALIASES constant (opus→reasoning, sonnet→mid, haiku→fast) | core.cjs | Done |
| 3 | P5 | M | 4 | Update MODEL_PROFILES to use tier aliases (reasoning/mid/fast) | core.cjs | Done |
| 4 | P5 | S | 2 | Add detectProvider(cwd, config) function | core.cjs | Done |
| 5 | P5 | S | 2 | Add resolveTierToModel(tier, provider) function | core.cjs | Done |
| 6 | P5 | M | 4 | Add resolveComplexityTier(baseTier, taskMetadata) function | core.cjs | Done |
| 7 | P5 | M | 4 | Update resolveModelInternal() — add provider detection, tier resolution, routing strategy support, optional taskMetadata param | core.cjs | Done |
| 8 | P5 | S | 2 | Add estimateCostMultiplier(profile) function + COST_MULTIPLIERS constant | core.cjs | Done |
| 9 | P5 | XS | 1 | Export new functions and constants from core.cjs module.exports | core.cjs | Done |
| 10 | P5 | S | 2 | Update buildConfigDefaults() — add routing section (strategy, provider, cascade_quality_gate, complexity_thresholds) | config.cjs | Done |
| 11 | P5 | S | 2 | Update config merge to deep-merge routing section | config.cjs | Done |
| 12 | P5 | M | 4 | Update cmdResolveModel() — accept optional metadataJson param, pass to resolveModelInternal, include strategy in output | commands.cjs | Done |
| 13 | P5 | S | 2 | Add cmdEstimateCost(cwd, raw) command | commands.cjs | Done |
| 14 | P5 | S | 2 | Wire estimate-cost case in pan-tools.cjs dispatcher | pan-tools.cjs | Done |
| 15 | P5 | XS | 1 | Update resolve-model case in pan-tools.cjs to pass metadata arg | pan-tools.cjs | Done |
| 16 | P3 | M | 4 | Tests: PROVIDER_MODELS structure, tier alias resolution (6 tests) | tests/core.test.cjs | Done |
| 17 | P3 | M | 4 | Tests: Legacy backward compat — opus/sonnet/haiku still resolve (3 tests) | tests/core.test.cjs | Done |
| 18 | P3 | M | 4 | Tests: detectProvider() — config, env var, directory, fallback (4 tests) | tests/core.test.cjs | Done |
| 19 | P3 | M | 4 | Tests: resolveComplexityTier — downgrade, maintain, upgrade, edge cases (6 tests) | tests/core.test.cjs | Done |
| 20 | P3 | S | 2 | Tests: resolveModelInternal with strategy=static (backward compat) | tests/core.test.cjs | Done |
| 21 | P3 | S | 2 | Tests: resolveModelInternal with strategy=complexity + metadata | tests/core.test.cjs | Done |
| 22 | P3 | S | 2 | Tests: Per-agent override precedence over routing strategy | tests/core.test.cjs | Done |
| 23 | P3 | S | 2 | Tests: estimateCostMultiplier returns valid numbers for all profiles | tests/core.test.cjs | Done |
| 24 | P3 | S | 2 | Tests: Config — routing defaults present, user override merging (3 tests) | tests/config.test.cjs | Done |
| 25 | P3 | S | 2 | Tests: Commands — resolve-model with/without metadata, estimate-cost output (4 tests) | tests/commands.test.cjs | Done |
| 26 | P6 | L | 10 | Rewrite model-profiles.md reference — tier aliases, provider mapping, routing strategies, config examples | references/model-profiles.md | Done |
| 27 | P6 | S | 2 | Update profile.md command — add cost estimation display after profile switch | commands/pan/profile.md | Done |
| 28 | P6 | S | 2 | Update profile.md workflow — add cost multiplier output step | workflows/profile.md | Done |
| 29 | P6 | S | 2 | Update settings.md workflow — add routing strategy question | workflows/settings.md | Done |
| 30 | P6 | M | 4 | Update USER-GUIDE.md — Model Profiles section with routing, cost estimation, per-phase override | docs/USER-GUIDE.md | Done |
| 31 | P6 | S | 2 | Update AGENTS.md — Model Profiles section with tier aliases | docs/AGENTS.md | Done |
| 32 | P6 | S | 2 | Update COMPARISON.md — Model Flexibility row, Where PAN Leads section | docs/COMPARISON.md | Done |
| 33 | P6 | S | 2 | Update INTERNALS.md — document routing pipeline | docs/INTERNALS.md | Done |
| 34 | P5 | M | 4 | Per-phase model override — parse `<!-- model_tier: X -->` from roadmap phase sections in resolveModelInternal | core.cjs | Done |
| 35 | P3 | S | 2 | Tests: Per-phase model override precedence | tests/core.test.cjs | Done |
| 36 | P3 | S | 2 | Tests: Installer deploys updated model-profiles.md to all 5 runtimes | tests/e2e-install.test.cjs | Done |

**Total: 36 items · 96 points**

---

## Dependency Graph

```
Items 1-2 (constants) ← Item 3 (profiles update) ← Item 7 (resolveModelInternal update)
Items 4-5 (detect/resolve functions) ← Item 7
Item 6 (complexity fn) ← Item 7
Item 8 (cost fn) ← Item 13 (cmdEstimateCost)
Items 7,9 (core exports) ← Items 12-15 (CLI wiring)
Items 1-9 (all core) ← Items 16-23 (core tests)
Items 10-11 (config) ← Item 24 (config tests)
Items 12-15 (commands) ← Item 25 (command tests)
Item 34 (per-phase override) ← Item 35 (per-phase tests)
All code ← Items 26-33 (documentation)
```

---

## Session Plan

### Session 1: Core Routing Engine + Backward Compat (38 pts)

**Goal:** All core functions working, existing tests still pass, new core tests green.

| Order | IDs | Title | Pts |
|-------|-----|-------|-----|
| 1 | 1, 2 | PROVIDER_MODELS + LEGACY_ALIASES constants | 3 |
| 2 | 3 | Update MODEL_PROFILES to tier aliases | 4 |
| 3 | 4, 5 | detectProvider() + resolveTierToModel() | 4 |
| 4 | 6 | resolveComplexityTier() | 4 |
| 5 | 7 | Update resolveModelInternal() with provider + strategy | 4 |
| 6 | 8 | estimateCostMultiplier() + COST_MULTIPLIERS | 2 |
| 7 | 9 | Export new functions from module.exports | 1 |
| 8 | 16, 17 | Tests: tier alias resolution + backward compat (9 tests) | 8 |
| 9 | 18 | Tests: detectProvider() (4 tests) | 4 |
| 10 | 20 | Tests: resolveModelInternal static backward compat | 2 |
| 11 | 22 | Tests: Per-agent override precedence | 2 |

**Verification gate:** `npm run test:all` — 1658 existing + ~15 new tests all pass. No regression in resolve-model output. Legacy opus/sonnet/haiku still work.

**Risk:** Item 3 (MODEL_PROFILES change) touches the constant that ~6 existing test files assert against. Must update test expectations atomically with the constant change. Run tests after each sub-step.

---

### Session 2: Config + CLI Integration (16 pts)

**Goal:** CLI commands wired, config defaults updated, full pipeline testable end-to-end.

| Order | IDs | Title | Pts |
|-------|-----|-------|-----|
| 1 | 10, 11 | Config defaults — routing section + deep-merge | 4 |
| 2 | 12 | Update cmdResolveModel() with metadata support | 4 |
| 3 | 13 | Add cmdEstimateCost() command | 2 |
| 4 | 14, 15 | Wire pan-tools.cjs — estimate-cost + resolve-model metadata | 3 |
| 5 | 24 | Tests: config routing defaults (3 tests) | 2 |
| 6 | 25 | Tests: commands — resolve-model metadata + estimate-cost (4 tests) | 2 |

**Verification gate:** `npm run test:all` all pass. `pan-tools.cjs resolve-model pan-executor` returns expected value. `pan-tools.cjs estimate-cost` returns JSON with all 3 profiles.

---

### Session 3: Complexity Routing + Per-Phase Override (16 pts)

**Goal:** Complexity routing adjusts tiers based on task metadata. Per-phase override works from roadmap frontmatter.

| Order | IDs | Title | Pts |
|-------|-----|-------|-----|
| 1 | 19 | Tests: resolveComplexityTier — all 6 edge cases | 4 |
| 2 | 21 | Tests: resolveModelInternal complexity strategy | 2 |
| 3 | 23 | Tests: estimateCostMultiplier valid output | 2 |
| 4 | 34 | Per-phase model override (parse `<!-- model_tier -->`) | 4 |
| 5 | 35 | Tests: per-phase override precedence | 2 |
| 6 | 36 | Tests: installer deploys updated reference | 2 |

**Verification gate:** `npm run test:all` all pass. Complexity routing demonstrably up/downgrades based on fileCount, waveCount, requirementCount, isArchitectural metadata.

---

### Session 4: Documentation (26 pts)

**Goal:** All documentation updated to reflect new routing capabilities. Reference doc rewritten.

| Order | IDs | Title | Pts |
|-------|-----|-------|-----|
| 1 | 26 | Rewrite model-profiles.md reference (major) | 10 |
| 2 | 27, 28 | profile.md command + workflow — cost display | 4 |
| 3 | 29 | settings.md workflow — routing strategy question | 2 |
| 4 | 30 | USER-GUIDE.md — Model Profiles + routing section | 4 |
| 5 | 31, 32 | AGENTS.md + COMPARISON.md updates | 4 |
| 6 | 33 | INTERNALS.md — routing pipeline docs | 2 |

**Verification gate:** `npm run test:all` all pass (doc changes don't affect code). Spot-check that model-profiles.md is picked up by installer manifest.

---

## Session Summary

| Session | Focus | Items | Points | Cumulative |
|---------|-------|-------|--------|------------|
| 1 | Core routing engine + backward compat | 1-9, 16-18, 20, 22 | 38 | 38 |
| 2 | Config + CLI integration | 10-15, 24-25 | 16 | 54 |
| 3 | Complexity routing + per-phase override + remaining tests | 19, 21, 23, 34-36 | 16 | 70 |
| 4 | Documentation | 26-33 | 26 | 96 |

**Total: 4 sessions · 36 items · 96 points**

---

## Risk Register

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| R1 | MODEL_PROFILES change breaks existing tests | High | Update test expectations atomically; run tests after each file |
| R2 | resolveModelInternal signature change breaks callers | High | New param is optional; zero-arg path identical to current behavior |
| R3 | detectProvider() filesystem checks slow on network drives | Low | Cached per-session; only called once per resolve |
| R4 | Legacy model_overrides with "opus" stop working | High | LEGACY_ALIASES maps opus→reasoning→inherit; explicit test coverage |
| R5 | Config deep-merge drops existing user routing overrides | Medium | Follow existing pattern (spread hardcoded + user); test merge behavior |
| R6 | Per-phase override parsing fragile with HTML comments | Medium | Strict regex; fallback to profile default on parse failure |
| R7 | Cost estimation numbers misleading (no real token counts) | Low | Label as "relative multiplier", not dollar amounts; document limitations |

---

## Cut Line

**Recommended MVP:** Sessions 1-3 (70 pts) — full working routing engine with tests.

**Recommended full:** Sessions 1-4 (96 pts) — including all documentation.

**Deferred (not in this plan):**
- **Cascade routing** (try cheaper → escalate on failure) — XL complexity, requires quality gate heuristics, double-execution latency. Spec designed but implementation deferred until routing engine proves value in static + complexity modes.
- **Real-time cost tracking** — out of scope per spec; PAN delegates execution to host runtimes.
- **Non-Anthropic runtime testing** — only Claude Code currently consumes resolve-model output; other runtimes need integration work first.
