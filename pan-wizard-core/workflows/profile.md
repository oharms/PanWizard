<objective>
Switch the model profile used by PAN agents. Sets the model tier PAN's workflows pass when they spawn an agent (mapped to the detected provider's models), balancing quality vs token spend. `/pan:army` and `pan-conductor` spawn with no model, so the agents they run use their own `model:` pin, else the session model, under every profile.

Routes to the profile workflow which handles:
- Argument validation (quality/balanced/budget)
- Downgrade confirmation (quality → balanced → budget requires 'yes')
- Config file creation if missing
- Profile update in config.json
- Confirmation with model table display
</objective>

<tier_decision_tree>
**Capability-aware routing** (shipped v2.10.0 — E-7). `resolveModel` can adjust the profile's tier per call from three hints — context estimate, whether the task needs extended thinking, and whether prompt cache is warm — but only when the caller passes them (`resolve-model <agent> --metadata '{…}'`). No shipped workflow, command or agent passes them, so the tree and the quick guide below describe what a caller's hints would do.

The decision order `resolveModel` applies after the baseline profile pick:

```
Baseline tier (from MODEL_PROFILES[agent][profile])
        │
        ▼
┌─────────────────────────────────────────────┐
│ context_estimate > 700K tokens?             │── yes ──▶ force reasoning (widest ctx tier)
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
- Whole-repo context estimates above the large-context threshold (`context_estimate > 700K` tokens — `LARGE_CONTEXT_TOKEN_THRESHOLD`): forced to reasoning, which inherits the model you launched with. Note the direction: `/pan:map-codebase` picks `single-shot` **at or below** 700K and `sharded` above it, so the repos that trip this rule are the ones the mapper is already sharding.
- Routine exec tasks with project.md cached: `cache_warm + small ctx` — mid gets downgraded to fast for a cost win.
- All rules are additive to the `quality` / `balanced` / `budget` profile you pick here — profile sets the floor, capability hints adjust upward or downward within that floor's band.

**Inspecting routing:** use `pan-tools resolve-model <agent> --metadata '{"context_estimate":900000,"needs_thinking":true}'` to see what tier a given hint set resolves to.

**Effort dimension (2026-06):** `resolve-model` also returns an `effort` level (`low`/`medium`/`high`/`xhigh`) per agent — the within-model reasoning-depth dial on current models. Profiles modulate it: `budget` steps each agent's base effort down one level (floor `low`); `quality`/`balanced` keep the base. Per-agent override: `.planning/config.json` → `"effort_overrides": { "pan-verifier": "xhigh" }`.
</tier_decision_tree>

<purpose>
Switch the model profile used by PAN agents. Controls which model tier each agent uses, balancing quality vs token spend.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="validate">
Validate argument:

```
if $ARGUMENTS.profile not in ["quality", "balanced", "budget"]:
  Error: Invalid profile "$ARGUMENTS.profile"
  Valid profiles: quality, balanced, budget
  EXIT
```
</step>

<step name="ensure_and_load_config">
Ensure config exists and load current state:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-ensure-section
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state load)
```

This creates `.planning/config.json` with defaults if missing and loads current config.
</step>

<step name="check_downgrade">
Detect if this is a downgrade and confirm with user:

```
TIER_MAP = { "quality": 2, "balanced": 2, "budget": 1 }   # quality and balanced resolve every agent to the same tier and effort
current_profile = config.model_profile OR "balanced"
new_profile = $ARGUMENTS.profile

current_tier = TIER_MAP[current_profile]
new_tier = TIER_MAP[new_profile]

if new_tier < current_tier:
    # DOWNGRADE — ask for confirmation
    Display:
    ⚠️ Profile Downgrade: {current_profile} → {new_profile}
    
    This will switch agents to lower-tier models:
    | Agent | Current | New |
    |-------|---------|-----|
    [Show affected agents where model changes]
    
    Lower quality models may produce less accurate results
    for planning, research, and verification tasks.
    
    Type 'yes' to confirm downgrade, or anything else to cancel.
    
    IF user does not confirm with 'yes':
        Display: "Profile change cancelled."
        EXIT
```

Upgrades (budget → balanced → quality) proceed silently.
Same profile re-application proceeds silently.
</step>

<step name="update_config">
Read current config from state load or directly:

Update `model_profile` field:
```json
{
  "model_profile": "$ARGUMENTS.profile"
}
```

Write updated config back to `.planning/config.json`.
</step>

<step name="confirm">
Display confirmation with model table and cost estimate for selected profile:

```
✓ Model profile set to: $ARGUMENTS.profile

Agents will now use:

[Show table from MODEL_PROFILES in ~/.claude/pan-wizard-core/bin/lib/core.cjs for selected profile]

Example (`budget` — the only profile that steps agents below the reasoning
tier; `quality` and `balanced` put every agent on `reasoning`):
| Agent | Tier |
|-------|------|
| pan-planner | mid |
| pan-executor | mid |
| pan-verifier | fast |
| ... | ... |

Cost estimate:
[Run: node ~/.claude/pan-wizard-core/bin/pan-tools.cjs estimate-cost]
Show the average cost multiplier for each profile (quality/balanced/budget)
and highlight the selected profile — read the numbers from the command output,
don't hardcode them (`quality` and `balanced` report the same multiplier).
Example shape:
  quality: <n>× avg | balanced: <n>× avg | budget: <n>× avg
                                           ^^^^^^^^^^^^^^^^ selected

Next spawned agents will use the new profile.
```

Map profile names:
- quality: use "quality" column from MODEL_PROFILES
- balanced: use "balanced" column from MODEL_PROFILES
- budget: use "budget" column from MODEL_PROFILES
</step>

</process>

<success_criteria>
- [ ] Argument validated
- [ ] Config file ensured
- [ ] Config updated with new model_profile
- [ ] Confirmation displayed with model table
</success_criteria>
