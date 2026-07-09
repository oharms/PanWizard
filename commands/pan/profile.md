---
name: pan:profile
group: Session & Progress
description: Switch model profile for PAN agents (quality/balanced/budget)
argument-hint: <profile>
allowed-tools:
  - Read
  - Write
  - Bash
---

<objective>
Switch the model profile used by PAN agents. Controls which Claude model each agent uses, balancing quality vs token spend.

Routes to the set-profile workflow which handles:
- Argument validation (quality/balanced/budget)
- Downgrade confirmation (quality → balanced → budget requires 'yes')
- Config file creation if missing
- Profile update in config.json
- Confirmation with model table display
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/profile.md
</execution_context>

<process>
**Follow the set-profile workflow** from `@~/.claude/pan-wizard-core/workflows/profile.md`.

The workflow handles all logic including:
1. Profile argument validation
2. Config file ensuring
3. Config reading and updating
4. Model table generation from MODEL_PROFILES
5. Cost estimation display (relative cost multiplier per profile)
6. Confirmation display
</process>

<tier_decision_tree>
**Opus 4.7 capability-aware routing** (since v2.10.0 — E-7). Even within a single profile, PAN picks a tier per-call based on three hints: context estimate, whether the task needs extended thinking, and whether prompt cache is warm.

The decision order `resolveModel` applies after the baseline profile pick:

```
Baseline tier (from MODEL_PROFILES[agent][profile])
        │
        ▼
┌─────────────────────────────────────────────┐
│ context_estimate > 700K tokens?             │── yes ──▶ force reasoning (only 1M-ctx tier)
└─────────────────────────────────────────────┘
        │ no
        ▼
┌─────────────────────────────────────────────┐
│ needs_thinking AND tier == fast?            │── yes ──▶ upgrade fast → mid
└─────────────────────────────────────────────┘
        │ no
        ▼
┌─────────────────────────────────────────────┐
│ cache_warm AND !needs_thinking              │── yes ──▶ downgrade mid → fast
│ AND context_estimate < 50K AND tier == mid  │
└─────────────────────────────────────────────┘
        │ no
        ▼
Final tier → provider-native model name
```

**Quick guide:**
- Heavy verification (plan-checker, verifier, integration-checker, reviewer, debugger): `needs_thinking: true` — baseline upgrades fast→mid.
- Map-codebase single-shot mode on Opus 4.7: `context_estimate > 700K` — forced to reasoning.
- Routine exec tasks with project.md cached: `cache_warm + small ctx` — mid gets downgraded to fast for a cost win.
- All rules are additive to the `quality` / `balanced` / `budget` profile you pick here — profile sets the floor, capability hints adjust upward or downward within that floor's band.

**Inspecting routing:** use `pan-tools resolve-model <agent> --metadata '{"context_estimate":900000,"needs_thinking":true}'` to see what tier a given hint set resolves to.

**Effort dimension (2026-06):** `resolve-model` also returns an `effort` level (`low`/`medium`/`high`/`xhigh`) per agent — the within-model reasoning-depth dial on current models. Profiles modulate it: `budget` steps each agent's base effort down one level (floor `low`); `quality`/`balanced` keep the base. Per-agent override: `.planning/config.json` → `"effort_overrides": { "pan-verifier": "xhigh" }`.
</tier_decision_tree>
