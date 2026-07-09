<purpose>
Switch the model profile used by PAN agents. Controls which Claude model each agent uses, balancing quality vs token spend.
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
TIER_MAP = { "quality": 3, "balanced": 2, "budget": 1 }
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

[Show table from MODEL_PROFILES in pan-tools.cjs for selected profile]

Example:
| Agent | Model |
|-------|-------|
| pan-planner | opus |
| pan-executor | sonnet |
| pan-verifier | haiku |
| ... | ... |

Cost estimate:
[Run: node ~/.claude/pan-wizard-core/bin/pan-tools.cjs estimate-cost]
Show the average cost multiplier for each profile (quality/balanced/budget)
and highlight the selected profile. Example:
  quality: 15.0× avg | balanced: 4.3× avg | budget: 2.2× avg
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
